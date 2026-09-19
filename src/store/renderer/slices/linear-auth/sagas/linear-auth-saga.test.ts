import { runSaga, stdChannel } from 'redux-saga';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAuthState: vi.fn(),
  fetchMyIssues: vi.fn(),
  update: vi.fn(),
  reset: vi.fn(),
  getJSON: vi.fn(),
  getItem: vi.fn(),
  setJSON: vi.fn(),
}));
vi.mock('$features/linear-auth/renderer/linear-auth.client', () => ({
  linearAuthClient: { getAuthState: mocks.getAuthState, fetchMyIssues: mocks.fetchMyIssues },
}));
vi.mock('$lib/client', () => ({
  appClient: { settings: { update: mocks.update, reset: mocks.reset } },
}));
vi.mock('$lib/utils/client-logger', () => ({ createLogger: () => ({ error: vi.fn() }) }));
vi.mock('$lib/utils/safe-storage', () => ({
  safeLocalStorage: {
    getJSON: mocks.getJSON,
    getItem: mocks.getItem,
    setJSON: mocks.setJSON,
  },
}));

import { m } from '$shared/paraglide/messages.js';
import {
  connectLinear,
  hydrateLinearIssueFilter,
  initializeLinearAuth,
  initializeLinearIssueFilter,
  linearIssuesLoaded,
  linearIssuesLoadSettled,
  linearIssuesLoadStarted,
  loadLinearIssuesRequested,
  logoutLinear,
  setLinearAuthState,
  setLinearIssueFilter,
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

  it('keeps only the latest overlapping connect result', async () => {
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
    const latestActions = [...run.dispatched];
    resolveFirst();
    await settle();

    expect(mocks.update.mock.calls).toEqual([
      [[{ path: 'linear.token', value: 'first' }]],
      [[{ path: 'linear.token', value: 'second' }]],
    ]);
    expect(mocks.getAuthState.mock.calls).toEqual([[true]]);
    expect(run.dispatched).toEqual([
      { type: 'linearAuth/setError', payload: [null] },
      { type: 'linearAuth/setIsAuthenticating', payload: [true] },
      { type: 'linearAuth/setIsAuthenticating', payload: [false] },
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
    expect(run.dispatched).toEqual(latestActions);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('lets logout supersede a pending connect without a stale completion', async () => {
    let resolveConnect!: () => void;
    mocks.update.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveConnect = resolve;
      }),
    );
    mocks.reset.mockResolvedValue(undefined);
    mocks.getAuthState.mockResolvedValue({ isAuthenticated: false, requiresDaemonAuth: false });
    const run = harness();
    run.channel.put(connectLinear('pending'));
    await settle();
    run.channel.put(logoutLinear());
    await settle();
    const logoutActions = [...run.dispatched];

    resolveConnect();
    await settle();

    expect(mocks.reset.mock.calls).toEqual([['linear.token']]);
    expect(run.dispatched).toEqual([
      { type: 'linearAuth/setError', payload: [null] },
      { type: 'linearAuth/setIsAuthenticating', payload: [true] },
      { type: 'linearAuth/setIsAuthenticating', payload: [false] },
      setLinearAuthState(false, false, null),
    ]);
    expect(run.dispatched).toEqual(logoutActions);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('lets connect supersede a pending logout without publishing logged-out state', async () => {
    let resolveLogout!: () => void;
    mocks.reset.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveLogout = resolve;
      }),
    );
    mocks.update.mockResolvedValue(undefined);
    mocks.getAuthState.mockResolvedValue({ isAuthenticated: true, requiresDaemonAuth: false });
    const run = harness();
    run.channel.put(logoutLinear());
    await settle();
    run.channel.put(connectLinear('latest'));
    await settle();
    const connectActions = [...run.dispatched];

    resolveLogout();
    await settle();

    expect(mocks.reset.mock.calls).toEqual([['linear.token']]);
    expect(mocks.update.mock.calls).toEqual([[[{ path: 'linear.token', value: 'latest' }]]]);
    expect(run.dispatched).toEqual([
      { type: 'linearAuth/setError', payload: [null] },
      { type: 'linearAuth/setIsAuthenticating', payload: [true] },
      setLinearAuthState(true, false, null),
      { type: 'linearAuth/setIsAuthenticating', payload: [false] },
    ]);
    expect(run.dispatched).toEqual(connectActions);
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
  it('hydrates the namespaced issue filter and persists user changes', async () => {
    mocks.getJSON.mockReturnValue('created');
    const run = harness();
    run.channel.put(initializeLinearIssueFilter());
    await settle();
    run.channel.put(setLinearIssueFilter('subscribed'));
    await settle();

    expect(mocks.getJSON.mock.calls).toEqual([['legacy-settings:linearIssueFilter']]);
    expect(mocks.getItem).not.toHaveBeenCalled();
    expect(mocks.setJSON.mock.calls).toEqual([['legacy-settings:linearIssueFilter', 'subscribed']]);
    expect(run.dispatched).toEqual([hydrateLinearIssueFilter('created')]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('loads issues only after an authenticated status response', async () => {
    const issue = { id: 'issue-1', identifier: 'ENG-1', title: 'Fix connection' };
    mocks.getAuthState.mockResolvedValue({ isAuthenticated: true, requiresDaemonAuth: false });
    mocks.fetchMyIssues.mockResolvedValue([issue]);
    const run = harness();
    run.channel.put(loadLinearIssuesRequested('all'));
    await settle();

    expect(mocks.getAuthState.mock.calls).toEqual([[true]]);
    expect(mocks.fetchMyIssues.mock.calls).toEqual([['all']]);
    expect(run.dispatched).toEqual([
      linearIssuesLoadStarted(),
      setLinearAuthState(true, false, null),
      linearIssuesLoaded([issue]),
      linearIssuesLoadSettled(),
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('cancels stale issue loads before applying the latest result', async () => {
    let resolveFirst!: (value: unknown[]) => void;
    mocks.getAuthState.mockResolvedValue({ isAuthenticated: true, requiresDaemonAuth: false });
    mocks.fetchMyIssues
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockResolvedValueOnce([{ id: 'new', identifier: 'ENG-2', title: 'Latest' }]);
    const run = harness();
    run.channel.put(loadLinearIssuesRequested('assigned'));
    await settle();
    run.channel.put(loadLinearIssuesRequested('created'));
    await settle();
    resolveFirst([{ id: 'old', identifier: 'ENG-1', title: 'Stale' }]);
    await settle();

    expect(mocks.fetchMyIssues.mock.calls).toEqual([['assigned'], ['created']]);
    expect(run.dispatched).toContainEqual(
      linearIssuesLoaded([{ id: 'new', identifier: 'ENG-2', title: 'Latest' }]),
    );
    expect(run.dispatched).not.toContainEqual(
      linearIssuesLoaded([{ id: 'old', identifier: 'ENG-1', title: 'Stale' }]),
    );
    run.task.cancel();
    await run.task.toPromise();
  });
});
