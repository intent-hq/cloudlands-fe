import { fileURLToPath } from 'node:url';
import { defineGeometrySnapshotSuite } from '$lib/component-catalog/geometry-snapshot';
import { test, expect } from '../../../test/ct-test';
import Preview from './collaboration-settings.preview.svelte';

defineGeometrySnapshotSuite({
  scene: 'collaboration-settings',
  component: Preview,
  states: ['owner-empty', 'owner-populated', 'member', 'unknown', 'mixed-sharing'],
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
      await expect(page.getByTestId('guest-sessions-instances')).toContainText('Studio host');
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
  await expect(account).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(account).toHaveCount(0);
  await expect(invite).toBeFocused();
  await expect(page.getByTestId('guest-sessions-instances')).toBeVisible();
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
  await expect(page.getByTestId('guest-sessions-instances')).toContainText('taylor-work');
  await expect(page.getByRole('button', { name: 'Remove all guests', exact: true })).toBeVisible();
});

for (const state of ['remote-member', 'remote-empty', 'remote-unknown']) {
  test(`${state} shows only this host identity without local sign-in`, async ({ mount, page }) => {
    await mount(Preview, {
      hooksConfig: { geometrySnapshot: { scene: 'collaboration-settings', state } },
    });
    await expect(page.getByRole('button', { name: /Sign in/ })).toHaveCount(0);
    const summary = page.getByTestId('collaboration-current-identity');
    if (state === 'remote-member') {
      await expect(summary).toContainText('Robin Patel');
      await expect(summary).toContainText('gitlab.example');
      await expect(summary).not.toContainText('Taylor Chen');
    } else if (state === 'remote-empty') {
      await expect(summary).toContainText('No collaboration identity is linked to your user');
      await expect(summary).not.toContainText('Sign in');
    } else {
      await expect(summary).toContainText('unavailable until this connection is ready');
    }
  });
}

for (const width of [390, 1100]) {
  test(`separates real workspace sharing from joined instances at ${width}px`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await mount(Preview, {
      hooksConfig: {
        geometrySnapshot: { scene: 'collaboration-settings', state: 'mixed-sharing' },
      },
    });
    const instances = page.getByRole('region', { name: 'Joined instances', exact: true });
    await expect(instances.locator('[data-session-id]')).toHaveCount(1);
    await expect(instances).toContainText('Studio host');
    await expect(instances.getByTestId('guest-session-workspaces')).toHaveCount(0);
    await expect(
      instances.getByRole('button', { name: 'Leave instance', exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Ordinary private work', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Pending workspace invitation', { exact: true })).toBeVisible();
    await expect(page.getByText('Pending invitations: 1', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Manage sharing', exact: true })).toBeVisible();
    await expect(page.getByText('Guests 0/10', { exact: true })).toHaveCount(0);
    await expect(page.getByText('No items', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Direct shared project', { exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
  });
}
