/** @vitest-environment jsdom */
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { writable } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '$shared/ipc-registry';

const mocks = vi.hoisted(() => ({
  backendRequest: vi.fn(),
  invoke: vi.fn(() => Promise.resolve()),
}));

const readable = <T>(value: T) => ({
  subscribe(run: (current: T) => void) {
    run(value);
    return () => {};
  },
});

const guestSession = writable<{ hostname: string | null; label: string } | null>(null);
vi.mock('$store/renderer/slices/guest-sessions/guest-sessions-selectors', () => ({
  selectWindowGuestSession: () => guestSession,
}));

vi.mock('$app/state', () => ({
  page: { params: { id: 'ws-1' }, url: { pathname: '/workspace/ws-1' } },
}));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: mocks.backendRequest,
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

describe('WindowTitleBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    guestSession.set(null);
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

    expect(mocks.backendRequest).not.toHaveBeenCalled();
  });

  it('refreshes the guest native title when host metadata arrives and clears it on switch', async () => {
    guestSession.set({ hostname: null, label: 'remote.example' });
    const view = render(WindowTitleBar, { workspaceId: 'ws-1' });
    await tick();
    expect(mocks.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.WINDOW.SET_TITLE, {
      title: 'One [remote.example]',
    });
    guestSession.set({ hostname: 'Remote Studio', label: 'remote.example' });
    await tick();
    expect(mocks.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.WINDOW.SET_TITLE, {
      title: 'One [Remote Studio]',
    });
    await view.rerender({ workspaceId: undefined });
    await tick();
    expect(mocks.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.WINDOW.SET_TITLE, {
      title: 'Intent [Remote Studio]',
    });
    guestSession.set(null);
    await tick();
    expect(mocks.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.WINDOW.SET_TITLE, {
      title: 'Intent',
    });
  });

  it('keeps the native window title current when the workspace changes', async () => {
    const view = render(WindowTitleBar, { workspaceId: 'ws-1' });
    await tick();

    expect(mocks.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.WINDOW.SET_TITLE, { title: 'One' });

    await view.rerender({ workspaceId: 'ws-2' });
    await tick();

    expect(mocks.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.WINDOW.SET_TITLE, { title: 'Two' });

    await view.rerender({ workspaceId: undefined });
    await tick();

    expect(mocks.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.WINDOW.SET_TITLE, {
      title: 'Intent',
    });
  });
});
