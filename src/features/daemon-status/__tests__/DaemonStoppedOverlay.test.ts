/**
 * DaemonStoppedOverlay component tests (#439).
 *
 * Drives the real daemon-health slice through connectionStatusChanged and
 * asserts the overlay's show / grace-period / dismiss / spawn-sidecar flows.
 * The spawn button goes through the real daemon-health middleware to the
 * backend:spawn-sidecar channel (asserted on the stubbed electronAPI.invoke).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// NOTE: testing-library's waitFor only detects JEST fake timers; with vitest
// fake timers its polling setTimeout never fires and every waitFor hangs.
// vi.waitFor auto-advances vitest fake timers, so it is used throughout.
import { render, cleanup, fireEvent, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';

import { store as appStore } from '$store/renderer/store';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { mockInvoke, resetMockIpcRouter } from '$shared/ipc-mock-router';
import { disposeDaemonHealthService } from '$store/renderer/middlewares/daemon-health-service';
import { connectionStatusChanged } from '$store/renderer/slices/daemon-health/daemon-health-slice';
import type { BackendTransportInfo } from '$store/renderer/slices/daemon-health/daemon-health-types';

import DaemonStoppedOverlay, { DAEMON_STOPPED_GRACE_MS } from '../DaemonStoppedOverlay.svelte';

const BACKEND = IPC_CHANNELS.BACKEND;

const sidecarTransport: BackendTransportInfo = { mode: 'sidecar-uds', target: '/tmp/i.sock' };
const externalTransport: BackendTransportInfo = { mode: 'external-uds', target: '/tmp/i.sock' };

let invokeMock: ReturnType<typeof vi.fn>;
// Transport the middleware's boot-time GET_STATUS fetch reports; kept in sync
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
  extras?: { sidecarGaveUp?: boolean; sidecarStartupFailed?: boolean; reason?: string },
) {
  bootTransport = transport;
  dispatchAndFlush(connectionStatusChanged('connected', transport));
  // Let the middleware's boot-time GET_STATUS fetch settle before the
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
  invokeMock.mockImplementation(async (channel: string, ...args: unknown[]) => {
    if (channel === BACKEND.GET_STATUS) {
      return { status: 'disconnected' };
    }
    return mockInvoke(channel, ...args);
  });
  dispatchAndFlush(connectionStatusChanged('disconnected', transport, extras));
  await vi.advanceTimersByTimeAsync(DAEMON_STOPPED_GRACE_MS + 50);
  await vi.waitFor(() => {
    expect(overlay()).toBeTruthy();
  });
}

describe('DaemonStoppedOverlay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    bootTransport = sidecarTransport;
    invokeMock = vi.fn(async (channel: string, ...args: unknown[]) => {
      if (channel === BACKEND.SPAWN_SIDECAR) {
        return { ok: true, spawned: true, reason: 'sidecar spawned' };
      }
      if (channel === BACKEND.GET_STATUS) {
        return { status: 'connected', transport: bootTransport };
      }
      return mockInvoke(channel, ...args);
    });
    vi.stubGlobal('electronAPI', { invoke: invokeMock, on: vi.fn(), off: vi.fn() });
    appStore.init();
  });

  afterEach(() => {
    cleanup();
    disposeDaemonHealthService();
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

  it('offers the sidecar fallback with the data-dir caveat in external mode', async () => {
    render(DaemonStoppedOverlay);
    await showOverlay(externalTransport);
    expect(screen.getByTestId('daemon-stopped-spawn-sidecar')).toBeTruthy();
    expect(overlay()!.textContent).toContain('external intentd daemon was lost');
    expect(overlay()!.textContent).toContain('may use a different data directory');
  });

  it('hides the spawn button in external-ws mode (the UDS sidecar would never be reached)', async () => {
    render(DaemonStoppedOverlay);
    await showOverlay({ mode: 'external-ws', target: 'ws://127.0.0.1:5181/ws' });
    expect(screen.queryByTestId('daemon-stopped-spawn-sidecar')).toBeNull();
    expect(overlay()!.textContent).toContain('external intentd daemon was lost');
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
      'Start app-managed sidecar',
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
      expect((screen.getByTestId('daemon-stopped-spawn-sidecar') as HTMLButtonElement).disabled).toBe(
        true,
      );
    });
    expect(screen.getByTestId('daemon-stopped-spawn-sidecar').textContent).toContain(
      'Starting sidecar',
    );

    // Reconnect (backend:status 'connected' via RESUB-1 main-side flow) dismisses.
    appStore.dispatch(connectionStatusChanged('connected', sidecarTransport));
    await vi.waitFor(() => {
      expect(overlay()).toBeNull();
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
    expect(button.textContent).toContain('Starting sidecar');
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
    expect(
      (screen.getByTestId('daemon-stopped-spawn-sidecar') as HTMLButtonElement).disabled,
    ).toBe(false);
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
        ([, payload]) => (payload as { method?: string } | undefined)?.method === 'events.subscribe',
      ),
    ).toHaveLength(0);
  });
});
