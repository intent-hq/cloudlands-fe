import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS } from '$shared/ipc-registry';
import { formatNativeWindowTitle } from './native-window-title';

const mocks = vi.hoisted(() => {
  const mutableReadable = <T>(initial: T) => {
    let value = initial;
    const subscribers = new Set<(current: T) => void>();
    return {
      subscribe(run: (current: T) => void) {
        subscribers.add(run);
        run(value);
        return () => subscribers.delete(run);
      },
      set(next: T) {
        value = next;
        for (const subscriber of subscribers) subscriber(value);
      },
    };
  };
  const readable = <T>(value: T) => mutableReadable(value);
  const activeTabs = new Map<string, { title?: string }>();
  const activeTabOutputs = new Set<{
    workspaceId: string;
    set(value?: { title?: string }): void;
  }>();
  return {
    invoke: vi.fn().mockResolvedValue(null),
    workspaceItems: mutableReadable<Array<{ id: string; title: string; branch: string }>>([]),
    activeTabs,
    activeTabOutputs,
    readable,
    setActiveTab(workspaceId: string, tab?: { title?: string }) {
      if (tab) activeTabs.set(workspaceId, tab);
      else activeTabs.delete(workspaceId);
      for (const output of activeTabOutputs) {
        if (output.workspaceId === workspaceId) output.set(tab);
      }
    },
  };
});

vi.mock('$app/state', () => ({
  page: { url: { pathname: '/workspace/ws-1' }, params: { id: 'ws-1' } },
}));
vi.mock('$lib/electron-bridge', () => ({ invoke: mocks.invoke }));
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceItems: () => mocks.workspaceItems,
}));
vi.mock('$store/renderer/slices/panel-layout/panel-layout-selectors', () => ({
  selectActiveTab: (workspaceIdStore: { subscribe(run: (value: string) => void): () => void }) => {
    const output = mocks.readable<{ title?: string } | undefined>(undefined);
    const record = { workspaceId: '', set: output.set };
    mocks.activeTabOutputs.add(record);
    workspaceIdStore.subscribe((workspaceId) => {
      record.workspaceId = workspaceId;
      output.set(mocks.activeTabs.get(workspaceId));
    });
    return output;
  },
}));
vi.mock('$store/renderer/slices/user-preferences/user-preferences-selectors', () => ({
  selectZoomFactor: () => mocks.readable(1),
  selectCounterScale: () => mocks.readable(1),
}));
vi.mock('$store/renderer/slices/sidebar-nav/sidebar-nav-selectors', () => ({
  selectOnboardingActive: () => mocks.readable(false),
  selectPanelItem: () => mocks.readable(null),
  selectPanelWidth: () => mocks.readable(0),
}));
vi.mock('$features/agent/services/active-streams-tracker', () => ({
  activeStreamsTracker: {
    startPolling: vi.fn(),
    subscribe: () => () => {},
    getStreamingAgentIdsForWorkspace: () => [],
  },
}));
vi.mock('$features/file-tracking/file-tracking.client', () => ({
  getLineStats: vi.fn().mockResolvedValue({ additions: 0, deletions: 0 }),
}));
vi.mock('$lib/utils/workspace-navigation', () => ({
  navigateBackFromSettings: vi.fn(),
  navigateToSettings: vi.fn(),
}));

vi.mock('$lib/components/ui/tooltip', async () => ({
  Tooltip: (await import('../../../routes/__tests__/mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/ui/button', async () => ({
  Button: (await import('../../../routes/__tests__/mocks/Marker.svelte')).default,
}));
vi.mock('$lib/icons/IntentNavigationIcon.svelte', async () => ({
  default: (await import('../../../routes/__tests__/mocks/Marker.svelte')).default,
}));
vi.mock('./DaemonStatusIndicator.svelte', async () => ({
  default: (await import('../../../routes/__tests__/mocks/Marker.svelte')).default,
}));
vi.mock('./WorkspaceTabStrip.svelte', async () => ({
  default: (await import('../../../routes/__tests__/mocks/Marker.svelte')).default,
}));
vi.mock('./WorkspaceRepoLauncher.svelte', async () => ({
  default: (await import('../../../routes/__tests__/mocks/Marker.svelte')).default,
}));
vi.mock('./sidebar-nav/SidebarNav.svelte', async () => ({
  default: (await import('../../../routes/__tests__/mocks/Marker.svelte')).default,
}));

describe('formatNativeWindowTitle', () => {
  it('orders the focused tab, workspace title, and branch', () => {
    expect(
      formatNativeWindowTitle({
        focusedTabTitle: 'Review',
        workspaceTitle: 'Window titles',
        branch: 'feat/window-title',
      }),
    ).toBe('Review — Window titles — feat/window-title');
  });

  it.each([
    [
      { workspaceTitle: 'Window titles', branch: 'feat/window-title' },
      'Window titles — feat/window-title',
    ],
    [{ focusedTabTitle: 'Review', branch: 'feat/window-title' }, 'Review — feat/window-title'],
    [{ focusedTabTitle: 'Review', workspaceTitle: 'Window titles' }, 'Review — Window titles'],
    [{ branch: 'feat/window-title' }, 'feat/window-title'],
  ])('omits unavailable parts while preserving order', (context, expected) => {
    expect(formatNativeWindowTitle(context)).toBe(expected);
  });

  it('trims parts, omits blank values, and falls back to the brand name', () => {
    expect(formatNativeWindowTitle({ focusedTabTitle: '  Review  ', branch: '  main  ' })).toBe(
      'Review — main',
    );
    expect(
      formatNativeWindowTitle({ focusedTabTitle: ' ', workspaceTitle: '\t', branch: '' }),
    ).toBe('Intent');
  });
});

describe('WindowTitleBar native title effect', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    mocks.invoke.mockClear();
    mocks.activeTabs.clear();
    mocks.activeTabOutputs.clear();
    mocks.workspaceItems.set([
      { id: 'ws-1', title: 'First workspace', branch: 'feat/first' },
      { id: 'ws-2', title: 'Second workspace', branch: '' },
    ]);
    mocks.setActiveTab('ws-1', { title: 'First tab' });
    mocks.setActiveTab('ws-2', { title: 'Second tab' });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('sends current tab and workspace context and drops stale data after changes', async () => {
    const WindowTitleBar = (await import('./WindowTitleBar.svelte')).default;
    const view = render(WindowTitleBar, { workspaceId: 'ws-1' });

    await expectLastTitle('First tab — First workspace — feat/first');

    mocks.setActiveTab('ws-1', { title: 'Renamed tab' });
    await expectLastTitle('Renamed tab — First workspace — feat/first');

    mocks.workspaceItems.set([
      { id: 'ws-1', title: 'Renamed workspace', branch: 'fix/renamed' },
      { id: 'ws-2', title: 'Second workspace', branch: '' },
    ]);
    await expectLastTitle('Renamed tab — Renamed workspace — fix/renamed');

    await view.rerender({ workspaceId: 'ws-2' });
    await expectLastTitle('Second tab — Second workspace');
    expect(lastTitle()).not.toContain('fix/renamed');

    mocks.setActiveTab('ws-2', undefined);
    mocks.workspaceItems.set([]);
    await expectLastTitle('Intent');
  });
});

function lastTitle(): string {
  return mocks.invoke.mock.calls.at(-1)?.[1]?.title as string;
}

async function expectLastTitle(title: string): Promise<void> {
  await waitFor(() => {
    expect(mocks.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.WINDOW.SET_TITLE, { title });
  });
}
