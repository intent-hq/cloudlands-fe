/**
 * DaemonStoppedOverlay component tests (#439).
 *
 * Drives the real daemon-health slice through connectionStatusChanged and
 * asserts the overlay's show / grace-period / dismiss / spawn-sidecar flows.
 * The spawn button goes through the real root-owned daemon-health saga to the
 * backend:spawn-sidecar channel (asserted on the stubbed electronAPI.invoke).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// NOTE: testing-library's waitFor only detects JEST fake timers; with vitest
// fake timers its polling setTimeout never fires and every waitFor hangs.
// vi.waitFor auto-advances vitest fake timers, so it is used throughout.
import { render, cleanup, fireEvent, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';

vi.mock('$store/renderer/store', async () => {
  const { runSaga, stdChannel } = await import('redux-saga');
  const { daemonHealthReducer, initialState } =
    await import('$store/renderer/slices/daemon-health/daemon-health-slice');
  const { connectionsReducer, initialState: connectionsInitialState } =
    await import('$store/renderer/slices/connections/connections-slice');
  let state = { daemonHealth: initialState, connections: connectionsInitialState };
  const listeners = new Set<() => void>();
  const channel = stdChannel();
  const store = {
    get state() {
      return state;
    },
    init() {
      state = { daemonHealth: initialState, connections: connectionsInitialState };
      listeners.forEach((listener) => listener());
      return () => {};
    },
    dispose() {
      listeners.clear();
    },
    dispatch(action: { type: string }) {
      state = {
        daemonHealth: daemonHealthReducer(state.daemonHealth, action as never),
        connections: connectionsReducer(state.connections, action as never),
      };
      channel.put(action);
      listeners.forEach((listener) => listener());
      return action;
    },
    createSelector<T>(select: (value: typeof state) => T) {
      return Object.assign(
        () => ({
          subscribe(run: (value: T) => void) {
            const update = () => run(select(state));
            update();
            listeners.add(update);
            return () => listeners.delete(update);
          },
        }),
        {
          select,
          effect: function* () {
            return select(state);
          },
        },
      );
    },
    runSaga(saga: () => Generator) {
      const task = runSaga({ channel, dispatch: store.dispatch, getState: () => state }, saga);
      return () => task.cancel();
    },
  };
  return { store };
});

import { store as appStore } from '$store/renderer/store';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { mockInvoke, resetMockIpcRouter } from '$shared/ipc-mock-router';
import { connectionStatusChanged } from '$store/renderer/slices/daemon-health/daemon-health-slice';
import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
import type { ConnectionRecord } from '$shared/types/connections';
import type { BackendTransportInfo } from '$store/renderer/slices/daemon-health/daemon-health-types';
import { daemonHealthSaga } from '$store/renderer/slices/daemon-health/sagas/daemon-health-saga';
import {
  authRejectedReceived,
  certWarningsReceived,
  connectionsListReceived,
  connectOperationStarted,
  openConnectionRequested,
} from '$store/renderer/slices/connections/connections-slice';
import { LOCAL_CONNECTION_ID } from '$shared/types/connections';

const route = vi.hoisted(() => ({ pathname: '/' }));

vi.mock('$app/stores', () => ({
  page: {
    subscribe: (run: (value: { url: URL }) => void) => {
      run({ url: new URL(`http://localhost${route.pathname}`) });
      return () => {};
    },
  },
}));

import DaemonStoppedOverlay, { DAEMON_STOPPED_GRACE_MS } from '../DaemonStoppedOverlay.svelte';
import { DAEMON_UPDATING_COUNTDOWN_MS } from '../DaemonUpdatingOverlay.svelte';

const BACKEND = IPC_CHANNELS.BACKEND;

const sidecarTransport: BackendTransportInfo = { mode: 'sidecar-uds', target: '/tmp/i.sock' };
const externalTransport: BackendTransportInfo = { mode: 'external-uds', target: '/tmp/i.sock' };

let invokeMock: ReturnType<typeof vi.fn>;
let stopDaemonHealthSaga: (() => void) | undefined;
// Transport the saga's boot-time GET_STATUS fetch reports; kept in sync
// with the scenario under test so the boot dispatch can't override it.
let bootTransport: BackendTransportInfo = sidecarTransport;

function overlay(): HTMLElement | null {
  return screen.queryByTestId('daemon-stopped-overlay');
}

/**
 * Dispatch and synchronously flush Svelte effects so the component's
 * grace-timer $effect arms BEFORE the test advances fake timers.
 */
function dispatchAndFlush(action: Parameters<typeof appStore.dispatch>[0]) {
  appStore.dispatch(action);
  flushSync();
}

async function showOverlay(
  transport: BackendTransportInfo,
  extras?: {
    sidecarGaveUp?: boolean;
    sidecarStartupFailed?: boolean;
    reason?: string;
    reconnectAttempts?: number;
  },
) {
  bootTransport = transport;
  dispatchAndFlush(connectionStatusChanged('connected', transport));
  // Let the saga's boot-time GET_STATUS fetch settle before the
  // disconnect, so its late 'connected' dispatch can't cancel the grace timer.
  await vi.advanceTimersByTimeAsync(10);
  dispatchAndFlush(connectionStatusChanged('disconnected', undefined, extras));
  await vi.advanceTimersByTimeAsync(DAEMON_STOPPED_GRACE_MS + 50);
  await vi.waitFor(() => {
    expect(overlay()).toBeTruthy();
  });
}

/**
 * Show the overlay without any prior successful connect this session — the
 * boot-time GET_STATUS fetch reports 'disconnected' so the hasEverConnected
 * latch never sets.
 */
async function showOverlayNeverConnected(
  transport?: BackendTransportInfo,
  extras?: { sidecarGaveUp?: boolean; sidecarStartupFailed?: boolean; reason?: string },
) {
  stopDaemonHealthSaga?.();
  invokeMock.mockImplementation(async (channel: string, ...args: unknown[]) => {
    if (channel === BACKEND.GET_STATUS) {
      return { status: 'disconnected' };
    }
    return mockInvoke(channel, ...args);
  });
  appStore.init();
  stopDaemonHealthSaga = appStore.runSaga(daemonHealthSaga);
  await vi.advanceTimersByTimeAsync(0);
  dispatchAndFlush(connectionStatusChanged('disconnected', transport, extras));
  await vi.advanceTimersByTimeAsync(DAEMON_STOPPED_GRACE_MS + 50);
  await vi.waitFor(() => {
    expect(overlay()).toBeTruthy();
  });
}

describe('DaemonStoppedOverlay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    route.pathname = '/';
    bootTransport = sidecarTransport;
    invokeMock = vi.fn(async (channel: string, ...args: unknown[]) => {
      if (channel === BACKEND.SPAWN_SIDECAR) {
        return { ok: true, spawned: true, reason: 'sidecar spawned' };
      }
      if (channel === BACKEND.OPEN_LOCAL_AND_SPAWN) {
        return { ok: true, spawned: true, reason: 'sidecar spawned' };
      }
      if (channel === BACKEND.GET_STATUS) {
        return { status: 'connected', transport: bootTransport };
      }
      return mockInvoke(channel, ...args);
    });
    vi.stubGlobal('electronAPI', {
      invoke: invokeMock,
      on: vi.fn(() => 'daemon-status-listener'),
      offById: vi.fn(),
    });
    appStore.init();
    stopDaemonHealthSaga = appStore.runSaga(daemonHealthSaga);
  });

  afterEach(() => {
    cleanup();
    stopDaemonHealthSaga?.();
    stopDaemonHealthSaga = undefined;
    resetMockIpcRouter();
    // Dispose the store so session latches (hasEverConnected,
    // sidecarStartupFailed) don't leak into the next test.
    appStore.dispose();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('stays hidden while the daemon is healthy', async () => {
    render(DaemonStoppedOverlay);
    appStore.dispatch(connectionStatusChanged('connected', sidecarTransport));
    await vi.advanceTimersByTimeAsync(DAEMON_STOPPED_GRACE_MS * 2);
    expect(overlay()).toBeNull();
  });

  it.each(['/sandbox', '/sandbox/directory-picker', '/test-comments', '/test-mentions/compact'])(
    'stays hidden while the daemon is disconnected on %s',
    async (pathname) => {
      route.pathname = pathname;
      render(DaemonStoppedOverlay);
      dispatchAndFlush(connectionStatusChanged('disconnected'));
      await vi.advanceTimersByTimeAsync(DAEMON_STOPPED_GRACE_MS * 2);
      expect(overlay()).toBeNull();
    },
  );

  it.each(['/sandboxed', '/testimonials', '/test'])(
    'shows the overlay for non-sandbox path %s',
    async (pathname) => {
      route.pathname = pathname;
      render(DaemonStoppedOverlay);
      await showOverlay(sidecarTransport);
      expect(overlay()).toBeTruthy();
    },
  );

  it('does not flash when the connection recovers within the grace period', async () => {
    render(DaemonStoppedOverlay);
    appStore.dispatch(connectionStatusChanged('connected', sidecarTransport));
    appStore.dispatch(connectionStatusChanged('disconnected'));
    await vi.advanceTimersByTimeAsync(DAEMON_STOPPED_GRACE_MS - 500);
    expect(overlay()).toBeNull();
    appStore.dispatch(connectionStatusChanged('connected', sidecarTransport));
    await vi.advanceTimersByTimeAsync(DAEMON_STOPPED_GRACE_MS * 2);
    expect(overlay()).toBeNull();
  });

  describe('update-caused disconnect (defers to DaemonUpdatingOverlay)', () => {
    async function dropForUpdate() {
      bootTransport = externalTransport;
      dispatchAndFlush(connectionStatusChanged('connected', externalTransport));
      await vi.advanceTimersByTimeAsync(10);
      dispatchAndFlush(
        connectionStatusChanged('disconnected', undefined, {
          daemonUpdateDisconnectedAt: Date.now(),
        }),
      );
    }

    it('stays hidden through the updating countdown, then appears without an extra grace period', async () => {
      render(DaemonStoppedOverlay);
      await dropForUpdate();

      await vi.advanceTimersByTimeAsync(DAEMON_STOPPED_GRACE_MS + 50);
      expect(overlay()).toBeNull();
      await vi.advanceTimersByTimeAsync(
        DAEMON_UPDATING_COUNTDOWN_MS - DAEMON_STOPPED_GRACE_MS - 150,
      );
      expect(overlay()).toBeNull();

      await vi.advanceTimersByTimeAsync(100);
      expect(overlay()).toBeTruthy();
      // Once shown it is the ordinary external-mode posture with its recovery actions.
      expect(screen.getByTestId('daemon-stopped-spawn-sidecar')).toBeTruthy();
    });

    it('never appears when the daemon reconnects during the countdown', async () => {
      render(DaemonStoppedOverlay);
      await dropForUpdate();
      await vi.advanceTimersByTimeAsync(5000);
      expect(overlay()).toBeNull();

      dispatchAndFlush(connectionStatusChanged('connected', externalTransport));
      await vi.advanceTimersByTimeAsync(DAEMON_UPDATING_COUNTDOWN_MS + DAEMON_STOPPED_GRACE_MS);
      expect(overlay()).toBeNull();
    });
  });

  it('appears after the grace period and auto-dismisses on reconnect', async () => {
    render(DaemonStoppedOverlay);
    await showOverlay(sidecarTransport);
    expect(screen.getByTestId('daemon-stopped-retrying').textContent).toContain(
      'Retrying connection',
    );

    appStore.dispatch(connectionStatusChanged('connected', sidecarTransport));
    await vi.waitFor(() => {
      expect(overlay()).toBeNull();
    });
  });

  it('hides the spawn button in sidecar mode while the supervisor is still retrying', async () => {
    render(DaemonStoppedOverlay);
    await showOverlay(sidecarTransport);
    expect(screen.queryByTestId('daemon-stopped-spawn-sidecar')).toBeNull();
    expect(overlay()!.textContent).toContain('restarting it automatically');
  });

  it('offers the sidecar fallback with the local-instead-of-remote caveat in external mode (#1750)', async () => {
    render(DaemonStoppedOverlay);
    await showOverlay(externalTransport);
    expect(screen.getByTestId('daemon-stopped-spawn-sidecar')).toBeTruthy();
    expect(overlay()!.textContent).toContain('external intentd daemon was lost');
    // External mode gets the "local intentd instead of the remote server" note,
    // not the local data-dir caveat.
    expect(overlay()!.textContent).toContain('instead of the remote server');
    expect(overlay()!.textContent).not.toContain('may use a different data directory');
  });

  it('offers the local sidecar fallback in external-ws mode', async () => {
    render(DaemonStoppedOverlay);
    await showOverlay({ mode: 'external-ws', target: 'ws://127.0.0.1:5181/ws' });
    expect(screen.getByTestId('daemon-stopped-spawn-sidecar')).toBeTruthy();
    expect(overlay()!.textContent).toContain('external intentd daemon was lost');
  });

  it('shows the lost connection details from the active connection record (#1750)', async () => {
    const remote: ConnectionRecord = {
      id: 'conn-1',
      label: '192.168.1.20:5181',
      host: '192.168.1.20',
      port: 5181,
      fingerprint: 'ab:cd',
      hostname: 'studio.local',
      isLocal: false,
    };
    render(DaemonStoppedOverlay);
    appStore.dispatch(
      connectionsListReceived({
        connections: [remote],
        activeId: 'conn-1',
        windowBackendId: 'conn-1',
      }),
    );
    await showOverlay({ mode: 'external-ws', target: 'wss:192.168.1.20:5181' });
    const details = screen.getByTestId('daemon-stopped-connection-details');
    expect(details.textContent).toContain('Lost connection to studio.local (192.168.1.20:5181)');
  });

  it('falls back to the transport target for the details line when no remote record is active (#1750)', async () => {
    render(DaemonStoppedOverlay);
    await showOverlay(externalTransport);
    // external-uds adoption: the active connection is the local entry, so the
    // socket path from the transport is the best available target detail.
    const details = screen.getByTestId('daemon-stopped-connection-details');
    expect(details.textContent).toContain('Lost connection to /tmp/i.sock');
  });

  it('hides the connection-details line in sidecar mode', async () => {
    render(DaemonStoppedOverlay);
    await showOverlay(sidecarTransport);
    expect(screen.queryByTestId('daemon-stopped-connection-details')).toBeNull();
  });

  it('shows the reconnect attempt count in the retrying line (#1750)', async () => {
    render(DaemonStoppedOverlay);
    await showOverlay(externalTransport, { reconnectAttempts: 14 });
    expect(screen.getByTestId('daemon-stopped-retrying').textContent).toContain(
      'Retrying connection… (attempt 14)',
    );

    // A later status push with a higher count updates the line live.
    dispatchAndFlush(connectionStatusChanged('connecting', undefined, { reconnectAttempts: 15 }));
    expect(screen.getByTestId('daemon-stopped-retrying').textContent).toContain('(attempt 15)');
  });

  it('omits the attempt count before the first retry', async () => {
    render(DaemonStoppedOverlay);
    await showOverlay(sidecarTransport);
    const retrying = screen.getByTestId('daemon-stopped-retrying').textContent!;
    expect(retrying).toContain('Retrying connection');
    expect(retrying).not.toContain('attempt');
  });

  describe('passive per-host cert warnings (#1746 follow-up)', () => {
    const REMOTE: ConnectionRecord = {
      id: 'remote-1',
      label: 'Studio Mac',
      host: '10.0.0.5',
      port: 8443,
      fingerprint: 'AB:CD',
      isLocal: false,
    };
    const WARNING = {
      host: '10.0.0.6',
      expectedFingerprint: 'AB:CD',
      actualFingerprint: 'EF:01',
    };
    const wsTransport: BackendTransportInfo = {
      mode: 'external-ws',
      target: 'wss://10.0.0.5:8443/ws',
    };

    function bindWindowToRemote() {
      dispatchAndFlush(
        connectionsListReceived({
          connections: [REMOTE],
          activeId: REMOTE.id,
          windowBackendId: REMOTE.id,
        }),
      );
    }

    it('lists warned hosts passively while reconnecting, keeping the retry indicator', async () => {
      render(DaemonStoppedOverlay);
      await showOverlay(wsTransport);
      bindWindowToRemote();
      dispatchAndFlush(certWarningsReceived({ id: REMOTE.id, warnings: [WARNING] }));

      const warnings = screen.getByTestId('daemon-stopped-cert-warnings');
      expect(warnings.textContent).toContain('unexpected certificate');
      const hosts = screen.getAllByTestId('daemon-stopped-cert-warning-host');
      expect(hosts).toHaveLength(1);
      expect(hosts[0].textContent).toContain('10.0.0.6');
      // Fingerprint detail is exposed on the row (title attribute).
      expect(hosts[0].getAttribute('title')).toContain('AB:CD');
      expect(hosts[0].getAttribute('title')).toContain('EF:01');
      // Passive: the retrying indicator stays — nothing is blocked.
      expect(screen.getByTestId('daemon-stopped-retrying')).toBeTruthy();
    });

    it('hides warnings latched for another backend than this window', async () => {
      render(DaemonStoppedOverlay);
      await showOverlay(wsTransport);
      // Window stays bound to local; another backend's warnings are not shown.
      dispatchAndFlush(certWarningsReceived({ id: REMOTE.id, warnings: [WARNING] }));
      expect(screen.queryByTestId('daemon-stopped-cert-warnings')).toBeNull();
    });

    it('drops the list when main clears the warnings (fresh client)', async () => {
      render(DaemonStoppedOverlay);
      await showOverlay(wsTransport);
      bindWindowToRemote();
      dispatchAndFlush(certWarningsReceived({ id: REMOTE.id, warnings: [WARNING] }));
      expect(screen.getByTestId('daemon-stopped-cert-warnings')).toBeTruthy();

      dispatchAndFlush(certWarningsReceived({ id: REMOTE.id, warnings: [] }));
      expect(screen.queryByTestId('daemon-stopped-cert-warnings')).toBeNull();
    });
  });

  it('shows the crash-loop posture after the supervisor gave up, with distinct copy and the reason', async () => {
    render(DaemonStoppedOverlay);
    await showOverlay(sidecarTransport, { sidecarGaveUp: true, reason: 'restart limit reached' });
    // The daemon ran, then crash-looped — "stopped and could not be
    // restarted", not "failed to start".
    expect(overlay()!.textContent).toContain('intentd stopped unexpectedly');
    expect(overlay()!.textContent).toContain('stopped and could not be restarted');
    expect(overlay()!.textContent).not.toContain('failed to start');
    expect(overlay()!.textContent).toContain('restart limit reached');
    // The app manages the sidecar itself — never "connect to a daemon" wording.
    expect(overlay()!.textContent).not.toContain('connection');
    // Shares the retry button and log affordance with the startup-failure posture.
    const button = screen.getByTestId('daemon-stopped-spawn-sidecar');
    expect(button.textContent).toContain('Try starting intentd again');
    expect(screen.getByTestId('daemon-stopped-show-logs')).toBeTruthy();
  });

  it('shows the failure posture with the reason when the sidecar spawn could not happen at all', async () => {
    render(DaemonStoppedOverlay);
    await showOverlay(sidecarTransport, {
      sidecarStartupFailed: true,
      reason: 'intentd binary not found',
    });
    expect(overlay()!.textContent).toContain('intentd failed to start');
    expect(overlay()!.textContent).toContain('runs its own intentd daemon');
    expect(overlay()!.textContent).toContain('intentd binary not found');
    expect(overlay()!.textContent).not.toContain('connection');

    // The retry button still dispatches spawnSidecarRequested → backend:spawn-sidecar.
    const button = screen.getByTestId('daemon-stopped-spawn-sidecar') as HTMLButtonElement;
    expect(button.textContent).toContain('Try starting intentd again');
    await fireEvent.click(button);
    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(BACKEND.SPAWN_SIDECAR);
    });
  });

  it('fetches backend:get-sidecar-run-log on demand and renders the last-run tail', async () => {
    // Contract-shaped payload (spec "Pinned IPC contract").
    const runLog = {
      available: true,
      startedAt: '2026-07-26T00:00:00.000Z',
      endedAt: '2026-07-26T00:00:05.000Z',
      exitCode: 1,
      signal: null,
      spawnError: null,
      lines: ['intentd starting', 'error: bind failed'],
    };
    invokeMock.mockImplementation(async (channel: string, ...args: unknown[]) => {
      if (channel === 'backend:get-sidecar-run-log') return runLog;
      if (channel === BACKEND.GET_STATUS) return { status: 'connected', transport: bootTransport };
      return mockInvoke(channel, ...args);
    });

    render(DaemonStoppedOverlay);
    await showOverlay(sidecarTransport, {
      sidecarStartupFailed: true,
      reason: 'intentd binary not found',
    });

    await fireEvent.click(screen.getByTestId('daemon-stopped-show-logs'));
    await vi.waitFor(() => {
      expect(screen.queryByTestId('daemon-stopped-run-log')).toBeTruthy();
    });
    // Exact channel name pinned by the IPC contract.
    expect(invokeMock).toHaveBeenCalledWith('backend:get-sidecar-run-log');
    expect(screen.getByTestId('daemon-stopped-run-log-meta').textContent).toContain('Exit code: 1');
    const lines = screen.getByTestId('daemon-stopped-run-log-lines').textContent;
    expect(lines).toContain('intentd starting');
    expect(lines).toContain('error: bind failed');
  });

  it('shows the spawn error and a no-capture notice from the run-log payload', async () => {
    invokeMock.mockImplementation(async (channel: string, ...args: unknown[]) => {
      if (channel === 'backend:get-sidecar-run-log') {
        return {
          available: false,
          startedAt: null,
          endedAt: null,
          exitCode: null,
          signal: null,
          spawnError: null,
          lines: [],
        };
      }
      if (channel === BACKEND.GET_STATUS) return { status: 'connected', transport: bootTransport };
      return mockInvoke(channel, ...args);
    });

    render(DaemonStoppedOverlay);
    await showOverlay(sidecarTransport, { sidecarStartupFailed: true });

    await fireEvent.click(screen.getByTestId('daemon-stopped-show-logs'));
    await vi.waitFor(() => {
      expect(screen.queryByTestId('daemon-stopped-run-log')).toBeTruthy();
    });
    expect(screen.getByTestId('daemon-stopped-run-log').textContent).toContain(
      'No sidecar run has been captured',
    );
  });

  it('says "could not connect" (not "was lost") when never connected in sidecar posture', async () => {
    render(DaemonStoppedOverlay);
    await showOverlayNeverConnected(sidecarTransport);
    expect(overlay()!.textContent).toContain('Could not connect to the intentd daemon');
    expect(overlay()!.textContent).toContain('starting it automatically');
    expect(overlay()!.textContent).not.toContain('was lost');
    expect(overlay()!.textContent).not.toContain('restarting');
  });

  it('says "could not connect" with the sidecar fallback when never connected in external posture', async () => {
    render(DaemonStoppedOverlay);
    await showOverlayNeverConnected(externalTransport);
    expect(overlay()!.textContent).toContain('Could not connect to the external intentd daemon');
    expect(overlay()!.textContent).not.toContain('was lost');
    // Buttons follow the same transport-mode rules as the lost-connection posture.
    expect(screen.getByTestId('daemon-stopped-spawn-sidecar').textContent).toContain(
      'Start local intentd',
    );
  });

  it('spawn button invokes backend:spawn-sidecar, disables while pending, and dismisses on reconnect', async () => {
    render(DaemonStoppedOverlay);
    await showOverlay(externalTransport);

    const button = screen.getByTestId('daemon-stopped-spawn-sidecar') as HTMLButtonElement;
    await fireEvent.click(button);

    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(BACKEND.SPAWN_SIDECAR);
    });
    // Pending until the reconnect status lands.
    await vi.waitFor(() => {
      expect(
        (screen.getByTestId('daemon-stopped-spawn-sidecar') as HTMLButtonElement).disabled,
      ).toBe(true);
    });
    expect(screen.getByTestId('daemon-stopped-spawn-sidecar').textContent).toContain(
      'Starting intentd',
    );

    // Reconnect (backend:status 'connected' via RESUB-1 main-side flow) dismisses.
    appStore.dispatch(connectionStatusChanged('connected', sidecarTransport));
    await vi.waitFor(() => {
      expect(overlay()).toBeNull();
    });
  });

  describe('Open-only recovery actions in a remote window', () => {
    const REMOTE = {
      id: 'remote-1',
      label: 'Studio Mac',
      host: '10.0.0.5',
      port: 8443,
      fingerprint: 'AB:CD',
      isLocal: false,
    };
    const OTHER = { ...REMOTE, id: 'remote-2', label: 'Other Mac', host: '10.0.0.6' };
    const LOCAL = {
      id: LOCAL_CONNECTION_ID,
      label: 'This machine (local)',
      host: null,
      port: null,
      fingerprint: null,
      isLocal: true,
    };
    const wsTransport: BackendTransportInfo = {
      mode: 'external-ws',
      target: 'wss://10.0.0.5:8443/ws',
    };

    function bindWindowToRemote(connections = [LOCAL, REMOTE, OTHER]) {
      dispatchAndFlush(
        connectionsListReceived({
          connections,
          activeId: REMOTE.id,
          windowBackendId: REMOTE.id,
        }),
      );
    }

    it('offers "Open local" and routes it through backend:open-local-and-spawn', async () => {
      render(DaemonStoppedOverlay);
      await showOverlay(wsTransport);
      bindWindowToRemote();

      const button = screen.getByTestId('daemon-stopped-spawn-sidecar') as HTMLButtonElement;
      expect(button.textContent).toContain('Open local');
      // The remote-window note explains this window keeps its own backend.
      expect(overlay()!.textContent).toContain('stays connected to the remote backend');

      await fireEvent.click(button);
      await vi.waitFor(() => {
        expect(invokeMock).toHaveBeenCalledWith(BACKEND.OPEN_LOCAL_AND_SPAWN);
      });
      // The plain spawn channel (local-window path) must NOT fire from a
      // remote window — spawning without opening would target this window's
      // dead remote connection.
      expect(invokeMock).not.toHaveBeenCalledWith(BACKEND.SPAWN_SIDECAR);
    });

    it('keeps "Start local intentd" (plain spawn) when the window backend is local', async () => {
      render(DaemonStoppedOverlay);
      await showOverlay(externalTransport);
      // Default windowBackendId is local — external-uds adoption posture.
      const button = screen.getByTestId('daemon-stopped-spawn-sidecar') as HTMLButtonElement;
      expect(button.textContent).toContain('Start local intentd');

      await fireEvent.click(button);
      await vi.waitFor(() => {
        expect(invokeMock).toHaveBeenCalledWith(BACKEND.SPAWN_SIDECAR);
      });
      expect(invokeMock).not.toHaveBeenCalledWith(BACKEND.OPEN_LOCAL_AND_SPAWN);
    });

    it('lists other backends as "Open …" actions that dispatch openConnectionRequested', async () => {
      render(DaemonStoppedOverlay);
      await showOverlay(wsTransport);
      bindWindowToRemote();

      const openButtons = screen.getAllByTestId('daemon-stopped-open-backend');
      expect(openButtons).toHaveLength(1);
      expect(openButtons[0].textContent).toContain('Open');
      expect(openButtons[0].textContent).toContain('Other Mac');

      const dispatchSpy = vi.spyOn(appStore, 'dispatch');
      await fireEvent.click(openButtons[0]);
      const dispatched = dispatchSpy.mock.calls
        .map(([action]) => action as { type: string; payload?: unknown[] })
        .find((action) => action.type === openConnectionRequested.type);
      expect(dispatched?.payload).toEqual(['remote-2']);
      // Open-only: the legacy retargeting action must never fire from the
      // overlay. Literal type string: the remove-switch change deleted the
      // action creator, and this negative assertion must survive that.
      expect(
        dispatchSpy.mock.calls.some(
          ([action]) =>
            (action as { type: string }).type === 'connections/switchConnectionRequested',
        ),
      ).toBe(false);
      dispatchSpy.mockRestore();
    });
  });

  it('keeps the spawn section visible when the transport flips to sidecar-uds mid-spawn', async () => {
    render(DaemonStoppedOverlay);
    await showOverlay(externalTransport);

    await fireEvent.click(screen.getByTestId('daemon-stopped-spawn-sidecar'));
    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(BACKEND.SPAWN_SIDECAR);
    });

    // Main process flips connection mode immediately on spawn; a status
    // broadcast can carry a sidecar-uds transport while the daemon is still
    // down. The pending indicator must survive that flip.
    dispatchAndFlush(connectionStatusChanged('disconnected', sidecarTransport));
    const button = screen.getByTestId('daemon-stopped-spawn-sidecar') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('Starting intentd');
  });

  it('shows the spawn error and re-enables the button when the spawn fails', async () => {
    invokeMock.mockImplementation(async (channel: string, ...args: unknown[]) => {
      if (channel === BACKEND.SPAWN_SIDECAR) {
        return { ok: false, spawned: false, reason: 'intentd binary not found' };
      }
      if (channel === BACKEND.GET_STATUS) {
        return { status: 'disconnected' };
      }
      return mockInvoke(channel, ...args);
    });

    render(DaemonStoppedOverlay);
    await showOverlay(externalTransport);

    await fireEvent.click(screen.getByTestId('daemon-stopped-spawn-sidecar'));
    await vi.waitFor(() => {
      expect(screen.getByTestId('daemon-stopped-spawn-error').textContent).toContain(
        'intentd binary not found',
      );
    });
    expect((screen.getByTestId('daemon-stopped-spawn-sidecar') as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  describe('auth-rejected posture (token rejected by the active remote backend)', () => {
    const REMOTE = {
      id: 'remote-1',
      label: 'Studio Mac',
      host: '10.0.0.5',
      port: 8443,
      fingerprint: 'AB:CD',
      accent: 'indigo' as const,
      isLocal: false,
    };
    const LOCAL = {
      id: LOCAL_CONNECTION_ID,
      label: 'This machine (local)',
      host: null,
      port: null,
      fingerprint: null,
      isLocal: true,
    };
    const wsTransport: BackendTransportInfo = {
      mode: 'external-ws',
      target: 'wss://10.0.0.5:8443/ws',
    };

    function activateRemote() {
      dispatchAndFlush(
        connectionsListReceived({
          connections: [LOCAL, REMOTE],
          activeId: REMOTE.id,
          windowBackendId: REMOTE.id,
        }),
      );
    }

    function rejectAuth(statusCode: number) {
      dispatchAndFlush(
        authRejectedReceived({ id: REMOTE.id, host: REMOTE.host, port: REMOTE.port, statusCode }),
      );
    }

    it('swaps the generic overlay for the actionable token-rejected state on 401', async () => {
      render(DaemonStoppedOverlay);
      await showOverlay(wsTransport);
      activateRemote();
      rejectAuth(401);

      expect(overlay()!.textContent).toContain('Authentication rejected');
      expect(overlay()!.textContent).toContain('rejected the stored access token (HTTP 401)');
      expect(overlay()!.textContent).toContain('10.0.0.5:8443');
      // Retrying with the same token cannot succeed — no misleading spinner.
      expect(screen.queryByTestId('daemon-stopped-retrying')).toBeNull();
      expect(screen.getByTestId('daemon-stopped-repair').textContent).toContain(
        'Re-pair with a new token',
      );
    });

    it('hides the connection-details line and attempt counter in the token-rejected state (#957)', async () => {
      render(DaemonStoppedOverlay);
      await showOverlay(wsTransport, { reconnectAttempts: 3 });
      activateRemote();
      // Before the rejection latches, the external posture shows the lost
      // connection details for the active remote.
      expect(screen.getByTestId('daemon-stopped-connection-details')).toBeTruthy();

      rejectAuth(401);

      // The auth-rejected copy already names host:port; the generic external
      // details line and the retrying/attempt counter would be misleading.
      expect(screen.queryByTestId('daemon-stopped-connection-details')).toBeNull();
      expect(screen.queryByTestId('daemon-stopped-retrying')).toBeNull();
    });

    it('explains the disabled WS API on 403', async () => {
      render(DaemonStoppedOverlay);
      await showOverlay(wsTransport);
      activateRemote();
      rejectAuth(403);

      expect(overlay()!.textContent).toContain('Authentication rejected');
      expect(overlay()!.textContent).toContain('WebSocket API is disabled');
      expect(overlay()!.textContent).toContain('(HTTP 403)');
    });

    it('keeps the open-backend fail-over list visible in the token-rejected state', async () => {
      const OTHER = { ...REMOTE, id: 'remote-2', label: 'Other Mac', host: '10.0.0.6' };
      render(DaemonStoppedOverlay);
      await showOverlay(wsTransport);
      dispatchAndFlush(
        connectionsListReceived({
          connections: [LOCAL, REMOTE, OTHER],
          activeId: REMOTE.id,
          windowBackendId: REMOTE.id,
        }),
      );
      rejectAuth(401);

      expect(screen.getByTestId('daemon-stopped-known-backends')).toBeTruthy();
    });

    it('ignores a rejection latched for the primary when it does not match this window backend', async () => {
      render(DaemonStoppedOverlay);
      await showOverlay(wsTransport);
      dispatchAndFlush(
        connectionsListReceived({
          connections: [LOCAL, REMOTE],
          activeId: REMOTE.id,
          windowBackendId: LOCAL_CONNECTION_ID,
        }),
      );
      rejectAuth(401);

      expect(overlay()!.textContent).not.toContain('Authentication rejected');
      expect(screen.queryByTestId('daemon-stopped-repair')).toBeNull();
      expect(screen.getByTestId('daemon-stopped-retrying')).toBeTruthy();
    });

    it('shows a rejection matching this window backend even when it is not the primary', async () => {
      render(DaemonStoppedOverlay);
      await showOverlay(wsTransport);
      dispatchAndFlush(
        connectionsListReceived({
          connections: [LOCAL, REMOTE],
          activeId: LOCAL_CONNECTION_ID,
          windowBackendId: REMOTE.id,
        }),
      );
      rejectAuth(401);

      expect(overlay()!.textContent).toContain('Authentication rejected');
      expect(screen.getByTestId('daemon-stopped-repair')).toBeTruthy();
      expect(screen.queryByTestId('daemon-stopped-retrying')).toBeNull();
    });

    it('returns to the generic posture when a new connect operation clears the latch', async () => {
      render(DaemonStoppedOverlay);
      await showOverlay(wsTransport);
      activateRemote();
      rejectAuth(401);
      expect(screen.getByTestId('daemon-stopped-repair')).toBeTruthy();

      dispatchAndFlush(connectOperationStarted());

      expect(overlay()!.textContent).not.toContain('Authentication rejected');
      expect(screen.queryByTestId('daemon-stopped-repair')).toBeNull();
    });

    it('opens the re-pair modal with saved metadata and address prefilled', async () => {
      render(DaemonStoppedOverlay);
      await showOverlay(wsTransport);
      activateRemote();
      rejectAuth(401);

      await fireEvent.click(screen.getByTestId('daemon-stopped-repair'));

      const hostInput = (await screen.findByLabelText(/host/i)) as HTMLInputElement;
      const portInput = screen.getByLabelText(/port/i) as HTMLInputElement;
      const nameInput = screen.getByLabelText(/name/i) as HTMLInputElement;
      expect(hostInput.value).toBe('10.0.0.5');
      expect(portInput.value).toBe('8443');
      expect(nameInput.value).toBe(REMOTE.label);
      expect(screen.getByRole('button', { name: /indigo/i }).getAttribute('aria-pressed')).toBe(
        'true',
      );
    });
  });

  it('issues no daemon wire requests itself (reconnect resubscription is RESUB-1 main-side)', async () => {
    render(DaemonStoppedOverlay);
    await showOverlay(externalTransport);

    // Full lifecycle: show → spawn → reconnect → dismiss.
    await fireEvent.click(screen.getByTestId('daemon-stopped-spawn-sidecar'));
    await vi.advanceTimersByTimeAsync(100);
    appStore.dispatch(connectionStatusChanged('connected', sidecarTransport));
    await vi.waitFor(() => {
      expect(overlay()).toBeNull();
    });

    // No backend:request (e.g. events.subscribe) or backend:subscribe was
    // issued by this feature — only the spawn channel.
    const wireCalls = invokeMock.mock.calls.filter(
      ([channel]) => channel === BACKEND.REQUEST || channel === BACKEND.SUBSCRIBE,
    );
    const subscribeCalls = wireCalls.filter(([, payload]) => {
      const method = (payload as { method?: string } | undefined)?.method;
      return method === 'events.subscribe' || method === undefined;
    });
    expect(subscribeCalls.filter(([c]) => c === BACKEND.SUBSCRIBE)).toHaveLength(0);
    expect(
      wireCalls.filter(
        ([, payload]) =>
          (payload as { method?: string } | undefined)?.method === 'events.subscribe',
      ),
    ).toHaveLength(0);
  });
});
