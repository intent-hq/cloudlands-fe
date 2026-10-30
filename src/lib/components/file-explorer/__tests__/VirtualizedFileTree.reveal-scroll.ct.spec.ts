import { expect, test } from '../../../../test/ct-test';
import type { Locator, Page } from '@playwright/test';
import VirtualizedFileTreeRevealScrollHost from './mocks/VirtualizedFileTreeRevealScrollHost.svelte';

const ITEM_HEIGHT = 25;

function scroller(component: Locator) {
  return component.getByRole('tree').locator(':scope > div');
}

async function setScrollTop(component: Locator, top: number) {
  await scroller(component).evaluate((element, value) => {
    element.scrollTop = value;
    element.dispatchEvent(new Event('scroll'));
  }, top);
  await expect(scroller(component)).toHaveJSProperty('scrollTop', top);
}

async function rowBox(component: Locator, name: string) {
  const row = component.getByRole('tree').locator(`[data-file-path="/project/${name}"]`);
  const [rowRect, viewRect] = await Promise.all([
    row.boundingBox(),
    scroller(component).boundingBox(),
  ]);
  return {
    top: rowRect!.y - viewRect!.y,
    bottom: rowRect!.y + rowRect!.height - viewRect!.y,
    viewHeight: viewRect!.height,
  };
}

async function reveal(page: Page, name: string) {
  await page.evaluate(
    (path) =>
      (window as unknown as { __revealTreePath: (path: string) => void }).__revealTreePath(path),
    `/project/${name}`,
  );
}

test('clicking a fully visible file row does not scroll the tree', async ({ mount, page }) => {
  const component = await mount(VirtualizedFileTreeRevealScrollHost);
  await setScrollTop(component, 5 * ITEM_HEIGHT);

  // Row 13 sits near the bottom of the 250px viewport (rows 5-14 visible).
  await component
    .getByRole('tree')
    .locator('[data-file-path="/project/file-13.pdf"] [data-slot="list-item"]')
    .click();
  // Watch every scroll event through the delayed reveal, not just the end state.
  await scroller(component).evaluate((element) => {
    const moves: number[] = [];
    (window as unknown as { __treeScrollMoves: number[] }).__treeScrollMoves = moves;
    element.addEventListener('scroll', () => moves.push(element.scrollTop));
  });
  await page.waitForTimeout(1000);

  await expect(scroller(component)).toHaveJSProperty('scrollTop', 5 * ITEM_HEIGHT);
  expect(
    await page.evaluate(
      () => (window as unknown as { __treeScrollMoves: number[] }).__treeScrollMoves,
    ),
  ).toEqual([]);
});

test('revealing an off-screen file centers it', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(VirtualizedFileTreeRevealScrollHost);
  await setScrollTop(component, 0);

  await reveal(page, 'file-30.pdf');

  await expect
    .poll(async () => {
      const box = await rowBox(component, 'file-30.pdf');
      return Math.abs((box.top + box.bottom) / 2 - box.viewHeight / 2) <= 1;
    })
    .toBe(true);
});

test('revealing a row clipped at the bottom edge scrolls only enough to show it', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(VirtualizedFileTreeRevealScrollHost);
  // Rows 0-9 fill the first 250px; scrolling by 10px clips row 10 at the bottom.
  await setScrollTop(component, 10);

  await reveal(page, 'file-10.pdf');

  const viewHeight = await scroller(component).evaluate((element) => element.clientHeight);
  await expect(scroller(component)).toHaveJSProperty('scrollTop', 11 * ITEM_HEIGHT - viewHeight);
});
