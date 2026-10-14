import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

async function openDemo(page, theme = 'light') {
  if (!process.env.REACT_BASE_URL) throw new Error('Set REACT_BASE_URL');
  const errors = await observeErrors(page);
  await page.setViewportSize({ width: 420, height: 900 });
  await page.goto(
    `${process.env.REACT_BASE_URL}/sandbox/sidebar?example=interactive&theme=${theme}&motion=reduced`,
  );
  const demo = page.getByTestId('panel-corner-demo');
  const handle = demo.getByRole('button', { name: 'Resize panel corner', exact: true });
  await expect(handle).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await demo.scrollIntoViewIfNeeded();
  return {
    demo,
    handle,
    errors,
    state: async () => JSON.parse(await demo.locator('output').textContent()),
  };
}

async function startDrag(page, handle) {
  const box = await handle.boundingBox();
  const point = {
    x: Math.round(box.x + box.width - 3),
    y: Math.round(box.y + box.height - 3),
  };
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  return point;
}

test('corner drag uses incremental current callbacks and releases across a real iframe', async ({
  page,
}, info) => {
  const { demo, handle, errors, state } = await openDemo(page);
  const frame = page.getByTestId('panel-corner-frame');
  await demo.getByRole('button', { name: 'Before resize handle', exact: true }).click();
  await page.keyboard.press('Tab');
  await expect(handle).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Space');
  expect((await state()).events).toEqual([]);
  await page.keyboard.press('Tab');
  await expect(
    demo.getByRole('button', { name: 'After resize handle', exact: true }),
  ).toBeFocused();
  await handle.hover();
  const before = await handle.boundingBox();
  await stableLocatorScreenshot(page, frame, async ({ png, attempt }) => {
    if (png) await info.attach(`corner-before-${attempt}`, { body: png, contentType: 'image/png' });
  });

  await demo.getByRole('button', { name: 'Replace callbacks', exact: true }).click();
  const start = await startDrag(page, handle);
  await page.mouse.move(start.x + 12, start.y + 9);
  await expect
    .poll(async () => (await state()).events)
    .toEqual([
      { kind: 'start', revision: 2 },
      { kind: 'move', revision: 2, x: 12, y: 9 },
    ]);
  await page.mouse.move(start.x + 12, start.y + 9);
  expect((await state()).events).toHaveLength(2);
  await page.keyboard.press('Enter');
  const iframe = demo.locator('iframe');
  const target = await iframe.boundingBox();
  const destination = {
    x: Math.round(target.x + target.width / 2),
    y: Math.round(target.y + target.height / 2),
  };
  await page.mouse.move(destination.x, destination.y);
  await page.mouse.up();
  const expected = {
    offset: { x: destination.x - start.x, y: destination.y - start.y },
    events: [
      { kind: 'start', revision: 2 },
      { kind: 'move', revision: 2, x: 12, y: 9 },
      {
        kind: 'move',
        revision: 3,
        x: destination.x - start.x - 12,
        y: destination.y - start.y - 9,
      },
      { kind: 'end', revision: 3 },
    ],
  };
  await expect.poll(state).toEqual(expected);
  expect(
    await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, {
      x: target.x + 10,
      y: target.y + 10,
    }),
  ).toBe('IFRAME');
  await page.mouse.move(0, 0);
  expect(await state()).toEqual(expected);
  const after = await handle.boundingBox();
  await info.attach('corner-geometry.json', {
    body: JSON.stringify({ before, after }),
    contentType: 'application/json',
  });
  await stableLocatorScreenshot(page, frame, async ({ png, attempt }) => {
    if (png) await info.attach(`corner-after-${attempt}`, { body: png, contentType: 'image/png' });
  });
  expect(errors).toEqual([]);
});

for (const retire of ['start', 'move', 'owner']) {
  test(`corner drag cleans up when retired by ${retire}`, async ({ page }, info) => {
    const { demo, handle, errors, state } = await openDemo(page, 'dark');
    if (retire !== 'owner') {
      await demo.getByRole('button', { name: `Retire on ${retire}`, exact: true }).click();
    } else {
      await demo.getByRole('button', { name: 'Unmount handle', exact: true }).click();
      await demo.getByRole('button', { name: 'Mount handle', exact: true }).click();
    }
    const original = await handle.elementHandle();
    const start = await startDrag(page, handle);
    if (retire === 'move') await page.mouse.move(start.x + 10, start.y + 8);
    if (retire === 'owner') await page.keyboard.press('Enter');
    await expect(handle).toHaveCount(0);
    expect(await original.evaluate((node) => node.isConnected)).toBe(false);
    const retired = await state();
    expect(retired.events.map(({ kind }) => kind)).toEqual(
      retire === 'move' ? ['start', 'move'] : ['start'],
    );
    await page.mouse.move(start.x + 22, start.y + 18);
    await page.mouse.up();
    expect(await state()).toEqual(retired);
    const target = await demo.locator('iframe').boundingBox();
    expect(
      await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, {
        x: target.x + 10,
        y: target.y + 10,
      }),
    ).toBe('IFRAME');
    if (retire !== 'owner')
      await demo.getByRole('button', { name: `Retire on ${retire}`, exact: true }).click();
    await demo.getByRole('button', { name: 'Mount handle', exact: true }).click();
    await expect(handle).toBeVisible();
    const remounted = await startDrag(page, handle);
    await page.mouse.move(remounted.x + 6, remounted.y + 5);
    await page.mouse.up();
    await expect
      .poll(async () => (await state()).events.slice(-3).map(({ kind }) => kind))
      .toEqual(['start', 'move', 'end']);
    await page.mouse.move(0, 0);
    await stableLocatorScreenshot(
      page,
      page.getByTestId('panel-corner-frame'),
      async ({ png, attempt }) => {
        if (png)
          await info.attach(`corner-${retire}-${attempt}`, { body: png, contentType: 'image/png' });
      },
    );
    expect(errors).toEqual([]);
  });
}
