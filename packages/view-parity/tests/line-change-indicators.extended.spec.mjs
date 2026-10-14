import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

for (const { theme, motion } of [
  { theme: 'light', motion: 'full' },
  { theme: 'dark', motion: 'reduced' },
]) {
  test(`line indicators preserve count branches, keyboard access and cleanup in ${theme} theme`, async ({
    page,
  }, info) => {
    const base = process.env.REACT_BASE_URL;
    if (!base) throw new Error('Set REACT_BASE_URL');
    await page.setViewportSize({ width: 280, height: 1000 });
    const errors = await observeErrors(page);
    await page.goto(`${base}/sandbox/badge?example=interactive&theme=${theme}&motion=${motion}`);
    const demo = page.getByTestId('line-change-demo');
    const frame = demo.getByTestId('line-change-frame');
    const stats = demo.getByTestId('line-stats');
    const badge = demo.getByTestId('line-badge');
    await expect(stats).toHaveText(/\+\s*1\.2K\s*-\s*56/);
    await expect(badge).toHaveText(/\+1,234\s*-56/);
    await demo.getByRole('button', { name: 'Clear changes', exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(demo.getByRole('button', { name: 'Restore changes', exact: true })).toBeFocused();
    await demo.getByRole('button', { name: 'Clear changes', exact: true }).click();
    await expect(stats).toBeEmpty();
    await expect(badge).toBeEmpty();
    await demo.getByRole('button', { name: 'Show zero', exact: true }).click();
    await expect(stats).toHaveText(/\+\s*0\s*-\s*0/);
    await expect(badge).toHaveText(/\+0\s*-0/);
    await demo.getByRole('spinbutton', { name: 'Added lines' }).fill('-2');
    await demo.getByRole('spinbutton', { name: 'Deleted lines' }).fill('3');
    await expect(stats).toHaveText(/\+\s*-2\s*-\s*3/);
    await demo.getByRole('button', { name: 'Show zero', exact: true }).click();
    await expect(stats).toHaveText(/^\s*-\s*3\s*$/);
    await expect(badge).toHaveText(/^\s*-3\s*$/);
    await demo.getByRole('button', { name: 'Loading stats', exact: true }).click();
    await expect(stats).not.toBeEmpty();
    await expect(stats).not.toContainText('3');
    await expect(badge).toHaveText(/^\s*-3\s*$/);
    await demo.getByRole('button', { name: 'Loading stats', exact: true }).click();
    await demo.getByRole('button', { name: 'Restore changes', exact: true }).click();
    await demo.getByRole('button', { name: 'Show icons', exact: true }).click();
    await expect(badge).toHaveText(/\+1,234\s*-56/);
    await demo.getByRole('button', { name: 'Animate badge', exact: true }).click();
    await demo.getByRole('spinbutton', { name: 'Added lines' }).fill('9876');
    await expect(badge).toContainText('+9,876');
    const old = await badge.locator(':scope > div').elementHandle();
    await demo.getByRole('button', { name: 'Show indicators', exact: true }).click();
    expect(await old.evaluate((node) => node.isConnected)).toBe(false);
    await expect(badge).toBeEmpty();
    await demo.getByRole('button', { name: 'Show indicators', exact: true }).click();
    await expect(badge).toContainText('+9,876');
    await demo.getByRole('button', { name: 'Animate badge', exact: true }).click();
    await demo.getByRole('button', { name: 'Restore changes', exact: true }).click();
    await frame.scrollIntoViewIfNeeded();
    const geometry = await frame.evaluate((root) => ({
      bounds: root.getBoundingClientRect().toJSON(),
      viewport: document.documentElement.clientWidth,
      client: root.clientWidth,
      scroll: root.scrollWidth,
    }));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1);
    expect(geometry.bounds.right).toBeLessThanOrEqual(geometry.viewport);
    await info.attach('line-indicator-containment.json', {
      body: JSON.stringify(geometry),
      contentType: 'application/json',
    });
    await page.mouse.move(0, 0);
    await page.evaluate(() => document.fonts.ready);
    await stableLocatorScreenshot(page, frame, async ({ png, attempt }) => {
      if (png)
        await info.attach(`line-indicators-${theme}-${attempt}`, {
          body: png,
          contentType: 'image/png',
        });
    });
    expect(errors).toEqual([]);
  });
}
