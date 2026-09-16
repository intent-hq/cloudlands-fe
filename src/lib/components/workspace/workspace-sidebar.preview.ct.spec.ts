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

test('keeps assigned and unassigned status and title columns aligned through hover and keyboard navigation', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const selected: string[] = [];
  const component = await mount(WorkspaceSidebarPreview, {
    hooksConfig: { geometrySnapshot: { scene: 'workspace-sidebar', state: 'key-slots' } },
  });
  await component.update({ props: { width: 248, onSelect: (id: string) => selected.push(id) } });
  const rows = component.locator('[data-workspace-card-row]');
  const badge = component.locator('.micro-key-slot-badge');
  await expect(rows).toHaveCount(3);
  await expect(badge).toHaveCount(1);

  async function positions() {
    return rows.evaluateAll((elements) =>
      elements.map((row) => {
        const title = row.querySelector<HTMLElement>('[data-workspace-card-title]')!;
        const status = row.querySelector<HTMLElement>('[data-workspace-status]')!;
        return {
          titleX: title.getBoundingClientRect().x,
          statusX: status.getBoundingClientRect().x,
          overflow: row.scrollWidth - row.clientWidth,
        };
      }),
    );
  }

  await expect
    .poll(async () => {
      const rects = await positions();
      return (
        Math.max(...rects.map((rect) => rect.titleX)) -
        Math.min(...rects.map((rect) => rect.titleX))
      );
    })
    .toBeLessThanOrEqual(1);
  const initial = await positions();
  expect(
    Math.max(...initial.map((rect) => rect.statusX)) -
      Math.min(...initial.map((rect) => rect.statusX)),
  ).toBeLessThanOrEqual(1);
  expect(initial.every((rect) => rect.overflow <= 1)).toBe(true);
  const badgeBox = (await badge.boundingBox())!;
  expect(badgeBox.width).toBeLessThanOrEqual(20);
  expect(badgeBox.height).toBeLessThanOrEqual((await rows.first().boundingBox())!.height);

  await rows.nth(1).hover();
  expect(await positions()).toEqual(initial);
  await rows.nth(1).locator('[data-workspace-card-title]').click();
  await expect.poll(() => selected.length).toBe(1);
  const trigger = rows.nth(2).locator('[data-workspace-card-trigger]');
  await trigger.focus();
  await expect(trigger).toBeFocused();
  expect(await positions()).toEqual(initial);
  await trigger.press('Enter');
  await expect.poll(() => selected.length).toBe(2);
  expect(selected[0]).not.toBe(selected[1]);

  await badge.click();
  await expect(page.getByRole('menu')).toBeVisible();
  expect(selected).toHaveLength(2);
  await page.keyboard.press('Escape');
});
