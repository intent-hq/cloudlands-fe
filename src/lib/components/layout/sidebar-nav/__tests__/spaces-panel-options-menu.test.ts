import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { m } from '$shared/paraglide/messages.js';
import { store as appStore } from '$store/renderer/store';
import {
  closePanel,
  openPanel,
  setAllSpacesViewMode,
  setChiefCollapsed,
  setShowArchivedWorkspaces,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import {
  selectAllSpacesViewMode,
  selectIsChiefCollapsed,
  selectShowArchivedWorkspaces,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';
import SidebarPanelHarness from './mocks/SidebarPanelHarness.svelte';

vi.mock('$lib/components/layout/sidebar-nav/cards/ActiveWorkspacesCard.svelte', async () => ({
  default: (await import('./mocks/MockHoverCardContent.svelte')).default,
}));
vi.mock('$lib/components/layout/sidebar-nav/cards/AllWorkspacesCard.svelte', async () => ({
  default: (await import('./mocks/MockHoverCardContent.svelte')).default,
}));
vi.mock('$lib/components/layout/sidebar-nav/cards/ChiefCard.svelte', async () => ({
  default: (await import('./mocks/MockHoverCardContent.svelte')).default,
}));
vi.mock('$lib/components/layout/sidebar-nav/cards/SettingsCard.svelte', async () => ({
  default: (await import('./mocks/MockHoverCardContent.svelte')).default,
}));

vi.mock('$features/agent/services/active-streams-tracker', () => ({
  activeStreamsTracker: {
    fetchActiveStreams: vi.fn(),
    startPolling: vi.fn(),
    getStreamingAgentIdsForWorkspace: vi.fn(() => []),
    subscribe: vi.fn(() => () => {}),
  },
}));

vi.mock('$lib/electron-bridge', () => ({
  on: vi.fn(),
  off: vi.fn(),
  once: vi.fn(),
  invoke: vi.fn(),
  listenSync: vi.fn(),
}));

function renderPanel() {
  return render(SidebarPanelHarness, {
    props: { setup: () => appStore.dispatch(openPanel('chief')) },
  });
}

async function openOptionsWithPointer() {
  const trigger = screen.getByRole('button', {
    name: m.layout_sidebarPanel_workspaceListOptions_tooltip(),
  });
  await fireEvent.click(trigger);
  await screen.findByRole('menu');
  return trigger;
}

describe('Spaces panel options menu', () => {
  beforeEach(() => {
    appStore.init();
    appStore.dispatch(setAllSpacesViewMode('recent'));
    appStore.dispatch(setShowArchivedWorkspaces(false));
    appStore.dispatch(setChiefCollapsed(false));
    global.ResizeObserver = class {
      observe = vi.fn();
      disconnect = vi.fn();
    } as never;
    global.MutationObserver = class {
      observe = vi.fn();
      disconnect = vi.fn();
      takeRecords = vi.fn();
    } as never;
  });

  afterEach(() => {
    cleanup();
    appStore.dispatch(closePanel());
  });

  it('opens a labeled radio/check menu from an accessible 32px options trigger', async () => {
    renderPanel();
    const trigger = screen.getByRole('button', { name: 'Workspace list options' });

    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.className).toContain('h-8');
    expect(trigger.className).toContain('w-8');
    expect(trigger.className).toContain('focus-visible:bg-muted/50');
    expect(trigger.className).not.toMatch(/focus-visible:(?:ring-[1-9]|ring-offset|shadow-)/);

    await openOptionsWithPointer();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('group', { name: 'Group by' })).toBeTruthy();
    expect(screen.getByRole('menuitemradio', { name: 'Recent' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(screen.getByRole('menuitemradio', { name: 'Repo' })).toBeTruthy();
    expect(screen.getByRole('menuitemradio', { name: 'Status' })).toBeTruthy();
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Show Archived' }).getAttribute('aria-checked'),
    ).toBe('false');
  });

  it('selects every explicit view mode exactly once and closes conventionally', async () => {
    renderPanel();
    const dispatchSpy = vi.spyOn(appStore, 'dispatch');

    for (const [name, mode] of [
      ['Repo', 'repo'],
      ['Status', 'status'],
      ['Recent', 'recent'],
    ] as const) {
      await openOptionsWithPointer();
      const before = dispatchSpy.mock.calls.filter(
        ([action]) => action.type === setAllSpacesViewMode.type,
      ).length;
      await fireEvent.click(screen.getByRole('menuitemradio', { name }));
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
      expect(selectAllSpacesViewMode.select(appStore.state)).toBe(mode);
      const after = dispatchSpy.mock.calls.filter(
        ([action]) => action.type === setAllSpacesViewMode.type,
      ).length;
      expect(after - before).toBe(1);
    }
  });

  it('toggles archived visibility while search is hidden and keeps the menu open', async () => {
    renderPanel();
    expect(screen.queryByPlaceholderText(m.layout_activeCard_search_placeholder())).toBeNull();
    await openOptionsWithPointer();

    const checkbox = screen.getByRole('menuitemcheckbox', { name: 'Show Archived' });
    await fireEvent.click(checkbox);
    expect(selectShowArchivedWorkspaces.select(appStore.state)).toBe(true);
    expect(checkbox.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('supports keyboard opening, Escape dismissal, and focus return', async () => {
    renderPanel();
    const trigger = screen.getByRole('button', { name: 'Workspace list options' });
    trigger.focus();
    await fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const recent = await screen.findByRole('menuitemradio', { name: 'Recent' });
    await waitFor(() => expect(document.activeElement).toBe(recent));

    await fireEvent.keyDown(recent, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('collapses and expands the Chief section with an accessible disclosure', async () => {
    const { container } = renderPanel();
    const toggle = screen.getByRole('button', { name: 'Chief of Staff' });
    const content = container.querySelector<HTMLElement>('#combined-panel-chief-content');

    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(content?.hidden).toBe(false);
    expect(container.querySelector('[data-testid="split-resize-handle"]')).toBeTruthy();

    toggle.focus();
    await fireEvent.click(toggle, { detail: 0 });

    expect(selectIsChiefCollapsed.select(appStore.state)).toBe(true);
    await waitFor(() => {
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(content?.hidden).toBe(true);
      expect(container.querySelector('[data-testid="split-resize-handle"]')).toBeNull();
    });

    await fireEvent.click(toggle, { detail: 0 });
    expect(selectIsChiefCollapsed.select(appStore.state)).toBe(false);
    await waitFor(() => expect(toggle.getAttribute('aria-expanded')).toBe('true'));
  });
});
