import type { Workspace } from '$shared/types';
import { NoteWindowView } from '../note-window-view';
import type { NoteWindow } from '../note-window-reader';
import { storeDenseMarkdownFixture } from './store-dense-markdown-fixture';

export function mountDenseMarkdownFixture(
  root: HTMLDivElement,
  scroller: HTMLDivElement,
  status: (value: string) => void,
) {
  const fixture = storeDenseMarkdownFixture();
  let disposed = false;
  let window: NoteWindow | undefined;
  let windowRequests = 0;
  let growthDeclined = 0;
  const attempts: Array<{ at: number; requests: number; minimumEnd?: number }> = [];
  const read = async (at: number, minimumEnd?: number) => {
    const start = fixture.requests.length;
    try {
      return await fixture.read(() => !disposed, at, minimumEnd);
    } finally {
      attempts.push({ at, minimumEnd, requests: fixture.requests.length - start });
    }
  };
  const fail = (error: unknown) => {
    if (disposed) return;
    Object.assign(root, { error: String(error) });
    status('error');
  };
  const view = new NoteWindowView(scroller, {
    workspace: { id: fixture.identity.scope.workspaceId } as Workspace,
    seek: (at) => void load(at),
    selectionChanged: () => {},
    fullOperation: () => {},
    grow: (prefix, minimumEnd) => {
      view.updateReadStatus(true, true, false);
      void read(prefix.range.start, minimumEnd)
        .then((candidate) => {
          if (disposed) return;
          if (candidate.range.end <= prefix.range.end) {
            growthDeclined++;
            view.updateReadStatus(true, false, true);
          } else {
            window = candidate;
            view.show(candidate);
            view.updateReadStatus(true, false, false);
          }
        })
        .catch(fail);
      return true;
    },
  });
  async function load(at: number) {
    view.updateReadStatus(true, true, false);
    try {
      const candidate = await read(at);
      if (disposed) return;
      windowRequests = attempts.at(-1)!.requests;
      window = candidate;
      view.show(candidate);
      view.updateReadStatus(true, false, false);
      status('ready');
    } catch (error) {
      fail(error);
    }
  }
  Object.assign(root, {
    view,
    read: () => ({
      range: window?.range,
      cost: view.cost,
      windowCost: window?.cost,
      requests: windowRequests,
      sourceLength: fixture.sourceLength,
      growthDeclined,
      attempts,
    }),
  });
  void load(0);
  return () => {
    disposed = true;
    view.destroy();
  };
}
