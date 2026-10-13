import { test, expect } from '../../../../../test/ct-test';
import type { Page } from '@playwright/test';
import Pair from './ParagraphProofHarness.svelte';
import { focus, selectSource, logical, settled, sameSaved, type Host } from './paragraph-browser';

async function point(page: Page, side: string, source: number) {
  return page
    .getByTestId(side)
    .getByTestId('proof')
    .evaluate((el, source) => {
      const h = el as Host,
        e = h.proof?.editor ?? h.native;
      const position = h.proof ? h.proof.projection!.pmAt(source) : source + 1;
      let rect = e.view.coordsAtPos(position);
      const scroller = e.view.dom.parentElement!.parentElement!;
      const viewport = scroller.getBoundingClientRect();
      if (rect.top < viewport.top || rect.bottom > viewport.bottom) {
        // Scroll the target into the visible browser surface; no selection is set here.
        scroller.scrollTop += rect.top - viewport.top - 200;
        rect = e.view.coordsAtPos(position);
      }
      return { x: rect.left, y: (rect.top + rect.bottom) / 2 };
    }, source);
}

for (const direction of ['forward', 'backward'] as const)
  test(`one paragraph: ${direction} pointer drag and clipboard cross the loaded edge`, async ({
    mount,
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await mount(Pair);
    await expect(page.getByTestId('native').locator('.tiptap')).toHaveCount(1);
    const bounded = page.getByTestId('bounded').getByTestId('proof');
    if (direction === 'backward') await bounded.evaluate((el) => (el as Host).proof.seek(4096));
    const start = direction === 'forward' ? 3500 : 2650;
    const middle = direction === 'forward' ? 3600 : 2540;
    const finish = direction === 'forward' ? 4160 : 1984;
    const copied = [];
    for (const side of ['native', 'bounded']) {
      await selectSource(page, side, start);
      await page
        .getByTestId(side)
        .getByTestId('proof')
        .evaluate((el) => {
          const h = el as Host,
            e = h.proof?.editor ?? h.native;
          e.view.dispatch(e.state.tr.scrollIntoView());
          const scroller = e.view.dom.parentElement!.parentElement!;
          const rect = e.view.coordsAtPos(e.state.selection.head);
          scroller.scrollTop += rect.top - scroller.getBoundingClientRect().top - 260;
        });
      const a = await point(page, side, start),
        b = await point(page, side, middle);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 8 });
      await settled(page);
      if (side === 'bounded') {
        await expect
          .poll(() =>
            bounded.evaluate((el, d) => {
              const p = (el as Host).proof;
              return d === 'forward' ? p.snapshot().windowTo > 4096 : p.projection!.start < 2048;
            }, direction),
          )
          .toBe(true);
      }
      const c = await point(page, side, finish);
      await page.mouse.move(c.x, c.y, { steps: 8 });
      await page.mouse.up();
      await settled(page);
      expect(await logical(page, side), side).toEqual({ anchor: start, head: finish });
      await page.keyboard.press('Control+c');
      copied.push(await page.evaluate(() => navigator.clipboard.readText()));
    }
    expect(copied[1]).toBe(copied[0]);
    expect(copied[0].length).toBe(Math.abs(finish - start));
    await sameSaved(page);
    for (const side of ['native', 'bounded']) {
      await focus(page, side);
      await page.keyboard.type('DRAG');
    }
    await sameSaved(page);
  });
