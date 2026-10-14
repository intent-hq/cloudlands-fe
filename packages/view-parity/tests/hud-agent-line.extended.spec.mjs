import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

async function paintedLine(frame) {
  return frame.evaluate((root) => {
    const clip = root.firstElementChild;
    if (!clip) return null;
    const box = clip.getBoundingClientRect();
    return document.elementFromPoint(box.x + 2, box.y + box.height / 2)?.textContent;
  });
}

for (const motion of ['full', 'reduced']) {
  test(`HUD ticker presents the latest activity after rapid updates and remount with ${motion} motion`, async ({
    page,
  }, info) => {
    const base = process.env.REACT_BASE_URL;
    if (!base) throw new Error('Set REACT_BASE_URL');
    await page.setViewportSize({ width: 280, height: 1100 });
    const errors = await observeErrors(page);
    await page.goto(`${base}/sandbox/hud-panel?example=interactive&theme=light&motion=${motion}`);
    const demo = page.getByTestId('hud-agent-line-demo');
    const frame = demo.getByTestId('hud-agent-line-frame');
    const input = demo.getByRole('textbox', { name: 'Activity line' });
    await frame.scrollIntoViewIfNeeded();
    await expect.poll(() => paintedLine(frame)).toBe('Reading workspace notes');
    await input.fill('Reviewing');
    await input.pressSequentially(' updates');
    if (motion === 'reduced') {
      const animations = await frame.evaluate(async (root) => {
        const counts = [];
        for (let index = 0; index < 4; index += 1) {
          await new Promise(requestAnimationFrame);
          counts.push(root.getAnimations({ subtree: true }).length);
        }
        return counts;
      });
      expect(animations).toEqual([0, 0, 0, 0]);
    }
    await frame.scrollIntoViewIfNeeded();
    await expect.poll(() => paintedLine(frame)).toBe('Reviewing updates');
    await input.fill('変更を確認しています · '.repeat(10));
    await frame.scrollIntoViewIfNeeded();
    await expect.poll(() => paintedLine(frame)).toBe('変更を確認しています · '.repeat(10));
    const geometry = await frame.evaluate((root) => ({
      bounds: root.getBoundingClientRect().toJSON(),
      client: root.clientWidth,
      scroll: root.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1);
    expect(geometry.bounds.right).toBeLessThanOrEqual(geometry.viewport);
    await info.attach('ticker-containment.json', {
      body: JSON.stringify(geometry),
      contentType: 'application/json',
    });
    await input.fill('');
    await frame.scrollIntoViewIfNeeded();
    await expect.poll(() => paintedLine(frame)).toBe('');
    const old = await frame.locator(':scope > div').elementHandle();
    await demo.getByRole('button', { name: 'Update and remove', exact: true }).click();
    expect(await old.evaluate((node) => node.isConnected)).toBe(false);
    await expect(frame.locator(':scope > div')).toHaveCount(0);
    await demo.getByRole('button', { name: 'Show ticker', exact: true }).click();
    await frame.scrollIntoViewIfNeeded();
    await expect.poll(() => paintedLine(frame)).toBe('Reconnecting to the workspace');
    await demo.getByRole('button', { name: 'Update and remove', exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(demo.getByRole('button', { name: 'Finish review', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await frame.scrollIntoViewIfNeeded();
    await expect.poll(() => paintedLine(frame)).toBe('Review complete');
    await page.evaluate(() => document.fonts.ready);
    await stableLocatorScreenshot(page, frame, async ({ png, attempt }) => {
      if (png)
        await info.attach(`hud-ticker-${motion}-${attempt}`, {
          body: png,
          contentType: 'image/png',
        });
    });
    expect(errors).toEqual([]);
  });
}
