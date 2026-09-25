import { test, expect } from '../../../../test/ct-test';
import Harness from './combobox.test-harness.svelte';

for (const multiple of [false, true]) {
  test(`${multiple ? 'multiple' : 'single'} combobox reopens on click while already focused`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const component = await mount(Harness, {
      props: { multiple, value: multiple ? [] : '' },
    });
    const input = page.getByRole('combobox', { name: 'Search people' });
    const listbox = page.getByRole('listbox');

    await input.focus();
    await expect(listbox).toBeVisible();
    await input.press('Escape');
    await expect(input).toHaveAttribute('aria-expanded', 'false');
    await expect(listbox).toBeHidden();
    await expect(input).toBeFocused();

    await input.click();
    await expect(input).toHaveAttribute('aria-expanded', 'true');
    await expect(listbox).toBeVisible();
    await expect(input).toBeFocused();
    await input.click();
    await expect(listbox).toBeVisible();

    await page.getByRole('option', { name: 'Grace Hopper', exact: true }).click();
    await expect(component.getByTestId('combobox-value')).toHaveText(
      multiple ? '["grace"]' : '"grace"',
    );
    await input.press('Escape');
    await expect(listbox).toBeHidden();
    await expect(input).toBeFocused();

    await input.press('ArrowDown');
    await expect(listbox).toBeVisible();
    await input.press('Home');
    await input.press('Enter');
    await expect(component.getByTestId('combobox-value')).toHaveText(
      multiple ? '["grace","ada"]' : '"ada"',
    );
    await input.press('Escape');
    await expect(listbox).toBeHidden();
    await expect(input).toBeFocused();

    await input.click();
    await expect(listbox).toBeVisible();
    await page.mouse.click(1200, 700);
    await expect(listbox).toBeHidden();

    await component.update({ props: { multiple, value: multiple ? [] : '', disabled: true } });
    await expect(input).toBeDisabled();
    const box = await input.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await expect(input).toHaveAttribute('aria-expanded', 'false');
    await expect(listbox).toBeHidden();
  });
}
