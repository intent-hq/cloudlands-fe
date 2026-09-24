import { Store } from '@augmentcode/themis/svelte-store';
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
// The real Themis store below is built outside a Svelte component.
vi.mock('svelte', async (importOriginal) => ({
  ...(await importOriginal<typeof import('svelte')>()),
  getContext: () => undefined,
}));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ error: vi.fn() }),
}));

import { m } from '$shared/paraglide/messages.js';
import {
  cancelGitLabAuth,
  checkGitLabAuthStatus,
  connectGitLabWithToken,
  gitlabAuthChanged,
  gitlabAuthReducer,
  initializeGitLabAuth,
  initialState,
  logoutGitLab,
  startGitLabDeviceAuth,
  takeGitLabPatToken,
} from '../gitlab-auth-slice';
import {
  initialState as preferenceDefaults,
  userPreferencesReducer,
  setLabsGitLabEnabled,
} from '../../user-preferences/user-preferences-slice';
import { gitlabAuthSaga } from './gitlab-auth-saga';

const settle = async () => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

const HOST = 'gitlab.example.com';
/** A second, already-connected instance (the daemon's persisted default host). */
const OTHER_HOST = 'gitlab.com';
const WIRE_USER = { id: '7', login: 'octo', displayName: 'Octo', avatarUrl: 'https://a/b.png' };
/** The device codes the slice holds (`sourceControl.connect` result minus `ok`). */
const PENDING_INFO = {
  userCode: 'ABCD-1234',
  verificationUri: 'https://gitlab.example.com/oauth/device',
  expiresIn: 600,
  interval: 5,
};
/** `sourceControl.authStatus.deviceFlow` while that grant is pending. */
const PENDING_FLOW = { status: 'pending', ...PENDING_INFO };
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

function harness(seed = initialState, labsGitLabEnabled = false) {
  let userPreferences = { ...preferenceDefaults, labsGitLabEnabled };
  const channel = stdChannel();
  let state = seed;
  const dispatched: unknown[] = [];
  const dispatch = (action: never) => {
    dispatched.push(action);
    state = gitlabAuthReducer(state, action);
    userPreferences = userPreferencesReducer(userPreferences, action);
    channel.put(action);
    return action;
  };
  const task = runSaga(
    { channel, dispatch, getState: () => ({ gitlabAuth: state, userPreferences }) },
    gitlabAuthSaga,
  );
  return { channel, dispatched, dispatch, state: () => state, task };
}

describe('gitlabAuthSaga', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses new GitLab device/PAT setup while off and consumes the staged token', async () => {
    const run = harness();
    try {
      run.channel.put(startGitLabDeviceAuth(HOST));
      const pat = connectGitLabWithToken(HOST, 'secret-pat');
      run.channel.put(pat);
      await settle();
      expect(mocks.connect).not.toHaveBeenCalled();
      expect(takeGitLabPatToken(pat.payload.tokenRef)).toBeNull();
      expect(run.state()).toEqual(initialState);
    } finally {
      run.task.cancel();
      await run.task.toPromise();
    }
  });

  it('cancels a pending grant on disable, ignores a late result, and preserves saved credentials', async () => {
    let finish!: (result: unknown) => void;
    mocks.connect.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    mocks.cancelAuth.mockResolvedValue({ success: true });
    const saved = {
      ...initialState,
      host: HOST,
      isConfigured: true,
      user: WIRE_USER,
      method: 'pat' as const,
    };
    const run = harness(saved, true);
    try {
      run.channel.put(startGitLabDeviceAuth(HOST));
      await settle();
      expect(run.state().isAuthenticating).toBe(true);
      run.dispatch(setLabsGitLabEnabled(false) as never);
      await settle();
      expect(mocks.cancelAuth.mock.calls).toEqual([['gitlab', HOST]]);
      finish({ success: true, deviceFlow: PENDING_FLOW });
      await settle();
      expect(run.state()).toMatchObject({ ...saved, isAuthenticating: false, deviceFlow: null });
      expect(mocks.revoke).not.toHaveBeenCalled();
      expect(mocks.getStatus).not.toHaveBeenCalled();
    } finally {
      run.task.cancel();
      await run.task.toPromise();
    }
  });

  it('cancels a hydrated pending grant while off without dropping the saved connection', async () => {
    mocks.getStatus.mockResolvedValue({ ...CONFIGURED_STATUS, deviceFlow: PENDING_FLOW });
    mocks.cancelAuth.mockResolvedValue({ success: true });
    const run = harness();
    try {
      run.channel.put(initializeGitLabAuth());
      await settle();
      expect(mocks.cancelAuth.mock.calls).toEqual([['gitlab', HOST]]);
      expect(run.state()).toMatchObject({
        host: HOST,
        isConfigured: true,
        user: WIRE_USER,
        isAuthenticating: false,
        deviceFlow: null,
      });
      expect(mocks.revoke).not.toHaveBeenCalled();
    } finally {
      run.task.cancel();
      await run.task.toPromise();
    }
  });

  it('resumes a pending grant when the saved opt-in arrives before delayed auth hydration', async () => {
    let finish!: (status: unknown) => void;
    mocks.getStatus.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    mocks.getStatus.mockResolvedValue({ ...UNCONFIGURED_STATUS, deviceFlow: PENDING_FLOW });
    const run = harness();
    try {
      run.channel.put(initializeGitLabAuth());
      run.dispatch(setLabsGitLabEnabled(true) as never);
      finish({ ...UNCONFIGURED_STATUS, deviceFlow: PENDING_FLOW });
      await settle();
      expect(run.state()).toMatchObject({
        host: HOST,
        isAuthenticating: true,
        deviceFlow: PENDING_INFO,
      });
      expect(mocks.cancelAuth).not.toHaveBeenCalled();
    } finally {
      run.task.cancel();
      await run.task.toPromise();
    }
  });

  it('verifier: a focus read begun before default-host hydration cannot attach the old identity', async () => {
    let resolveDefault!: (value: unknown) => void;
    let resolveFocus!: (value: unknown) => void;
    mocks.getStatus.mockImplementation(
      (_provider: string, host?: string) =>
        new Promise((resolve) => {
          if (host === undefined) resolveDefault = resolve;
          else resolveFocus = resolve;
        }),
    );
    const run = harness(initialState, true);
    try {
      run.channel.put(initializeGitLabAuth());
      await settle();
      run.channel.put(checkGitLabAuthStatus());
      await settle();
      expect(mocks.getStatus).toHaveBeenLastCalledWith('gitlab', OTHER_HOST);
      resolveDefault({ ...UNCONFIGURED_STATUS, host: HOST });
      await settle();
      expect(run.state()).toMatchObject({ host: HOST, isConfigured: false, user: null });
      resolveFocus({ ...CONFIGURED_STATUS, host: OTHER_HOST });
      await settle();
      expect(run.state()).toMatchObject({ host: HOST, isConfigured: false, user: null });
    } finally {
      run.task.cancel();
      await run.task.toPromise();
    }
  });

  it('verifier: target-host authorization during initialize cannot attach its identity to the old host', async () => {
    let resolveInitial!: (value: unknown) => void;
    mocks.getStatus.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveInitial = resolve;
        }),
    );
    mocks.getStatus.mockResolvedValue({ ...CONFIGURED_STATUS, host: HOST });
    const run = harness(initialState, true);
    try {
      run.channel.put(initializeGitLabAuth(HOST));
      await settle();
      run.channel.put(gitlabAuthChanged('authorized', HOST));
      await settle();
      resolveInitial({ ...UNCONFIGURED_STATUS, host: HOST });
      await settle();
      expect(run.state()).toMatchObject({ host: HOST, isConfigured: true, user: WIRE_USER });
    } finally {
      run.task.cancel();
      await run.task.toPromise();
    }
  });

  it.each(['revoked', 'denied'] as const)(
    'verifier: target-host %s during initialize preserves the requested host',
    async (status) => {
      let resolveInitial!: (value: unknown) => void;
      mocks.getStatus.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveInitial = resolve;
          }),
      );
      const run = harness(initialState, true);
      try {
        run.channel.put(initializeGitLabAuth(HOST));
        await settle();
        run.channel.put(gitlabAuthChanged(status, HOST));
        await settle();
        resolveInitial({ ...UNCONFIGURED_STATUS, host: HOST });
        await settle();
        expect(run.state()).toMatchObject({ host: HOST, isConfigured: false, user: null });
      } finally {
        run.task.cancel();
        await run.task.toPromise();
      }
    },
  );

  it('verifier: a rejected stale authorized read cannot run completion fallback on a newer host', async () => {
    let rejectOld!: (reason: Error) => void;
    mocks.getStatus.mockImplementation((_provider: string, host?: string) =>
      host === OTHER_HOST
        ? new Promise((_resolve, reject) => {
            rejectOld = reject;
          })
        : Promise.resolve({ ...UNCONFIGURED_STATUS, host: HOST }),
    );
    const run = harness(initialState, true);
    try {
      run.channel.put(gitlabAuthChanged('authorized', OTHER_HOST));
      await settle();
      run.channel.put(initializeGitLabAuth(HOST));
      await settle();
      expect(run.state()).toMatchObject({ host: HOST, isConfigured: false });
      rejectOld(new Error('status unavailable'));
      await settle();
      expect(run.state()).toMatchObject({ host: HOST, isConfigured: false, user: null });
    } finally {
      run.task.cancel();
      await run.task.toPromise();
    }
  });

  it('verifier: an old-host event during the new host read cannot cancel the requested selection', async () => {
    let resolveNew!: (value: unknown) => void;
    mocks.getStatus.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveNew = resolve;
        }),
    );
    const run = harness(initialState, true);
    try {
      run.channel.put(initializeGitLabAuth(HOST));
      await settle();
      run.channel.put(gitlabAuthChanged('revoked', OTHER_HOST));
      await settle();
      resolveNew({ ...UNCONFIGURED_STATUS, host: HOST });
      await settle();
      expect(run.state()).toMatchObject({ host: HOST, isConfigured: false, user: null });
    } finally {
      run.task.cancel();
      await run.task.toPromise();
    }
  });

  it('initialize reads sourceControl.authStatus for the host and hydrates field by field', async () => {
    mocks.getStatus.mockResolvedValue(CONFIGURED_STATUS);
    const run = harness(initialState, true);
    run.channel.put(initializeGitLabAuth(HOST));
    await settle();

    expect(mocks.getStatus.mock.calls).toEqual([['gitlab', HOST]]);
    // The requested host is selected before the read so daemon events for it
    // (and for the host being left) are filtered correctly while it is in flight.
    expect(run.dispatched).toEqual([
      { type: 'gitlabAuth/setHost', payload: [HOST] },
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
    const run = harness(initialState, true);
    run.channel.put(initializeGitLabAuth());
    await settle();

    // The first read lets the daemon resolve its configured instance; the
    // resumed poll is then bound to the host that read reported.
    expect(mocks.getStatus.mock.calls).toEqual([
      ['gitlab', undefined],
      ['gitlab', HOST],
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

  it('a slow mount-time read for the default host cannot overwrite a later-initialized host', async () => {
    let resolveDefault!: (value: unknown) => void;
    let resolveScoped!: (value: unknown) => void;
    mocks.getStatus.mockImplementation(
      (_provider: string, host?: string) =>
        new Promise((resolve) => {
          if (host === undefined) resolveDefault = resolve;
          else resolveScoped = resolve;
        }),
    );
    const run = harness(initialState, true);
    run.channel.put(initializeGitLabAuth());
    await settle();
    run.channel.put(initializeGitLabAuth(HOST));
    await settle();
    expect(mocks.getStatus.mock.calls).toEqual([
      ['gitlab', undefined],
      ['gitlab', HOST],
    ]);

    resolveScoped({ ...UNCONFIGURED_STATUS, host: HOST });
    await settle();
    const hydratedB = {
      host: HOST,
      isConfigured: false,
      deviceGrantSupported: true,
      user: null,
      method: null,
    };
    expect(run.state()).toMatchObject(hydratedB);

    // The default host's read lands last: A's connection must not replace B.
    resolveDefault({ ...CONFIGURED_STATUS, host: OTHER_HOST, method: 'device' });
    await settle();
    expect(run.state()).toMatchObject(hydratedB);
    expect(
      run.dispatched.filter((a) => (a as { type: string }).type === 'gitlabAuth/setAuthStatus'),
    ).toHaveLength(1);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('a stale default-host read cannot overwrite a grant the user started against another host', async () => {
    let resolveDefault!: (value: unknown) => void;
    mocks.getStatus.mockImplementation((_provider: string, host?: string) => {
      if (host === undefined)
        return new Promise((resolve) => {
          resolveDefault = resolve;
        });
      return Promise.resolve({ ...UNCONFIGURED_STATUS, host: HOST, deviceFlow: PENDING_FLOW });
    });
    mocks.connect.mockResolvedValue({ success: true, deviceFlow: PENDING_INFO });
    const run = harness(initialState, true);
    run.channel.put(initializeGitLabAuth());
    await settle();
    run.channel.put(startGitLabDeviceAuth(HOST));
    await settle();
    const pendingOnB = {
      host: HOST,
      isConfigured: false,
      isAuthenticating: true,
      deviceFlow: PENDING_INFO,
      user: null,
    };
    expect(run.state()).toMatchObject(pendingOnB);

    resolveDefault({ ...CONFIGURED_STATUS, host: OTHER_HOST, method: 'device' });
    await settle();
    expect(run.state()).toMatchObject(pendingOnB);
    expect(run.dispatched.map((a) => (a as { type: string }).type)).not.toContain(
      'gitlabAuth/setAuthStatus',
    );
    run.task.cancel();
    await run.task.toPromise();
  });

  it('a default read begun while the host was already selected cannot replace its new grant', async () => {
    // Selected B, daemon default A: the unscoped read starts and finishes with
    // the selection unchanged, so only the intent that started B's grant can
    // tell it is stale.
    let resolveDefault!: (value: unknown) => void;
    mocks.getStatus.mockImplementation((_provider: string, host?: string) =>
      host === undefined
        ? new Promise((resolve) => {
            resolveDefault = resolve;
          })
        : Promise.resolve({ ...UNCONFIGURED_STATUS, host: HOST, deviceFlow: PENDING_FLOW }),
    );
    mocks.connect.mockResolvedValue({ success: true, deviceFlow: PENDING_INFO });
    const run = harness({ ...initialState, host: HOST }, true);
    run.channel.put(initializeGitLabAuth());
    await settle();
    run.channel.put(startGitLabDeviceAuth(HOST));
    await settle();
    const pendingOnB = { host: HOST, isConfigured: false, deviceFlow: PENDING_INFO };
    expect(run.state()).toMatchObject(pendingOnB);

    resolveDefault({ ...CONFIGURED_STATUS, host: OTHER_HOST });
    await settle();
    expect(run.state()).toMatchObject(pendingOnB);
    expect(run.dispatched.map((a) => (a as { type: string }).type)).not.toContain(
      'gitlabAuth/setAuthStatus',
    );
    run.task.cancel();
    await run.task.toPromise();
  });

  it('an expired-event reconcile that resolves late cannot replace a newer host selection', async () => {
    let resolveOld!: (value: unknown) => void;
    mocks.getStatus.mockImplementation((_provider: string, host?: string) =>
      host === OTHER_HOST
        ? new Promise((resolve) => {
            resolveOld = resolve;
          })
        : Promise.resolve({ ...UNCONFIGURED_STATUS, host: HOST }),
    );
    const run = harness(initialState, true);
    run.channel.put(gitlabAuthChanged('expired', OTHER_HOST));
    await settle();
    run.channel.put(initializeGitLabAuth(HOST));
    await settle();
    const hydratedB = { host: HOST, isConfigured: false, user: null };
    expect(run.state()).toMatchObject(hydratedB);

    resolveOld({ ...CONFIGURED_STATUS, host: OTHER_HOST });
    await settle();
    expect(run.state()).toMatchObject(hydratedB);
    expect(
      run.dispatched.filter((a) => (a as { type: string }).type === 'gitlabAuth/setAuthStatus'),
    ).toHaveLength(1);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('an authorized-event completion that resolves late cannot attach the old identity to a newer host', async () => {
    let resolveOld!: (value: unknown) => void;
    mocks.getStatus.mockImplementation((_provider: string, host?: string) =>
      host === OTHER_HOST
        ? new Promise((resolve) => {
            resolveOld = resolve;
          })
        : Promise.resolve({ ...UNCONFIGURED_STATUS, host: HOST }),
    );
    const run = harness(initialState, true);
    run.channel.put(gitlabAuthChanged('authorized', OTHER_HOST));
    await settle();
    run.channel.put(initializeGitLabAuth(HOST));
    await settle();
    const hydratedB = { host: HOST, isConfigured: false, user: null, method: null };
    expect(run.state()).toMatchObject(hydratedB);

    resolveOld({ ...CONFIGURED_STATUS, host: OTHER_HOST });
    await settle();
    expect(run.state()).toMatchObject(hydratedB);
    expect(run.dispatched.map((a) => (a as { type: string }).type)).not.toContain(
      'gitlabAuth/authCompleted',
    );
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
    const run = harness(initialState, true);
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
    const run = harness({ ...initialState, deviceGrantSupported: true }, true);
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
    const run = harness(initialState, true);
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
    const run = harness(initialState, true);
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
    const run = harness(initialState, true);
    run.channel.put(startGitLabDeviceAuth(HOST));
    await settle();
    run.channel.put(cancelGitLabAuth());
    await settle();
    resolveStatus({ ...CONFIGURED_STATUS, method: 'device' });
    await settle();

    expect(mocks.cancelAuth.mock.calls).toEqual([['gitlab', HOST]]);
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

  it('settles logout only after the daemon confirms the revoke for the selected host', async () => {
    mocks.revoke.mockResolvedValueOnce({ success: false, error: 'still held' });
    mocks.revoke.mockResolvedValueOnce({ success: true });
    const run = harness(
      {
        ...initialState,
        host: HOST,
        isConfigured: true,
        user: WIRE_USER,
        method: 'pat',
      },
      true,
    );
    run.channel.put(logoutGitLab());
    await settle();
    expect(run.state().isConfigured).toBe(true);
    expect(run.dispatched.at(-1)).toEqual({ type: 'gitlabAuth/setError', payload: ['still held'] });

    run.channel.put(logoutGitLab());
    await settle();
    expect(mocks.revoke.mock.calls).toEqual([
      ['gitlab', HOST],
      ['gitlab', HOST],
    ]);
    expect(run.state()).toMatchObject({ isConfigured: false, user: null, method: null });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('keeps a grant against instance B bound to B while instance A is the connected default', async () => {
    // Daemon default host = A (persisted after A's connect). Every read, cancel
    // and event during B's grant must name B, or A's connection completes B's UI.
    const statusFor = (host: string) =>
      host === OTHER_HOST
        ? { ...CONFIGURED_STATUS, host: OTHER_HOST, method: 'device' }
        : { ...UNCONFIGURED_STATUS, host: HOST, deviceFlow: PENDING_FLOW };
    mocks.getStatus.mockImplementation(async (_provider: string, host?: string) =>
      statusFor(host ?? OTHER_HOST),
    );
    mocks.connect.mockResolvedValue({ success: true, deviceFlow: PENDING_INFO });
    mocks.cancelAuth.mockResolvedValue({ success: true });
    const run = harness(
      {
        ...initialState,
        host: OTHER_HOST,
        isConfigured: true,
        user: WIRE_USER,
        method: 'device',
      },
      true,
    );
    // Switching to B drops A's identity: B is unconfigured until B connects.
    const identityB = { host: HOST, isConfigured: false, user: null, method: null };
    const pendingOnB = { ...identityB, isAuthenticating: true, deviceFlow: PENDING_INFO };

    run.channel.put(startGitLabDeviceAuth(HOST));
    await settle();
    expect(mocks.getStatus.mock.calls).toEqual([['gitlab', HOST]]);
    expect(run.state()).toMatchObject(pendingOnB);
    expect(run.dispatched.map((action) => (action as { type: string }).type)).not.toContain(
      'gitlabAuth/authCompleted',
    );

    // A transition on A neither completes nor tears down B's pending grant.
    run.channel.put(gitlabAuthChanged('revoked', OTHER_HOST));
    await settle();
    expect(run.state()).toMatchObject(pendingOnB);
    run.channel.put(gitlabAuthChanged('authorized', OTHER_HOST));
    await settle();
    expect(run.state()).toMatchObject(pendingOnB);
    expect(mocks.getStatus.mock.calls).toEqual([['gitlab', HOST]]);

    // Cancelling B leaves B unconfigured — never B carrying A's user/method.
    run.channel.put(cancelGitLabAuth());
    await settle();
    expect(mocks.cancelAuth.mock.calls).toEqual([['gitlab', HOST]]);
    expect(run.state()).toMatchObject({ ...identityB, isAuthenticating: false, deviceFlow: null });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('a rejected PAT for instance B does not leave B configured with A’s identity', async () => {
    mocks.connect.mockResolvedValue({ success: false, error: 'bad token' });
    const run = harness(
      {
        ...initialState,
        host: OTHER_HOST,
        isConfigured: true,
        user: WIRE_USER,
        method: 'pat',
      },
      true,
    );

    run.channel.put(connectGitLabWithToken(HOST, 'glpat-x'));
    await settle();
    expect(mocks.getStatus).not.toHaveBeenCalled();
    expect(run.state()).toMatchObject({
      host: HOST,
      isConfigured: false,
      isAuthenticating: false,
      user: null,
      method: null,
      deviceFlow: null,
      error: 'bad token',
    });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('a same-host reconnect keeps the configured identity while the new grant is pending', async () => {
    mocks.getStatus.mockResolvedValue({ ...CONFIGURED_STATUS, deviceFlow: PENDING_FLOW });
    mocks.connect.mockResolvedValue({ success: true, deviceFlow: PENDING_INFO });
    const run = harness(
      {
        ...initialState,
        host: HOST,
        isConfigured: true,
        user: WIRE_USER,
        method: 'pat',
      },
      true,
    );

    run.channel.put(startGitLabDeviceAuth(HOST.toUpperCase()));
    await settle();
    expect(run.state()).toMatchObject({
      host: HOST.toUpperCase(),
      isConfigured: true,
      isAuthenticating: true,
      user: WIRE_USER,
      method: 'pat',
      deviceFlow: PENDING_INFO,
    });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('completes a grant against instance B from B’s own authorized event', async () => {
    mocks.getStatus
      .mockResolvedValueOnce({ ...UNCONFIGURED_STATUS, host: HOST, deviceFlow: PENDING_FLOW })
      .mockResolvedValueOnce({ ...CONFIGURED_STATUS, host: HOST, method: 'device' });
    mocks.connect.mockResolvedValue({ success: true, deviceFlow: PENDING_INFO });
    const run = harness({ ...initialState, host: OTHER_HOST, isConfigured: true }, true);

    run.channel.put(startGitLabDeviceAuth(HOST));
    await settle();
    run.channel.put(gitlabAuthChanged('authorized', HOST.toUpperCase()));
    await settle();

    expect(mocks.getStatus.mock.calls).toEqual([
      ['gitlab', HOST],
      ['gitlab', HOST],
    ]);
    expect(run.dispatched.at(-1)).toEqual({
      type: 'gitlabAuth/authCompleted',
      payload: { user: WIRE_USER, method: 'device' },
    });
    expect(run.state()).toMatchObject({ host: HOST, isConfigured: true, deviceFlow: null });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('maps the daemon auth-changed transitions onto the slice', async () => {
    mocks.getStatus.mockResolvedValue({ ...CONFIGURED_STATUS, method: 'device' });
    const run = harness(
      {
        ...initialState,
        host: HOST,
        isAuthenticating: true,
        deviceFlow: PENDING_FLOW,
      },
      true,
    );

    run.channel.put(gitlabAuthChanged('authorized', HOST));
    await settle();
    expect(mocks.getStatus.mock.calls).toEqual([['gitlab', HOST]]);
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

  it('expired for a connected host re-reads the status and drops the identity the daemon lost', async () => {
    mocks.getStatus.mockResolvedValue(UNCONFIGURED_STATUS);
    const run = harness(
      {
        ...initialState,
        host: HOST,
        isConfigured: true,
        user: WIRE_USER,
        method: 'device',
      },
      true,
    );

    run.channel.put(gitlabAuthChanged('expired', HOST));
    await settle();

    expect(mocks.getStatus.mock.calls).toEqual([['gitlab', HOST]]);
    expect(run.state()).toMatchObject({
      host: HOST,
      isConfigured: false,
      isAuthenticating: false,
      deviceFlow: null,
      user: null,
      method: null,
      error: m.gitlabAuth_service_codeExpired_error(),
    });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('an expired pending grant keeps an independently valid credential for the same host', async () => {
    mocks.getStatus.mockResolvedValue(CONFIGURED_STATUS);
    const run = harness(
      {
        ...initialState,
        host: HOST,
        isConfigured: true,
        user: WIRE_USER,
        method: 'pat',
        isAuthenticating: true,
        deviceFlow: PENDING_INFO,
      },
      true,
    );

    run.channel.put(gitlabAuthChanged('expired', HOST));
    await settle();

    expect(mocks.getStatus.mock.calls).toEqual([['gitlab', HOST]]);
    expect(run.state()).toMatchObject({
      isConfigured: true,
      isAuthenticating: false,
      deviceFlow: null,
      user: WIRE_USER,
      method: 'pat',
      error: m.gitlabAuth_service_codeExpired_error(),
    });
    expect(JSON.stringify(run.state())).not.toContain('must-not-leak');
    run.task.cancel();
    await run.task.toPromise();
  });

  it('expired never clears the identity blindly when the status read fails', async () => {
    mocks.getStatus.mockRejectedValue(new Error('daemon unreachable'));
    const run = harness(
      {
        ...initialState,
        host: HOST,
        isConfigured: true,
        user: WIRE_USER,
        method: 'pat',
      },
      true,
    );

    run.channel.put(gitlabAuthChanged('expired', HOST));
    await settle();

    expect(run.state()).toMatchObject({
      isConfigured: true,
      user: WIRE_USER,
      method: 'pat',
      error: m.gitlabAuth_service_codeExpired_error(),
    });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('expired for another instance leaves the selected host untouched', async () => {
    mocks.getStatus.mockResolvedValue(UNCONFIGURED_STATUS);
    const run = harness(
      {
        ...initialState,
        host: HOST,
        isConfigured: true,
        user: WIRE_USER,
        method: 'pat',
      },
      true,
    );

    run.channel.put(gitlabAuthChanged('expired', OTHER_HOST));
    await settle();

    expect(mocks.getStatus).not.toHaveBeenCalled();
    expect(run.dispatched).toEqual([]);
    expect(run.state()).toMatchObject({ isConfigured: true, user: WIRE_USER, error: null });
    run.task.cancel();
    await run.task.toPromise();
  });
});

describe('gitlabAuthSaga PAT handling under Redux action logging', () => {
  const CONSOLE_METHODS = ['log', 'info', 'debug', 'warn', 'error', 'groupCollapsed'] as const;

  /** Data-only view of a log record: functions (incl. the vi.fn call ledger) are dropped. */
  const serialize = (value: unknown): string => {
    const seen = new WeakSet<object>();
    return (
      JSON.stringify(value, (_key, val: unknown) => {
        if (typeof val === 'function') return undefined;
        if (val && typeof val === 'object') {
          if (seen.has(val)) return '[cycle]';
          seen.add(val);
        }
        return val;
      }) ?? ''
    );
  };

  it('delivers the PAT to sourceControl.connect while no action log, trace or state carries it', async () => {
    const sentinel = `glpat-${Math.random().toString(36).slice(2)}-sentinel`;
    mocks.connect.mockResolvedValue({ success: true });
    mocks.getStatus.mockResolvedValue(CONFIGURED_STATUS);
    const consoleSpies = CONSOLE_METHODS.map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
    const store = new Store(
      { gitlabAuth: gitlabAuthReducer, userPreferences: userPreferencesReducer },
      undefined,
      {
        logReduxActions: true,
        sagaMonitor: true,
      },
    );
    const traced: unknown[] = [];
    const unobserve = [
      store.traceStreams.reduxAction.observe((event) => traced.push(event)),
      store.traceStreams.sagaMonitor.observe((event) => traced.push(event)),
    ];
    store.init();
    const stopSaga = store.runSaga(gitlabAuthSaga);
    try {
      store.dispatch(setLabsGitLabEnabled(true));
      const action = connectGitLabWithToken(HOST, sentinel);
      store.dispatch(action);
      await settle();

      expect(mocks.connect.mock.calls).toEqual([
        [{ provider: 'gitlab', host: HOST, method: 'pat', token: sentinel }],
      ]);
      expect(store.state.gitlabAuth).toMatchObject({ isConfigured: true, user: WIRE_USER });

      const loggedArgs = consoleSpies.flatMap((spy) => spy.mock.calls.flat());
      const reduxActionEvents = traced.filter((event) => 'prevState' in (event as object));
      expect(reduxActionEvents.length).toBeGreaterThanOrEqual(3);
      expect(loggedArgs.length).toBeGreaterThan(0);
      for (const record of [...traced, ...loggedArgs, store.state]) {
        expect(serialize(record)).not.toContain(sentinel);
      }

      // The handoff is single use: replaying the logged action cannot resend the PAT.
      store.dispatch(action);
      await settle();
      expect(mocks.connect).toHaveBeenCalledTimes(1);
      expect(store.state.gitlabAuth.error).toBe(m.gitlabAuth_service_tokenRejected_error());
      expect(store.state.gitlabAuth.isAuthenticating).toBe(false);
    } finally {
      stopSaga();
      for (const stop of unobserve) stop.unsubscribe();
      store.dispose();
      vi.restoreAllMocks();
    }
  });
});
