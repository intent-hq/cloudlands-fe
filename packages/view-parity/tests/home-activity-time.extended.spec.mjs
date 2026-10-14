import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

async function openDemo(page) {
  if (!process.env.REACT_BASE_URL) throw new Error('Set REACT_BASE_URL');
  const errors = await observeErrors(page);
  await page.setViewportSize({ width: 420, height: 900 });
  await page.goto(
    `${process.env.REACT_BASE_URL}/sandbox/popovers?example=interactive&theme=light&motion=reduced`,
  );
  const demo = page.getByTestId('home-activity-demo');
  const frame = demo.getByTestId('home-activity-frame');
  await expect(frame).toBeVisible();
  return { errors, demo, frame };
}

test('Home activity uses content then creation then unknown as caller timestamps change', async ({
  page,
}, info) => {
  const { errors, demo, frame } = await openDemo(page);
  const content = frame.getByLabel('Conversation or note activity', { exact: true });
  await expect(content).toBeVisible();
  const oldText = await content.textContent();
  await demo.getByRole('button', { name: 'Creation fallback' }).click();
  const created = frame.getByLabel('Workspace created', { exact: true });
  await expect(created).toBeVisible();
  await expect(created).not.toHaveText(oldText);
  await demo.getByRole('button', { name: 'Unknown time' }).click();
  await expect(frame.getByLabel('Activity time unavailable', { exact: true })).toHaveText('—');
  await demo.getByRole('button', { name: 'Content activity', exact: true }).click();
  await expect(content).toHaveText(oldText);
  await info.attach('activity-geometry.json', {
    body: JSON.stringify(
      await frame.evaluate((root) => ({
        frame: root.getBoundingClientRect().toJSON(),
        timestamps: [...root.querySelectorAll('[data-slot="tooltip-trigger"]')].map((node) =>
          node.getBoundingClientRect().toJSON(),
        ),
      })),
    ),
    contentType: 'application/json',
  });
  await stableLocatorScreenshot(page, demo, async ({ png, attempt }) => {
    if (png) await info.attach(`home-activity-${attempt}`, { body: png, contentType: 'image/png' });
  });
  expect(errors).toEqual([]);
});

test('Home activity exposes its reason and full date through native Tab navigation', async ({
  page,
}, info) => {
  const { errors, demo, frame } = await openDemo(page);
  const observations = [];
  await demo.scrollIntoViewIfNeeded();
  await stableLocatorScreenshot(page, demo, async ({ png, attempt }) => {
    if (png)
      await info.attach(`activity-keyboard-ready-${attempt}`, {
        body: png,
        contentType: 'image/png',
      });
  });
  await page.exposeFunction('recordActivityFocus', (value) => observations.push(value));
  await page.evaluate(() => {
    for (const type of ['focusin', 'focusout', 'scroll', 'tooltip.open']) {
      window.addEventListener(
        type,
        (event) =>
          window.recordActivityFocus({
            type,
            target:
              event.target instanceof window.Element
                ? event.target.outerHTML.slice(0, 300)
                : 'document',
            active: document.activeElement?.outerHTML.slice(0, 300),
            y: window.scrollY,
            triggers: [
              ...document.querySelectorAll(
                '[data-testid="home-activity-frame"] [data-slot="tooltip-trigger"]',
              ),
            ].map((node) => ({ state: node.getAttribute('data-state'), tabIndex: node.tabIndex })),
          }),
        { capture: true },
      );
    }
  });
  try {
    await demo.getByRole('button', { name: 'Before timestamp' }).click();
    await page.keyboard.press('Tab');
    await expect(frame.getByLabel('Conversation or note activity', { exact: true })).toBeFocused();
    await expect(
      page.getByRole('tooltip', { name: 'Conversation or note activity', exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(frame.locator('[data-slot="tooltip-trigger"]').nth(1)).toBeFocused();
    await expect(page.getByRole('tooltip').filter({ hasText: '2025' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Tab');
    await expect(demo.getByRole('button', { name: 'After timestamp' })).toBeFocused();
    expect(errors).toEqual([]);
  } finally {
    await info.attach('activity-focus-events.json', {
      body: JSON.stringify(observations),
      contentType: 'application/json',
    });
  }
});

test('Home activity retires its hovered timestamp and remounts current fallback props', async ({
  page,
}) => {
  const { errors, demo, frame } = await openDemo(page);
  const timestamp = frame.locator('[data-slot="tooltip-trigger"]').nth(1);
  const previous = await timestamp.elementHandle();
  await timestamp.hover();
  await expect(page.getByRole('tooltip').filter({ hasText: '2025' })).toBeVisible();
  await demo.getByRole('button', { name: 'Show timestamp' }).click();
  await expect(frame.locator('[data-slot="tooltip-trigger"]')).toHaveCount(0);
  await expect(page.getByRole('tooltip').filter({ hasText: '2025' })).toHaveCount(0);
  expect(await previous.evaluate((node) => node.isConnected)).toBe(false);
  await demo.getByRole('button', { name: 'Creation fallback' }).click();
  await demo.getByRole('button', { name: 'Show timestamp' }).click();
  await expect(frame.getByLabel('Workspace created', { exact: true })).toBeVisible();
  await frame.locator('[data-slot="tooltip-trigger"]').nth(1).hover();
  await expect(page.getByRole('tooltip').filter({ hasText: '2024' })).toBeVisible();
  expect(errors).toEqual([]);
});
