import { expect, test } from '../../../test/ct-test';
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

test('Escape dismisses a pointer-opened card without moving body focus', async ({
  mount,
  page,
}) => {
  const component = await mount(WorkspaceSidebarPreview, {
    props: { loading: false, width: 360, workspaces: [keyboardWorkspace] },
  });
  const hoverCard = page.locator('[data-workspace-hover-card]');

  await expect(page.locator('body')).toBeFocused();
  await component.locator('[data-workspace-card-title]').hover();
  await expect(hoverCard).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(hoverCard).toHaveCount(0);
  await expect(page.locator('body')).toBeFocused();
});

test('Escape dismisses from the status sibling without moving focus or reopening', async ({
  mount,
  page,
}) => {
  const component = await mount(WorkspaceSidebarPreview, {
    props: { loading: false, width: 360, workspaces: [keyboardWorkspace] },
  });
  const trigger = component.locator('[data-workspace-card-trigger]');
  const hoverCard = page.locator('[data-workspace-hover-card]');
  const statusControl = component
    .locator('[tabindex="0"]')
    .filter({ has: page.locator('[data-workspace-status]') });

  await page.keyboard.press('Tab');
  await expect(trigger).toBeFocused();
  await expect(hoverCard).toHaveCount(1);
  await page.keyboard.press('Tab');
  await expect(statusControl).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(hoverCard).toHaveCount(0);
  await expect(statusControl).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(trigger).toBeFocused();
  await expect(hoverCard).toHaveCount(0);
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
          height: row.getBoundingClientRect().height,
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
  expect(
    Math.max(...initial.map((rect) => rect.height)) -
      Math.min(...initial.map((rect) => rect.height)),
  ).toBeLessThanOrEqual(1);
  const badgeFit = await badge.evaluate((node) => {
    const row = node.closest<HTMLElement>('[data-workspace-card-row]')!;
    const rect = (el: Element) => {
      const { left, right, top, bottom } = el.getBoundingClientRect();
      return { left, right, top, bottom };
    };
    const overlaps = (a: ReturnType<typeof rect>, b: ReturnType<typeof rect>) =>
      a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
    const badgeRect = rect(node);
    const rowRect = rect(row);
    return {
      insideRow:
        badgeRect.top >= rowRect.top - 1 &&
        badgeRect.bottom <= rowRect.bottom + 1 &&
        badgeRect.left >= rowRect.left - 1 &&
        badgeRect.right <= rowRect.right + 1,
      overlapsStatus: overlaps(badgeRect, rect(row.querySelector('[data-workspace-status]')!)),
      overlapsTitle: overlaps(badgeRect, rect(row.querySelector('[data-workspace-card-title]')!)),
    };
  });
  expect(badgeFit).toEqual({ insideRow: true, overlapsStatus: false, overlapsTitle: false });

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
