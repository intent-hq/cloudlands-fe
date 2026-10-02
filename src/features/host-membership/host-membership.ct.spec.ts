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
  login: 'sam',
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
    await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toHaveCount(0);
    const roster = page.getByRole('list', { name: 'Host members', exact: true });
    await expect(roster).toContainText('Sam');
    await expect(roster).toContainText('Host member · @sam · GitLab (forge.example:8443)');
    await expect(roster).not.toContainText('gitlab@');
    await expect(roster).not.toContainText('42');
    await expect(page.getByRole('textbox', { name: 'Account username' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Invite a host member', exact: true }).click();
    const account = page.getByRole('textbox', { name: 'Account username' });
    await expect(account).toBeFocused();
    await page.keyboard.type('sam');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('checkbox')).toBeFocused();
    await page.keyboard.press('Space');
    const dialog = page.getByRole('dialog', { name: 'Invite to this instance', exact: true });
    await expect(dialog).toBeVisible();
    await expect(account).toHaveValue('sam');
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
    await expect(
      page.getByRole('button', { name: 'Invite a host member', exact: true }),
    ).toBeFocused();
    if (process.env.COLLABORATION_CAPTURE_DIR) {
      await page.screenshot({
        path: join(process.env.COLLABORATION_CAPTURE_DIR, `host-page-${width}.png`),
      });
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(1);
    await page.getByRole('button', { name: 'Simulate member', exact: true }).click();
    await expect(page.getByTestId('host-membership-settings')).toHaveCount(0);
  });
}

test('an invitation stays inside the dialog during create and copy, with no duplicate submission', async ({
  mount,
  page,
}) => {
  const invite = {
    id: 'created',
    scope: 'host',
    role: 'member',
    createdByPrincipalId: 'owner',
    pinLogin: 'sam',
    pinIdentity: { provider: 'github', host: 'github.com', externalUserId: '2' },
    reusable: false,
    redemptionCount: 0,
    createdAt: '2026-10-02T00:00:00Z',
    expiresAt: '2026-10-09T00:00:00Z',
  };
  const url = 'intent://invite?controlled-modal-test=1';
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await mount(Harness, {
    hooksConfig: {
      mockBackend: {
        ...mockBackend,
        'host.invite.list': { invites: [{ ...invite, url }] },
        'host.invite.create': {
          invite,
          url,
          secret: 'controlled-test-only',
          hosts: [],
          port: 8080,
          fingerprint: 'test',
          version: 1,
        },
      },
    },
  });
  await page.getByRole('button', { name: 'Invite a host member', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Invite to this instance', exact: true });
  await dialog.getByRole('textbox', { name: 'Account username' }).fill('sam');
  await expect(dialog.getByRole('button', { name: 'Create invite link' })).toBeDisabled();
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Create invite link' }).click();
  await expect(dialog.getByRole('status')).toContainText('New invite link');
  await expect(dialog.getByRole('button', { name: 'Create invite link' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Copy link' }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(url);
  await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Open invites' })).toContainText('@sam');
});

for (const [action, width] of [
  ['Remove', 390],
  ['Revoke', 960],
] as const) {
  test(`${action} confirmation waits for current authority at ${width}px`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await mount(Harness, {
      props: { confirmationRevalidation: true },
      hooksConfig: {
        mockBackend: {
          ...mockBackend,
          'host.invite.list': {
            invites: [
              {
                id: 'original-invite',
                scope: 'host',
                role: 'member',
                createdByPrincipalId: 'owner',
                pinLogin: 'sam',
                pinIdentity: { provider: 'github', host: 'github.com', externalUserId: '2' },
                reusable: false,
                redemptionCount: 0,
                createdAt: '2026-10-02T00:00:00Z',
                expiresAt: '2026-10-09T00:00:00Z',
              },
            ],
          },
          'host.members.remove': {},
          'host.invite.revoke': {},
        },
      },
    });
    await page.getByRole('button', { name: action, exact: true }).click();
    const dialog = page.getByRole('dialog');
    const confirm = dialog.getByRole('button', { name: action, exact: true });
    await expect(confirm).toBeEnabled();
    // Controlled event injection stays available while the modal makes its page inert.
    await page
      .getByTestId('suspend-authority')
      .evaluate((node) => (node as HTMLButtonElement).click());
    await expect(confirm).toBeDisabled();
    await dialog.press('Enter');
    await expect(dialog).toBeVisible();
    if (process.env.COLLABORATION_CAPTURE_DIR) {
      await mkdir(process.env.COLLABORATION_CAPTURE_DIR, { recursive: true });
      await page.screenshot({
        path: join(
          process.env.COLLABORATION_CAPTURE_DIR,
          `confirmation-${action}-${width}-disabled.png`,
        ),
      });
    }
    await page
      .getByTestId('restore-authority')
      .evaluate((node) => (node as HTMLButtonElement).click());
    await expect(confirm).toBeEnabled();
    await expect(dialog).toBeVisible();
    if (process.env.COLLABORATION_CAPTURE_DIR) {
      await page.screenshot({
        path: join(
          process.env.COLLABORATION_CAPTURE_DIR,
          `confirmation-${action}-${width}-ready.png`,
        ),
      });
    }
    await confirm.click();
    await expect(dialog).toHaveCount(0);
  });
}
