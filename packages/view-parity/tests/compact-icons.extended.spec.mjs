import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

for (const theme of ['light', 'dark']) {
  test(`compact icon callers preserve native focus and actions through prop and lifetime changes in ${theme}`, async ({
    page,
  }, info) => {
    if (!process.env.REACT_BASE_URL) throw new Error('Set REACT_BASE_URL');
    const errors = await observeErrors(page);
    await page.setViewportSize({ width: 420, height: 1000 });
    await page.goto(
      `${process.env.REACT_BASE_URL}/sandbox/editor-icons?example=interactive&theme=${theme}&motion=reduced`,
    );
    const demo = page.getByTestId('compact-icons-demo');
    await demo.waitFor({ state: 'visible', timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    const frame = demo.getByTestId('compact-icons-frame');
    const before = demo.getByRole('button', { name: 'Before icons', exact: true });
    const after = demo.getByRole('button', { name: 'After icons', exact: true });
    const output = demo.getByRole('status', { name: 'Compact icon callbacks' });
    const names = ['Sidebar', 'Server', 'Repository', 'Branch', 'ElevenLabs', 'OpenAI'];
    const events = [];
    await frame.scrollIntoViewIfNeeded();
    const initialGeometry = await frame.boundingBox();
    await before.focus();
    for (const name of names) {
      await page.keyboard.press('Tab');
      const button = frame.getByRole('button', { name, exact: true });
      await expect(button).toBeFocused();
      await expect(button).toHaveAccessibleName(name);
      await page.keyboard.press('Enter');
      events.push(`${name}:left:default`);
      await expect(output).toHaveText(JSON.stringify(events));
    }
    await page.keyboard.press('Tab');
    await expect(after).toBeFocused();
    await demo.getByRole('button', { name: 'Swap sidebar side' }).click();
    for (const size of [24, 0, 47.5, 'default']) {
      await demo.getByRole('button', { name: 'Next size', exact: true }).click();
      const action = frame.getByRole('button', { name: 'Sidebar', exact: true });
      await action.press('Space');
      events.push(`Sidebar:right:${size}`);
      await expect(output).toHaveText(JSON.stringify(events));
    }
    await demo.getByRole('button', { name: 'Disable actions' }).click();
    await before.focus();
    await page.keyboard.press('Tab');
    await expect(after).toBeFocused();
    for (const name of names)
      await expect(frame.getByRole('button', { name, exact: true })).toBeDisabled();
    await expect(output).toHaveText(JSON.stringify(events));
    const old = await frame.getByRole('button', { name: 'Sidebar', exact: true }).elementHandle();
    await demo.getByRole('button', { name: 'Mount actions' }).click();
    await expect(frame.getByRole('button')).toHaveCount(0);
    expect(await old.evaluate((node) => node.isConnected)).toBe(false);
    await demo.getByRole('button', { name: 'Swap sidebar side' }).click();
    await demo.getByRole('button', { name: 'Disable actions' }).click();
    await demo.getByRole('button', { name: 'Mount actions' }).click();
    await frame.getByRole('button', { name: 'Sidebar', exact: true }).press('Enter');
    events.push('Sidebar:left:default');
    await expect(output).toHaveText(JSON.stringify(events));
    await frame.scrollIntoViewIfNeeded();
    const finalGeometry = await frame.evaluate((node) => ({
      bounds: node.getBoundingClientRect().toJSON(),
      client: node.clientWidth,
      scroll: node.scrollWidth,
      controls: [...node.querySelectorAll('button')].map((button) => {
        const bounds = button.getBoundingClientRect();
        const hit = window.document.elementFromPoint(
          bounds.x + bounds.width / 2,
          bounds.y + bounds.height / 2,
        );
        return { bounds: bounds.toJSON(), reachable: button === hit || button.contains(hit) };
      }),
    }));
    expect(finalGeometry.scroll).toBeLessThanOrEqual(finalGeometry.client + 1);
    expect(finalGeometry.controls.every((item) => item.reachable)).toBe(true);
    await info.attach(`compact-${theme}-geometry.json`, {
      body: JSON.stringify({ before: initialGeometry, after: finalGeometry }),
      contentType: 'application/json',
    });
    await page.mouse.move(0, 0);
    await stableLocatorScreenshot(page, frame, async ({ png, attempt }) => {
      if (png)
        await info.attach(`compact-${theme}-${attempt}`, { body: png, contentType: 'image/png' });
    });
    expect(errors).toEqual([]);
  });
}
