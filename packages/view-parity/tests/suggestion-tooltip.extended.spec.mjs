import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

async function openDemo(page) {
  if (!process.env.REACT_BASE_URL) throw new Error('Set REACT_BASE_URL');
  const errors = await observeErrors(page);
  await page.setViewportSize({ width: 420, height: 900 });
  await page.goto(
    `${process.env.REACT_BASE_URL}/sandbox/local-editor?example=interactive&theme=light&motion=reduced`,
  );
  const demo = page.getByTestId('suggestion-tooltip-demo');
  const frame = demo.getByTestId('suggestion-tooltip-frame');
  const accept = frame.getByRole('button', { name: 'Accept', exact: true });
  const reject = frame.getByRole('button', { name: 'Reject', exact: true });
  await expect(accept).toBeVisible();
  return {
    demo,
    frame,
    accept,
    reject,
    errors,
    events: async () => JSON.parse(await demo.locator('output').textContent()),
  };
}

test('suggestion actions use current props and callbacks with native keyboard activation', async ({
  page,
}, info) => {
  const { demo, frame, accept, reject, events, errors } = await openDemo(page);
  await expect(frame).toContainText('Modification');
  await expect(frame).toContainText('by Ada');
  await expect(frame).toContainText(
    'Preserve <strong>literal text</strong> and current callbacks.',
  );
  await expect(frame.locator('strong')).toHaveCount(0);
  await expect(frame).toContainText('Original:');
  await frame.scrollIntoViewIfNeeded();
  const geometry = await frame.evaluate((root) => ({
    bounds: root.getBoundingClientRect().toJSON(),
    viewport: window.innerWidth,
    controls: [...root.querySelectorAll('button')].map((node) => {
      const box = node.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return { bounds: box.toJSON(), hit: node === hit || node.contains(hit) };
    }),
  }));
  expect(
    geometry.controls.every(
      (control) =>
        control.hit && control.bounds.left >= 0 && control.bounds.right <= geometry.viewport,
    ),
  ).toBe(true);
  await info.attach('suggestion-tooltip-geometry.json', {
    body: JSON.stringify(geometry),
    contentType: 'application/json',
  });
  await stableLocatorScreenshot(page, frame, async ({ png, attempt }) => {
    if (png)
      await info.attach(`suggestion-tooltip-${attempt}`, { body: png, contentType: 'image/png' });
  });
  await accept.focus();
  await page.keyboard.press('Enter');
  expect(await events()).toEqual([{ action: 'accept', id: 'suggestion-1', revision: 1 }]);
  await demo.getByRole('button', { name: 'Update suggestion', exact: true }).click();
  await demo.getByRole('button', { name: 'addition', exact: true }).click();
  await expect(frame).toContainText('Addition');
  await expect(frame).not.toContainText('Original:');
  await demo.getByRole('button', { name: 'Hide optional details', exact: true }).click();
  await expect(frame).not.toContainText('by Ada');
  await expect(frame).not.toContainText('Preserve');
  await accept.focus();
  await page.keyboard.press('Tab');
  await expect(reject).toBeFocused();
  await page.keyboard.press('Space');
  expect(await events()).toEqual([
    { action: 'accept', id: 'suggestion-1', revision: 1 },
    { action: 'reject', id: 'suggestion-2', revision: 2 },
  ]);
  await demo.getByRole('button', { name: 'deletion', exact: true }).click();
  await expect(frame).toContainText('Deletion');
  await demo.getByRole('button', { name: 'Omit callbacks', exact: true }).click();
  await accept.click();
  await reject.click();
  expect(await events()).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('suggestion coordinates update in place and parent retirement removes old controls', async ({
  page,
}) => {
  const { demo, frame, accept, reject, events, errors } = await openDemo(page);
  const original = await accept.elementHandle();
  const origin = await accept.evaluate((node) => ({
    x: node.getBoundingClientRect().x,
    y:
      node.getBoundingClientRect().y -
      node.closest('[data-testid="suggestion-tooltip-frame"]').getBoundingClientRect().y,
  }));
  await demo.getByRole('button', { name: 'Move suggestion', exact: true }).click();
  await expect
    .poll(async () => {
      const moved = await accept.evaluate((node) => ({
        x: node.getBoundingClientRect().x,
        y:
          node.getBoundingClientRect().y -
          node.closest('[data-testid="suggestion-tooltip-frame"]').getBoundingClientRect().y,
      }));
      return { x: moved.x - origin.x, y: moved.y - origin.y };
    })
    .toEqual({ x: 24, y: 12 });
  expect(await original.evaluate((node) => node.isConnected)).toBe(true);
  await demo.getByRole('button', { name: 'Retire on action', exact: true }).click();
  await accept.click();
  await expect(frame.getByRole('button')).toHaveCount(0);
  expect(await original.evaluate((node) => node.isConnected)).toBe(false);
  expect(await events()).toEqual([{ action: 'accept', id: 'suggestion-1', revision: 1 }]);
  await demo.getByRole('button', { name: 'Update suggestion', exact: true }).click();
  await demo.getByRole('button', { name: 'After suggestion', exact: true }).click();
  await page.keyboard.press('Enter');
  expect(await events()).toHaveLength(1);
  await demo.getByRole('button', { name: 'Remount suggestion', exact: true }).click();
  await reject.focus();
  await page.keyboard.press('Enter');
  await expect(frame.getByRole('button')).toHaveCount(0);
  expect(await events()).toEqual([
    { action: 'accept', id: 'suggestion-1', revision: 1 },
    { action: 'reject', id: 'suggestion-2', revision: 2 },
  ]);
  expect(errors).toEqual([]);
});
