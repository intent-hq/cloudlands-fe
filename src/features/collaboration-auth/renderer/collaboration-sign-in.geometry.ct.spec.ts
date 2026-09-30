import { fileURLToPath } from 'node:url';
import { defineGeometrySnapshotSuite } from '$lib/component-catalog/geometry-snapshot';
import { test, expect } from '../../../test/ct-test';
import Preview from './collaboration-sign-in.preview.svelte';

defineGeometrySnapshotSuite({
  scene: 'collaboration-sign-in',
  component: Preview,
  states: ['github-consent', 'gitlab-pat'],
  widths: [390],
  selector: '[role="dialog"]',
  snapshotPath: fileURLToPath(
    new URL('./__geometry__/collaboration-sign-in.geometry.json', import.meta.url),
  ),
});

test('narrow GitLab sign-in keeps token and cancel controls reachable by keyboard', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 620 });
  await mount(Preview, {
    hooksConfig: { geometrySnapshot: { scene: 'collaboration-sign-in', state: 'gitlab-pat-live' } },
  });
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const overflow = await dialog.evaluate((element) => element.scrollWidth > element.clientWidth);
  expect(overflow).toBe(false);
  const token = page.getByLabel(/personal access token/);
  await token.focus();
  await expect(token).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});
