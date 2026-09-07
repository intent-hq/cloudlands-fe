import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Workspace } from '$shared/types';
import { PullRequestStatus, WorkspaceStatus } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import WorkspaceSidebarPreview from './workspace-sidebar.preview.svelte';

const timestamp = '2026-08-23T12:00:00.000Z';
const workspace: Workspace = {
  id: WorkspaceId('preview-workspace-primary'),
  title: 'A very long workspace title that confirms truncation in a narrow sidebar',
  branch: 'frontend-previews',
  changesets: [],
  timeline: [],
  conversationInfo: [],
  status: WorkspaceStatus.Active,
  displayStatus: 'in_progress',
  attention: 'none',
  activity: 'agent_running',
  createdAt: timestamp,
  updatedAt: timestamp,
};

const keyboardWorkspace: Workspace = {
  ...workspace,
  activePullRequest: {
    id: 'preview-pr-keyboard',
    number: 2185,
    url: 'https://github.com/intent-hq/cloudlands-fe/pull/2185',
    title: 'Keyboard entry into the workspace hover card',
    status: PullRequestStatus.Open,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
};

test('renders loading, empty, busy, long-content, and narrow workspace states', async ({
  mount,
}) => {
  const component = await mount(WorkspaceSidebarPreview, {
    props: { loading: true, width: 360, workspaces: [] },
  });

  await expect(component.locator('[data-workspace-sidebar-skeleton]')).toBeVisible();

  await component.update({ props: { loading: false, width: 360, workspaces: [] } });
  await expect(component.locator('[data-workspace-preview-empty]')).toContainText(
    'No workspaces yet',
  );

  await component.update({ props: { loading: false, width: 360, workspaces: [workspace] } });
  await expect(component.locator('[data-workspace-card-row]')).toHaveCount(1);
  await expect(component.locator('[data-workspace-status="in_progress"]')).toBeVisible();

  await component.update({ props: { loading: false, width: 420, workspaces: [workspace] } });
  await expect(component.locator('[data-workspace-card-row]')).toHaveCount(1);
  await expect(component.getByText(/very long workspace title/)).toBeVisible();

  await component.update({ props: { loading: false, width: 248, workspaces: [workspace] } });
  await expect(component).toHaveAttribute('data-preview-width', '248');
  await expect(component.locator('[data-workspace-card-row]')).toHaveCount(1);
});

test('enters and dismisses the portaled hover card with real keyboard input', async ({
  mount,
  page,
}) => {
  const component = await mount(WorkspaceSidebarPreview, {
    props: { loading: false, width: 360, workspaces: [keyboardWorkspace] },
  });
  const trigger = component.locator('[data-workspace-card-trigger]');
  const hoverCard = page.locator('[data-workspace-hover-card]');

  await page.keyboard.press('Tab');
  await expect(trigger).toBeFocused();
  await expect(hoverCard).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(hoverCard).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await page.keyboard.press('ArrowDown');
  const firstControl = hoverCard.locator('button').first();
  await expect(firstControl).toBeFocused();

  await firstControl.evaluate((element) => {
    element.addEventListener(
      'click',
      (event) => {
        element.setAttribute('data-keyboard-activated', 'true');
        event.preventDefault();
        event.stopImmediatePropagation();
      },
      { capture: true, once: true },
    );
  });
  await page.keyboard.press('Enter');
  await expect(firstControl).toHaveAttribute('data-keyboard-activated', 'true');

  await page.keyboard.press('Escape');
  await expect(hoverCard).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[data-workspace-hover-card] button').first()).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(hoverCard).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[data-workspace-hover-card] button').first()).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(hoverCard).toHaveCount(0);
  await expect(page.locator(':focus')).toHaveCount(1);
  await expect(trigger).not.toBeFocused();
  await page.keyboard.press('Tab');
  await expect(hoverCard).toHaveCount(0);
  await expect(component.locator('[data-workspace-card-pr-item]')).toBeFocused();
});
