import { expect, test } from '../../../../../test/ct-test';
import ModelPickerSettingsHost from './ModelPickerSettingsHost.svelte';

for (const consumer of ['specialist', 'default'] as const) {
  test(`keeps supported effort and clears unsupported effort through ${consumer} settings`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mount(ModelPickerSettingsHost, { props: { consumer } });
    const trigger = page
      .getByTestId('settings-consumer')
      .getByRole('button', { name: /First model/ });
    await trigger.click();
    const effort = page.getByTestId('effort-picker-trigger');
    await expect(effort).toHaveText('High');
    await page.getByRole('option', { name: 'Second model', exact: true }).click();
    await expect(effort).toHaveText('High');
    const selection = page.getByTestId('settings-selection');
    if (consumer === 'specialist') {
      await expect(selection).toContainText('"model":"second","hint":"","reasoningEffort":"high"');
    } else {
      await expect(selection).toContainText('"defaultEffort":"high"');
    }
    await page.getByRole('option', { name: 'Third model', exact: true }).click();
    await expect(effort).toHaveText('Auto');
    if (consumer === 'specialist') {
      await expect(selection).toContainText('"model":"third","hint":""}');
    } else {
      await expect(selection).toContainText('"defaultEffort":""');
    }
    await effort.click();
    await page
      .locator('[data-slot="select-content"]')
      .getByRole('option', { name: 'Max', exact: true })
      .click();
    await expect(effort).toHaveText('Max');
    if (consumer === 'specialist') {
      await expect(selection).toContainText('"model":"third","hint":"","reasoningEffort":"max"');
    } else {
      await expect(selection).toContainText('"defaultEffort":"max"');
    }
    await page.getByRole('option', { name: 'Plain model', exact: true }).click();
    await expect(effort).toHaveCount(0);
    // A model without effort remains browsable so another model can be chosen.
    await page.getByRole('option', { name: 'Second model', exact: true }).click();
    await expect(effort).toHaveText('Auto');
  });
}
