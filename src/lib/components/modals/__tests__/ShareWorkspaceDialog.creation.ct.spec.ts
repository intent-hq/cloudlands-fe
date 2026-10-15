import { expect, test } from '../../../../test/ct-test';
import ShareWorkspaceDialog from '../ShareWorkspaceDialog.svelte';

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test.describe(`invite creation with ${reducedMotion} motion`, () => {
    test.use({ contextOptions: { reducedMotion } });

    test('keeps the pending button steady and reveals the invite without a dialog jump', async ({
      mount,
      page,
    }) => {
      let requests = 0;
      const props = {
        open: true,
        workspaceId: 'create-motion',
        workspaceTitle: 'Intent Site',
        githubConnected: true,
        canManage: true,
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
        userSearchQuery: 'alex',
        userSuggestions: [{ login: 'alex', githubUserId: 1, avatarUrl: null, htmlUrl: null }],
        onCreateInvite: () => requests++,
      };
      const component = await mount(ShareWorkspaceDialog, { props });
      await page.getByRole('combobox', { name: 'Link audience' }).click();
      await page.getByRole('option', { name: 'A specific GitHub user', exact: true }).click();
      const input = page.getByRole('combobox', { name: 'Search GitHub users' });
      await input.fill('alex');
      await page.getByRole('option', { name: '@alex', exact: true }).click();
      const submit = page.getByTestId('share-link-submit');
      await expect(submit).toHaveAccessibleName('Create link');
      const restingButton = await submit.boundingBox();
      await submit.click();
      await expect.poll(() => requests).toBe(1);
      await expect(submit).toHaveAttribute('aria-busy', 'true');
      await expect(submit.locator('[data-slot=button-spinner]')).toBeVisible();
      await expect(submit).toBeDisabled();
      await component.update({ props: { ...props, creating: true } });
      expect(await submit.boundingBox()).toEqual(restingButton);
      await expect(page.getByTestId('share-pin-selected')).toHaveAttribute('data-login', 'alex');

      const dialog = page.getByRole('dialog');
      const initialHeight = (await dialog.boundingBox())!.height;
      await page.evaluate(() => {
        const state = window as typeof window & { shareHeights: number[]; recordShare: boolean };
        state.shareHeights = [];
        state.recordShare = true;
        const sample = () => {
          state.shareHeights.push(
            document.querySelector('[role=dialog]')!.getBoundingClientRect().height,
          );
          if (state.recordShare) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      await component.update({
        props: {
          ...props,
          creating: false,
          guestCount: 1,
          createdLink: { inviteId: 'alex-invite', pinLogin: 'alex' },
          inviteLinks: { 'alex-invite': 'intent://invite?fixture=alex' },
          invites: [
            {
              id: 'alex-invite',
              workspaceId: props.workspaceId,
              createdByPrincipalId: 'owner',
              pinLogin: 'alex',
              pinGithubUserId: 1,
              createdAt: '2026-10-15T00:00:00Z',
              expiresAt: '2099-10-15T00:00:00Z',
            },
          ],
        },
      });
      await expect(page.getByTestId('share-invite-row')).toBeVisible();
      await expect(input).toHaveValue('');
      await expect(input).toBeFocused();
      await expect(submit).not.toHaveAttribute('aria-busy', 'true');
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              document
                .getAnimations()
                .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
                .length,
          ),
        )
        .toBe(0);
      const finalHeight = (await dialog.boundingBox())!.height;
      const heights = await page.evaluate(() => {
        const state = window as typeof window & { shareHeights: number[]; recordShare: boolean };
        state.recordShare = false;
        return state.shareHeights;
      });
      expect(finalHeight).toBeGreaterThan(initialHeight);
      if (reducedMotion === 'no-preference') {
        expect(
          heights.some((height) => height > initialHeight + 1 && height < finalHeight - 1),
        ).toBe(true);
      }
      await expect(submit).toHaveAccessibleName('Create link');
      await expect(submit).toBeDisabled();
      await expect(page.getByTestId('share-invite-copy')).toBeEnabled();
      expect(requests).toBe(1);
    });
  });
}
