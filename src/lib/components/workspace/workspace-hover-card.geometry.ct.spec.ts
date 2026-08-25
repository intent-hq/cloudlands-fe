import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Workspace } from '$shared/types';
import { WorkspaceStatus } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
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
