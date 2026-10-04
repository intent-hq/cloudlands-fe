import { afterEach, expect, it, vi } from 'vitest';
import { NoteWindowView } from './note-window-view';
import type { NoteWindow } from './note-window-reader';
const views: NoteWindowView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  vi.unstubAllGlobals();
});
it('keeps a pending window mounted until every independent owner releases, once each', () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  const view = new NoteWindowView(document.createElement('div'), {
    seek: vi.fn(),
    selectionChanged: vi.fn(),
    fullOperation: vi.fn(),
  });
  views.push(view);
  const releaseFocus = view.forceMount('focus');
  const releaseSecondFocus = view.forceMount('focus');
  const releaseSelection = view.forceMount('selection');
  const pending = {
    cost: { sourceBytes: 10, contextBytes: 10 },
    scope: {},
    sourceRevision: 'r',
    snapshotId: 's',
  } as NoteWindow;
  expect(view.show(pending)).toBe(false);
  const show = vi.spyOn(view, 'show').mockReturnValue(true);
  releaseFocus();
  releaseFocus();
  releaseSelection();
  expect(show).not.toHaveBeenCalled();
  releaseSecondFocus();
  expect(show).toHaveBeenCalledExactlyOnceWith(pending);
  releaseSecondFocus();
  expect(show).toHaveBeenCalledTimes(1);
});

it('retains a pinned window until it is replaced or its actual view is destroyed', () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  const releaseFirst = vi.fn(),
    releaseSecond = vi.fn();
  const retainWindow = vi.fn().mockReturnValueOnce(releaseFirst).mockReturnValueOnce(releaseSecond);
  const view = new NoteWindowView(document.createElement('div'), {
    seek: vi.fn(),
    selectionChanged: vi.fn(),
    fullOperation: vi.fn(),
    retainWindow,
  });
  views.push(view);
  view.forceMount('composition');
  const first = { cost: { sourceBytes: 10, contextBytes: 0 } } as NoteWindow;
  const second = { cost: { sourceBytes: 20, contextBytes: 0 } } as NoteWindow;
  view.show(first);
  expect(retainWindow).toHaveBeenCalledExactlyOnceWith(first);
  view.show(first);
  expect(retainWindow).toHaveBeenCalledTimes(1);
  expect(releaseFirst).not.toHaveBeenCalled();
  view.show(second);
  expect(releaseFirst).toHaveBeenCalledTimes(1);
  expect(releaseSecond).not.toHaveBeenCalled();
  view.destroy();
  expect(releaseSecond).toHaveBeenCalledTimes(1);
});

it('releases a superseded composition candidate when a different replacement fails', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  const releasePending = vi.fn(),
    releaseReplacement = vi.fn(),
    destroy = vi.fn();
  const retainWindow = vi
    .fn()
    .mockReturnValueOnce(releasePending)
    .mockReturnValueOnce(releaseReplacement);
  const view = new NoteWindowView(document.createElement('div'), {
    seek: vi.fn(),
    selectionChanged: vi.fn(),
    fullOperation: vi.fn(),
    retainWindow,
  });
  views.push(view);
  const editor = { view: { composing: true }, destroy } as unknown as NonNullable<
    NoteWindowView['editor']
  >;
  view.editor = editor;
  const pending = { cost: { sourceBytes: 10, contextBytes: 0 } } as NoteWindow;
  view.show(pending);
  Object.assign(editor.view, { composing: false });
  const unsupported = {
    context: [{ kind: 'boundary', construct: 'unsupported' }],
  } as unknown as NoteWindow;
  expect(() => view.show(unsupported)).toThrow('Unsupported note construct');
  await Promise.resolve();
  expect(view.editor).toBe(editor);
  expect(destroy).not.toHaveBeenCalled();
  expect(releasePending).toHaveBeenCalledOnce();
  expect(releaseReplacement).toHaveBeenCalledOnce();
});
