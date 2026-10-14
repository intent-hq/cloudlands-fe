import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

test('comment initials follow name updates while remaining outside keyboard and accessible content', async ({
  page,
}, info) => {
  const base = process.env.REACT_BASE_URL;
  if (!base) throw new Error('Set REACT_BASE_URL');
  const errors = await observeErrors(page);
  await page.goto(
    `${base}/sandbox/principal-avatar?example=interactive&theme=light&motion=reduced`,
  );
  const demo = page.getByTestId('initials-avatar-demo');
  const frame = demo.getByTestId('initials-avatar-frame');
  const author = demo.getByRole('textbox', { name: 'Comment author preview' });
  for (const [name, initials] of [
    ['Ada Lovelace', 'AL'],
    ['   grace   hopper   ', 'GH'],
    ['Élodie Šimek', 'ÉŠ'],
    ['Cher', 'C'],
    ['', '?'],
    ['   ', ''],
  ]) {
    await author.fill(name);
    await expect(frame).toHaveText(initials);
  }
  await author.fill('Ada Lovelace');
  await expect(frame).toHaveText('AL');
  expect(await frame.ariaSnapshot()).toBe('');
  await author.press('Tab');
  await expect(demo.getByRole('button', { name: 'After initials', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(demo.getByRole('status', { name: 'After initials activations' })).toHaveText('1');
  const size = demo.getByRole('textbox', { name: 'Avatar size preview' });
  for (const value of ['-10', 'NaN', 'Infinity', '32']) {
    await size.fill(value);
    await expect(frame).toHaveText('AL');
    await author.focus();
    await author.press('Tab');
    await expect(demo.getByRole('button', { name: 'After initials', exact: true })).toBeFocused();
  }
  await demo.getByRole('button', { name: 'Show initials', exact: true }).click();
  await expect(frame).toBeEmpty();
  await author.fill('Grace Hopper');
  await demo.getByRole('button', { name: 'Show initials', exact: true }).click();
  await expect(frame).toHaveText('GH');
  expect(await frame.ariaSnapshot()).toBe('');
  await frame.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  await stableLocatorScreenshot(page, frame, async ({ png, attempt }) => {
    if (png)
      await info.attach(`initials-avatar-${attempt}`, { body: png, contentType: 'image/png' });
  });
  expect(errors).toEqual([]);
});
