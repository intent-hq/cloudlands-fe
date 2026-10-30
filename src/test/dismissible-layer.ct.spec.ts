import { expect, test } from './ct-test';
import { expectDismissibleLayerArmed } from './dismissible-layer';
import ComboboxHarness from '../lib/components/ui/combobox/combobox.test-harness.svelte';
import DropdownHarness from '../lib/components/ui/dropdown/DropdownEnterFocusHarness.svelte';
import SelectHarness from '../lib/components/ui/select/select.test-harness.svelte';

// expectDismissibleLayerArmed against real bits-ui layers. cloudlands-fe#3718
// first pointed three waits at getByRole('listbox'), which sits inside the
// element bits-ui registers ([data-select-content] / [data-combobox-content]),
// and they timed out. A descendant of the layer must be enough.

for (const portal of [false, true]) {
  test(`waits on select content through its listbox (portal: ${portal})`, async ({
    mount,
    page,
  }) => {
    const root = await mount(SelectHarness, { props: { portal, searchable: true } });
    const trigger = root.getByRole('combobox', { name: 'Choose fruit' });
    await trigger.focus();
    await trigger.press('Enter');
    const listbox = page.getByRole('listbox');
    await expect(listbox).toBeVisible();
    const content = page.locator('[data-select-content]');
    await expect(content.getByRole('listbox')).toHaveCount(1);
    await expect(content).not.toHaveAttribute('role', 'listbox');

    await expectDismissibleLayerArmed(listbox);
    await root.getByRole('button', { name: 'Outside action' }).click();
    await expect(listbox).toHaveCount(0);
  });

  test(`waits on combobox content through an option (portal: ${portal})`, async ({
    mount,
    page,
  }) => {
    await mount(ComboboxHarness, { props: { portal } });
    await page.evaluate(() => {
      const outside = document.createElement('button');
      outside.type = 'button';
      outside.textContent = 'Outside action';
      Object.assign(outside.style, { position: 'fixed', right: '16px', bottom: '16px' });
      document.body.append(outside);
    });
    const input = page.getByRole('combobox', { name: 'Search people' });
    await input.click();
    const listbox = page.getByRole('listbox');
    await expect(listbox).toBeVisible();
    const content = page.locator('[data-combobox-content]');
    await expect(content.getByRole('listbox')).toHaveCount(1);
    await expect(content).not.toHaveAttribute('role', 'listbox');

    await expectDismissibleLayerArmed(page.getByRole('option', { name: 'Ada Lovelace' }));
    await page.getByRole('button', { name: 'Outside action' }).click();
    await expect(listbox).toBeHidden();
  });
}

test('rejects the custom ui/dropdown popup, which is not a bits-ui layer', async ({
  mount,
  page,
}) => {
  await mount(DropdownHarness);
  await page.getByRole('button', { name: 'Pick a letter' }).click();
  const listbox = page.getByRole('listbox');
  await expect(listbox).toBeVisible();

  const failure = await expectDismissibleLayerArmed(listbox, { timeout: 1_000 }).then(
    () => undefined,
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
  expect(failure).toContain('no bits-ui layer contains <');
  expect(failure).toContain('ui/dropdown are not bits-ui layers');
});
