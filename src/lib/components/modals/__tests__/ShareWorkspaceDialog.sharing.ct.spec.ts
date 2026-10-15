import { expect, test } from '../../../../test/ct-test';
import ShareWorkspaceDialog from '../ShareWorkspaceDialog.svelte';

const props = {
  open: true,
  workspaceId: 'sharing-setup',
  workspaceTitle: 'Workspace discussion',
  githubConnected: true,
  canManage: true,
  sharingEnabled: false,
  sharingChecking: false,
  sharingEnabling: false,
  members: [],
  guestCount: 0,
  guestLimit: 10,
};

test('enabling sharing keeps the recipient draft and waits for confirmed readiness', async ({
  mount,
  page,
}) => {
  let enableRequests = 0;
  let invitedLogin: string | undefined;
  const callbacks = {
    userSearchQuery: 'sam',
    userSuggestions: [{ login: 'sam', githubUserId: 1, avatarUrl: null, htmlUrl: null }],
    onSearchUsers: () => {},
    onEnableSharing: () => {
      enableRequests += 1;
    },
    onCreateInvite: (login: string) => {
      invitedLogin = login;
    },
  };
  const component = await mount(ShareWorkspaceDialog, {
    props: { ...props, ...callbacks, sharingEnabled: true },
  });
  await page.getByRole('combobox', { name: 'Link audience' }).click();
  await page.getByRole('option', { name: 'Only a GitHub user' }).click();
  const recipient = page.getByRole('combobox', { name: 'Search GitHub users' });
  const create = page.getByRole('button', { name: 'Copy link' });
  const enable = page.getByRole('switch', { name: 'Enable sharing' });
  await recipient.fill('sam');
  await expect(recipient).toHaveAttribute('aria-expanded', 'true');
  await component.update({ props: { ...props, ...callbacks } });
  await expect(recipient).not.toBeVisible();
  await expect(page.getByRole('listbox')).not.toBeVisible();
  await expect(create).not.toBeVisible();
  expect(invitedLogin).toBeUndefined();
  await enable.click();
  await expect.poll(() => enableRequests).toBe(1);
  await component.update({ props: { ...props, ...callbacks, sharingEnabling: true } });
  await expect(enable).toBeDisabled();
  await expect(enable).not.toBeChecked();
  await expect(create).not.toBeVisible();
  await expect(page.getByText('Enabling sharing…')).toBeVisible();
  await component.update({ props: { ...props, ...callbacks, sharingEnabled: true } });
  await expect(enable).toHaveCount(0);
  await expect(recipient).toHaveValue('sam');
  await expect(recipient).toHaveAttribute('aria-expanded', 'false');
  await expect(create).toBeDisabled();
  await recipient.fill('sa');
  await recipient.fill('sam');
  await page.getByRole('option', { name: '@sam' }).click();
  await expect(create).toBeEnabled();
  await create.click();
  await expect.poll(() => invitedLogin).toBe('sam');
});

test('startup failure stays in the dialog and the same toggle retries', async ({ mount, page }) => {
  let enableRequests = 0;
  const callbacks = {
    onEnableSharing: () => {
      enableRequests += 1;
    },
  };
  const component = await mount(ShareWorkspaceDialog, { props: { ...props, ...callbacks } });
  const enable = page.getByRole('switch', { name: 'Enable sharing' });
  await enable.click();
  await expect.poll(() => enableRequests).toBe(1);
  await component.update({
    props: {
      ...props,
      ...callbacks,
      sharingError:
        'The sharing service is missing. Install Tailcat, restart the app, and try again.',
    },
  });
  await expect(page.getByRole('alert')).toContainText('Install Tailcat');
  await expect(enable).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Copy link' })).not.toBeVisible();
  await enable.click();
  await expect.poll(() => enableRequests).toBe(2);
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('unknown setup hides invite creation until the settings read completes', async ({
  mount,
  page,
}) => {
  await mount(ShareWorkspaceDialog, {
    props: { ...props, sharingEnabled: null, sharingChecking: true },
  });
  await expect(page.getByRole('switch', { name: 'Enable sharing' })).toBeDisabled();
  await expect(page.getByText('Checking sharing…')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy link' })).not.toBeVisible();
});

test('workspace managers cannot change host sharing settings', async ({ mount, page }) => {
  await mount(ShareWorkspaceDialog, { props: { ...props, canAdministerHost: false } });
  await expect(page.getByRole('switch', { name: 'Enable sharing' })).toBeDisabled();
  await expect(page.getByText('Ask the host administrator to enable sharing.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy link' })).not.toBeVisible();
});

test('workspace managers can invite without permission to read host settings', async ({
  mount,
  page,
}) => {
  let created = false;
  await mount(ShareWorkspaceDialog, {
    props: {
      ...props,
      canAdministerHost: false,
      sharingEnabled: null,
      onCreateInvite: () => {
        created = true;
      },
    },
  });
  await expect(page.getByRole('switch', { name: 'Enable sharing' })).toHaveCount(0);
  const create = page.getByRole('button', { name: 'Copy link' });
  await expect(create).toBeEnabled();
  await create.click();
  await expect.poll(() => created).toBe(true);
});
