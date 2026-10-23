import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '../../../../test/ct-test';
import ShareWorkspaceDialog from '../ShareWorkspaceDialog.svelte';
import SharingPreview from '../sharing-audit.preview.svelte';

const props = {
  open: true,
  workspaceId: 'share-overlap',
  workspaceTitle: 'Sharing menu regression',
  githubConnected: true,
  canManage: true,
  guestCount: 0,
  guestLimit: 10,
  members: [
    {
      principalId: 'owner',
      login: 'owner',
      displayName: 'Workspace owner',
      avatarUrl: null,
      role: 'owner' as const,
      addedAt: '2026-09-01T00:00:00Z',
    },
  ],
  userSearchQuery: 'wat',
  userSuggestions: Array.from({ length: 8 }, (_, index) => ({
    login: `wattenberger${index}`,
    githubUserId: index + 1,
    avatarUrl: null,
    htmlUrl: null,
  })),
};

async function pickGithub(page: Page) {
  await page.getByRole('combobox', { name: 'Link audience' }).click();
  await page.getByRole('option', { name: 'A specific GitHub user', exact: true }).click();
}

test('invite audience and creation field stay readable in a narrow dialog', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await mount(SharingPreview, { props: { state: 'share-invites' } });
  await pickGithub(page);
  await expect(page.getByRole('combobox', { name: 'Search GitHub users' })).toBeVisible();
  const audience = page.getByText('@designer', { exact: true });
  await expect(audience).toBeVisible();
  expect(
    await audience.evaluate((node) => node.scrollWidth - node.clientWidth),
  ).toBeLessThanOrEqual(1);
  for (const button of await page.getByTestId('share-invite-row').getByRole('button').all()) {
    await expect(button).toBeInViewport();
  }
  expect(
    await page.getByRole('dialog').evaluate((node) => node.scrollWidth - node.clientWidth),
  ).toBeLessThanOrEqual(1);
});

test('suggestions paint above the roster and remain reachable in a short window', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 500 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(ShareWorkspaceDialog, { props });
  await pickGithub(page);
  await page.getByRole('combobox', { name: 'Search GitHub users' }).fill('wat');
  const suggestions = page.getByTestId('share-pin-suggestions');
  await expect(suggestions).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  await expect
    .poll(async () => {
      const bounds = await suggestions.boundingBox();
      return (
        bounds !== null && bounds.y >= 0 && bounds.y + bounds.height <= page.viewportSize()!.height
      );
    })
    .toBe(true);

  const artifacts = resolve('.demo-artifacts/sharing-menu');
  await mkdir(artifacts, { recursive: true });
  await page.screenshot({ path: resolve(artifacts, 'suggestions.png') });

  const options = page.getByRole('dialog').getByRole('listbox').getByRole('option');
  await expect(options).toHaveCount(8);
  for (const option of await options.all()) {
    await option.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        option.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
          return hit !== null && element.contains(hit);
        }),
      )
      .toBe(true);
  }

  await options.last().click();
  await expect(suggestions).toBeHidden();
  await expect(page.getByTestId('share-pin-selected')).toHaveAttribute(
    'data-login',
    'wattenberger7',
  );
});

test('Tab dismisses suggestions; Copy remains disabled until a recipient is picked', async ({
  mount,
  page,
}) => {
  let invitedLogin: string | undefined;
  const component = await mount(ShareWorkspaceDialog, {
    props: { ...props, onCreateInvite: (login: string) => (invitedLogin = login) },
  });
  await pickGithub(page);
  const input = page.getByRole('combobox', { name: 'Search GitHub users' });
  await input.fill('wat');
  await expect(page.getByTestId('share-pin-suggestions')).toBeVisible();
  await expect(input).toBeFocused();
  await input.press('Tab');
  await expect(page.getByTestId('share-pin-suggestions')).toBeHidden();
  const create = page.getByRole('button', { name: 'Create link' });
  await expect(create).toBeDisabled();
  await input.fill('wa');
  await input.fill('wat');
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(create).toBeEnabled();
  await create.focus();
  await create.press('Enter');
  await expect.poll(() => invitedLogin).toBe('wattenberger0');
  await component.update({
    props: {
      ...props,
      createdLink: { inviteId: 'created', pinLogin: 'wattenberger0' },
      invites: [
        {
          id: 'created',
          workspaceId: props.workspaceId,
          createdByPrincipalId: 'owner',
          pinLogin: 'wattenberger0',
          pinGithubUserId: 1,
          createdAt: '2026-10-15T00:00:00Z',
          expiresAt: '2099-10-16T00:00:00Z',
        },
      ],
      inviteLinks: { created: 'intent://invite?fixture=created' },
    },
  });
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
  await expect(page.getByTestId('share-pin-selected')).toBeHidden();
  await expect(page.getByTestId('share-invite-copy')).toBeEnabled();
});

test('opening the other picker dismisses suggestions, and Escape closes one layer at a time', async ({
  mount,
  page,
}) => {
  let closes = 0;
  await mount(ShareWorkspaceDialog, {
    props: {
      ...props,
      userSuggestions: props.userSuggestions.slice(0, 2),
      principals: [
        {
          principalId: 'guest',
          login: 'guest',
          displayName: null,
          avatarUrl: null,
          githubUserId: 9,
        },
      ],
      onClose: () => closes++,
    },
  });
  await pickGithub(page);
  const input = page.getByRole('combobox', { name: 'Search GitHub users' });
  await input.fill('wat');
  await expect(page.getByTestId('share-pin-suggestions')).toBeVisible();
  await page.getByRole('combobox', { name: /Invite an existing user/ }).click();
  await expect(page.getByTestId('share-pin-suggestions')).toBeHidden();
  const guestOption = page.getByRole('dialog').getByRole('option', { name: '@guest', exact: true });
  await expect(guestOption).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(guestOption).toBeHidden();
  expect(closes).toBe(0);
  await page.getByRole('combobox', { name: /Invite an existing user/ }).click();
  await guestOption.click();
  await expect(page.getByTestId('share-existing-guest-invite')).toBeEnabled();
  await input.fill('wa');
  await input.fill('wat');
  await expect(page.getByTestId('share-pin-suggestions')).toBeVisible();
  await input.press('Escape');
  await expect(page.getByTestId('share-pin-suggestions')).toBeHidden();
  await expect(input).toBeFocused();
  expect(closes).toBe(0);
  await input.press('Escape');
  await expect.poll(() => closes).toBe(1);
});

test('the pin-provider picker stays inside the modal, and Escape closes it before the dialog', async ({
  mount,
  page,
}) => {
  let closes = 0;
  await page.setViewportSize({ width: 900, height: 500 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(ShareWorkspaceDialog, {
    props: {
      ...props,
      gitlabConnected: true,
      gitlabEnabled: true,
      gitlabHost: 'gitlab.example.com',
      identitySeamSupported: true,
      identityProvider: 'github' as const,
      onClose: () => closes++,
    },
  });
  const dialog = page.getByRole('dialog');
  await page.getByRole('combobox', { name: 'Link audience' }).click();
  const options = dialog.getByRole('option');
  await expect(options).toHaveCount(3);
  await page.evaluate(() => document.fonts.ready);

  for (const option of await options.all()) {
    await expect(option).toBeVisible();
  }

  await page.keyboard.press('Escape');
  await expect(options).toHaveCount(0);
  await expect(dialog).toBeVisible();
  expect(closes).toBe(0);

  await page.getByRole('combobox', { name: 'Link audience' }).click();
  await dialog.getByRole('option', { name: 'A specific GitLab user' }).click();
  await expect(page.getByRole('combobox', { name: 'GitLab username' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect.poll(() => closes).toBe(1);
});
