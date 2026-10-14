import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

const stamp = (milliseconds) => new Date(Date.UTC(2026, 0, 1) + milliseconds).toISOString();

async function openDemo(page, width = 900) {
  const base = process.env.REACT_BASE_URL;
  if (!base) throw new Error('Set REACT_BASE_URL');
  const errors = await observeErrors(page);
  await page.setViewportSize({ width, height: 1100 });
  await page.goto(`${base}/sandbox/popovers?example=interactive&theme=light&motion=reduced`);
  const demo = page.getByTestId('time-scrubber-demo');
  const frame = demo.getByTestId('time-scrubber-frame');
  const slider = frame.getByRole('slider');
  const callbacks = demo.getByRole('status', { name: 'Scrubber callbacks' });
  await expect(slider).toBeVisible();
  const events = async () => JSON.parse(await callbacks.textContent());
  return { errors, demo, frame, slider, callbacks, events };
}

test('scrubber retains caller-held seeking and accepts current external values and callbacks', async ({
  page,
}) => {
  const { errors, demo, slider, events } = await openDemo(page);
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await expect(demo.getByRole('status', { name: 'Caller time' })).toHaveText(stamp(5001));
  await demo.getByRole('button', { name: 'Hold caller time' }).click();
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveValue(String(Date.parse(stamp(5002))));
  await expect(demo.getByRole('status', { name: 'Caller time' })).toHaveText(stamp(5001));
  await demo.getByRole('button', { name: 'Publish seven seconds' }).click();
  await expect(slider).toHaveValue(String(Date.parse(stamp(7000))));
  await demo.getByRole('button', { name: 'Replace callbacks' }).click();
  await slider.focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('End');
  await page.keyboard.press('End');
  expect(await events()).toEqual([
    { kind: 'seek', time: stamp(5001), revision: 'original' },
    { kind: 'seek', time: stamp(5002), revision: 'original' },
    { kind: 'seek', time: stamp(0), revision: 'updated' },
    { kind: 'seek', time: stamp(10000), revision: 'updated' },
  ]);
  const retired = await slider.elementHandle();
  await demo.getByRole('button', { name: 'Show scrubber' }).click();
  expect(await retired.evaluate((node) => node.isConnected)).toBe(false);
  await page.keyboard.press('ArrowRight');
  expect(await events()).toHaveLength(4);
  await demo.getByRole('button', { name: 'Show scrubber' }).click();
  await expect(slider).toHaveValue(String(Date.parse(stamp(7000))));
  expect(errors).toEqual([]);
});

test('scrubber pauses live mode before an ordinary caller receives endpoint seeks', async ({
  page,
}) => {
  const { errors, frame, slider, events } = await openDemo(page);
  await frame.getByRole('button', { name: 'Paused', exact: true }).click();
  await expect(slider).toHaveValue(String(Date.parse(stamp(10000))));
  await expect(frame.getByRole('button', { name: 'Live', exact: true })).toBeVisible();
  await slider.scrollIntoViewIfNeeded();
  const bounds = await slider.boundingBox();
  await page.mouse.move(bounds.x + 1, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await expect(frame.getByRole('button', { name: 'Paused', exact: true })).toBeVisible();
  await expect(slider).toHaveValue(String(Date.parse(stamp(0))));
  await page.mouse.move(bounds.x + bounds.width - 1, bounds.y + bounds.height / 2);
  await page.mouse.up();
  await expect(slider).toHaveValue(String(Date.parse(stamp(10000))));
  expect(await events()).toEqual([
    { kind: 'live', time: stamp(10000), revision: 'original' },
    { kind: 'seek', time: stamp(10000), revision: 'original' },
    { kind: 'seek', time: stamp(0), revision: 'original' },
    { kind: 'seek', time: stamp(10000), revision: 'original' },
  ]);
  expect(errors).toEqual([]);
});

test('scrubber disables invalid ranges and accepts an external time after range recovery', async ({
  page,
}, info) => {
  const { errors, demo, slider, events } = await openDemo(page);
  const observed = [];
  for (const name of ['Equal range', 'Reversed range', 'Restore range']) {
    await demo.getByRole('button', { name, exact: true }).click();
    if (name === 'Restore range') await expect(slider).toBeEnabled();
    else await expect(slider).toBeDisabled();
    observed.push({ state: name, value: await slider.inputValue() });
  }
  expect(await events()).toEqual([]);
  await info.attach('range-recovery-observation.json', {
    body: JSON.stringify({
      observations: observed,
      qualification:
        'Current React observations only; historical Svelte range-recovery difference remains open.',
    }),
    contentType: 'application/json',
  });
  await demo.getByRole('button', { name: 'Publish seven seconds' }).click();
  await expect(slider).toHaveValue(String(Date.parse(stamp(7000))));
  await slider.focus();
  await page.keyboard.press('Home');
  expect(await events()).toEqual([{ kind: 'seek', time: stamp(0), revision: 'original' }]);
  expect(errors).toEqual([]);
});

test('scrubber remains keyboard operable without clipping its controls at narrow width', async ({
  page,
}, info) => {
  const { errors, frame, slider, events } = await openDemo(page, 420);
  await frame.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  const geometry = await frame.evaluate((root) => ({
    bounds: root.getBoundingClientRect().toJSON(),
    client: root.clientWidth,
    scroll: root.scrollWidth,
    controls: [...root.querySelectorAll('button,[data-slot="slider-track"]')].map((node) => {
      const rect = node.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return { bounds: rect.toJSON(), hit: node === hit || node.contains(hit) };
    }),
  }));
  await info.attach('time-scrubber-geometry.json', {
    body: JSON.stringify(geometry),
    contentType: 'application/json',
  });
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1);
  expect(geometry.controls.every((control) => control.hit)).toBe(true);
  expect(geometry.controls.every((control) => control.bounds.width > 0)).toBe(true);
  const track = frame.locator('[data-slot="slider-track"]');
  const textOverlaps = await frame.evaluate((root) => {
    const track = root.querySelector('[data-slot="slider-track"]').getBoundingClientRect();
    const walker = document.createTreeWalker(root, window.NodeFilter.SHOW_TEXT);
    const overlapping = [];
    while (walker.nextNode()) {
      if (!walker.currentNode.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(walker.currentNode);
      const text = range.getBoundingClientRect();
      if (
        text.left < track.right &&
        text.right > track.left &&
        text.top < track.bottom &&
        text.bottom > track.top
      )
        overlapping.push(walker.currentNode.textContent);
    }
    return overlapping;
  });
  expect(textOverlaps).toEqual([]);
  await stableLocatorScreenshot(page, frame, async ({ png, attempt }) => {
    if (png) await info.attach(`time-scrubber-${attempt}`, { body: png, contentType: 'image/png' });
  });
  await slider.focus();
  await page.keyboard.press('End');
  expect(await events()).toEqual([{ kind: 'seek', time: stamp(10000), revision: 'original' }]);
  await track.click({ position: { x: 1, y: 10 } });
  await expect(slider).toHaveValue(String(Date.parse(stamp(0))));
  expect(await events()).toEqual([
    { kind: 'seek', time: stamp(10000), revision: 'original' },
    { kind: 'seek', time: stamp(0), revision: 'original' },
  ]);
  expect(errors).toEqual([]);
});
