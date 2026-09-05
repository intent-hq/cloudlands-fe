/**
 * Regression test for the boot-path setup gate (end-to-end through the (app)
 * layout): fresh windows boot at /workspace/new, which renders the full-page
 * onboarding — but connecting to a backend that already has workspaces must
 * redirect to an existing workspace, not show onboarding. The decision
 * matrix itself is covered by the pure decideBootRoute unit tests
 * (src/lib/utils/boot-route-gate.test.ts); this suite pins the layout
 * wiring: selectors in → decideBootRoute → dispatch(bootRouteGateResolved) +
 * goto out.
 *
 * Single scenario per store lifecycle: Themis caches selector readables per
 * store instance bound to the first init()'s state stream, so re-rendering
 * the layout after dispose()/init() would read stale state.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { createRawSnippet, tick } from 'svelte';
import { installConsoleTeardownGuard } from './helpers/console-teardown-guard';

installConsoleTeardownGuard();

const mockPage = vi.hoisted(() => ({ pathname: '/workspace/new' }));

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
        params: {},
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
vi.mock('$features/layout/tab-types/register-all', () => ({ registerAllTabTypes: () => {} }));
vi.mock('$features/backend/splash-gate', () => ({ wireSplashGate: () => () => {} }));
vi.mock('$lib/utils/diff-highlighter-preloader', () => ({ preloadDiffHighlighter: () => {} }));
vi.mock('$lib/utils/monaco-workers', () => ({ configureMonacoWorkers: async () => {} }));
vi.mock('$features/agent/interrupted-agents-service', () => ({
  installInterruptedAgentsService: () => () => {},
  notifyInterruptedAgentsModalClosed: () => {},
  resolveInterruptedAgents: async () => {},
}));
vi.mock('$lib/client/live/live-app-client', () => ({ LiveAppClient: class {} }));

vi.mock('$lib/components/layout/sidebar-nav', async () => ({
  SidebarNav: (await import('./mocks/Marker.svelte')).default,
  SidebarPanel: (await import('./mocks/Marker.svelte')).default,
}));
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
vi.mock('$lib/components/modals/InterruptedAgentsModal.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$features/navigation/LinkActionMenu.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/ui/tooltip/LinkTooltip.svelte', async () => ({
  default: (await import('./mocks/Marker.svelte')).default,
}));

import { goto } from '$app/navigation';
import { store as appStore } from '$store/renderer/store';
import {
  replaceWorkspaceList,
  setWorkspaceHasLoaded,
} from '$store/renderer/slices/workspace/workspace-slice';
import { workspaceTabsHydrated } from '$store/renderer/slices/tab-state/tab-state-slice';
import { selectBootRouteGateResolved } from '$store/renderer/slices/setup-prompt/setup-prompt-selectors';
import { setBootRoutePathnameForTesting } from '$lib/utils/boot-route-gate';
import { WorkspaceStatusEnum, type Workspace } from '$shared/types';
import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import Layout from '../(app)/+layout.svelte';

const childrenSnippet = createRawSnippet(() => ({
  render: () => '<div data-testid="boot-gate-children">content</div>',
}));

describe('(app)/+layout.svelte boot-route setup gate (regression)', () => {
  afterEach(() => {
    cleanup();
    appStore.dispose();
    window.history.replaceState({}, '', '/');
  });

  it('redirects a /workspace/new boot to an existing workspace instead of onboarding', async () => {
    window.history.replaceState({}, '', '/workspace/new');
    mockPage.pathname = '/workspace/new';
    setBootRoutePathnameForTesting('/workspace/new');

    appStore.init();
    appStore.dispatch(
      replaceWorkspaceList([
        {
          id: 'ws-1',
          title: 'Existing workspace',
          branch: 'main',
          changesets: [],
          timeline: [],
          conversationInfo: [],
          status: WorkspaceStatusEnum.Active,
        } as unknown as Workspace,
      ]),
    );
    appStore.dispatch(setWorkspaceHasLoaded(true));
    appStore.dispatch(workspaceTabsHydrated(LOCAL_CONNECTION_ID));

    render(Layout, { props: { children: childrenSnippet } });
    await tick();

    expect(goto).toHaveBeenCalledWith('/workspace/ws-1', { replaceState: true });
    expect(selectBootRouteGateResolved.select(appStore.state)).toBe(true);
  });
});
