import { afterEach, expect, it, vi } from 'vitest';
import { NotePageReader } from '$lib/client/note-page-reader';
import type { NotePageRequest } from '$lib/client/note-pages';
import { NoteWindowView } from '$features/notes/virtualized/note-window-view';
import { projectNoteWindow } from '$features/notes/virtualized/note-window-projection';
import { readNoteWindow } from '$features/notes/virtualized/note-window-reader';
import { fullNotePageFixture } from './mocks/full-note-page-fixture';

afterEach(() => vi.unstubAllGlobals());

it('assembles the normal tab canonical wire fixture at the beginning and after seeking', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  const source = 'bounded viewing '.repeat(20000);
  const identity = {
    scope: { backendId: 'ct-reader', workspaceId: 'ws', noteId: 'note', noteInstanceId: 'i' },
    sourceRevision: 'r4',
    snapshotId: 's4',
    expiresAt: '2099-01-01T00:00:00Z',
  };
  const reader = new NotePageReader(async (_method, params) =>
    fullNotePageFixture(params.page as NotePageRequest, source, identity),
  );
  for (const at of [0, 16000]) {
    const window = await readNoteWindow((q) => reader.read('ws', 'note', q), { ...identity, at });
    expect(window.text).toBe(source.slice(at, window.range.end));
    expect(window.native?.texts).toBeDefined();
    expect(projectNoteWindow(window).content).toBeDefined();
    const host = document.createElement('div');
    document.body.append(host);
    const fullOperation = vi.fn();
    const view = new NoteWindowView(host, {
      seek() {},
      selectionChanged() {},
      fullOperation,
    });
    try {
      expect(view.show(window)).toBe(true);
      const editor = view.editor!.view.dom;
      expect(editor.tabIndex).toBe(0);
      editor.focus();
      expect(document.activeElement).toBe(editor);
      editor.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }),
      );
      expect(fullOperation).toHaveBeenCalledWith('search', expect.any(Object));
    } finally {
      view.destroy();
      host.remove();
    }
  }
});
