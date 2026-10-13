import type { Workspace } from '$shared/types';
import { NoteWindowView } from '../note-window-view';
import { NoteCanonicalProjection } from '../note-canonical-projection';
import { mountDenseMarkdownFixture } from './dense-window-fixture';
import { storeTableFixture } from './store-table-fixture';
import { canonicalTableFixture } from './canonical-table-fixture';
export function mountCanonicalTableFixture(
  root: HTMLDivElement,
  scroller: HTMLDivElement,
  status: (value: string) => void,
  storeRole?: 'td' | 'th',
  denseMarkdown = false,
) {
  if (denseMarkdown) return mountDenseMarkdownFixture(root, scroller, status);
  let disposed = false;
  const seeks: number[] = [];
  const view = new NoteWindowView(scroller, {
    workspace: { id: 'w' } as Workspace,
    seek: (at) => seeks.push(at),
    selectionChanged: () => {},
    fullOperation: () => {},
  });
  void (storeRole ? Promise.resolve(storeTableFixture(storeRole)) : canonicalTableFixture('th'))
    .then(async (fixture) => {
      const window = await fixture.read();
      if (disposed) return;
      view.show(window);
      view.reveal(fixture.at);
      Object.assign(root, {
        view,
        read: () => ({
          cost: view.cost,
          windowCost: window.cost,
          at: fixture.at,
          range: view.window?.range,
          requests: fixture.requests.length,
          sourceReads: fixture.requests.filter((q) => q.kind === 'source'),
          sourceLength: fixture.sourceLength,
          seeks,
          entries: (view.projection as NoteCanonicalProjection).nativeEntries,
        }),
        geometry: () => {
          const rect = view.editor!.view.coordsAtPos(view.projection!.pmAt(fixture.at));
          const viewport = scroller.getBoundingClientRect();
          return {
            top: rect.top,
            bottom: rect.bottom,
            viewportTop: viewport.top,
            viewportBottom: viewport.bottom,
          };
        },
      });
      status('ready');
    })
    .catch((error) => {
      Object.assign(root, { error: String(error) });
      status('error');
    });
  return () => {
    disposed = true;
    view.destroy();
  };
}
