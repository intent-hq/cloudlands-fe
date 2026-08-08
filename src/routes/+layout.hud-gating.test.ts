/**
 * Regression test for the /hud chrome-less gating restored after e10980e5
 * (#584) dropped it. Mounts the real root `+layout.svelte` with the `/hud`
 * route mocked via `$app/stores`, stubbing every heavy child component and
 * module-level side effect (sagas, root-store lifecycle, tab-type
 * registration, splash gate, interrupted-agents service, Monaco/diff
 * preloaders, LiveAppClient) so the isHudRoute branch itself is what's
 * under test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';

const mockPage = vi.hoisted(() => ({ pathname: '/' }));

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
vi.mock('$store/renderer/sagas', () => ({ startAllAppSagas: () => [] }));
vi.mock('$store/renderer/seeders', () => ({}));
vi.mock('$features/layout/tab-types/register-all', () => ({ registerAllTabTypes: () => {} }));
vi.mock('$features/backend/splash-gate', () => ({ startSplashGate: () => () => {} }));
vi.mock('$lib/utils/diff-highlighter-preloader', () => ({ preloadDiffHighlighter: () => {} }));
vi.mock('$lib/utils/monaco-workers', () => ({ configureMonacoWorkers: async () => {} }));
vi.mock('$features/agent/interrupted-agents-service', () => ({
  installInterruptedAgentsService: () => () => {},
  notifyInterruptedAgentsModalClosed: () => {},
}));
vi.mock('$lib/client/live/live-app-client', () => ({ LiveAppClient: class {} }));

// Components this suite asserts the presence/absence of get a distinct
// labeled marker; every other heavy child gets the generic marker.
vi.mock('$lib/components/layout/sidebar-nav', async () => ({
  SidebarNav: (await import('./__tests__/mocks/SidebarNavMarker.svelte')).default,
  SidebarPanel: (await import('./__tests__/mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/layout/WindowTitleBar.svelte', async () => ({
  default: (await import('./__tests__/mocks/WindowTitleBarMarker.svelte')).default,
}));
vi.mock('$lib/components/UpdateDownloadIndicator.svelte', async () => ({
  default: (await import('./__tests__/mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/ui/toast/Toast.svelte', async () => ({
  default: (await import('./__tests__/mocks/ToastMarker.svelte')).default,
}));
vi.mock('$features/hardware-console/prompt-picker/RadialPromptPickerOverlay.svelte', async () => ({
  default: (await import('./__tests__/mocks/RadialPromptPickerOverlayMarker.svelte')).default,
}));
vi.mock('$features/hardware-console/encoder/EncoderCycleHud.svelte', async () => ({
  default: (await import('./__tests__/mocks/EncoderCycleHudMarker.svelte')).default,
}));
vi.mock('$features/hardware-console/actions/ActionKeyHud.svelte', async () => ({
  default: (await import('./__tests__/mocks/ActionKeyHudMarker.svelte')).default,
}));
vi.mock('$lib/components/CommandPalette.svelte', async () => ({
  default: (await import('./__tests__/mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/AuggieSetupGate.svelte', async () => ({
  default: (await import('./__tests__/mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/debug/DebugPanel.svelte', async () => ({
  default: (await import('./__tests__/mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/GitCredentialsModal.svelte', async () => ({
  default: (await import('./__tests__/mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/GitHubAuthModal.svelte', async () => ({
  default: (await import('./__tests__/mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/layout/KeyboardShortcutsCheatSheet.svelte', async () => ({
  default: (await import('./__tests__/mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/modals/WorkspaceWarningDialogs.svelte', async () => ({
  default: (await import('./__tests__/mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/modals/ReleaseNotesModal.svelte', async () => ({
  default: (await import('./__tests__/mocks/Marker.svelte')).default,
}));
vi.mock('$features/workspace/SpacesSwitcherOverlay.svelte', async () => ({
  default: (await import('./__tests__/mocks/Marker.svelte')).default,
}));
vi.mock('$features/stats/StatsOverlay.svelte', async () => ({
  default: (await import('./__tests__/mocks/Marker.svelte')).default,
}));
vi.mock('$features/daemon-status/DaemonStoppedOverlay.svelte', async () => ({
  default: (await import('./__tests__/mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/terminal/RootQuakeTerminalOverlay.svelte', async () => ({
  default: (await import('./__tests__/mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/modals/FeatureCodeDialog.svelte', async () => ({
  default: (await import('./__tests__/mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/modals/NewSpaceModal.svelte', async () => ({
  default: (await import('./__tests__/mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/modals/InterruptedAgentsModal.svelte', async () => ({
  default: (await import('./__tests__/mocks/Marker.svelte')).default,
}));
vi.mock('$features/navigation/LinkActionMenu.svelte', async () => ({
  default: (await import('./__tests__/mocks/Marker.svelte')).default,
}));
vi.mock('$lib/components/ui/tooltip/LinkTooltip.svelte', async () => ({
  default: (await import('./__tests__/mocks/Marker.svelte')).default,
}));

import { store as appStore } from '$store/renderer/store';
import Layout from './+layout.svelte';

const childrenSnippet = createRawSnippet(() => ({
  render: () => '<div data-testid="hud-gating-children">content</div>',
}));

describe('+layout.svelte isHudRoute chrome-less gating', () => {
  beforeEach(() => {
    appStore.init();
  });

  afterEach(() => {
    cleanup();
    appStore.dispose();
  });

  it('suppresses app chrome and renders HudChromelessMain on /hud', () => {
    mockPage.pathname = '/hud';

    render(Layout, { props: { children: childrenSnippet } });

    expect(screen.queryByTestId('window-title-bar-marker')).toBeNull();
    expect(screen.queryByTestId('sidebar-nav-marker')).toBeNull();
    expect(screen.queryByTestId('toast-marker')).toBeNull();
    expect(screen.queryByTestId('radial-prompt-picker-overlay-marker')).toBeNull();
    expect(screen.queryByTestId('encoder-cycle-hud-marker')).toBeNull();

    // ActionKeyHud stays mounted unconditionally even on the HUD route.
    expect(screen.getAllByTestId('action-key-hud-marker').length).toBeGreaterThan(0);
    expect(screen.getByTestId('hud-gating-children')).toBeTruthy();
  });

  it('renders full chrome on non-HUD routes', () => {
    mockPage.pathname = '/';

    render(Layout, { props: { children: childrenSnippet } });

    expect(screen.getAllByTestId('window-title-bar-marker').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('sidebar-nav-marker').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('toast-marker').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('radial-prompt-picker-overlay-marker').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('encoder-cycle-hud-marker').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('action-key-hud-marker').length).toBeGreaterThan(0);
    expect(screen.getByTestId('hud-gating-children')).toBeTruthy();
  });
});
