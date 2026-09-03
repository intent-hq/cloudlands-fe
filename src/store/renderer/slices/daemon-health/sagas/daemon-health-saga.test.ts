import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => ({
  backendRequest: vi.fn(),
  toastWarning: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: mocks.backendRequest,
}));
vi.mock('$lib/components/ui/toast', () => ({
  toast: { warning: mocks.toastWarning, error: mocks.toastError },
}));

import { IPC_CHANNELS } from '$shared/ipc-registry';
import {
  connectionStatusChanged,
  fetchSidecarRunLogRequested,
  fetchSidecarRunLogSucceeded,
  heartbeatFailed,
  openLocalAndSpawnRequested,
  openLocalAndSpawnSucceeded,
  pollUnslothStatus,
  spawnSidecarFailed,
  spawnSidecarRequested,
  stopUnslothFailed,
  stopUnslothRequested,
  systemStatusFailure,
} from '../daemon-health-slice';
import type { SystemStatusWirePayload } from '../daemon-health-types';
import { daemonHealthSaga, pollSystemStatusSaga } from './daemon-health-saga';

const BACKEND = IPC_CHANNELS.BACKEND;
const statusPayload: SystemStatusWirePayload = {
  running: true,
  listenMode: 'uds',
  transports: ['uds'],
  port: null,
  clients: 1,
  agents: 2,
  protocolVersion: '2.6',
  host: { os: 'macos', arch: 'aarch64', hasDisplay: true, locality: 'local' },
};

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function startHealthSaga() {
  const input = stdChannel();
  const dispatched: unknown[] = [];
  const dispatch = (action: unknown) => {
    dispatched.push(action);
    input.put(action as never);
    return action;
  };
  const task = runSaga(
    {
      channel: input,
      dispatch,
      getState: () => ({ daemonHealth: { health: 'healthy' } }),
    },
    daemonHealthSaga,
  );
  return { input, dispatched, task };
}

function statusActions(dispatched: unknown[]) {
  return dispatched.filter(
    (action) => (action as { type?: string }).type === connectionStatusChanged.type,
  );
}

describe('daemonHealthSaga', () => {
  let statusHandler: ((payload: unknown) => void) | undefined;
  let invoke: ReturnType<typeof vi.fn>;
  let offById: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    statusHandler = undefined;
    invoke = vi.fn(async (channel: string) => {
      if (channel === BACKEND.GET_STATUS) return { status: 'connected' };
      return undefined;
    });
    offById = vi.fn();
    vi.stubGlobal('electronAPI', {
      invoke,
      on: vi.fn((channel: string, handler: (payload: unknown) => void) => {
        if (channel === BACKEND.STATUS) statusHandler = handler;
        return 'listener-status';
      }),
      offById,
    });
    mocks.backendRequest.mockImplementation(async (method: string) => {
      if (method === 'system.status') return statusPayload;
      if (method === 'unsloth.status') return { running: false };
      if (method === 'unsloth.stop') return { stopped: true };
      throw new Error(`unexpected ${method}`);
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('installs status first, applies snapshot before buffered pushes, polls immediately, and toasts once', async () => {
    let resolveStatus!: (value: unknown) => void;
    invoke.mockImplementation((channel: string) => {
      if (channel === BACKEND.GET_STATUS) {
        return new Promise((resolve) => {
          resolveStatus = resolve;
        });
      }
      return Promise.resolve(undefined);
    });
    const { dispatched, task } = startHealthSaga();
    expect(statusHandler).toBeTypeOf('function');
    statusHandler!({
      status: 'disconnected',
      transport: { mode: 'external-uds', versionMismatch: true, daemonVersion: 'v2.0.0' },
      reason: 'restart',
    });
    resolveStatus({
      status: 'connected',
      transport: { mode: 'external-uds', versionMismatch: true, daemonVersion: '2.0.0' },
    });
    await settle();
    await vi.advanceTimersByTimeAsync(0);

    expect(statusActions(dispatched)).toEqual([
      connectionStatusChanged(
        'connected',
        {
          mode: 'external-uds',
          versionMismatch: true,
          daemonVersion: '2.0.0',
        },
        { sidecarGaveUp: undefined, sidecarStartupFailed: undefined, reason: undefined },
      ),
      connectionStatusChanged(
        'disconnected',
        {
          mode: 'external-uds',
          versionMismatch: true,
          daemonVersion: 'v2.0.0',
        },
        { sidecarGaveUp: undefined, sidecarStartupFailed: undefined, reason: 'restart' },
      ),
    ]);
    expect(mocks.backendRequest).toHaveBeenCalledWith('system.status');
    expect(mocks.toastWarning).toHaveBeenCalledTimes(1);
    task.cancel();
    await task.toPromise();
  });

  it('re-toasts after a cleared mismatch with the new version (mismatch→cleared→mismatch)', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === BACKEND.GET_STATUS) {
        return {
          status: 'connected',
          transport: { mode: 'external-uds', versionMismatch: true, daemonVersion: '2.0.0' },
        };
      }
      return undefined;
    });
    const { task } = startHealthSaga();
    await settle();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.toastWarning).toHaveBeenCalledTimes(1);
    expect(mocks.toastWarning.mock.calls[0]![0]).toContain('v2.0.0');

    // A repeated mismatch payload does not re-toast.
    statusHandler!({
      status: 'connected',
      transport: { mode: 'external-uds', versionMismatch: true, daemonVersion: '2.0.0' },
    });
    await settle();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.toastWarning).toHaveBeenCalledTimes(1);

    // The mismatch clears (e.g. daemon upgraded back to the pinned version).
    statusHandler!({
      status: 'connected',
      transport: { mode: 'external-uds', versionMismatch: false, daemonVersion: '2.1.0' },
    });
    await settle();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.toastWarning).toHaveBeenCalledTimes(1);

    // A later genuine mismatch notifies again, with the current version.
    statusHandler!({
      status: 'connected',
      transport: { mode: 'external-uds', versionMismatch: true, daemonVersion: '3.0.0' },
    });
    await settle();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.toastWarning).toHaveBeenCalledTimes(2);
    expect(mocks.toastWarning.mock.calls[1]![0]).toContain('v3.0.0');

    task.cancel();
    await task.toPromise();
  });

  it('suppresses the generic mismatch toast when the behind-pin Update toast owns it', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === BACKEND.GET_STATUS) {
        return {
          status: 'connected',
          transport: {
            mode: 'external-uds',
            versionMismatch: true,
            daemonVersion: '1.0.0',
            pinnedVersion: '2.0.0',
            updateSupported: true,
            exactVersionUpdateSupported: true,
          },
        };
      }
      return undefined;
    });
    const { task } = startHealthSaga();
    await settle();
    await vi.advanceTimersByTimeAsync(0);
    // Behind the pin with explicit update support: the actionable Update
    // toast (connections-saga) owns this mismatch — no passive warning.
    expect(mocks.toastWarning).not.toHaveBeenCalled();

    // Suppression does not consume the latch: if the flag later reads false
    // (e.g. after a daemon swap) the passive warning still fires once.
    statusHandler!({
      status: 'connected',
      transport: {
        mode: 'external-uds',
        versionMismatch: true,
        daemonVersion: '1.0.0',
        pinnedVersion: '2.0.0',
        updateSupported: false,
      },
    });
    await settle();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.toastWarning).toHaveBeenCalledTimes(1);

    task.cancel();
    await task.toPromise();
  });

  it('keeps the passive mismatch toast for a newer-than-pin daemon even with update support', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === BACKEND.GET_STATUS) {
        return {
          status: 'connected',
          transport: {
            mode: 'external-uds',
            versionMismatch: true,
            daemonVersion: '3.0.0',
            pinnedVersion: '2.0.0',
            updateSupported: true,
            exactVersionUpdateSupported: true,
          },
        };
      }
      return undefined;
    });
    const { task } = startHealthSaga();
    await settle();
    await vi.advanceTimersByTimeAsync(0);
    // Newer than the pin is not the behind-pin toast's case: warn passively.
    expect(mocks.toastWarning).toHaveBeenCalledTimes(1);
    expect(mocks.toastWarning.mock.calls[0]![0]).toContain('v3.0.0');

    task.cancel();
    await task.toPromise();
  });

  it('keeps suppressing the generic mismatch toast for orphaned sidecars after the latch resets', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === BACKEND.GET_STATUS) {
        return {
          status: 'connected',
          transport: { mode: 'external-uds', versionMismatch: false },
        };
      }
      return undefined;
    });
    const { task } = startHealthSaga();
    await settle();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.toastWarning).not.toHaveBeenCalled();

    // An orphaned sidecar with a mismatch only gets the actionable orphan
    // offer — never the generic mismatch toast, even with a fresh latch.
    statusHandler!({
      status: 'connected',
      transport: {
        mode: 'external-uds',
        versionMismatch: true,
        daemonVersion: '1.0.0',
        isOrphanedSidecar: true,
      },
    });
    await settle();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.toastWarning).toHaveBeenCalledTimes(1);
    const [, options] = mocks.toastWarning.mock.calls[0] as [
      string,
      { action?: { label: string } },
    ];
    expect(options.action?.label).toBeTruthy();

    task.cancel();
    await task.toPromise();
  });

  it('offers orphaned-sidecar restart once (with action) and suppresses the mismatch toast (#2444)', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === BACKEND.GET_STATUS) {
        return {
          status: 'connected',
          transport: {
            mode: 'external-uds',
            versionMismatch: true,
            daemonVersion: '1.0.0',
            isOrphanedSidecar: true,
          },
        };
      }
      if (channel === BACKEND.RESTART_ORPHANED_SIDECAR) {
        return { ok: true, spawned: true };
      }
      return undefined;
    });
    const { task } = startHealthSaga();
    await settle();
    await vi.advanceTimersByTimeAsync(0);

    // One toast: the actionable orphan offer; the generic mismatch is suppressed.
    expect(mocks.toastWarning).toHaveBeenCalledTimes(1);
    const [, options] = mocks.toastWarning.mock.calls[0] as [
      string,
      { action: { label: string; onClick: () => void } },
    ];
    expect(options.action.label).toBeTruthy();

    // A repeat push with the same classification does not re-toast.
    statusHandler!({
      status: 'connected',
      transport: { mode: 'external-uds', isOrphanedSidecar: true },
    });
    await settle();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.toastWarning).toHaveBeenCalledTimes(1);

    // The action invokes the restart recovery channel.
    options.action.onClick();
    await settle();
    expect(invoke).toHaveBeenCalledWith(BACKEND.RESTART_ORPHANED_SIDECAR);
    expect(mocks.toastError).not.toHaveBeenCalled();
    task.cancel();
    await task.toPromise();
  });

  it('surfaces an error toast when the orphan restart fails (#2444)', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === BACKEND.GET_STATUS) {
        return {
          status: 'connected',
          transport: { mode: 'external-uds', isOrphanedSidecar: true },
        };
      }
      if (channel === BACKEND.RESTART_ORPHANED_SIDECAR) {
        return { ok: false, spawned: false, reason: 'orphaned sidecar did not exit' };
      }
      return undefined;
    });
    const { task } = startHealthSaga();
    await settle();
    await vi.advanceTimersByTimeAsync(0);
    const [, options] = mocks.toastWarning.mock.calls[0] as [
      string,
      { action: { label: string; onClick: () => void } },
    ];
    options.action.onClick();
    await vi.advanceTimersByTimeAsync(0);
    await settle();
    expect(mocks.toastError).toHaveBeenCalledTimes(1);

    // The failure resets the once-per-session gate: a later status push that
    // still carries the classification re-offers the restart.
    statusHandler!({
      status: 'connected',
      transport: { mode: 'external-uds', isOrphanedSidecar: true },
    });
    await settle();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.toastWarning).toHaveBeenCalledTimes(2);
    task.cancel();
    await task.toPromise();
  });

  it('does not surface an error toast when the user cancels the restart (#2444)', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === BACKEND.GET_STATUS) {
        return {
          status: 'connected',
          transport: { mode: 'external-uds', isOrphanedSidecar: true },
        };
      }
      if (channel === BACKEND.RESTART_ORPHANED_SIDECAR) {
        return { ok: false, spawned: false, cancelled: true, reason: 'cancelled by user' };
      }
      return undefined;
    });
    const { task } = startHealthSaga();
    await settle();
    await vi.advanceTimersByTimeAsync(0);
    const [, options] = mocks.toastWarning.mock.calls[0] as [
      string,
      { action: { label: string; onClick: () => void } },
    ];
    options.action.onClick();
    await settle();
    await settle();
    expect(mocks.toastError).not.toHaveBeenCalled();
    task.cancel();
    await task.toPromise();
  });

  it('passes reconnectAttempts from the status payload into the action extras (#1750)', async () => {
    const { dispatched, task } = startHealthSaga();
    await settle();
    statusHandler!({
      status: 'connecting',
      transport: { mode: 'external-ws', target: 'wss:192.168.1.20:5181' },
      reconnectAttempts: 14,
    });
    await settle();

    const actions = statusActions(dispatched) as Array<{
      payload: [string, unknown, { reconnectAttempts?: number } | undefined];
    }>;
    const connecting = actions.find(({ payload: [status] }) => status === 'connecting');
    expect(connecting).toBeDefined();
    expect(connecting!.payload[2]?.reconnectAttempts).toBe(14);
    task.cancel();
    await task.toPromise();
  });

  it('backs off repeated disconnected churn with exponential timing', async () => {
    const transport = { mode: 'external-uds' as const, target: '/tmp/intentd.sock' };
    invoke.mockImplementation((channel: string) => {
      if (channel === BACKEND.GET_STATUS)
        return Promise.resolve({ status: 'disconnected', transport });
      return Promise.resolve(undefined);
    });
    const { dispatched, task } = startHealthSaga();
    await settle();

    statusHandler!({ status: 'disconnected', transport });
    await settle();
    expect(statusActions(dispatched)).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(999);
    expect(statusActions(dispatched)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(statusActions(dispatched)).toHaveLength(2);

    statusHandler!({ status: 'disconnected', transport });
    await settle();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(statusActions(dispatched)).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    await settle();

    expect(statusActions(dispatched)).toEqual([
      connectionStatusChanged('disconnected', transport, {
        sidecarGaveUp: undefined,
        sidecarStartupFailed: undefined,
        reason: undefined,
      }),
      connectionStatusChanged('disconnected', transport, {
        sidecarGaveUp: undefined,
        sidecarStartupFailed: undefined,
        reason: undefined,
      }),
      connectionStatusChanged('disconnected', transport, {
        sidecarGaveUp: undefined,
        sidecarStartupFailed: undefined,
        reason: undefined,
      }),
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('processes non-disconnected transitions immediately and resets backoff', async () => {
    const transport = { mode: 'external-uds' as const, target: '/tmp/intentd.sock' };
    invoke.mockImplementation((channel: string) => {
      if (channel === BACKEND.GET_STATUS)
        return Promise.resolve({ status: 'disconnected', transport });
      return Promise.resolve(undefined);
    });
    const { dispatched, task } = startHealthSaga();
    await settle();

    statusHandler!({ status: 'disconnected', transport });
    await settle();
    await vi.advanceTimersByTimeAsync(500);
    statusHandler!({ status: 'connected', transport });
    await settle();
    expect(statusActions(dispatched)).toEqual([
      connectionStatusChanged('disconnected', transport, {
        sidecarGaveUp: undefined,
        sidecarStartupFailed: undefined,
        reason: undefined,
      }),
      connectionStatusChanged('connected', transport, {
        sidecarGaveUp: undefined,
        sidecarStartupFailed: undefined,
        reason: undefined,
      }),
    ]);
    await vi.advanceTimersByTimeAsync(1_000);
    await settle();
    expect(statusActions(dispatched)).toHaveLength(2);

    statusHandler!({ status: 'disconnected', transport });
    await settle();
    expect(statusActions(dispatched)).toHaveLength(3);

    statusHandler!({ status: 'disconnected', transport });
    await settle();
    await vi.advanceTimersByTimeAsync(999);
    expect(statusActions(dispatched)).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    await settle();

    expect(statusActions(dispatched)).toEqual([
      connectionStatusChanged('disconnected', transport, {
        sidecarGaveUp: undefined,
        sidecarStartupFailed: undefined,
        reason: undefined,
      }),
      connectionStatusChanged('connected', transport, {
        sidecarGaveUp: undefined,
        sidecarStartupFailed: undefined,
        reason: undefined,
      }),
      connectionStatusChanged('disconnected', transport, {
        sidecarGaveUp: undefined,
        sidecarStartupFailed: undefined,
        reason: undefined,
      }),
      connectionStatusChanged('disconnected', transport, {
        sidecarGaveUp: undefined,
        sidecarStartupFailed: undefined,
        reason: undefined,
      }),
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('runs a non-overlapping recurring poll and cancels its timer and status listener', async () => {
    let resolvePoll!: (value: SystemStatusWirePayload) => void;
    mocks.backendRequest.mockImplementation((method: string) => {
      if (method !== 'system.status') return Promise.resolve({ running: false });
      return new Promise((resolve) => {
        resolvePoll = resolve;
      });
    });
    const { task } = startHealthSaga();
    await settle();
    expect(mocks.backendRequest).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(mocks.backendRequest).toHaveBeenCalledTimes(1);
    resolvePoll(statusPayload);
    await settle();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.backendRequest).toHaveBeenCalledTimes(2);

    task.cancel();
    await task.toPromise();
    expect(offById).toHaveBeenCalledWith(BACKEND.STATUS, 'listener-status');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(mocks.backendRequest).toHaveBeenCalledTimes(2);
  });

  it('coalesces unsloth polls and settles stop failure state', async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    mocks.backendRequest.mockImplementation((method: string) => {
      if (method === 'system.status') return Promise.resolve(statusPayload);
      if (method === 'unsloth.status') {
        return new Promise((resolve) => resolvers.push(resolve));
      }
      if (method === 'unsloth.stop') return Promise.reject(new Error('stop failed'));
      return Promise.reject(new Error('unexpected'));
    });
    const { input, dispatched, task } = startHealthSaga();
    await settle();
    input.put(pollUnslothStatus());
    input.put(pollUnslothStatus());
    input.put(pollUnslothStatus());
    await settle();
    expect(
      mocks.backendRequest.mock.calls.filter(([method]) => method === 'unsloth.status'),
    ).toHaveLength(1);
    resolvers[0]({ running: true });
    await settle();
    expect(
      mocks.backendRequest.mock.calls.filter(([method]) => method === 'unsloth.status'),
    ).toHaveLength(2);

    input.put(stopUnslothRequested());
    await settle();
    expect(dispatched).toContainEqual(stopUnslothFailed('stop failed'));
    task.cancel();
    await task.toPromise();
  });

  it('runs sidecar controls and cancels an in-flight log fetch without a late success', async () => {
    let spawnCount = 0;
    let resolveLateLog!: (value: unknown) => void;
    invoke.mockImplementation((channel: string) => {
      if (channel === BACKEND.GET_STATUS) return Promise.resolve({ status: 'connected' });
      if (channel === BACKEND.SPAWN_SIDECAR) {
        spawnCount += 1;
        return Promise.resolve(
          spawnCount === 1 ? { ok: true, spawned: true } : { ok: false, reason: 'missing' },
        );
      }
      if (channel === BACKEND.GET_SIDECAR_RUN_LOG) {
        return new Promise((resolve) => {
          resolveLateLog = resolve;
        });
      }
      return Promise.resolve(undefined);
    });
    const { input, dispatched, task } = startHealthSaga();
    await settle();

    input.put(spawnSidecarRequested());
    input.put(spawnSidecarRequested());
    input.put(fetchSidecarRunLogRequested());
    await settle();
    expect(dispatched).toContainEqual(spawnSidecarFailed('missing'));
    expect(
      dispatched.some(
        (action) => (action as { type?: string }).type === fetchSidecarRunLogSucceeded.type,
      ),
    ).toBe(false);

    task.cancel();
    await task.toPromise();
    resolveLateLog({ path: '/tmp/intentd.log', content: 'late', exists: true });
    await settle();
    expect(
      dispatched.filter(
        (action) => (action as { type?: string }).type === fetchSidecarRunLogSucceeded.type,
      ),
    ).toHaveLength(0);
  });

  it('routes remote-window recovery through the open-local-and-spawn channel', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === BACKEND.GET_STATUS) return { status: 'connected' };
      if (channel === BACKEND.OPEN_LOCAL_AND_SPAWN) return { ok: true, spawned: true };
      return undefined;
    });
    const { input, dispatched, task } = startHealthSaga();
    await settle();

    input.put(openLocalAndSpawnRequested());
    await settle();

    expect(invoke).toHaveBeenCalledWith(BACKEND.OPEN_LOCAL_AND_SPAWN);
    // The initiating window keeps its own (dead) backend, so no 'connected'
    // status event ever clears the pending flag — the success action must.
    expect(dispatched).toContainEqual(openLocalAndSpawnSucceeded());
    task.cancel();
    await task.toPromise();
  });

  it('does not dispatch the open-local success action when the open fails', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === BACKEND.GET_STATUS) return { status: 'connected' };
      if (channel === BACKEND.OPEN_LOCAL_AND_SPAWN) return { ok: false, reason: 'deadline' };
      return undefined;
    });
    const { input, dispatched, task } = startHealthSaga();
    await settle();

    input.put(openLocalAndSpawnRequested());
    await settle();

    expect(dispatched).toContainEqual(spawnSidecarFailed('deadline'));
    expect(
      dispatched.some(
        (action) => (action as { type?: string }).type === openLocalAndSpawnSucceeded.type,
      ),
    ).toBe(false);
    task.cancel();
    await task.toPromise();
  });

  it('dispatches failure then degradation when a poll fails while healthy', async () => {
    mocks.backendRequest.mockRejectedValue(new Error('timeout'));
    const dispatched: unknown[] = [];
    await runSaga(
      {
        dispatch: (action) => dispatched.push(action),
        getState: () => ({ daemonHealth: { health: 'healthy' } }),
      },
      pollSystemStatusSaga,
    ).toPromise();
    expect(dispatched).toEqual([systemStatusFailure(), heartbeatFailed()]);
  });
});
