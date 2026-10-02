import { fileURLToPath } from 'node:url';
import { defineGeometrySnapshotSuite } from '$lib/component-catalog/geometry-snapshot';
import { test, expect } from '../../../test/ct-test';
import Preview from './collaboration-settings.preview.svelte';

defineGeometrySnapshotSuite({
  scene: 'collaboration-settings',
  component: Preview,
  states: ['owner-empty', 'owner-populated', 'member', 'unknown'],
  widths: [390, 1100],
  snapshotPath: fileURLToPath(
    new URL('./__geometry__/collaboration-settings.geometry.json', import.meta.url),
  ),
});

for (const state of ['member', 'unknown', 'disabled']) {
  test(`${state} cannot invite members from Collaboration settings`, async ({ mount, page }) => {
    await mount(Preview, {
      hooksConfig: { geometrySnapshot: { scene: 'collaboration-settings', state } },
    });
    await expect(
      page.getByRole('button', { name: 'Invite a host member', exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('region', { name: 'Share this instance', exact: true }),
    ).toHaveCount(0);
    if (state === 'member') {
      await expect(page.getByTestId('collaboration-current-identity')).toContainText('Taylor Chen');
      await expect(page.getByTestId('guest-sessions-joined')).toContainText('Studio host');
    } else if (state === 'unknown') {
      await expect(page.getByRole('button', { name: 'Sign in for collaboration' })).toBeDisabled();
    } else {
      await expect(page.getByTestId('collaboration-current-identity')).toHaveCount(0);
    }
  });
}

test('unlinked owner opens and cancels invitation using the keyboard without losing the page', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await mount(Preview, {
    hooksConfig: { geometrySnapshot: { scene: 'collaboration-settings', state: 'owner-empty' } },
  });
  const invite = page.getByRole('button', { name: 'Invite a host member', exact: true });
  const account = page.getByRole('textbox', { name: 'Account username' });
  await expect(account).toHaveCount(0);
  await invite.focus();
  await page.keyboard.press('Enter');
  await expect(account).toBeVisible();
  await expect(
    page.getByText('Access to all current and future workspaces', { exact: true }),
  ).toBeVisible();
  const cancel = page
    .locator('#host-invitation-form')
    .getByRole('button', { name: 'Cancel', exact: true });
  await page.keyboard.press('Tab');
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(account).toHaveCount(0);
  await expect(invite).toBeFocused();
  await expect(page.getByTestId('guest-sessions-joined')).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
});

test('current identity remains distinct from the host roster and joined host identity', async ({
  mount,
  page,
}) => {
  await mount(Preview, {
    hooksConfig: {
      geometrySnapshot: { scene: 'collaboration-settings', state: 'owner-populated' },
    },
  });
  await expect(page.getByTestId('collaboration-current-identity')).toContainText('Taylor Chen');
  await expect(page.getByTestId('collaboration-current-identity')).not.toContainText(
    'Instance owner',
  );
  await expect(page.getByTestId('hosted-workspace-roster')).toContainText('Design system');
  await expect(page.getByTestId('hosted-workspace-roster')).toContainText('Jules Martin');
  await expect(page.getByTestId('guest-sessions-joined')).toContainText('taylor-work');
  await expect(page.getByRole('button', { name: 'Remove all guests', exact: true })).toBeVisible();
});
