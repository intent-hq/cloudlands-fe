/**
 * Regression test for intent-hq/monorepo#1865: the root `+layout.svelte`
 * onMount defers the initial workspaces load via requestIdleCallback
 * (setTimeout(...,100) fallback under jsdom). The deferral handle must be
 * cancelled by the onMount cleanup, so unmounting before the callback fires
 * must NOT dispatch `loadWorkspacesRequested()` into the (disposed) store —
 * the origin of the onUserConsoleLog teardown flake class (#1774).
 *
 * Mounts the real root layout with the same heavy-child/side-effect stubs as
 * the other layout suites; under jsdom the setTimeout fallback branch is the
 * one exercised natively, and a stubbed requestIdleCallback/cancelIdleCallback
 * pair covers the idle-callback branch production Electron runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { installConsoleTeardownGuard } from './helpers/console-teardown-guard';

installConsoleTeardownGuard();

vi.mock('$app/navigation', () => ({
  goto: vi.fn(),
  beforeNavigate: vi.fn(),
  afterNavigate: vi.fn(),
}));

vi.mock('$app/stores', () => ({
  page: {
    subscribe: (run: (value: unknown) => void) => {
      run({ url: { pathname: '/' }, params: {}, route: { id: '/' } });
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

import { store as appStore } from '$store/renderer/store';
import { loadWorkspacesRequested } from '$store/renderer/slices/workspace/workspace-slice';
import Layout from '../(app)/+layout.svelte';

const childrenSnippet = createRawSnippet(() => ({
  render: () => '<div data-testid="unmount-cancel-children">content</div>',
}));

/** Past the 100ms setTimeout fallback delay (and any idle deadline). */
const AFTER_DEFERRAL_MS = 250;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const loadWorkspacesDispatches = (dispatchSpy: ReturnType<typeof vi.spyOn>) =>
  dispatchSpy.mock.calls.filter(
    ([action]) => (action as { type?: string })?.type === loadWorkspacesRequested.type,
  );

describe('+layout.svelte deferred workspaces load cancellation (intent-hq/monorepo#1865)', () => {
  beforeEach(() => {
    appStore.init();
  });

  afterEach(() => {
    cleanup();
    appStore.dispose();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('does not dispatch loadWorkspacesRequested when unmounted before the deferred callback fires', async () => {
    const dispatchSpy = vi.spyOn(appStore, 'dispatch');

    const { unmount } = render(Layout, { props: { children: childrenSnippet } });
    unmount();

    await wait(AFTER_DEFERRAL_MS);

    expect(loadWorkspacesDispatches(dispatchSpy)).toHaveLength(0);
  });

  it('still dispatches loadWorkspacesRequested when the layout stays mounted', async () => {
    const dispatchSpy = vi.spyOn(appStore, 'dispatch');

    render(Layout, { props: { children: childrenSnippet } });

    await wait(AFTER_DEFERRAL_MS);

    expect(loadWorkspacesDispatches(dispatchSpy)).toHaveLength(1);
  });

  it('cancels the requestIdleCallback handle on unmount (production Electron branch)', async () => {
    // jsdom has no requestIdleCallback, so stub the pair to cover the branch
    // production Electron actually runs. Back the stubs with real timers so an
    // uncancelled callback would genuinely fire and fail the assertion.
    const idleTimers = new Map<number, ReturnType<typeof setTimeout>>();
    let nextIdleHandle = 1;
    vi.stubGlobal('requestIdleCallback', (cb: IdleRequestCallback): number => {
      const handle = nextIdleHandle++;
      idleTimers.set(
        handle,
        setTimeout(() => {
          idleTimers.delete(handle);
          cb({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline);
        }, 0),
      );
      return handle;
    });
    const cancelSpy = vi.fn((handle: number) => {
      const timer = idleTimers.get(handle);
      if (timer !== undefined) {
        clearTimeout(timer);
        idleTimers.delete(handle);
      }
    });
    vi.stubGlobal('cancelIdleCallback', cancelSpy);

    const dispatchSpy = vi.spyOn(appStore, 'dispatch');

    const { unmount } = render(Layout, { props: { children: childrenSnippet } });
    unmount();

    await wait(AFTER_DEFERRAL_MS);

    expect(cancelSpy).toHaveBeenCalledTimes(1);
    expect(loadWorkspacesDispatches(dispatchSpy)).toHaveLength(0);
  });
});
