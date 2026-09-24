import { runSaga, stdChannel, type Task } from 'redux-saga';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('$lib/electron-bridge');

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));
vi.mock('$lib/client', async () => {
  const { LiveSettingsClient } = await import('$lib/client/live/live-settings-client');
  return { appClient: { settings: new LiveSettingsClient() } };
});

import { backendRequest } from '$lib/client/live/backend-transport';
import { __resetGitHubAuthStatusForTests } from '$features/github-auth/renderer/github-auth-status.client';
import { connectLinear, linearAuthReducer, logoutLinear } from '../linear-auth/linear-auth-slice';
import { linearAuthSaga } from '../linear-auth/sagas/linear-auth-saga';
import {
  connectSentry,
  consumeSentryAuth,
  logoutSentry,
  sentryAuthReducer,
} from '../sentry-auth/sentry-auth-slice';
import { sentryAuthSaga } from '../sentry-auth/sagas/sentry-auth-saga';
import {
  cancelGitHubAuth,
  githubAuthReducer,
  logoutGitHub,
  setGitHubAuthState,
  startGitHubAuth,
} from '../github-auth/github-auth-slice';
import { githubAuthSaga } from '../github-auth/sagas/github-auth-saga';

const request = vi.mocked(backendRequest);
const tasks: Task[] = [];

function harness(saga: typeof linearAuthSaga) {
  const channel = stdChannel();
  let state = {
    linearAuth: linearAuthReducer.initialState,
    sentryAuth: sentryAuthReducer.initialState,
    githubAuth: githubAuthReducer.initialState,
  };
  const dispatch = (action: Parameters<typeof linearAuthReducer>[1]) => {
    state = {
      linearAuth: linearAuthReducer(state.linearAuth, action),
      sentryAuth: sentryAuthReducer(state.sentryAuth, action),
      githubAuth: githubAuthReducer(state.githubAuth, action),
    };
    channel.put(action);
  };
  tasks.push(runSaga({ channel, dispatch, getState: () => state }, saga));
  return { dispatch, state: () => state };
}

beforeAll(async () => {
  await import('../../seeders/integrations-bridge-seeder');
});
beforeEach(() => {
  request.mockReset();
  __resetGitHubAuthStatusForTests();
});
afterEach(async () => {
  for (const task of tasks.splice(0)) {
    task.cancel();
    await task.toPromise();
  }
});

describe('provider saga wire contracts through production clients and IPC adapters', () => {
  it('writes, validates, and clears Linear credentials with exact daemon requests', async () => {
    request
      .mockResolvedValueOnce({
        applied: [{ path: 'linear.token', value: '********' }],
        revision: 1,
      })
      .mockResolvedValueOnce({ authenticated: true });
    const run = harness(linearAuthSaga);
    run.dispatch(connectLinear(' fixture-key ', { requestId: 'connect', consumerId: 'settings' }));
    await vi.waitFor(() => expect(run.state().linearAuth.operation?.status).toBe('succeeded'));
    expect(request.mock.calls).toEqual([
      ['settings.update', { changes: [{ path: 'linear.token', value: 'fixture-key' }] }],
      ['linear.authStatus'],
    ]);
    expect(run.state().linearAuth.isAuthenticated).toBe(true);
    expect(JSON.stringify(run.state())).not.toContain('fixture-key');

    request.mockClear();
    request
      .mockResolvedValueOnce({ path: 'linear.token', value: null })
      .mockResolvedValueOnce({ authenticated: false });
    run.dispatch(logoutLinear({ requestId: 'logout', consumerId: 'settings' }));
    await vi.waitFor(() => expect(run.state().linearAuth.operation?.status).toBe('succeeded'));
    expect(request.mock.calls).toEqual([
      ['settings.reset', { path: 'linear.token' }],
      ['linear.authStatus'],
    ]);
    expect(run.state().linearAuth.isAuthenticated).toBe(false);
  });

  it('validates Sentry configuration and loads projects before settling the consumer', async () => {
    const project = { id: 'web', slug: 'web', name: 'Web', platform: 'javascript', isMember: true };
    request
      .mockResolvedValueOnce({ applied: [], revision: 1 })
      .mockResolvedValueOnce({ authenticated: true, organization: 'acme' })
      .mockResolvedValueOnce([project]);
    const run = harness(sentryAuthSaga);
    run.dispatch(
      connectSentry('acme', 'fixture-token', { requestId: 'connect', consumerId: 'settings' }),
    );
    await vi.waitFor(() => expect(run.state().sentryAuth.operation?.status).toBe('succeeded'));
    expect(request.mock.calls).toEqual([
      [
        'settings.update',
        {
          changes: [
            { path: 'accounts.sentry.token', value: 'fixture-token' },
            { path: 'accounts.sentry.organization', value: 'acme' },
          ],
        },
      ],
      ['sentry.authStatus'],
      ['sentry.listProjects'],
    ]);
    expect(run.state().sentryAuth).toMatchObject({ isAuthenticated: true, projects: [project] });
    expect(JSON.stringify(run.state())).not.toContain('fixture-token');

    request.mockClear();
    request.mockResolvedValue({ path: 'accounts.sentry.token', value: null });
    run.dispatch(logoutSentry());
    await vi.waitFor(() => expect(run.state().sentryAuth.operation?.status).toBe('succeeded'));
    expect(request.mock.calls).toEqual([
      ['settings.reset', { path: 'accounts.sentry.token' }],
      ['settings.reset', { path: 'accounts.sentry.organization' }],
    ]);
    expect(run.state().sentryAuth.isAuthenticated).toBe(false);
  });

  it('reconciles the Sentry wire write after the picker dismisses its pending request', async () => {
    const saved = Promise.withResolvers<{ applied: []; revision: number }>();
    request
      .mockReturnValueOnce(saved.promise)
      .mockResolvedValueOnce({ authenticated: true, organization: 'acme' });
    const run = harness(sentryAuthSaga);
    run.dispatch(
      connectSentry('acme', 'fixture-token', { requestId: 'save', consumerId: 'picker' }),
    );
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    run.dispatch(consumeSentryAuth('save'));
    saved.resolve({ applied: [], revision: 1 });
    await vi.waitFor(() => expect(run.state().sentryAuth.isAuthenticated).toBe(true));
    expect(request.mock.calls).toEqual([
      [
        'settings.update',
        {
          changes: [
            { path: 'accounts.sentry.token', value: 'fixture-token' },
            { path: 'accounts.sentry.organization', value: 'acme' },
          ],
        },
      ],
      ['sentry.authStatus'],
    ]);
    expect(run.state().sentryAuth).toMatchObject({ organization: 'acme', operation: null });
  });

  it('waits for the GitHub revoke acknowledgement before reconnecting over the wire', async () => {
    const revoked = Promise.withResolvers<{ ok: true }>();
    request
      .mockReturnValueOnce(revoked.promise)
      .mockResolvedValueOnce({
        isConfigured: false,
        oauthUrl: '',
        configuredButNeedsUpdate: false,
        updatedScopes: '',
        deviceFlow: null,
      })
      .mockRejectedValueOnce(new Error('reconnect rejected'));
    const run = harness(githubAuthSaga);
    run.dispatch(
      setGitHubAuthState({
        isAuthenticated: true,
        requiresDaemonAuth: false,
        user: null,
        needsScopeUpdate: false,
        oauthUrl: null,
      }),
    );
    run.dispatch(logoutGitHub());
    run.dispatch(startGitHubAuth({ reconnect: true }));
    await vi.waitFor(() => expect(request.mock.calls).toEqual([['github.revoke']]));
    expect(run.state().githubAuth).toMatchObject({ isAuthenticated: true, isDisconnecting: true });
    revoked.resolve({ ok: true });
    await vi.waitFor(() => expect(run.state().githubAuth.error).toBe('reconnect rejected'));
    expect(request.mock.calls).toEqual([
      ['github.revoke'],
      ['github.authStatus'],
      ['github.connect'],
    ]);
    expect(run.state().githubAuth).toMatchObject({
      isAuthenticated: false,
      isDisconnecting: false,
      isAuthenticating: false,
      mutationRequestId: null,
    });
  });

  it('starts and cancels GitHub device flow through the same wire owner', async () => {
    const flow = {
      status: 'pending',
      userCode: 'CODE',
      verificationUri: 'https://github.com/login/device',
      expiresIn: 900,
      interval: 5,
    };
    request
      .mockResolvedValueOnce({
        isConfigured: false,
        oauthUrl: '',
        configuredButNeedsUpdate: false,
        updatedScopes: '',
        deviceFlow: null,
      })
      .mockResolvedValueOnce({ ok: true, ...flow })
      .mockResolvedValueOnce({
        isConfigured: false,
        oauthUrl: flow.verificationUri,
        configuredButNeedsUpdate: false,
        updatedScopes: '',
        deviceFlow: flow,
      });
    const run = harness(githubAuthSaga);
    run.dispatch(startGitHubAuth());
    await vi.waitFor(() => expect(run.state().githubAuth.deviceFlow?.userCode).toBe('CODE'));
    expect(request.mock.calls).toEqual([
      ['github.authStatus'],
      ['github.connect'],
      ['github.authStatus'],
    ]);
    request.mockClear();
    request.mockResolvedValueOnce({ ok: true, cancelled: true });
    run.dispatch(cancelGitHubAuth());
    await vi.waitFor(() => expect(run.state().githubAuth.isAuthenticating).toBe(false));
    expect(request.mock.calls).toEqual([['github.cancelAuth']]);
    expect(run.state().githubAuth.deviceFlow).toBeNull();
  });
});
