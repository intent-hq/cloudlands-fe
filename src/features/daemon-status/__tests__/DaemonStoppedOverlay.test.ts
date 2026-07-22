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
  extras?: { sidecarGaveUp?: boolean; reason?: string },
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

  it('offers the sidecar fallback after the supervisor gave up, with the reason', async () => {
    render(DaemonStoppedOverlay);
    await showOverlay(sidecarTransport, { sidecarGaveUp: true, reason: 'restart limit reached' });
    expect(screen.getByTestId('daemon-stopped-spawn-sidecar')).toBeTruthy();
    expect(overlay()!.textContent).toContain('could not be restarted');
    expect(overlay()!.textContent).toContain('restart limit reached');
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
