/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { writable } from 'svelte/store';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  setWorkspaceViewModeWithTransition: vi.fn(() => Promise.resolve()),
}));
const viewMode = writable<'single' | 'columns'>('single');
const onboardingActive = writable(false);

const readable = <T>(value: T) => ({
  subscribe(run: (value: T) => void) {
    run(value);
    return () => {};
  },
});

vi.mock('$store/renderer/store', () => ({ store: { dispatch: mocks.dispatch } }));
vi.mock('$features/workspace/workspace-view-mode-action', () => ({
  setWorkspaceViewModeWithTransition: mocks.setWorkspaceViewModeWithTransition,
}));
vi.mock('$store/renderer/slices/tab-state/tab-state-selectors', () => ({
  selectWorkspaceViewMode: () => viewMode,
}));

// ── Mocks for rendering WindowTitleBar (onboarding gating suite below) ──
vi.mock('$app/state', () => ({
  page: { url: new URL('http://localhost/'), params: {} },
}));
vi.mock('$lib/electron-bridge', () => ({ invoke: vi.fn(() => Promise.resolve()) }));
vi.mock('$store/renderer/slices/panel-layout/panel-layout-selectors', () => ({
  selectActiveTab: () => readable(null),
}));
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceItems: () => readable([]),
}));
vi.mock('$store/renderer/slices/user-preferences/user-preferences-selectors', () => ({
  selectZoomFactor: () => readable(1),
  selectCounterScale: () => readable(1),
  selectPanelOpenMode: () => readable('normal'),
}));
vi.mock('$store/renderer/slices/sidebar-nav/sidebar-nav-selectors', () => ({
  selectOnboardingActive: () => onboardingActive,
  selectPanelItem: () => readable(null),
  selectPanelWidth: () => readable(0),
}));
vi.mock('$features/agent/services/active-streams-tracker', () => ({
  activeStreamsTracker: {
    startPolling: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    getStreamingAgentIdsForWorkspace: vi.fn(() => []),
  },
}));
vi.mock('$features/file-tracking/file-tracking.client', () => ({
  getLineStats: vi.fn(async () => ({ additions: 0, deletions: 0 })),
}));
vi.mock('$lib/utils/workspace-navigation', () => ({
  navigateToSettings: vi.fn(),
  navigateBackFromSettings: vi.fn(),
}));
vi.mock('./sidebar-nav/SidebarNav.svelte', () => ({ default: () => null }));
vi.mock('./WorkspaceTabStrip.svelte', () => ({ default: () => null }));
vi.mock('./DaemonStatusIndicator.svelte', () => ({ default: () => null }));
vi.mock('$lib/components/workspace/initializer/RepoSelector.svelte', () => ({
  default: () => null,
}));

import WorkspaceViewModeToggle from './WorkspaceViewModeToggle.svelte';
import WindowTitleBar from './WindowTitleBar.svelte';

describe('WorkspaceViewModeToggle', () => {
  beforeEach(() => {
    mocks.dispatch.mockClear();
    mocks.setWorkspaceViewModeWithTransition.mockClear();
    viewMode.set('single');
  });

  it('toggles between single and column workspace views', async () => {
    render(WorkspaceViewModeToggle);
    const toggle = screen.getByRole('button', { name: 'Open spaces in columns' });
    expect(toggle.getAttribute('data-state')).toBe('off');
    expect(toggle.querySelector('[data-navigation-icon="spaces"]')).toBeTruthy();

    await fireEvent.click(toggle);
    expect(mocks.setWorkspaceViewModeWithTransition).toHaveBeenCalledWith('columns');

    viewMode.set('columns');
    await waitFor(() => expect(toggle.querySelector('[data-navigation-icon="tabs"]')).toBeTruthy());
    await fireEvent.click(toggle);
    expect(mocks.setWorkspaceViewModeWithTransition).toHaveBeenLastCalledWith('single');
  });

  it('restores the destination glyph and keeps the pressed button transparent', () => {
    viewMode.set('columns');
    render(WorkspaceViewModeToggle);

    const toggle = screen.getByRole('button', { name: 'Open spaces' });
    expect(toggle.querySelector('[data-navigation-icon="tabs"]')).toBeTruthy();
    expect(toggle.hasAttribute('title')).toBe(false);
    expect(toggle.textContent?.trim()).toBe('');
    expect(getComputedStyle(toggle).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(toggle.className).toContain('text-foreground');
  });

  it('shows one accessible shortcut tooltip on keyboard focus without replacing pressed state', async () => {
    render(WorkspaceViewModeToggle);
    const toggle = screen.getByRole('button', { name: 'Open spaces in columns' });

    toggle.focus();
    await fireEvent.focus(toggle);
    const tooltip = await screen.findByRole('tooltip', { hidden: true });
    const shortcut = tooltip.querySelector<HTMLElement>('[data-tooltip-shortcut]');

    expect(screen.getAllByRole('tooltip', { hidden: true })).toHaveLength(1);
    expect(tooltip.textContent).toContain('Open spaces in columns');
    expect(shortcut?.textContent).toBe('Ctrl+Shift+L');
    expect(shortcut?.className).toContain('text-muted-foreground');
    expect(tooltip.className).toContain('motion-reduce:animate-none');
    expect(toggle.getAttribute('aria-describedby')).toBe(tooltip.id);
    expect(toggle.getAttribute('aria-label')).toBe('Open spaces in columns');
    expect(toggle.getAttribute('data-state')).toBe('off');
  });

  it('tracks rapid mode changes without showing a stale destination glyph', async () => {
    render(WorkspaceViewModeToggle);
    const toggle = screen.getByRole('button', { name: 'Open spaces in columns' });

    viewMode.set('columns');
    viewMode.set('single');
    viewMode.set('columns');
    await waitFor(() => {
      expect(toggle.querySelector('[data-navigation-icon="tabs"]')).toBeTruthy();
      expect(toggle.querySelector('[data-navigation-icon="spaces"]')).toBeNull();
      expect(toggle.getAttribute('aria-label')).toBe('Open spaces');
    });
  });

  it('uses a 32px hit box and a 16px destination glyph', () => {
    const { container } = render(WorkspaceViewModeToggle);
    const toggle = screen.getByRole('button', { name: 'Open spaces in columns' });
    const icon = container.querySelector('[data-navigation-icon="spaces"]');

    expect(toggle.className).toContain('size-8');
    expect(toggle.className).toContain('shrink-0');
    expect(icon?.parentElement?.className).toContain('size-5');
    expect(icon?.getAttribute('width')).toBe('16');
    expect(icon?.getAttribute('height')).toBe('16');
  });
});

describe('WindowTitleBar onboarding gating', () => {
  beforeEach(() => {
    mocks.dispatch.mockClear();
    viewMode.set('single');
    onboardingActive.set(false);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
  });

  it('hides the view-mode toggle and repo launcher while onboarding is active', async () => {
    render(WindowTitleBar);

    expect(screen.getByRole('button', { name: 'Open spaces in columns' })).toBeTruthy();
    expect(document.querySelector('[data-workspace-repo-launcher]')).toBeTruthy();
    expect(document.querySelector('[data-titlebar-settings]')).toBeTruthy();

    onboardingActive.set(true);
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Open spaces in columns' })).toBeNull();
      expect(document.querySelector('[data-workspace-repo-launcher]')).toBeNull();
    });
    // Other titlebar controls stay untouched.
    expect(document.querySelector('[data-titlebar-settings]')).toBeTruthy();
  });

  it('restores both controls when onboarding ends', async () => {
    onboardingActive.set(true);
    render(WindowTitleBar);

    expect(screen.queryByRole('button', { name: 'Open spaces in columns' })).toBeNull();
    expect(document.querySelector('[data-workspace-repo-launcher]')).toBeNull();

    onboardingActive.set(false);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Open spaces in columns' })).toBeTruthy();
      expect(document.querySelector('[data-workspace-repo-launcher]')).toBeTruthy();
    });
  });
});
