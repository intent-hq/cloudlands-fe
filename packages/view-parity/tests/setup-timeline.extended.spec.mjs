import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

async function open(page) {
  const base = process.env.REACT_BASE_URL;
  if (!base) throw new Error('Set REACT_BASE_URL');
  const errors = await observeErrors(page);
  await page.goto(
    `${base}/sandbox/timeline-section?example=interactive&theme=light&motion=reduced`,
  );
  const demo = page.getByTestId('setup-timeline-demo');
  await expect(demo).toBeVisible();
  const frame = demo.getByTestId('setup-trigger-frame');
  const trigger = frame.getByRole('button');
  return { demo, frame, trigger, errors };
}

test('setup trigger preserves keyboard activation while detecting and reports controlled expansion', async ({
  page,
}, info) => {
  const { demo, frame, trigger, errors } = await open(page);
  const events = demo.getByRole('status', { name: 'Setup and timeline callbacks' });
  await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(events).toHaveText('["setup:original"]');
  await demo.getByRole('button', { name: 'Replace callbacks', exact: true }).click();
  await demo.getByRole('button', { name: 'Expanded', exact: true }).click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await demo.getByRole('button', { name: 'Detecting', exact: true }).click();
  await expect(trigger).toBeEnabled();
  await trigger.focus();
  await page.keyboard.press('Space');
  await expect(events).toHaveText('["setup:original","setup:updated"]');
  await demo.getByRole('textbox', { name: 'Setup command preview' }).fill('pnpm run build');
  await demo.getByRole('button', { name: 'Detecting', exact: true }).click();
  await expect(trigger).toContainText('pnpm run build');
  await trigger.click();
  await expect(events).toHaveText('["setup:original","setup:updated","setup:updated"]');
  const divider = demo.getByTestId('timeline-divider-frame');
  await divider.getByRole('button', { name: 'Review change', exact: true }).click();
  await expect(events).toHaveText(
    '["setup:original","setup:updated","setup:updated","review:updated"]',
  );
  const oldAction = await divider
    .getByRole('button', { name: 'Continue', exact: true })
    .elementHandle();
  await demo.getByRole('button', { name: 'Show timeline actions', exact: true }).click();
  expect(await oldAction.evaluate((node) => node.isConnected)).toBe(false);
  await expect(divider.getByRole('button')).toHaveCount(0);
  await demo.getByRole('button', { name: 'Show timeline actions', exact: true }).click();
  await divider.getByRole('button', { name: 'Continue', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(events).toHaveText(
    '["setup:original","setup:updated","setup:updated","review:updated","continue:updated"]',
  );
  await frame.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  await stableLocatorScreenshot(page, frame, async ({ png, attempt }) => {
    if (png) await info.attach(`setup-trigger-${attempt}`, { body: png, contentType: 'image/png' });
  });
  expect(errors).toEqual([]);
});

test('narrow setup and timeline actions remain reachable with a long command', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 280, height: 1000 });
  const { demo, frame, trigger, errors } = await open(page);
  await demo
    .getByRole('textbox', { name: 'Setup command preview' })
    .fill('pnpm install --frozen-lockfile && pnpm run build:development');
  await trigger.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  const divider = demo.getByTestId('timeline-divider-frame');
  await expect(divider.getByRole('button', { name: 'Review change', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(divider.getByRole('button', { name: 'Continue', exact: true })).toBeFocused();
  await page.keyboard.press('Space');
  await expect(demo.getByRole('status', { name: 'Setup and timeline callbacks' })).toHaveText(
    '["setup:original","review:original","continue:original"]',
  );
  for (const [name, root] of [
    ['setup-narrow', frame],
    ['timeline-narrow', divider],
  ]) {
    await root.scrollIntoViewIfNeeded();
    const geometry = await root.evaluate((node) => ({
      box: node.getBoundingClientRect().toJSON(),
      client: node.clientWidth,
      scroll: node.scrollWidth,
      viewport: document.documentElement.clientWidth,
      controls: [...node.querySelectorAll('button')].map((button) => {
        const box = button.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return { box: box.toJSON(), hit: button === hit || button.contains(hit) };
      }),
    }));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1);
    expect(geometry.box.right).toBeLessThanOrEqual(geometry.viewport);
    for (const control of geometry.controls) {
      expect(control.box.left).toBeGreaterThanOrEqual(geometry.box.left);
      expect(control.box.right).toBeLessThanOrEqual(geometry.box.right);
      expect(control.hit).toBe(true);
    }
    await info.attach(`${name}-containment.json`, {
      body: JSON.stringify(geometry),
      contentType: 'application/json',
    });
    await stableLocatorScreenshot(page, root, async ({ png, attempt }) => {
      if (png) await info.attach(`${name}-${attempt}`, { body: png, contentType: 'image/png' });
    });
  }
  expect(errors).toEqual([]);
});
