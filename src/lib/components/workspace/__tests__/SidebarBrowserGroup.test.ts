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

  it('keeps hidden and visible rows on the same box model (fe#1554 alignment)', () => {
    renderGroup({});
    const hidden = document.querySelector(
      '[data-sidebar-browser-hidden-tab="hidden-1"]',
    ) as HTMLElement;
    const visible = document.querySelector('[data-sidebar-browser-tab="visible-1"]') as HTMLElement;
    // Both rows are plain-variant Buttons; identical box classes keep the
    // dot/text x-offsets aligned between hidden and visible rows.
    expect(hidden.tagName).toBe(visible.tagName);
    for (const cls of ['px-2', 'py-2', 'gap-2', 'w-full', 'items-start']) {
      expect(hidden.classList.contains(cls)).toBe(true);
      expect(visible.classList.contains(cls)).toBe(true);
    }
    // Dimming preserved on the hidden row's text block.
    expect(hidden.querySelector('.opacity-60')).not.toBeNull();
    expect(visible.querySelector('.opacity-60')).toBeNull();
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
