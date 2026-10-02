import { test, expect } from '../../../../../test/ct-test';
import Pair from './ParagraphProofHarness.svelte';
import { focus, settled, type Host } from './paragraph-browser';
import type { SourceJournal } from './source-journal';
import type { DocumentSession } from './document-session';
import type { TableIndex } from './table-source';

for (const columns of [1, 6]) {
  for (const backward of [false, true]) {
    test(`native ${backward ? 'backward' : 'forward'} delayed Tab skips ${columns}-column merged owners`, async ({
      mount,
      page,
    }, info) => {
      const rows = columns === 1 ? 120 : 50;
      const source =
        '| ' +
        Array.from({ length: 8 }, (_, c) => `H${c}`).join(' | ') +
        ' |\n| ' +
        Array(8).fill('---').join(' | ') +
        ' |\n' +
        Array.from(
          { length: rows },
          (_, r) => '| ' + Array.from({ length: 8 }, (_, c) => `r${r}c${c}`).join(' | ') + ' |',
        ).join('\n');
      await mount(Pair, { props: { sourceOverride: source } });
      await expect.poll(() => page.evaluate(() => {
        const native = document.querySelector('[data-testid="native"] [data-testid="proof"]') as Host;
        const bounded = document.querySelector('[data-testid="bounded"] [data-testid="proof"]') as Host;
        return !!native?.native?.isInitialized && !!bounded?.proof?.editor?.isInitialized;
      })).toBe(true);
      const fixture = await page.evaluate(
        async ({ rows, columns, backward }) => {
          const host = (side: string) =>
            document.querySelector(`[data-testid="${side}"] [data-testid="proof"]`) as Host;
          const native = host('native').native;
          let anchor = -1,
            head = -1;
          native.state.doc.descendants((node, pos) => {
            if (node.type.name === 'tableCell' && node.textContent === 'r0c0') anchor = pos;
            if (
              node.type.name === 'tableCell' &&
              node.textContent === `r${rows - 1}c${columns - 1}`
            )
              head = pos;
          });
          native.commands.setCellSelection({ anchorCell: anchor, headCell: head });
          if (!native.commands.mergeCells()) throw new Error('Native span fixture failed');
          const saved = (host('native') as Host & { nativeMarkdown(): string }).nativeMarkdown();
          const old = host('bounded').proof;
          // Full native fixture and backing metadata are external oracle costs.
          const service = new (old.service.constructor as typeof SourceJournal)(() => saved, 1);
          const backing = service as unknown as {
            tableIndex(s: string, start: number): TableIndex[];
            tableStates: Map<string, string>;
          };
          const physical = backing.tableIndex(saved, 0)[0];
          native.state.doc.firstChild!.forEach((row, _p, r) =>
            row.forEach((cell, _q, c) =>
              backing.tableStates.set(
                `cell:${physical.rows[r].cells[c].from}`,
                JSON.stringify(cell.toJSON()),
              ),
            ),
          );
          const fixtureBytes = new TextEncoder().encode(
            JSON.stringify([...backing.tableStates]),
          ).length;
          old.destroy();
          const p = new (old.constructor as typeof DocumentSession)(
            service,
            host('bounded').querySelector('[data-testid="editor-host"]')!,
          );
          host('bounded').proof = p;
          const needle = `r${columns === 1 ? 94 : 30}c${backward ? columns : 7}`;
          await p.seek(saved.indexOf(needle));
          for (const editor of [native, p.editor!]) {
            let at = -1;
            editor.state.doc.descendants((node, pos) => {
              if (node.type.name === 'paragraph' && node.textContent === needle) at = pos + 1;
            });
            if (at < 0) throw new Error('Span keyboard fixture endpoint missing');
            editor.commands.setTextSelection(at);
          }
          return { saved, fixtureBytes };
        },
        { rows, columns, backward },
      );
      const outcomes = [];
      for (const side of ['native', 'bounded']) {
        await focus(page, side);
        if (side === 'bounded')
          await page
            .getByTestId(side)
            .getByTestId('proof')
            .evaluate((el) => {
              const host = el as Host & { release?: () => void };
              host.proof.delayFetch = () =>
                new Promise<void>((resolve) => {
                  host.release = resolve;
                });
            });
        for (let i = 0; i < 9; i++) await page.keyboard.press(backward ? 'Shift+Tab' : 'Tab');
        if (side === 'bounded') {
          await page
            .getByTestId(side)
            .getByTestId('proof')
            .evaluate((el) => {
              const host = el as Host & { release?: () => void };
              host.proof.delayFetch = undefined;
              host.release?.();
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
        outcomes.push(
          await page
            .getByTestId(side)
            .getByTestId('proof')
            .evaluate((el) => {
              const h = el as Host,
                p = h.proof,
                editor = (p?.editor ?? h.native)!;
              return {
                selection: editor.state.selection.toJSON(),
                text: editor.state.selection.$head.parent.textContent,
                offset: editor.state.selection.$head.parentOffset,
                logical: p?.selection.table,
                source: p?.service.region(0),
                error: p?.error ?? '',
                stats: p?.snapshot(),
              };
            }),
        );
      }
      await info.attach('span-tab.json', {
        body: JSON.stringify({ fixture, columns, backward, outcomes }),
        contentType: 'application/json',
      });
      expect(outcomes[1].error).toBe('');
      expect(outcomes[1].text).toBe(outcomes[0].text);
      expect(outcomes[1].offset).toBe(outcomes[0].offset);
      expect(outcomes[1].selection.type).toBe(outcomes[0].selection.type);
      expect(outcomes[1].logical?.head.cell).toBe(fixture.saved.indexOf(outcomes[0].text) - 1);
      expect(outcomes[1].source).toBe(fixture.saved);
      expect(outcomes[1].stats!.maxSourceContextBytes).toBeLessThanOrEqual(16384);
      expect(outcomes[1].stats!.maxTableTransferPageBytes).toBeLessThanOrEqual(4096);
      expect(outcomes[1].stats!.cachePages).toBeLessThanOrEqual(4);
      expect(outcomes[1].stats!.cacheBytes).toBeLessThanOrEqual(16384);
      expect(outcomes[1].stats!.pmNodes).toBeLessThanOrEqual(4096);
      const restored = await page
        .getByTestId('bounded')
        .getByTestId('proof')
        .evaluate(async (el) => {
          const p = (el as Host).proof,
            old = p.editor!;
          await p.seek(p.selection.head);
          return {
            destroyed: old.isDestroyed,
            text: p.editor!.state.selection.$head.parent.textContent,
            offset: p.editor!.state.selection.$head.parentOffset,
            logical: p.selection.table,
            source: p.service.region(0),
          };
        });
      expect(restored.destroyed).toBe(true);
      expect(restored.text).toBe(outcomes[0].text);
      expect(restored.offset).toBe(outcomes[0].offset);
      expect(restored.logical).toEqual(outcomes[1].logical);
      expect(restored.source).toBe(fixture.saved);
    });
  }
}
