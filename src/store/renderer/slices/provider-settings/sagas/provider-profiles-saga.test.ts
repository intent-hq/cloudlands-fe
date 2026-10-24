import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import type { ProviderProfile } from '$shared/provider-profiles';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  reorder: vi.fn(),
  updateDefault: vi.fn(),
  catalog: vi.fn(),
}));
vi.mock('$lib/client', () => ({
  appClient: {
    providers: {
      listProfiles: mocks.list,
      createProfile: mocks.create,
      updateProfile: mocks.update,
      deleteProfile: mocks.remove,
      reorderProfiles: mocks.reorder,
      updateDefault: mocks.updateDefault,
      catalog: mocks.catalog,
    },
  },
}));
vi.mock('$features/providers/provider-auth-status.client', () => ({
  getProviderAuthVerdicts: vi.fn(),
}));

import {
  initialState,
  providerDefaultUpdateRequested,
  providerProfileCheckRequested,
  providerProfileCreateRequested,
  providerProfileDeleteRequested,
  providerProfileReorderRequested,
  providerProfilesChanged,
  providerProfilesRequested,
  providerProfileSummaryStatusesEnsured,
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
  selectProviderDefaultConfig,
  selectProviderProfileActivationMap,
  selectProviderProfileMutations,
  selectProviderProfilesForBase,
  selectProviderProfileStatusMap,
} from '../provider-settings-selectors';
import { providerProfilesSaga } from './provider-profiles-saga';
import { selectProfileSignInStatuses } from '../provider-profile-status-selectors';
import { selectProviderCatalogProfiles } from '../../provider-catalog/provider-catalog-selectors';

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

describe('backup failover controls (§5.54)', () => {
  const withBackup = (id: string, name: string, backup = false) => ({
    ...profile(id, name),
    backup,
  });

  async function loadedWith(profiles: ProviderProfile[], revision = 3) {
    mocks.list.mockResolvedValue({ profiles, revision });
    const h = setup();
    task = h.task;
    h.dispatch(providerProfilesRequested());
    await settle();
    return h;
  }

  it('sends backup on create and update and keeps it from the saved result', async () => {
    const h = await loadedWith([withBackup('pwork', 'Work')]);
    mocks.create.mockResolvedValue({ profile: withBackup('pnew', 'Spare', true), revision: 4 });
    h.dispatch(
      providerProfileCreateRequested({
        requestId: 'c1',
        baseProviderId: 'codex',
        name: 'Spare',
        backup: true,
      }),
    );
    await settle();
    expect(mocks.create).toHaveBeenCalledWith({
      baseProviderId: 'codex',
      name: 'Spare',
      backup: true,
    });
    mocks.update.mockResolvedValue({
      profile: withBackup('pwork', 'Work', true),
      revision: 5,
      activation: { envChanged: false, runningProcesses: 0 },
    });
    h.auth.mockClear();
    h.dispatch(
      providerProfileUpdateRequested({ requestId: 'u1', profileId: 'pwork', backup: true }),
    );
    await settle();
    expect(mocks.update).toHaveBeenCalledWith({ profileId: 'pwork', backup: true });
    // A backup-only change is not an env change: the account is not re-checked.
    expect(h.auth).not.toHaveBeenCalled();
    expect(
      selectProviderProfilesForBase.select(h.state(), 'codex').map((p) => [p.id, p.backup]),
    ).toEqual([
      ['pwork', true],
      ['pnew', true],
    ]);
  });

  it('saves a reorder and adopts the daemon order and revision', async () => {
    const h = await loadedWith([
      withBackup('pa', 'A'),
      withBackup('pb', 'B'),
      withBackup('pc', 'C'),
    ]);
    const done = deferred<{ profiles: ProviderProfile[]; revision: number }>();
    mocks.reorder.mockReturnValue(done.promise);
    h.dispatch(
      providerProfileReorderRequested({
        requestId: 'o1',
        baseProviderId: 'codex',
        profileIds: ['pc', 'pa', 'pb'],
      }),
    );
    await settle();
    expect(mocks.reorder).toHaveBeenCalledWith({
      baseProviderId: 'codex',
      profileIds: ['pc', 'pa', 'pb'],
    });
    // Optimistic while the daemon is saving.
    expect(selectProviderProfilesForBase.select(h.state(), 'codex').map((p) => p.id)).toEqual([
      'pc',
      'pa',
      'pb',
    ]);
    done.resolve({
      profiles: [withBackup('pc', 'C', true), withBackup('pa', 'A'), withBackup('pb', 'B')],
      revision: 4,
    });
    await settle();
    expect(selectProviderProfileMutations.select(h.state()).o1).toMatchObject({
      kind: 'reorder',
      status: 'success',
    });
    expect(selectProviderProfilesForBase.select(h.state(), 'codex')[0].backup).toBe(true);
    // Our own `reordered` event (same revision) needs no extra read.
    h.dispatch(providerProfilesChanged(4));
    await settle();
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });

  it("re-reads the list after a rejected reorder so the daemon's order wins", async () => {
    const h = await loadedWith([withBackup('pa', 'A'), withBackup('pb', 'B')]);
    mocks.reorder.mockRejectedValue({
      rpcCode: -32602,
      data: {
        code: 'invalid-params',
        fieldErrors: [{ field: 'profileIds', code: 'profile-order-incomplete', message: 'x' }],
      },
    });
    h.dispatch(
      providerProfileReorderRequested({
        requestId: 'o2',
        baseProviderId: 'codex',
        profileIds: ['pb', 'pa'],
      }),
    );
    await settle();
    expect(selectProviderProfileMutations.select(h.state()).o2).toMatchObject({
      kind: 'reorder',
      status: 'failure',
      failure: { kind: 'fieldErrors' },
    });
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(selectProviderProfilesForBase.select(h.state(), 'codex').map((p) => p.id)).toEqual([
      'pa',
      'pb',
    ]);
  });

  it('sends one reorder per base provider at a time and drops moves made meanwhile', async () => {
    const h = await loadedWith([
      withBackup('pa', 'A'),
      withBackup('pb', 'B'),
      withBackup('pc', 'C'),
    ]);
    const done = deferred<{ profiles: ProviderProfile[]; revision: number }>();
    mocks.reorder.mockReturnValueOnce(done.promise);
    h.dispatch(
      providerProfileReorderRequested({
        requestId: 'o1',
        baseProviderId: 'codex',
        profileIds: ['pb', 'pa', 'pc'],
      }),
    );
    h.dispatch(
      providerProfileReorderRequested({
        requestId: 'o2',
        baseProviderId: 'codex',
        profileIds: ['pc', 'pb', 'pa'],
      }),
    );
    await settle();
    done.resolve({
      profiles: [withBackup('pb', 'B'), withBackup('pa', 'A'), withBackup('pc', 'C')],
      revision: 4,
    });
    await settle();
    expect(mocks.reorder).toHaveBeenCalledTimes(1);
    expect(selectProviderProfilesForBase.select(h.state(), 'codex').map((p) => p.id)).toEqual([
      'pb',
      'pa',
      'pc',
    ]);
  });

  it("re-reads the list on another client's reordered event", async () => {
    const h = await loadedWith([withBackup('pa', 'A'), withBackup('pb', 'B')]);
    mocks.list.mockResolvedValue({
      profiles: [withBackup('pb', 'B'), withBackup('pa', 'A')],
      revision: 4,
    });
    h.dispatch(providerProfilesChanged(4));
    await settle();
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(selectProviderProfilesForBase.select(h.state(), 'codex').map((p) => p.id)).toEqual([
      'pb',
      'pa',
    ]);
  });
});

describe('model picker catalog refresh (§5.54)', () => {
  it('re-reads providers.catalog once per event burst, with one trailing read', async () => {
    const h = setup();
    task = h.task;
    const first = deferred<unknown>();
    const work = {
      id: 'pwork00000001',
      providerRef: 'codex@pwork00000001',
      baseProviderId: 'codex',
      name: 'Work',
    };
    mocks.catalog
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ providers: [row('codex', true)], profiles: [work] });

    h.dispatch(providerProfilesChanged(1));
    h.dispatch(providerProfilesChanged(2));
    h.dispatch(providerProfilesChanged(3));
    await settle();
    expect(mocks.catalog).toHaveBeenCalledTimes(1);

    first.resolve({ providers: [row('codex', true)], profiles: [] });
    await settle();
    expect(mocks.catalog).toHaveBeenCalledTimes(2);
    expect(selectProviderCatalogProfiles.select(h.state())).toEqual([work]);
  });
});

describe('picker sign-in statuses (§5.54)', () => {
  const work = { id: 'pwork', providerRef: 'codex@pwork', baseProviderId: 'codex', name: 'Work' };
  // A member cannot list profiles; only the catalog summaries are known.
  beforeEach(() => {
    mocks.list.mockRejectedValue(new Error('-32003 forbidden'));
  });

  it('probes each listed profile once without forcing and records signed-out', async () => {
    const auth = vi.fn(async () => false as boolean | undefined);
    const h = setup({ auth });
    task = h.task;
    h.dispatch(providerCatalogLoaded({ providers: [row('codex', true)], profiles: [work] }));
    const refs = [{ id: work.id, providerRef: work.providerRef }];
    h.dispatch(providerProfileSummaryStatusesEnsured(refs));
    h.dispatch(providerProfileSummaryStatusesEnsured(refs));
    await settle();
    expect(auth.mock.calls).toEqual([[work.providerRef, false]]);
    expect(selectProfileSignInStatuses.select(h.state())).toEqual({ [work.id]: 'error' });

    h.dispatch(providerProfileSummaryStatusesEnsured(refs));
    await settle();
    expect(auth).toHaveBeenCalledTimes(1);
  });

  it('drops a verdict for a profile the catalog no longer lists', async () => {
    const pending = deferred<boolean | undefined>();
    const auth = vi.fn(() => pending.promise);
    const h = setup({ auth });
    task = h.task;
    h.dispatch(providerCatalogLoaded({ providers: [row('codex', true)], profiles: [work] }));
    h.dispatch(
      providerProfileSummaryStatusesEnsured([{ id: work.id, providerRef: work.providerRef }]),
    );
    await settle();
    h.dispatch(providerCatalogLoaded({ providers: [row('codex', true)], profiles: [] }));
    pending.resolve(false);
    await settle();
    expect(selectProfileSignInStatuses.select(h.state())).toEqual({});
  });
});

describe('Default configuration overrides (§5.54)', () => {
  let task: Task | undefined;
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => task?.cancel());

  const saved = (name: string, fingerprint: string) => ({
    baseProviderId: 'codex',
    providerRef: 'codex',
    name,
    env: [{ key: 'OPENAI_API_KEY', kind: 'set' as const, value: '********' }],
    settingsFingerprint: fingerprint,
    activation: { runningProcesses: 0 },
  });

  it('loads the Default rows with the profile list', async () => {
    mocks.list.mockResolvedValue({
      profiles: [],
      defaults: [saved('Personal', 'f1')],
      revision: 1,
    });
    const h = setup();
    task = h.task;
    h.dispatch(providerProfilesRequested());
    await settle();
    expect(selectProviderDefaultConfig.select(h.state(), 'codex')?.name).toBe('Personal');
    expect(selectProviderDefaultConfig.select(h.state(), 'claude-code')).toBeUndefined();
  });

  it('saves name and env without putting values in actions or state, then re-checks the provider', async () => {
    mocks.list.mockResolvedValue({ profiles: [], defaults: [saved('Default', '')], revision: 1 });
    const h = setup();
    task = h.task;
    h.dispatch(providerProfilesRequested());
    await settle();
    mocks.updateDefault.mockResolvedValue({
      defaultConfig: saved('Personal', 'f2'),
      revision: 2,
      activation: { envChanged: true, runningProcesses: 1 },
    });
    const env = [{ key: 'OPENAI_API_KEY', kind: 'set' as const, value: 'sk-default-secret' }];
    h.dispatch(
      providerDefaultUpdateRequested({
        requestId: 'd1',
        baseProviderId: 'codex',
        name: 'Personal',
        env,
      }),
    );
    await settle();
    expect(mocks.updateDefault).toHaveBeenCalledWith({
      baseProviderId: 'codex',
      name: 'Personal',
      env,
    });
    expect(JSON.stringify(h.dispatched)).not.toContain('sk-default-secret');
    expect(JSON.stringify(h.current())).not.toContain('sk-default-secret');
    expect(selectProviderProfileMutations.select(h.state()).d1).toMatchObject({
      status: 'success',
      kind: 'updateDefault',
      baseProviderId: 'codex',
      activation: { envChanged: true, runningProcesses: 1 },
    });
    expect(selectProviderDefaultConfig.select(h.state(), 'codex')?.settingsFingerprint).toBe('f2');
    expect(h.dispatched).toContainEqual(
      expect.objectContaining({ type: 'agentAvailability/checkSingleProviderRequested' }),
    );
  });

  it('a rename-only save sends no env and does not re-check the provider', async () => {
    mocks.updateDefault.mockResolvedValue({
      defaultConfig: saved('Home', 'f1'),
      revision: 3,
      activation: { envChanged: false, runningProcesses: 0 },
    });
    const h = setup();
    task = h.task;
    h.dispatch(
      providerDefaultUpdateRequested({ requestId: 'd2', baseProviderId: 'codex', name: 'Home' }),
    );
    await settle();
    expect(mocks.updateDefault).toHaveBeenCalledWith({ baseProviderId: 'codex', name: 'Home' });
    expect(h.dispatched).not.toContainEqual(
      expect.objectContaining({ type: 'agentAvailability/checkSingleProviderRequested' }),
    );
    expect(selectProviderDefaultConfig.select(h.state(), 'codex')?.name).toBe('Home');
  });

  it('records field errors and a failed save on an older daemon', async () => {
    const h = setup();
    task = h.task;
    mocks.updateDefault.mockRejectedValueOnce({
      rpcCode: -32602,
      data: {
        code: 'invalid-params',
        fieldErrors: [{ field: 'name', code: 'name-duplicate', message: 'dup' }],
      },
    });
    h.dispatch(
      providerDefaultUpdateRequested({ requestId: 'd3', baseProviderId: 'codex', name: 'Work' }),
    );
    await settle();
    expect(selectProviderProfileMutations.select(h.state()).d3).toMatchObject({
      status: 'failure',
      failure: { kind: 'fieldErrors' },
    });
    mocks.updateDefault.mockRejectedValueOnce(
      Object.assign(new Error('Method not found'), { rpcCode: -32601 }),
    );
    h.dispatch(
      providerDefaultUpdateRequested({ requestId: 'd4', baseProviderId: 'codex', name: 'x' }),
    );
    await settle();
    expect(selectProviderProfileMutations.select(h.state()).d4).toMatchObject({
      status: 'failure',
      failure: { kind: 'other' },
    });
    expect(selectProviderDefaultConfig.select(h.state(), 'codex')).toBeUndefined();
  });
});
