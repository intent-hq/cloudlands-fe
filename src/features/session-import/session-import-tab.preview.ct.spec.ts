import { expect, test } from '../../test/ct-test';
import { expectDismissibleLayerArmed } from '../../test/dismissible-layer';
import SessionImportTabPreview from './session-import-tab.preview.svelte';

test('the Sessions tab controls keep the codebase picker open; an outside click closes it', async ({
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

  // The picker's own Back and tab controls act instead of closing it.
  await expectDismissibleLayerArmed(claudeRow);
  await picker.getByRole('tab', { name: 'Existing folder' }).click();
  await expect(picker.getByRole('tab', { name: 'Existing folder' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await picker.getByRole('tab', { name: 'Sessions' }).click();
  await expect(claudeRow).toBeVisible();

  await expectDismissibleLayerArmed(claudeRow);
  await picker.getByRole('button', { name: 'Go back' }).click();
  await expect(picker.getByTestId('repo-form-import-session')).toBeVisible();

  // A click outside the picker still closes it.
  await picker.getByTestId('repo-form-import-session').click();
  await expect(claudeRow).toBeVisible();
  await expectDismissibleLayerArmed(claudeRow);
  await page.mouse.click(1260, 880);
  await expect(picker).toHaveCount(0);
});
