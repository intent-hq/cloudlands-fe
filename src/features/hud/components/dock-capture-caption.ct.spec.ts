import { expect, test } from '../../../test/ct-test';
import Harness from './__tests__/DockCaptureCaptionHarness.svelte';

test('pointer and keyboard keep mode selection and draft intact', async ({ mount, page }) => {
  const harness = await mount(Harness);
  const draft = page.getByRole('textbox', { name: 'Synthetic draft' });
  const trigger = page.getByRole('button', { name: 'Open screenshot options' });
  await draft.fill('Keep this selected draft');
  await draft.evaluate((field: HTMLTextAreaElement) => field.setSelectionRange(2, 10));
  await trigger.hover();
  const menu = page.getByRole('menu', { name: 'Screenshot options' });
  await expect(menu).toBeVisible();
  await expect(draft).toBeFocused();
  await expect(harness).toHaveAttribute('data-selections', '[]');
  expect(
    await draft.evaluate((field: HTMLTextAreaElement) => [
      field.selectionStart,
      field.selectionEnd,
    ]),
  ).toEqual([2, 10]);
  await trigger.focus();
  await trigger.press('ArrowUp');
  await expect(menu.getByRole('menuitemradio', { name: 'Full screen', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitemradio', { name: 'Window', exact: true })).toBeFocused();
  await expect(
    menu.getByRole('menuitemradio', { name: 'Full screen', exact: true }),
  ).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(draft).toHaveValue('Keep this selected draft');
  await expect(harness).toHaveAttribute('data-selections', '[]');
});
