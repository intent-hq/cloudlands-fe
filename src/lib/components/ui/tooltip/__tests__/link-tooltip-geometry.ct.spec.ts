import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Page } from '@playwright/test';
import LinkTooltipGeometryHost from './LinkTooltipGeometryHost.svelte';

/** `.link-tooltip` keeps this gap from the anchor and from every viewport edge. */
const MARGIN = 8;

const tooltip = (page: Page) => page.getByRole('tooltip');
const anchor = (page: Page) => page.getByTestId('link-anchor');

async function boxes(page: Page) {
  const tip = tooltip(page);
  await expect(tip).toBeVisible();
  await expect(tip.locator('.github-link-card, .link-tooltip-url')).toHaveCount(1);
  return { tip: (await tip.boundingBox())!, link: (await anchor(page).boundingBox())! };
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('sits above the anchor by default', async ({ mount, page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await mount(LinkTooltipGeometryHost, {
    props: { anchor: { top: 300, left: 300 }, content: 'card' },
  });
  await expect
    .poll(async () => {
      const { tip, link } = await boxes(page);
      return link.y - (tip.y + tip.height);
    })
    .toBeCloseTo(MARGIN, 0);
});

test('flips below the anchor when the card would overflow the top edge', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await mount(LinkTooltipGeometryHost, {
    props: { anchor: { top: 4, left: 300 }, content: 'card' },
  });
  await expect
    .poll(async () => {
      const { tip, link } = await boxes(page);
      return tip.y - (link.y + link.height);
    })
    .toBeCloseTo(MARGIN, 0);
  const { tip } = await boxes(page);
  expect(tip.y + tip.height).toBeLessThanOrEqual(600 - MARGIN);
});

test('clamps the wider card inside the right viewport edge', async ({ mount, page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await mount(LinkTooltipGeometryHost, {
    props: { anchor: { top: 300, right: 4 }, content: 'card' },
  });
  await expect
    .poll(async () => {
      const { tip, link } = await boxes(page);
      // The card is wider than the anchor, so centering it on the link would overflow.
      return tip.width > link.width && tip.x + tip.width <= 800 - MARGIN + 1;
    })
    .toBe(true);
  const { tip, link } = await boxes(page);
  expect(tip.x + tip.width).toBeCloseTo(800 - MARGIN, 0);
  expect(tip.x).toBeGreaterThanOrEqual(MARGIN - 1);
  expect(link.x + link.width).toBeGreaterThan(tip.x);
});

test('narrow viewport: the card shrinks to fit and stays inside both edges', async ({
  mount,
  page,
}) => {
  const width = 320;
  await page.setViewportSize({ width, height: 600 });
  await mount(LinkTooltipGeometryHost, {
    props: { anchor: { top: 300, left: 4 }, content: 'card' },
  });
  await expect
    .poll(async () => {
      const { tip } = await boxes(page);
      return tip.x >= MARGIN - 1 && tip.x + tip.width <= width - MARGIN + 1;
    })
    .toBe(true);
  const { tip } = await boxes(page);
  expect(tip.width).toBeCloseTo(width - 2 * MARGIN, 0);
  await expect(tooltip(page).locator('.github-link-card')).toHaveCount(1);
});
