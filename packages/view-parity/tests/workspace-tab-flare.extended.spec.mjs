import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

for (const [theme, motion] of [
  ['light', 'full'],
  ['dark', 'reduced'],
]) {
  test(`workspace decoration preserves native activation and lifetime in ${theme}/${motion}`, async ({
    page,
  }, info) => {
    if (!process.env.REACT_BASE_URL) throw new Error('Set REACT_BASE_URL');
    const errors = await observeErrors(page);
    await page.setViewportSize({ width: 420, height: 900 });
    await page.goto(
      `${process.env.REACT_BASE_URL}/sandbox/sidebar?example=interactive&theme=${theme}&motion=${motion}`,
    );
    const demo = page.getByTestId('workspace-flare-demo');
    const action = demo.getByRole('button', { name: 'Open preview workspace', exact: true });
    const flare = page.getByTestId('workspace-flare-anchor').locator('svg');
    const events = async () => JSON.parse(await demo.locator('output').textContent());
    await expect(action).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await demo.scrollIntoViewIfNeeded();
    const before = await flare.boundingBox();
    await page.mouse.click(before.x + before.width / 2, before.y + before.height / 2);
    expect(await events()).toEqual(['leading']);
    await demo.getByRole('button', { name: 'Before workspace action', exact: true }).click();
    await page.keyboard.press('Tab');
    await expect(action).toBeFocused();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Space');
    await page.keyboard.press('Tab');
    await expect(
      demo.getByRole('button', { name: 'After workspace action', exact: true }),
    ).toBeFocused();
    expect(await events()).toEqual(['leading', 'leading', 'leading']);

    await demo.getByRole('button', { name: 'Switch edge', exact: true }).click();
    const after = await flare.boundingBox();
    await page.mouse.click(after.x + after.width / 2, after.y + after.height / 2);
    expect(await events()).toEqual(['leading', 'leading', 'leading', 'trailing']);
    await demo.getByRole('button', { name: 'Slower transition', exact: true }).click();
    await demo.getByRole('button', { name: 'Show decoration', exact: true }).click();
    await flare.evaluate(async (node) => {
      await Promise.all(node.getAnimations().map((animation) => animation.finished));
    });
    await page.mouse.click(after.x + after.width / 2, after.y + after.height / 2);
    expect(await events()).toHaveLength(5);
    await demo.getByRole('button', { name: 'Show decoration', exact: true }).click();
    await flare.evaluate(async (node) => {
      await Promise.all(node.getAnimations().map((animation) => animation.finished));
    });
    await info.attach('flare-geometry.json', {
      body: JSON.stringify({
        before,
        after,
        frame: await page.getByTestId('workspace-flare-frame').boundingBox(),
      }),
      contentType: 'application/json',
    });
    await stableLocatorScreenshot(
      page,
      page.getByTestId('workspace-flare-frame'),
      async ({ png, attempt }) => {
        if (png)
          await info.attach(`workspace-flare-${theme}-${attempt}`, {
            body: png,
            contentType: 'image/png',
          });
      },
    );
    const original = await flare.elementHandle();
    await demo.getByRole('button', { name: 'Mount decoration', exact: true }).click();
    await expect(flare).toHaveCount(0);
    expect(await original.evaluate((node) => node.isConnected)).toBe(false);
    await action.click();
    expect(await events()).toHaveLength(6);
    await demo.getByRole('button', { name: 'Mount decoration', exact: true }).click();
    await expect(flare).toHaveCount(1);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(action).toBeFocused();
    await page.keyboard.press('Enter');
    expect(await events()).toEqual([
      'leading',
      'leading',
      'leading',
      'trailing',
      'trailing',
      'trailing',
      'trailing',
    ]);
    expect(errors).toEqual([]);
  });
}
