import * as reduxSaga from 'redux-saga';
import { call } from 'typed-redux-saga';
import { ReactStore } from '@themislib/themis/react-store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SettingDefinitionWithValue } from '$lib/client/settings-types';
import { connectionsListReceived, connectionsReducer } from '../../connections/connections-slice';
import {
  connectionStatusChanged,
  daemonHealthReducer,
} from '../../daemon-health/daemon-health-slice';
import {
  daemonEventsSubscribed,
  workspaceEventsReducer,
} from '../../workspace-events/workspace-events-slice';
import {
  principalContextChanged,
  principalReceived,
  principalReducer,
} from '../../principal/principal-slice';
import {
  getCanAdministerHost,
  getCanCreateWorkspace,
  getHostAdministrationContext,
  getPrincipalActionContext,
  getPrincipalConnectionContext,
} from '../../principal/principal-projections';
import { userPreferencesReducer } from '../../user-preferences/user-preferences-slice';
import {
  setCompactWorkspaceInitializerFormState,
  setWorkspaceLocalCreation,
  workspaceInitializerGitCheckRequested,
  workspaceInitializerReducer,
  workspaceLocalCreationReloadRequested,
} from '../workspace-initializer-slice';
import {
  getWorkspaceInitializerGitCheckContext,
  getWorkspaceInitializerPersistedState,
  getWorkspaceInitializerLocalCreation,
  getWorkspaceInitializerReceiptContext,
} from '../workspace-initializer-projections';
import { createWorkspaceInitializerSaga } from './workspace-initializer-saga-factory';
import { createWorkspaceInitializerGitSaga } from './workspace-initializer-git-saga-factory';

// Observe real channel lifetime without replacing saga effects or channel behavior.
vi.mock('redux-saga', async (importOriginal) => {
  const actual = await importOriginal<typeof import('redux-saga')>();
  return { ...actual, channel: vi.fn(actual.channel) };
});

const cleanups: (() => void)[] = [];
afterEach(() =>
  cleanups
    .splice(0)
    .reverse()
    .forEach((cleanup) => cleanup()),
);
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function setting(value: unknown): SettingDefinitionWithValue {
  return {
    path: 'workspaceInitializer.state',
    label: 'Drafts',
    description: '',
    category: 'workspace',
    type: 'object',
    value,
  };
}
function fixture({ persistLocalCreation = false } = {}) {
  const store = new ReactStore({
    workspaceInitializer: workspaceInitializerReducer,
    connections: connectionsReducer,
    daemonHealth: daemonHealthReducer,
    workspaceEvents: workspaceEventsReducer,
    principal: principalReducer,
    userPreferences: userPreferencesReducer,
  });
  cleanups.push(store.init());
  store.dispatch(
    connectionsListReceived({ connections: [], activeId: 'local', windowBackendId: 'local' }),
  );
  store.dispatch(connectionStatusChanged('connected'));
  store.dispatch(daemonEventsSubscribed());
  const context = getPrincipalConnectionContext(store.state)!;
  store.dispatch(principalContextChanged(context));
  function admit(role: 'owner' | 'member' | 'guest') {
    store.dispatch(
      principalReceived(
        {
          context,
          invalidation: store.state.principal.invalidation,
          presentationVersion: store.state.principal.presentationVersion,
        },
        {
          principal: {
            id: 'user',
            login: null,
            displayName: null,
            avatarUrl: null,
            isAdministrator: role === 'owner',
            hostRole: role,
            hostMembershipRevision: 1,
          },
          capabilities: {
            hostMembership: true,
            collaborationIdentity: true,
            personalPairing: false,
            authenticatedDevices: false,
          },
        },
      ),
    );
  }
  const get = vi
    .fn<(path: string) => Promise<SettingDefinitionWithValue | null>>()
    .mockResolvedValue(setting({ compactFormState: { repoPath: '/saved' } }));
  const update = vi.fn().mockResolvedValue([]);
  const invoke = vi.fn().mockResolvedValue({ success: true, data: { available: true } });
  const gitContext = store.createSelector((state) =>
    getWorkspaceInitializerGitCheckContext(
      state,
      getPrincipalActionContext(state),
      getCanCreateWorkspace(state),
    ),
  );
  const gitSaga = createWorkspaceInitializerGitSaga({
    invoke,
    selectWorkspaceInitializerGitCheckContext: gitContext,
  });
  const runtime = createWorkspaceInitializerSaga({
    settingsClient: { get, update },
    localCreation: persistLocalCreation
      ? {
          select: store.createSelector(getWorkspaceInitializerLocalCreation),
          selectReceiptContext: store.createSelector(getWorkspaceInitializerReceiptContext),
        }
      : undefined,
    selectCanAdministerHost: store.createSelector(getCanAdministerHost),
    selectHostAdministrationContext: store.createSelector(getHostAdministrationContext),
    selectWorkspaceInitializerPersistedState: store.createSelector(
      getWorkspaceInitializerPersistedState,
    ),
    workspaceInitializerGitSaga: gitSaga,
    getLocalStorageJSON: function* <T>() {
      return undefined as T | undefined;
    },
    getLocalStorageItem: function* () {
      return null;
    },
    removeOnboardingPrompt: vi.fn(),
  });
  function start() {
    const stop = store.runSaga(runtime.workspaceInitializerSaga);
    cleanups.push(stop);
    return stop;
  }
  return {
    store,
    get,
    update,
    invoke,
    admit,
    start,
    gitContext,
    persist: runtime.persistWorkspaceInitializerWorker,
    hydrate: runtime.hydrateWorkspaceInitializerWorker,
  };
}

describe('shared workspace initializer owner', () => {
  it('binds each runtime independently and preserves the exact persistent bag', async () => {
    const first = fixture();
    const second = fixture();
    first.admit('owner');
    second.admit('owner');
    first.start();
    second.start();
    await settle();
    expect(first.get.mock.calls).toEqual([['workspaceInitializer.state']]);
    first.store.dispatch(
      setCompactWorkspaceInitializerFormState({ repoPath: '/changed', branch: 'topic' }),
    );
    await settle();
    expect(first.update.mock.calls).toEqual([
      [
        [
          {
            path: 'workspaceInitializer.state',
            value: {
              compactFormState: { repoPath: '/changed', branch: 'topic' },
              onboardingFormState: null,
              lastSelectedRepo: null,
              branchByRepo: {},
              defaultParentPath: '~/Developer',
              recentRepos: [],
              dismissedRecentRepoKeys: {},
              remoteSetups: [],
              lastSubmittedAgent: null,
            },
          },
        ],
      ],
    ]);
    expect(second.update).not.toHaveBeenCalled();
    expect(second.store.state.workspaceInitializer.compactFormState?.repoPath).toBe('/saved');
  });

  it('allows member Git checks without granting host settings access', async () => {
    const app = fixture();
    app.admit('member');
    app.start();
    app.store.dispatch(workspaceInitializerGitCheckRequested());
    app.store.dispatch(setCompactWorkspaceInitializerFormState({ repoPath: '/draft' }));
    await settle();
    expect(app.get).not.toHaveBeenCalled();
    expect(app.update).not.toHaveBeenCalled();
    expect(app.invoke.mock.calls).toEqual([['system:check-git']]);
    expect(app.store.state.workspaceInitializer.gitCheck?.available).toBe(true);
  });

  it('drops held settings and Git results after authority is removed', async () => {
    const app = fixture();
    app.admit('owner');
    const settings = deferred<SettingDefinitionWithValue>();
    const git = deferred<{ success: boolean; data: { available: boolean } }>();
    app.get.mockReturnValue(settings.promise);
    app.invoke.mockReturnValue(git.promise);
    app.start();
    app.store.dispatch(workspaceInitializerGitCheckRequested());
    await settle();
    app.admit('guest');
    await settle();
    settings.resolve(setting({ compactFormState: { repoPath: '/late' } }));
    git.resolve({ success: true, data: { available: false } });
    await settle();
    expect(app.store.state.workspaceInitializer.hydrated).toBe(false);
    expect(app.store.state.workspaceInitializer.compactFormState).toBeNull();
    expect(app.store.state.workspaceInitializer.gitCheck).toBeNull();
    expect(app.update).not.toHaveBeenCalled();
  });

  it('stops persistence and ignores a pending Git reply when its runtime stops', async () => {
    const app = fixture();
    app.admit('owner');
    const git = deferred<{ success: boolean; data: { available: boolean } }>();
    app.invoke.mockReturnValue(git.promise);
    const stop = app.start();
    await settle();
    app.store.dispatch(workspaceInitializerGitCheckRequested());
    await settle();
    expect(app.invoke).toHaveBeenCalledTimes(1);
    stop();
    app.store.dispatch(setCompactWorkspaceInitializerFormState({ repoPath: '/after-stop' }));
    git.resolve({ success: true, data: { available: true } });
    await settle();
    expect(app.update).not.toHaveBeenCalled();
    expect(app.store.state.workspaceInitializer.gitCheck).toBeNull();
  });
});

describe('optional local creation receipt persistence', () => {
  const receipt = {
    id: 'retained-request-id',
    authority: 'local/owner',
    repositoryPath: '/repo',
    baseRef: 'main',
    status: 'pending' as const,
  };

  it('retains the request id across restart, marks pending uncertain, and persists explicit clearing', async () => {
    const first = fixture({ persistLocalCreation: true });
    first.admit('owner');
    first.start();
    await settle();
    first.store.dispatch(setWorkspaceLocalCreation(receipt));
    await settle();
    expect(first.update).toHaveBeenCalledTimes(1);
    const saved = first.update.mock.calls[0][0][0];
    expect(saved.path).toBe('workspaceInitializer.state');
    expect(saved.value).toMatchObject({
      compactFormState: { repoPath: '/saved' },
      localCreation: receipt,
    });

    const restarted = fixture({ persistLocalCreation: true });
    restarted.get.mockResolvedValue(setting(saved.value));
    restarted.admit('owner');
    restarted.start();
    await settle();
    expect(restarted.store.state.workspaceInitializer.localCreation).toEqual({
      ...receipt,
      status: 'uncertain',
    });
    expect(restarted.update).not.toHaveBeenCalled();
    restarted.store.dispatch(setWorkspaceLocalCreation(null));
    await settle();
    expect(restarted.update).toHaveBeenCalledTimes(1);
    expect(restarted.update.mock.calls[0][0][0].value).toMatchObject({
      compactFormState: { repoPath: '/saved' },
      localCreation: null,
    });
  });

  it('rejects malformed persisted receipts through the canonical reader', async () => {
    const app = fixture({ persistLocalCreation: true });
    app.get.mockResolvedValue(setting({ localCreation: { ...receipt, id: '' } }));
    app.admit('owner');
    app.start();
    await settle();
    expect(app.store.state.workspaceInitializer.hydrated).toBe(true);
    expect(app.store.state.workspaceInitializer.localCreation).toBeNull();
  });

  it('keeps receipt hydration and writes disabled when the host omits the hook', async () => {
    const app = fixture();
    app.get.mockResolvedValue(setting({ localCreation: receipt }));
    app.admit('owner');
    app.start();
    await settle();
    expect(app.store.state.workspaceInitializer.localCreation).toBeNull();
    app.store.dispatch(setWorkspaceLocalCreation(receipt));
    await settle();
    expect(app.update).not.toHaveBeenCalled();
    app.store.dispatch(setCompactWorkspaceInitializerFormState({ repoPath: '/draft-only' }));
    await settle();
    expect(app.update.mock.calls[0][0][0].value).not.toHaveProperty('localCreation');
  });
});

describe('acknowledged initializer saves', () => {
  it('serializes direct saves and reads queued draft state after the prior write settles', async () => {
    const app = fixture({ persistLocalCreation: true });
    app.admit('owner');
    cleanups.push(app.store.runSaga(app.hydrate));
    await settle();
    const firstWrite = deferred<never[]>();
    const secondWrite = deferred<never[]>();
    app.update.mockReturnValueOnce(firstWrite.promise).mockReturnValueOnce(secondWrite.promise);
    app.store.dispatch(setCompactWorkspaceInitializerFormState({ repoPath: '/first' }));
    const first = vi.fn();
    const second = vi.fn();
    cleanups.push(
      app.store.runSaga(function* () {
        first(yield* call(app.persist));
      }),
    );
    cleanups.push(
      app.store.runSaga(function* () {
        second(yield* call(app.persist));
      }),
    );
    await settle();
    expect(app.update).toHaveBeenCalledTimes(1);
    app.store.dispatch(setCompactWorkspaceInitializerFormState({ repoPath: '/latest' }));
    firstWrite.resolve([]);
    await settle();
    expect(first).toHaveBeenCalledWith(true);
    expect(app.update).toHaveBeenCalledTimes(2);
    expect(app.update.mock.calls[1][0][0].value.compactFormState).toEqual({ repoPath: '/latest' });
    expect(second).not.toHaveBeenCalled();
    secondWrite.resolve([]);
    await settle();
    expect(second).toHaveBeenCalledWith(true);
  });

  it('keeps an accepted write serialized after saga cancellation and reports write failure', async () => {
    const app = fixture();
    app.admit('owner');
    const firstWrite = deferred<never[]>();
    app.update.mockReturnValueOnce(firstWrite.promise).mockRejectedValueOnce(new Error('offline'));
    const first = vi.fn();
    const second = vi.fn();
    const stop = app.store.runSaga(function* () {
      first(yield* call(app.persist));
    });
    cleanups.push(stop);
    await settle();
    stop();
    cleanups.push(
      app.store.runSaga(function* () {
        second(yield* call(app.persist));
      }),
    );
    await settle();
    expect(app.update).toHaveBeenCalledTimes(1);
    firstWrite.resolve([]);
    await settle();
    expect(first).not.toHaveBeenCalled();
    expect(app.update).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledWith(false);
  });

  it('holds direct saves behind hydration and denies queued writes after authority retirement', async () => {
    const app = fixture();
    app.admit('owner');
    const read = deferred<SettingDefinitionWithValue>();
    app.get.mockReturnValue(read.promise);
    app.start();
    const result = vi.fn();
    cleanups.push(
      app.store.runSaga(function* () {
        result(yield* call(app.persist));
      }),
    );
    await settle();
    expect(app.update).not.toHaveBeenCalled();
    app.admit('guest');
    await settle();
    read.resolve(setting({ compactFormState: { repoPath: '/old-owner' } }));
    await settle();
    expect(app.update).not.toHaveBeenCalled();
    expect(result).toHaveBeenCalledWith(false);
    expect(app.store.state.workspaceInitializer.compactFormState).toBeNull();
  });
});

describe('receipt hydration absence and lock lifetime', () => {
  it('acknowledges only a successful current receipt read and keeps that context out of settings', async () => {
    const app = fixture({ persistLocalCreation: true });
    app.admit('owner');
    app.get.mockRejectedValueOnce(new Error('Read failed'));
    app.start();
    await settle();
    expect(app.store.state.workspaceInitializer.localReceiptContext).toBeNull();
    app.get.mockResolvedValue(setting({}));
    await reduxSaga
      .runSaga({ dispatch: app.store.dispatch, getState: () => app.store.state }, app.hydrate)
      .toPromise();
    expect(app.store.state.workspaceInitializer.localReceiptContext).toBe(
      getHostAdministrationContext(app.store.state),
    );
    await reduxSaga.runSaga({ getState: () => app.store.state }, app.persist).toPromise();
    expect(app.update.mock.calls.at(-1)?.[0][0].value).not.toHaveProperty('localReceiptContext');
  });

  it.each([{ compactFormState: { repoPath: '/saved' } }, {}])(
    'explicitly reports a null receipt when an opted-in settings bag omits it: %j',
    async (bag) => {
      const app = fixture({ persistLocalCreation: true });
      app.admit('owner');
      app.get.mockResolvedValue(setting(bag));
      const dispatch = vi.fn();
      await reduxSaga
        .runSaga({ dispatch, getState: () => app.store.state }, app.hydrate)
        .toPromise();
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch.mock.calls[0][0].payload[0]).toHaveProperty('localCreation', null);
    },
  );

  it('closes the lock after the last accepted write and cancelled waiter settle, then permits reuse', async () => {
    const app = fixture();
    app.admit('owner');
    const firstWrite = deferred<never[]>();
    app.update.mockReturnValueOnce(firstWrite.promise).mockResolvedValue([]);
    const channelSpy = vi.mocked(reduxSaga.channel);
    channelSpy.mockClear();
    try {
      const first = reduxSaga.runSaga({ getState: () => app.store.state }, app.persist);
      const lock = channelSpy.mock.results[0].value as reduxSaga.Channel<boolean>;
      const close = vi.spyOn(lock, 'close');
      const waiting = reduxSaga.runSaga({ getState: () => app.store.state }, app.persist);
      waiting.cancel();
      first.cancel();
      await settle();
      expect(app.update).toHaveBeenCalledTimes(1);
      expect(close).not.toHaveBeenCalled();
      firstWrite.resolve([]);
      await settle();
      expect(close).toHaveBeenCalledTimes(1);
      expect(
        await reduxSaga.runSaga({ getState: () => app.store.state }, app.persist).toPromise(),
      ).toBe(true);
      await settle();
      expect(app.update).toHaveBeenCalledTimes(2);
      expect(channelSpy).toHaveBeenCalledTimes(2);
      close.mockRestore();
    } finally {
      channelSpy.mockClear();
    }
  });
});

describe('unread creation receipt safety', () => {
  it('preserves an unread durable key through failed hydration, form edits and explicit reload', async () => {
    const app = fixture({ persistLocalCreation: true });
    app.admit('owner');
    const receipt = {
      id: 'dispatched-key',
      authority: 'local-owner',
      repositoryPath: '/owned/repo',
      baseRef: 'main',
      status: 'pending',
    };
    let durable: unknown = { localCreation: receipt };
    app.get.mockRejectedValueOnce(new Error('Settings unavailable'));
    app.get.mockImplementation(() => Promise.resolve(setting(durable)));
    app.update.mockImplementation((updates) => {
      durable = structuredClone(updates[0].value);
      return Promise.resolve([]);
    });
    app.start();
    await settle();
    app.store.dispatch(setCompactWorkspaceInitializerFormState({ repoPath: '/owned/edited' }));
    await settle();
    let acknowledged: boolean | undefined;
    app.store.runSaga(function* () {
      acknowledged = yield* call(app.persist);
    });
    await settle();
    expect(acknowledged).toBe(false);
    expect(app.update).not.toHaveBeenCalled();
    app.store.dispatch(workspaceLocalCreationReloadRequested());
    await settle();
    expect(app.store.state.workspaceInitializer.localCreation).toEqual({
      ...receipt,
      status: 'uncertain',
    });
    expect(durable).toEqual({ localCreation: receipt });
  });
});
