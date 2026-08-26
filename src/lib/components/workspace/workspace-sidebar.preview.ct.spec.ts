import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Workspace } from '$shared/types';
import { WorkspaceStatus } from '$shared/types';
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
