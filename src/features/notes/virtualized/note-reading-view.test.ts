import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, expect, it, vi } from 'vitest';
import { writable } from 'svelte/store';
import NoteReadingView from './NoteReadingView.svelte';
import {
  pageVisibleRangesChanged,
  pageWindowRequested,
} from '$store/renderer/slices/note-pages/note-pages-slice';
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
    updateReadStatus(_available: boolean, _loading: boolean, _failed: boolean) {}
    updateEditing(editing: any) {
      this.options.editing = editing;
    }
    showPrepared(window: any, editing: any) {
      this.updateEditing(editing);
      return this.show(window);
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

it('requests only an absent window, without retrying loading or failed demand', async () => {
  const ready = {
    status: 'ready',
    panels: { panel: [] },
    windows: { panel: { loading: true, value: null } },
  };
  state.session = writable(ready);
  render(NoteReadingView, {
    workspaceId: 'w',
    noteId: 'n',
    panelId: 'panel',
    ownsPanel: false,
    onFullOperation: vi.fn(),
  });
  await waitFor(() => expect(state.view).toBeDefined());
  expect(state.dispatch).not.toHaveBeenCalledWith(pageWindowRequested('w', 'n', 'panel', 0));
  state.session.set({ ...ready, windows: {} });
  await waitFor(() =>
    expect(state.dispatch).toHaveBeenCalledWith(pageWindowRequested('w', 'n', 'panel', 0)),
  );
  state.dispatch.mockClear();
  state.session.set({
    ...ready,
    windows: { panel: { loading: false, value: null, error: 'failed' } },
  });
  await waitFor(() => expect(document.querySelector('[role="alert"]')).not.toBeNull());
  expect(state.dispatch).not.toHaveBeenCalled();
});
it('publishes newly visible annotation ranges when composition releases a queued window', async () => {
  const window = { range: { start: 2_000_000, end: 2_000_500 } };
  state.session = writable({
    status: 'ready',
    panels: { panel: {} },
    windows: { panel: { value: window } },
  });
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
    status: 'ready',
    panels: { panel: {} },
    windows: { panel: { value: { range: { start: 2_000_000, end: 2_000_500 } } } },
  });
  const editing = { bind: vi.fn(), undo: vi.fn(), redo: vi.fn() };
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
  const replacement = { bind: vi.fn(), undo: vi.fn(), redo: vi.fn() };
  await component.rerender({
    workspace: { id: 'w', name: 'Renamed' } as any,
    editing: replacement,
  });
  expect(state.view).toBe(original);
  expect(state.view.options.editing).toBe(replacement);
});

it('suspends editing and exposes session failure without destroying the retained composing view', async () => {
  const ready = {
    status: 'ready',
    panels: { panel: {} },
    windows: { panel: { value: { range: { start: 0, end: 100 } } } },
  };
  state.session = writable(ready);
  const editing = { bind: vi.fn(), undo: vi.fn(), redo: vi.fn() };
  const component = render(NoteReadingView, {
    workspaceId: 'w',
    noteId: 'n',
    panelId: 'panel',
    editing,
    onFullOperation: vi.fn(),
  });
  await waitFor(() => expect(state.view?.options.editing).toBe(editing));
  const original = state.view;
  state.session.set({ status: 'connecting', panels: { panel: {} }, windows: {} });
  await waitFor(() => expect(state.view.options.editing).toBeUndefined());
  expect(component.container.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(state.view).toBe(original);
  state.session.set({ status: 'deleted', panels: { panel: {} }, windows: {} });
  expect(await component.findByRole('alert')).toBeTruthy();
  state.session.set(ready);
  await waitFor(() => expect(state.view.options.editing).toBe(editing));
  expect(state.view).toBe(original);
});

it('exposes a retired native transaction failure without clearing the document session', async () => {
  const ready = {
    status: 'ready',
    panels: { panel: {} },
    windows: { panel: { value: { range: { start: 0, end: 100 } } } },
  };
  state.session = writable(ready);
  const component = render(NoteReadingView, {
    workspaceId: 'w',
    noteId: 'n',
    panelId: 'panel',
    onFullOperation: vi.fn(),
  });
  await waitFor(() => expect(state.view?.pending).toBeDefined());
  state.dispatch.mockClear();
  state.view.options.failed();
  expect(await component.findByRole('alert')).toBeTruthy();
  expect(state.dispatch).not.toHaveBeenCalled();
});

it('waits for prepared edit context before showing a window and ignores superseded preparation', async () => {
  const first = { range: { start: 10, end: 20 } },
    second = { range: { start: 30, end: 40 } };
  state.session = writable({
    status: 'ready',
    panels: { panel: {} },
    windows: { panel: { value: first } },
  });
  const offers = [first, second].map(() => {
    let resolve!: (editing: {
      bind: ReturnType<typeof vi.fn>;
      undo: ReturnType<typeof vi.fn>;
      redo: ReturnType<typeof vi.fn>;
    }) => void;
    const ready = new Promise<Parameters<typeof resolve>[0]>((done) => {
      resolve = done;
    });
    return { ready, resolve, cancel: vi.fn(), release: vi.fn(async () => {}) };
  });
  const prepareEditing = vi.fn().mockReturnValueOnce(offers[0]).mockReturnValueOnce(offers[1]);
  const component = render(NoteReadingView, {
    workspaceId: 'w',
    noteId: 'n',
    panelId: 'panel',
    onFullOperation: vi.fn(),
    prepareEditing,
  });
  await waitFor(() => expect(prepareEditing).toHaveBeenCalledExactlyOnceWith(first));
  expect(state.view.pending).toBeUndefined();
  state.session.set({
    status: 'ready',
    panels: { panel: {} },
    windows: { panel: { value: second } },
  });
  await waitFor(() => expect(prepareEditing).toHaveBeenCalledTimes(2));
  expect(offers[0].cancel).toHaveBeenCalledOnce();
  expect(offers[0].release).toHaveBeenCalledOnce();
  const old = { bind: vi.fn(), undo: vi.fn(), redo: vi.fn() };
  offers[0].resolve(old);
  await Promise.resolve();
  expect(state.view.pending).toBeUndefined();
  const next = { bind: vi.fn(), undo: vi.fn(), redo: vi.fn() };
  offers[1].resolve(next);
  await waitFor(() => expect(state.view.pending).toBe(second));
  expect(state.view.options.editing).toBe(next);
  expect(offers[1].release).not.toHaveBeenCalled();
  await component.unmount();
  expect(offers[1].cancel).toHaveBeenCalledOnce();
  expect(offers[1].release).toHaveBeenCalledOnce();
});

it('shows a current unsupported-edit outcome read-only', async () => {
  const window = { range: { start: 17, end: 20 } };
  state.session = writable({
    status: 'ready',
    panels: { panel: {} },
    windows: { panel: { value: window } },
  });
  render(NoteReadingView, {
    workspaceId: 'w',
    noteId: 'n',
    panelId: 'panel',
    onFullOperation: vi.fn(),
    prepareEditing: () => ({
      ready: Promise.resolve(undefined),
      cancel: vi.fn(),
      release: async () => {},
    }),
  });
  await waitFor(() => expect(state.view.pending).toBe(window));
  expect(state.view.options.editing).toBeUndefined();
});
it.each(['synchronous', 'asynchronous'])(
  'contains %s preparation failure without treating it as read-only eligibility',
  async (kind) => {
    const window = { range: { start: 17, end: 20 } };
    state.session = writable({
      status: 'ready',
      panels: { panel: {} },
      windows: { panel: { value: window } },
    });
    const component = render(NoteReadingView, {
      workspaceId: 'w',
      noteId: 'n',
      panelId: 'panel',
      onFullOperation: vi.fn(),
      prepareEditing: () => {
        if (kind === 'synchronous') throw new Error('Budget exhausted');
        return {
          ready: Promise.reject(new Error('Stale source')),
          cancel: vi.fn(),
          release: async () => {},
        };
      },
    });
    expect(await component.findByRole('alert')).toBeTruthy();
    expect(state.view.pending).toBeUndefined();
  },
);

it('retires delivered preparation on navigation and cancels an undelivered successor on unmount', async () => {
  const first = { range: { start: 100, end: 103 } };
  const next = { range: { start: 200, end: 203 } };
  state.session = writable({
    status: 'ready',
    panels: { panel: {} },
    windows: { panel: { value: first } },
  });
  const delivered = {
    ready: Promise.resolve({ bind: vi.fn(), undo: vi.fn(), redo: vi.fn() }),
    cancel: vi.fn(),
    release: vi.fn(async () => {}),
    retire: vi.fn(async () => {}),
  };
  const pending = {
    ready: new Promise<undefined>(() => {}),
    cancel: vi.fn(),
    release: vi.fn(async () => {}),
    retire: vi.fn(async () => {}),
  };
  const prepare = vi.fn().mockReturnValueOnce(delivered).mockReturnValueOnce(pending);
  const component = render(NoteReadingView, {
    workspaceId: 'w',
    noteId: 'n',
    panelId: 'panel',
    onFullOperation: vi.fn(),
    prepareEditing: prepare,
  });
  await waitFor(() => expect(state.view.pending).toBe(first));
  state.session.set({
    status: 'ready',
    panels: { panel: {} },
    windows: { panel: { value: next } },
  });
  await waitFor(() => expect(prepare).toHaveBeenCalledTimes(2));
  expect(delivered.retire).toHaveBeenCalledOnce();
  expect(delivered.cancel).not.toHaveBeenCalled();
  expect(delivered.release).not.toHaveBeenCalled();
  component.unmount();
  expect(pending.cancel).toHaveBeenCalledOnce();
  expect(pending.release).toHaveBeenCalledOnce();
  expect(pending.retire).not.toHaveBeenCalled();
});
