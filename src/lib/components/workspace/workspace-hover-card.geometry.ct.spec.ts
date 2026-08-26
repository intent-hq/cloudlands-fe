import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Workspace } from '$shared/types';
import { WorkspaceStatus } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import WorkspaceHoverCard from './WorkspaceHoverCard.svelte';
import { workspaceHoverCardPreview } from './workspace-hover-card.preview-fixtures';
import WorkspaceSidebarPreview from './workspace-sidebar.preview.svelte';

const timestamp = '2026-08-25T12:00:00.000Z';
const workspace: Workspace = {
  id: WorkspaceId('hover-card-geometry'),
  title: 'Workspace hover-card geometry',
  branch: 'hover-card-geometry',
  changesets: [],
  timeline: [],
  conversationInfo: [],
  status: WorkspaceStatus.Active,
  displayStatus: 'in_progress',
  statusMessage:
    'This long description verifies truncation while the real sidebar hover stays inside the viewport.',
  createdAt: timestamp,
  updatedAt: timestamp,
};

for (const theme of ['light', 'dark'] as const) {
  test(`keeps the placed hover-card perimeter complete in ${theme}`, async ({ mount, page }) => {
    await page.setViewportSize({ width: 900, height: 620 });
    await page.evaluate((nextTheme) => {
      document.documentElement.classList.remove('light', 'dark');
      document.documentElement.classList.add(nextTheme);
    }, theme);
    const sidebar = await mount(WorkspaceSidebarPreview, {
      props: { loading: false, width: 248, workspaces: [workspace] },
    });
    await sidebar.evaluate((node) => {
      (node as HTMLElement).style.marginLeft = '568px';
    });
    await sidebar.locator('[data-workspace-card-row]').dispatchEvent('mouseenter');

    const tooltip = page.getByRole('tooltip');
    const surface = tooltip.locator('[data-workspace-hover-card-layout]');
    await expect(surface).toBeVisible();
    await expect.poll(async () => (await surface.boundingBox())?.x ?? 0).toBeGreaterThanOrEqual(8);

    const geometry = await tooltip.evaluate((wrapper) => {
      const card = wrapper.querySelector<HTMLElement>('[data-workspace-hover-card-layout]')!;
      const wrapperStyle = getComputedStyle(wrapper);
      const cardStyle = getComputedStyle(card);
      const rect = card.getBoundingClientRect();
      const inset = 1;
      const cornerPoints = [
        [rect.left + inset, rect.top + inset],
        [rect.right - inset, rect.top + inset],
        [rect.left + inset, rect.bottom - inset],
        [rect.right - inset, rect.bottom - inset],
      ];
      const cornersClear = cornerPoints.every(([x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return hit !== wrapper && hit !== card && !card.contains(hit);
      });
      return {
        wrapperBackground: wrapperStyle.backgroundColor,
        cardBackground: cardStyle.backgroundColor,
        wrapperRounded: wrapper.classList.contains('rounded-lg'),
        cardRounded: card.classList.contains('rounded-lg'),
        wrapperClippingSafe: wrapper.classList.contains('overflow-visible!'),
        wrapperBorderless: wrapper.classList.contains('border-0!'),
        wrapperShadowless: wrapper.classList.contains('shadow-none!'),
        cardClipsFill: card.classList.contains('overflow-hidden'),
        cardElevated: card.classList.contains('shadow-(--elevation-overlay)'),
        cardOutlined:
          card.classList.contains('ring-1') && card.classList.contains('ring-border/70'),
        cornersClear,
      };
    });
    const bounds = await surface.boundingBox();

    expect(geometry.wrapperBackground).toBe(geometry.cardBackground);
    expect(geometry.wrapperBackground).not.toBe('rgba(0, 0, 0, 0)');
    expect(geometry.wrapperRounded).toBe(true);
    expect(geometry.cardRounded).toBe(true);
    expect(geometry.wrapperClippingSafe).toBe(true);
    expect(geometry.wrapperBorderless).toBe(true);
    expect(geometry.wrapperShadowless).toBe(true);
    expect(geometry.cardClipsFill).toBe(true);
    expect(geometry.cardElevated).toBe(true);
    expect(geometry.cardOutlined).toBe(true);
    expect(geometry.cornersClear).toBe(true);
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(8);
    expect(bounds!.y).toBeGreaterThanOrEqual(8);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(892);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(612);
  });
}

test('uses three natural description lines and one compact detail-row gap', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 700 });
  const state = workspaceHoverCardPreview.states['long-content'];
  const card = state.props.cards[0]!;
  await mount(WorkspaceHoverCard, {
    props: {
      workspace: card.workspace,
      activeAgentIds: card.activeAgentIds,
      loadAgentSessions: false,
      loadWorkspaceData: false,
    },
  });

  const description = page.locator('[data-workspace-hover-card-status-message]');
  const agentRows = page.locator('[data-workspace-hover-card-agent-row]');
  const agentDetailRows = agentRows.locator('.workspace-hover-card__detail-row');
  const prRow = page.locator('[data-workspace-hover-card-pr-row]');
  const activity = page.locator('[data-workspace-hover-card-activity]');

  await expect(description).toBeVisible();
  expect(
    await description.evaluate((node) => {
      const element = node as HTMLElement;
      const style = getComputedStyle(element);
      const lineHeight = Number.parseFloat(style.lineHeight);
      return {
        lineClamp: style.webkitLineClamp,
        isTruncated: element.scrollHeight > element.clientHeight,
        renderedLines: Math.round(element.clientHeight / lineHeight),
      };
    }),
  ).toEqual({ lineClamp: '3', isTruncated: true, renderedLines: 3 });

  await expect(agentRows).toHaveCount(3);
  expect((await agentRows.allTextContents()).map((text) => text.trim())).toEqual([
    'Agent',
    'Agent',
    'Agent',
  ]);
  expect(await agentRows.first().getAttribute('aria-label')).toContain('Running');
  expect(
    await agentDetailRows.evaluateAll((rows) => rows.map((row) => getComputedStyle(row).columnGap)),
  ).toEqual(['6px', '6px', '6px']);
  expect(await prRow.evaluate((row) => getComputedStyle(row).columnGap)).toBe('6px');
  await expect(prRow.locator('[data-workspace-hover-card-pr-status]')).not.toHaveText('');

  const iconGeometry = await Promise.all(
    [
      agentRows.first().locator('[data-workspace-hover-card-agent-icon]'),
      prRow.locator('[data-workspace-hover-card-pr-icon]'),
    ].map(async (icon) => icon.boundingBox()),
  );
  expect(iconGeometry.every((bounds) => bounds?.width === 24)).toBe(true);
  expect(iconGeometry[0]!.x).toBeCloseTo(iconGeometry[1]!.x, 1);
  expect(
    await activity
      .locator(':scope > div')
      .evaluateAll((rows) => rows.map((row) => getComputedStyle(row).borderTopWidth)),
  ).toEqual(['0px', '0px']);
  await expect(activity.locator('[data-workspace-hover-card-divider]')).toHaveCount(0);
  await expect(activity.locator('[data-workspace-hover-card-pr-divider]')).toHaveCount(0);
});

test('keeps short descriptions at one line and stacks responsively when narrow', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 420, height: 700 });
  await mount(WorkspaceHoverCard, {
    props: {
      workspace: { ...workspace, statusMessage: 'Short description.' },
      loadAgentSessions: false,
      loadWorkspaceData: false,
    },
  });

  const description = page.locator('[data-workspace-hover-card-status-message]');
  const columns = page.locator('[data-workspace-hover-card-columns]');
  const activity = page.locator('[data-workspace-hover-card-activity]');
  const geometry = await description.evaluate((node) => {
    const element = node as HTMLElement;
    const style = getComputedStyle(element);
    return {
      height: element.clientHeight,
      lineHeight: Number.parseFloat(style.lineHeight),
      lineClamp: style.webkitLineClamp,
    };
  });

  expect(geometry.lineClamp).toBe('3');
  expect(geometry.height).toBeCloseTo(geometry.lineHeight, 0);
  expect(
    await columns.evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length),
  ).toBe(1);
  expect(await activity.evaluate((node) => getComputedStyle(node).borderLeftWidth)).toBe('0px');
  expect(await activity.evaluate((node) => getComputedStyle(node).borderTopWidth)).toBe('1px');
  expect(
    await activity
      .locator(':scope > div')
      .evaluateAll((rows) => rows.map((row) => getComputedStyle(row).borderTopWidth)),
  ).toEqual(['0px', '0px']);
});
