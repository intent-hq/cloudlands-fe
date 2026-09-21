import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '../../../../test/ct-test';
import ShareWorkspaceDialog from '../ShareWorkspaceDialog.svelte';

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

test('suggestions paint above the roster and remain reachable in a short window', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 500 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(ShareWorkspaceDialog, { props });
  await page.getByRole('combobox').fill('wat');
  const suggestions = page.getByTestId('share-pin-suggestions');
  await expect(suggestions).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  await expect
    .poll(async () => {
      const bounds = await suggestions.boundingBox();
      return bounds !== null && bounds.y >= 0 && bounds.y + bounds.height <= 500;
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

test('Tab dismisses suggestions and reaches Create without walking suggestion buttons', async ({
  mount,
  page,
}) => {
  let invitedLogin: string | undefined;
  await mount(ShareWorkspaceDialog, {
    props: { ...props, onCreateInvite: (login: string) => (invitedLogin = login) },
  });
  const input = page.getByRole('combobox');
  await input.fill('wat');
  await expect(page.getByTestId('share-pin-suggestions')).toBeVisible();
  await expect(input).toBeFocused();
  await input.press('Tab');
  await expect(page.getByTestId('share-pin-suggestions')).toBeHidden();
  const create = page.getByRole('button', { name: 'Create invite link' });
  await expect(create).toBeFocused();
  await create.press('Enter');
  await expect.poll(() => invitedLogin).toBe('wat');
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
  const input = page.getByRole('combobox', { name: /Restrict to a GitHub user/ });
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
