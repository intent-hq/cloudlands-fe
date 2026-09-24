import { runSaga, stdChannel } from 'redux-saga';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAuthState: vi.fn(),
  update: vi.fn(),
  reset: vi.fn(),
}));
vi.mock('$features/linear-auth/renderer/linear-auth.client', () => ({
  linearAuthClient: { getAuthState: mocks.getAuthState },
}));
vi.mock('$lib/client', () => ({
  appClient: { settings: { update: mocks.update, reset: mocks.reset } },
}));
vi.mock('$lib/utils/client-logger', () => ({ createLogger: () => ({ error: vi.fn() }) }));

import { m } from '$shared/paraglide/messages.js';
import {
  cancelLinearAuth,
  connectLinear,
  consumeLinearAuth,
  initializeLinearAuth,
  linearAuthReducer,
  logoutLinear,
  startLinearAuth,
} from '../linear-auth-slice';
import { linearAuthSaga } from './linear-auth-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function harness() {
  const channel = stdChannel();
  const dispatched: unknown[] = [];
  let state = linearAuthReducer.initialState;
  const dispatch = (action: Parameters<typeof linearAuthReducer>[1]) => {
    state = linearAuthReducer(state, action);
    dispatched.push(action);
    channel.put(action);
  };
  const task = runSaga(
    { channel, dispatch, getState: () => ({ linearAuth: state }) },
    linearAuthSaga,
  );
  return { channel: { put: dispatch }, dispatched, task, state: () => state };
}

describe('linearAuthSaga', () => {
  beforeEach(() => vi.resetAllMocks());

  it('stores the trimmed token with the exact settings request and re-probes status', async () => {
    mocks.update.mockResolvedValue(undefined);
    mocks.getAuthState.mockResolvedValue({
      isAuthenticated: true,
      requiresDaemonAuth: true,
      oauthUrl: 'wire-only',
    });
    const run = harness();
    run.channel.put(connectLinear('  lin-test-token  '));
    await settle();

    expect(mocks.update.mock.calls).toEqual([
      [[{ path: 'linear.token', value: 'lin-test-token' }]],
    ]);
    expect(mocks.getAuthState.mock.calls).toEqual([[true]]);
    expect(run.state()).toMatchObject({
      isAuthenticated: true,
      isAuthenticating: false,
      requiresDaemonAuth: false,
      operation: { status: 'succeeded' },
    });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('resets the exact token path and reports an environment token still active', async () => {
    mocks.reset.mockResolvedValue(undefined);
    mocks.getAuthState.mockResolvedValue({ isAuthenticated: true, requiresDaemonAuth: false });
    const run = harness();
    run.channel.put(logoutLinear());
    await settle();

    expect(mocks.reset.mock.calls).toEqual([['linear.token']]);
    expect(run.state()).toMatchObject({
      isAuthenticated: true,
      error: m.linearAuth_service_envKeyStillActive_error(),
      operation: { status: 'failed' },
    });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('orders overlapping credential writes and rejects stale completion', async () => {
    let resolveFirst!: () => void;
    mocks.update
      .mockReturnValueOnce(
        new Promise<void>((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockResolvedValueOnce(undefined);
    mocks.getAuthState
      .mockResolvedValueOnce({ isAuthenticated: true, requiresDaemonAuth: false })
      .mockResolvedValueOnce({ isAuthenticated: false, requiresDaemonAuth: false });
    const run = harness();
    run.channel.put(connectLinear('first'));
    await settle();
    run.channel.put(connectLinear('second'));
    await settle();
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(run.state().isAuthenticating).toBe(true);
    resolveFirst();
    await settle();

    expect(mocks.update.mock.calls).toEqual([
      [[{ path: 'linear.token', value: 'first' }]],
      [[{ path: 'linear.token', value: 'second' }]],
    ]);
    expect(mocks.getAuthState).toHaveBeenCalledTimes(1);
    expect(run.state()).toMatchObject({
      isAuthenticated: true,
      error: null,
      isAuthenticating: false,
      operation: { status: 'succeeded' },
    });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('settles authentication state when storing the key throws', async () => {
    mocks.update.mockRejectedValue(new Error('settings unavailable'));
    const run = harness();
    run.channel.put(connectLinear('secret-key'));
    await settle();

    expect(run.state()).toMatchObject({
      error: 'settings unavailable',
      isAuthenticating: false,
      operation: { status: 'failed' },
    });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('matches probe and logout failure handling exactly', async () => {
    mocks.getAuthState.mockRejectedValue(new Error('probe unavailable'));
    mocks.reset.mockRejectedValue(new Error('reset unavailable'));
    const run = harness();
    run.channel.put(initializeLinearAuth());
    await settle();
    run.channel.put(logoutLinear());
    await settle();

    expect(mocks.getAuthState.mock.calls).toEqual([[true]]);
    expect(mocks.reset.mock.calls).toEqual([['linear.token']]);
    expect(run.state()).toMatchObject({
      error: 'reset unavailable',
      operation: { status: 'failed' },
    });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('cancels only the owning consumer and ignores the late key validation', async () => {
    let resolve!: (value: unknown) => void;
    mocks.update.mockResolvedValue(undefined);
    mocks.getAuthState.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const run = harness();
    run.channel.put(connectLinear('test-key', { requestId: 'connect', consumerId: 'panel' }));
    await settle();
    run.channel.put(cancelLinearAuth('unrelated'));
    expect(run.state().operation?.status).toBe('pending');
    run.channel.put(cancelLinearAuth('connect'));
    resolve({ isAuthenticated: true, requiresDaemonAuth: false });
    await settle();
    expect(run.state()).toMatchObject({
      isAuthenticated: false,
      isAuthenticating: false,
      operation: { status: 'cancelled' },
    });
    run.channel.put(consumeLinearAuth('connect'));
    expect(run.state().operation).toBeNull();
    run.task.cancel();
    await run.task.toPromise();
  });

  it('keeps reset behind the in-flight write and cannot resurrect auth after logout', async () => {
    let resolve!: () => void;
    mocks.update.mockReturnValue(
      new Promise<void>((done) => {
        resolve = done;
      }),
    );
    mocks.reset.mockResolvedValue(undefined);
    mocks.getAuthState.mockResolvedValue({ isAuthenticated: false, requiresDaemonAuth: false });
    const run = harness();
    run.channel.put(connectLinear('test-key'));
    run.channel.put(logoutLinear());
    expect(mocks.reset).not.toHaveBeenCalled();
    resolve();
    await settle();
    expect(mocks.reset.mock.calls).toEqual([['linear.token']]);
    expect(run.state()).toMatchObject({
      isAuthenticated: false,
      operation: { kind: 'logout', status: 'succeeded' },
    });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('shares the legacy start status owner and makes reads latest-wins', async () => {
    let resolve!: (value: unknown) => void;
    mocks.getAuthState
      .mockReturnValueOnce(
        new Promise((done) => {
          resolve = done;
        }),
      )
      .mockResolvedValueOnce({ isAuthenticated: false, requiresDaemonAuth: true });
    const run = harness();
    run.channel.put(initializeLinearAuth());
    run.channel.put(startLinearAuth());
    await settle();
    resolve({ isAuthenticated: true, requiresDaemonAuth: false });
    await settle();
    expect(run.state()).toMatchObject({ isAuthenticated: false, requiresDaemonAuth: true });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('settles pending work on saga teardown without publishing late results', async () => {
    let resolve!: () => void;
    mocks.update.mockReturnValue(
      new Promise<void>((done) => {
        resolve = done;
      }),
    );
    const run = harness();
    run.channel.put(connectLinear('test-key'));
    run.task.cancel();
    await run.task.toPromise();
    resolve();
    await settle();
    expect(mocks.getAuthState).not.toHaveBeenCalled();
    expect(run.state().operation?.status).toBe('cancelled');
  });
});
