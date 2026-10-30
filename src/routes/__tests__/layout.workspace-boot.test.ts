/**
 * A direct workspace URL can mount before the window backend binds. Restoring
 * that backend's saved tabs must not strand the visible workspace without a
 * tab, which cancels its data loading and leaves the Agents panel empty.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { createRawSnippet, tick } from 'svelte';
import { installConsoleTeardownGuard } from './helpers/console-teardown-guard';

installConsoleTeardownGuard();

const mockPage = vi.hoisted(() => ({ pathname: '/workspace/deep-linked', id: 'deep-linked' }));
vi.mock('$app/navigation', () => ({
  goto: vi.fn(() => Promise.resolve()),
  beforeNavigate: vi.fn(),
  afterNavigate: vi.fn(),
}));

vi.mock('$app/stores', () => ({
  page: {
    subscribe: (run: (value: unknown) => void) => {
      run({
        url: { pathname: mockPage.pathname },
        params: { id: mockPage.id },
        route: { id: mockPage.pathname },
      });
      return () => {};
    },
  },
}));

vi.mock('$store/renderer/root-store-lifecycle', () => ({
  startRootStoreLifecycle: () => () => {},
}));
vi.mock('$store/renderer/app-store-lifecycle', () => ({
  startAppStoreLifecycle: () => () => {},
}));
vi.mock('$store/renderer/sagas', () => ({ startAllAppSagas: () => [] }));
vi.mock('$store/renderer/seeders', () => ({}));
vi.mock('$features/layout/tab-types/register-all', () => ({
  registerAllTabTypes: () => {},
  preloadRestoredTabTypes: async () => {},
}));
vi.mock('$features/backend/splash-gate', () => ({
  dismissSplashElement: () => {},
  wireSplashGate: () => () => {},
}));
vi.mock('$lib/utils/diff-highlighter-preloader', () => ({ preloadDiffHighlighter: () => {} }));
vi.mock('$lib/utils/monaco-workers', () => ({ configureMonacoWorkers: async () => {} }));
vi.mock('$features/agent/interrupted-agents-service', () => ({
  installInterruptedAgentsService: () => () => {},
  notifyInterruptedAgentsModalClosed: () => {},
  resolveInterruptedAgents: async () => {},
}));
vi.mock('$lib/client/live/live-app-client', () => ({ LiveAppClient: class {} }));

vi.mock('$lib/components/layout/WindowTitleBar.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/ui/toast/Toast.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$features/hardware-console/prompt-picker/RadialPromptPickerOverlay.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$features/hardware-console/encoder/EncoderCycleHud.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$features/hardware-console/actions/ActionKeyHud.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/CommandPalette.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/AuggieSetupGate.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/debug/DebugPanel.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/GitCredentialsModal.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/GitHubAuthModal.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/layout/KeyboardShortcutsCheatSheet.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/modals/WorkspaceWarningDialogs.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/modals/ReleaseNotesModal.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$features/stats/StatsOverlay.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$features/daemon-status/DaemonStoppedOverlay.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$features/daemon-status/DaemonUpdatingOverlay.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/terminal/RootQuakeTerminalOverlay.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/modals/FeatureCodeDialog.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/modals/NewSpaceModal.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/modals/InterruptedAgentsModal.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$features/navigation/LinkActionMenu.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/ui/tooltip/LinkTooltip.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));

import { store as appStore } from '$store/renderer/store';
import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
import {
  closeWorkspaceTab,
  loadWorkspaceTabsState,
  openWorkspaceTab,
  workspaceTabsHydrated,
} from '$store/renderer/slices/tab-state/tab-state-slice';
import {
  selectActiveWorkspaceIds,
  selectCurrentWorkspaceTabId,
} from '$store/renderer/slices/tab-state/tab-state-selectors';
import { setBootRoutePathnameForTesting } from '$lib/utils/boot-route-gate';
import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import Layout from '../(app)/+layout.svelte';

const childrenSnippet = createRawSnippet(() => ({
  render: () => '<div data-testid="workspace-boot-children">content</div>',
}));

describe('(app)/+layout.svelte direct workspace boot', () => {
  afterEach(() => {
    cleanup();
    appStore.dispose();
    window.history.replaceState({}, '', '/');
  });

  it('opens the route after the bound backend restores its tabs, then honors later closes', async () => {
    window.history.replaceState({}, '', mockPage.pathname);
    setBootRoutePathnameForTesting(mockPage.pathname);
    appStore.init();
    appStore.dispatch(workspaceTabsHydrated(LOCAL_CONNECTION_ID));

    render(Layout, { props: { children: childrenSnippet } });
    await tick();
    expect(selectActiveWorkspaceIds.select(appStore.state)).toEqual([]);

    // A child can open the route while the initial connection is still binding.
    appStore.dispatch(openWorkspaceTab(mockPage.id));
    appStore.dispatch(
      connectionsListReceived({
        connections: [],
        activeId: 'browser-websocket',
        windowBackendId: 'browser-websocket',
      }),
    );
    appStore.dispatch(
      loadWorkspaceTabsState({
        openTabs: [],
        currentTabId: null,
        pinnedTabs: [],
        unsavedTabs: [],
        optimisticTabs: [],
        tabOrder: [],
      }),
    );
    await tick();
    expect(selectActiveWorkspaceIds.select(appStore.state)).toEqual([]);

    appStore.dispatch(workspaceTabsHydrated('browser-websocket'));
    await waitFor(() => {
      expect(selectActiveWorkspaceIds.select(appStore.state)).toEqual([mockPage.id]);
      expect(selectCurrentWorkspaceTabId.select(appStore.state)).toBe(mockPage.id);
    });

    appStore.dispatch(closeWorkspaceTab(mockPage.id));
    appStore.dispatch(workspaceTabsHydrated('browser-websocket'));
    await tick();
    expect(selectActiveWorkspaceIds.select(appStore.state)).toEqual([]);
  });
});
