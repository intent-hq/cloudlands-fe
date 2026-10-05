import { runSaga, stdChannel } from 'redux-saga';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), request: vi.fn() }));
vi.mock('$lib/client', () => ({
  appClient: { settings: { get: mocks.get, update: mocks.update } },
}));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: mocks.request,
}));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ error: vi.fn() }),
}));

import { m } from '$shared/paraglide/messages.js';
import type { StoreState } from '../../../types';
import { initialState as daemonHealthInitial } from '../../daemon-health/daemon-health-slice';
import {
  identityChanged,
  identityReducer,
  initializeIdentity,
  initialState,
  setIdentityProviderRequested,
} from '../identity-slice';
import { identitySaga } from './identity-saga';

const settle = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};

/** `settings.get` row (§5.12) for the identity setting. */
function settingRow(value: unknown) {
  return {
    path: 'identity.provider',
    value,
    type: 'string',
    label: 'Identity provider',
    description: '',
    sensitive: false,
  };
}

const gitlabTriple = { provider: 'gitlab', host: 'gitlab.example.com', externalUserId: '7' };

/** `principal.me` reply (§5.46); `identity` omitted on the wire while unlinked. */
function principalMe(identity: typeof gitlabTriple | null, login: string | null) {
  return {
    id: 'principal-1',
    login,
    displayName: null,
    avatarUrl: null,
    isAdministrator: true,
    ...(identity ? { identity } : {}),
  };
}

/** The `system.status` stats the capability gate reads; the seam ships within the 10.x line. */
const SEAM_VERSION = '10.8'; // protocol-version-ok: fixture for the capability gate under test
const PRE_SEAM_VERSION = '10.7'; // protocol-version-ok: fixture for the capability gate under test

function daemonHealth(protocolVersion: string) {
  return {
    ...daemonHealthInitial,
    stats: { clients: 0, agents: 0, listenMode: 'uds', os: 'linux', arch: 'x64', protocolVersion },
  };
}

function harness(seed = initialState, protocolVersion = SEAM_VERSION) {
  const channel = stdChannel();
  let state = seed;
  let health = daemonHealth(protocolVersion);
  const dispatched: unknown[] = [];
  const listeners = new Set<() => void>();
  const getState = () => ({ identity: state, daemonHealth: health }) as unknown as StoreState;
  const dispatch = (action: never) => {
    dispatched.push(action);
    state = identityReducer(state, action);
    channel.put(action);
    listeners.forEach((listener) => listener());
    return action;
  };
  const reduxStore = {
    getState,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const task = runSaga({ channel, dispatch, getState, context: { reduxStore } }, identitySaga);
  const setProtocolVersion = (version: string) => {
    health = daemonHealth(version);
    listeners.forEach((listener) => listener());
  };
  return { channel, dispatched, state: () => state, task, setProtocolVersion };
}

describe('identitySaga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.request.mockResolvedValue(principalMe(null, null));
  });

  it('initialize reads identity.provider through settings.get, then principal.me for the held identity', async () => {
    mocks.get.mockResolvedValue(settingRow('gitlab'));
    mocks.request.mockResolvedValue(principalMe(gitlabTriple, 'gl-user'));
    const run = harness();
    run.channel.put(initializeIdentity());
    await settle();

    expect(mocks.get.mock.calls).toEqual([['identity.provider']]);
    expect(mocks.request.mock.calls).toEqual([['principal.me', {}]]);
    expect(run.dispatched).toEqual([
      { type: 'identity/loaded', payload: ['gitlab'] },
      { type: 'identity/principalLoaded', payload: [gitlabTriple, 'gl-user'] },
    ]);
    expect(run.state()).toMatchObject({
      provider: 'gitlab',
      loadStatus: 'loaded',
      currentIdentity: gitlabTriple,
      currentLogin: 'gl-user',
      principalLoaded: true,
    });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('reads an unset or unknown value as no explicit provider, and an omitted identity as unlinked', async () => {
    mocks.get
      .mockResolvedValueOnce(settingRow(null))
      .mockResolvedValueOnce(settingRow('bitbucket'));
    const run = harness();
    run.channel.put(initializeIdentity());
    await settle();
    run.channel.put(initializeIdentity());
    await settle();

    expect(run.dispatched).toEqual([
      { type: 'identity/loaded', payload: [null] },
      { type: 'identity/principalLoaded', payload: [null, null] },
      { type: 'identity/loaded', payload: [null] },
      { type: 'identity/principalLoaded', payload: [null, null] },
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('marks the load as failed when the daemon rejects the path, still reading principal.me', async () => {
    mocks.get.mockRejectedValue(new Error('unknown setting'));
    const run = harness();
    run.channel.put(initializeIdentity());
    await settle();

    expect(run.dispatched).toEqual([
      { type: 'identity/loadFailed', payload: [] },
      { type: 'identity/principalLoaded', payload: [null, null] },
    ]);
    expect(run.state().loadStatus).toBe('error');
    run.task.cancel();
    await run.task.toPromise();
  });

  it('keeps the previous principal when principal.me itself fails', async () => {
    mocks.get.mockResolvedValue(settingRow(null));
    mocks.request.mockRejectedValue(new Error('-32601'));
    const run = harness({
      ...initialState,
      currentIdentity: gitlabTriple,
      currentLogin: 'gl-user',
    });
    run.channel.put(initializeIdentity());
    await settle();

    expect(run.dispatched).toEqual([{ type: 'identity/loaded', payload: [null] }]);
    expect(run.state()).toMatchObject({ currentIdentity: gitlabTriple, currentLogin: 'gl-user' });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('re-reads principal.me for the new login when principal:identity-changed arrives', async () => {
    mocks.request.mockResolvedValue(principalMe(gitlabTriple, 'gl-user'));
    const run = harness({ ...initialState, loadStatus: 'loaded', currentLogin: 'octocat' });
    run.channel.put(identityChanged(gitlabTriple));
    await settle();

    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.request.mock.calls).toEqual([['principal.me', {}]]);
    expect(run.dispatched).toEqual([
      { type: 'identity/principalLoaded', payload: [gitlabTriple, 'gl-user'] },
    ]);
    expect(run.state()).toMatchObject({ currentIdentity: gitlabTriple, currentLogin: 'gl-user' });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('sends nothing to a daemon without the identity seam: unset, unlinked, and a refused save', async () => {
    const run = harness(initialState, PRE_SEAM_VERSION);
    run.channel.put(initializeIdentity());
    await settle();
    run.channel.put(identityChanged(gitlabTriple));
    await settle();
    run.channel.put(setIdentityProviderRequested('gitlab'));
    await settle();

    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(run.dispatched).toEqual([
      { type: 'identity/loaded', payload: [null] },
      {
        type: 'identity/providerSaveFailed',
        payload: [m.settings_connections_identity_saveFailed_error()],
      },
    ]);
    expect(run.state()).toMatchObject({ provider: null, loadStatus: 'loaded', saving: false });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('runs the real read once the daemon proves the seam after an early initialize', async () => {
    mocks.get.mockResolvedValue(settingRow('gitlab'));
    mocks.request.mockResolvedValue(principalMe(gitlabTriple, 'gl-user'));
    const run = harness(initialState, PRE_SEAM_VERSION);
    run.channel.put(initializeIdentity());
    await settle();
    expect(mocks.get).not.toHaveBeenCalled();

    run.setProtocolVersion(SEAM_VERSION);
    await settle();

    expect(mocks.get.mock.calls).toEqual([['identity.provider']]);
    expect(mocks.request.mock.calls).toEqual([['principal.me', {}]]);
    expect(run.state()).toMatchObject({
      provider: 'gitlab',
      currentIdentity: gitlabTriple,
      currentLogin: 'gl-user',
    });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('does not read on the capability flip while nobody asked for the identity yet', async () => {
    const run = harness(initialState, PRE_SEAM_VERSION);
    run.setProtocolVersion(SEAM_VERSION);
    await settle();

    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(run.dispatched).toEqual([]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('writes the chosen provider with the exact settings.update batch and settles the save', async () => {
    mocks.update.mockResolvedValue([{ path: 'identity.provider', value: 'gitlab' }]);
    const run = harness({ ...initialState, provider: 'github', loadStatus: 'loaded' });
    run.channel.put(setIdentityProviderRequested('gitlab'));
    await settle();

    expect(mocks.update.mock.calls).toEqual([[[{ path: 'identity.provider', value: 'gitlab' }]]]);
    expect(run.dispatched).toEqual([{ type: 'identity/providerSaved', payload: ['gitlab'] }]);
    expect(run.state()).toMatchObject({ provider: 'gitlab', saving: false, error: null });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('keeps the previous provider and surfaces the error when the write is refused', async () => {
    mocks.update.mockRejectedValue(new Error('-32602'));
    const run = harness({ ...initialState, provider: 'github', loadStatus: 'loaded' });
    run.channel.put(setIdentityProviderRequested('gitlab'));
    await settle();

    expect(run.dispatched).toEqual([
      {
        type: 'identity/providerSaveFailed',
        payload: [m.settings_connections_identity_saveFailed_error()],
      },
    ]);
    expect(run.state()).toMatchObject({
      provider: 'github',
      saving: false,
      error: m.settings_connections_identity_saveFailed_error(),
    });
    run.task.cancel();
    await run.task.toPromise();
  });
});
