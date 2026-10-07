import { expect, test } from '../../../../test/ct-test';
import Harness from './gitlab-branch-picker.test-harness.svelte';

for (const viewport of [
  { width: 390, height: 320 },
  { width: 960, height: 720 },
]) {
  test(`GitLab branch paging stays usable inside a modal at ${viewport.width}x${viewport.height}`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mount(Harness);
    await page.getByRole('button', { name: 'Choose a branch' }).click();
    const menu = page.locator('[data-slot="popover-content"]');
    await expect(menu.getByRole('searchbox')).toBeVisible();
    await expect
      .poll(() =>
        menu.evaluate((node) => {
          const box = node.getBoundingClientRect();
          return (
            box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight
          );
        }),
      )
      .toBe(true);
    await menu.getByRole('button', { name: 'Load more branches' }).click();
    const branch = menu.getByRole('option', { name: 'release/from-page-two', exact: true });
    await branch.scrollIntoViewIfNeeded();
    await branch.click();
    await expect(page.getByTestId('selected-branch')).toHaveText(
      JSON.stringify({
        name: 'release/from-page-two',
        commitSha: 'b'.repeat(40),
        scopeKey: 'connection-a/project-a',
      }),
    );
    await expect(menu).toHaveCount(0);
    await expect(
      page.getByRole('dialog', { name: 'Choose the checkout branch', exact: true }),
    ).toBeVisible();
  });
}
