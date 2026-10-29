import { expect, test } from '../../../../test/ct-test';
import ProviderDisableHost from './mocks/ProviderDisableHost.svelte';

for (const status of ['signed-out', 'pending', 'unavailable'] as const) {
  test(`disables a specialist-pinned provider while ${status}`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await mount(ProviderDisableHost, { props: { status } });
    await page
      .getByRole('button', { name: 'Provider actions for Augment Auggie', exact: true })
      .click();
    const disable = page.getByRole('menuitem', { name: 'Disable', exact: true });
    await expect(disable).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath('disable-available.png') });
    await disable.click();
    await expect
      .poll(async () => JSON.parse(await page.getByTestId('enabled').innerText()).auggie)
      .toBe(false);
    await expect(page.getByRole('region', { name: 'Enabled', exact: true })).not.toContainText(
      'Augment Auggie',
    );
    await page.screenshot({ path: testInfo.outputPath('provider-disabled.png') });
  });
}

test('disables the default and allows it to be enabled again', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 650 });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await mount(ProviderDisableHost);
  await page.getByRole('button', { name: 'Provider actions for Codex', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('default-disable-available.png') });
  await page.getByRole('menuitem', { name: 'Disable', exact: true }).click();
  await expect
    .poll(async () => JSON.parse(await page.getByTestId('enabled').innerText()).codex)
    .toBe(false);
  for (const name of ['Claude Code', 'Augment Auggie']) {
    await page.getByRole('button', { name: `Provider actions for ${name}`, exact: true }).click();
    await page.getByRole('menuitem', { name: 'Disable', exact: true }).click();
  }
  await expect(page.getByRole('region', { name: 'Enabled', exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('all-providers-disabled.png') });
  const row = page
    .getByRole('button', { name: 'Provider actions for Codex', exact: true })
    .locator('xpath=ancestor::div[@data-slot="settings-section-body"]');
  await row.getByRole('button', { name: 'Enable', exact: true }).click();
  await expect
    .poll(async () => JSON.parse(await page.getByTestId('enabled').innerText()).codex)
    .toBe(true);
});
