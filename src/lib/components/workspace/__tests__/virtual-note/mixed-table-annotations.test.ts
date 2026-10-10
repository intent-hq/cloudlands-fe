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

it('pages canonical comment IDs only for admitted disjoint table cells', async () => {
  const mark = (id: string, text: string) =>
    `<!--anchor:${id}:start-->${text}<!--anchor:${id}:end-->`;
  const row = (r: number) =>
    '| ' +
    Array.from({ length: 10 }, (_, c) => mark(`cmt-${r}-${c}`, `r${r}c${c} café`)).join(' | ') +
    ' |';
  const source = [
    row(0),
    '| ' + Array(10).fill('---').join(' | ') + ' |',
    ...Array.from({ length: 18 }, (_, r) => row(r + 1)),
  ].join('\n');
  const service = new SourceJournal(() => source, 1);
  service.anchors = [];
  for (let r = 0; r < 19; r++)
    for (let c = 0; c < 10; c++) service.registerComment(`cmt-${r}-${c}`);
  const session = new DocumentSession(service, document.createElement('div'));
  try {
    await session.seek(source.indexOf('r8c7'));
    expect(session.error).toBe('');
    const cells = session.projection!.table!.window.cells;
    const expected = cells.flatMap((cell) =>
      cell.runs.filter((r) => r.anchor?.type === 'start').map((r) => r.anchor!.commentId),
    );
    expect(expected.length).toBeGreaterThan(8);
    expect(expected).not.toContain('cmt-8-0');
    const actual: string[] = [];
    do {
      actual.push(...session.annotationPage!.items.map((a) => a.id));
      const next = session.annotationPage!.next;
      if (!next) break;
      expect(await session.loadAnnotations(next)).toBe(true);
    } while (true);
    expect(actual).toEqual(expected);
    const stats = session.snapshot();
    expect(stats.maxAnnotationRequestBytes).toBeLessThanOrEqual(4096);
    expect(stats.maxAnnotationPageBytes).toBeLessThanOrEqual(4096);
    expect(stats.maxTableTransferPageBytes).toBeLessThanOrEqual(4096);
    expect(stats.cacheBytes).toBeLessThanOrEqual(16384);
    expect(stats.cachePages).toBeLessThanOrEqual(4);
  } finally {
    session.destroy();
  }
});
