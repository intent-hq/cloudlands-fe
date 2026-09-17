import { expect, test } from '@playwright/experimental-ct-svelte';
import Harness from './__tests__/PanelFindBarTestHarness.svelte';

test('find input stays box-free while keyboard search and action focus remain usable', async ({
  mount,
  page,
}, testInfo) => {
  const calls: string[] = [];
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(Harness, {
    props: {
      onNext: (query: string) => calls.push(`next:${query}`),
      onPrevious: (query: string) => calls.push(`previous:${query}`),
      onClose: () => calls.push('close'),
    },
  });
  await page.evaluate(() => document.fonts.ready);
  const input = page.getByRole('textbox', { name: 'Test find' });
  const before = await input.boundingBox();
  const restingShadow = await input.evaluate((element) => getComputedStyle(element).boxShadow);
  await page.keyboard.press('Tab');
  await expect(input).toBeFocused();
  await expect(input).toHaveCSS('outline-style', 'none');
  // Tailwind shadow-none serializes as transparent layers, not the literal "none".
  await expect(input).toHaveCSS('box-shadow', restingShadow);
  expect(await input.boundingBox()).toEqual(before);
  await page.getByRole('search').screenshot({ path: testInfo.outputPath('focused-find-bar.png') });

  await page.keyboard.type('needle');
  await expect(page.getByTestId('bound-query')).toHaveText('needle');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Shift+Enter');
  await expect.poll(() => calls).toEqual(['next:needle', 'previous:needle']);

  await page.keyboard.press('Tab');
  const previous = page.getByRole('button', { name: 'Previous match' });
  await expect(previous).toBeFocused();
  await expect(previous).toHaveCSS('outline-style', 'solid');
  await expect(previous).toHaveCSS('outline-width', '1px');
  await page.keyboard.press('Enter');
  await expect.poll(() => calls).toEqual(['next:needle', 'previous:needle', 'previous:needle']);
  await page.keyboard.press('Shift+Tab');
  await expect(input).toBeFocused();
  await page.keyboard.press('Escape');
  await expect.poll(() => calls.at(-1)).toBe('close');
});
