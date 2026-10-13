import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

test('pull status keeps compact keyboard descriptions and retires its tooltip', async ({
  page,
}, info) => {
  const base = process.env.REACT_BASE_URL;
  if (!base) throw new Error('Set REACT_BASE_URL');
  const errors = await observeErrors(page);
  await page.setViewportSize({ width: 420, height: 800 });
  await page.goto(`${base}/sandbox/home-pull-state?example=interactive`);
  const demo = page.getByTestId('home-pull-state-demo');
  const trigger = demo.getByTestId('home-pull-state-frame').locator('[tabindex="0"]');
  const tooltip = page.getByRole('tooltip');
  const show = demo.getByRole('button', { name: 'Show status', exact: true });
  const compact = demo.getByRole('button', { name: 'Compact', exact: true });
  const next = demo.getByRole('button', { name: 'Next status', exact: true });
  await show.focus();
  await page.keyboard.press('Tab');
  await expect(trigger).toBeFocused();
  await expect(tooltip).toBeVisible();
  const firstDescription = (await tooltip.textContent()).trim();
  expect(firstDescription.length).toBeGreaterThan(0);
  await expect(trigger).toHaveAccessibleDescription(firstDescription);
  await page.keyboard.press('Escape');
  await expect(tooltip).toBeHidden();
  await expect(trigger).toBeFocused();
  await compact.click();
  await next.click();
  await show.focus();
  await page.keyboard.press('Tab');
  await expect(trigger).toBeFocused();
  await expect(tooltip).toBeVisible();
  const currentDescription = (await tooltip.textContent()).trim();
  expect(currentDescription).not.toBe(firstDescription);
  await expect(trigger).toHaveAccessibleDescription(currentDescription);
  await show.click();
  await expect(trigger).toHaveCount(0);
  await expect(tooltip).toHaveCount(0);
  await show.click();
  await page.keyboard.press('Tab');
  await expect(trigger).toBeFocused();
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveCount(1);
  await expect(trigger).toHaveAccessibleDescription(currentDescription);
  await compact.click();
  await show.focus();
  await page.keyboard.press('Tab');
  await expect(tooltip).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const screenshot = info.outputPath('home-pull-state.png');
  await page.screenshot({ path: screenshot });
  await info.attach('home-pull-state', { path: screenshot, contentType: 'image/png' });
  expect(errors).toEqual([]);
});

test('sidebar loading follows reduced motion and leaves keyboard navigation usable after remount', async ({
  page,
}, info) => {
  const base = process.env.REACT_BASE_URL;
  if (!base) throw new Error('Set REACT_BASE_URL');
  const errors = await observeErrors(page);
  await page.setViewportSize({ width: 420, height: 800 });
  await page.goto(`${base}/sandbox/sidebar-skeleton?example=interactive`);
  const demo = page.getByTestId('sidebar-skeleton-demo');
  const skeleton = demo.locator('[data-workspace-sidebar-skeleton]');
  const show = demo.getByRole('button', { name: 'Show loading', exact: true });
  const exit = demo.getByRole('link', { name: 'Component sandbox', exact: true });
  await show.focus();
  await page.keyboard.press('Tab');
  await expect(exit).toBeFocused();
  const running = () =>
    skeleton.evaluate(
      (node) =>
        node
          .getAnimations({ subtree: true })
          .filter((animation) => animation.playState === 'running').length,
    );
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(running).toBeGreaterThan(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(running).toBe(0);
  const original = await skeleton.elementHandle();
  await show.click();
  await expect(skeleton).toHaveCount(0);
  expect(await original.evaluate((node) => node.isConnected)).toBe(false);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await show.click();
  await expect.poll(running).toBeGreaterThan(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(running).toBe(0);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
    .toBeLessThanOrEqual(1);
  await stableLocatorScreenshot(page, demo, async ({ png, attempt }) => {
    if (png)
      await info.attach(`sidebar-skeleton-${attempt}`, { body: png, contentType: 'image/png' });
  });
  await show.focus();
  await page.keyboard.press('Tab');
  await expect(exit).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(skeleton).toHaveCount(0);
  await expect(page).toHaveURL(`${base}/sandbox`);
  await original.dispose();
  expect(errors).toEqual([]);
});
