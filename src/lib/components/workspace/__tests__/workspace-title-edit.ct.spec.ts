import { expect, test } from '@playwright/experimental-ct-svelte';
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
  test(`workspace title stays transparent and borderless with visible keyboard focus in ${theme}`, async ({
    mount,
    page,
  }) => {
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
      const css = getComputedStyle(node);
      const parent = node.parentElement!;
      return {
        background: css.backgroundColor,
        border: css.borderWidth,
        shadow: css.boxShadow,
        outline: css.outlineStyle,
        outlineWidth: parseFloat(css.outlineWidth),
        width: node.getBoundingClientRect().width,
        available: parent.getBoundingClientRect().width,
        decorations: Array.from(parent.children)
          .filter((child) => child.getAttribute('aria-hidden') === 'true')
          .map((child) => ({
            background: getComputedStyle(child).backgroundColor,
            border: getComputedStyle(child).borderWidth,
          })),
      };
    });
    expect(style.background).toBe('rgba(0, 0, 0, 0)');
    expect(style.border).toBe('0px');
    expect(style.shadow).toMatch(/^(none|(?:rgba\(0, 0, 0, 0\) 0px 0px 0px 0px(?:, )?)+)$/);
    expect(style.outline).not.toBe('none');
    expect(style.outlineWidth).toBeGreaterThanOrEqual(1);
    expect(Math.abs(style.width - style.available)).toBeLessThanOrEqual(1);
    expect(
      style.decorations.every(
        (decoration) => decoration.background === 'rgba(0, 0, 0, 0)' && decoration.border === '0px',
      ),
    ).toBe(true);
    await input.fill('Discard this draft');
    await input.press('Escape');
    await expect(title).toBeVisible();
    await title.click();
    await expect(input).toHaveValue(workspace.title);
    await input.press('Enter');
    await expect(title).toBeVisible();
  });
}

test('keeps the branch label normal like the repository through hover, focus and edit cancellation', async ({
  mount,
  page,
}) => {
  const component = await mount(WorkspaceSidebarHeader, {
    props: { workspace, workspaceId: workspace.id },
  });
  await page.evaluate(() => document.fonts.ready);
  const repository = component.locator('[data-sidebar-repository]');
  const branch = component.getByRole('button', { name: workspace.branch, exact: true });
  const repositoryFont = await repository.evaluate((node) => {
    const style = getComputedStyle(node);
    return { weight: style.fontWeight, size: style.fontSize };
  });
  const expectMatchingLabel = async () => {
    const style = await branch.locator('span').evaluate((node) => {
      const css = getComputedStyle(node);
      return { weight: css.fontWeight, size: css.fontSize };
    });
    expect(style.weight).toBe('400');
    expect(style).toEqual(repositoryFont);
  };
  await expectMatchingLabel();
  await branch.hover();
  await expectMatchingLabel();
  await branch.focus();
  await expectMatchingLabel();
  await branch.click();
  const input = component.getByRole('textbox');
  await expect(input).toBeFocused();
  await input.fill('discard-this-draft');
  await input.press('Escape');
  await expect(branch).toBeVisible();
  await expectMatchingLabel();
});
