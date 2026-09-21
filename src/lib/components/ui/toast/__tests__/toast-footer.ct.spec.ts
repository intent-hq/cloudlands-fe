import { test, expect } from '../../../../../test/ct-test';
import Harness from './ToastFooterHarness.svelte';

test.use({ viewport: { width: 900, height: 640 }, reducedMotion: 'reduce' });

for (const theme of ['light', 'dark'] as const) {
  test(`Clear all stays left-aligned and readable over the sidebar in ${theme}`, async ({
    mount,
    page,
  }, testInfo) => {
    await mount(Harness, { props: { theme } });
    await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${theme}\\b`));
    await expect(page.locator('[data-sonner-toaster]')).toHaveAttribute('data-sonner-theme', theme);
    await page.evaluate(() => document.fonts.ready);
    const clearAll = page.getByRole('button', { name: 'Dismiss all 2 notifications' });
    const frontToast = page.locator('[data-sonner-toast][data-front="true"]');
    const shells = page.getByTestId('shells-card');
    await expect(clearAll).toBeVisible();
    await expect(frontToast.locator('[data-toast-layout="agent-attention"]')).toBeVisible();
    await expect(frontToast).toHaveAttribute('data-mounted', 'true');
    await expect
      .poll(() =>
        frontToast.evaluate(
          (toast) =>
            toast
              .getAnimations()
              .filter((animation) => animation.pending || animation.playState === 'running').length,
        ),
      )
      .toBe(0);
    await expect
      .poll(async () => {
        const card = (await frontToast.boundingBox())!;
        const action = (await clearAll.boundingBox())!;
        return Math.abs(action.x - card.x);
      })
      .toBeLessThanOrEqual(1);

    const card = (await frontToast.boundingBox())!;
    const action = (await clearAll.boundingBox())!;
    const sidebar = (await shells.boundingBox())!;
    expect(action.y).toBeGreaterThanOrEqual(card.y + card.height);
    expect(action.y - (card.y + card.height)).toBeLessThanOrEqual(12);
    expect(action.x + action.width).toBeLessThanOrEqual(card.x + card.width);
    expect(action.y + action.height).toBeLessThanOrEqual(640);
    expect(action.x).toBeLessThan(sidebar.x + sidebar.width);
    expect(action.x + action.width).toBeGreaterThan(sidebar.x);
    expect(action.y).toBeLessThan(sidebar.y + sidebar.height);
    expect(action.y + action.height).toBeGreaterThan(sidebar.y);

    const visibility = await clearAll.evaluate((button) => {
      const surface = button.querySelector('[data-slot="button-surface"]')!;
      const background = getComputedStyle(surface).backgroundColor;
      const foreground = getComputedStyle(button).color;
      const channels = (color: string) => color.match(/[\d.]+/g)!.map(Number);
      const luminance = (color: string) =>
        channels(color)
          .slice(0, 3)
          .reduce((sum, channel, i) => {
            const value = channel / 255;
            return (
              sum +
              (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4) *
                [0.2126, 0.7152, 0.0722][i]
            );
          }, 0);
      const lightness = [luminance(background), luminance(foreground)].sort((a, b) => a - b);
      const rect = button.getBoundingClientRect();
      return {
        alpha: channels(background)[3] ?? 1,
        contrast: (lightness[1] + 0.05) / (lightness[0] + 0.05),
        hit: button.contains(
          document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
        ),
      };
    });
    expect(visibility.alpha).toBe(1);
    expect(visibility.contrast).toBeGreaterThanOrEqual(4.5);
    expect(visibility.hit).toBe(true);
    await testInfo.attach(`notification-sidebar-${theme}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await clearAll.click();
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
    await expect(clearAll).toHaveCount(0);
    await expect(page.getByRole('status', { name: 'Shell opens' })).toHaveText('0');
  });
}

for (const key of ['Enter', 'Space']) {
  test(`Clear all is reachable by Tab and dismisses the stack with ${key}`, async ({
    mount,
    page,
  }) => {
    await mount(Harness);
    const clearAll = page.getByRole('button', { name: 'Dismiss all 2 notifications' });
    await expect(clearAll).toBeVisible();
    await page.getByRole('button', { name: 'Show notifications' }).focus();
    for (let index = 0; index < 12; index++) {
      await page.keyboard.press('Tab');
      if (await clearAll.evaluate((button) => button === document.activeElement)) break;
    }
    await expect(clearAll).toBeFocused();
    await expect(clearAll).toHaveCSS('outline-style', 'solid');
    await expect(clearAll).toHaveCSS('outline-width', '1px');
    await page.keyboard.press(key);
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
    await expect(clearAll).toHaveCount(0);
    await expect(page.getByRole('status', { name: 'Shell opens' })).toHaveText('0');
    await page.getByRole('button', { name: 'Show notifications' }).click();
    await expect(clearAll).toBeVisible();
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(2);
  });
}

test('the static preview footer shares the notification left edge', async ({ mount, page }) => {
  await mount(Harness, { props: { staticPosition: true } });
  const clearAll = page.getByRole('button', { name: 'Dismiss all 2 notifications' });
  await expect(clearAll).toBeVisible();
  await expect
    .poll(async () => {
      const card = (await page.locator('[data-sonner-toast][data-front="true"]').boundingBox())!;
      const action = (await clearAll.boundingBox())!;
      return Math.abs(action.x - card.x);
    })
    .toBeLessThanOrEqual(1);
  await clearAll.click();
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
});
