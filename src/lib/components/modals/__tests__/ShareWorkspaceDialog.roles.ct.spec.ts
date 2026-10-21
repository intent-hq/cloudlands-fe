import { expect, test } from '../../../../test/ct-test';
import type { WorkspaceMember } from '$features/workspace-sharing/types';
import type { WorkspaceGuestRole } from '$shared/types';
import ShareWorkspaceDialog from '../ShareWorkspaceDialog.svelte';

const members: WorkspaceMember[] = [
  {
    principalId: 'owner',
    login: 'sam',
    displayName: 'Sam',
    avatarUrl: null,
    role: 'owner',
    addedAt: '2026-10-21T00:00:00Z',
  },
  {
    principalId: 'guest',
    login: 'alex',
    displayName: 'Alexandra Chen',
    avatarUrl: null,
    role: 'collaborator',
    hostRole: 'guest',
    addedAt: '2026-10-21T00:00:00Z',
  },
];
const base = {
  open: true,
  workspaceId: 'roles',
  workspaceTitle: 'Intent Site',
  canManage: true,
  canSetMemberRole: true,
  githubConnected: true,
  members,
};

test('keyboard role selection preserves the confirmed value, closes only the menu, and permits retry', async ({
  mount,
  page,
}) => {
  const requests: { principalId: string; role: WorkspaceGuestRole }[] = [];
  const callbacks = {
    onSetMemberRole: (principalId: string, role: WorkspaceGuestRole) => {
      requests.push({ principalId, role });
    },
  };
  const component = await mount(ShareWorkspaceDialog, { props: { ...base, ...callbacks } });
  const trigger = page.getByRole('button', { name: 'Role for Alexandra Chen' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const participant = page.getByRole('menuitemradio', { name: /^Participant/ });
  await expect(participant).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Enter');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect.poll(() => requests).toEqual([{ principalId: 'guest', role: 'manager' }]);
  await expect(trigger).toHaveText('Participant');
  await component.update({ props: { ...base, ...callbacks, pendingRolePrincipalIds: ['guest'] } });
  await expect(trigger).toBeDisabled();
  await expect(trigger).toHaveText('Participant');
  await component.update({
    props: {
      ...base,
      ...callbacks,
      pendingRolePrincipalIds: [],
      roleErrors: { guest: 'Could not change this role. Try again.' },
    },
  });
  await expect(trigger).toBeEnabled();
  await trigger.click();
  await expect(participant).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('menuitemradio', { name: /^Manager/ }).click();
  await expect.poll(() => requests.length).toBe(2);
  await component.update({
    props: {
      ...base,
      ...callbacks,
      roleErrors: {},
      members: members.map((member) =>
        member.principalId === 'guest' ? { ...member, role: 'manager' } : member,
      ),
    },
  });
  await expect(trigger).toHaveText('Manager');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('narrow dark role menu and removal confirmation stay inside the visible dialog', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 720 });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  const longName = 'Alexandra Chen with a long display name';
  await mount(ShareWorkspaceDialog, {
    props: {
      ...base,
      onSetMemberRole: () => {},
      members: members.map((member) =>
        member.principalId === 'guest' ? { ...member, displayName: longName } : member,
      ),
    },
  });
  const trigger = page.getByRole('button', { name: `Role for ${longName}` });
  await trigger.click();
  const manager = page.getByRole('menuitemradio', { name: /^Manager/ });
  await expect(manager).toBeVisible();
  expect(
    await manager.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return (
        bounds.left >= 0 && bounds.right <= innerWidth && element.scrollWidth <= element.clientWidth
      );
    }),
  ).toBe(true);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: `Remove ${longName}`, exact: true }).click();
  const confirmation = page.getByTestId('share-remove-confirm');
  await expect(confirmation).toBeVisible();
  expect(
    await confirmation.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.left >= 0 && bounds.right <= innerWidth;
    }),
  ).toBe(true);
  expect(
    await page
      .getByRole('dialog')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
});
