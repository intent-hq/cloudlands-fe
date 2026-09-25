/**
 * Real-layout guard for the Create-button progress bar (intent-hq/intent#5330):
 * cloudlands-fe#2441/#2530 wrapped Button children in inner spans and the
 * bar, then positioned inside the children, silently moved into the label
 * area. #2609 made the bar a sibling overlay of the Button; these tests pin
 * that geometry from Chromium bounding boxes so a future Button structure
 * change fails here instead of reaching users.
 */
import { expect, test } from '../../../../../test/ct-test';
import type { Locator, Page } from '@playwright/test';
import CreateButtonProgressGeometryHost from './CreateButtonProgressGeometryHost.svelte';

const BAR_HEIGHT = 2;

async function box(locator: Locator) {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error(`${locator} has no bounding box`);
  return rect;
}

async function awaitLive(page: Page, percent: number) {
  const bar = page.getByRole('progressbar');
  await expect(bar).toHaveAttribute('aria-valuenow', String(percent));
  const wrapped = page.getByTestId('wrapped-button');
  const reference = page.getByTestId('reference-button');
  await expect(wrapped).toHaveText(await reference.innerText());
  return { bar, wrapped, reference };
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 640, height: 400 });
});

test('the bar is pinned to the bottom-left edge of the button', async ({ mount, page }) => {
  await mount(CreateButtonProgressGeometryHost, { props: { percent: 62 } });
  const { bar, wrapped } = await awaitLive(page, 62);
  const [barBox, buttonBox] = await Promise.all([box(bar), box(wrapped)]);
  expect(Math.abs(barBox.y + barBox.height - (buttonBox.y + buttonBox.height))).toBeLessThanOrEqual(
    1,
  );
  expect(Math.abs(barBox.x - buttonBox.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(barBox.height - BAR_HEIGHT)).toBeLessThanOrEqual(0.5);
});

test('the bar width tracks the percent of the button width', async ({ mount, page }) => {
  await mount(CreateButtonProgressGeometryHost, { props: { percent: 62 } });
  const { bar, wrapped } = await awaitLive(page, 62);
  const [barBox, buttonBox] = await Promise.all([box(bar), box(wrapped)]);
  expect(Math.abs(barBox.width - 0.62 * buttonBox.width)).toBeLessThanOrEqual(1);
});

test('the bar spans the full button width at 100%', async ({ mount, page }) => {
  await mount(CreateButtonProgressGeometryHost, { props: { percent: 100 } });
  const { bar, wrapped } = await awaitLive(page, 100);
  const [barBox, buttonBox] = await Promise.all([box(bar), box(wrapped)]);
  expect(Math.abs(barBox.width - buttonBox.width)).toBeLessThanOrEqual(1);
});

test('wrapping leaves the button footprint and elevation unchanged', async ({ mount, page }) => {
  await mount(CreateButtonProgressGeometryHost, { props: { percent: 62 } });
  const { wrapped, reference } = await awaitLive(page, 62);
  const [wrappedBox, referenceBox] = await Promise.all([box(wrapped), box(reference)]);
  expect(Math.abs(wrappedBox.width - referenceBox.width)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(wrappedBox.height - referenceBox.height)).toBeLessThanOrEqual(0.5);

  const shadows = (button: Locator) =>
    button.evaluate((element) => ({
      button: getComputedStyle(element).boxShadow,
      surface: getComputedStyle(element.querySelector('[data-slot="button-surface"]')!).boxShadow,
    }));
  const [wrappedShadows, referenceShadows] = await Promise.all([
    shadows(wrapped),
    shadows(reference),
  ]);
  // The primary variant's elevation lives on the surface span; an unwrapped
  // button with no shadow at all would make the parity check vacuous.
  expect(referenceShadows.surface).not.toBe('none');
  expect(wrappedShadows).toEqual(referenceShadows);
});

test('the bar is a sibling overlay of the button, clipped only by the overlay layer', async ({
  mount,
  page,
}) => {
  await mount(CreateButtonProgressGeometryHost, { props: { percent: 62 } });
  const { bar } = await awaitLive(page, 62);
  const layout = await bar.evaluate((barElement, buttonSelector) => {
    const button = document.querySelector(buttonSelector)!;
    let root: Element | null = barElement.parentElement;
    while (root && !root.contains(button)) root = root.parentElement;
    if (!root) throw new Error('bar and button share no ancestor');
    const clipping: string[] = [];
    for (let node = barElement.parentElement; node; node = node.parentElement) {
      if (getComputedStyle(node).overflow !== 'visible') clipping.push(node.tagName);
      if (node === root) break;
    }
    return {
      insideButton: button.contains(barElement),
      clippingCount: clipping.length,
      overlayClips: getComputedStyle(barElement.parentElement!).overflow !== 'visible',
      rootOverflow: getComputedStyle(root).overflow,
    };
  }, '[data-testid="wrapped-button"]');
  expect(layout.insideButton).toBe(false);
  expect(layout.overlayClips).toBe(true);
  expect(layout.clippingCount).toBe(1);
  expect(layout.rootOverflow).toBe('visible');
});
