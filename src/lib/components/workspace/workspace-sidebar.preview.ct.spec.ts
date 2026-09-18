import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Workspace } from '$shared/types';
import { WorkspaceStatus } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import WorkspaceSidebarPreview from './workspace-sidebar.preview.svelte';

test('aligns status headings to the leading content inset and preserves keyboard collapse', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(WorkspaceSidebarPreview, {
    hooksConfig: { geometrySnapshot: { scene: 'workspace-sidebar', state: 'status-groups' } },
  });
  await page.evaluate(() => document.fonts.ready);
  const toggles = component.locator('[data-status-group-toggle]');
  await expect(toggles).toHaveCount(4);
  const positions = () =>
    toggles.evaluateAll((nodes) =>
      nodes.map((node) => {
        const style = getComputedStyle(node);
        const bounds = node.getBoundingClientRect();
        return {
          headingX: node.querySelector('h4')!.getBoundingClientRect().x,
          contentStart:
            bounds.x + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
          chevronX: node.querySelector('svg')!.getBoundingClientRect().x,
          overflow: node.scrollWidth - node.clientWidth,
        };
      }),
    );
  const initial = await positions();
  expect(initial.every((row) => Math.abs(row.headingX - row.contentStart) <= 1)).toBe(true);
  expect(initial.every((row) => row.overflow <= 1 && row.chevronX > row.headingX)).toBe(true);
  for (const id of ['blocked', 'needs_attention', 'in_progress', 'idle']) {
    const toggle = component.locator(`[data-status-group-toggle="${id}"]`);
    const rows = component.locator(`#status-group-${id}`);
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();
    await expect(rows).toBeHidden();
    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toBeFocused();
    await expect(rows).toBeVisible();
  }
  expect(await positions()).toEqual(initial);
});

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

for (const contentWidth of [220, 221]) {
  test(`restores elapsed labels after resizing through the ${contentWidth}px sidebar boundary`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const component = await mount(WorkspaceSidebarPreview, {
      hooksConfig: { geometrySnapshot: { scene: 'workspace-sidebar', state: 'status-groups' } },
    });
    await page.mouse.move(0, 0);
    const times = component.locator('[data-workspace-card-time]');
    await expect(times).toHaveCount(4);
    await expect(times.first()).toBeVisible();
    // The fixture has a 1px border on each side, outside its query container's content box.
    await component.update({ props: { width: contentWidth + 2 } });
    const measuredContentWidth = () =>
      component.evaluate((element) => {
        const style = getComputedStyle(element);
        return element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      });
    await expect.poll(measuredContentWidth).toBe(contentWidth);
    for (const time of await times.all()) {
      if (contentWidth === 220) await expect(time).toBeHidden();
      else await expect(time).toBeVisible();
    }
    await component.update({ props: { width: 320 } });
    await expect.poll(measuredContentWidth).toBe(318);
    for (const time of await times.all()) await expect(time).toBeVisible();
    const toggle = component.locator('[data-status-group-toggle="idle"]');
    const idleTime = component.locator('#status-group-idle [data-workspace-card-time]');
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(idleTime).toBeHidden();
    await page.keyboard.press('Space');
    await expect(idleTime).toBeVisible();
  });
}

test('keeps elapsed labels and long-title metadata contained while pin and menu actions remain reachable', async ({
  mount,
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(WorkspaceSidebarPreview, {
    hooksConfig: { geometrySnapshot: { scene: 'workspace-sidebar', state: 'activity-times' } },
  });
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
  const rows = component.locator('[data-workspace-card-row]');
  await expect(rows).toHaveCount(2);
  const row = component.locator('#status-group-pr_open [data-workspace-card-row]');
  const time = row.locator('[data-workspace-card-time]');
  await expect(time).toHaveCSS('opacity', '1');
  await expect(row.locator('[data-workspace-card-pr-item]')).toBeVisible();
  await expect(
    component.locator('#status-group-archived [data-workspace-card-trailing-label]'),
  ).toBeVisible();

  const measure = () =>
    rows.evaluateAll((elements) =>
      elements.map((element) => {
        const rowRect = element.getBoundingClientRect();
        const title = element.querySelector('[data-workspace-card-title]')!;
        const titleRect = title.getBoundingClientRect();
        const time = element.querySelector('[data-workspace-card-time]')!;
        const range = document.createRange();
        range.selectNodeContents(time);
        const ink = range.getBoundingClientRect();
        const metadata = element.querySelector(
          '[data-workspace-card-pr-list], [data-workspace-card-trailing-label]',
        )!;
        const metadataRect = metadata.getBoundingClientRect();
        return {
          x: rowRect.x,
          y: rowRect.y,
          height: rowRect.height,
          titleX: titleRect.x,
          titleRight: titleRect.right,
          truncated: title.scrollWidth > title.clientWidth,
          overflow: element.scrollWidth - element.clientWidth,
          metadataLeft: metadataRect.left,
          metadataRight: metadataRect.right,
          timeLeft: ink.left,
          timeRight: ink.right,
          rowRight: rowRect.right,
        };
      }),
    );
  const initial = await measure();
  for (const bounds of initial) {
    expect(bounds.truncated).toBe(true);
    expect(bounds.overflow).toBeLessThanOrEqual(1);
    expect(bounds.titleRight).toBeLessThanOrEqual(bounds.metadataLeft + 1);
    expect(bounds.metadataRight).toBeLessThanOrEqual(bounds.timeLeft + 1);
    expect(bounds.timeRight).toBeLessThanOrEqual(bounds.rowRight);
  }
  await row.hover();
  await expect(time).toHaveCSS('opacity', '0');
  expect(await measure()).toEqual(initial);
  const pin = row.getByRole('button', { name: 'Pin', exact: true });
  await pin.focus();
  await page.keyboard.press('Space');
  await expect(row).toHaveAttribute('data-pinned', 'true');
  await row.getByRole('button', { name: 'Unpin', exact: true }).press('Space');
  await expect(row).toHaveAttribute('data-pinned', 'false');
  const actions = row.getByRole('button', { name: 'Workspace actions', exact: true });
  await actions.focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(actions).toBeFocused();
  await component.getByRole('listbox').focus();
  await page.mouse.move(0, 0);
  await expect(time).toHaveCSS('opacity', '1');
  expect(await measure()).toEqual(initial);
  await testInfo.attach('elapsed-activity-geometry', {
    body: JSON.stringify({ initial, final: await measure() }, null, 2),
    contentType: 'application/json',
  });
  await testInfo.attach('elapsed-activity-narrow', {
    body: await component.screenshot(),
    contentType: 'image/png',
  });
});
