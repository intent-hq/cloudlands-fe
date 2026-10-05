import { expect, type test } from '../../../../test/ct-test';

// Derive from CT's fixture so locator types match its expect, not another Playwright version.
type Page = Parameters<Parameters<typeof test>[2]>[0]['page'];

export async function assertMobilePairingQrGeometry(page: Page) {
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('img')).toBeVisible();
  const geometry = await dialog.evaluate((panel) => {
    const box = panel.getBoundingClientRect();
    const body = panel.querySelector('[data-slot="dialog-body"]')!;
    const bodyBox = body.getBoundingClientRect();
    const style = getComputedStyle(body);
    const image = panel.querySelector('img')!.getBoundingClientRect();
    const heading = panel.querySelector('[data-slot="dialog-title"]')!.getBoundingClientRect();
    const paragraph = panel
      .querySelector('[data-slot="dialog-description"]')!
      .getBoundingClientRect();
    return {
      panelWidth: box.width,
      innerWidth: bodyBox.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      contentLeft: bodyBox.x + parseFloat(style.paddingLeft),
      imageWidth: image.width,
      imageHeight: image.height,
      imageLeft: image.x,
      imageTop: image.y,
      imageBottom: image.bottom,
      headingBottom: heading.bottom,
      paragraphTop: paragraph.y,
      paragraphBottom: paragraph.bottom,
      paragraphCount: panel.querySelectorAll('[data-slot="dialog-description"]').length,
      left: box.x,
      right: box.right,
      viewportWidth: window.innerWidth,
    };
  });
  expect(geometry.imageWidth).toBeCloseTo(geometry.innerWidth, 1);
  expect(geometry.imageHeight).toBeCloseTo(geometry.imageWidth, 1);
  expect(geometry.imageLeft).toBeCloseTo(geometry.contentLeft, 1);
  expect(geometry.imageTop).toBeGreaterThanOrEqual(geometry.headingBottom);
  expect(geometry.paragraphTop).toBeGreaterThanOrEqual(geometry.headingBottom);
  expect(geometry.imageTop).toBeGreaterThanOrEqual(geometry.paragraphBottom);
  expect(geometry.paragraphCount).toBe(1);
  expect(geometry.left).toBeGreaterThanOrEqual(16);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth - 16);
  return geometry;
}
