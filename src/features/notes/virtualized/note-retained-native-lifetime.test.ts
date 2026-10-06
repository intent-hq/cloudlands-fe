/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { Editor, Node, type NodeViewRenderer } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Text from '@tiptap/extension-text';
import { NoteNativeLifetime } from './note-native-lifetime';
import { NoteRetainedNativeLifetime } from './note-retained-native-lifetime';
const editors: Editor[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const editor of editors.splice(0)) editor.destroy();
});
function fixture() {
  const router = new NoteRetainedNativeLifetime();
  const factory = vi.fn<NodeViewRenderer>(() => ({
    dom: document.createElement('span'),
    destroy: vi.fn(),
  }));
  const creator = vi.fn(() => factory);
  const atom = Node.create({
    name: 'retainedAtom',
    group: 'block',
    atom: true,
    renderHTML: () => ['span'],
    addNodeView: creator,
  });
  const editor = new Editor({
    element: null,
    extensions: router.extensions([Document, Text, atom]),
    content: { type: 'doc', content: [{ type: 'retainedAtom' }] },
  });
  editors.push(editor);
  const lifetime = new NoteNativeLifetime();
  const ticket = router.begin(editor, lifetime);
  return { router, factory, creator, editor, lifetime, ticket };
}
it('admits only actual mount factories and binds actual dispatch roots to their original view', async () => {
  const f = fixture();
  expect(() => f.editor.extensionManager.nodeViews).toThrow();
  expect(f.creator).not.toHaveBeenCalled();
  f.router.mount(f.ticket, document.createElement('div'));
  const view = f.editor.view,
    before = view.state,
    tr = before.tr;
  expect(f.factory).toHaveBeenCalledOnce();
  expect(f.router.filter(tr, before)).toBe(false);
  f.router.dispatch(f.ticket, view, tr, () => {
    expect(f.router.filter(tr, before)).toBe(true);
    expect(f.router.filter(before.tr, before)).toBe(false);
    expect(() => f.router.dispatch(f.ticket, view, tr, () => {})).toThrow();
  });
  f.router.close(f.ticket);
  await f.lifetime.dispose(
    () => f.editor.unmount(),
    () => {},
  );
  expect(() => f.router.dispatch(f.ticket, view, tr, () => {})).toThrow();
  const next = f.router.begin(f.editor, new NoteNativeLifetime());
  f.router.mount(next, document.createElement('div'));
  expect(next.view).not.toBe(view);
  expect(f.factory).toHaveBeenCalledTimes(2);
  f.router.close(next);
  await next.lifetime.dispose(
    () => f.editor.unmount(),
    () => {},
  );
});
it('refuses reentrant factory creation before running another actual parent factory', async () => {
  const f = fixture();
  f.creator.mockImplementationOnce(() => {
    expect(() => f.editor.extensionManager.nodeViews).toThrow();
    return f.factory;
  });
  f.router.mount(f.ticket, document.createElement('div'));
  expect(f.creator).toHaveBeenCalledOnce();
  f.router.close(f.ticket);
  await f.lifetime.dispose(
    () => f.editor.unmount(),
    () => {},
  );
});
it('owns returned native products when a factory callback retires its lifetime', async () => {
  const f = fixture();
  let resolve!: () => void;
  const held = new Promise<void>((done) => {
    resolve = done;
  });
  const destroy = vi.fn(() => held),
    released = vi.fn();
  let done: Promise<void> | undefined;
  f.factory.mockImplementationOnce(() => {
    f.router.close(f.ticket);
    done = f.lifetime.dispose(() => {}, released);
    return { dom: document.createElement('span'), destroy };
  });
  expect(() => f.router.mount(f.ticket, document.createElement('div'))).toThrow();
  expect(destroy).toHaveBeenCalledOnce();
  expect(released).not.toHaveBeenCalled();
  expect(() => f.router.begin(f.editor, new NoteNativeLifetime())).toThrow();
  resolve();
  await done;
  expect(released).toHaveBeenCalledOnce();
});
it('permanently refuses a new mount after an actual factory throws', async () => {
  const f = fixture();
  f.factory.mockImplementationOnce(() => {
    throw new Error('controlled factory failure');
  });
  expect(() => f.router.mount(f.ticket, document.createElement('div'))).toThrow(
    'controlled factory failure',
  );
  expect(() => f.router.begin(f.editor, new NoteNativeLifetime())).toThrow();
  await expect(
    f.lifetime.dispose(
      () => f.editor.unmount(),
      () => {},
    ),
  ).rejects.toThrow('controlled factory failure');
});
