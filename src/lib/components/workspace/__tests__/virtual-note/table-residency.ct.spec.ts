import { test, expect } from '../../../../../test/ct-test';
import Harness from './DocumentProofHarness.svelte';
import { settled, type Host } from './paragraph-browser';

for (const repeats of [1500, 6000])
  test(`dense table resources plateau across repeated scroll visits (${repeats} backing repeats)`, async ({
    mount,
    page,
  }, info) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const source =
      '| H |\n| --- |\n| CELL_START ' +
      '**bold** _italic_ `code` \\| \\\\ '.repeat(repeats) +
      ' CELL_END |';
    await mount(Harness, { props: { sourceOverride: source } });
    const root = page.getByTestId('proof');
    await expect(root.locator('.tiptap')).toHaveCount(1);
    const visits = [];
    for (let cycle = 0; cycle < 3; cycle++) {
      const frames = [];
      for (const fraction of [0.5, 1, 0]) {
        await root.evaluate((el, fraction) => {
          const scroller = el.querySelector('[data-testid="editor-host"]')!.parentElement!;
          scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) * fraction;
        }, fraction);
        await settled(page);
        const frame = await root.evaluate((el) => {
          const p = (el as Host).proof;
          return {
            stats: p.snapshot(),
            start: p.editor!.state.doc.textContent.slice(0, 20),
            end: p.editor!.state.doc.textContent.slice(-20),
            error: p.error,
          };
        });
        frames.push(frame);
        const s = frame.stats;
        expect(frame.error).toBe('');
        expect(s.tableResourceBound!.supported).toBe(true);
        expect(s.tableDomElements).toBeLessThanOrEqual(s.tableResourceBound!.elements);
        expect(s.tableDomTextNodes).toBeLessThanOrEqual(s.tableResourceBound!.textNodes);
        expect(s.pmNodes).toBeLessThanOrEqual(4096);
        expect(s.mounted).toBe(1);
        expect(s.retainedEditorStates).toBe(0);
        expect(s.maxSourceContextBytes).toBeLessThanOrEqual(16384);
        expect(s.maxTableTransferPageBytes).toBeLessThanOrEqual(4096);
        expect(s.cachePages).toBeLessThanOrEqual(4);
        expect(s.cacheBytes).toBeLessThanOrEqual(16384);
        if (fraction === 1) expect(frame.end).toContain('CELL_END');
        if (fraction === 0) expect(frame.start).toContain('CELL_START');
      }
      visits.push(frames);
    }
    await info.attach('table-residency.json', {
      body: JSON.stringify({
        repeats,
        backingSourceBytes: new TextEncoder().encode(source).length,
        visits,
      }),
      contentType: 'application/json',
    });
    // Counts are payload/DOM evidence, never a garbage-collected heap measurement.
    // After estimates warm, repeated visits may differ at a fragment boundary but
    // must not accumulate prior projections, caches or provenance.
    for (let index = 0; index < 3; index++) {
      const previous = visits[1][index].stats,
        last = visits[2][index].stats;
      for (const key of [
        'tableDomElements',
        'tableDomTextNodes',
        'pmNodes',
        'pmBytes',
        'projectionJsonBytes',
        'sourceReplicaPayloadBytes',
        'provenanceEntries',
        'provenancePayloadBytes',
      ] as const)
        expect(last[key], key).toBeLessThanOrEqual(previous[key] * 1.05 + 16);
    }
    expect(await root.evaluate((el) => (el as Host).proof.service.region(0))).toBe(source);
  });
