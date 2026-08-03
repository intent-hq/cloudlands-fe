import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => ({
  backendRequest: vi.fn(),
  toastWarning: vi.fn(),
}));

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: mocks.backendRequest,
}));
vi.mock('$lib/components/ui/toast', () => ({
  toast: { warning: mocks.toastWarning },
}));

import { IPC_CHANNELS } from '$shared/ipc-registry';
import {
  connectionStatusChanged,
  fetchSidecarRunLogRequested,
  fetchSidecarRunLogSucceeded,
  heartbeatFailed,
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
      connectionStatusChanged('connected', {
        mode: 'external-uds',
        versionMismatch: true,
        daemonVersion: '2.0.0',
      }, { sidecarGaveUp: undefined, sidecarStartupFailed: undefined, reason: undefined }),
      connectionStatusChanged('disconnected', {
        mode: 'external-uds',
        versionMismatch: true,
        daemonVersion: 'v2.0.0',
      }, { sidecarGaveUp: undefined, sidecarStartupFailed: undefined, reason: 'restart' }),
    ]);
    expect(mocks.backendRequest).toHaveBeenCalledWith('system.status');
    expect(mocks.toastWarning).toHaveBeenCalledTimes(1);
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

  it('cancels and resets disconnected backoff on meaningful status changes', async () => {
    const transport = { mode: 'external-uds' as const, target: '/tmp/intentd.sock' };
    const newTransport = { mode: 'external-uds' as const, target: '/tmp/intentd-next.sock' };
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
    statusHandler!({ status: 'connected', reconnected: true, transport });
    statusHandler!({ status: 'connecting', transport });
    await settle();
    await vi.advanceTimersByTimeAsync(1_000);
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
      connectionStatusChanged('connected', transport, {
        sidecarGaveUp: undefined,
        sidecarStartupFailed: undefined,
        reason: undefined,
      }),
      connectionStatusChanged('connecting', transport, {
        sidecarGaveUp: undefined,
        sidecarStartupFailed: undefined,
        reason: undefined,
      }),
    ]);

    statusHandler!({ status: 'disconnected', transport, reason: 'lost' });
    statusHandler!({ status: 'disconnected', transport: newTransport });
    statusHandler!({
      status: 'disconnected',
      transport: newTransport,
      sidecarGaveUp: true,
      reason: 'restart limit',
    });
    await settle();
    await vi.advanceTimersByTimeAsync(2_000);

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
      connectionStatusChanged('connected', transport, {
        sidecarGaveUp: undefined,
        sidecarStartupFailed: undefined,
        reason: undefined,
      }),
      connectionStatusChanged('connecting', transport, {
        sidecarGaveUp: undefined,
        sidecarStartupFailed: undefined,
        reason: undefined,
      }),
      connectionStatusChanged('disconnected', transport, {
        sidecarGaveUp: undefined,
        sidecarStartupFailed: undefined,
        reason: 'lost',
      }),
      connectionStatusChanged('disconnected', newTransport, {
        sidecarGaveUp: undefined,
        sidecarStartupFailed: undefined,
        reason: undefined,
      }),
      connectionStatusChanged('disconnected', newTransport, {
        sidecarGaveUp: true,
        sidecarStartupFailed: undefined,
        reason: 'restart limit',
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
    expect(mocks.backendRequest.mock.calls.filter(([method]) => method === 'unsloth.status')).toHaveLength(1);
    resolvers[0]({ running: true });
    await settle();
    expect(mocks.backendRequest.mock.calls.filter(([method]) => method === 'unsloth.status')).toHaveLength(2);

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
        (action) =>
          (action as { type?: string }).type === fetchSidecarRunLogSucceeded.type,
      ),
    ).toBe(false);

    task.cancel();
    await task.toPromise();
    resolveLateLog({ path: '/tmp/intentd.log', content: 'late', exists: true });
    await settle();
    expect(
      dispatched.filter(
        (action) =>
          (action as { type?: string }).type === fetchSidecarRunLogSucceeded.type,
      ),
    ).toHaveLength(0);
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
