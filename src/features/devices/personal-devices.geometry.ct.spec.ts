import { fileURLToPath } from 'node:url';
import { defineGeometrySnapshotSuite } from '$lib/component-catalog/geometry-snapshot';
import { test, expect } from '../../test/ct-test';
import Preview from './personal-devices.preview.svelte';

defineGeometrySnapshotSuite({
  scene: 'personal-devices',
  component: Preview,
  states: ['member', 'guest', 'owner-no-profile'],
  widths: [390],
  selector: '[data-personal-devices-ready=true]',
  snapshotPath: fileURLToPath(
    new URL('./__geometry__/personal-devices.geometry.json', import.meta.url),
  ),
});

test('personal pairing stays usable at narrow width and Escape returns to the roster', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await mount(Preview, {
    hooksConfig: { geometrySnapshot: { scene: 'personal-devices', state: 'member' } },
  });
  await expect(page.getByText('Preview phone', { exact: true })).toBeVisible();
  await page.screenshot({ path: '.demo-artifacts/personal-devices-roster.png' });
  await page.getByRole('button', { name: 'Pair another device as me' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('img')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Copy pairing link' })).toBeEnabled();
  expect(await dialog.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(false);
  await page.screenshot({ path: '.demo-artifacts/personal-devices-pairing.png' });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Preview tablet', { exact: true })).toBeVisible();
});
