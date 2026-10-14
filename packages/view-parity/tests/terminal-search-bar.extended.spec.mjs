import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

async function openDemo(page, width = 900) {
  if (!process.env.REACT_BASE_URL) throw new Error('Set REACT_BASE_URL');
  const errors = await observeErrors(page);
  await page.setViewportSize({ width, height: 1100 });
  await page.goto(
    `${process.env.REACT_BASE_URL}/sandbox/popovers?example=interactive&theme=light&motion=reduced`,
  );
  const demo = page.getByTestId('terminal-search-demo');
  await expect(demo).toBeVisible();
  const frame = demo.getByTestId('terminal-search-frame');
  const input = frame.getByRole('textbox', { name: 'Find in panel' });
  const seed = demo.getByRole('textbox', { name: 'Seed query' });
  const events = async () =>
    JSON.parse(await demo.getByRole('status', { name: 'Terminal search callbacks' }).textContent());
  return { errors, demo, frame, input, seed, events };
}

test('terminal search consumes each seed trigger once and retains edits across close and reopen', async ({
  page,
}, info) => {
  const { errors, demo, input, seed, events } = await openDemo(page);
  await demo.getByRole('button', { name: 'Open search', exact: true }).click();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('alpha');
  expect(await events()).toEqual([
    { kind: 'next', query: 'alpha', revision: 'original', visibleQuery: '' },
  ]);
  await input.fill('draft');
  await seed.fill('  beta  ');
  await expect(input).toHaveValue('draft');
  expect(await events()).toHaveLength(1);
  const trigger = demo.getByRole('button', { name: 'New focus trigger' });
  await trigger.click();
  await expect(input).toHaveValue('beta');
  expect(await events()).toEqual([
    { kind: 'next', query: 'alpha', revision: 'original', visibleQuery: '' },
    { kind: 'next', query: 'beta', revision: 'original', visibleQuery: 'draft' },
  ]);
  await info.attach('focus-trigger-observation.json', {
    body: JSON.stringify({
      inputFocused: await input.evaluate((node) => document.activeElement === node),
      triggerFocused: await trigger.evaluate((node) => document.activeElement === node),
      qualification:
        'Historical source refocus limitation remains open; seed delivery does not establish refocus acceptance.',
    }),
    contentType: 'application/json',
  });
  await demo.getByRole('button', { name: 'Close search', exact: true }).click();
  await expect(input).toHaveCount(0);
  await seed.fill('gamma');
  await demo.getByRole('button', { name: 'Open search', exact: true }).click();
  await expect(input).toHaveValue('beta');
  expect(await events()).toHaveLength(2);
  await seed.fill('   ');
  await trigger.click();
  await seed.fill('unused seed');
  await expect(input).toHaveValue('beta');
  expect(await events()).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('terminal search uses current callbacks for keyboard and pointer navigation, including no matches', async ({
  page,
}) => {
  const { errors, demo, frame, input, seed, events } = await openDemo(page);
  await seed.fill('');
  await demo.getByRole('button', { name: 'Open search', exact: true }).click();
  const next = frame.getByRole('button', { name: 'Next match', exact: true });
  const previous = frame.getByRole('button', { name: 'Previous match', exact: true });
  await expect(next).toBeDisabled();
  await expect(previous).toBeDisabled();
  await input.pressSequentially('needle');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Shift+Enter');
  await expect(frame.getByText('2 of 3', { exact: true })).toBeVisible();
  await demo.getByRole('button', { name: 'Replace callbacks' }).click();
  await demo.getByRole('button', { name: 'No matches', exact: true }).click();
  await expect(frame.getByText('No results', { exact: true })).toBeVisible();
  await expect(next).toBeEnabled();
  await next.click();
  await previous.click();
  expect((await events()).map(({ kind, query, revision }) => ({ kind, query, revision }))).toEqual([
    { kind: 'next', query: 'needle', revision: 'original' },
    { kind: 'previous', query: 'needle', revision: 'original' },
    { kind: 'next', query: 'needle', revision: 'updated' },
    { kind: 'previous', query: 'needle', revision: 'updated' },
  ]);
  await input.focus();
  await page.keyboard.press('Escape');
  await expect(input).toHaveCount(0);
  expect((await events()).at(-1)).toEqual({
    kind: 'close',
    query: '',
    revision: 'updated',
    visibleQuery: 'needle',
  });
  expect(errors).toEqual([]);
});

test('terminal search retires its input and handles a caller closing during seed delivery', async ({
  page,
}) => {
  const { errors, demo, input, events } = await openDemo(page);
  await demo.getByRole('button', { name: 'Open search', exact: true }).click();
  await expect(input).toHaveValue('alpha');
  const retired = await input.elementHandle();
  await demo.getByRole('button', { name: 'Mount search owner' }).click();
  expect(await retired.evaluate((node) => node.isConnected)).toBe(false);
  await page.keyboard.press('Escape');
  expect(await events()).toHaveLength(1);
  await demo.getByRole('button', { name: 'Mount search owner' }).click();
  await expect(input).toHaveValue('alpha');
  expect(await events()).toHaveLength(2);
  await demo.getByRole('button', { name: 'Close on find' }).click();
  await demo.getByRole('button', { name: 'New focus trigger' }).click();
  await expect(input).toHaveCount(0);
  expect(await events()).toHaveLength(3);
  await demo.getByRole('button', { name: 'Open search', exact: true }).click();
  await expect(input).toHaveValue('alpha');
  expect(await events()).toHaveLength(3);
  expect(errors).toEqual([]);
});

test('terminal search leaves its input and all actions reachable at narrow width', async ({
  page,
}, info) => {
  const { errors, demo, frame, input } = await openDemo(page, 420);
  await demo.getByRole('button', { name: 'Open search', exact: true }).click();
  await expect(input).toHaveValue('alpha');
  await frame.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  const geometry = await frame.evaluate((root) => {
    const bounds = root.getBoundingClientRect();
    const controls = [...root.querySelectorAll('button,input')].map((node) => {
      const rect = node.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return { bounds: rect.toJSON(), hit: hit === node || node.contains(hit) };
    });
    return { bounds: bounds.toJSON(), controls };
  });
  await info.attach('terminal-search-geometry.json', {
    body: JSON.stringify(geometry),
    contentType: 'application/json',
  });
  expect(geometry.controls).toHaveLength(4);
  for (const control of geometry.controls) {
    expect(control.hit).toBe(true);
    expect(control.bounds.left).toBeGreaterThanOrEqual(geometry.bounds.left);
    expect(control.bounds.right).toBeLessThanOrEqual(geometry.bounds.right);
  }
  await stableLocatorScreenshot(page, frame, async ({ png, attempt }) => {
    if (png)
      await info.attach(`terminal-search-${attempt}`, { body: png, contentType: 'image/png' });
  });
  await frame.getByRole('button', { name: 'Close find', exact: true }).click();
  await expect(input).toHaveCount(0);
  expect(errors).toEqual([]);
});
