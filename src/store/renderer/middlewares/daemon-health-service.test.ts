/**
 * Daemon health service tests — asserts wire request shapes and state transitions.
 *
 * Uses the mock IPC router to assert that system.status requests match PROTOCOL.md §5.7.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { registerMockIpcHandler, mockInvoke, resetMockIpcRouter } from '$shared/ipc-mock-router';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { store as appStore } from '$store/renderer/store';
import { disposeDaemonHealthService } from './daemon-health-service';
import {
  pollSystemStatus,
  spawnSidecarRequested,
  fetchSidecarRunLogRequested,
} from '$store/renderer/slices/daemon-health/daemon-health-slice';
import type {
  BackendTransportInfo,
  SidecarRunLog,
  SystemStatusWirePayload,
} from '$store/renderer/slices/daemon-health/daemon-health-types';

// Mock the lazily-imported toast lib so the version-mismatch notice is observable.
vi.mock('$lib/components/ui/toast', () => ({
  toast: { warning: vi.fn() },
}));
import { toast } from '$lib/components/ui/toast';

const BACKEND = IPC_CHANNELS.BACKEND;

describe('daemon-health-service', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(toast.warning).mockClear();

    // Wire window.electronAPI.invoke to the mock IPC router
    vi.stubGlobal('electronAPI', {
      invoke: vi.fn((channel: string, ...args: unknown[]) => mockInvoke(channel, ...args)),
      on: vi.fn(),
      off: vi.fn(),
    });

    appStore.init();
  });

  afterEach(() => {
    disposeDaemonHealthService();
    resetMockIpcRouter();
    // Dispose the store so session latches (hasEverConnected,
    // sidecarStartupFailed) don't leak into the next test.
    appStore.dispose();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('asserts system.status request shape matches PROTOCOL.md §5.7', async () => {
    const requestSpy = vi.fn();
    const mockPayload: SystemStatusWirePayload = {
      running: true,
      listenMode: 'uds',
      transports: ['uds'],
      port: null,
      clients: 0,
      agents: 0,
      maxAgents: 8,
      version: '0.1.0',
      uptimeSeconds: 60,
      cpuPercent: 3.5,
      memoryBytes: 52428800,
      fingerprint: null,
      protocolVersion: '2.0',
      host: {
        os: 'macos',
        arch: 'aarch64',
        hasDisplay: true,
        locality: 'local',
      },
    };

    registerMockIpcHandler(BACKEND.REQUEST, async (payload: { method?: string; params?: unknown }) => {
      requestSpy(payload);
      if (payload.method === 'system.status') {
        // PROTOCOL.md §5.7: system.status takes no params.
        expect(payload.params).toBeUndefined();
        return { ok: true, result: mockPayload };
      }
      return { ok: false, error: { code: 'METHOD_NOT_FOUND', message: 'unknown method' } };
    });

    registerMockIpcHandler(BACKEND.GET_STATUS, async () => ({ status: 'connected' }));

    // Manually trigger boot by dispatching an action (the middleware boots on first action).
    appStore.dispatch({ type: '__BOOT__' });

    // Advance time to trigger the immediate poll.
    await vi.advanceTimersByTimeAsync(100);

    // Wait for async poll to complete.
    await vi.waitFor(() => {
      expect(requestSpy).toHaveBeenCalledWith({ method: 'system.status', params: undefined });
    });

    // Assert state updated.
    const state = appStore.state.daemonHealth;
    expect(state.health).toBe('healthy');
    expect(state.stats).toEqual({
      clients: 0,
      agents: 0,
      maxAgents: 8,
      listenMode: 'uds',
      port: null,
      version: '0.1.0',
      protocolVersion: '2.0',
      uptimeSeconds: 60,
      cpuPercent: 3.5,
      memoryBytes: 52428800,
      os: 'macos',
      arch: 'aarch64',
    });
  });

  it('triggers an immediate poll when pollSystemStatus is dispatched', async () => {
    let pollCount = 0;
    registerMockIpcHandler(BACKEND.GET_STATUS, async () => ({ status: 'connected' }));
    registerMockIpcHandler(BACKEND.REQUEST, async (payload: { method?: string }) => {
      if (payload.method === 'system.status') {
        pollCount++;
        return {
          ok: true,
          result: {
            running: true,
            listenMode: 'uds',
            transports: ['uds'],
            port: null,
            clients: 0,
            agents: 0,
            protocolVersion: '2.0',
            host: { os: 'macos', arch: 'aarch64', hasDisplay: true, locality: 'local' },
          } as SystemStatusWirePayload,
        };
      }
      return { ok: false, error: { code: 'METHOD_NOT_FOUND', message: 'unknown method' } };
    });

    // Boot (dispatches the initial pollSystemStatus).
    appStore.dispatch({ type: '__BOOT__' });
    await vi.advanceTimersByTimeAsync(100);
    await vi.waitFor(() => {
      expect(pollCount).toBe(1);
    });

    // Dispatching pollSystemStatus triggers an immediate poll without waiting
    // for the 10s background interval.
    appStore.dispatch(pollSystemStatus());
    await vi.advanceTimersByTimeAsync(100);
    await vi.waitFor(() => {
      expect(pollCount).toBe(2);
    });
  });

  it('guards against overlapping in-flight polls', async () => {
    let pollCount = 0;
    let resolvePoll: ((value: unknown) => void) | null = null;
    registerMockIpcHandler(BACKEND.GET_STATUS, async () => ({ status: 'connected' }));
    registerMockIpcHandler(BACKEND.REQUEST, async (payload: { method?: string }) => {
      if (payload.method === 'system.status') {
        pollCount++;
        // Hold the poll open until the test resolves it.
        await new Promise((resolve) => {
          resolvePoll = resolve;
        });
        return {
          ok: true,
          result: {
            running: true,
            listenMode: 'uds',
            transports: ['uds'],
            port: null,
            clients: 0,
            agents: 0,
            protocolVersion: '2.0',
            host: { os: 'macos', arch: 'aarch64', hasDisplay: true, locality: 'local' },
          } as SystemStatusWirePayload,
        };
      }
      return { ok: false, error: { code: 'METHOD_NOT_FOUND', message: 'unknown method' } };
    });

    appStore.dispatch({ type: '__BOOT__' });
    await vi.advanceTimersByTimeAsync(100);
    await vi.waitFor(() => {
      expect(pollCount).toBe(1);
    });

    // Dispatch more pollSystemStatus actions while the first poll is in flight —
    // they must not start overlapping requests.
    appStore.dispatch(pollSystemStatus());
    appStore.dispatch(pollSystemStatus());
    await vi.advanceTimersByTimeAsync(100);
    expect(pollCount).toBe(1);

    // Complete the in-flight poll; a subsequent dispatch polls again.
    resolvePoll!(undefined);
    await vi.advanceTimersByTimeAsync(100);
    appStore.dispatch(pollSystemStatus());
    await vi.advanceTimersByTimeAsync(100);
    await vi.waitFor(() => {
      expect(pollCount).toBe(2);
    });
  });

  it('ignores polls that resolve after dispose (stale-generation guard)', async () => {
    let pollCount = 0;
    let resolvePoll: ((value: unknown) => void) | null = null;
    registerMockIpcHandler(BACKEND.GET_STATUS, async () => ({ status: 'connected' }));
    registerMockIpcHandler(BACKEND.REQUEST, async (payload: { method?: string }) => {
      if (payload.method === 'system.status') {
        pollCount++;
        if (pollCount === 1) {
          // Hold the first poll open until the test resolves it.
          await new Promise((resolve) => {
            resolvePoll = resolve;
          });
        }
        return {
          ok: true,
          result: {
            running: true,
            listenMode: 'uds',
            transports: ['uds'],
            port: null,
            clients: pollCount,
            agents: 0,
            protocolVersion: '2.0',
            host: { os: 'macos', arch: 'aarch64', hasDisplay: true, locality: 'local' },
          } as SystemStatusWirePayload,
        };
      }
      return { ok: false, error: { code: 'METHOD_NOT_FOUND', message: 'unknown method' } };
    });

    appStore.dispatch({ type: '__BOOT__' });
    await vi.advanceTimersByTimeAsync(100);
    await vi.waitFor(() => {
      expect(pollCount).toBe(1);
    });

    // Dispose while the first poll is still in flight, then reboot.
    disposeDaemonHealthService();
    appStore.dispatch({ type: '__BOOT__' });
    await vi.advanceTimersByTimeAsync(100);
    await vi.waitFor(() => {
      expect(pollCount).toBe(2);
    });
    // The rebooted service's poll (clients: 2) landed in state.
    expect(appStore.state.daemonHealth.stats?.clients).toBe(2);

    // Late resolution of the pre-dispose poll must not overwrite newer state.
    resolvePoll!(undefined);
    await vi.advanceTimersByTimeAsync(100);
    expect(appStore.state.daemonHealth.stats?.clients).toBe(2);
  });

  it('transitions health to down on disconnected status', async () => {
    const statusEvents: Array<{ status: string }> = [];
    registerMockIpcHandler(BACKEND.GET_STATUS, async () => ({ status: 'disconnected' }));
    registerMockIpcHandler(BACKEND.REQUEST, async () => ({
      ok: false,
      error: { code: 'UNAVAILABLE', message: 'backend unavailable' },
    }));

    // Override the `on` method to capture and trigger status events.
    const handlers = new Map<string, Array<(payload: { status: string }) => void>>();
    window.electronAPI!.on = vi.fn((channel: string, handler: (payload: { status: string }) => void) => {
      if (!handlers.has(channel)) {
        handlers.set(channel, []);
      }
      handlers.get(channel)!.push(handler);
      if (channel === BACKEND.STATUS) {
        // Simulate a disconnected event.
        setTimeout(() => {
          statusEvents.push({ status: 'disconnected' });
          handler({ status: 'disconnected' });
        }, 10);
      }
    });

    appStore.dispatch({ type: '__BOOT__' });

    await vi.waitFor(() => {
      expect(statusEvents.length).toBeGreaterThan(0);
    });

    const state = appStore.state.daemonHealth;
    expect(state.health).toBe('down');
  });

  it('latches sidecarStartupFailed + reason from the boot-time get-status response (spec addendum)', async () => {
    // Boot-time startup failures fire before the renderer exists, so the
    // broadcast alone is lossy — the get-status response carries the latched
    // extras and the middleware must pass them into connectionStatusChanged.
    registerMockIpcHandler(BACKEND.GET_STATUS, async () => ({
      status: 'disconnected',
      transport: { mode: 'sidecar-uds', target: '/tmp/intentd.sock' },
      sidecarStartupFailed: true,
      sidecarStartupFailedReason: 'intentd binary not found',
    }));
    registerMockIpcHandler(BACKEND.REQUEST, async () => ({
      ok: false,
      error: { code: 'UNAVAILABLE', message: 'backend unavailable' },
    }));

    appStore.dispatch({ type: '__BOOT__' });
    await vi.advanceTimersByTimeAsync(100);

    await vi.waitFor(() => {
      const state = appStore.state.daemonHealth;
      expect(state.sidecarStartupFailed).toBe(true);
      expect(state.sidecarStartupFailedReason).toBe('intentd binary not found');
    });
    expect(appStore.state.daemonHealth.health).toBe('down');
  });

  it('stores sidecarGaveUp + reason from a give-up disconnect broadcast and clears on reconnect', async () => {
    registerMockIpcHandler(BACKEND.GET_STATUS, async () => ({
      status: 'connected',
      transport: { mode: 'sidecar-uds', target: '/tmp/intentd.sock' } satisfies BackendTransportInfo,
    }));
    registerMockIpcHandler(BACKEND.REQUEST, async (payload: { method?: string }) => {
      if (payload.method === 'system.status') {
        return {
          ok: true,
          result: {
            running: true,
            listenMode: 'uds',
            transports: ['uds'],
            port: null,
            clients: 0,
            agents: 0,
            protocolVersion: '2.0',
            host: { os: 'macos', arch: 'aarch64', hasDisplay: true, locality: 'local' },
          } as SystemStatusWirePayload,
        };
      }
      return { ok: false, error: { code: 'METHOD_NOT_FOUND', message: 'unknown method' } };
    });

    // Capture the backend:status listener so we can push follow-up events.
    let statusHandler:
      | ((payload: {
          status: string;
          transport?: BackendTransportInfo;
          sidecarGaveUp?: boolean;
          reason?: string;
        }) => void)
      | null = null;
    window.electronAPI!.on = vi.fn(
      (channel: string, handler: (payload: { status: string }) => void) => {
        if (channel === BACKEND.STATUS) statusHandler = handler;
      },
    );

    appStore.dispatch({ type: '__BOOT__' });
    await vi.advanceTimersByTimeAsync(100);
    await vi.waitFor(() => {
      expect(appStore.state.daemonHealth.health).toBe('healthy');
    });
    expect(appStore.state.daemonHealth.transport?.mode).toBe('sidecar-uds');

    // Give-up disconnect broadcast (#439 shape: status + sidecarGaveUp + reason).
    statusHandler!({
      status: 'disconnected',
      sidecarGaveUp: true,
      reason: 'restart limit reached',
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(appStore.state.daemonHealth.health).toBe('down');
    expect(appStore.state.daemonHealth.sidecarGaveUp).toBe(true);
    expect(appStore.state.daemonHealth.sidecarGaveUpReason).toBe('restart limit reached');
    // Transport survives the disconnect so the UI knows the connection mode.
    expect(appStore.state.daemonHealth.transport?.mode).toBe('sidecar-uds');

    // Reconnect clears the latched give-up state.
    statusHandler!({
      status: 'connected',
      transport: { mode: 'sidecar-uds', target: '/tmp/intentd.sock' },
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(appStore.state.daemonHealth.health).toBe('healthy');
    expect(appStore.state.daemonHealth.sidecarGaveUp).toBe(false);
    expect(appStore.state.daemonHealth.sidecarGaveUpReason).toBeNull();
  });

  it('stores sidecarStartupFailed + reason from a startup-failure broadcast and clears on reconnect', async () => {
    registerMockIpcHandler(BACKEND.GET_STATUS, async () => ({ status: 'disconnected' }));
    registerMockIpcHandler(BACKEND.REQUEST, async () => ({
      ok: false,
      error: { code: 'UNAVAILABLE', message: 'backend unavailable' },
    }));

    // Capture the backend:status listener so we can push follow-up events.
    let statusHandler:
      | ((payload: {
          status: string;
          transport?: BackendTransportInfo;
          sidecarStartupFailed?: boolean;
          reason?: string;
        }) => void)
      | null = null;
    window.electronAPI!.on = vi.fn(
      (channel: string, handler: (payload: { status: string }) => void) => {
        if (channel === BACKEND.STATUS) statusHandler = handler;
      },
    );

    appStore.dispatch({ type: '__BOOT__' });
    await vi.advanceTimersByTimeAsync(100);
    expect(appStore.state.daemonHealth.hasEverConnected).toBe(false);

    // Startup-failure broadcast (pinned contract: sidecarStartupFailed + reason).
    statusHandler!({
      status: 'disconnected',
      sidecarStartupFailed: true,
      reason: 'intentd binary not found',
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(appStore.state.daemonHealth.health).toBe('down');
    expect(appStore.state.daemonHealth.sidecarStartupFailed).toBe(true);
    expect(appStore.state.daemonHealth.sidecarStartupFailedReason).toBe(
      'intentd binary not found',
    );

    // Reconnect clears the latch and sets the session hasEverConnected latch.
    statusHandler!({
      status: 'connected',
      transport: { mode: 'sidecar-uds', target: '/tmp/intentd.sock' },
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(appStore.state.daemonHealth.sidecarStartupFailed).toBe(false);
    expect(appStore.state.daemonHealth.sidecarStartupFailedReason).toBeNull();
    expect(appStore.state.daemonHealth.hasEverConnected).toBe(true);
  });

  it('invokes backend:spawn-sidecar on spawnSidecarRequested and keeps pending on success', async () => {
    registerMockIpcHandler(BACKEND.GET_STATUS, async () => ({ status: 'disconnected' }));
    registerMockIpcHandler(BACKEND.REQUEST, async () => ({
      ok: false,
      error: { code: 'UNAVAILABLE', message: 'backend unavailable' },
    }));

    appStore.dispatch({ type: '__BOOT__' });
    await vi.advanceTimersByTimeAsync(100);

    // The middleware invokes SPAWN_SIDECAR through window.electronAPI directly
    // (main-process channel — no daemon wire request involved).
    const invokeMock = vi.mocked(window.electronAPI!.invoke);
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === BACKEND.SPAWN_SIDECAR) {
        return { ok: true, spawned: true, reason: 'sidecar spawned' };
      }
      return mockInvoke(channel);
    });

    appStore.dispatch(spawnSidecarRequested());
    expect(appStore.state.daemonHealth.sidecarSpawnPending).toBe(true);
    await vi.advanceTimersByTimeAsync(100);

    expect(invokeMock).toHaveBeenCalledWith(BACKEND.SPAWN_SIDECAR);
    // Successful spawn leaves pending set — it clears on the reconnect
    // 'connected' status event, not on the invoke result.
    expect(appStore.state.daemonHealth.sidecarSpawnPending).toBe(true);
    expect(appStore.state.daemonHealth.sidecarSpawnError).toBeNull();
  });

  it('dispatches spawnSidecarFailed when backend:spawn-sidecar reports failure', async () => {
    registerMockIpcHandler(BACKEND.GET_STATUS, async () => ({ status: 'disconnected' }));
    registerMockIpcHandler(BACKEND.REQUEST, async () => ({
      ok: false,
      error: { code: 'UNAVAILABLE', message: 'backend unavailable' },
    }));

    appStore.dispatch({ type: '__BOOT__' });
    await vi.advanceTimersByTimeAsync(100);

    const invokeMock = vi.mocked(window.electronAPI!.invoke);
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === BACKEND.SPAWN_SIDECAR) {
        return { ok: false, spawned: false, reason: 'intentd binary not found' };
      }
      return mockInvoke(channel);
    });

    appStore.dispatch(spawnSidecarRequested());
    await vi.advanceTimersByTimeAsync(100);

    await vi.waitFor(() => {
      expect(appStore.state.daemonHealth.sidecarSpawnPending).toBe(false);
      expect(appStore.state.daemonHealth.sidecarSpawnError).toBe('intentd binary not found');
    });
  });

  it('invokes backend:get-sidecar-run-log on fetchSidecarRunLogRequested and stores the payload', async () => {
    registerMockIpcHandler(BACKEND.GET_STATUS, async () => ({ status: 'disconnected' }));
    registerMockIpcHandler(BACKEND.REQUEST, async () => ({
      ok: false,
      error: { code: 'UNAVAILABLE', message: 'backend unavailable' },
    }));

    appStore.dispatch({ type: '__BOOT__' });
    await vi.advanceTimersByTimeAsync(100);

    // Contract-shaped payload (spec "Pinned IPC contract").
    const runLog: SidecarRunLog = {
      available: true,
      startedAt: '2026-07-26T00:00:00.000Z',
      endedAt: '2026-07-26T00:00:05.000Z',
      exitCode: 1,
      signal: null,
      spawnError: null,
      lines: ['intentd starting', 'error: bind failed'],
    };
    const invokeMock = vi.mocked(window.electronAPI!.invoke);
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === BACKEND.GET_SIDECAR_RUN_LOG) return runLog;
      return mockInvoke(channel);
    });

    appStore.dispatch(fetchSidecarRunLogRequested());
    expect(appStore.state.daemonHealth.sidecarRunLogPending).toBe(true);
    await vi.advanceTimersByTimeAsync(100);

    // Exact channel name pinned by the IPC contract.
    expect(invokeMock).toHaveBeenCalledWith('backend:get-sidecar-run-log');
    await vi.waitFor(() => {
      expect(appStore.state.daemonHealth.sidecarRunLogPending).toBe(false);
      expect(appStore.state.daemonHealth.sidecarRunLog).toEqual(runLog);
    });
    expect(appStore.state.daemonHealth.sidecarRunLogError).toBeNull();
  });

  it('dispatches fetchSidecarRunLogFailed when backend:get-sidecar-run-log rejects', async () => {
    registerMockIpcHandler(BACKEND.GET_STATUS, async () => ({ status: 'disconnected' }));
    registerMockIpcHandler(BACKEND.REQUEST, async () => ({
      ok: false,
      error: { code: 'UNAVAILABLE', message: 'backend unavailable' },
    }));

    appStore.dispatch({ type: '__BOOT__' });
    await vi.advanceTimersByTimeAsync(100);

    const invokeMock = vi.mocked(window.electronAPI!.invoke);
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === BACKEND.GET_SIDECAR_RUN_LOG) throw new Error('bridge unavailable');
      return mockInvoke(channel);
    });

    appStore.dispatch(fetchSidecarRunLogRequested());
    await vi.advanceTimersByTimeAsync(100);

    await vi.waitFor(() => {
      expect(appStore.state.daemonHealth.sidecarRunLogPending).toBe(false);
      expect(appStore.state.daemonHealth.sidecarRunLogError).toBe('bridge unavailable');
    });
    expect(appStore.state.daemonHealth.sidecarRunLog).toBeNull();
  });

  it('shows a one-time dismissible warning toast when the transport reports a version mismatch', async () => {
    const mismatchTransport: BackendTransportInfo = {
      mode: 'external-uds',
      target: '/tmp/intentd.sock',
      daemonVersion: '0.2.0',
      versionMismatch: true,
    };
    registerMockIpcHandler(BACKEND.GET_STATUS, async () => ({
      status: 'connected',
      transport: mismatchTransport,
    }));
    registerMockIpcHandler(BACKEND.REQUEST, async () => ({
      ok: false,
      error: { code: 'METHOD_NOT_FOUND', message: 'unknown method' },
    }));

    // Capture the backend:status listener so we can push follow-up events.
    let statusHandler: ((payload: { status: string; transport?: BackendTransportInfo }) => void) | null =
      null;
    window.electronAPI!.on = vi.fn(
      (channel: string, handler: (payload: { status: string }) => void) => {
        if (channel === BACKEND.STATUS) statusHandler = handler;
      },
    );

    appStore.dispatch({ type: '__BOOT__' });
    await vi.advanceTimersByTimeAsync(100);

    await vi.waitFor(() => {
      expect(toast.warning).toHaveBeenCalledTimes(1);
    });
    expect(toast.warning).toHaveBeenCalledWith(
      expect.stringContaining('v0.2.0'),
      expect.objectContaining({ duration: expect.any(Number) }),
    );

    // A later status event with the same mismatch must not re-toast.
    statusHandler!({ status: 'connected', transport: mismatchTransport });
    await vi.advanceTimersByTimeAsync(100);
    expect(toast.warning).toHaveBeenCalledTimes(1);
  });

  it('normalizes a v-prefixed daemon version in the mismatch toast (no "vv")', async () => {
    registerMockIpcHandler(BACKEND.GET_STATUS, async () => ({
      status: 'connected',
      transport: {
        mode: 'external-uds',
        target: '/tmp/intentd.sock',
        daemonVersion: 'v0.2.0',
        versionMismatch: true,
      } satisfies BackendTransportInfo,
    }));
    registerMockIpcHandler(BACKEND.REQUEST, async () => ({
      ok: false,
      error: { code: 'METHOD_NOT_FOUND', message: 'unknown method' },
    }));

    appStore.dispatch({ type: '__BOOT__' });
    await vi.advanceTimersByTimeAsync(100);

    await vi.waitFor(() => {
      expect(toast.warning).toHaveBeenCalledTimes(1);
    });
    const message = vi.mocked(toast.warning).mock.calls[0][0] as string;
    expect(message).toContain('(v0.2.0)');
    expect(message).not.toContain('vv0.2.0');
  });

  it('does not toast when the transport reports matching versions', async () => {
    registerMockIpcHandler(BACKEND.GET_STATUS, async () => ({
      status: 'connected',
      transport: {
        mode: 'external-uds',
        target: '/tmp/intentd.sock',
        daemonVersion: '0.1.0',
        versionMismatch: false,
      } satisfies BackendTransportInfo,
    }));
    registerMockIpcHandler(BACKEND.REQUEST, async () => ({
      ok: false,
      error: { code: 'METHOD_NOT_FOUND', message: 'unknown method' },
    }));

    appStore.dispatch({ type: '__BOOT__' });
    await vi.advanceTimersByTimeAsync(100);

    expect(toast.warning).not.toHaveBeenCalled();
  });

  it('transitions health to degraded on poll failure while connected', async () => {
    registerMockIpcHandler(BACKEND.GET_STATUS, async () => ({ status: 'connected' }));
    let pollCount = 0;
    registerMockIpcHandler(BACKEND.REQUEST, async (payload: { method?: string }) => {
      if (payload.method === 'system.status') {
        pollCount++;
        if (pollCount === 1) {
          // First poll succeeds.
          return {
            ok: true,
            result: {
              running: true,
              listenMode: 'uds',
              transports: ['uds'],
              port: null,
              clients: 0,
              agents: 0,
              protocolVersion: '2.0',
              host: { os: 'macos', arch: 'aarch64', hasDisplay: true, locality: 'local' },
            } as SystemStatusWirePayload,
          };
        } else {
          // Second poll fails (heartbeat timeout).
          return { ok: false, error: { code: 'TIMEOUT', message: 'heartbeat timeout' } };
        }
      }
      return { ok: false, error: { code: 'METHOD_NOT_FOUND', message: 'unknown method' } };
    });

    appStore.dispatch({ type: '__BOOT__' });

    // Advance time to trigger the immediate poll.
    await vi.advanceTimersByTimeAsync(100);

    // Wait for first poll.
    await vi.waitFor(() => {
      expect(pollCount).toBeGreaterThanOrEqual(1);
      expect(appStore.state.daemonHealth.health).toBe('healthy');
    });

    // Advance time to trigger the second poll (10s interval).
    await vi.advanceTimersByTimeAsync(10_000);

    // Wait for second poll.
    await vi.waitFor(() => {
      expect(pollCount).toBeGreaterThanOrEqual(2);
      expect(appStore.state.daemonHealth.health).toBe('degraded');
    });
  });
});
