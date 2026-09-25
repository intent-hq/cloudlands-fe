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
  setLinearAuthState,
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

  it('orders overlapping credential writes and reconciles each before its successor', async () => {
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
    await vi.waitFor(() => expect(run.state().operation?.status).toBe('failed'));
    expect(mocks.getAuthState).toHaveBeenCalledTimes(2);
    expect(run.state()).toMatchObject({
      isAuthenticated: false,
      error: m.linearAuth_service_keyRejected_error(),
      isAuthenticating: false,
      operation: { status: 'failed' },
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

  it('cancels only the owning consumer while reconciling the late key validation', async () => {
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
      isAuthenticated: true,
      isAuthenticating: false,
      error: null,
      operation: { status: 'cancelled' },
    });
    run.channel.put(consumeLinearAuth('connect'));
    expect(run.state().operation).toBeNull();
    run.task.cancel();
    await run.task.toPromise();
  });

  describe.each(['connect', 'logout'] as const)('%s reconciliation', (kind) => {
    const initialAuthenticated = kind === 'logout';
    const request = { requestId: 'write', consumerId: 'settings' };
    const action = () =>
      kind === 'connect' ? connectLinear('test-key', request) : logoutLinear(request);
    const writeMock = () => (kind === 'connect' ? mocks.update : mocks.reset);

    it.each([consumeLinearAuth, cancelLinearAuth])(
      'reconciles a pending write after %s without reviving the consumer',
      async (dismiss) => {
        const write = Promise.withResolvers<void>();
        writeMock().mockReturnValueOnce(write.promise);
        mocks.getAuthState.mockResolvedValue({
          isAuthenticated: !initialAuthenticated,
          requiresDaemonAuth: false,
        });
        const run = harness();
        run.channel.put(setLinearAuthState(initialAuthenticated, false, null));
        run.channel.put(action());
        expect(writeMock()).toHaveBeenCalledOnce();
        run.channel.put(dismiss('write'));
        write.resolve();
        await vi.waitFor(() => expect(run.state().isAuthenticated).toBe(!initialAuthenticated));
        expect(mocks.getAuthState.mock.calls).toEqual([[true]]);
        expect(run.state()).toMatchObject({ isAuthenticating: false, error: null });
        expect(run.state().operation).toEqual(
          dismiss === consumeLinearAuth ? null : { ...request, kind, status: 'cancelled' },
        );
        run.task.cancel();
        await run.task.toPromise();
      },
    );

    it('keeps the committed state if the superseding credential write fails', async () => {
      const write = Promise.withResolvers<void>();
      writeMock().mockReturnValueOnce(write.promise);
      mocks.update.mockRejectedValueOnce(new Error('replacement rejected'));
      mocks.getAuthState.mockResolvedValue({
        isAuthenticated: !initialAuthenticated,
        requiresDaemonAuth: false,
      });
      const run = harness();
      run.channel.put(setLinearAuthState(initialAuthenticated, false, null));
      run.channel.put(action());
      run.channel.put(connectLinear('replacement', { requestId: 'next', consumerId: 'picker' }));
      expect(mocks.update).toHaveBeenCalledTimes(kind === 'connect' ? 1 : 0);
      write.resolve();
      await vi.waitFor(() => expect(run.state().operation?.status).toBe('failed'));
      expect(run.state()).toMatchObject({
        isAuthenticated: !initialAuthenticated,
        isAuthenticating: false,
        error: 'replacement rejected',
        operation: { requestId: 'next', consumerId: 'picker', status: 'failed' },
      });
      expect(mocks.getAuthState.mock.calls).toEqual([[true]]);
      run.task.cancel();
      await run.task.toPromise();
    });

    it('discards a late status probe started after dismissal while the write is pending', async () => {
      const write = Promise.withResolvers<void>();
      const staleProbe = Promise.withResolvers<{
        isAuthenticated: boolean;
        requiresDaemonAuth: boolean;
      }>();
      writeMock().mockReturnValueOnce(write.promise);
      mocks.getAuthState.mockReturnValueOnce(staleProbe.promise).mockResolvedValueOnce({
        isAuthenticated: !initialAuthenticated,
        requiresDaemonAuth: false,
      });
      const run = harness();
      run.channel.put(setLinearAuthState(initialAuthenticated, false, null));
      run.channel.put(action());
      run.channel.put(consumeLinearAuth('write'));
      run.channel.put(initializeLinearAuth());
      expect(mocks.getAuthState).toHaveBeenCalledOnce();
      write.resolve();
      await vi.waitFor(() => expect(run.state().isAuthenticated).toBe(!initialAuthenticated));
      staleProbe.resolve({ isAuthenticated: initialAuthenticated, requiresDaemonAuth: true });
      await settle();
      expect(run.state()).toMatchObject({
        isAuthenticated: !initialAuthenticated,
        requiresDaemonAuth: false,
        error: null,
        operation: null,
      });
      run.task.cancel();
      await run.task.toPromise();
    });

    it('reconciles an unsuccessful validation without publishing an obsolete error', async () => {
      const validation = Promise.withResolvers<{
        isAuthenticated: boolean;
        requiresDaemonAuth: boolean;
      }>();
      writeMock().mockResolvedValueOnce(undefined);
      mocks.getAuthState.mockReturnValueOnce(validation.promise);
      const run = harness();
      run.channel.put(setLinearAuthState(!initialAuthenticated, false, null));
      run.channel.put(action());
      await vi.waitFor(() => expect(mocks.getAuthState).toHaveBeenCalledOnce());
      run.channel.put(consumeLinearAuth('write'));
      validation.resolve({ isAuthenticated: initialAuthenticated, requiresDaemonAuth: false });
      await settle();
      expect(run.state()).toMatchObject({
        isAuthenticated: initialAuthenticated,
        isAuthenticating: false,
        operation: null,
        error: null,
      });
      run.task.cancel();
      await run.task.toPromise();
    });
  });

  it('reconciles a cancelled logout when the reset succeeds but validation throws', async () => {
    const write = Promise.withResolvers<void>();
    mocks.reset.mockReturnValueOnce(write.promise);
    mocks.getAuthState.mockRejectedValueOnce(new Error('status unavailable'));
    const run = harness();
    run.channel.put(setLinearAuthState(true, false, null));
    run.channel.put(logoutLinear({ requestId: 'logout', consumerId: 'settings' }));
    run.channel.put(cancelLinearAuth('logout'));
    write.resolve();
    await vi.waitFor(() => expect(run.state().isAuthenticated).toBe(false));
    expect(run.state()).toMatchObject({
      requiresDaemonAuth: false,
      error: null,
      operation: { requestId: 'logout', status: 'cancelled' },
    });
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
