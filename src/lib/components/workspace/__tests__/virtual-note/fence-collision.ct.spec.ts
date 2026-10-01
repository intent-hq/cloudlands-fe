import { test, expect } from '../../../../../test/ct-test';
import Harness from './ParagraphProofHarness.svelte';
import { focus, settled, type Host } from './paragraph-browser';

for (const marker of ['`', '~'])
  for (const edge of ['middle', 'opening', 'closing', 'continuation'] as const)
    test(`literal ${marker} ${edge} closing-marker paste keeps canonical code, reload caret and history`, async ({
      mount,
      page,
      context,
    }, info) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      const opening = marker.repeat(4) + 'text extra-info\n';
      const body = '\tconst café = "**literal** [link](url) `code` \\escape 🌍";  \n'.repeat(1600);
      const ending = marker.repeat(4) + '  \n\nAfter prose';
      const source = opening + body + ending;
      const extra = edge === 'continuation' ? (marker === '`' ? 11 : 9) : marker === '`' ? 2 : 1;
      const inserted =
        edge === 'continuation'
          ? '\n   ' + marker.repeat(12) + ' \n' + marker.repeat(6) + '\n'
          : '\n' + marker.repeat(4) + '\n';
      let at =
        edge === 'opening'
          ? opening.length
          : edge === 'closing'
            ? source.length - ending.length - 1
            : 30000;
      await mount(Harness, { props: { sourceOverride: source } });
      await expect(page.getByTestId('native').locator('.tiptap')).toHaveCount(1);
      const root = page.getByTestId('bounded').getByTestId('proof');
      await root.evaluate((el, at) => (el as Host).proof.seek(at), at);
      if (edge === 'continuation')
        at = await root.evaluate((el) => (el as Host).proof.snapshot().windowTo);
      const expected =
        marker.repeat(extra) +
        source.slice(0, at) +
        inserted +
        source.slice(at, -ending.length) +
        marker.repeat(extra) +
        ending;
      const initial = await page
        .getByTestId('native')
        .getByTestId('proof')
        .evaluate((el) => (el as Host).native.getJSON());
      expect(initial.content?.map((n) => n.type)).toEqual(['codeBlock', 'paragraph']);
      expect(initial.content?.[0].content?.[0].text).toBe(body.slice(0, -1));
      await page.clock.setFixedTime(Date.parse('2026-10-01T12:00:00Z'));
      for (const side of ['native', 'bounded']) {
        await focus(page, side);
        await page
          .getByTestId(side)
          .getByTestId('proof')
          .evaluate(
            (el, { at, start }) => {
              const h = el as Host,
                e = h.proof?.editor ?? h.native;
              e.commands.setTextSelection(h.proof ? h.proof.projection!.pmAt(at) : at - start + 1);
            },
            { at, start: opening.length },
          );
        await page.evaluate((text) => navigator.clipboard.writeText(text), inserted);
        await page.keyboard.press('Control+v');
        await settled(page);
      }
      async function check(text: string, caret: number, bodyStart: number) {
        await settled(page);
        const result = await page.evaluate(
          async ({ text, caret, bodyStart }) => {
            const h = document.querySelector(
              '[data-testid="bounded"] [data-testid="proof"]',
            ) as Host;
            const n = (
              document.querySelector('[data-testid="native"] [data-testid="proof"]') as Host
            ).native;
            const p = h.proof,
              e = p.editor!;
            return {
              error: p.error,
              exact: p.service.region(0) === text,
              parserNative:
                JSON.stringify((await h.parseSource(text)).doc) === JSON.stringify(n.getJSON()),
              logical: p.selection.head,
              actual: p.projection!.sourceAt(e.state.selection.head),
              native: n.state.selection.head + bodyStart - 1,
              parents: [
                e.state.selection.$head.parent.type.name,
                n.state.selection.$head.parent.type.name,
              ],
              literal:
                e.state.selection.$head.parent.textContent ===
                text.slice(
                  Math.max(bodyStart, p.projection!.start),
                  Math.min(
                    text.lastIndexOf('\n' + text[0].repeat(4)),
                    p.projection!.start + p.projection!.source.length,
                  ),
                ),
              expectedCaret: caret,
              depth: p.service.depth,
              stats: { ...p.snapshot(), source: undefined, calls: undefined },
            };
          },
          { text, caret, bodyStart },
        );
        expect(result.error).toBe('');
        expect(result.exact).toBe(true);
        expect(result.parserNative).toBe(true);
        expect(result.parents).toEqual(['codeBlock', 'codeBlock']);
        expect(result.literal).toBe(true);
        expect([result.logical, result.actual, result.native]).toEqual([caret, caret, caret]);
        expect(result.depth).toBe(1);
        expect(result.stats.maxSourceRead).toBeLessThanOrEqual(4096);
        expect(result.stats.maxInlineContextBytes).toBeLessThanOrEqual(4096);
        expect(result.stats.maxHighlightBytes).toBeLessThanOrEqual(16384);
        expect(result.stats.maxFenceRepairBytes).toBeLessThanOrEqual(4096);
        expect(result.stats.retainedEditorStates).toBe(0);
        return result;
      }
      const edited = await check(expected, at + inserted.length + extra, opening.length + extra);
      await root.evaluate(
        async (el, caret) => {
          const p = (el as Host).proof,
            old = p.editor!;
          p.save();
          await p.seek(70000);
          if (!old.isDestroyed) throw new Error('View was not destroyed');
          await p.seek(caret);
        },
        at + inserted.length + extra,
      );
      const reloaded = await check(expected, at + inserted.length + extra, opening.length + extra);
      for (const side of ['native', 'bounded']) {
        await focus(page, side);
        await page.keyboard.press('Control+z');
      }
      const undone = await check(source, at, opening.length);
      for (const side of ['native', 'bounded']) {
        await focus(page, side);
        await page.keyboard.press('Control+Shift+z');
      }
      const redone = await check(expected, at + inserted.length + extra, opening.length + extra);
      await info.attach('fence-collision.json', {
        body: JSON.stringify({ edited, reloaded, undone, redone }),
        contentType: 'application/json',
      });
    });
