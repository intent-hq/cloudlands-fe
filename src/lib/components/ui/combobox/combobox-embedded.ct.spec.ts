import { expect, test } from '../../../../test/ct-test';
import { expectDismissibleLayerArmed } from '../../../../test/dismissible-layer';
import Harness from './combobox-embedded.test-harness.svelte';

// Regression (cloudlands-fe#4674): a static list inside a popover closed the popover
// when a control beside it was clicked. Open the popover first and the list second,
// as a user does, so the list's layer is the top one and handles the click.
test('a static list keeps its popover open for clicks inside the popover', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 800, height: 600 });
  await mount(Harness);
  await page.getByRole('button', { name: 'Choose person' }).click();
  const picker = page.getByRole('dialog', { name: 'Person picker' });
  await expect(picker).toBeVisible();
  await expectDismissibleLayerArmed(picker);

  const input = picker.getByRole('combobox', { name: 'Person' });
  await input.click();
  const option = picker.getByRole('option', { name: 'Ada Lovelace' });
  await expect(option).toBeVisible();
  await expectDismissibleLayerArmed(option);

  // bits-ui decides an outside click 10 ms after pointerdown. The second click waits for
  // the button to be stable over two frames first, so it only lands if the popover stayed.
  const filter = picker.getByRole('button', { name: 'Filter' });
  await filter.click();
  await expect(page.getByTestId('embedded-filter')).toHaveText('pioneers');
  await filter.click();
  await expect(page.getByTestId('embedded-filter')).toHaveText('all');
  await expect(input).toHaveAttribute('aria-expanded', 'true');
  await expect(option).toBeVisible();

  await expectDismissibleLayerArmed(option);
  await page.mouse.click(780, 580);
  await expect(picker).toHaveCount(0);
});
