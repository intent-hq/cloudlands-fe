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

import { connectSentry, initializeSentryAuth, logoutSentry } from '../sentry-auth-slice';
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
  const task = runSaga({ channel, dispatch: (action) => dispatched.push(action) }, sentryAuthSaga);
  return { channel, dispatched, task };
}

describe('sentryAuthSaga', () => {
  beforeEach(() => vi.clearAllMocks());

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
    expect(run.dispatched).toEqual([
      { type: 'sentryAuth/setError', payload: [null] },
      { type: 'sentryAuth/setConnecting', payload: [true] },
      { type: 'sentryAuth/setConnected', payload: { organization: 'acme' } },
      { type: 'sentryAuth/setLoadingProjects', payload: [true] },
      {
        type: 'sentryAuth/setProjects',
        payload: [
          [
            {
              id: '1',
              slug: 'web',
              name: 'Web',
              platform: 'javascript',
              isMember: true,
            },
          ],
        ],
      },
      { type: 'sentryAuth/setLoadingProjects', payload: [false] },
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
    expect(run.dispatched).toEqual([
      {
        type: 'sentryAuth/setAuthState',
        payload: {
          isAuthenticated: true,
          organization: 'acme',
          error: null,
        },
      },
      { type: 'sentryAuth/setLoggedOut', payload: [] },
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('dispatches the exact failure and clears connecting when config is rejected', async () => {
    mocks.saveConfig.mockResolvedValue({ success: false, error: 'invalid token' });
    const run = harness();
    run.channel.put(connectSentry('acme', 'sentry-secret'));
    await settle();

    expect(mocks.fetchProjects.mock.calls).toEqual([]);
    expect(run.dispatched).toEqual([
      { type: 'sentryAuth/setError', payload: [null] },
      { type: 'sentryAuth/setConnecting', payload: [true] },
      { type: 'sentryAuth/setError', payload: ['invalid token'] },
      { type: 'sentryAuth/setConnecting', payload: [false] },
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('always clears project loading after a post-connect fetch failure', async () => {
    mocks.saveConfig.mockResolvedValue({ success: true });
    mocks.fetchProjects.mockRejectedValue(new Error('projects unavailable'));
    const run = harness();
    run.channel.put(connectSentry('acme', 'sentry-secret'));
    await settle();

    expect(run.dispatched).toEqual([
      { type: 'sentryAuth/setError', payload: [null] },
      { type: 'sentryAuth/setConnecting', payload: [true] },
      { type: 'sentryAuth/setConnected', payload: { organization: 'acme' } },
      { type: 'sentryAuth/setLoadingProjects', payload: [true] },
      { type: 'sentryAuth/setLoadingProjects', payload: [false] },
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('runs overlapping connects independently like the middleware', async () => {
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
    resolveFirst({ success: false, error: 'first rejected' });
    await settle();

    expect(mocks.saveConfig.mock.calls).toEqual([
      ['first', 'first-secret'],
      ['second', 'second-secret'],
    ]);
    expect(run.dispatched).toEqual([
      { type: 'sentryAuth/setError', payload: [null] },
      { type: 'sentryAuth/setConnecting', payload: [true] },
      { type: 'sentryAuth/setError', payload: [null] },
      { type: 'sentryAuth/setConnecting', payload: [true] },
      { type: 'sentryAuth/setConnected', payload: { organization: 'second' } },
      { type: 'sentryAuth/setLoadingProjects', payload: [true] },
      { type: 'sentryAuth/setProjects', payload: [[]] },
      { type: 'sentryAuth/setLoadingProjects', payload: [false] },
      { type: 'sentryAuth/setError', payload: ['first rejected'] },
      { type: 'sentryAuth/setConnecting', payload: [false] },
    ]);
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
    expect(run.dispatched).toEqual([]);
    run.task.cancel();
    await run.task.toPromise();
  });
});
