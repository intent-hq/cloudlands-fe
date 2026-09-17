import { expect, test } from '@playwright/experimental-ct-svelte';
import Preview from './select-focus.preview.svelte';

for (const { mode, ...props } of [
  { mode: 'inline', portal: false, staticPosition: false },
  { mode: 'portalled', portal: true, staticPosition: false },
  { mode: 'static', portal: false, staticPosition: true },
]) {
  test(`${mode} Select restores search Escape focus without stealing outside-click focus`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const root = await mount(Preview, { props });
    const trigger = root.getByRole('combobox', { name: 'Choose fruit' });
    await trigger.focus();
    await trigger.press('Enter');
    const search = page.getByRole('textbox', { name: 'Filter fruit' });
    await search.fill('fixture');
    await expect(search).toBeFocused();
    await search.press('Escape');
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(root.getByTestId('select-value')).toHaveText('apple');

    await trigger.press('Enter');
    await search.fill('fixture');
    const outside = root.getByRole('button', { name: 'Outside action' });
    await outside.click();
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await expect(outside).toBeFocused();

    await trigger.focus();
    await trigger.press('Enter');
    await trigger.press('ArrowDown');
    await trigger.press('Enter');
    await expect(root.getByTestId('select-value')).toHaveText('banana');
    await expect(trigger).toBeFocused();
  });
}
