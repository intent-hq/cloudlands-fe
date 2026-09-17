import { expect, test } from '@playwright/experimental-ct-svelte';
import ProximityHighlightLifecycleHost from './ProximityHighlightLifecycleHost.svelte';

test.afterEach(async ({ page }) => {
  expect(await page.pageErrors()).toEqual([]);
});

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`retains hover geometry through invalidation with ${reducedMotion} motion`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: 720, height: 600 });
    await page.emulateMedia({ reducedMotion });
    await page.mouse.move(680, 500);
    const component = await mount(ProximityHighlightLifecycleHost);
    await page.evaluate(() => document.fonts.ready);
    const first = component.getByTestId('row-0');
    const second = component.getByTestId('row-1');
    const hovered = component.locator('.test-hover');
    const selected = component.locator('.test-selected');
    const alignmentError = (selection: boolean) =>
      component.evaluate((host, isSelection) => {
        const highlight = host.querySelector(isSelection ? '.test-selected' : '.test-hover');
        const start = host.querySelector('[data-testid="row-1"]');
        const end = host.querySelector('[data-testid="row-2"]');
        if (!highlight || !start || !end) return Number.MAX_SAFE_INTEGER;
        const box = highlight.getBoundingClientRect();
        const a = start.getBoundingClientRect();
        const b = (isSelection ? end : start).getBoundingClientRect();
        return Math.max(
          Math.abs(box.top - a.top),
          Math.abs(box.bottom - b.bottom),
          Math.abs(box.left - a.left),
          Math.abs(box.right - a.right),
        );
      }, selection);

    await expect(selected).toHaveCount(1);
    await expect.poll(() => alignmentError(true)).toBeLessThanOrEqual(1);
    await first.hover();
    await expect(hovered).toHaveCount(1);
    const initialHover = await hovered.elementHandle();
    expect(initialHover).not.toBeNull();
    await second.hover();
    await expect.poll(() => alignmentError(false)).toBeLessThanOrEqual(1);
    expect(
      await initialHover!.evaluate((node) => node === document.querySelector('.test-hover')),
    ).toBe(true);
    await expect.poll(() => alignmentError(true)).toBeLessThanOrEqual(1);

    await page.mouse.move(680, 500);
    await expect(hovered).toHaveCount(0);
    await first.hover();
    await expect(hovered).toHaveCount(1);
    expect(
      await initialHover!.evaluate((node) => node === document.querySelector('.test-hover')),
    ).toBe(false);

    await page.mouse.move(680, 500);
    await expect(hovered).toHaveCount(0);
    await first.getByRole('button').focus();
    await expect(hovered).toHaveCount(1);
    await page.keyboard.press('Delete');
    await expect(first).toHaveCount(0);
    await expect(hovered).toHaveCount(0);
    await expect(selected).toHaveCount(1);
    await expect.poll(() => alignmentError(true)).toBeLessThanOrEqual(1);

    await component.getByRole('button', { name: 'Restore first row' }).click();
    await first.getByRole('button').focus();
    await expect(hovered).toHaveCount(1);
    await second.getByRole('button').focus();
    await expect.poll(() => alignmentError(false)).toBeLessThanOrEqual(1);
    await component.unmount();
    await expect(page.locator('.test-hover, .test-selected')).toHaveCount(0);
  });
}
