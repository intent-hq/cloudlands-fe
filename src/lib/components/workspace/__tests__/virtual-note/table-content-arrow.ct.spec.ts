import { test, expect } from '../../../../../test/ct-test';
import Pair from './ParagraphProofHarness.svelte';
import { focus, settled, type Host } from './paragraph-browser';

const source =
  '| H | R |\n| --- | --- |\n| ' + 'abcdefghij '.repeat(6000) + ' | neighbor |\n| tail | end |';
for (const key of [
  'ArrowRight',
  'ArrowLeft',
  'ArrowDown',
  'ArrowUp',
  'Shift+ArrowRight',
  'Shift+ArrowLeft',
])
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
          const end = key.endsWith('ArrowRight') || key.endsWith('ArrowDown');
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
        if (key.startsWith('Shift+')) {
          await page.keyboard.press(key);
          await page.keyboard.press(key.endsWith('Right') ? 'Shift+ArrowLeft' : 'Shift+ArrowRight');
          await page.keyboard.press(key);
        }
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
                  anchorOffset: editor!.state.selection.$anchor.parentOffset,
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
      if (key.endsWith('ArrowRight') || key.endsWith('ArrowLeft')) {
        expect(bounded.offset).toBe(native.offset);
        expect(bounded.selection!.anchor.offset).toBe(native.anchorOffset);
      } else if (key === 'ArrowDown') expect(bounded.offset).toBeGreaterThan(fixture.point.offset);
      else expect(bounded.offset).toBeLessThan(fixture.point.offset);
      expect(bounded.projected).toEqual(bounded.selection!.head);
      expect(bounded.destroyed).toBe(true);
      expect(bounded.restored).toEqual(bounded.selection);
      expect(bounded.bytes).toBeLessThanOrEqual(16384);
      if (key === 'ArrowLeft' || key === 'ArrowRight') {
        const history = await page.evaluate(async () => {
          const host = (side: string) =>
            document.querySelector(`[data-testid="${side}"] [data-testid="proof"]`) as Host;
          const p = host('bounded').proof,
            native = host('native').native;
          const before = structuredClone(p.selection),
            original = p.service.region(0);
          const expected = original.slice(0, before.head) + 'X' + original.slice(before.head);
          native.commands.insertContent('X');
          p.editor!.commands.insertContent('X');
          const saved = p.service.region(0);
          p.save();
          const old = p.editor!;
          await p.seek(p.selection.head);
          const inserted = {
            native: native.state.selection.$head.parentOffset,
            bounded: p.selection.table!.head.offset,
            destroyed: old.isDestroyed,
          };
          await p.history();
          native.commands.undo();
          const undo = {
            source: p.service.region(0),
            selection: structuredClone(p.selection.table),
            native: native.state.selection.$head.parentOffset,
          };
          await p.history(true);
          native.commands.redo();
          const redo = {
            source: p.service.region(0),
            selection: structuredClone(p.selection.table),
            native: native.state.selection.$head.parentOffset,
          };
          return {
            before,
            expected,
            saved,
            inserted,
            undo,
            redo,
            error: p.error,
            stats: p.snapshot(),
          };
        });
        expect(history.error).toBe('');
        expect(history.saved).toBe(history.expected);
        expect(history.inserted.destroyed).toBe(true);
        expect(history.inserted.bounded).toBe(history.inserted.native);
        expect(history.undo.source).toBe(source);
        expect(history.undo.selection).toEqual(history.before.table);
        expect(history.undo.selection!.head.offset).toBe(history.undo.native);
        expect(history.redo.source).toBe(history.saved);
        expect(history.redo.selection!.head.offset).toBe(history.redo.native);
        expect(history.stats.maxSourceContextBytes).toBeLessThanOrEqual(16384);
        expect(history.stats.maxTableWriteBytes).toBeLessThanOrEqual(4096);
      }
    });
