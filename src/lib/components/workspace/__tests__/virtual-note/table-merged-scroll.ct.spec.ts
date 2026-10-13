import { test, expect } from '../../../../../test/ct-test';
import Pair from './ParagraphProofHarness.svelte';
import { settled, type Host } from './paragraph-browser';
import type { SourceJournal } from './source-journal';
import type { DocumentSession } from './document-session';
import type { TableIndex } from './table-source';

test('ordinary scrolling exposes later merged paragraphs and returns to the origin', async ({
  mount,
  page,
}, info) => {
  const source =
    '| H | R |\n| --- | --- |\n' +
    Array.from({ length: 120 }, (_, r) => `| left${r} | right${r} |`).join('\n');
  await mount(Pair, { props: { sourceOverride: source } });
  const fixture = await page.evaluate(async () => {
    const host = (side: string) =>
      document.querySelector(`[data-testid="${side}"] [data-testid="proof"]`) as Host;
    const native = host('native').native;
    const cells: number[] = [];
    native.state.doc.descendants((node, pos) => {
      if (node.type.name === 'tableCell' && node.textContent.startsWith('left')) cells.push(pos);
    });
    native.commands.setCellSelection({ anchorCell: cells[0], headCell: cells.at(-1)! });
    if (!native.commands.mergeCells()) throw new Error('Native merged fixture failed');
    const saved = (host('native') as Host & { nativeMarkdown(): string }).nativeMarkdown();
    const old = host('bounded').proof;
    // Fixture setup is full native oracle/backing state, not a bounded merge claim.
    const service = new (old.service.constructor as typeof SourceJournal)(() => saved, 1);
    const backing = service as unknown as {
      tableIndex(source: string, start: number): TableIndex[];
      tableStates: Map<string, string>;
    };
    const raw = backing.tableIndex(saved, 0)[0];
    native.state.doc.firstChild!.forEach((row, _p, r) =>
      row.forEach((cell, _q, c) => {
        backing.tableStates.set(`cell:${raw.rows[r].cells[c].from}`, JSON.stringify(cell.toJSON()));
      }),
    );
    const fixtureBytes = new TextEncoder().encode(JSON.stringify([...backing.tableStates])).length;
    old.destroy();
    const p = new (old.constructor as typeof DocumentSession)(
      service,
      host('bounded').querySelector('[data-testid="editor-host"]')!,
    );
    host('bounded').proof = p;
    await p.seek(saved.indexOf('left0'));
    return {
      saved,
      fixtureBytes,
      paragraphs: native.state.doc.firstChild!.child(1).firstChild!.childCount,
    };
  });
  const root = page.getByTestId('bounded').getByTestId('proof');
  const visits = [];
  for (const fraction of [0, 0.5, 1, 0]) {
    await root.evaluate((el, fraction) => {
      const scroll = el.querySelector('[data-testid="editor-host"]')!.parentElement!;
      scroll.scrollTop = (scroll.scrollHeight - scroll.clientHeight) * fraction;
    }, fraction);
    await settled(page);
    const visit = await root.evaluate((el) => {
      const p = (el as Host).proof,
        editor = p.editor!;
      const scroll = el.querySelector('[data-testid="editor-host"]')!.parentElement!;
      const viewport = scroll.getBoundingClientRect();
      const owner = p.projection!.table!.entries.find((e) => e.cell.owner);
      const dom = owner && (editor.view.nodeDOM(owner.pm) as HTMLElement | undefined);
      const paragraphs = Array.from(dom?.querySelectorAll('p') ?? []).map((node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        const rect = range.getBoundingClientRect();
        return {
          text: node.textContent,
          top: rect.top - viewport.top,
          bottom: rect.bottom - viewport.top,
        };
      });
      return {
        error: p.error,
        source: p.service.region(0),
        paragraphs,
        visible: paragraphs
          .filter((p) => p.bottom > 0 && p.top < scroll.clientHeight)
          .map((p) => p.text),
        stats: p.snapshot(),
        top: scroll.scrollTop,
        height: scroll.scrollHeight,
      };
    });
    visits.push({ fraction, ...visit });
    await info.attach(`merged-scroll-${visits.length}.json`, {
      body: JSON.stringify({ fixture, visit }),
      contentType: 'application/json',
    });
    expect(visit.error).toBe('');
    expect(visit.source).toBe(fixture.saved);
    expect(visit.visible.length).toBeGreaterThan(0);
    expect(visit.stats.maxSourceContextBytes).toBeLessThanOrEqual(16384);
    expect(visit.stats.maxTableTransferPageBytes).toBeLessThanOrEqual(4096);
    expect(visit.stats.cachePages).toBeLessThanOrEqual(4);
    expect(visit.stats.cacheBytes).toBeLessThanOrEqual(16384);
    expect(visit.stats.pmNodes).toBeLessThanOrEqual(4096);
    if (fraction === 0) expect(visit.visible).toContain('left0');
    if (fraction === 0.5)
      expect(visit.visible.some((text) => Number(text!.slice(4)) >= 40)).toBe(true);
    if (fraction === 1) expect(visit.visible).toContain('left119');
  }
  expect(fixture.paragraphs).toBe(120);
});
