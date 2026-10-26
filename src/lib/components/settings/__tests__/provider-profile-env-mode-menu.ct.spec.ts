import { expect, test } from '../../../../test/ct-test';
import ProviderProfileDialog from '../ProviderProfileDialog.svelte';

// Regression: the Value/Empty/Unset menu on the last environment row was
// clipped by the dialog body, hiding the lower options.
for (const staticPosition of [false, true]) {
  test(`last env row mode menu is fully visible (static=${staticPosition})`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 760, height: 600 });
    await mount(ProviderProfileDialog, {
      props: {
        open: true,
        static: staticPosition,
        providerId: 'claude',
        providerName: 'Claude',
        isDefault: true,
        defaultsLoad: 'success',
        defaultConfig: {
          baseProviderId: 'claude',
          providerRef: 'claude',
          name: 'Cheaper Inference',
          env: [
            { key: 'ANTHROPIC_BASE_URL', kind: 'set', value: '********' },
            { key: 'ANTHROPIC_AUTH_TOKEN', kind: 'set', value: '********' },
          ],
          settingsFingerprint: 'fp-default',
          activation: { runningProcesses: 0 },
        },
      },
    });

    const modes = page.getByRole('combobox', { name: /ANTHROPIC_AUTH_TOKEN/ });
    await modes.scrollIntoViewIfNeeded();
    await modes.click();
    const options = page.getByRole('option');
    await expect(options).toHaveCount(3);
    for (const option of await options.all()) {
      await expect
        .poll(() =>
          option.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const hit = document.elementFromPoint(
              rect.left + rect.width / 2,
              rect.top + rect.height / 2,
            );
            return hit !== null && element.contains(hit);
          }),
        )
        .toBe(true);
    }

    await options.last().click();
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(modes).not.toHaveText(/^\s*Value\s*$/);
  });
}
