import { afterEach, expect, it, vi } from 'vitest';
import { SvelteRenderer } from 'svelte-tiptap';
import { unmount } from 'svelte';
import { Editor, Extension, Node } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Text from '@tiptap/extension-text';
import { NoteNativeLifetime } from './note-native-lifetime';
vi.mock('svelte', async (original) => ({
  ...(await original<typeof import('svelte')>()),
  unmount: vi.fn(),
}));
afterEach(() => vi.resetAllMocks());
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
it('keeps the window reservation until actual Svelte disposal settles', async () => {
  const pending = deferred();
  vi.mocked(unmount).mockReturnValue(pending.promise);
  const component = {};
  const renderer = new SvelteRenderer(component, {
    element: document.createElement('div'),
    props: {},
  });
  const lifetime = new NoteNativeLifetime();
  const removeEditorListener = vi.fn();
  const view = lifetime.track({
    dom: renderer.dom,
    renderer,
    destroy() {
      renderer.destroy();
      removeEditorListener();
    },
  });
  const release = vi.fn();
  const done = lifetime.dispose(() => view.destroy(), release);
  expect(unmount).toHaveBeenCalledExactlyOnceWith(component);
  expect(removeEditorListener).toHaveBeenCalledOnce();
  await Promise.resolve();
  expect(release).not.toHaveBeenCalled();
  pending.resolve();
  await done;
  expect(release).toHaveBeenCalledOnce();
});
it('waits for native asynchronous cleanup already started by an earlier transaction', async () => {
  const pending = deferred(),
    release = vi.fn();
  const lifetime = new NoteNativeLifetime();
  const destroy = vi.fn(() => pending.promise);
  const view = lifetime.track({ dom: document.createElement('div'), destroy });
  view.destroy();
  const done = lifetime.dispose(() => {}, release);
  await Promise.resolve();
  expect(release).not.toHaveBeenCalled();
  pending.resolve();
  await done;
  expect(destroy).toHaveBeenCalledOnce();
  expect(release).toHaveBeenCalledOnce();
});
it('cleans constructed node views after a failed mount and retains credit on cleanup failure', async () => {
  const lifetime = new NoteNativeLifetime(),
    release = vi.fn();
  const failed = new Error('native cleanup failed');
  const destroy = vi.fn(() => {
    throw failed;
  });
  lifetime.track({ dom: document.createElement('div'), destroy });
  await expect(lifetime.dispose(() => {}, release)).rejects.toBe(failed);
  expect(destroy).toHaveBeenCalledOnce();
  expect(release).not.toHaveBeenCalled();
});

it('tracks factories inside bundled extensions without duplicating their registration', async () => {
  const pending = deferred(),
    release = vi.fn(),
    destroyed = vi.fn(() => pending.promise);
  const factory = vi.fn(() => ({ dom: document.createElement('div'), destroy: destroyed }));
  const atom = Node.create({
    name: 'nativeAtom',
    group: 'block',
    atom: true,
    addNodeView: () => factory,
    renderHTML: () => ['div'],
  });
  const bundle = Extension.create({ name: 'nativeBundle', addExtensions: () => [atom] });
  const lifetime = new NoteNativeLifetime();
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: lifetime.extensions([Document, Text, bundle]),
    content: { type: 'doc', content: [{ type: 'nativeAtom' }] },
  });
  expect(factory).toHaveBeenCalledOnce();
  expect(
    editor.extensionManager.extensions.filter((item) => item.name === 'nativeAtom'),
  ).toHaveLength(1);
  const done = lifetime.dispose(() => editor.destroy(), release);
  expect(destroyed).toHaveBeenCalledOnce();
  expect(release).not.toHaveBeenCalled();
  pending.resolve();
  await done;
  expect(release).toHaveBeenCalledOnce();
});
it('remembers a rejected unmount even when it settles before the editor retires', async () => {
  const pending = deferred(),
    release = vi.fn();
  const lifetime = new NoteNativeLifetime();
  const failed = new Error('asynchronous disposal failed');
  const view = lifetime.track({
    dom: document.createElement('div'),
    destroy: () => pending.promise,
  });
  view.destroy();
  pending.reject(failed);
  await Promise.resolve();
  await Promise.resolve();
  const done = lifetime.dispose(() => {}, release);
  await expect(done).rejects.toBe(failed);
  expect(lifetime.dispose(() => {}, release)).toBe(done);
  expect(release).not.toHaveBeenCalled();
});
