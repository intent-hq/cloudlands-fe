import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

async function openDemo(page) {
  if (!process.env.REACT_BASE_URL) throw new Error('Set REACT_BASE_URL');
  const errors = await observeErrors(page);
  const creates = [];
  page.on('websocket', (socket) =>
    socket.on('framesent', ({ payload }) => {
      try {
        const message = JSON.parse(String(payload));
        if (message.method === 'agent.create') creates.push(message);
      } catch {
        /* Non-JSON protocol frames are not agent requests. */
      }
    }),
  );
  await page.setViewportSize({ width: 420, height: 900 });
  await page.goto(
    `${process.env.REACT_BASE_URL}/sandbox/sidebar?example=interactive&theme=light&motion=reduced`,
  );
  const demo = page.getByTestId('create-agent-demo');
  const trigger = demo.getByRole('button', { name: 'Create new agent', exact: true });
  await expect(trigger).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await demo.scrollIntoViewIfNeeded();
  return {
    demo,
    trigger,
    errors,
    creates,
    events: async () => JSON.parse(await demo.locator('output').textContent()),
  };
}

test('creation control preserves precedence, current callbacks and literal-null fallback', async ({
  page,
}, info) => {
  const { demo, trigger, errors, creates, events } = await openDemo(page);
  const frame = page.getByTestId('create-agent-frame');
  const before = await trigger.boundingBox();
  await stableLocatorScreenshot(page, frame, async ({ png, attempt }) => {
    if (png) await info.attach(`creation-full-${attempt}`, { body: png, contentType: 'image/png' });
  });
  await trigger.click();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Space');
  expect(await events()).toEqual(
    Array.from({ length: 3 }, () => ({ kind: 'primary', revision: 1 })),
  );
  await demo.getByRole('button', { name: 'Replace callbacks', exact: true }).click();
  await demo.getByRole('button', { name: 'Primary callback', exact: true }).click();
  await trigger.click();
  expect((await events()).at(-1)).toEqual({ kind: 'specialist', revision: 2, specialist: null });
  await demo.getByRole('button', { name: 'Specialist callback', exact: true }).click();
  await trigger.click();
  await page.keyboard.press('Enter');
  expect(await events()).toHaveLength(4);
  await demo.getByRole('button', { name: 'Compact control', exact: true }).click();
  await trigger.click();
  expect(await events()).toHaveLength(4);
  const after = await trigger.boundingBox();
  expect(after.x).toBeGreaterThanOrEqual(0);
  expect(after.x + after.width).toBeLessThanOrEqual(420);
  await info.attach('creation-geometry.json', {
    body: JSON.stringify({ before, after }),
    contentType: 'application/json',
  });
  expect(creates).toEqual([]);
  expect(errors).toEqual([]);
});

test('compact creation control supports tooltip, keyboard activation and parent retirement', async ({
  page,
}, info) => {
  const { demo, trigger, errors, creates, events } = await openDemo(page);
  await demo.getByRole('button', { name: 'Compact control', exact: true }).click();
  await trigger.hover();
  const popup = page.locator('[data-tooltip-content]').filter({ hasText: 'Create new agent' });
  await expect(popup).toBeVisible();
  await stableLocatorScreenshot(page, popup, async ({ png, attempt, before, after, changes }) => {
    await info.attach(`creation-tooltip-context-${attempt}`, {
      body: JSON.stringify({ before, after, changes }),
      contentType: 'application/json',
    });
    if (png)
      await info.attach(`creation-tooltip-${attempt}`, { body: png, contentType: 'image/png' });
  });
  await page.keyboard.press('Escape');
  await expect(popup).toHaveCount(0);
  await demo.getByRole('button', { name: 'Before creation control', exact: true }).click();
  await page.keyboard.press('Tab');
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Space');
  expect(await events()).toEqual([
    { kind: 'primary', revision: 1 },
    { kind: 'primary', revision: 1 },
  ]);
  await demo.getByRole('button', { name: 'Retire on activation', exact: true }).click();
  await demo.getByRole('button', { name: 'Replace callbacks', exact: true }).click();
  const original = await trigger.elementHandle();
  await trigger.click();
  await expect(trigger).toHaveCount(0);
  await expect(popup).toHaveCount(0);
  expect(await original.evaluate((node) => node.isConnected)).toBe(false);
  expect((await events()).at(-1)).toEqual({ kind: 'primary', revision: 2 });
  await demo.getByRole('button', { name: 'Remount control', exact: true }).click();
  await trigger.click();
  await expect(trigger).toHaveCount(0);
  expect(await events()).toHaveLength(4);
  expect(creates).toEqual([]);
  expect(errors).toEqual([]);
});
