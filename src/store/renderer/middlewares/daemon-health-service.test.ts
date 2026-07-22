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
import { pollSystemStatus } from '$store/renderer/slices/daemon-health/daemon-health-slice';
import type {
  BackendTransportInfo,
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
