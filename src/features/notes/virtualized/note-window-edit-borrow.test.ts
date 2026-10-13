import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import StarterKit from '@tiptap/starter-kit';
import Paragraph from '@tiptap/extension-paragraph';
import { NoteWindowView, type NoteViewEditing } from './note-window-view';
import type { NoteWindow } from './note-window-reader';

const retirement = vi.hoisted(() => ({ pending: new Set<() => void>() }));
vi.mock('$lib/utils/editor-config', () => ({
  createEditorConfig: () => ({
    extensions: [
      StarterKit.configure({ paragraph: false }),
      Paragraph.extend({
        addNodeView: () => () => {
          const dom = document.createElement('p');
          return {
            dom,
            contentDOM: dom,
            destroy: () => new Promise<void>((resolve) => retirement.pending.add(resolve)),
          };
        },
      }),
    ],
  }),
}));
function settleOne() {
  const resolve = retirement.pending.values().next().value;
  if (!resolve) throw new Error('Missing pending disposal');
  retirement.pending.delete(resolve);
  resolve();
}
const views: NoteWindowView[] = [];
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(async () => {
  for (const view of views.splice(0)) view.destroy();
  for (const resolve of retirement.pending) resolve();
  retirement.pending.clear();
  await Promise.resolve();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
function windowAt(start: number): NoteWindow {
  return {
    scope: { backendId: 'b', workspaceId: 'w', noteId: 'n', noteInstanceId: 'i' },
    sourceRevision: 'r',
    snapshotId: 's',
    sourceLength: 1000,
    range: { start, end: start + 3 },
    text: 'abc',
    context: [],
    details: {},
    mapBindings: [],
    documentEnd: false,
    cost: { sourceBytes: 3, contextBytes: 0, assemblyPeakBytes: 3 },
  } as NoteWindow;
}
function prepared() {
  let active = 0,
    peak = 0;
  const releases: ReturnType<typeof vi.fn>[] = [];
  const binds: ReturnType<typeof vi.fn>[] = [];
  const editing: NoteViewEditing = {
    bind: () => {
      throw new Error('Borrow required');
    },
    borrow: vi.fn(() => {
      active++;
      peak = Math.max(peak, active);
      const release = vi.fn(() => {
        active--;
      });
      const bind = vi.fn((_window, projection, doc) => ({
        initial: { projection, doc },
        current: () => true,
        prepare: () => undefined,
        commit: vi.fn(),
      }));
      releases.push(release);
      binds.push(bind);
      return { bind, release };
    }),
    undo: vi.fn(),
    redo: vi.fn(),
  };
  const data = [vi.fn(), vi.fn(), vi.fn()];
  const host = document.createElement('div');
  document.body.append(host);
  const view = new NoteWindowView(host, {
    seek: vi.fn(),
    selectionChanged: vi.fn(),
    fullOperation: vi.fn(),
    editing,
    retainWindow: vi
      .fn()
      .mockReturnValueOnce(data[0])
      .mockReturnValueOnce(data[1])
      .mockReturnValueOnce(data[2]),
  });
  views.push(view);
  return { view, editing, releases, binds, data, peak: () => peak };
}
it('retains both composition-pending and mounted borrows until their actual disposal', async () => {
  const f = prepared(),
    first = windowAt(100),
    second = windowAt(200);
  f.view.show(first);
  const editor = f.view.editor!;
  vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(null);
  f.view.host.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  expect(f.view.show(second)).toBe(false);
  expect(f.editing.borrow).toHaveBeenCalledTimes(2);
  expect(f.binds[1]).not.toHaveBeenCalled();
  expect(f.releases[0]).not.toHaveBeenCalled();
  f.view.host.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  await vi.waitFor(() => expect(f.view.window).toBe(second));
  expect(editor.isDestroyed).toBe(true);
  expect(f.binds[1]).toHaveBeenCalledOnce();
  expect(f.releases[0]).not.toHaveBeenCalled();
  expect(f.data[0]).not.toHaveBeenCalled();
  settleOne();
  await vi.waitFor(() => expect(f.releases[0]).toHaveBeenCalledOnce());
  expect(f.data[0]).toHaveBeenCalledOnce();
  f.view.destroy();
  expect(f.releases[1]).not.toHaveBeenCalled();
  settleOne();
  await vi.waitFor(() => expect(f.releases[1]).toHaveBeenCalledOnce());
  expect(f.data[1]).toHaveBeenCalledOnce();
});
it('releases an unmounted superseded borrow without retiring the composing view', () => {
  const f = prepared();
  f.view.show(windowAt(100));
  f.view.forceMount('composition');
  f.view.show(windowAt(200));
  f.view.show(windowAt(300));
  expect(f.binds[1]).not.toHaveBeenCalled();
  expect(f.releases[1]).toHaveBeenCalledOnce();
  expect(f.data[1]).toHaveBeenCalledOnce();
  expect(f.releases[0]).not.toHaveBeenCalled();
  expect(f.releases[2]).not.toHaveBeenCalled();
  expect(f.peak()).toBe(2);
});
it('uses a fresh borrow before remounting the same window with a replacement owner', () => {
  const f = prepared(),
    window = windowAt(100);
  f.view.show(window);
  const old = f.view.editor!;
  vi.spyOn(old.view, 'posAtCoords').mockReturnValue(null);
  const next = { ...f.editing };
  f.view.updateEditing(next);
  expect(old.isEditable).toBe(false);
  expect(f.binds[0]).toHaveBeenCalledOnce();
  f.view.show(window);
  expect(f.view.editor).not.toBe(old);
  expect(f.binds[1]).toHaveBeenCalledOnce();
  expect(f.releases[0]).not.toHaveBeenCalled();
});

it('revokes a composing owner when a read-only pending destination already cleared the desired adapter', () => {
  const f = prepared();
  f.view.show(windowAt(100));
  const old = f.view.editor!;
  f.view.forceMount('composition');
  f.view.showPrepared(windowAt(200), undefined);
  expect(old.isEditable).toBe(true);
  f.view.updateEditing(undefined);
  expect(old.isEditable).toBe(false);
  expect(f.releases[0]).not.toHaveBeenCalled();
});
