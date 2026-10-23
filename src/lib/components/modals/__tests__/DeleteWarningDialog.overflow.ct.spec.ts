import { expect, test } from '../../../../test/ct-test';
import type { Locator } from '@playwright/test';
import DeleteWarningDialog from '../DeleteWarningDialog.svelte';
import type { LocalChangesWarning } from '$store/renderer/slices/workspace-operations/workspace-operations-types';

// Long local-work details must wrap within the dialog without pushing the
// footer beyond its bounds (the former badge row caused horizontal overflow).
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

test('long local-changes prose wraps instead of pushing the footer out of the dialog', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(DeleteWarningDialog, {
    props: {
      open: true,
      agents: [{ id: 'coordinator', name: 'Coordinator', state: 'running' }],
      localChanges: longLocalChanges,
    },
  });

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: testInfo.outputPath('long-row.png') });

  // Nothing inside the dialog
  // overflows horizontally (a blown-out grid track either clips the footer or
  // scrolls the content sideways when the confirm button takes focus).
  const dialogBox = await box(dialog);
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

  // Local-work details wrap as prose instead of squeezing badges beside a truncated label.
  const longLabel = dialog.getByText('cloudlands-fe (fix/pr-monitor-row-lease', { exact: false });
  expect(within(await box(longLabel), dialogBox)).toBe(true);
  expect(await longLabel.locator('..').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );

  // Local-work prose stays below the title and close control.
  const warningBox = longLabel;
  const closeButton = dialog.getByRole('button', { name: 'Close delete warning dialog' });
  const warningRect = await box(warningBox);
  const closeRect = await box(closeButton);
  expect(warningRect.y).toBeGreaterThan(closeRect.y + closeRect.height);
});

for (const width of [900, 380]) {
  test(`open PR warning remains contained at ${width}px`, async ({ mount, page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mount(DeleteWarningDialog, {
      props: {
        open: true,
        openPrs: [
          {
            number: 418,
            title: 'Refine workspace warning layout and preserve the full content width',
            status: 'Open',
            url: '',
          },
        ],
      },
    });

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const warning = dialog.getByRole('list').locator('..');
    await expect(warning).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(dialog.getByText('Open', { exact: true })).toHaveCount(0);
    const dialogRect = await box(dialog);
    const closeRect = await box(
      dialog.getByRole('button', { name: 'Close delete warning dialog' }),
    );
    const headingRect = await box(dialog.getByRole('heading'));

    for (const content of [warning]) {
      const rect = await box(content);
      expect(within(rect, dialogRect)).toBe(true);
      expect(rect.y).toBeGreaterThan(closeRect.y + closeRect.height);
    }
    expect(headingRect.x + headingRect.width).toBeLessThanOrEqual(closeRect.x + 1);

    expect(dialogRect.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(await dialog.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
    expect(
      within(await box(dialog.getByRole('button', { name: 'Delete', exact: true })), dialogRect),
    ).toBe(true);
    expect(within(await box(dialog.getByRole('button', { name: 'Cancel' })), dialogRect)).toBe(
      true,
    );
    const title = dialog.getByText('Refine workspace warning layout', { exact: false });
    expect(await title.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    expect(within(await box(dialog.getByText('#418', { exact: true })), dialogRect)).toBe(true);
  });
}
