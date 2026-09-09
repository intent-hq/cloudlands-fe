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
import { connectLinear, initializeLinearAuth, logoutLinear } from '../linear-auth-slice';
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
  const task = runSaga({ channel, dispatch: (action) => dispatched.push(action) }, linearAuthSaga);
  return { channel, dispatched, task };
}

describe('linearAuthSaga', () => {
  beforeEach(() => vi.clearAllMocks());

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
    expect(run.dispatched).toEqual([
      { type: 'linearAuth/setError', payload: [null] },
      { type: 'linearAuth/setIsAuthenticating', payload: [true] },
      {
        type: 'linearAuth/setAuthState',
        payload: {
          isAuthenticated: true,
          requiresDaemonAuth: false,
          oauthUrl: null,
        },
      },
      { type: 'linearAuth/setIsAuthenticating', payload: [false] },
    ]);
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
    expect(run.dispatched).toEqual([
      {
        type: 'linearAuth/setAuthState',
        payload: {
          isAuthenticated: true,
          requiresDaemonAuth: false,
          oauthUrl: null,
        },
      },
      { type: 'linearAuth/setError', payload: [m.linearAuth_service_envKeyStillActive_error()] },
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('runs overlapping connects independently and reports the rejected key exactly', async () => {
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
    resolveFirst();
    await settle();

    expect(mocks.update.mock.calls).toEqual([
      [[{ path: 'linear.token', value: 'first' }]],
      [[{ path: 'linear.token', value: 'second' }]],
    ]);
    expect(run.dispatched).toEqual([
      { type: 'linearAuth/setError', payload: [null] },
      { type: 'linearAuth/setIsAuthenticating', payload: [true] },
      { type: 'linearAuth/setError', payload: [null] },
      { type: 'linearAuth/setIsAuthenticating', payload: [true] },
      {
        type: 'linearAuth/setAuthState',
        payload: {
          isAuthenticated: true,
          requiresDaemonAuth: false,
          oauthUrl: null,
        },
      },
      { type: 'linearAuth/setIsAuthenticating', payload: [false] },
      {
        type: 'linearAuth/setAuthState',
        payload: {
          isAuthenticated: false,
          requiresDaemonAuth: false,
          oauthUrl: null,
        },
      },
      { type: 'linearAuth/setError', payload: [m.linearAuth_service_keyRejected_error()] },
      { type: 'linearAuth/setIsAuthenticating', payload: [false] },
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('settles authentication state when storing the key throws', async () => {
    mocks.update.mockRejectedValue(new Error('settings unavailable'));
    const run = harness();
    run.channel.put(connectLinear('secret-key'));
    await settle();

    expect(run.dispatched).toEqual([
      { type: 'linearAuth/setError', payload: [null] },
      { type: 'linearAuth/setIsAuthenticating', payload: [true] },
      { type: 'linearAuth/setError', payload: ['settings unavailable'] },
      { type: 'linearAuth/setIsAuthenticating', payload: [false] },
    ]);
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
    expect(run.dispatched).toEqual([
      { type: 'linearAuth/setError', payload: ['reset unavailable'] },
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });
});
