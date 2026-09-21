import { runSaga, stdChannel } from 'redux-saga';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }));
vi.mock('$lib/client', () => ({
  appClient: { settings: { get: mocks.get, update: mocks.update } },
}));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ error: vi.fn() }),
}));

import { m } from '$shared/paraglide/messages.js';
import {
  identityReducer,
  initializeIdentity,
  initialState,
  setIdentityProviderRequested,
} from '../identity-slice';
import { identitySaga } from './identity-saga';

const settle = async () => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
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

function harness(seed = initialState) {
  const channel = stdChannel();
  let state = seed;
  const dispatched: unknown[] = [];
  const dispatch = (action: never) => {
    dispatched.push(action);
    state = identityReducer(state, action);
    channel.put(action);
    return action;
  };
  const task = runSaga({ channel, dispatch, getState: () => ({ identity: state }) }, identitySaga);
  return { channel, dispatched, state: () => state, task };
}

describe('identitySaga', () => {
  beforeEach(() => vi.clearAllMocks());

  it('initialize reads identity.provider through settings.get and mirrors a known forge', async () => {
    mocks.get.mockResolvedValue(settingRow('gitlab'));
    const run = harness();
    run.channel.put(initializeIdentity());
    await settle();

    expect(mocks.get.mock.calls).toEqual([['identity.provider']]);
    expect(run.dispatched).toEqual([{ type: 'identity/loaded', payload: ['gitlab'] }]);
    expect(run.state()).toMatchObject({ provider: 'gitlab', loadStatus: 'loaded' });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('reads an unset or unknown value as no explicit provider', async () => {
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
      { type: 'identity/loaded', payload: [null] },
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('marks the load as failed when the daemon rejects the path (older daemon)', async () => {
    mocks.get.mockRejectedValue(new Error('unknown setting'));
    const run = harness();
    run.channel.put(initializeIdentity());
    await settle();

    expect(run.dispatched).toEqual([{ type: 'identity/loadFailed', payload: [] }]);
    expect(run.state().loadStatus).toBe('error');
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
