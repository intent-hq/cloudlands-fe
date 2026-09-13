import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Locator } from '@playwright/test';
import DeleteWarningDialog from '../DeleteWarningDialog.svelte';
import type { LocalChangesWarning } from '$store/renderer/slices/workspace-operations/workspace-operations-types';

// A local-changes row whose nowrap label plus shrink-0 badges has a
// min-content width well past the dialog's max width. Before the grid items
// were constrained, that row widened the grid track and the footer's confirm
// button was clipped by the content's overflow-hidden.
const longLocalChanges: LocalChangesWarning = {
  hasUnpushedCommits: true,
  hasUncommittedChanges: true,
  roots: [
    {
      kind: 'primary',
      path: '/home/user/intent/workspaces/icy-tiger/intent',
      branch: 'main',
      hasRemoteRefs: true,
      unpushedCount: 0,
      uncommittedCount: 2,
    },
    {
      kind: 'secondary',
      gitRootId: 'root-fe',
      path: '/home/user/intent/workspaces/icy-tiger/intent/packages/cloudlands-fe',
      branch: 'fix/pr-monitor-row-lease-and-delete-warning-dialog-overflow-regression',
      hasRemoteRefs: true,
      unpushedCount: 1,
      uncommittedCount: 3,
    },
  ],
};

async function box(locator: Locator) {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error('element has no bounding box');
  return rect;
}

function within(
  inner: { x: number; y: number; width: number; height: number },
  outer: typeof inner,
) {
  return (
    inner.x >= outer.x - 1 &&
    inner.y >= outer.y - 1 &&
    inner.x + inner.width <= outer.x + outer.width + 1 &&
    inner.y + inner.height <= outer.y + outer.height + 1
  );
}

test('long local-changes row truncates instead of pushing the footer out of the dialog', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(DeleteWarningDialog, {
    props: { open: true, agentNames: ['Coordinator'], localChanges: longLocalChanges },
  });

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: testInfo.outputPath('long-row.png') });

  // The dialog itself never grows past its max width, and nothing inside it
  // overflows horizontally (a blown-out grid track either clips the footer or
  // scrolls the content sideways when the confirm button takes focus).
  const dialogBox = await box(dialog);
  const maxWidth = await dialog.evaluate((el) => parseFloat(getComputedStyle(el).maxWidth));
  expect(Math.abs(dialogBox.width - maxWidth)).toBeLessThan(1);
  expect(
    await dialog.evaluate((el) => ({
      overflow: el.scrollWidth - el.clientWidth,
      x: el.scrollLeft,
    })),
  ).toEqual({ overflow: 0, x: 0 });
  expect(within(await box(dialog.getByRole('heading')), dialogBox)).toBe(true);

  // Both footer buttons are fully inside the dialog and hit-testable at their
  // right edge (an overflow-hidden clip would leave the box but hide the pixels).
  const confirm = dialog.getByRole('button', { name: 'Stop work and delete' });
  const cancel = dialog.getByRole('button', { name: 'Cancel' });
  for (const button of [cancel, confirm]) {
    expect(within(await box(button), dialogBox)).toBe(true);
    expect(
      await button.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.right - 2, rect.y + rect.height / 2);
        return hit !== null && el.contains(hit);
      }),
    ).toBe(true);
  }

  // The long label truncates with an ellipsis inside the dialog.
  const longLabel = dialog.getByText('cloudlands-fe (fix/pr-monitor-row-lease', { exact: false });
  expect(within(await box(longLabel), dialogBox)).toBe(true);
  expect(await longLabel.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);

  // Badges survive intact next to the truncated label.
  const unpushedBadge = dialog.getByText('1 unpushed commit', { exact: true });
  expect(within(await box(unpushedBadge), dialogBox)).toBe(true);
  expect(await unpushedBadge.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

  // The warning box stays clear of the close button instead of running under it.
  const warningBox = unpushedBadge.locator('xpath=ancestor::div[1]');
  const closeButton = dialog.getByRole('button', { name: 'Close delete warning dialog' });
  const warningRect = await box(warningBox);
  const closeRect = await box(closeButton);
  expect(warningRect.x + warningRect.width).toBeLessThanOrEqual(closeRect.x + 1);
});
