/**
 * Regression test for the /hud chrome-less behavior restored after e10980e5.
 * The route group enforces the boundary structurally: the root owns shared Store
 * lifecycle, while `(app)` owns product sagas, chrome, and overlays.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { installConsoleTeardownGuard } from './helpers/console-teardown-guard';

// Guard against layout onMount deferred work logging after the last test and
// racing worker teardown (intent-hq/monorepo#1774).
installConsoleTeardownGuard();

const mockPage = vi.hoisted(() => ({ pathname: '/' }));
const mocks = vi.hoisted(() => ({ startAppStoreLifecycle: vi.fn(() => () => {}) }));

vi.mock('$app/navigation', () => ({
  goto: vi.fn(),
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
  startAppStoreLifecycle: mocks.startAppStoreLifecycle,
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

// Components this suite asserts the presence/absence of get a distinct
// labeled marker; every other heavy child gets the generic marker.
vi.mock('$lib/components/layout/sidebar-nav', async () => ({
  SidebarNav: (await import('./mocks/SidebarNavMarker.svelte')).default,
  SidebarPanel: (await import('./mocks/SidebarNavMarker.svelte')).default,
}));
vi.mock('$lib/components/layout/WindowTitleBar.svelte', async () => ({
  default: (await import('./mocks/WindowTitleBarMarker.svelte')).default,
}));
vi.mock('$lib/components/ui/toast/Toast.svelte', async () => ({
  default: (await import('./mocks/ToastMarker.svelte')).default,
}));
vi.mock('$features/hardware-console/prompt-picker/RadialPromptPickerOverlay.svelte', async () => ({
  default: (await import('./mocks/RadialPromptPickerOverlayMarker.svelte')).default,
}));
vi.mock('$features/hardware-console/encoder/EncoderCycleHud.svelte', async () => ({
  default: (await import('./mocks/EncoderCycleHudMarker.svelte')).default,
}));
vi.mock('$features/hardware-console/actions/ActionKeyHud.svelte', async () => ({
  default: (await import('./mocks/ActionKeyHudMarker.svelte')).default,
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
import AppLayout from '../(app)/+layout.svelte';
import RootLayout from '../+layout.svelte';
import HudLayout from '../hud/+layout.svelte';

const childrenSnippet = createRawSnippet(() => ({
  render: () => '<div data-testid="hud-gating-children">content</div>',
}));

describe('+layout.svelte isHudRoute chrome-less gating', () => {
  beforeEach(() => {
    appStore.init();
    mocks.startAppStoreLifecycle.mockClear();
  });

  afterEach(() => {
    cleanup();
    appStore.dispose();
  });

  it('suppresses app chrome and renders HudChromelessMain on /hud', () => {
    mockPage.pathname = '/hud';

    render(RootLayout, { props: { children: childrenSnippet } });

    expect(screen.queryByTestId('window-title-bar-marker')).toBeNull();
    expect(screen.queryByTestId('sidebar-nav-marker')).toBeNull();
    expect(screen.queryByTestId('toast-marker')).toBeNull();
    expect(screen.queryByTestId('radial-prompt-picker-overlay-marker')).toBeNull();
    expect(screen.queryByTestId('encoder-cycle-hud-marker')).toBeNull();

    expect(screen.queryByTestId('action-key-hud-marker')).toBeNull();
    expect(screen.getByTestId('hud-gating-children')).toBeTruthy();
  });

  it('suppresses app chrome on nested /hud/* routes, matching isHudWindow/isHudWindowRenderer prefix semantics', () => {
    mockPage.pathname = '/hud/settings';

    render(RootLayout, { props: { children: childrenSnippet } });

    expect(screen.queryByTestId('window-title-bar-marker')).toBeNull();
    expect(screen.queryByTestId('sidebar-nav-marker')).toBeNull();
    expect(screen.queryByTestId('toast-marker')).toBeNull();
    expect(screen.queryByTestId('radial-prompt-picker-overlay-marker')).toBeNull();
    expect(screen.queryByTestId('encoder-cycle-hud-marker')).toBeNull();
    expect(screen.getByTestId('hud-gating-children')).toBeTruthy();
  });

  it('renders full chrome on non-HUD routes', () => {
    mockPage.pathname = '/';

    render(AppLayout, { props: { children: childrenSnippet } });

    expect(screen.getAllByTestId('window-title-bar-marker').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('sidebar-nav-marker').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('toast-marker').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('radial-prompt-picker-overlay-marker').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('encoder-cycle-hud-marker').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('action-key-hud-marker').length).toBeGreaterThan(0);
    expect(screen.getByTestId('hud-gating-children')).toBeTruthy();
    expect(mocks.startAppStoreLifecycle).toHaveBeenCalledOnce();
  });

  it.each(['/hud', '/hud/settings'])('owns one app saga lifecycle for %s', (pathname) => {
    mockPage.pathname = pathname;
    const stopAppStoreLifecycle = vi.fn();
    mocks.startAppStoreLifecycle.mockReturnValueOnce(stopAppStoreLifecycle);

    const view = render(HudLayout, { props: { children: childrenSnippet } });

    expect(mocks.startAppStoreLifecycle).toHaveBeenCalledOnce();
    expect(mocks.startAppStoreLifecycle).toHaveBeenCalledWith(appStore, undefined);
    expect(screen.getByTestId('hud-gating-children')).toBeTruthy();
    expect(stopAppStoreLifecycle).not.toHaveBeenCalled();

    view.unmount();
    expect(stopAppStoreLifecycle).toHaveBeenCalledOnce();
  });
});
