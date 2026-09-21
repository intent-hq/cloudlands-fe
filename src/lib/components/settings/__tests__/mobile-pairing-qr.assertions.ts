import type { test } from '@playwright/experimental-ct-svelte';
import { expect } from '../../../../test/ct-test';

// Derive from CT's fixture so locator types match its expect, not another Playwright version.
type Page = Parameters<Parameters<typeof test>[2]>[0]['page'];

export async function assertMobilePairingQrGeometry(page: Page) {
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('img')).toBeVisible();
  const geometry = await dialog.locator(':scope > div').evaluate((panel) => {
    const box = panel.getBoundingClientRect();
    const style = getComputedStyle(panel);
    const image = panel.querySelector('img')!.getBoundingClientRect();
    const heading = panel.querySelector('h3')!.getBoundingClientRect();
    const paragraph = panel.querySelector('p')!.getBoundingClientRect();
    return {
      panelWidth: box.width,
      innerWidth: box.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      contentLeft: box.x + parseFloat(style.paddingLeft),
      imageWidth: image.width,
      imageHeight: image.height,
      imageLeft: image.x,
      imageTop: image.y,
      imageBottom: image.bottom,
      headingBottom: heading.bottom,
      paragraphTop: paragraph.y,
      paragraphCount: panel.querySelectorAll('p').length,
      left: box.x,
      right: box.right,
      viewportWidth: window.innerWidth,
    };
  });
  expect(geometry.imageWidth).toBeCloseTo(geometry.innerWidth, 1);
  expect(geometry.imageHeight).toBeCloseTo(geometry.imageWidth, 1);
  expect(geometry.imageLeft).toBeCloseTo(geometry.contentLeft, 1);
  expect(geometry.imageTop).toBeGreaterThanOrEqual(geometry.headingBottom);
  expect(geometry.paragraphTop).toBeGreaterThanOrEqual(geometry.imageBottom);
  expect(geometry.paragraphCount).toBe(1);
  expect(geometry.left).toBeGreaterThanOrEqual(16);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth - 16);
  return geometry;
}
