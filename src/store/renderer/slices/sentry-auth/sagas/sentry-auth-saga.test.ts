import { runSaga, stdChannel } from 'redux-saga';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAuthState: vi.fn(),
  saveConfig: vi.fn(),
  fetchProjects: vi.fn(),
  logout: vi.fn(),
}));
vi.mock('$features/sentry-auth/renderer/sentry-auth.client', () => ({
  sentryAuthClient: mocks,
}));
vi.mock('$lib/utils/client-logger', () => ({ createLogger: () => ({ error: vi.fn() }) }));

import {
  cancelSentryAuth,
  connectSentry,
  consumeSentryAuth,
  initializeSentryAuth,
  logoutSentry,
  sentryAuthReducer,
} from '../sentry-auth-slice';
import { sentryAuthSaga } from './sentry-auth-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function harness() {
  const channel = stdChannel();
  const dispatched: unknown[] = [];
  let state = sentryAuthReducer.initialState;
  const dispatch = (action: Parameters<typeof sentryAuthReducer>[1]) => {
    state = sentryAuthReducer(state, action);
    dispatched.push(action);
    channel.put(action);
  };
  const task = runSaga(
    { channel, dispatch, getState: () => ({ sentryAuth: state }) },
    sentryAuthSaga,
  );
  return { channel: { put: dispatch }, dispatched, task, state: () => state };
}

describe('sentryAuthSaga', () => {
  beforeEach(() => vi.resetAllMocks());

  it('connects with exact arguments and strips wire-only project fields', async () => {
    mocks.saveConfig.mockResolvedValue({ success: true, organizationName: 'Acme Inc' });
    mocks.fetchProjects.mockResolvedValue([
      {
        id: '1',
        slug: 'web',
        name: 'Web',
        platform: 'javascript',
        isMember: true,
        dateCreated: 'wire-only',
      },
    ]);
    const run = harness();
    run.channel.put(connectSentry('acme', 'sentry-test-token'));
    await settle();

    expect(mocks.saveConfig.mock.calls).toEqual([['acme', 'sentry-test-token']]);
    expect(mocks.fetchProjects.mock.calls).toEqual([[]]);
    expect(run.state()).toMatchObject({
      isAuthenticated: true,
      organization: 'acme',
      isConnecting: false,
      isLoadingProjects: false,
      operation: { status: 'succeeded' },
    });
    expect(run.state().projects).toEqual([
      { id: '1', slug: 'web', name: 'Web', platform: 'javascript', isMember: true },
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('maps status exactly and settles logout', async () => {
    mocks.getAuthState.mockResolvedValue({
      isAuthenticated: true,
      organization: 'acme',
      error: undefined,
      wireOnly: 'drop',
    });
    mocks.logout.mockResolvedValue(undefined);
    const run = harness();
    run.channel.put(initializeSentryAuth());
    await settle();
    run.channel.put(logoutSentry());
    await settle();

    expect(mocks.getAuthState.mock.calls).toEqual([[]]);
    expect(mocks.logout.mock.calls).toEqual([[]]);
    expect(run.state()).toMatchObject({
      isAuthenticated: false,
      organization: null,
      operation: { kind: 'logout', status: 'succeeded' },
    });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('dispatches the exact failure and clears connecting when config is rejected', async () => {
    mocks.saveConfig.mockResolvedValue({ success: false, error: 'invalid token' });
    const run = harness();
    run.channel.put(connectSentry('acme', 'sentry-secret'));
    await settle();

    expect(mocks.fetchProjects.mock.calls).toEqual([]);
    expect(run.state()).toMatchObject({
      isConnecting: false,
      error: 'invalid token',
      operation: { status: 'failed' },
    });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('always clears project loading after a post-connect fetch failure', async () => {
    mocks.saveConfig.mockResolvedValue({ success: true });
    mocks.fetchProjects.mockRejectedValue(new Error('projects unavailable'));
    const run = harness();
    run.channel.put(connectSentry('acme', 'sentry-secret'));
    await settle();

    expect(run.state()).toMatchObject({
      isAuthenticated: true,
      isConnecting: false,
      isLoadingProjects: false,
      operation: { status: 'succeeded' },
    });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('serializes overlapping connects and ignores the superseded error', async () => {
    let resolveFirst!: (value: { success: false; error: string }) => void;
    mocks.saveConfig
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockResolvedValueOnce({ success: true });
    mocks.fetchProjects.mockResolvedValue([]);
    const run = harness();
    run.channel.put(connectSentry('first', 'first-secret'));
    await settle();
    run.channel.put(connectSentry('second', 'second-secret'));
    await settle();
    expect(mocks.saveConfig).toHaveBeenCalledTimes(1);
    resolveFirst({ success: false, error: 'first rejected' });
    await settle();

    expect(mocks.saveConfig.mock.calls).toEqual([
      ['first', 'first-secret'],
      ['second', 'second-secret'],
    ]);
    expect(run.state()).toMatchObject({
      isAuthenticated: true,
      organization: 'second',
      isConnecting: false,
      error: null,
      operation: { status: 'succeeded' },
    });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('matches middleware no-result handling for status and logout failures', async () => {
    mocks.getAuthState.mockRejectedValue(new Error('status unavailable'));
    mocks.logout.mockRejectedValue(new Error('logout unavailable'));
    const run = harness();
    run.channel.put(initializeSentryAuth());
    await settle();
    run.channel.put(logoutSentry());
    await settle();

    expect(mocks.getAuthState.mock.calls).toEqual([[]]);
    expect(mocks.logout.mock.calls).toEqual([[]]);
    expect(run.state()).toMatchObject({
      isAuthenticated: false,
      error: null,
      operation: { status: 'failed' },
    });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('holds busy state through project loading and cancels the owning request only', async () => {
    let resolve!: (value: unknown) => void;
    mocks.saveConfig.mockResolvedValue({ success: true });
    mocks.fetchProjects.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const run = harness();
    run.channel.put(
      connectSentry('acme', 'test-token', { requestId: 'save', consumerId: 'panel' }),
    );
    await settle();
    expect(run.state()).toMatchObject({ isConnecting: true, isLoadingProjects: true });
    run.channel.put(cancelSentryAuth('other'));
    expect(run.state().operation?.status).toBe('pending');
    run.channel.put(cancelSentryAuth('save'));
    resolve([{ id: 'stale', slug: 'old', name: 'Old' }]);
    await settle();
    expect(run.state()).toMatchObject({
      projects: [],
      isConnecting: false,
      isLoadingProjects: false,
      operation: { status: 'cancelled' },
    });
    run.channel.put(consumeSentryAuth('save'));
    expect(run.state().operation).toBeNull();
    run.task.cancel();
    await run.task.toPromise();
  });

  it('orders logout after config writes and finishes with the revoked resource state', async () => {
    let resolve!: (value: unknown) => void;
    mocks.saveConfig.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    mocks.logout.mockResolvedValue(undefined);
    const run = harness();
    run.channel.put(connectSentry('acme', 'test-token'));
    run.channel.put(logoutSentry());
    expect(mocks.logout).not.toHaveBeenCalled();
    resolve({ success: true });
    await settle();
    expect(mocks.logout).toHaveBeenCalledTimes(1);
    expect(mocks.fetchProjects).not.toHaveBeenCalled();
    expect(run.state()).toMatchObject({
      isAuthenticated: false,
      operation: { status: 'succeeded', kind: 'logout' },
    });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('invalidates an outstanding initialization when logout begins', async () => {
    let resolve!: (value: unknown) => void;
    mocks.getAuthState.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    mocks.logout.mockResolvedValue(undefined);
    const run = harness();
    run.channel.put(initializeSentryAuth());
    run.channel.put(logoutSentry());
    await settle();
    resolve({ isAuthenticated: true, organization: 'stale' });
    await settle();
    expect(run.state()).toMatchObject({ isAuthenticated: false, organization: null });
    run.task.cancel();
    await run.task.toPromise();
  });

  it.each([
    ['consumer dismissal', consumeSentryAuth, null],
    [
      'explicit cancellation',
      cancelSentryAuth,
      { requestId: 'save', consumerId: 'picker', kind: 'connect', status: 'cancelled' },
    ],
  ] as const)(
    'reconciles a successful save after %s without reviving the UI result',
    async (_, dismiss, expectedOperation) => {
      const save = Promise.withResolvers<{ success: boolean }>();
      mocks.saveConfig.mockReturnValue(save.promise);
      const run = harness();
      try {
        run.channel.put(
          connectSentry('acme', 'fixture-token', { requestId: 'save', consumerId: 'picker' }),
        );
        run.channel.put(dismiss('save'));
        save.resolve({ success: true });
        await settle();
        expect(run.state()).toMatchObject({
          isAuthenticated: true,
          organization: 'acme',
          isConnecting: false,
          isLoadingProjects: false,
          operation: expectedOperation,
        });
        expect(mocks.fetchProjects).not.toHaveBeenCalled();
      } finally {
        run.task.cancel();
        await run.task.toPromise();
      }
    },
  );

  it('invalidates a probe started after consumer dismissal when the save commits', async () => {
    const save = Promise.withResolvers<{ success: boolean }>();
    const probe = Promise.withResolvers<{ isAuthenticated: boolean; organization: null }>();
    mocks.saveConfig.mockReturnValue(save.promise);
    mocks.getAuthState.mockReturnValue(probe.promise);
    const run = harness();
    try {
      run.channel.put(
        connectSentry('acme', 'fixture-token', { requestId: 'save', consumerId: 'picker' }),
      );
      run.channel.put(consumeSentryAuth('save'));
      run.channel.put(initializeSentryAuth());
      expect(mocks.getAuthState).toHaveBeenCalledTimes(1);
      save.resolve({ success: true });
      await settle();
      probe.resolve({ isAuthenticated: false, organization: null });
      await settle();
      expect(run.state()).toMatchObject({
        isAuthenticated: true,
        organization: 'acme',
        operation: null,
      });
    } finally {
      run.task.cancel();
      await run.task.toPromise();
    }
  });

  it('keeps the committed organization when a superseding save fails', async () => {
    const save = Promise.withResolvers<{ success: boolean }>();
    mocks.saveConfig
      .mockReturnValueOnce(save.promise)
      .mockResolvedValueOnce({ success: false, error: 'replacement rejected' });
    const run = harness();
    try {
      run.channel.put(
        connectSentry('acme', 'fixture-token', { requestId: 'first', consumerId: 'picker' }),
      );
      run.channel.put(
        connectSentry('second', 'fixture-token', { requestId: 'second', consumerId: 'settings' }),
      );
      expect(mocks.saveConfig).toHaveBeenCalledTimes(1);
      save.resolve({ success: true });
      await settle();
      expect(run.state()).toMatchObject({
        isAuthenticated: true,
        organization: 'acme',
        operation: { requestId: 'second', status: 'failed' },
        error: 'replacement rejected',
      });
      expect(mocks.fetchProjects).not.toHaveBeenCalled();
    } finally {
      run.task.cancel();
      await run.task.toPromise();
    }
  });

  it('reconciles a consumed logout without resurrecting its consumer result', async () => {
    const logout = Promise.withResolvers<void>();
    mocks.getAuthState.mockResolvedValue({ isAuthenticated: true, organization: 'acme' });
    mocks.logout.mockReturnValue(logout.promise);
    const run = harness();
    try {
      run.channel.put(initializeSentryAuth());
      await settle();
      run.channel.put(logoutSentry({ requestId: 'logout', consumerId: 'settings' }));
      run.channel.put(consumeSentryAuth('logout'));
      logout.resolve();
      await settle();
      expect(run.state()).toMatchObject({
        isAuthenticated: false,
        organization: null,
        operation: null,
      });
    } finally {
      run.task.cancel();
      await run.task.toPromise();
    }
  });

  it('settles teardown and discards a late save result', async () => {
    let resolve!: (value: unknown) => void;
    mocks.saveConfig.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const run = harness();
    run.channel.put(connectSentry('acme', 'test-token'));
    run.task.cancel();
    await run.task.toPromise();
    resolve({ success: true });
    await settle();
    expect(run.state()).toMatchObject({
      isAuthenticated: false,
      operation: { status: 'cancelled' },
    });
    expect(mocks.fetchProjects).not.toHaveBeenCalled();
  });
});
