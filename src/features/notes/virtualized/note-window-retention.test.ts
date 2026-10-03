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
