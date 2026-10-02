import { test, expect } from '../../../../../test/ct-test';
import Pair from './ParagraphProofHarness.svelte';
import { focus, settled, type Host } from './paragraph-browser';

for (const key of ['ArrowDown', 'ArrowUp'] as const) {
  test(`native ${key} crosses a mounted table edge without changing logical columns`, async ({
    mount,
    page,
  }, info) => {
    const row = (r: number) => `| r${r}c0 | r${r}c1 | r${r}c2 | r${r}c3 |`;
    const source =
      '| H0 | H1 | H2 | H3 |\n| --- | --- | --- | --- |\n' +
      Array.from({ length: 60 }, (_, r) => row(r)).join('\n');
    await mount(Pair, { props: { sourceOverride: source } });
    const target = await page
      .getByTestId('bounded')
      .getByTestId('proof')
      .evaluate(async (el, key) => {
        const p = (el as Host).proof;
        await p.seek(p.service.region(0).indexOf('r20c1'));
        const entries = p.projection!.table!.entries;
        const row = (key === 'ArrowDown' ? Math.max : Math.min)(...entries.map((e) => e.cell.row));
        const entry = entries.find((e) => e.cell.row === row && e.cell.column === 1)!;
        return { text: p.editor!.state.doc.nodeAt(entry.pm)!.textContent, row };
      }, key);
    const outcomes = [];
    for (const side of ['native', 'bounded']) {
      await focus(page, side);
      await page
        .getByTestId(side)
        .getByTestId('proof')
        .evaluate((el, text) => {
          const h = el as Host,
            editor = h.proof?.editor ?? h.native;
          let at = -1;
          editor!.state.doc.descendants((n, pos) => {
            if (n.type.name === 'paragraph' && n.textContent === text) at = pos + 1;
          });
          if (at < 0) throw new Error('Native edge cell missing');
          editor!.commands.setTextSelection(at);
        }, target.text);
      await settled(page);
      await page.keyboard.press(key);
      await settled(page);
      outcomes.push(
        await page
          .getByTestId(side)
          .getByTestId('proof')
          .evaluate((el) => {
            const h = el as Host,
              p = h.proof,
              editor = p?.editor ?? h.native;
            return {
              text: editor!.state.selection.$head.parent.textContent,
              depth: editor!.state.selection.$head.depth,
              offset: editor!.state.selection.$head.parentOffset,
              selection: p?.selection,
              error: p?.error ?? '',
              source: p?.service.region(0),
              stats: p?.snapshot(),
            };
          }),
      );
    }
    await info.attach('table-edge-key.json', {
      body: JSON.stringify({ key, target, outcomes }),
      contentType: 'application/json',
    });
    expect(outcomes[1].error).toBe('');
    expect(outcomes[1].text).toBe(outcomes[0].text);
    expect(outcomes[1].depth).toBe(outcomes[0].depth);
    expect(outcomes[1].offset).toBe(outcomes[0].offset);
    expect(outcomes[1].selection!.table!.kind).toBe('text');
    expect(outcomes[1].source).toBe(source);
    expect(outcomes[1].stats!.maxSourceContextBytes).toBeLessThanOrEqual(16384);
    expect(outcomes[1].stats!.cacheBytes).toBeLessThanOrEqual(16384);
    expect(outcomes[1].stats!.pmNodes).toBeLessThanOrEqual(4096);
  });
}
