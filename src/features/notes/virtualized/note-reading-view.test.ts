import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, expect, it, vi } from 'vitest';
import { writable } from 'svelte/store';
import NoteReadingView from './NoteReadingView.svelte';
import { pageVisibleRangesChanged } from '$store/renderer/slices/note-pages/note-pages-slice';
const state = vi.hoisted(() => ({
  dispatch: vi.fn(),
  session: undefined as any,
  view: undefined as any,
}));
vi.mock('$store/renderer/store', () => ({ store: { dispatch: state.dispatch } }));
vi.mock('$store/renderer/slices/note-pages/note-pages-selectors', () => ({
  selectNotePageSession: () => state.session,
}));
vi.mock('./note-window-view', () => ({
  NoteWindowView: class {
    options: any;
    window: any;
    pending: any;
    constructor(_element: any, options: any) {
      this.options = options;
      state.view = this;
    }
    updateEditing(editing: any) {
      this.options.editing = editing;
    }
    show(window: any) {
      this.pending = window;
      return false;
    }
    release() {
      this.window = this.pending;
      this.options.changed?.();
    }
    destroy() {}
  },
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it('publishes newly visible annotation ranges when composition releases a queued window', async () => {
  const window = { range: { start: 2_000_000, end: 2_000_500 } };
  state.session = writable({ windows: { panel: { value: window } } });
  render(NoteReadingView, {
    workspaceId: 'w',
    noteId: 'n',
    panelId: 'panel',
    onFullOperation: vi.fn(),
  });
  await waitFor(() => expect(state.view?.pending).toBe(window));
  state.dispatch.mockClear();
  state.view.release();
  expect(state.dispatch).toHaveBeenCalledWith(
    pageVisibleRangesChanged('w', 'n', 'panel', [window.range]),
  );
});

it('keeps the composing native view when workspace metadata or the editing adapter changes', async () => {
  state.session = writable({
    windows: { panel: { value: { range: { start: 2_000_000, end: 2_000_500 } } } },
  });
  const editing = { accept: vi.fn(), undo: vi.fn(), redo: vi.fn() };
  const component = render(NoteReadingView, {
    workspaceId: 'w',
    workspace: { id: 'w' } as any,
    noteId: 'n',
    panelId: 'panel',
    editing,
    onFullOperation: vi.fn(),
  });
  await waitFor(() => expect(state.view?.pending).toBeDefined());
  const original = state.view;
  const replacement = { accept: vi.fn(), undo: vi.fn(), redo: vi.fn() };
  await component.rerender({
    workspace: { id: 'w', name: 'Renamed' } as any,
    editing: replacement,
  });
  expect(state.view).toBe(original);
  expect(state.view.options.editing).toBe(replacement);
});
