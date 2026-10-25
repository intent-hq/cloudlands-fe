import { expect, test } from '../../../../test/ct-test';
import type { LocalFileChange } from '../types';
import StickySelectionToolbarHost from './StickySelectionToolbarHost.svelte';

// intent-hq/intent#5700: the line-staging toolbar must stay reachable below
// the sticky file header while a long file scrolls, and stay inside its file.
const LINES = 160;
const longChange = (filePath: string, index: number): LocalFileChange => ({
  filePath,
  action: 'modify',
  additions: LINES,
  deletions: LINES,
  toolName: 'edit_file',
  toolCallId: `sticky-toolbar-${index}`,
  oldContent: Array.from({ length: LINES }, (_, i) => `const before${i} = ${i};`).join('\n') + '\n',
  newContent: Array.from({ length: LINES }, (_, i) => `const after${i} = ${i};`).join('\n') + '\n',
});
const changes = [longChange('src/first.ts', 0), longChange('src/second.ts', 1)];

test('line-staging toolbar stays below the sticky file header while its file scrolls', async ({
  mount,
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 900, height: 700 });
  const component = await mount(StickySelectionToolbarHost, {
    props: { changes, showStagingControls: true },
  });
  await expect(page.locator('[data-change-card-key] [data-column-number]').first()).toBeVisible({
    timeout: 60_000,
  });

  const firstCard = component.locator('[data-change-card-key]').first();
  const firstHeader = firstCard.locator('[data-change-header-key]');
  const secondHeader = component
    .locator('[data-change-card-key]')
    .nth(1)
    .locator('[data-change-header-key]');
  const firstViewer = firstCard.locator('.tracked-change-diff-viewer');

  // Select a changed line via its line number to raise the toolbar. The left
  // 16px of the number cell stays clear of the per-line hover stage button.
  await firstViewer
    .locator('[data-column-number]')
    .nth(3)
    .click({ position: { x: 6, y: 8 } });
  const toolbar = firstViewer.locator('.selection-action-bar');
  await expect(toolbar).toBeVisible();
  const stage = toolbar.locator('.hunk-stage-btn');
  await expect(stage).toBeVisible();

  const geometry = () =>
    page.evaluate(() => {
      const card = document.querySelector<HTMLElement>('[data-change-card-key]')!;
      const header = card.querySelector<HTMLElement>('[data-change-header-key]')!;
      const bar = card.querySelector<HTMLElement>('.selection-action-bar');
      const scroller = (() => {
        let node: HTMLElement | null = card.parentElement;
        while (node) {
          const { overflowY } = getComputedStyle(node);
          if (
            (overflowY === 'auto' || overflowY === 'scroll') &&
            node.scrollHeight > node.clientHeight
          )
            return node;
          node = node.parentElement;
        }
        return null;
      })();
      const rect = (el: Element | null | undefined) => el?.getBoundingClientRect() ?? null;
      const stageBtn = bar?.querySelector<HTMLElement>('.hunk-stage-btn') ?? null;
      const stageRect = rect(stageBtn);
      const hit = stageRect
        ? document.elementFromPoint(
            stageRect.left + stageRect.width / 2,
            stageRect.top + stageRect.height / 2,
          )
        : null;
      const second = document
        .querySelectorAll<HTMLElement>('[data-change-card-key]')[1]
        ?.querySelector<HTMLElement>('[data-change-header-key]');
      return {
        headerBottom: rect(header)!.bottom,
        bar: rect(bar),
        scroller: rect(scroller),
        stageHit: !!(hit && stageBtn && stageBtn.contains(hit)),
        secondHeader: rect(second),
      };
    });

  const scroller = await page.evaluateHandle(() => {
    let node: HTMLElement | null = document.querySelector<HTMLElement>('[data-change-card-key]');
    while (node) {
      const { overflowY } = getComputedStyle(node);
      if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight)
        return node;
      node = node.parentElement;
    }
    throw new Error('no scroll container');
  });
  await scroller.evaluate((el) => el.scrollBy(0, 500));

  await expect
    .poll(async () => {
      const g = await geometry();
      if (!g.bar || !g.scroller) return 'missing toolbar or scroller';
      if (g.bar.top < g.headerBottom - 0.5)
        return `toolbar top ${g.bar.top} above header ${g.headerBottom}`;
      if (g.bar.top < g.scroller.top || g.bar.bottom > g.scroller.bottom)
        return 'toolbar off-screen';
      if (!g.stageHit) return 'stage button is covered';
      return 'ok';
    })
    .toBe('ok');

  // Keyboard order is unchanged: the toolbar actions precede the diff body.
  await stage.focus();
  await expect(stage).toBeFocused();

  // Once the first file scrolls past, its toolbar must not cover the next header.
  await scroller.evaluate((el) => {
    const second = el.querySelectorAll<HTMLElement>('[data-change-card-key]')[1]!;
    el.scrollTop += second.getBoundingClientRect().top - el.getBoundingClientRect().top - 40;
  });
  await expect
    .poll(async () => {
      const g = await geometry();
      if (!g.bar || !g.secondHeader) return 'ok';
      const overlaps =
        g.bar.bottom > g.secondHeader.top + 0.5 && g.bar.top < g.secondHeader.bottom - 0.5;
      return overlaps
        ? `toolbar ${g.bar.top}-${g.bar.bottom} overlaps next header ${g.secondHeader.top}`
        : 'ok';
    })
    .toBe('ok');
  await expect(secondHeader).toBeVisible();

  // Stage receives the real click; a successful click clears the selection.
  await scroller.evaluate((el) => {
    const card = el.querySelector<HTMLElement>('[data-change-card-key]')!;
    el.scrollTop += card.getBoundingClientRect().top - el.getBoundingClientRect().top + 500;
  });
  await expect.poll(async () => (await geometry()).stageHit).toBe(true);
  await stage.click();
  await expect(toolbar).toHaveCount(0);
  await expect(firstHeader).toBeVisible();
});
