import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

for (const motion of ['full', 'reduced']) {
  test(`HUD state bars preserve rows during updates and honor ${motion} motion`, async ({
    page,
  }, info) => {
    const base = process.env.REACT_BASE_URL;
    if (!base) throw new Error('Set REACT_BASE_URL');
    await page.setViewportSize({ width: 280, height: 1100 });
    const errors = await observeErrors(page);
    await page.goto(`${base}/sandbox/hud-panel?example=interactive&theme=light&motion=${motion}`);
    const demo = page.getByTestId('hud-state-bars-demo');
    const frame = demo.getByTestId('hud-state-bars-frame');
    const active = demo.getByTestId('hud-active-row');
    const waiting = demo.getByTestId('hud-waiting-row');
    await expect(active).toHaveText(/ACTIVE\s*3/);
    await expect(waiting).toHaveText(/WAITING\s*2/);
    const originalRow = await active.elementHandle();
    await demo.getByRole('button', { name: 'Update counts', exact: true }).click();
    await expect(active).toHaveText(/ACTIVE\s*7/);
    await expect(waiting).toHaveText(/WAITING\s*1/);
    expect(await originalRow.evaluate((node) => node.isConnected)).toBe(true);
    await demo.getByRole('button', { name: 'Blink waiting', exact: true }).click();
    const animationCount = () =>
      frame.evaluate((root) => root.getAnimations({ subtree: true }).length);
    if (motion === 'full') {
      await expect.poll(animationCount).toBeGreaterThan(0);
    } else {
      const counts = await frame.evaluate(async (root) => {
        const samples = [];
        for (let index = 0; index < 4; index += 1) {
          await new Promise(requestAnimationFrame);
          samples.push(root.getAnimations({ subtree: true }).length);
        }
        return samples;
      });
      expect(counts).toEqual([0, 0, 0, 0]);
    }
    await demo.getByRole('button', { name: 'Blink waiting', exact: true }).click();
    await expect.poll(animationCount).toBe(0);
    await demo.getByRole('button', { name: 'Before bars', exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(demo.getByRole('button', { name: 'After bars', exact: true })).toBeFocused();
    await demo.getByRole('button', { name: 'Empty bars', exact: true }).click();
    await expect(active).toHaveCount(0);
    await expect(waiting).toHaveCount(0);
    await demo.getByRole('button', { name: 'Empty bars', exact: true }).click();
    const old = await frame.locator(':scope > div').elementHandle();
    await demo.getByRole('button', { name: 'Show bars', exact: true }).click();
    expect(await old.evaluate((node) => node.isConnected)).toBe(false);
    await demo.getByRole('button', { name: 'Show bars', exact: true }).click();
    await expect(active).toHaveText(/ACTIVE\s*7/);
    await expect(waiting).toHaveText(/WAITING\s*1/);
    await frame.scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    const geometry = await frame.evaluate((root) => ({
      bounds: root.getBoundingClientRect().toJSON(),
      client: root.clientWidth,
      scroll: root.scrollWidth,
      viewport: document.documentElement.clientWidth,
      rows: [...root.firstElementChild.children].map((row) => {
        const bounds = row.getBoundingClientRect();
        return {
          bounds: bounds.toJSON(),
          readable: [...row.children]
            .filter((node) => node.textContent)
            .every((node) => {
              const box = node.getBoundingClientRect();
              return (
                box.left >= bounds.left &&
                box.right <= bounds.right &&
                node.scrollWidth <= node.clientWidth + 1
              );
            }),
        };
      }),
    }));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1);
    expect(geometry.bounds.right).toBeLessThanOrEqual(geometry.viewport);
    expect(geometry.rows.every((row) => row.readable)).toBe(true);
    await info.attach('hud-state-bars-containment.json', {
      body: JSON.stringify(geometry),
      contentType: 'application/json',
    });
    await stableLocatorScreenshot(page, frame, async ({ png, attempt }) => {
      if (png)
        await info.attach(`hud-state-bars-${motion}-${attempt}`, {
          body: png,
          contentType: 'image/png',
        });
    });
    expect(errors).toEqual([]);
  });
}
