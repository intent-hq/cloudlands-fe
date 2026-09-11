/** @vitest-environment jsdom */
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getLineStats: vi.fn(),
  invoke: vi.fn(() => Promise.resolve()),
}));

const readable = <T>(value: T) => ({
  subscribe(run: (current: T) => void) {
    run(value);
    return () => {};
  },
});

vi.mock('$app/state', () => ({
  page: { params: { id: 'ws-1' }, url: { pathname: '/workspace/ws-1' } },
}));
vi.mock('$features/file-tracking/file-tracking.client', () => ({
  getLineStats: mocks.getLineStats,
}));
vi.mock('$lib/electron-bridge', () => ({ invoke: mocks.invoke }));
vi.mock('$lib/components/ui/tooltip', () => ({ Tooltip: () => null }));
vi.mock('$lib/components/ui/button', () => ({ Button: () => null }));
vi.mock('$store/renderer/slices/panel-layout/panel-layout-selectors', () => ({
  selectActiveTab: () => readable(null),
}));
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceItems: () =>
    readable([
      { id: 'ws-1', title: 'One' },
      { id: 'ws-2', title: 'Two', attention: 'unread' },
    ]),
}));
vi.mock('$store/renderer/slices/user-preferences/user-preferences-selectors', () => ({
  selectZoomFactor: () => readable(1),
  selectCounterScale: () => readable(1),
}));
vi.mock('$store/renderer/slices/sidebar-nav/sidebar-nav-selectors', () => ({
  selectOnboardingActive: () => readable(false),
  selectPanelItem: () => readable(null),
  selectPanelWidth: () => readable(0),
}));
vi.mock('$lib/utils/workspace-navigation', () => ({
  navigateBackFromSettings: vi.fn(),
  navigateToSettings: vi.fn(),
}));
vi.mock('$lib/icons/IntentNavigationIcon.svelte', () => ({ default: () => null }));
vi.mock('./DaemonStatusIndicator.svelte', () => ({ default: () => null }));
vi.mock('./WorkspaceTabStrip.svelte', () => ({ default: () => null }));
vi.mock('./WorkspaceRepoLauncher.svelte', () => ({ default: () => null }));
vi.mock('./sidebar-nav/SidebarNav.svelte', () => ({ default: () => null }));

import WindowTitleBar from './WindowTitleBar.svelte';

describe('WindowTitleBar line stats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
  });

  it('does not issue unused line-stat reads on mount or workspace changes', async () => {
    const view = render(WindowTitleBar, { workspaceId: 'ws-1' });
    await tick();

    await view.rerender({ workspaceId: 'ws-2' });
    await tick();

    expect(mocks.getLineStats).not.toHaveBeenCalled();
  });
});
