import { test, expect } from '../../../../../test/ct-test';
import Pair from './ParagraphProofHarness.svelte';
import { settled, type Host } from './paragraph-browser';

for (const previous of [0, 800])
  test(`explicit table seek retains target with previous caret ${previous} through measured coverage`, async ({
    mount,
    page,
  }, info) => {
    const source = '| H | R |\n| --- | --- |\n| ' + 'abcdefghij '.repeat(6000) + ' | neighbor |';
    await mount(Pair, { props: { sourceOverride: source } });
    const root = page.getByTestId('bounded').getByTestId('proof');
    const before = await root.evaluate((el, at) => {
      const p = (el as Host).proof;
      if (at) p.editor!.commands.setTextSelection(p.projection!.pmAt(at));
      return structuredClone(p.selection);
    }, previous);
    const capture = (seek: boolean) =>
      root.evaluate(async (el, seek) => {
        if (seek) await (el as Host).proof.seek(14000);
        const p = (el as Host).proof,
          table = p.projection!.table!,
          entry = table.entries.find((e) => e.cell.first <= 14000 && e.cell.last >= 14000),
          scroller = el.querySelector('[data-testid="editor-host"]')!.parentElement!,
          viewport = scroller.getBoundingClientRect();
        const caret = entry && p.editor!.view.coordsAtPos(p.projection!.pmAt(14000));
        return {
          cell: entry && {
            first: entry.cell.first,
            last: entry.cell.last,
            body: entry.cell.body,
            end: entry.cell.end,
          },
          target: caret && { top: caret.top, bottom: caret.bottom },
          viewport: { top: viewport.top, bottom: viewport.top + scroller.clientHeight },
          gap: (p as unknown as { measuredTableGap(): unknown }).measuredTableGap() ?? null,
          selection: p.selection,
          source: p.service.region(0),
          error: p.error,
          stats: p.snapshot(),
        };
      }, seek);
    const immediate = await capture(true);
    await settled(page);
    const after = await capture(false);
    await info.attach('explicit-seek-coverage.json', {
      body: JSON.stringify({ immediate, after }),
      contentType: 'application/json',
    });
    for (const evidence of [immediate, after]) {
      expect(evidence.cell).toBeDefined();
      expect(evidence.cell!.first).toBeGreaterThan(evidence.cell!.body);
      expect(evidence.cell!.last).toBeLessThan(evidence.cell!.end);
      expect(evidence.target!.top).toBeGreaterThanOrEqual(evidence.viewport.top - 1);
      expect(evidence.target!.bottom).toBeLessThanOrEqual(evidence.viewport.bottom + 1);
      expect(evidence.selection).toEqual(before);
      expect(evidence.source).toBe(source);
      expect(evidence.error).toBe('');
      expect(evidence.stats.maxSourceContextBytes).toBeLessThanOrEqual(16384);
    }
    expect(after.gap).toBeNull();
    await root.evaluate((el) => {
      const h = el as Host & { releaseSeek?: () => void; seeking?: Promise<boolean> },
        p = h.proof;
      p.editor!.commands.setTextSelection(p.projection!.pmAt(14000));
      p.delayFetch = () =>
        new Promise<void>((resolve) => {
          h.releaseSeek = resolve;
        });
      h.seeking = p.seek(p.selection.head);
    });
    await root.evaluate(async (el) => {
      const h = el as Host & { releaseSeek?: () => void; seeking?: Promise<boolean> };
      h.proof.delayFetch = undefined;
      h.releaseSeek!();
      if (!(await h.seeking)) throw new Error('Current seek was rejected');
      delete h.releaseSeek;
      delete h.seeking;
    });
    await settled(page);
    const restored = await root.evaluate((el) => {
      const p = (el as Host).proof,
        view = p.editor!.view,
        dom = window.getSelection();
      return {
        logical: p.selection.table!.head,
        actual: p.projection!.table!.pointAt(view.state.selection.head),
        pm: { anchor: view.state.selection.anchor, head: view.state.selection.head },
        dom:
          dom?.anchorNode &&
          dom.focusNode &&
          view.dom.contains(dom.anchorNode) &&
          view.dom.contains(dom.focusNode)
            ? {
                anchor: view.posAtDOM(dom.anchorNode, dom.anchorOffset),
                head: view.posAtDOM(dom.focusNode, dom.focusOffset),
              }
            : null,
        gap: (p as unknown as { measuredTableGap(): unknown }).measuredTableGap() ?? null,
        source: p.service.region(0),
        error: p.error,
        stats: p.snapshot(),
      };
    });
    await info.attach('restored-seek-coverage.json', {
      body: JSON.stringify(restored),
      contentType: 'application/json',
    });
    expect(restored.actual).toEqual(restored.logical);
    expect(restored.dom).toEqual(restored.pm);
    expect(restored.gap).toBeNull();
    expect(restored.source).toBe(source);
    expect(restored.error).toBe('');
    expect(restored.stats.maxSourceContextBytes).toBeLessThanOrEqual(16384);
  });
