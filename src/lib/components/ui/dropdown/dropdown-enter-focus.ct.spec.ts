import { expect, test } from '../../../../test/ct-test';
import DropdownEnterFocusHarness from './DropdownEnterFocusHarness.svelte';

// Regression for intent-hq/intent#5141: selecting with Enter on a closeOnSelect
// dropdown must close it and return focus to the trigger, like Escape does,
// instead of dropping focus to <body> when the panel unmounts.
for (const portal of [false, true]) {
  test(`Enter-select from the search box returns focus to the trigger (portal: ${portal})`, async ({
    mount,
    page,
  }) => {
    await mount(DropdownEnterFocusHarness, { props: { portal } });

    const trigger = page.getByRole('button', { name: 'Pick a letter' });
    await trigger.click();
    const search = page.getByRole('searchbox', { name: 'Search options' });
    await expect(search).toBeFocused();

    await search.pressSequentially('bet');
    await expect(page.getByRole('option')).toHaveCount(1);
    await search.press('ArrowDown');
    await search.press('Enter');

    await expect(page.getByTestId('enter-focus-value')).toHaveText('beta');
    await expect(page.getByRole('listbox')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Beta' })).toBeFocused();
  });
}

test('Enter-select from a focused option returns focus to the trigger', async ({ mount, page }) => {
  await mount(DropdownEnterFocusHarness);

  await page.getByRole('button', { name: 'Pick a letter' }).click();
  const alpha = page.getByRole('option', { name: 'Alpha' });
  await alpha.focus();
  await expect(alpha).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  const gamma = page.getByRole('option', { name: 'Gamma' });
  await expect(gamma).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(page.getByTestId('enter-focus-value')).toHaveText('gamma');
  await expect(page.getByRole('listbox')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Gamma' })).toBeFocused();
});

test('Enter-select without closeOnSelect keeps the dropdown open and focus in the search box', async ({
  mount,
  page,
}) => {
  await mount(DropdownEnterFocusHarness, { props: { closeOnSelect: false } });

  await page.getByRole('button', { name: 'Pick a letter' }).click();
  const search = page.getByRole('searchbox', { name: 'Search options' });
  await expect(search).toBeFocused();

  await search.pressSequentially('alp');
  await expect(page.getByRole('option')).toHaveCount(1);
  await search.press('ArrowDown');
  await search.press('Enter');

  await expect(page.getByTestId('enter-focus-value')).toHaveText('alpha');
  await expect(page.getByRole('listbox')).toBeVisible();
  await expect(search).toBeFocused();
});
