import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

async function open(page) {
  const base = process.env.REACT_BASE_URL;
  if (!base) throw new Error('Set REACT_BASE_URL');
  const errors = await observeErrors(page);
  await page.goto(
    `${base}/sandbox/navigation-content?example=interactive&theme=light&motion=reduced`,
  );
  const demo = page.getByTestId('walkthrough-comment-demo');
  await expect(demo).toBeVisible();
  const frame = demo.getByTestId('walkthrough-comment-frame');
  return { demo, frame, input: frame.getByRole('textbox'), errors };
}

test('inline comments send trimmed text with current location and preserve guarded drafts', async ({
  page,
}, info) => {
  const { demo, frame, input, errors } = await open(page);
  const sends = demo.getByRole('status', { name: 'Inline comment sends' });
  const closes = demo.getByRole('status', { name: 'Inline comment close requests' });
  await expect(input).toBeFocused();
  await input.fill('   ');
  await input.press('Enter');
  await expect(sends).toHaveText('[]');
  await expect(input).toHaveValue('   ');
  await input.fill('  Explain this change  ');
  await input.press('Shift+Enter');
  await expect(sends).toHaveText('[]');
  await demo.getByRole('button', { name: 'Change location', exact: true }).click();
  await input.press('Enter');
  await expect(sends).toHaveText(
    '[{"message":"Explain this change","line":88,"file":"src/review.ts"}]',
  );
  await expect(input).toHaveValue('');
  await input.fill('Keep this draft');
  await demo.getByRole('button', { name: 'Sending', exact: true }).click();
  await expect(input).toBeDisabled();
  // The idle source send icon is unnamed; the busy loader supplies its own accessible text.
  const send = frame.getByRole('button').filter({ hasNotText: 'Cancel' });
  await expect(send).toBeDisabled();
  await expect(input).toHaveValue('Keep this draft');
  await frame.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(closes).toHaveText('1');
  await demo.getByRole('button', { name: 'Sending', exact: true }).click();
  await input.press('Escape');
  await expect(closes).toHaveText('2');
  await expect(input).toHaveValue('Keep this draft');
  await send.click();
  await expect(sends).toHaveText(
    '[{"message":"Explain this change","line":88,"file":"src/review.ts"},{"message":"Keep this draft","line":88,"file":"src/review.ts"}]',
  );
  await expect(input).toHaveValue('');
  await input.fill('Unmounted draft');
  const original = await input.elementHandle();
  await demo.getByRole('button', { name: 'Show comment', exact: true }).click();
  expect(await original.evaluate((node) => node.isConnected)).toBe(false);
  await demo.getByRole('button', { name: 'Show comment', exact: true }).click();
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
  await frame.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  await stableLocatorScreenshot(page, frame, async ({ png, attempt }) => {
    if (png)
      await info.attach(`inline-comment-${attempt}`, { body: png, contentType: 'image/png' });
  });
  expect(errors).toEqual([]);
});

test('narrow inline comment keeps send and cancel reachable by keyboard', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 280, height: 1000 });
  const { demo, frame, input, errors } = await open(page);
  await input.fill('Check this line');
  await input.press('Tab');
  const send = frame.getByRole('button', { name: '', exact: true });
  await expect(send).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(demo.getByRole('status', { name: 'Inline comment sends' })).toHaveText(
    '[{"message":"Check this line","line":42,"file":"src/app.ts"}]',
  );
  await expect(send).toBeDisabled();
  await input.fill('Next question');
  await expect(send).toBeEnabled();
  await frame.scrollIntoViewIfNeeded();
  const geometry = await frame.evaluate((root) => ({
    bounds: root.getBoundingClientRect().toJSON(),
    viewport: document.documentElement.clientWidth,
    client: root.clientWidth,
    scroll: root.scrollWidth,
    controls: [...root.querySelectorAll('input,button')].map((node) => {
      const box = node.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return { box: box.toJSON(), hit: node === hit || node.contains(hit) };
    }),
  }));
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1);
  expect(geometry.bounds.right).toBeLessThanOrEqual(geometry.viewport);
  for (const { box, hit } of geometry.controls) {
    expect(box.left).toBeGreaterThanOrEqual(geometry.bounds.left);
    expect(box.right).toBeLessThanOrEqual(geometry.bounds.right);
    expect(hit).toBe(true);
  }
  await info.attach('inline-comment-containment.json', {
    body: JSON.stringify(geometry),
    contentType: 'application/json',
  });
  await stableLocatorScreenshot(page, frame, async ({ png, attempt }) => {
    if (png)
      await info.attach(`inline-comment-narrow-${attempt}`, {
        body: png,
        contentType: 'image/png',
      });
  });
  expect(errors).toEqual([]);
});
