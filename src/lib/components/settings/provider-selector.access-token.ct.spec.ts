import { fileURLToPath } from 'node:url';
import { defineGeometrySnapshotSuite } from '$lib/component-catalog/geometry-snapshot';
import { test, expect } from '../../../test/ct-test';
import ProviderSelector from './ProviderSelector.svelte';

defineGeometrySnapshotSuite({
  scene: 'provider-selector',
  component: ProviderSelector,
  states: ['access-tokens', 'mixed'],
  widths: [390, 720],
  snapshotPath: fileURLToPath(
    new URL('./__geometry__/provider-selector.geometry.json', import.meta.url),
  ),
});

test('token controls remain keyboard accessible in a narrow Providers pane', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await mount(ProviderSelector, {
    hooksConfig: { geometrySnapshot: { scene: 'provider-selector', state: 'access-tokens' } },
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
