import { expect, test } from '../../test/ct-test';
import { expectDismissibleLayerArmed } from '../../test/dismissible-layer';
import SessionImportTabPreview from './session-import-tab.preview.svelte';

test('the provider filter and Refresh keep the codebase picker on its Sessions tab', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mount(SessionImportTabPreview, {
    hooksConfig: { previewScene: { scene: 'session-import-tab', state: 'selector-open' } },
  });
  const picker = page.getByRole('dialog');
  // Reach Sessions from the codebase list, as a user does: the session list's layer
  // then opens above the picker's own and handles the outside interactions.
  await picker.getByRole('button', { name: 'Go back' }).click();
  await picker.getByTestId('repo-form-import-session').click();
  const claudeRow = picker.getByRole('option', { name: /Cloudflare account installation/ });
  const codexRow = picker.getByRole('option', { name: /Migrate the billing webhooks/ });
  await expect(claudeRow).toBeVisible();
  await expect(codexRow).toBeVisible();

  // Armed, the list's layer sees the filter click as an outside interaction.
  await expectDismissibleLayerArmed(claudeRow);
  await picker.getByRole('radio', { name: 'Codex' }).click();
  await expect(picker).toBeVisible();
  await expect(picker.getByRole('radio', { name: 'Codex' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(codexRow).toBeVisible();
  await expect(claudeRow).toHaveCount(0);

  await expectDismissibleLayerArmed(codexRow);
  await picker.getByRole('radio', { name: 'All' }).click();
  await expect(picker).toBeVisible();
  await expect(claudeRow).toBeVisible();

  await expectDismissibleLayerArmed(claudeRow);
  await picker.getByTestId('import-session-refresh').click();
  await expect(picker).toBeVisible();
  await expect(picker.getByTestId('import-session-tab')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
});
