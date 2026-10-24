import { test, expect } from '../../../test/ct-test';
import ProviderSelector from './ProviderSelector.svelte';

test('base token changes preserve named profiles in the same Providers pane', async ({
  mount,
  page,
}) => {
  await mount(ProviderSelector, {
    hooksConfig: { previewScene: { scene: 'provider-selector', state: 'access-tokens-profiles' } },
  });
  const profiles = page.getByTestId('provider-profiles-codex');
  await expect(profiles.getByText('Work', { exact: true })).toBeVisible();
  await expect(profiles.getByText('Personal', { exact: true })).toBeVisible();
  const input = page.locator('#provider-token-claude-code');
  await input.fill('synthetic-preview-token');
  await page.getByRole('button', { name: 'Save token', exact: true }).click();
  await expect(input).toHaveValue('');
  await expect(page.getByText('Token saved · not verified')).toHaveCount(2);
  await page.getByRole('button', { name: 'Remove token', exact: true }).first().click();
  await expect(page.getByText('No token saved')).toHaveCount(1);
  await expect(profiles.getByText('Work', { exact: true })).toBeVisible();
  await expect(profiles.getByText('Personal', { exact: true })).toBeVisible();
  await expect(page.getByTestId('provider-profile-row')).toHaveCount(3);
});

test('token controls remain keyboard accessible in a narrow Providers pane', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await mount(ProviderSelector, {
    hooksConfig: { previewScene: { scene: 'provider-selector', state: 'access-tokens' } },
  });
  const input = page.locator('#provider-token-claude-code');
  await expect(input).toBeVisible();
  expect((await input.boundingBox())?.width).toBeGreaterThanOrEqual(180);
  expect((await page.locator('#provider-token-codex').boundingBox())?.width).toBeGreaterThanOrEqual(
    180,
  );
  await input.fill('synthetic-preview-token');
  await input.focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Save token', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(input).toHaveValue('');
  await expect(page.getByText('Token saved · not verified')).toHaveCount(2);
  await page.getByRole('button', { name: 'Remove token', exact: true }).first().click();
  await expect(page.getByText('No token saved')).toHaveCount(1);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
});
