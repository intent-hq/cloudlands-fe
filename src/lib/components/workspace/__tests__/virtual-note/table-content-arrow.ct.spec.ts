import { test, expect } from '../../../../../test/ct-test';
import Pair from './ParagraphProofHarness.svelte';
import { focus, settled, type Host } from './paragraph-browser';

const source =
  '| H | R |\n| --- | --- |\n| ' + 'abcdefghij '.repeat(6000) + ' | neighbor |\n| tail | end |';
for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'])
  for (const delayed of [false, true])
    test(`native ${key} continues inside a cell fragment${delayed ? ' with delayed fetch' : ''}`, async ({
      mount,
      page,
    }) => {
      await mount(Pair, { props: { sourceOverride: source } });
      const fixture = await page
        .getByTestId('bounded')
        .getByTestId('proof')
        .evaluate(async (el, key) => {
          const p = (el as Host).proof;
          await p.seek(14000);
          const entry = p.projection!.table!.entries.find(
            (e) => e.cell.row === 1 && e.cell.column === 0,
          )!;
          const paragraphs = p.projection!.table!.paragraphs.filter(
            (q) => q.cell.from === entry.cell.from,
          );
          const end = key === 'ArrowRight' || key === 'ArrowDown';
          const q = end ? paragraphs.at(-1)! : paragraphs[0];
          return {
            point: p.projection!.table!.pointAt(end ? q.end : q.pm)!,
            first: entry.cell.first,
            last: entry.cell.last,
            body: entry.cell.body,
            end: entry.cell.end,
          };
        }, key);
      expect(fixture.first).toBeGreaterThan(fixture.body);
      expect(fixture.last).toBeLessThan(fixture.end);
      const outcomes = [];
      for (const side of ['native', 'bounded']) {
        await focus(page, side);
        await page
          .getByTestId(side)
          .getByTestId('proof')
          .evaluate(
            (el, { point, delayed }) => {
              const h = el as Host & { releaseArrow?: () => void },
                p = h.proof,
                editor = p?.editor ?? h.native;
              if (p && delayed)
                p.delayFetch = () =>
                  new Promise<void>((resolve) => {
                    h.releaseArrow = resolve;
                  });
              let at = p ? p.projection!.table!.pointPM(point) : -1;
              if (!p)
                editor!.state.doc.descendants((node, pos) => {
                  if (node.type.name === 'paragraph' && node.textContent.startsWith('abcdefghij '))
                    at = pos + 1 + point.offset;
                });
              if (at === undefined || at < 1) throw Error('Cell fragment caret unavailable');
              editor!.commands.setTextSelection(at!);
              if (!p) editor!.view.dispatch(editor!.state.tr.scrollIntoView());
            },
            { point: fixture.point, delayed },
          );
        if (!(side === 'bounded' && delayed)) {
          await settled(page);
          await expect
            .poll(() =>
              page
                .getByTestId('bounded')
                .getByTestId('proof')
                .evaluate((el) => {
                  const p = (el as Host).proof;
                  return !p.pendingFetch && !p.service.pendingInputs && !p.navigating;
                }),
            )
            .toBe(true);
        }
        await page.keyboard.press(key);
        if (side === 'bounded' && delayed)
          await page
            .getByTestId(side)
            .getByTestId('proof')
            .evaluate((el) => {
              const h = el as Host & { releaseArrow?: () => void };
              h.proof.delayFetch = undefined;
              h.releaseArrow?.();
            });
        await settled(page);
        await expect
          .poll(() =>
            page
              .getByTestId('bounded')
              .getByTestId('proof')
              .evaluate((el) => {
                const p = (el as Host).proof;
                return !p.pendingFetch && !p.service.pendingInputs && !p.navigating;
              }),
          )
          .toBe(true);
        outcomes.push(
          await page
            .getByTestId(side)
            .getByTestId('proof')
            .evaluate(async (el) => {
              const h = el as Host,
                p = h.proof,
                editor = p?.editor ?? h.native;
              if (!p)
                return {
                  offset: editor!.state.selection.$head.parentOffset,
                  block: editor!.state.selection.$head.index(3),
                };
              const selection = structuredClone(p.selection.table!);
              const projected = p.projection!.table!.pointAt(editor!.state.selection.head);
              const old = p.editor!;
              await p.seek(p.selection.head);
              return {
                offset: selection.head.offset,
                block: selection.head.block,
                cell: selection.head.cell,
                selection,
                projected,
                restored: p.selection.table,
                destroyed: old.isDestroyed,
                error: p.error,
                source: p.service.region(0),
                bytes: p.snapshot().maxSourceContextBytes,
              };
            }),
        );
      }
      const [native, bounded] = outcomes;
      expect(bounded.error).toBe('');
      expect(bounded.source).toBe(source);
      expect(bounded.cell).toBe(fixture.point.cell);
      expect(bounded.block).toBe(native.block);
      if (key === 'ArrowRight' || key === 'ArrowLeft') expect(bounded.offset).toBe(native.offset);
      else if (key === 'ArrowDown') expect(bounded.offset).toBeGreaterThan(fixture.point.offset);
      else expect(bounded.offset).toBeLessThan(fixture.point.offset);
      expect(bounded.projected).toEqual(bounded.selection!.head);
      expect(bounded.destroyed).toBe(true);
      expect(bounded.restored).toEqual(bounded.selection);
      expect(bounded.bytes).toBeLessThanOrEqual(16384);
    });
