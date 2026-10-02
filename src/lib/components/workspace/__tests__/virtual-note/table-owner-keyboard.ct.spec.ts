import { test, expect } from '../../../../../test/ct-test';
import Pair from './ParagraphProofHarness.svelte';
import { focus, settled, type Host } from './paragraph-browser';

for (const key of [
  'ArrowDown',
  'ArrowUp',
  'ArrowLeft',
  'ArrowRight',
  'Shift+ArrowDown',
  'Shift+ArrowUp',
  'Shift+ArrowLeft',
  'Shift+ArrowRight',
] as const) {
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
        const vertical = key.endsWith('Up') || key.endsWith('Down');
        const last = key.endsWith('Down') || key.endsWith('Right');
        const edge = (last ? Math.max : Math.min)(
          ...entries.map((e) => (vertical ? e.cell.row : e.cell.column)),
        );
        const entry = entries.find((e) =>
          vertical
            ? e.cell.row === edge && e.cell.column === 1
            : e.cell.column === edge && e.cell.row === 21,
        )!;
        return { text: p.editor!.state.doc.nodeAt(entry.pm)!.textContent, row: entry.cell.row };
      }, key);
    const outcomes = [];
    for (const side of ['native', 'bounded']) {
      await focus(page, side);
      await page
        .getByTestId(side)
        .getByTestId('proof')
        .evaluate(
          (el, { text, key }) => {
            const h = el as Host,
              editor = h.proof?.editor ?? h.native;
            let at = -1;
            editor!.state.doc.descendants((n, pos) => {
              if (n.type.name === 'paragraph' && n.textContent === text) at = pos + 1;
            });
            if (at < 0) throw new Error('Native edge cell missing');
            editor!.commands.setTextSelection(at + (key.endsWith('Right') ? text.length : 0));
          },
          { text: target.text, key },
        );
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
            const selected = editor!.state.selection;
            const cellSelection = selected as typeof selected & {
              $headCell?: typeof selected.$head;
              $anchorCell?: typeof selected.$anchor;
            };
            return {
              text:
                cellSelection.$headCell?.nodeAfter?.textContent ??
                selected.$head.parent.textContent,
              anchorText:
                cellSelection.$anchorCell?.nodeAfter?.textContent ??
                selected.$anchor.parent.textContent,
              kind: selected.toJSON().type,
              anchorOffset: selected.$anchor.parentOffset,
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
    expect(outcomes[1].anchorText).toBe(outcomes[0].anchorText);
    expect(outcomes[1].kind).toBe(outcomes[0].kind);
    expect(outcomes[1].depth).toBe(outcomes[0].depth);
    if (outcomes[0].kind === 'text') {
      expect(outcomes[1].offset).toBe(outcomes[0].offset);
      expect(outcomes[1].anchorOffset).toBe(outcomes[0].anchorOffset);
    }
    expect(outcomes[1].selection!.table!.kind).toBe(outcomes[0].kind === 'cell' ? 'cell' : 'text');
    expect(outcomes[1].source).toBe(source);
    expect(outcomes[1].stats!.maxSourceContextBytes).toBeLessThanOrEqual(16384);
    expect(outcomes[1].stats!.cacheBytes).toBeLessThanOrEqual(16384);
    expect(outcomes[1].stats!.pmNodes).toBeLessThanOrEqual(4096);
    if (key === 'Shift+ArrowDown' || key === 'Shift+ArrowUp') {
      const burst = [];
      for (const side of ['native', 'bounded']) {
        await focus(page, side);
        if (side === 'bounded')
          await page
            .getByTestId(side)
            .getByTestId('proof')
            .evaluate((el) => {
              const host = el as Host & { releaseTableArrow?: () => void };
              host.proof.delayFetch = () =>
                new Promise<void>((resolve) => {
                  host.releaseTableArrow = resolve;
                });
            });
        for (let step = 0; step < 18; step++) await page.keyboard.press(key);
        if (side === 'bounded') {
          await page
            .getByTestId(side)
            .getByTestId('proof')
            .evaluate((el) => {
              const host = el as Host & { releaseTableArrow?: () => void };
              host.proof.delayFetch = undefined;
              host.releaseTableArrow?.();
            });
          await expect
            .poll(() =>
              page
                .getByTestId(side)
                .getByTestId('proof')
                .evaluate((el) => (el as Host).proof.service.pendingInputs),
            )
            .toBe(0);
        }
        await settled(page);
        burst.push(
          await page
            .getByTestId(side)
            .getByTestId('proof')
            .evaluate((el) => {
              const h = el as Host,
                p = h.proof,
                editor = (p?.editor ?? h.native)!;
              const selection = editor!.state.selection as typeof editor.state.selection & {
                $anchorCell?: typeof editor.state.selection.$anchor;
                $headCell?: typeof editor.state.selection.$head;
              };
              return {
                kind: selection.toJSON().type,
                anchor: selection.$anchorCell?.nodeAfter?.textContent,
                head: selection.$headCell?.nodeAfter?.textContent,
                logical: p?.selection.table,
                error: p?.error ?? '',
                stats: p?.snapshot(),
                source: p?.service.region(0),
              };
            }),
        );
      }
      await info.attach('delayed-table-cell-extension.json', {
        body: JSON.stringify({ key, burst }),
        contentType: 'application/json',
      });
      expect(burst[0].kind).toBe('cell');
      expect(burst[1].kind).toBe('cell');
      expect(burst[1].error).toBe('');
      expect(burst[1].logical).toEqual({
        kind: 'cell',
        anchor: { cell: source.indexOf(burst[0].anchor!) - 1, block: 0, offset: 0 },
        head: { cell: source.indexOf(burst[0].head!) - 1, block: 0, offset: 0 },
      });
      expect(burst[1].source).toBe(source);
      expect(burst[1].stats!.maxSourceContextBytes).toBeLessThanOrEqual(16384);
      expect(burst[1].stats!.cacheBytes).toBeLessThanOrEqual(16384);
      expect(burst[1].stats!.cachePages).toBeLessThanOrEqual(4);
      expect(burst[1].stats!.pmNodes).toBeLessThanOrEqual(4096);
    }
  });
}
