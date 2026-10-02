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

test('narrow device-capable GitLab keeps token entry secondary and restores focusable device choice', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 620 });
  await mount(Preview, {
    hooksConfig: {
      geometrySnapshot: { scene: 'collaboration-sign-in', state: 'gitlab-device-ready-live' },
    },
  });
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel(/personal access token/)).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Sign in with GitLab', exact: true }),
  ).toBeVisible();
  const tokenChoice = page.getByRole('button', { name: 'Use a token instead' });
  await tokenChoice.focus();
  await page.keyboard.press('Enter');
  const token = page.getByLabel(/personal access token/);
  await expect(token).toBeVisible();
  await token.focus();
  await expect(token).toBeFocused();
  expect(await dialog.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(false);
  await page.getByRole('button', { name: 'Use device authorization instead' }).click();
  await expect(token).toHaveCount(0);
  const signIn = page.getByRole('button', { name: 'Sign in with GitLab', exact: true });
  await signIn.focus();
  await expect(signIn).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});
