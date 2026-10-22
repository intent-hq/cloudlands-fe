import { expect, test } from '../../../../test/ct-test';
import ShareWorkspaceDialog from '../ShareWorkspaceDialog.svelte';

const props = {
  open: true,
  workspaceId: 'height-motion',
  workspaceTitle: 'Intent Site',
  githubConnected: true,
  sharingEnabled: true,
  canManage: true,
  canAdministerHost: true,
  guestCount: 0,
  guestLimit: 10,
  members: [
    {
      principalId: 'owner',
      login: 'sam',
      displayName: 'Sam',
      avatarUrl: null,
      role: 'owner' as const,
      addedAt: '',
    },
  ],
};

for (const width of [900, 390]) {
  test(`shows and hides audience fields at ${width}px`, async ({ mount, page }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await mount(ShareWorkspaceDialog, { props });
    await page.evaluate(() => document.fonts.ready);
    const audience = page.getByRole('combobox', { name: 'Link audience' });
    await audience.click();
    await page.getByRole('option', { name: 'A specific GitHub user', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Search GitHub users' })).toBeInViewport();
    await expect(page.getByTestId('share-link-submit')).toBeInViewport();
    await audience.click();
    await page.getByRole('option', { name: 'Anyone with the link', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Search GitHub users' })).toBeHidden();
    await expect(page.getByTestId('share-link-submit')).toHaveAccessibleName('Copy link');
  });
}

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`shows errors, setup and roster content with ${reducedMotion} motion`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: 900, height: 850 });
    await page.emulateMedia({ reducedMotion });
    const component = await mount(ShareWorkspaceDialog, { props });
    await page.evaluate(() => document.fonts.ready);
    await page.getByRole('combobox', { name: 'Link audience' }).click();
    await page.getByRole('option', { name: 'A specific GitHub user', exact: true }).click();
    const update = (extra: Record<string, unknown>) =>
      component.update({ props: { ...props, ...extra } });
    await update({ createError: 'The invite could not be created. Please try again.' });
    await expect(page.getByRole('alert')).toBeVisible();
    await update({ createError: null });
    await update({ guestCount: 10 });
    await expect(page.getByTestId('share-guest-cap-reached')).toBeVisible();
    await update({ guestCount: 0 });
    await update({
      invites: [
        {
          id: 'invite',
          workspaceId: props.workspaceId,
          createdByPrincipalId: 'owner',
          pinLogin: 'alex',
          createdAt: '',
          expiresAt: '2099-10-15T00:00:00Z',
        },
      ],
    });
    await expect(page.getByTestId('share-invite-row')).toBeInViewport();
    await update({ invites: [] });
    await update({ sharingEnabled: false });
    await update({ sharingEnabled: true });
    // The close action remains accessible with a long member roster.
    await page.setViewportSize({ width: 390, height: 450 });
    await component.update({
      props: {
        ...props,
        members: Array.from({ length: 12 }, (_, i) => ({
          ...props.members[0],
          principalId: `member-${i}`,
        })),
      },
    });
    await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeInViewport();
  });
}
