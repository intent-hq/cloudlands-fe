/**
 * @vitest-environment jsdom
 *
 * SidebarBrowserGroup hidden-row affordance (monorepo#3169): hidden (dimmed)
 * rows must be whole-row clickable like the visible rows — clicking anywhere
 * on the row calls onRestoreTab, and the row is a focusable button with an
 * aria-label.
 */
import { render, fireEvent, cleanup, screen } from '@testing-library/svelte';
import { describe, it, expect, vi, afterEach } from 'vitest';

import SidebarBrowserGroup from '../SidebarBrowserGroup.svelte';
import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';

const browserTab = (id: string, title: string): PanelTab =>
  ({
    id,
    type: 'browser',
    title,
    browserUrl: `http://example.test/${id}`, // i18n-ignore (test fixture URL)
    ownerAgentId: 'agent-1',
  }) as PanelTab;

function renderGroup(overrides: { onOpenTab?: () => void; onRestoreTab?: (id: string) => void }) {
  const onOpenTab = overrides.onOpenTab ?? vi.fn();
  const onRestoreTab = overrides.onRestoreTab ?? vi.fn();
  render(SidebarBrowserGroup, {
    group: {
      ownerAgentId: 'agent-1',
      ownerName: 'Helper',
      entries: [
        { tab: browserTab('visible-1', 'Docs'), panelId: 'p1', active: true, hidden: false },
        { tab: browserTab('hidden-1', 'Preview'), active: false, hidden: true },
      ],
    },
    onOpenTab,
    onRestoreTab,
  });
  return { onOpenTab, onRestoreTab };
}

afterEach(cleanup);

describe('SidebarBrowserGroup hidden rows', () => {
  it('renders the hidden row as a whole-row button with a restore aria-label', () => {
    renderGroup({});
    const row = document.querySelector('[data-sidebar-browser-hidden-tab="hidden-1"]');
    expect(row).not.toBeNull();
    expect((row as HTMLElement).tagName).toBe('BUTTON');
    // Parameterized label keeps the tab title in the accessible name.
    expect(row).toBe(screen.getByRole('button', { name: 'Restore hidden tab Preview' }));
  });

  it('calls onRestoreTab when clicking anywhere on the hidden row', async () => {
    const onRestoreTab = vi.fn();
    renderGroup({ onRestoreTab });

    // Click the title text, not the restore icon — anywhere on the row works.
    const row = document.querySelector(
      '[data-sidebar-browser-hidden-tab="hidden-1"]',
    ) as HTMLElement;
    const title = row.querySelector('[title="Preview"]') as HTMLElement;
    await fireEvent.click(title);

    expect(onRestoreTab).toHaveBeenCalledExactlyOnceWith('hidden-1');
  });

  it('collapses and restores both visible and hidden tabs', async () => {
    const { onRestoreTab } = renderGroup({});
    const header = screen.getByRole('button', { name: 'Helper 2' });
    await fireEvent.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Docs' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Restore hidden tab Preview' })).toBeNull();
    await fireEvent.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('true');
    await fireEvent.click(screen.getByRole('button', { name: 'Restore hidden tab Preview' }));
    expect(onRestoreTab).toHaveBeenCalledExactlyOnceWith('hidden-1');
  });

  it('still opens visible tabs via onOpenTab', async () => {
    const onOpenTab = vi.fn();
    renderGroup({ onOpenTab });
    await fireEvent.click(
      document.querySelector('[data-sidebar-browser-tab="visible-1"]') as HTMLElement,
    );
    expect(onOpenTab).toHaveBeenCalledExactlyOnceWith('visible-1', 'p1');
  });
});
