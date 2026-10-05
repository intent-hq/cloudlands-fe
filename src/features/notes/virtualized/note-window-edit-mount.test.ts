import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import StarterKit from '@tiptap/starter-kit';
import { NoteWindowView, type NoteViewEditing } from './note-window-view';
import type { NoteWindow } from './note-window-reader';
import { SourceProjection } from './projection/source-projection';

// Keep actual TipTap application/mounting and the production view. Other editor
// extensions are unrelated to installing a document owner's initial state.
vi.mock('$lib/utils/editor-config', () => ({
  createEditorConfig: () => ({ extensions: [StarterKit] }),
}));
const views: NoteWindowView[] = [];
beforeEach(() => {
  // jsdom has no resize observer; these controls make no geometry claims.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
function windowAt(start = 100): NoteWindow {
  return {
    scope: { backendId: 'b', workspaceId: 'w', noteId: 'n', noteInstanceId: 'i' },
    sourceRevision: 'r1',
    snapshotId: 'snap',
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
function viewWith(editing: NoteViewEditing) {
  const scroller = document.createElement('div');
  document.body.append(scroller);
  const view = new NoteWindowView(scroller, {
    seek: vi.fn(),
    selectionChanged: vi.fn(),
    fullOperation: vi.fn(),
    editing,
  });
  views.push(view);
  return view;
}
it('mounts the materialized document and matching map without a synthetic edit', () => {
  const commit = vi.fn(),
    prepare = vi.fn();
  const projection = new SourceProjection('aXbc', 100);
  const view = viewWith({
    bind: (_window, _base, doc) => ({
      initial: { doc: doc.type.schema.nodeFromJSON(projection.content), projection },
      current: () => true,
      prepare,
      commit,
    }),
    undo: vi.fn(),
    redo: vi.fn(),
  });
  expect(view.show(windowAt())).toBe(true);
  expect(view.editor?.state.doc.textContent).toBe('aXbc');
  expect(view.host.textContent).toBe('aXbc');
  expect(view.projection).toBe(projection);
  expect(view.projection?.sourceAt(3)).toBe(102);
  expect(prepare).not.toHaveBeenCalled();
  expect(commit).not.toHaveBeenCalled();
});
it('rejects a stale or mismatched initial owner before replacing the existing view', () => {
  let stale = false;
  const view = viewWith({
    bind: (_window, projection, doc) => ({
      initial: { doc, projection },
      current: () => !stale,
      prepare: vi.fn(),
      commit: vi.fn(),
    }),
    undo: vi.fn(),
    redo: vi.fn(),
  });
  view.show(windowAt());
  const original = view.editor;
  // No hit-testing/scroll oracle is asserted in jsdom.
  vi.spyOn(original!.view, 'posAtCoords').mockReturnValue(null);
  stale = true;
  expect(() => view.show(windowAt(200))).toThrow('Invalid initial note edit authority');
  expect(view.editor).toBe(original);
  expect(view.host.textContent).toBe('abc');
});
