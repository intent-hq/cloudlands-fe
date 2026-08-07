/**
 * @vitest-environment jsdom
 *
 * WindowTitleBar's handleApplyPreset toast-on-false branch (intent-hq/monorepo#1612):
 * a preset that resolves to nothing (e.g. agents-row in an empty workspace)
 * must surface a toast instead of silently no-opping.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { readable } from 'svelte/store';

const { toastInfoMock, applyContentPresetMock } = vi.hoisted(() => ({
  toastInfoMock: vi.fn(),
  applyContentPresetMock: vi.fn(),
}));

vi.mock('$app/state', () => ({
  page: { url: new URL('http://localhost/workspace/ws-1') },
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('../../ui/__tests__/mocks/Fa.svelte')).default,
}));

vi.mock('$lib/components/ui/tooltip', async () => ({
  Tooltip: (await import('../../workspace/sidebar/__tests__/mocks/MockTooltip.svelte')).default,
}));

vi.mock('../DaemonStatusIndicator.svelte', async () => ({
  default: (await import('../../ui/diff/__tests__/mocks/MockSimple.svelte')).default,
}));

vi.mock('$lib/components/layout/panel-system', async () => ({
  PanelLayoutControls: (await import('./mocks/MockPanelLayoutControls.svelte')).default,
}));

vi.mock('$features/layout/panel-layout-adapter', () => ({
  getPanelLayoutManager: vi.fn(() => ({ goBack: vi.fn(), goForward: vi.fn() })),
}));

vi.mock('$features/layout/preset-executor', () => ({
  applyContentPreset: applyContentPresetMock,
}));

vi.mock('$lib/components/ui/toast', () => ({
  toast: { info: toastInfoMock, error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

vi.mock('$features/agent/services/active-streams-tracker', () => ({
  activeStreamsTracker: {
    startPolling: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    getStreamingAgentIdsForWorkspace: vi.fn(() => []),
  },
}));

vi.mock('$lib/electron-bridge', () => ({
  invoke: vi.fn(async () => undefined),
}));

vi.mock('$features/file-tracking/file-tracking.client', () => ({
  getLineStats: vi.fn(async () => ({ additions: 0, deletions: 0 })),
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import(
    '$store/renderer/utils/test-helpers/store-mock'
  );
  return createAppStoreMockModule({ state: () => ({}), dispatch: vi.fn() });
});

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceItems: () =>
    readable([{ id: 'ws-1', title: 'Test workspace', status: 'active' }]),
}));

vi.mock('$store/renderer/slices/panel-layout/panel-layout-selectors', () => ({
  selectPanelLayoutRoot: () => readable(null),
  selectCanGoBack: () => readable(false),
  selectCanGoForward: () => readable(false),
  selectActiveTab: () => readable(undefined),
}));

vi.mock('$store/renderer/slices/user-preferences/user-preferences-selectors', () => ({
  selectZoomFactor: () => readable(1),
  selectCounterScale: () => readable(1),
}));

vi.mock('$store/renderer/slices/sidebar-nav/sidebar-nav-selectors', () => ({
  selectOnboardingActive: () => readable(false),
}));

vi.mock('$store/renderer/slices/ui-layout/ui-layout-selectors', () => ({
  selectSidebarSide: () => readable('left'),
}));

vi.mock('$store/renderer/slices/ui-layout/ui-layout-slice', () => ({
  toggleSidebar: vi.fn(() => ({ type: 'uiLayout/toggleSidebar' })),
}));

vi.mock('$store/renderer/slices/palette/palette-slice', () => ({
  openPalette: vi.fn(() => ({ type: 'palette/open' })),
}));

import WindowTitleBar from '../WindowTitleBar.svelte';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('WindowTitleBar — preset resolves to nothing', () => {
  it('shows a toast when applyContentPreset resolves false (e.g. agents-row on an empty workspace)', async () => {
    applyContentPresetMock.mockResolvedValueOnce(false);
    const { getByTestId } = render(WindowTitleBar, { props: { workspaceId: 'ws-1' } });

    await fireEvent.click(getByTestId('mock-apply-agents-row'));

    await waitFor(() => {
      expect(applyContentPresetMock).toHaveBeenCalledTimes(1);
    });
    expect(toastInfoMock).toHaveBeenCalledTimes(1);
  });

  it('does not toast when the preset applies successfully', async () => {
    applyContentPresetMock.mockResolvedValueOnce(true);
    const { getByTestId } = render(WindowTitleBar, { props: { workspaceId: 'ws-1' } });

    await fireEvent.click(getByTestId('mock-apply-agents-row'));

    await waitFor(() => {
      expect(applyContentPresetMock).toHaveBeenCalledTimes(1);
    });
    expect(toastInfoMock).not.toHaveBeenCalled();
  });
});
