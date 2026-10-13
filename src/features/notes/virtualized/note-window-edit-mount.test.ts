import { EditorView } from '@tiptap/pm/view';
import { noteDocumentCoordinates } from './editing/note-document-coordinates';
import { createNoteDocumentSession } from './editing/note-document-edit-session';
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
function viewWith(editing: NoteViewEditing, seek = vi.fn(), fullOperation = vi.fn()) {
  const scroller = document.createElement('div');
  document.body.append(scroller);
  const view = new NoteWindowView(scroller, {
    seek,
    selectionChanged: vi.fn(),
    fullOperation,
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

it('uses materialized current coordinates for selection, copy, select-all and base-revision seeks', () => {
  const state = createNoteDocumentSession(windowAt().scope, 'r1', 10000);
  state.dirty = [{ start: 1, end: 1, text: 'XXX' }];
  state.length = 10003;
  const projection = new SourceProjection('abc', 703);
  const coordinates = noteDocumentCoordinates(state, projection);
  const seek = vi.fn(),
    fullOperation = vi.fn();
  const view = viewWith(
    {
      bind: (_window, _base, doc) => ({
        initial: { doc: doc.type.schema.nodeFromJSON(projection.content), projection, coordinates },
        current: () => true,
        prepare: vi.fn(),
        commit: vi.fn(),
      }),
      undo: vi.fn(),
      redo: vi.fn(),
    },
    seek,
    fullOperation,
  );
  view.show({ ...windowAt(700), sourceLength: 10000 });
  view.setSelection({ anchor: 704, head: 705, anchorAffinity: 1, headAffinity: 1 });
  expect(seek).not.toHaveBeenCalled();
  expect(view.editor?.state.selection.from).toBe(2);
  const copy = new Event('copy', { bubbles: true, cancelable: true });
  view.host.dispatchEvent(copy);
  expect(copy.defaultPrevented).toBe(false);
  view.reveal(9003);
  expect(seek).toHaveBeenLastCalledWith(7976);
  view.scroller.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }),
  );
  expect(view.getSelection()).toEqual({
    anchor: 0,
    head: 10003,
    anchorAffinity: 1,
    headAffinity: 1,
  });
  expect(fullOperation).toHaveBeenLastCalledWith('selectAll', view.getSelection());
  const allCopy = new Event('copy', { bubbles: true, cancelable: true });
  view.host.dispatchEvent(allCopy);
  expect(allCopy.defaultPrevented).toBe(true);
  expect(fullOperation).toHaveBeenLastCalledWith('copy', view.getSelection());
});

it('preserves backward selection affinity when a seek falls on deleted source', () => {
  const state = createNoteDocumentSession(windowAt().scope, 'r1', 4000);
  state.dirty = [{ start: 900, end: 1050, text: '' }];
  state.length = 3850;
  const projection = new SourceProjection('abc', 100);
  const seek = vi.fn();
  const view = viewWith(
    {
      bind: (_window, _base, doc) => ({
        initial: {
          doc: doc.type.schema.nodeFromJSON(projection.content),
          projection,
          coordinates: noteDocumentCoordinates(state, projection),
        },
        current: () => true,
        prepare: vi.fn(),
        commit: vi.fn(),
      }),
      undo: vi.fn(),
      redo: vi.fn(),
    },
    seek,
  );
  view.show({ ...windowAt(), sourceLength: 4000 });
  view.setSelection({ anchor: 1924, head: 1924, anchorAffinity: -1, headAffinity: -1 });
  expect(seek).toHaveBeenLastCalledWith(900);
  view.setSelection({ anchor: 1924, head: 1924, anchorAffinity: 1, headAffinity: 1 });
  expect(seek).toHaveBeenLastCalledWith(1050);
});

it('remounts the base window selected by a current-document seek with its shifted map', () => {
  const state = createNoteDocumentSession(windowAt().scope, 'r1', 10000);
  state.dirty = [{ start: 1, end: 1, text: 'XXX' }];
  state.length = 10003;
  const seek = vi.fn();
  const view = viewWith(
    {
      bind: (window, _base, doc) => {
        const projection = new SourceProjection(window.text, window.range.start + 3);
        return {
          initial: {
            doc: doc.type.schema.nodeFromJSON(projection.content),
            projection,
            coordinates: noteDocumentCoordinates(state, projection),
          },
          current: () => true,
          prepare: vi.fn(),
          commit: vi.fn(),
        };
      },
      undo: vi.fn(),
      redo: vi.fn(),
    },
    seek,
  );
  view.show({ ...windowAt(700), sourceLength: 10000 });
  vi.spyOn(view.editor!.view, 'posAtCoords').mockReturnValue(null);
  view.setSelection({ anchor: 9003, head: 9003, anchorAffinity: 1, headAffinity: 1 });
  const base = seek.mock.lastCall?.[0];
  expect(base).toBe(7976);
  // Controlled bounded source response covers the originally requested selection.
  // Mock geometry only to allow jsdom's public view operation; no layout proof.
  const coords = vi
    .spyOn(EditorView.prototype, 'coordsAtPos')
    .mockReturnValue({ left: 0, right: 0, top: 0, bottom: 0 });
  try {
    const text = 'a'.repeat(1100);
    const loaded = {
      ...windowAt(base),
      text,
      range: { start: base, end: base + text.length },
      sourceLength: 10000,
      cost: { sourceBytes: 1100, contextBytes: 0, assemblyPeakBytes: 1100 },
    };
    expect(view.show(loaded)).toBe(true);
    expect(view.window?.range.start).toBe(7976);
    expect(view.projection?.start).toBe(7979);
    expect(view.getSelection()).toEqual({
      anchor: 9003,
      head: 9003,
      anchorAffinity: 1,
      headAffinity: 1,
    });
    expect(view.editor?.state.selection.head).toBe(1025);
    expect(view.projection?.sourceAt(view.editor!.state.selection.head)).toBe(9003);
    expect(seek).toHaveBeenCalledOnce();
    expect(view.host.textContent).toBe(text);
  } finally {
    coords.mockRestore();
  }
});
