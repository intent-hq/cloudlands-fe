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

import { BackendError } from '$lib/client/live/backend-transport-types';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import {
  connectionStatusChanged,
  daemonHealthReducer,
  fetchSidecarRunLogRequested,
  fetchSidecarRunLogSucceeded,
  heartbeatFailed,
  initialState,
  openLocalAndSpawnRequested,
  openLocalAndSpawnSucceeded,
  pollUnslothStatus,
  spawnSidecarFailed,
  spawnSidecarRequested,
  stopUnslothFailed,
  stopUnslothRequested,
  systemStatusFailure,
  systemStatusSuccess,
} from '../daemon-health-slice';
import type { DaemonHealthState, SystemStatusWirePayload } from '../daemon-health-types';
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

/**
 * Same wiring as `startHealthSaga`, but every dispatched action also runs
 * through the production reducer so race regressions observe real state.
 */
function startHealthSagaWithReducer() {
  const input = stdChannel();
  let state = { daemonHealth: initialState };
  const dispatch = (action: unknown) => {
    state = { daemonHealth: daemonHealthReducer(state.daemonHealth, action as never) };
    input.put(action as never);
    return action;
  };
  const task = runSaga({ channel: input, dispatch, getState: () => state }, daemonHealthSaga);
  return { task, getState: (): DaemonHealthState => state.daemonHealth };
}

interface DeferredPoll {
  resolve: (value: SystemStatusWirePayload) => void;
  reject: (error: unknown) => void;
}

/** Every system.status request becomes a manually settled promise. */
function deferSystemStatusPolls() {
  const polls: DeferredPoll[] = [];
  mocks.backendRequest.mockImplementation((method: string) => {
    if (method !== 'system.status') return Promise.resolve({ running: false });
    return new Promise<SystemStatusWirePayload>((resolve, reject) => {
      polls.push({ resolve, reject });
    });
  });
  return polls;
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

  it('forwards daemonUpdateDisconnectedAt from the status payload into the action extras', async () => {
    const transport = { mode: 'external-uds' as const, target: '/tmp/intentd.sock' };
    const disconnectedAt = new Date('2026-09-04T10:00:00.000Z').getTime();
    const { dispatched, task } = startHealthSaga();
    await settle();
    statusHandler!({
      status: 'disconnected',
      transport,
      daemonUpdateDisconnectedAt: disconnectedAt,
    });
    await settle();

    const actions = statusActions(dispatched) as Array<{
      payload: [string, unknown, { daemonUpdateDisconnectedAt?: number } | undefined];
    }>;
    const disconnected = actions.find(({ payload: [status] }) => status === 'disconnected');
    expect(disconnected).toBeDefined();
    expect(disconnected!.payload[2]?.daemonUpdateDisconnectedAt).toBe(disconnectedAt);
    // The boot snapshot carried no marker: nothing is invented for it.
    const connected = actions.find(({ payload: [status] }) => status === 'connected');
    expect(connected!.payload[2]?.daemonUpdateDisconnectedAt).toBeUndefined();
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

  describe('poll ↔ connection lifecycle binding (#4439)', () => {
    const udsTransport = { mode: 'external-uds' as const };
    const tcpTransport = { mode: 'tcp' as const, target: 'intent1:7331' };
    const oldPayload: SystemStatusWirePayload = {
      ...statusPayload,
      hostname: 'old-daemon',
      host: { os: 'macos', arch: 'aarch64', hasDisplay: true, locality: 'local' },
    };
    const newPayload: SystemStatusWirePayload = {
      ...statusPayload,
      hostname: 'new-daemon',
      host: { os: 'linux', arch: 'x86_64', hasDisplay: false, locality: 'remote' },
    };

    /** Boot to a healthy connection A with its first poll still pending. */
    async function bootWithPendingPoll(transport = udsTransport) {
      invoke.mockImplementation(async (channel: string) => {
        if (channel === BACKEND.GET_STATUS) return { status: 'connected', transport };
        return undefined;
      });
      const polls = deferSystemStatusPolls();
      const harness = startHealthSagaWithReducer();
      await settle();
      expect(harness.getState().health).toBe('healthy');
      expect(polls).toHaveLength(1);
      return { ...harness, polls };
    }

    it('boots with a single poll bound to the first known connection', async () => {
      const { task, polls, getState } = await bootWithPendingPoll();
      polls[0].resolve(oldPayload);
      await settle();
      expect(mocks.backendRequest).toHaveBeenCalledTimes(1);
      expect(getState().stats?.hostname).toBe('old-daemon');
      expect(getState().lastUpdated).not.toBeNull();
      task.cancel();
      await task.toPromise();
    });

    it('discards a pre-disconnect poll that rejects after the reconnect — B stays healthy', async () => {
      const { task, polls, getState } = await bootWithPendingPoll();
      statusHandler!({ status: 'disconnected', transport: udsTransport });
      statusHandler!({ status: 'connected', transport: udsTransport });
      await settle();
      expect(getState().health).toBe('healthy');

      polls[0].reject(new BackendError({ code: 'TIMEOUT', message: 'timed out' }));
      await settle();
      expect(getState().health).toBe('healthy');
      expect(getState().statusCheckFailure).toBeNull();
      task.cancel();
      await task.toPromise();
    });

    it('discards a pre-disconnect poll that rejects after reconnecting through connecting', async () => {
      const { task, polls, getState } = await bootWithPendingPoll();
      statusHandler!({ status: 'disconnected', transport: udsTransport });
      statusHandler!({ status: 'connecting', transport: udsTransport });
      statusHandler!({ status: 'connected', transport: udsTransport });
      await settle();

      polls[0].reject(new Error('socket closed'));
      await settle();
      expect(getState().health).toBe('healthy');
      expect(getState().statusCheckFailure).toBeNull();
      task.cancel();
      await task.toPromise();
    });

    it('discards a late success while down — no stats, freshness, or health leak', async () => {
      const { task, polls, getState } = await bootWithPendingPoll();
      statusHandler!({ status: 'disconnected', transport: udsTransport });
      await settle();
      const down = getState();
      expect(down.health).toBe('down');

      polls[0].resolve(oldPayload);
      await settle();
      expect(getState()).toBe(down);
      task.cancel();
      await task.toPromise();
    });

    it('discards a pre-switch poll that resolves after a direct transport switch', async () => {
      const { task, polls, getState } = await bootWithPendingPoll();
      statusHandler!({ status: 'connected', transport: tcpTransport });
      await settle();
      expect(getState().stats).toBeNull();
      expect(getState().transport).toEqual(tcpTransport);

      polls[0].resolve(oldPayload);
      await settle();
      expect(getState().stats).toBeNull();
      expect(getState().lastUpdated).toBeNull();
      expect(getState().hostLocality).toBeNull();
      task.cancel();
      await task.toPromise();
    });

    it('re-polls the new connection right away when the switch interrupted a poll, and the old result cannot overwrite the fresh snapshot', async () => {
      const { task, polls, getState } = await bootWithPendingPoll();
      statusHandler!({ status: 'connected', transport: tcpTransport });
      await settle();
      expect(polls).toHaveLength(2);

      polls[1].resolve(newPayload);
      await settle();
      expect(getState().stats?.hostname).toBe('new-daemon');
      expect(getState().stats?.transport).toEqual(tcpTransport);
      expect(getState().hostLocality).toBe('remote');
      const fresh = getState();

      polls[0].resolve(oldPayload);
      await settle();
      expect(getState()).toBe(fresh);
      task.cancel();
      await task.toPromise();
    });

    it('still polls on cadence when the boot snapshot rejects and no status is ever pushed', async () => {
      invoke.mockImplementation(async (channel: string) => {
        if (channel === BACKEND.GET_STATUS) throw new Error('main not ready');
        return undefined;
      });
      const polls = deferSystemStatusPolls();
      const { task, getState } = startHealthSagaWithReducer();
      await settle();
      expect(polls).toHaveLength(1);
      expect(getState().health).toBe('down');

      polls[0].resolve(oldPayload);
      await settle();
      expect(getState().stats?.hostname).toBe('old-daemon');
      expect(getState().health).toBe('down');

      await vi.advanceTimersByTimeAsync(10_000);
      expect(polls).toHaveLength(2);
      polls[1].resolve(oldPayload);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(polls).toHaveLength(3);

      statusHandler!({ status: 'connected', transport: udsTransport });
      await settle();
      expect(getState().health).toBe('healthy');
      expect(polls).toHaveLength(4);
      task.cancel();
      await task.toPromise();
    });

    it('treats repeated same-connection connected notifications as metadata — one request, valid result applied', async () => {
      const { task, polls, getState } = await bootWithPendingPoll();
      const before = getState().connectionGeneration;
      statusHandler!({
        status: 'connected',
        transport: { ...udsTransport, updateSupported: true },
      });
      statusHandler!({
        status: 'connected',
        transport: { ...udsTransport, updateSupported: true },
      });
      statusHandler!({
        status: 'connected',
        transport: { ...udsTransport, updateSupported: true },
      });
      await settle();
      expect(polls).toHaveLength(1);
      expect(mocks.backendRequest).toHaveBeenCalledTimes(1);
      expect(getState().connectionGeneration).toBe(before);
      expect(getState().transport).toEqual({ ...udsTransport, updateSupported: true });

      polls[0].resolve(oldPayload);
      await settle();
      expect(getState().stats?.hostname).toBe('old-daemon');
      expect(getState().stats?.transport).toEqual({ ...udsTransport, updateSupported: true });
      expect(getState().lastUpdated).not.toBeNull();
      expect(getState().polling).toBe(false);

      await vi.advanceTimersByTimeAsync(10_000);
      expect(polls).toHaveLength(2);
      polls[1].reject(new BackendError({ code: 'TIMEOUT', message: 'timed out' }));
      await settle();
      expect(getState().health).toBe('degraded');
      await vi.advanceTimersByTimeAsync(10_000);
      expect(polls).toHaveLength(3);
      polls[2].resolve(oldPayload);
      await settle();
      expect(getState().health).toBe('healthy');
      task.cancel();
      await task.toPromise();
    });

    it('keeps same-connection degrade → recovery and the poll cadence intact', async () => {
      const { task, polls, getState } = await bootWithPendingPoll();
      polls[0].reject(new BackendError({ code: 'TIMEOUT', message: 'timed out' }));
      await settle();
      expect(getState().health).toBe('degraded');
      expect(getState().statusCheckFailure?.kind).toBe('timeout');

      await vi.advanceTimersByTimeAsync(10_000);
      expect(polls).toHaveLength(2);
      polls[1].resolve(oldPayload);
      await settle();
      expect(getState().health).toBe('healthy');
      expect(getState().statusCheckFailure).toBeNull();
      expect(getState().stats?.hostname).toBe('old-daemon');

      await vi.advanceTimersByTimeAsync(10_000);
      expect(polls).toHaveLength(3);
      task.cancel();
      await task.toPromise();
    });
  });

  describe('pollSystemStatusSaga failure context (#4439)', () => {
    const generation = 3;

    async function runPoll() {
      const dispatched: unknown[] = [];
      await runSaga(
        {
          dispatch: (action) => dispatched.push(action),
          getState: () => ({
            daemonHealth: { health: 'healthy', connectionGeneration: generation },
          }),
        },
        pollSystemStatusSaga,
      ).toPromise();
      return dispatched;
    }

    beforeEach(() => {
      vi.setSystemTime(new Date('2026-09-05T10:00:00.000Z'));
    });

    it('sends the unchanged system.status request', async () => {
      mocks.backendRequest.mockResolvedValue(statusPayload);
      await runPoll();
      expect(mocks.backendRequest).toHaveBeenCalledWith('system.status');
    });

    it('stamps a success with the connection generation captured before the request', async () => {
      mocks.backendRequest.mockResolvedValue(statusPayload);
      expect(await runPoll()).toEqual([
        systemStatusSuccess(statusPayload, '2026-09-05T10:00:00.000Z', generation),
      ]);
    });

    it('reports a generic status-check failure with the failure time', async () => {
      mocks.backendRequest.mockRejectedValue(
        new BackendError({ code: 'TRANSPORT_ERROR', message: 'socket closed at /tmp/x.sock' }),
      );
      expect(await runPoll()).toEqual([
        systemStatusFailure(
          { kind: 'status-check-failed', failedAt: '2026-09-05T10:00:00.000Z' },
          generation,
        ),
      ]);
    });

    it('classifies a transport-tagged timeout as a timeout', async () => {
      mocks.backendRequest.mockRejectedValue(
        new BackendError({ code: 'TIMEOUT', message: 'JSON-RPC request timed out: system.status' }),
      );
      expect(await runPoll()).toEqual([
        systemStatusFailure({ kind: 'timeout', failedAt: '2026-09-05T10:00:00.000Z' }, generation),
      ]);
    });

    it('never guesses a timeout from an untagged error message', async () => {
      mocks.backendRequest.mockRejectedValue(
        new Error('JSON-RPC request timed out: system.status'),
      );
      expect(await runPoll()).toEqual([
        systemStatusFailure(
          { kind: 'status-check-failed', failedAt: '2026-09-05T10:00:00.000Z' },
          generation,
        ),
      ]);
    });

    it('never puts the raw error or its message into the dispatched action', async () => {
      mocks.backendRequest.mockRejectedValue(new Error('token=super-secret'));
      const [action] = await runPoll();
      expect(JSON.stringify(action)).not.toContain('super-secret');
      expect(dispatchedFailurePayload(action)).toEqual({
        kind: 'status-check-failed',
        failedAt: '2026-09-05T10:00:00.000Z',
      });
    });

    it('does not dispatch a separate heartbeat degradation — the failure action carries it', async () => {
      mocks.backendRequest.mockRejectedValue(new Error('boom'));
      const dispatched = await runPoll();
      expect(
        dispatched.some((action) => (action as { type?: string }).type === heartbeatFailed.type),
      ).toBe(false);
    });
  });
});

function dispatchedFailurePayload(action: unknown) {
  return (action as { payload: unknown[] }).payload[0];
}
