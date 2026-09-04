import { runSaga, stdChannel } from 'redux-saga';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAuthState: vi.fn(),
  startAuth: vi.fn(),
  checkAuthComplete: vi.fn(),
  cancelAuth: vi.fn(),
  logout: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock('$features/github-auth/renderer/github-auth.client', () => ({
  githubAuthClient: mocks,
}));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ error: vi.fn() }),
}));

import {
  cancelGitHubAuth,
  checkGitHubAuthStatus,
  githubAuthChanged,
  githubAuthReducer,
  initializeGitHubAuth,
  initialState,
  logoutGitHub,
  startGitHubAuth,
} from '../github-auth-slice';
import { m } from '$shared/paraglide/messages.js';
import { githubAuthSaga } from './github-auth-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function harness(seed = initialState) {
  const channel = stdChannel();
  let state = seed;
  const dispatched: unknown[] = [];
  const dispatch = (action: never) => {
    dispatched.push(action);
    state = githubAuthReducer(state, action);
    channel.put(action);
    return action;
  };
  const task = runSaga(
    { channel, dispatch, getState: () => ({ githubAuth: state }) },
    githubAuthSaga,
  );
  return { channel, dispatched, state: () => state, task };
}

describe('githubAuthSaga', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps auth status field by field and drops unrelated wire fields', async () => {
    const user = {
      login: 'octo',
      name: 'Octo',
      email: null,
      avatar_url: 'avatar',
      accessToken: 'drop',
    };
    mocks.getAuthState.mockResolvedValue({
      isAuthenticated: true,
      requiresDaemonAuth: false,
      user,
      needsScopeUpdate: true,
      oauthUrl: 'https://github.com/login/device',
      updatedScopes: 'repo',
      wireOnly: 'must-not-leak',
    });
    const run = harness();
    run.channel.put(initializeGitHubAuth());
    await settle();

    expect(run.dispatched).toEqual([
      {
        type: 'githubAuth/setAuthState',
        payload: {
          isAuthenticated: true,
          requiresDaemonAuth: false,
          user: { login: 'octo', name: 'Octo', email: null, avatar_url: 'avatar' },
          needsScopeUpdate: true,
          oauthUrl: 'https://github.com/login/device',
        },
      },
    ]);
    expect(run.state().user).toEqual({
      login: 'octo',
      name: 'Octo',
      email: null,
      avatar_url: 'avatar',
    });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('cancels polling on disconnect and ignores the late completion', async () => {
    let resolveCheck!: (value: unknown) => void;
    mocks.startAuth.mockResolvedValue({
      success: true,
      userCode: 'ABCD',
      verificationUri: 'https://github.test',
      expiresIn: 900,
      interval: 5,
    });
    mocks.checkAuthComplete.mockReturnValue(
      new Promise((resolve) => {
        resolveCheck = resolve;
      }),
    );
    mocks.cancelAuth.mockResolvedValue({ success: true });
    const run = harness();
    run.channel.put(startGitHubAuth());
    await settle();
    run.channel.put(cancelGitHubAuth());
    await settle();
    resolveCheck({
      success: true,
      data: {
        isComplete: true,
        user: {
          login: 'late',
          name: null,
          email: null,
          avatar_url: 'late',
          accessToken: 'drop',
        },
      },
    });
    await settle();

    expect(mocks.cancelAuth.mock.calls).toEqual([[]]);
    expect(run.dispatched).toEqual([
      { type: 'githubAuth/setAuthenticating', payload: [true] },
      { type: 'githubAuth/setOAuthInfo', payload: { oauthUrl: null, needsScopeUpdate: false } },
      {
        type: 'githubAuth/setDeviceFlowInfo',
        payload: [
          {
            userCode: 'ABCD',
            verificationUri: 'https://github.test',
            expiresIn: 900,
            interval: 5,
          },
        ],
      },
      { type: 'githubAuth/authCancelled', payload: [] },
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('surfaces the exact start failure without polling', async () => {
    mocks.startAuth.mockResolvedValue({ success: false, error: 'device denied' });
    const run = harness();
    run.channel.put(startGitHubAuth());
    await settle();

    expect(mocks.checkAuthComplete.mock.calls).toEqual([]);
    expect(run.dispatched).toEqual([
      { type: 'githubAuth/setAuthenticating', payload: [true] },
      { type: 'githubAuth/setError', payload: ['device denied'] },
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('settles logout only after the daemon confirms success', async () => {
    mocks.logout.mockResolvedValue({ success: true });
    const run = harness();
    run.channel.put(logoutGitHub());
    await settle();

    expect(mocks.logout.mock.calls).toEqual([[]]);
    expect(run.dispatched).toEqual([{ type: 'githubAuth/logoutCompleted', payload: [] }]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('runs repeated status requests concurrently like the middleware', async () => {
    let resolveFirst!: (value: unknown) => void;
    mocks.getAuthState
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockResolvedValueOnce({ isAuthenticated: false, requiresDaemonAuth: false, user: null });
    const run = harness();
    run.channel.put(initializeGitHubAuth());
    await settle();
    run.channel.put(initializeGitHubAuth());
    await settle();
    resolveFirst({
      isAuthenticated: true,
      requiresDaemonAuth: false,
      user: { login: 'octo', name: null, email: null, avatar_url: 'avatar' },
    });
    await settle();

    expect(mocks.getAuthState.mock.calls).toEqual([[], []]);
    expect(run.dispatched).toEqual([
      {
        type: 'githubAuth/setAuthState',
        payload: {
          isAuthenticated: false,
          requiresDaemonAuth: false,
          user: null,
          needsScopeUpdate: false,
          oauthUrl: null,
        },
      },
      {
        type: 'githubAuth/setAuthState',
        payload: {
          isAuthenticated: true,
          requiresDaemonAuth: false,
          user: { login: 'octo', name: null, email: null, avatar_url: 'avatar' },
          needsScopeUpdate: false,
          oauthUrl: null,
        },
      },
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('cancels a start poll when initialize clears stale flow and ignores its late completion', async () => {
    let resolveOld!: (value: unknown) => void;
    mocks.startAuth.mockResolvedValue({
      success: true,
      userCode: 'OLD',
      verificationUri: 'https://old.test',
      expiresIn: 900,
      interval: 5,
    });
    mocks.checkAuthComplete.mockReturnValue(
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
    );
    mocks.getAuthState.mockResolvedValue({
      isAuthenticated: false,
      requiresDaemonAuth: false,
      user: null,
    });
    const run = harness();
    run.channel.put(startGitHubAuth());
    await settle();
    run.channel.put(initializeGitHubAuth());
    await settle();
    resolveOld({
      success: true,
      data: {
        isComplete: true,
        user: {
          login: 'stale',
          name: null,
          email: null,
          avatar_url: 'stale',
        },
      },
    });
    await settle();

    expect(mocks.checkAuthComplete.mock.calls).toEqual([[]]);
    expect(mocks.getAuthState.mock.calls).toEqual([[]]);
    expect(run.dispatched).toEqual([
      { type: 'githubAuth/setAuthenticating', payload: [true] },
      { type: 'githubAuth/setOAuthInfo', payload: { oauthUrl: null, needsScopeUpdate: false } },
      {
        type: 'githubAuth/setDeviceFlowInfo',
        payload: [
          {
            userCode: 'OLD',
            verificationUri: 'https://old.test',
            expiresIn: 900,
            interval: 5,
          },
        ],
      },
      {
        type: 'githubAuth/setAuthState',
        payload: {
          isAuthenticated: false,
          requiresDaemonAuth: false,
          user: null,
          needsScopeUpdate: false,
          oauthUrl: null,
        },
      },
      { type: 'githubAuth/setDeviceFlowInfo', payload: [null] },
      { type: 'githubAuth/setAuthenticating', payload: [false] },
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('dispatches exact cancel, logout, and terminal-event failures', async () => {
    mocks.checkAuthComplete.mockRejectedValue(new Error('probe unavailable'));
    mocks.cancelAuth.mockResolvedValue({ success: false, error: 'cancel rejected' });
    mocks.logout.mockResolvedValue({ success: false, error: 'logout rejected' });
    const run = harness();
    run.channel.put(checkGitHubAuthStatus());
    await settle();
    run.channel.put(cancelGitHubAuth());
    await settle();
    run.channel.put(logoutGitHub());
    await settle();
    run.channel.put(githubAuthChanged('expired'));
    await settle();

    expect(run.dispatched).toEqual([
      { type: 'githubAuth/setError', payload: ['cancel rejected'] },
      { type: 'githubAuth/setError', payload: ['logout rejected'] },
      { type: 'githubAuth/setError', payload: [m.githubAuth_service_codeExpired_error()] },
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });
});
