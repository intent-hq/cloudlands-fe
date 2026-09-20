import { runSaga, stdChannel } from 'redux-saga';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  connect: vi.fn(),
  cancelAuth: vi.fn(),
  revoke: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock('$features/forge-auth/renderer/forge-auth.client', () => ({
  forgeAuthClient: mocks,
}));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ error: vi.fn() }),
}));

import { m } from '$shared/paraglide/messages.js';
import {
  cancelGitLabAuth,
  connectGitLabWithToken,
  gitlabAuthChanged,
  gitlabAuthReducer,
  initializeGitLabAuth,
  initialState,
  logoutGitLab,
  startGitLabDeviceAuth,
} from '../gitlab-auth-slice';
import { gitlabAuthSaga } from './gitlab-auth-saga';

const settle = async () => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

const HOST = 'gitlab.example.com';
const WIRE_USER = { id: 7, login: 'octo', displayName: 'Octo', avatarUrl: 'https://a/b.png' };
const PENDING_FLOW = {
  status: 'pending',
  userCode: 'ABCD-1234',
  verificationUri: 'https://gitlab.example.com/oauth/device',
  expiresIn: 600,
  interval: 5,
};
/** `sourceControl.authStatus` for a configured PAT connection. */
const CONFIGURED_STATUS = {
  provider: 'gitlab',
  host: HOST,
  isConfigured: true,
  oauthUrl: '',
  configuredButNeedsUpdate: false,
  updatedScopes: '',
  deviceFlow: null,
  method: 'pat',
  user: { ...WIRE_USER, accessToken: 'must-not-leak' },
  deviceGrantSupported: false,
};
const UNCONFIGURED_STATUS = {
  ...CONFIGURED_STATUS,
  isConfigured: false,
  method: null,
  user: null,
  deviceGrantSupported: true,
};

function harness(seed = initialState) {
  const channel = stdChannel();
  let state = seed;
  const dispatched: unknown[] = [];
  const dispatch = (action: never) => {
    dispatched.push(action);
    state = gitlabAuthReducer(state, action);
    channel.put(action);
    return action;
  };
  const task = runSaga(
    { channel, dispatch, getState: () => ({ gitlabAuth: state }) },
    gitlabAuthSaga,
  );
  return { channel, dispatched, state: () => state, task };
}

describe('gitlabAuthSaga', () => {
  beforeEach(() => vi.clearAllMocks());

  it('initialize reads sourceControl.authStatus for the host and hydrates field by field', async () => {
    mocks.getStatus.mockResolvedValue(CONFIGURED_STATUS);
    const run = harness();
    run.channel.put(initializeGitLabAuth(HOST));
    await settle();

    expect(mocks.getStatus.mock.calls).toEqual([['gitlab', HOST]]);
    expect(run.dispatched).toEqual([
      {
        type: 'gitlabAuth/setAuthStatus',
        payload: {
          host: HOST,
          isConfigured: true,
          deviceGrantSupported: false,
          user: WIRE_USER,
          method: 'pat',
        },
      },
    ]);
    expect(run.state().user).toEqual(WIRE_USER);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('initialize resumes a pending device grant and completes it when the daemon authorizes', async () => {
    mocks.getStatus
      .mockResolvedValueOnce({ ...UNCONFIGURED_STATUS, deviceFlow: PENDING_FLOW })
      .mockResolvedValueOnce({ ...CONFIGURED_STATUS, method: 'device' });
    const run = harness();
    run.channel.put(initializeGitLabAuth());
    await settle();

    expect(mocks.getStatus.mock.calls).toEqual([
      ['gitlab', undefined],
      ['gitlab', undefined],
    ]);
    expect(run.dispatched.map((action) => (action as { type: string }).type)).toEqual([
      'gitlabAuth/setAuthStatus',
      'gitlabAuth/setAuthenticating',
      'gitlabAuth/setDeviceFlowInfo',
      'gitlabAuth/authCompleted',
    ]);
    expect(run.dispatched[2]).toEqual({
      type: 'gitlabAuth/setDeviceFlowInfo',
      payload: [
        {
          userCode: 'ABCD-1234',
          verificationUri: 'https://gitlab.example.com/oauth/device',
          expiresIn: 600,
          interval: 5,
        },
      ],
    });
    expect(run.state()).toMatchObject({
      isConfigured: true,
      isAuthenticating: false,
      deviceFlow: null,
      user: WIRE_USER,
      method: 'device',
    });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('starts the device grant with the exact connect params and polls until authorized', async () => {
    mocks.connect.mockResolvedValue({
      success: true,
      deviceFlow: {
        userCode: 'WXYZ-9876',
        verificationUri: 'https://gitlab.example.com/oauth/device',
        expiresIn: 600,
        interval: 5,
      },
    });
    mocks.getStatus.mockResolvedValue({ ...CONFIGURED_STATUS, method: 'device' });
    const run = harness();
    run.channel.put(startGitLabDeviceAuth(HOST));
    await settle();

    expect(mocks.connect.mock.calls).toEqual([
      [{ provider: 'gitlab', host: HOST, method: 'device' }],
    ]);
    expect(run.dispatched).toEqual([
      { type: 'gitlabAuth/setHost', payload: [HOST] },
      { type: 'gitlabAuth/setAuthenticating', payload: [true] },
      {
        type: 'gitlabAuth/setDeviceFlowInfo',
        payload: [
          {
            userCode: 'WXYZ-9876',
            verificationUri: 'https://gitlab.example.com/oauth/device',
            expiresIn: 600,
            interval: 5,
          },
        ],
      },
      { type: 'gitlabAuth/authCompleted', payload: { user: WIRE_USER, method: 'device' } },
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('falls back to the PAT path when the host refuses the device grant', async () => {
    mocks.connect.mockResolvedValue({
      success: false,
      error: 'device grant unsupported on gitlab.example.com',
      code: 'device-grant-unsupported',
    });
    const run = harness({ ...initialState, deviceGrantSupported: true });
    run.channel.put(startGitLabDeviceAuth(HOST));
    await settle();

    expect(run.dispatched.at(-1)).toEqual({
      type: 'gitlabAuth/deviceGrantUnsupported',
      payload: [m.gitlabAuth_service_deviceGrantUnsupported_error()],
    });
    expect(run.state()).toMatchObject({
      deviceGrantSupported: false,
      isAuthenticating: false,
      deviceFlow: null,
    });
    expect(mocks.getStatus).not.toHaveBeenCalled();
    run.task.cancel();
    await run.task.toPromise();
  });

  it('submits a PAT straight to the daemon and completes from the fresh status', async () => {
    mocks.connect.mockResolvedValue({ success: true });
    mocks.getStatus.mockResolvedValue(CONFIGURED_STATUS);
    const run = harness();
    run.channel.put(connectGitLabWithToken(HOST, 'glpat-secret'));
    await settle();

    expect(mocks.connect.mock.calls).toEqual([
      [{ provider: 'gitlab', host: HOST, method: 'pat', token: 'glpat-secret' }],
    ]);
    expect(mocks.getStatus.mock.calls).toEqual([['gitlab', HOST]]);
    expect(run.dispatched).toEqual([
      { type: 'gitlabAuth/setHost', payload: [HOST] },
      { type: 'gitlabAuth/setAuthenticating', payload: [true] },
      { type: 'gitlabAuth/authCompleted', payload: { user: WIRE_USER, method: 'pat' } },
    ]);
    expect(JSON.stringify(run.state())).not.toContain('glpat-secret');
    run.task.cancel();
    await run.task.toPromise();
  });

  it('surfaces a rejected PAT as the daemon error without touching status', async () => {
    mocks.connect.mockResolvedValue({
      success: false,
      error: 'GitLab returned 401',
      code: 'source-control-unauthorized',
    });
    const run = harness();
    run.channel.put(connectGitLabWithToken(HOST, 'glpat-bad'));
    await settle();

    expect(run.dispatched.at(-1)).toEqual({
      type: 'gitlabAuth/setError',
      payload: ['GitLab returned 401'],
    });
    expect(mocks.getStatus).not.toHaveBeenCalled();
    expect(run.state().isConfigured).toBe(false);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('cancels polling on cancel and ignores the late status', async () => {
    let resolveStatus!: (value: unknown) => void;
    mocks.connect.mockResolvedValue({ success: true, deviceFlow: PENDING_FLOW });
    mocks.getStatus.mockReturnValue(
      new Promise((resolve) => {
        resolveStatus = resolve;
      }),
    );
    mocks.cancelAuth.mockResolvedValue({ success: true });
    const run = harness();
    run.channel.put(startGitLabDeviceAuth(HOST));
    await settle();
    run.channel.put(cancelGitLabAuth());
    await settle();
    resolveStatus({ ...CONFIGURED_STATUS, method: 'device' });
    await settle();

    expect(mocks.cancelAuth.mock.calls).toEqual([['gitlab']]);
    expect(run.dispatched.map((action) => (action as { type: string }).type)).toEqual([
      'gitlabAuth/setHost',
      'gitlabAuth/setAuthenticating',
      'gitlabAuth/setDeviceFlowInfo',
      'gitlabAuth/authCancelled',
    ]);
    expect(run.state().isConfigured).toBe(false);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('settles logout only after the daemon confirms the revoke', async () => {
    mocks.revoke.mockResolvedValueOnce({ success: false, error: 'still held' });
    mocks.revoke.mockResolvedValueOnce({ success: true });
    const run = harness({ ...initialState, isConfigured: true, user: WIRE_USER, method: 'pat' });
    run.channel.put(logoutGitLab());
    await settle();
    expect(run.state().isConfigured).toBe(true);
    expect(run.dispatched.at(-1)).toEqual({ type: 'gitlabAuth/setError', payload: ['still held'] });

    run.channel.put(logoutGitLab());
    await settle();
    expect(mocks.revoke.mock.calls).toEqual([['gitlab'], ['gitlab']]);
    expect(run.state()).toMatchObject({ isConfigured: false, user: null, method: null });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('maps the daemon auth-changed transitions onto the slice', async () => {
    mocks.getStatus.mockResolvedValue({ ...CONFIGURED_STATUS, method: 'device' });
    const run = harness({ ...initialState, isAuthenticating: true, deviceFlow: PENDING_FLOW });

    run.channel.put(gitlabAuthChanged('authorized', HOST));
    await settle();
    expect(run.state()).toMatchObject({
      isConfigured: true,
      isAuthenticating: false,
      deviceFlow: null,
      user: WIRE_USER,
      method: 'device',
    });

    run.channel.put(gitlabAuthChanged('revoked', HOST));
    await settle();
    expect(run.state()).toMatchObject({ isConfigured: false, user: null, method: null });

    for (const [status, message] of [
      ['expired', m.gitlabAuth_service_codeExpired_error()],
      ['denied', m.gitlabAuth_service_denied_error()],
      ['error', m.gitlabAuth_service_failed_error()],
    ] as const) {
      run.channel.put(gitlabAuthChanged(status, HOST));
      await settle();
      expect(run.state().error).toBe(message);
    }
    run.task.cancel();
    await run.task.toPromise();
  });
});
