import { expect, test } from '../../test/ct-test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import Harness from './__tests__/HostMembershipHarness.svelte';

const owner = {
  principalId: 'owner',
  hostRole: 'owner',
  login: null,
  displayName: 'Local owner',
  avatarUrl: null,
  addedAt: '2026-09-30T00:00:00Z',
};
const member = {
  ...owner,
  principalId: 'member',
  hostRole: 'member',
  displayName: 'Sam',
  identity: { provider: 'gitlab', host: 'forge.example:8443', externalUserId: '42' },
};
const mockBackend = {
  'host.members.list': { members: [owner, member], revision: 1 },
  'host.invite.list': { invites: [] },
};

for (const width of [390, 960]) {
  test(`host invitation consent and member controls remain accessible at ${width}px`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await mount(Harness, { hooksConfig: { mockBackend } });
    await expect(page.getByText('Local owner', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(1);
    await expect(page.getByText(/forge.example:8443.*42/)).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Account username' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Invite a host member', exact: true }).click();
    const account = page.getByRole('textbox', { name: 'Account username' });
    await account.focus();
    await page.keyboard.type('sam');
    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('button', { name: 'Create invite link', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('sam');
    await expect(dialog).toContainText('current and future workspaces');
    await expect(dialog).toContainText('repository');
    await expect(dialog).toContainText('AI');
    if (process.env.COLLABORATION_CAPTURE_DIR) {
      await mkdir(process.env.COLLABORATION_CAPTURE_DIR, { recursive: true });
      await page.screenshot({
        path: join(process.env.COLLABORATION_CAPTURE_DIR, `host-invitation-${width}.png`),
      });
    }
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(1);
    await page.getByRole('button', { name: 'Simulate member', exact: true }).click();
    await expect(page.getByTestId('host-membership-settings')).toHaveCount(0);
  });
}
