import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import type { ProviderProfile } from '$shared/provider-profiles';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('$lib/client', () => ({
  appClient: {
    providers: {
      listProfiles: mocks.list,
      createProfile: mocks.create,
      updateProfile: mocks.update,
      deleteProfile: mocks.remove,
    },
  },
}));
vi.mock('$features/providers/provider-auth-status.client', () => ({
  getProviderAuthVerdicts: vi.fn(),
}));

import {
  initialState,
  providerProfileCheckRequested,
  providerProfileCreateRequested,
  providerProfileDeleteRequested,
  providerProfilesChanged,
  providerProfilesRequested,
  providerProfileUpdateRequested,
  providerSettingsReducer,
  providerSettingsSessionOpened,
} from '../provider-settings-slice';
import {
  initialState as catalogInitialState,
  providerCatalogLoaded,
  providerCatalogReducer,
} from '../../provider-catalog/provider-catalog-slice';
import {
  selectProviderProfileActivationMap,
  selectProviderProfileMutations,
  selectProviderProfilesForBase,
  selectProviderProfileStatusMap,
} from '../provider-settings-selectors';
import { providerProfilesSaga } from './provider-profiles-saga';

const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const row = (id: string, supportsProfiles?: boolean) => ({
  id,
  displayName: id,
  shortName: id,
  command: id,
  canBeDisabled: true,
  visible: true,
  ...(supportsProfiles === undefined ? {} : { supportsProfiles }),
});

function profile(id: string, name: string, base = 'codex'): ProviderProfile {
  return {
    id,
    providerRef: `${base}@${id}`,
    baseProviderId: base,
    name,
    env: [{ key: 'CODEX_HOME', kind: 'set', value: '********' }],
    settingsFingerprint: `fp-${id}`,
    createdAt: '2026-10-17T10:00:00Z',
    updatedAt: '2026-10-17T10:00:00Z',
  };
}

function setup({
  supported = true,
  auth = vi.fn(async () => undefined as boolean | undefined),
} = {}) {
  let current = {
    providerSettings: providerSettingsReducer(initialState, providerSettingsSessionOpened('s1')),
    providerCatalog: providerCatalogReducer(
      catalogInitialState,
      providerCatalogLoaded({
        providers: supported
          ? [row('codex', true), row('claude-code', true), row('auggie', false)]
          : [row('codex')],
      }),
    ),
  };
  const dispatched: unknown[] = [];
  const channel = stdChannel();
  const dispatch = (action: any) => {
    dispatched.push(action);
    current = {
      providerSettings: providerSettingsReducer(current.providerSettings, action),
      providerCatalog: providerCatalogReducer(current.providerCatalog, action),
    };
    channel.put(action);
  };
  const task = runSaga({ channel, dispatch, getState: () => current }, providerProfilesSaga, {
    authStatus: auth,
  });
  const state = () => current as never;
  return { dispatch, task, state, dispatched, auth, current: () => current };
}

let task: Task | undefined;
beforeEach(() => vi.clearAllMocks());
afterEach(() => task?.cancel());

describe('provider profiles saga', () => {
  it('does not call providers.profiles.* when the catalog advertises no profile support', async () => {
    const h = setup({ supported: false });
    task = h.task;
    h.dispatch(providerProfilesRequested());
    await settle();
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('lists profiles, then reports an honest status per profile reference', async () => {
    mocks.list.mockResolvedValue({
      profiles: [
        profile('pwork', 'Work'),
        profile('ppers', 'Personal'),
        profile('pc', 'C', 'claude-code'),
      ],
      revision: 4,
    });
    const auth = vi.fn(async (ref: string) =>
      ref === 'codex@pwork' ? true : ref === 'codex@ppers' ? false : undefined,
    );
    const h = setup({ auth });
    task = h.task;
    h.dispatch(providerProfilesRequested());
    await settle();
    expect(mocks.list).toHaveBeenCalledWith();
    expect(selectProviderProfilesForBase.select(h.state(), 'codex').map((p) => p.name)).toEqual([
      'Work',
      'Personal',
    ]);
    expect(auth.mock.calls.map(([ref]) => ref).sort()).toEqual([
      'claude-code@pc',
      'codex@ppers',
      'codex@pwork',
    ]);
    // A failure for one profile never changes another's verdict; unknown stays configured.
    expect(selectProviderProfileStatusMap.select(h.state())).toEqual({
      pwork: 'ready',
      ppers: 'error',
      pc: 'configured',
    });
  });

  it('collapses a burst of reads and newer events into one trailing list', async () => {
    const first = deferred<{ profiles: ProviderProfile[]; revision: number }>();
    mocks.list
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue({ profiles: [profile('pwork', 'Work')], revision: 7 });
    const h = setup();
    task = h.task;
    h.dispatch(providerProfilesRequested());
    await settle();
    h.dispatch(providerProfilesRequested());
    h.dispatch(providerProfilesRequested());
    h.dispatch(providerProfilesRequested());
    first.resolve({ profiles: [], revision: 5 });
    await settle();
    expect(mocks.list).toHaveBeenCalledTimes(2);

    // An event at or below the shown revision is ignored; a newer one re-reads.
    h.dispatch(providerProfilesChanged(7));
    await settle();
    expect(mocks.list).toHaveBeenCalledTimes(2);
    h.dispatch(providerProfilesChanged(8));
    await settle();
    expect(mocks.list).toHaveBeenCalledTimes(3);
  });

  it('sends typed env values to the daemon without putting them in actions or state', async () => {
    const created = profile('pnew', 'Work');
    mocks.create.mockResolvedValue({ profile: created, revision: 2 });
    const h = setup();
    task = h.task;
    const env = [
      { key: 'ANTHROPIC_API_KEY', kind: 'set' as const, value: 'sk-synthetic-secret' },
      { key: 'EMPTY', kind: 'set' as const, value: '' },
      { key: 'OPENAI_API_KEY', kind: 'unset' as const },
    ];
    h.dispatch(
      providerProfileCreateRequested({
        requestId: 'r1',
        baseProviderId: 'codex',
        name: 'Work',
        env,
      }),
    );
    await settle();
    expect(mocks.create).toHaveBeenCalledWith({ baseProviderId: 'codex', name: 'Work', env });
    expect(JSON.stringify(h.dispatched)).not.toContain('sk-synthetic-secret');
    expect(JSON.stringify(h.current())).not.toContain('sk-synthetic-secret');
    expect(selectProviderProfileMutations.select(h.state()).r1).toMatchObject({
      status: 'success',
      kind: 'create',
    });
    expect(selectProviderProfilesForBase.select(h.state(), 'codex').map((p) => p.id)).toEqual([
      'pnew',
    ]);
    // Saving alone never claims ready: it is checked against the saved profile.
    expect(h.auth).toHaveBeenCalledWith('codex@pnew', true);
    expect(selectProviderProfileStatusMap.select(h.state()).pnew).toBe('configured');
  });

  it('records daemon field errors on the request without changing profiles', async () => {
    mocks.create.mockRejectedValue({
      rpcCode: -32602,
      data: {
        code: 'invalid-params',
        fieldErrors: [{ field: 'env[0].key', code: 'env-key-reserved', message: 'PATH' }],
      },
    });
    const h = setup();
    task = h.task;
    h.dispatch(
      providerProfileCreateRequested({
        requestId: 'r2',
        baseProviderId: 'codex',
        name: 'Work',
        env: [{ key: 'PATH', kind: 'set', value: '/bin' }],
      }),
    );
    await settle();
    expect(selectProviderProfileMutations.select(h.state()).r2).toMatchObject({
      status: 'failure',
      failure: {
        kind: 'fieldErrors',
        fieldErrors: [{ field: 'env[0].key', code: 'env-key-reserved', message: 'PATH' }],
      },
    });
    expect(selectProviderProfilesForBase.select(h.state(), 'codex')).toEqual([]);
  });

  it('keeps the activation summary of an env update and re-checks the saved profile', async () => {
    mocks.list.mockResolvedValue({ profiles: [profile('pwork', 'Work')], revision: 1 });
    const h = setup();
    task = h.task;
    h.dispatch(providerProfilesRequested());
    await settle();
    const updated = { ...profile('pwork', 'Work'), settingsFingerprint: 'fp-2' };
    mocks.update.mockResolvedValue({
      profile: updated,
      revision: 2,
      activation: { envChanged: true, runningProcesses: 2 },
    });
    h.auth.mockClear();
    h.dispatch(
      providerProfileUpdateRequested({
        requestId: 'r3',
        profileId: 'pwork',
        env: [{ key: 'CODEX_HOME', kind: 'keep' }],
      }),
    );
    await settle();
    expect(mocks.update).toHaveBeenCalledWith({
      profileId: 'pwork',
      env: [{ key: 'CODEX_HOME', kind: 'keep' }],
    });
    expect(selectProviderProfileActivationMap.select(h.state()).pwork).toEqual({
      envChanged: true,
      runningProcesses: 2,
    });
    expect(h.auth).toHaveBeenCalledWith('codex@pwork', true);
  });

  it('a rename-only update neither sends env nor re-checks the account', async () => {
    mocks.list.mockResolvedValue({ profiles: [profile('pwork', 'Work')], revision: 1 });
    const h = setup();
    task = h.task;
    h.dispatch(providerProfilesRequested());
    await settle();
    mocks.update.mockResolvedValue({
      profile: { ...profile('pwork', 'Office') },
      revision: 2,
      activation: { envChanged: false, runningProcesses: 0 },
    });
    h.auth.mockClear();
    h.dispatch(
      providerProfileUpdateRequested({ requestId: 'r4', profileId: 'pwork', name: 'Office' }),
    );
    await settle();
    expect(mocks.update).toHaveBeenCalledWith({ profileId: 'pwork', name: 'Office' });
    expect(h.auth).not.toHaveBeenCalled();
    expect(selectProviderProfilesForBase.select(h.state(), 'codex')[0].name).toBe('Office');
    expect(selectProviderProfileActivationMap.select(h.state()).pwork).toBeUndefined();
  });

  it('removes a deleted profile, and keeps it with named reasons when the daemon refuses', async () => {
    mocks.list.mockResolvedValue({
      profiles: [profile('pwork', 'Work'), profile('ppers', 'Personal')],
      revision: 1,
    });
    const h = setup();
    task = h.task;
    h.dispatch(providerProfilesRequested());
    await settle();
    mocks.remove
      .mockRejectedValueOnce({
        rpcCode: -32602,
        data: { code: 'provider-profile-in-use', inUse: [{ kind: 'defaultProvider' }] },
      })
      .mockResolvedValueOnce({ profileId: 'ppers', revision: 2 });
    h.dispatch(providerProfileDeleteRequested({ requestId: 'd1', profileId: 'pwork' }));
    h.dispatch(providerProfileDeleteRequested({ requestId: 'd2', profileId: 'ppers' }));
    await settle();
    expect(mocks.remove.mock.calls).toEqual([['pwork'], ['ppers']]);
    const outcomes = selectProviderProfileMutations.select(h.state());
    expect(outcomes.d1).toMatchObject({
      status: 'failure',
      failure: { kind: 'inUse', inUse: [{ kind: 'defaultProvider' }] },
    });
    expect(outcomes.d2.status).toBe('success');
    expect(selectProviderProfilesForBase.select(h.state(), 'codex').map((p) => p.id)).toEqual([
      'pwork',
    ]);
  });

  it('re-checks one profile on request with a forced probe', async () => {
    mocks.list.mockResolvedValue({ profiles: [profile('pwork', 'Work')], revision: 1 });
    const h = setup();
    task = h.task;
    h.dispatch(providerProfilesRequested());
    await settle();
    h.auth.mockClear();
    h.auth.mockResolvedValue(true);
    h.dispatch(providerProfileCheckRequested('pwork'));
    await settle();
    expect(h.auth).toHaveBeenCalledWith('codex@pwork', true);
    expect(selectProviderProfileStatusMap.select(h.state()).pwork).toBe('ready');
  });
});
