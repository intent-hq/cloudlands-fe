import { afterAll, beforeAll, expect, it } from 'vitest';
import { store } from '$store/renderer/configured-store';
import { DocumentSession } from './document-session';
import { SourceJournal } from './source-journal';

beforeAll(() => store.init());
afterAll(() => store.dispose());

it('queries and decorates disjoint admitted table cells without annotations in hidden columns', async () => {
  const row = (r: number) =>
    '| ' + Array.from({ length: 10 }, (_, c) => `row${r}col${c} café repeated`).join(' | ') + ' |';
  const source = [
    row(0),
    '| ' + Array(10).fill('---').join(' | ') + ' |',
    ...Array.from({ length: 18 }, (_, r) => row(r + 1)),
  ].join('\n');
  const service = new SourceJournal(() => source, 1);
  service.anchors = [];
  const session = new DocumentSession(service, document.createElement('div'));
  try {
    await session.seek(source.indexOf('row8col7'));
    const cells = session.projection!.table!.window.cells;
    const last = cells.at(-1)!;
    const hidden = source.indexOf('row8col0');
    expect(cells.some((c) => c.first <= hidden && c.last > hidden)).toBe(false);
    expect(hidden).toBeGreaterThan(cells[0].first);
    expect(hidden).toBeLessThan(last.last);
    service.replaceAttribution(service.revision, service.generation, [
      { id: 'visible-last', from: last.first, to: last.last, alive: true, authorId: 'agent-1' },
      {
        id: 'hidden-gap',
        from: hidden,
        to: hidden + 'row8col0'.length,
        alive: true,
        authorId: 'agent-2',
      },
      {
        id: 'outside-start',
        from: cells[0].first - 20,
        to: last.last,
        alive: true,
        authorId: 'agent-3',
      },
    ]);
    await session.loadAnnotations();
    expect(session.annotationPage!.items.map((a) => a.id)).toEqual([
      'visible-last',
      'outside-start',
    ]);
    const dom = session.editor!.view.dom;
    expect(dom.querySelector('[data-proof-attribution="visible-last"]')?.textContent).toBe(
      last.runs.map((r) => r.text).join(''),
    );
    expect(dom.querySelector('[data-proof-attribution="hidden-gap"]')).toBeNull();
    expect(dom.querySelectorAll('[data-proof-attribution="outside-start"]').length).toBeGreaterThan(
      1,
    );
    expect(session.snapshot().cacheBytes).toBeLessThanOrEqual(16384);
    expect(session.snapshot().maxAnnotationPageBytes).toBeLessThanOrEqual(4096);
  } finally {
    session.destroy();
  }
});
