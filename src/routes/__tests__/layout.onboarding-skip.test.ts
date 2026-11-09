/**
 * Boot-route regression for a returning backend (end-to-end through the (app)
 * layout): with the permanent onboarding skip mark stored, a backend that
 * reports first-run setup and an empty workspace list lands on Home, never on
 * the full-page onboarding. One scenario per store lifecycle, as in
 * layout.boot-setup-gate.test.ts.
 */
import { admitLegacyPrincipal } from '../../test/fixtures/principal-state';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { createRawSnippet, tick } from 'svelte';
import { installConsoleTeardownGuard } from './helpers/console-teardown-guard';

installConsoleTeardownGuard();

const mockPage = vi.hoisted(() => ({ pathname: '/workspace/new' }));
// Mock factories run lazily on first import, so they double as a probe of the
// app-only modules the (app) layout graph must pull in.
const appGraph = vi.hoisted(() => ({
  seedersLoaded: false,
  actionKeyHudLoaded: false,
}));

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
vi.mock('$store/renderer/seeders', () => {
  appGraph.seedersLoaded = true;
  return {};
});
vi.mock('$features/layout/tab-types/register-all', () => ({ registerAllTabTypes: () => {} }));
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
vi.mock('$features/hardware-console/actions/ActionKeyHud.svelte', async () => {
  appGraph.actionKeyHudLoaded = true;
  return { default: (await import('./mocks/Marker.svelte')).default };
});
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

import { goto } from '$app/navigation';
import { store as appStore } from '$store/renderer/store';
import {
  replaceWorkspaceList,
  setWorkspaceHasLoaded,
} from '$store/renderer/slices/workspace/workspace-slice';
import { workspaceTabsHydrated } from '$store/renderer/slices/tab-state/tab-state-slice';
import { setupEvaluationCompleted } from '$store/renderer/slices/setup-prompt/setup-prompt-slice';
import { selectBootRouteGateResolved } from '$store/renderer/slices/setup-prompt/setup-prompt-selectors';
import { setBootRoutePathnameForTesting } from '$lib/utils/boot-route-gate';
import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import Layout from '../(app)/+layout.svelte';

const childrenSnippet = createRawSnippet(() => ({
  render: () => '<div data-testid="boot-gate-children">content</div>',
}));

describe('(app)/+layout.svelte boot route for a returning backend', () => {
  afterEach(() => {
    cleanup();
    appStore.dispose();
    window.history.replaceState({}, '', '/');
    vi.mocked(window.localStorage.getItem).mockImplementation(() => null);
  });

  it('lands on Home instead of onboarding when the marked backend reports first-run setup', async () => {
    vi.mocked(window.localStorage.getItem).mockImplementation((key) =>
      key === 'intent:onboarding-skip:v1' ? '1' : null,
    );
    window.history.replaceState({}, '', '/workspace/new');
    mockPage.pathname = '/workspace/new';
    setBootRoutePathnameForTesting('/workspace/new');

    appStore.init();
    admitLegacyPrincipal();
    appStore.dispatch(replaceWorkspaceList([]));
    appStore.dispatch(setWorkspaceHasLoaded(true, LOCAL_CONNECTION_ID));
    appStore.dispatch(workspaceTabsHydrated(LOCAL_CONNECTION_ID));
    appStore.dispatch(
      setupEvaluationCompleted({
        connectionId: LOCAL_CONNECTION_ID,
        isLocal: true,
        setupNeeded: true,
      }),
    );

    render(Layout, { props: { children: childrenSnippet } });
    await tick();

    expect(goto).toHaveBeenCalledWith('/', { replaceState: true });
    expect(goto).toHaveBeenCalledTimes(1);
    expect(selectBootRouteGateResolved.select(appStore.state)).toBe(true);
  });
});
