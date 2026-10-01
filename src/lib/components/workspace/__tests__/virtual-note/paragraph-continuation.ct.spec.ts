import { test, expect } from '../../../../../test/ct-test';
import Harness from './DocumentProofHarness.svelte';

test('opens and edits one paragraph larger than 64KiB through a bounded view', async ({
  mount,
  page,
}) => {
  await mount(Harness, { props: { paragraphRepeats: 2048 } });
  await expect(page.locator('.tiptap')).toHaveCount(1);
  await page.keyboard.type('NEW');
  await expect(page.locator('.tiptap')).toContainText('NEWrepeated');
  const snapshot = JSON.parse(await page.getByTestId('snapshot').innerText());
  expect(snapshot.activeBytes).toBeLessThanOrEqual(16384);
  expect(snapshot.maxParsedBytes).toBeLessThanOrEqual(16384);
  expect(snapshot.error).toBe('');
});

import Pair from './ParagraphProofHarness.svelte';
import { focus, settled, selectSource, logical, sameSaved, type Host } from './paragraph-browser';
const root = (page: import('@playwright/test').Page) =>
  page.getByTestId('bounded').getByTestId('proof');

for (const direction of ['forward', 'backward'] as const)
  test(`one paragraph: ${direction} native selection survives a continuation replacement`, async ({
    mount,
    page,
  }) => {
    await mount(Pair);
    await expect(page.getByTestId('native').locator('.tiptap')).toHaveCount(1);
    if (direction === 'backward') await root(page).evaluate((el) => (el as Host).proof.seek(4096));
    const initial = await root(page).evaluate((el) => (el as Host).proof.created);
    const start = direction === 'forward' ? 3582 : 2562;
    for (const side of ['native', 'bounded']) {
      await selectSource(page, side, start);
      for (let i = 0; i < 8; i++)
        await page.keyboard.press(direction === 'forward' ? 'Shift+ArrowRight' : 'Shift+ArrowLeft');
      await settled(page);
    }
    await sameSaved(page);
    expect(await root(page).evaluate((el) => (el as Host).proof.created)).toBeGreaterThan(initial);
    expect(await logical(page, 'bounded')).toEqual({
      anchor: start,
      head: start + (direction === 'forward' ? 8 : -8),
    });
    for (const side of ['native', 'bounded']) {
      await focus(page, side);
      await page.keyboard.type('NEW');
    }
    await sameSaved(page);
  });

for (const key of ['Backspace', 'Delete', 'Enter'] as const)
  test(`one paragraph: ${key} at the old window edge, undo and redo match native`, async ({
    mount,
    page,
  }) => {
    await mount(Pair);
    await expect(page.getByTestId('native').locator('.tiptap')).toHaveCount(1);
    const original = await root(page).evaluate((el) => (el as Host).proof.service.region(0));
    for (const side of ['native', 'bounded']) {
      await selectSource(page, side, 4090);
      await settled(page);
      await focus(page, side);
      await page.keyboard.press(key);
      await settled(page);
    }
    await sameSaved(page);
    const expected =
      key === 'Backspace'
        ? original.slice(0, 4089) + original.slice(4090)
        : key === 'Delete'
          ? original.slice(0, 4090) + original.slice(4091)
          : original.slice(0, 4090) + '\n\n' + original.slice(4090);
    expect(await root(page).evaluate((el) => (el as Host).proof.service.region(0))).toBe(expected);
    for (const side of ['native', 'bounded']) {
      await focus(page, side);
      await page.keyboard.press('Control+z');
    }
    await sameSaved(page);
    expect(await root(page).evaluate((el) => (el as Host).proof.service.region(0))).toBe(original);
    for (const side of ['native', 'bounded']) {
      await focus(page, side);
      await page.keyboard.press('Control+Shift+z');
    }
    await sameSaved(page);
    if (key === 'Enter') {
      for (const side of ['native', 'bounded']) {
        await focus(page, side);
        await page.keyboard.press('Backspace');
      }
      await sameSaved(page);
      expect(await root(page).evaluate((el) => (el as Host).proof.service.region(0))).toBe(
        original,
      );
    }
  });
