import { expect, test } from '../../../../test/ct-test';
import { WorkspaceStatusEnum, type Workspace } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import WorkspaceSidebarHeader from '../WorkspaceSidebarHeader.svelte';

const workspace: Workspace = {
  id: WorkspaceId('title-edit-fixture'),
  title: 'Improve navigation',
  branch: 'title-edit-fixture',
  repositoryOwner: 'intent-hq',
  repositoryName: 'intent',
  changesets: [],
  timeline: [],
  conversationInfo: [],
  status: WorkspaceStatusEnum.Active,
  createdAt: '2026-09-16T00:00:00.000Z',
  updatedAt: '2026-09-16T00:00:00.000Z',
};

for (const theme of ['light', 'dark'] as const) {
  test(`workspace title keeps keyboard focus and supports cancelling edits in ${theme}`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 360, height: 240 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(
      (dark) => document.documentElement.classList.toggle('dark', dark),
      theme === 'dark',
    );
    const component = await mount(WorkspaceSidebarHeader, {
      props: { workspace, workspaceId: workspace.id },
    });
    const title = component.getByRole('button', { name: workspace.title, exact: true });
    await title.focus();
    await title.press('Enter');
    const input = component.getByRole('textbox');
    await expect(input).toBeFocused();
    await input.hover();
    const style = await input.evaluate((node) => {
      const parent = node.parentElement!;
      const bounds = node.getBoundingClientRect();
      const parentBounds = parent.getBoundingClientRect();
      return {
        left: bounds.left,
        right: bounds.right,
        parentLeft: parentBounds.left,
        parentRight: parentBounds.right,
      };
    });
    expect(Math.round(style.left)).toBeGreaterThanOrEqual(Math.floor(style.parentLeft));
    expect(Math.round(style.right)).toBeLessThanOrEqual(Math.ceil(style.parentRight));
    await input.fill('Discard this draft');
    await input.press('Escape');
    await expect(title).toBeVisible();
    await title.click();
    await expect(input).toHaveValue(workspace.title);
    await input.press('Enter');
    await expect(title).toBeVisible();
    await testInfo.attach(`workspace-title-keyboard-${theme}`, {
      body: await component.screenshot(),
      contentType: 'image/png',
    });
  });
}

test('preserves the branch label through edit cancellation', async ({ mount, page }) => {
  const component = await mount(WorkspaceSidebarHeader, {
    props: { workspace, workspaceId: workspace.id },
  });
  await page.evaluate(() => document.fonts.ready);
  const branch = component.getByRole('button', { name: workspace.branch, exact: true });
  await branch.hover();
  await branch.focus();
  await branch.click();
  const input = component.getByRole('textbox');
  await expect(input).toBeFocused();
  await input.fill('discard-this-draft');
  await input.press('Escape');
  await expect(branch).toBeVisible();
});
