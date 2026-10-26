/**
 * @vitest-environment jsdom
 *
 * Safety-critical projections while animation frames are suspended
 * (intent-hq/intent#4622).
 *
 * Themis selector readables deliver post-subscribe updates on a
 * requestAnimationFrame cadence. An occluded or throttled Electron renderer
 * can stop firing rAF for long stretches while Redux keeps dispatching, so a
 * selector-backed projection freezes on its last delivered value. The
 * blocking disconnect overlay and the native window title must not: both are
 * driven by the configured store's direct (per-dispatch) readable instead.
 *
 * These tests run the real configured renderer store and the real slices.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn((_channel: string, _payload?: unknown) => Promise.resolve()),
}));

vi.mock('$app/stores', () => ({
  page: {
    subscribe: (run: (value: { url: URL }) => void) => {
      run({ url: new URL('http://localhost/workspace/ws-loaded') });
      return () => {};
    },
  },
}));
vi.mock('$app/state', () => ({
  page: { params: { id: 'ws-loaded' }, url: { pathname: '/workspace/ws-loaded' } },
}));
vi.mock('$lib/electron-bridge', () => ({ invoke: mocks.invoke }));
vi.mock('$lib/components/ui/tooltip', () => ({ Tooltip: () => null }));
vi.mock('$lib/icons/IntentNavigationIcon.svelte', () => ({ default: () => null }));
vi.mock('$lib/components/layout/DaemonStatusIndicator.svelte', () => ({ default: () => null }));
vi.mock('$lib/components/layout/WorkspaceTabStrip.svelte', () => ({ default: () => null }));
vi.mock('$lib/components/layout/WorkspaceRepoLauncher.svelte', () => ({ default: () => null }));
vi.mock('$lib/components/layout/sidebar-nav/SidebarNav.svelte', () => ({ default: () => null }));

import { store as appStore } from '$store/renderer/store';
import { connectionStatusChanged } from '$store/renderer/slices/daemon-health/daemon-health-slice';
import type { BackendTransportInfo } from '$store/renderer/slices/daemon-health/daemon-health-types';
import { replaceWorkspaceList } from '$store/renderer/slices/workspace/workspace-slice';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { WorkspaceId } from '$shared/types/branded-ids';
import { createMockWorkspace } from '../../../test/factories/workspace.factory';
import DaemonStoppedOverlay, { DAEMON_STOPPED_GRACE_MS } from '../DaemonStoppedOverlay.svelte';
import WindowTitleBar from '$lib/components/layout/WindowTitleBar.svelte';

const transport: BackendTransportInfo = { mode: 'sidecar-uds', target: '/tmp/i.sock' };
const loadedWorkspaceId = WorkspaceId('ws-loaded');

type FrameCallback = (timestamp: number) => void;

/** rAF that never fires: callbacks are queued and dropped (suspended renderer). */
function suspendAnimationFrames() {
  let nextId = 0;
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => ++nextId),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
}

/** rAF that runs on a ~16ms timer, like a visible renderer. */
function runAnimationFrames() {
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameCallback) => setTimeout(() => callback(Date.now()), 16)),
  );
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn((id: ReturnType<typeof setTimeout>) => clearTimeout(id)),
  );
}

function overlay(): HTMLElement | null {
  return screen.queryByTestId('daemon-stopped-overlay');
}

function lastNativeTitle(): string | undefined {
  const calls = mocks.invoke.mock.calls.filter(
    ([channel]) => channel === IPC_CHANNELS.WINDOW.SET_TITLE,
  );
  const payload = calls.at(-1)?.[1] as { title?: string } | undefined;
  return payload?.title;
}

async function showOverlayWhileDown() {
  render(DaemonStoppedOverlay);
  flushSync();
  await vi.advanceTimersByTimeAsync(DAEMON_STOPPED_GRACE_MS + 50);
  flushSync();
  expect(overlay()).toBeTruthy();
}

function dispatchHealthyWithLoadedWorkspace() {
  appStore.dispatch(connectionStatusChanged('connected', transport));
  appStore.dispatch(
    replaceWorkspaceList([
      createMockWorkspace({ id: loadedWorkspaceId, title: 'Loaded workspace' }),
    ]),
  );
  flushSync();
}

describe('safety-critical projections while animation frames are suspended (#4622)', () => {
  let disposeStore: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.invoke.mockClear();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    disposeStore = appStore.init();
  });

  afterEach(() => {
    cleanup();
    disposeStore?.();
    disposeStore = undefined;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('hides the disconnect overlay once the daemon is healthy, without an animation frame', async () => {
    suspendAnimationFrames();
    await showOverlayWhileDown();
    expect(appStore.state.daemonHealth.health).toBe('down');

    dispatchHealthyWithLoadedWorkspace();
    await vi.advanceTimersByTimeAsync(1000);
    flushSync();

    expect(appStore.state.daemonHealth.health).toBe('healthy');
    expect(overlay()).toBeNull();
  });

  it('updates the native window title for a loaded workspace without an animation frame', async () => {
    suspendAnimationFrames();
    render(WindowTitleBar, { workspaceId: loadedWorkspaceId });
    flushSync();
    expect(lastNativeTitle()).toBe('Intent');

    dispatchHealthyWithLoadedWorkspace();
    await vi.advanceTimersByTimeAsync(1000);
    flushSync();

    expect(lastNativeTitle()).toBe('Loaded workspace');
  });

  it('keeps the normal (frames running) behavior: overlay hides and title updates', async () => {
    runAnimationFrames();
    await showOverlayWhileDown();
    render(WindowTitleBar, { workspaceId: loadedWorkspaceId });
    flushSync();

    dispatchHealthyWithLoadedWorkspace();
    await vi.advanceTimersByTimeAsync(1000);
    flushSync();

    expect(overlay()).toBeNull();
    expect(lastNativeTitle()).toBe('Loaded workspace');
  });

  it('releases the direct store subscriptions on unmount and re-arms on remount (HMR)', async () => {
    suspendAnimationFrames();
    let live = 0;
    const getReadableState = appStore.getReadableState.bind(appStore);
    vi.spyOn(appStore, 'getReadableState').mockImplementation(() => {
      const state$ = getReadableState();
      return {
        subscribe(run: Parameters<typeof state$.subscribe>[0]) {
          live += 1;
          const unsubscribe = state$.subscribe(run);
          let released = false;
          return () => {
            if (!released) {
              released = true;
              live -= 1;
            }
            unsubscribe();
          };
        },
      };
    });

    const overlayView = render(DaemonStoppedOverlay);
    const titleView = render(WindowTitleBar, { workspaceId: loadedWorkspaceId });
    flushSync();
    expect(live).toBeGreaterThan(0);

    overlayView.unmount();
    titleView.unmount();
    expect(live).toBe(0);
    expect(() => dispatchHealthyWithLoadedWorkspace()).not.toThrow();

    // A hot-module replacement remounts the components against the same store.
    mocks.invoke.mockClear();
    const remountedTitle = render(WindowTitleBar, { workspaceId: loadedWorkspaceId });
    flushSync();
    expect(live).toBeGreaterThan(0);
    expect(lastNativeTitle()).toBe('Loaded workspace');
    remountedTitle.unmount();
    expect(live).toBe(0);
  });
});
