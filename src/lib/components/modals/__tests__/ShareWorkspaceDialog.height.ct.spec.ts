import type { Page } from '@playwright/test';
import { expect, test } from '../../../../test/ct-test';
import ShareWorkspaceDialog from '../ShareWorkspaceDialog.svelte';

type HeightFrame = { height: number; bodyHeight: number; target: number };

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

async function settleHeight(page: Page) {
  await expect
    .poll(() =>
      page
        .getByTestId('share-dialog-height')
        .evaluate((node) =>
          Math.abs(
            node.getBoundingClientRect().height -
              node.firstElementChild!.getBoundingClientRect().height,
          ),
        ),
    )
    .toBe(0);
}

async function heightChange(page: Page, change: () => Promise<unknown>, animate = true) {
  await settleHeight(page);
  const before = (await page.getByRole('dialog').boundingBox())!;
  await page.evaluate(() => {
    const state = window as typeof window & { heights: HeightFrame[]; sampling: boolean };
    state.heights = [];
    state.sampling = true;
    const sample = () => {
      const body = document.querySelector('[data-testid=share-dialog-height]')!;
      state.heights.push({
        height: document.querySelector('[role=dialog]')!.getBoundingClientRect().height,
        bodyHeight: body.getBoundingClientRect().height,
        target: body.firstElementChild!.getBoundingClientRect().height,
      });
      if (state.sampling) requestAnimationFrame(sample);
    };
    sample();
  });
  await change();
  await settleHeight(page);
  const after = (await page.getByRole('dialog').boundingBox())!;
  const heights = await page.evaluate(() => {
    const state = window as typeof window & { heights: HeightFrame[]; sampling: boolean };
    state.sampling = false;
    return state.heights;
  });
  expect(Math.abs(after.height - before.height)).toBeGreaterThan(1);
  // Observe the whole transition, without relying on a timed midpoint.
  const low = Math.min(before.height, after.height);
  const high = Math.max(before.height, after.height);
  if (animate) {
    expect(heights.some(({ height }) => height > low + 1 && height < high - 1)).toBe(true);
  } else {
    // Layout can recalculate more than once; reduced motion snaps between those
    // intrinsic heights instead of interpolating values between them.
    expect(
      heights.every(({ bodyHeight }) =>
        heights.some(({ target }) => Math.abs(bodyHeight - target) < 0.05),
      ),
    ).toBe(true);
  }
  expect(after.y + after.height / 2).toBeCloseTo(before.y + before.height / 2, 0);
  return after.height;
}

for (const width of [900, 390]) {
  test(`smoothly expands and collapses the audience fields at ${width}px`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await mount(ShareWorkspaceDialog, { props });
    await page.evaluate(() => document.fonts.ready);
    const audience = page.getByRole('combobox', { name: 'Link audience' });
    await audience.click();
    await heightChange(page, () =>
      page.getByRole('option', { name: 'A specific GitHub user', exact: true }).click(),
    );
    await expect(page.getByRole('combobox', { name: 'Search GitHub users' })).toBeInViewport();
    await expect(page.getByTestId('share-link-submit')).toBeInViewport();
    await audience.click();
    await heightChange(page, () =>
      page.getByRole('option', { name: 'Anyone with the link', exact: true }).click(),
    );
    await expect(page.getByRole('combobox', { name: 'Search GitHub users' })).toBeHidden();
    await expect(page.getByTestId('share-link-submit')).toHaveAccessibleName('Copy link');
  });
}

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`resizes errors, setup and roster content with ${reducedMotion} motion`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: 900, height: 850 });
    await page.emulateMedia({ reducedMotion });
    const component = await mount(ShareWorkspaceDialog, { props });
    await page.evaluate(() => document.fonts.ready);
    await page.getByRole('combobox', { name: 'Link audience' }).click();
    await heightChange(
      page,
      () => page.getByRole('option', { name: 'A specific GitHub user', exact: true }).click(),
      reducedMotion === 'no-preference',
    );
    const update = (extra: Record<string, unknown>) =>
      heightChange(
        page,
        () => component.update({ props: { ...props, ...extra } }),
        reducedMotion === 'no-preference',
      );
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
    // A tall body stays independently scrollable inside the viewport limit.
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
    await settleHeight(page);
    const body = page.locator('[data-slot=dialog-body]');
    expect(await body.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
    await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeInViewport();
  });
}
