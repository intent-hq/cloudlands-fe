import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReactStore } from '@themislib/themis/react-store';
import type { StoreDispatch, StoreMiddleware } from '@themislib/themis/types';
import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import { fork, getContext, setContext } from 'typed-redux-saga';
import type { Task } from 'redux-saga';
import { WorkspaceStatus, type Workspace, type Result } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import { WORKSPACE_CHANNELS } from '$shared/ipc/channels';
import { createWorkspaceClientRuntime } from '$lib/client/live/backend-workspace-client';
import { createWorkspaceDomainClientRuntime } from '../../workspace/utils/workspace-domain-client-factory';
import type {
  WorkspaceLoadClients,
  WorkspaceLoadReadScope,
  WorkspaceLoadRequestLifetime,
} from '../workspace-load-admission-types';
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
  getPrincipalActionContext,
  getPrincipalConnectionContext,
} from '../../principal/principal-projections';
import {
  principalContextChanged,
  principalIdentityChanged,
  principalReceived,
  principalReducer,
} from '../../principal/principal-slice';
import { userPreferencesReducer } from '../../user-preferences/user-preferences-slice';
import {
  closeWorkspaceTab,
  openWorkspaceTab,
  tabStateReducer,
} from '../../tab-state/tab-state-slice';
import {
  loadWorkspacesRequested,
  removeWorkspaceEntity,
  setWorkspaceEntity,
  workspaceReducer,
} from '../../workspace/workspace-slice';
import {
  markWorkspaceNavigationInitialized,
  workspaceNavigationReducer,
} from '../../workspace-navigation/workspace-navigation-slice';
import {
  workspaceHydrationRequested,
  workspaceLifecycleReducer,
  workspaceLoadCancelled,
  workspaceLoadCachedReady,
  workspaceLoadFailed,
  workspaceLoadOptimisticReady,
  workspaceLoadRequested,
  workspaceLoadStarted,
  workspaceLoadSucceeded,
  workspaceMounted,
  workspaceOpenFailed,
  workspaceOpenSucceeded,
  workspaceUnmounted,
} from '../workspace-lifecycle-slice';
import {
  createIsWorkspaceSessionLiveProjection,
  getWorkspaceSessionPhase,
  getWorkspaceLoadState,
} from '../workspace-lifecycle-projections';
import { createWorkspaceLoadSaga } from './workspace-load-saga-factory';

const reducers = {
  connections: connectionsReducer,
  daemonHealth: daemonHealthReducer,
  workspaceEvents: workspaceEventsReducer,
  principal: principalReducer,
  userPreferences: userPreferencesReducer,
  workspace: workspaceReducer,
  workspaceLifecycle: workspaceLifecycleReducer,
  tabState: tabStateReducer,
  workspaceNavigation: workspaceNavigationReducer,
};
type State = { [K in keyof typeof reducers]: ReturnType<(typeof reducers)[K]> };
type Action = { type: string; payload?: unknown };
type ReduxContext = {
  getState(): State;
  dispatch: StoreDispatch;
  subscribe(listener: () => void): () => void;
};
const WS = 'admitted-workspace';
const stops: (() => void)[] = [];
afterEach(() => {
  stops
    .splice(0)
    .reverse()
    .forEach((stop) => stop());
  vi.useRealTimers();
  vi.restoreAllMocks();
});
async function settle() {
  for (let index = 0; index < 12; index++) await Promise.resolve();
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function workspace(id = WS, repositoryPath: string | null = '/repo'): Workspace {
  return {
    id: WorkspaceId(id),
    title: id,
    branch: 'main',
    path: '/checkout',
    repositoryPath: repositoryPath ?? undefined,
    worktreePath: '/checkout',
    status: WorkspaceStatus.Active,
    changesets: [],
    timeline: [],
    conversationInfo: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}
function signalPort() {
  const controller = new AbortController();
  let setup: (() => void) | undefined;
  const subscribe = controller.signal.addEventListener.bind(controller.signal);
  const added = vi.spyOn(controller.signal, 'addEventListener').mockImplementation((...args) => {
    subscribe(...args);
    const callback = setup;
    setup = undefined;
    callback?.();
  });
  const removed = vi.spyOn(controller.signal, 'removeEventListener');
  return {
    controller,
    signal: controller.signal,
    duringSubscribe: (callback: () => void) => {
      setup = callback;
    },
    listeners: () =>
      added.mock.calls.filter(([type]) => type === 'abort').length -
      removed.mock.calls.filter(([type]) => type === 'abort').length,
  };
}

function fixture(source = false) {
  const actions: Action[] = [];
  const record: StoreMiddleware = () => (next) => (action) => {
    actions.push(action as Action);
    return next(action);
  };
  // Actual installed Store owns the sole saga middleware; no product Store/root.
  const isolated = new ReactStore(reducers, record);
  const dispose = isolated.init();
  let store!: ReduxContext;
  isolated.runSaga(function* captureContext() {
    store = yield* getContext<ReduxContext>('reduxStore');
  })();
  let held = false;
  let subscriptions = 0;
  let duringSubscribe: (() => void) | undefined;
  const pending = new Set<() => void>();
  const context = {
    ...store,
    subscribe(listener: () => void) {
      subscriptions++;
      const unsubscribe = store.subscribe(() => (held ? pending.add(listener) : listener()));
      const setup = duringSubscribe;
      duringSubscribe = undefined;
      setup?.();
      return () => {
        subscriptions--;
        pending.delete(listener);
        unsubscribe();
      };
    },
  };
  const principalSelector = isolated.createSelector(getPrincipalActionContext);
  const selectWorkspaceById = isolated.createSelector(
    (state: State, id: string) =>
      getItem(state.workspace.workspaces, id as Workspace['id']) ??
      state.workspace.pendingCreations[id],
  );
  const phase = isolated.createSelector(getWorkspaceSessionPhase);
  const selectIsWorkspaceSessionLive = isolated.createSelector(
    createIsWorkspaceSessionLiveProjection(phase),
  );
  const selectWorkspaceLoadState = isolated.createSelector(getWorkspaceLoadState);

  const origins = new WeakMap<
    ReturnType<typeof workspaceLoadRequested>,
    WorkspaceLoadRequestLifetime
  >();
  const leases: Array<
    WorkspaceLoadReadScope & {
      release: ReturnType<typeof vi.fn>;
      port: ReturnType<typeof signalPort>;
    }
  > = [];
  const owners: Array<{ retire(): void; port: ReturnType<typeof signalPort> }> = [];
  function owner(id = WS) {
    const port = signalPort();
    const identity = {};
    const open = vi
      .fn<(id: WorkspaceId) => Promise<Result<Workspace, string>>>()
      .mockResolvedValue({ ok: true, data: workspace(id) });
    const get = vi.fn<(id: string) => Promise<Workspace | null>>().mockResolvedValue(null);
    let clients: WorkspaceLoadClients = {
      workspaceClient: { open },
      appClient: { workspaces: { get } },
    };
    let acquireMode:
      'valid' | 'null' | 'wrong-identity' | 'wrong-context' | 'aborted' | 'not-current' = 'valid';
    let onAcquire: (() => void) | undefined;
    // Controlled host port only. This is NOT a production host implementation or
    // proof that the real unversioned action producers already attest ownership.
    const request: WorkspaceLoadRequestLifetime = {
      identity,
      workspaceId: id,
      signal: port.signal,
      isCurrent: () => !port.signal.aborted,
      acquireReadScope: vi.fn((authority: string) => {
        if (acquireMode === 'null') return null;
        const readPort = signalPort();
        const admitted = acquireMode !== 'not-current';
        let released = false;
        const lease = {
          ...clients,
          requestIdentity: acquireMode === 'wrong-identity' ? {} : identity,
          context: acquireMode === 'wrong-context' ? 'wrong' : authority,
          signal: readPort.signal,
          port: readPort,
          isCurrent: () =>
            admitted && !released && !port.signal.aborted && !readPort.signal.aborted,
          release: vi.fn(() => {
            released = true;
          }),
        };
        if (acquireMode === 'aborted') readPort.controller.abort();
        leases.push(lease);
        onAcquire?.();
        return lease;
      }),
    };
    const result = {
      request,
      port,
      open,
      get,
      retire: () => port.controller.abort(),
      clients: (value: WorkspaceLoadClients) => {
        clients = value;
      },
      mode: (value: typeof acquireMode) => {
        acquireMode = value;
      },
      duringAcquire: (callback: () => void) => {
        onAcquire = callback;
      },
    };
    owners.push(result);
    return result;
  }
  const first = owner();
  const selectors = { selectWorkspaceById, selectIsWorkspaceSessionLive, selectWorkspaceLoadState };
  const sourceClients = {
    workspaceClient: { open: first.open },
    appClient: { workspaces: { get: first.get } },
  };
  const saga = createWorkspaceLoadSaga(
    source
      ? {
          ...selectors,
          admission: { kind: 'source' },
          ...sourceClients,
        }
      : {
          ...selectors,
          admission: {
            kind: 'principal',
            contextSelector: principalSelector,
            readCurrentContext: () => getPrincipalActionContext(store.getState()),
            dispatch: isolated.dispatch,
            captureRequest: (action) => origins.get(action) ?? null,
          },
        },
  );
  let task!: Task;
  const stop = isolated.runSaga(function* runCanonicalLoader() {
    yield* setContext({ reduxStore: context });
    task = yield* fork(saga);
  });
  stops.push(() => {
    owners.forEach((o) => o.retire());
    stop();
    dispose();
  });
  function admit(id = 'reader') {
    store.dispatch(
      connectionsListReceived({ connections: [], activeId: 'local', windowBackendId: 'local' }),
    );
    store.dispatch(connectionStatusChanged('connected'));
    store.dispatch(daemonEventsSubscribed());
    const connection = getPrincipalConnectionContext(store.getState());
    expect(connection).not.toBeNull();
    store.dispatch(principalContextChanged(connection));
    store.dispatch(
      principalReceived(
        { context: connection!, invalidation: 0, presentationVersion: 0 },
        {
          principal: {
            id,
            login: null,
            displayName: null,
            avatarUrl: null,
            isAdministrator: false,
            hostRole: 'guest',
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
    expect(getPrincipalActionContext(store.getState())).not.toBeNull();
  }
  function intent(o = first, requestedId = o.request.workspaceId) {
    const action = workspaceLoadRequested(requestedId);
    origins.set(action, o.request);
    return action;
  }
  function onAction(type: string, callback: () => void) {
    let fired = false;
    const off = store.subscribe(() => {
      if (!fired && actions.at(-1)?.type === type) {
        fired = true;
        callback();
      }
    });
    stops.push(off);
  }
  return {
    store,
    isolated,
    sourceClients,
    actions,
    leases,
    owners,
    first,
    task,
    stop,
    owner,
    admit,
    intent,
    onAction,
    request: (o = first) => store.dispatch(intent(o)),
    revoke: () => store.dispatch(principalIdentityChanged('reader')),
    entity: (id = WS) => selectWorkspaceById.select(isolated.state, id),
    load: (id = WS) => selectWorkspaceLoadState.select(isolated.state, id),
    hold: () => {
      held = true;
    },
    flush: () => {
      held = false;
      const work = [...pending];
      pending.clear();
      work.forEach((f) => f());
    },
    duringSubscribe: (callback: () => void) => {
      duringSubscribe = callback;
    },
    subscriptions: () => subscriptions,
  };
}
const has = (f: ReturnType<typeof fixture>, type: string) => f.actions.some((a) => a.type === type);
function seed(f: ReturnType<typeof fixture>, live = false) {
  f.store.dispatch(setWorkspaceEntity(workspace()));
  f.store.dispatch(openWorkspaceTab(WS));
  if (live) {
    f.store.dispatch(workspaceMounted(WS));
    f.store.dispatch(workspaceOpenSucceeded(WS));
  }
}
function expectClean(f: ReturnType<typeof fixture>) {
  expect(f.subscriptions()).toBe(0);
  for (const o of f.owners) expect(o.port.listeners()).toBe(0);
  for (const lease of f.leases) {
    expect(lease.port.listeners()).toBe(0);
    expect(lease.release).toHaveBeenCalledTimes(1);
  }
}

describe('workspace load request admission', () => {
  it.each(['cold', 'cached-live', 'optimistic'] as const)(
    'retains an early %s request without publishing before readiness',
    async (kind) => {
      const f = fixture();
      if (kind === 'cached-live') seed(f, true);
      const o = kind === 'optimistic' ? f.owner('optimistic-pending') : f.first;
      const offset = f.actions.length;
      f.request(o);
      expect(f.actions.slice(offset).map((a) => a.type)).toEqual([workspaceLoadRequested.type]);
      expect(o.open).not.toHaveBeenCalled();
      f.admit();
      await settle();
      if (kind === 'optimistic') {
        expect(o.open).not.toHaveBeenCalled();
        expect(f.load(o.request.workspaceId).status).toBe('optimistic');
        expect(has(f, workspaceLoadOptimisticReady.type)).toBe(true);
      } else {
        expect(o.open).toHaveBeenCalledExactlyOnceWith(WorkspaceId(WS));
        expect(f.load().status).toBe('ready');
      }
      expectClean(f);
    },
  );

  it('admits a collaborator without an existing entity or management capability', async () => {
    const f = fixture();
    f.admit();
    expect(f.entity()).toBeUndefined();
    const offset = f.actions.length;
    f.request();
    await settle();
    expect(f.actions.slice(offset).map((a) => a.type)).toEqual([
      workspaceLoadRequested.type,
      workspaceLoadStarted.type,
      workspaceHydrationRequested.type,
      setWorkspaceEntity.type,
      workspaceOpenSucceeded.type,
      workspaceLoadSucceeded.type,
      markWorkspaceNavigationInitialized.type,
    ]);
    expect(f.first.open).toHaveBeenCalledTimes(1);
    expect(f.entity()?.id).toBe(WS);
    expect(f.load().status).toBe('ready');
    expectClean(f);
  });

  it.each(['before', 'during-subscribe'] as const)(
    'does not lose readiness %s channel installation',
    async (when) => {
      const f = fixture();
      if (when === 'before') f.admit();
      else f.duringSubscribe(f.admit);
      f.request();
      await settle();
      expect(f.first.open).toHaveBeenCalledTimes(1);
      expectClean(f);
    },
  );

  it('uses direct readiness after an older setup notification', async () => {
    const f = fixture();
    f.duringSubscribe(() => {
      f.admit();
      f.revoke();
    });
    f.request();
    expect(f.first.open).not.toHaveBeenCalled();
    f.first.retire();
    f.admit('replacement');
    await settle();
    expect(f.first.open).not.toHaveBeenCalled();
    expectClean(f);
  });

  it.each(['tab', 'null-connection', 'root', 'subscribe-race'] as const)(
    'retires pre-admission work on %s without resurrection',
    async (kind) => {
      const f = fixture();
      if (kind === 'subscribe-race') f.duringSubscribe(f.first.retire);
      f.request();
      if (kind === 'root') f.stop();
      else f.first.retire();
      if (kind === 'tab') f.store.dispatch(workspaceUnmounted(WS));
      f.admit('later');
      await settle();
      expect(f.first.open).not.toHaveBeenCalled();
      expect(has(f, workspaceLoadCancelled.type)).toBe(false);
      expectClean(f);
    },
  );

  it('rejects an old originating action instead of relabeling it with a reopened owner', async () => {
    const f = fixture();
    const old = f.intent();
    f.first.retire();
    const replacement = f.owner();
    f.admit();
    f.store.dispatch(old);
    await settle();
    expect(f.first.open).not.toHaveBeenCalled();
    expect(replacement.open).not.toHaveBeenCalled();
    f.request(replacement);
    await settle();
    expect(replacement.open).toHaveBeenCalledTimes(1);
    expectClean(f);
  });

  it.each([
    'unattested',
    'wrong-workspace',
    'null',
    'wrong-identity',
    'wrong-context',
    'aborted',
    'not-current',
  ] as const)('fails closed for %s scope without retrying acquisition', async (kind) => {
    const f = fixture();
    f.admit();
    if (kind === 'unattested') f.store.dispatch(workspaceLoadRequested(WS));
    else if (kind === 'wrong-workspace') f.store.dispatch(f.intent(f.first, 'wrong'));
    else {
      f.first.mode(kind);
      f.request();
    }
    await settle();
    f.flush();
    await settle();
    expect(f.first.open).not.toHaveBeenCalled();
    expect(has(f, workspaceLoadStarted.type)).toBe(false);
    expect(f.first.request.acquireReadScope).toHaveBeenCalledTimes(
      kind === 'unattested' || kind === 'wrong-workspace' ? 0 : 1,
    );
    expectClean(f);
  });

  it('releases a scope invalidated synchronously during acquisition', async () => {
    const f = fixture();
    f.admit();
    f.first.duringAcquire(f.first.retire);
    f.request();
    await settle();
    expect(f.first.open).not.toHaveBeenCalled();
    expectClean(f);
  });

  it.each(['request', 'read'] as const)(
    'handles abortion during %s signal listener setup',
    async (boundary) => {
      const f = fixture();
      f.admit();
      if (boundary === 'request') f.first.port.duringSubscribe(f.first.retire);
      else
        f.first.duringAcquire(() => {
          const port = f.leases.at(-1)!.port;
          port.duringSubscribe(() => port.controller.abort());
        });
      f.request();
      await settle();
      expect(f.first.open).not.toHaveBeenCalled();
      expectClean(f);
    },
  );

  it('retains client capabilities exposed through a lease prototype', async () => {
    const f = fixture();
    f.admit();
    const acquire = f.first.request.acquireReadScope;
    f.first.request.acquireReadScope = (context) => Object.create(acquire(context)!);
    f.request();
    await settle();
    expect(f.first.open).toHaveBeenCalledTimes(1);
    expect(f.load().status).toBe('ready');
    expectClean(f);
  });

  it.each(['open', 'detail'] as const)(
    'cleans up root cancellation during %s and ignores late fulfillment',
    async (phase) => {
      const f = fixture();
      const open = deferred<Result<Workspace, string>>();
      const detail = deferred<Workspace | null>();
      if (phase === 'open') f.first.open.mockReturnValue(open.promise);
      else {
        f.first.open.mockResolvedValue({ ok: true, data: workspace(WS, null) });
        f.first.get.mockReturnValue(detail.promise);
      }
      f.admit();
      f.request();
      await settle();
      f.stop();
      expect(f.task.isRunning()).toBe(false);
      expectClean(f);
      const count = f.actions.length;
      open.resolve({ ok: true, data: workspace() });
      detail.resolve(workspace());
      await settle();
      expect(f.actions).toHaveLength(count);
    },
  );

  it('coalesces the same live intent but replaces a pending same-id lifetime', async () => {
    const f = fixture();
    const a = deferred<Result<Workspace, string>>();
    f.first.open.mockReturnValue(a.promise);
    f.admit();
    f.request();
    f.request();
    expect(f.first.open).toHaveBeenCalledTimes(1);
    f.first.retire();
    const b = f.owner();
    f.request(b);
    await settle();
    expect(b.open).toHaveBeenCalledTimes(1);
    expect(f.load().status).toBe('ready');
    const count = f.actions.length;
    a.resolve({ ok: true, data: { ...workspace(), title: 'old' } });
    await settle();
    expect(f.actions).toHaveLength(count);
    expect(f.entity()?.title).toBe(WS);
    expect(has(f, workspaceLoadCancelled.type)).toBe(false);
    expectClean(f);
  });

  it.each(['success', 'not-found', 'error', 'throw'] as const)(
    'drops stale %s even with authority notices held',
    async (outcome) => {
      const f = fixture();
      const result = deferred<Result<Workspace, string>>();
      f.first.open.mockReturnValue(result.promise);
      f.admit();
      seed(f);
      f.request();
      f.hold();
      f.revoke();
      const count = f.actions.length;
      if (outcome === 'throw') result.reject(new Error('transport ended'));
      else
        result.resolve(
          outcome === 'success'
            ? { ok: true, data: workspace() }
            : { ok: false, error: outcome === 'not-found' ? 'Workspace not found' : 'Offline' },
        );
      await settle();
      expect(f.actions).toHaveLength(count);
      expect(f.entity()?.id).toBe(WS);
      expect(f.first.open).toHaveBeenCalledTimes(1);
      expectClean(f);
    },
  );

  it.each([
    workspaceLoadStarted,
    workspaceHydrationRequested,
    setWorkspaceEntity,
    workspaceOpenSucceeded,
    workspaceLoadSucceeded,
  ])('stops the next operation after synchronous revocation at %s', async (boundary) => {
    const f = fixture();
    f.admit();
    f.hold();
    f.onAction(boundary.type, f.revoke);
    f.request();
    await settle();
    const index = f.actions.findIndex((a) => a.type === principalIdentityChanged.type);
    expect(index).toBeGreaterThan(-1);
    expect(f.actions.slice(index + 1)).toEqual([]);
    if (boundary === workspaceHydrationRequested || boundary === workspaceLoadStarted)
      expect(f.first.open).not.toHaveBeenCalled();
    expectClean(f);
  });

  it('requires fresh open for principal cached/live state and reports its real error', async () => {
    const f = fixture();
    f.admit();
    seed(f, true);
    f.first.open.mockResolvedValue({ ok: false, error: 'Offline' });
    f.request();
    await settle();
    expect(f.first.open).toHaveBeenCalledTimes(1);
    expect(f.load().status).toBe('error');
    expect(has(f, workspaceLoadCachedReady.type)).toBe(false);
    expect(has(f, workspaceLoadSucceeded.type)).toBe(false);
    expectClean(f);
  });

  it('keeps exactly one current not-found retry and its destructive outcome', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.admit();
    seed(f);
    f.first.open.mockResolvedValue({ ok: false, error: 'Workspace not found' });
    f.request();
    await settle();
    expect(f.first.open).toHaveBeenCalledTimes(1);
    expect(has(f, loadWorkspacesRequested.type)).toBe(true);
    await vi.advanceTimersByTimeAsync(500);
    await settle();
    expect(f.first.open).toHaveBeenCalledTimes(2);
    expect(f.store.getState().tabState.openTabs[WS]).toBeUndefined();
    expect(f.entity()).toBeUndefined();
    expect(f.load().status).toBe('not-found');
    expect(has(f, workspaceOpenFailed.type)).toBe(true);
    expectClean(f);
  });

  it.each([loadWorkspacesRequested, closeWorkspaceTab, removeWorkspaceEntity, workspaceLoadFailed])(
    'fences not-found actions after revocation at %s',
    async (boundary) => {
      vi.useFakeTimers();
      const f = fixture();
      f.admit();
      seed(f);
      f.hold();
      f.first.open.mockResolvedValue({ ok: false, error: 'Workspace not found' });
      f.onAction(boundary.type, f.revoke);
      f.request();
      await settle();
      await vi.advanceTimersByTimeAsync(500);
      await settle();
      const index = f.actions.findIndex((a) => a.type === principalIdentityChanged.type);
      expect(index).toBeGreaterThan(-1);
      expect(f.actions.slice(index + 1)).toEqual([]);
      expect(f.first.open).toHaveBeenCalledTimes(boundary === loadWorkspacesRequested ? 1 : 2);
      expectClean(f);
    },
  );

  it('cancels a valid superseded request while leased and cannot overwrite its replacement', async () => {
    const f = fixture();
    const pending = deferred<Result<Workspace, string>>();
    f.first.open.mockReturnValue(pending.promise);
    f.admit();
    f.request();
    let leasedAtCancellation = false;
    f.onAction(workspaceLoadCancelled.type, () => {
      leasedAtCancellation = f.leases[0].release.mock.calls.length === 0;
    });
    const next = f.owner('next');
    f.request(next);
    await settle();
    expect(leasedAtCancellation).toBe(true);
    expect(f.load().status).toBe('idle');
    expect(f.load('next').status).toBe('ready');
    pending.resolve({ ok: true, data: workspace() });
    await settle();
    expectClean(f);
  });

  it('suppresses cancellation publication after revoked authority even with notices held', async () => {
    const f = fixture();
    const pending = deferred<Result<Workspace, string>>();
    f.first.open.mockReturnValue(pending.promise);
    f.admit();
    f.request();
    f.hold();
    f.revoke();
    f.request(f.owner('next'));
    expect(has(f, workspaceLoadCancelled.type)).toBe(false);
    f.stop();
    pending.reject(new Error('late'));
    await settle();
    expectClean(f);
  });

  it.each(['authority', 'scope', 'paths', 'merge', 'error'] as const)(
    'retains optional detail ownership for %s',
    async (kind) => {
      const f = fixture();
      const detail = deferred<Workspace | null>();
      f.first.open.mockResolvedValue({ ok: true, data: workspace(WS, null) });
      f.first.get.mockReturnValue(detail.promise);
      f.admit();
      f.request();
      await settle();
      expect(f.load().status).toBe('ready');
      expect(f.first.get).toHaveBeenCalledExactlyOnceWith(WS);
      if (kind === 'authority') {
        f.hold();
        f.revoke();
      }
      if (kind === 'scope') f.leases[0].port.controller.abort();
      if (kind === 'paths')
        f.store.dispatch(setWorkspaceEntity({ ...workspace(), title: 'newer', path: '/changed' }));
      if (kind === 'merge')
        f.store.dispatch(setWorkspaceEntity({ ...workspace(WS, null), title: 'newer' }));
      const count = f.actions.length;
      if (kind === 'error') detail.reject(new Error('detail unavailable'));
      else detail.resolve({ ...workspace(), path: '/hydrated', worktreePath: '/hydrated' });
      await settle();
      if (kind === 'merge') {
        expect(f.entity()?.title).toBe('newer');
        expect(f.entity()?.path).toBe('/hydrated');
      } else expect(f.actions).toHaveLength(count);
      expect(f.load().status).toBe('ready');
      expectClean(f);
    },
  );

  it('preserves source optional-get receiver and success-before-detail ordering', async () => {
    const f = fixture(true);
    const detail = deferred<Workspace | null>();
    f.first.open.mockResolvedValue({ ok: true, data: workspace(WS, null) });
    f.first.get.mockReturnValue(detail.promise);
    f.request();
    await settle();
    expect(f.load().status).toBe('ready');
    expect(f.first.get.mock.contexts[0]).toBe(f.sourceClients.appClient.workspaces);
    detail.resolve({ ...workspace(), path: '/resolved' });
    await settle();
    expect(f.entity()?.path).toBe('/resolved');
    expectClean(f);
  });

  it('preserves source cached/live, optimistic and cold receivers without acquiring host scopes', async () => {
    const f = fixture(true);
    seed(f, true);
    f.request();
    await settle();
    expect(f.first.open).not.toHaveBeenCalled();
    expect(f.load().status).toBe('ready');
    f.store.dispatch(workspaceLoadRequested('optimistic-source'));
    await settle();
    expect(f.load('optimistic-source').status).toBe('optimistic');
    f.store.dispatch(workspaceLoadRequested('cold-source'));
    await settle();
    expect(f.first.open).toHaveBeenCalledExactlyOnceWith(WorkspaceId('cold-source'));
    expect(f.first.open.mock.contexts[0]).toBe(f.sourceClients.workspaceClient);
    expect(f.leases).toHaveLength(0);
    expectClean(f);
  });
});

function canonicalClients(f: ReturnType<typeof fixture>) {
  const openReply = deferred<Result<Workspace, string>>();
  const detailReply = deferred<{ workspace: Workspace }>();
  const invoke = vi
    .fn<(...args: unknown[]) => Promise<unknown>>()
    .mockReturnValue(openReply.promise);
  const request = vi
    .fn<(...args: unknown[]) => Promise<unknown>>()
    .mockReturnValue(detailReply.promise);
  const unused = () => {
    throw new Error('Unexpected non-read capability');
  };
  type Backend = Parameters<typeof createWorkspaceClientRuntime>[0];
  const WireClient = createWorkspaceClientRuntime({
    backendRequest: request as Backend['backendRequest'],
    onBackendNotification: unused,
    onBackendReconnected: unused,
    captureBackendRepositoryRoute: unused,
    captureBackendRepositorySelection: unused,
    prepareBackendNativeReview: unused,
  });
  const wire = new WireClient();
  const DomainClient = createWorkspaceDomainClientRuntime({
    store: {
      get state() {
        return f.store.getState();
      },
      get dispatch() {
        return f.isolated.dispatch;
      },
    },
    workspaces: wire,
    deletions: { currentWorkspaceDeletion: unused, terminalWorkspaceDeletion: unused },
    transport: { available: () => true, invoke },
  });
  const domain = new DomainClient();
  return {
    workspaceClient: domain,
    appClient: { workspaces: wire },
    invoke,
    request,
    openReply,
    detailReply,
  };
}

describe('actual canonical client pending-read provenance', () => {
  it('proves existing same-instance open/get coalescing at controlled transport boundaries', async () => {
    const f = fixture();
    const client = canonicalClients(f);
    const first = client.workspaceClient.open(WorkspaceId(WS));
    const duplicate = client.workspaceClient.open(WorkspaceId(WS));
    expect(client.invoke).toHaveBeenCalledExactlyOnceWith(WORKSPACE_CHANNELS.OPEN, { id: WS });
    client.openReply.resolve({ ok: true, data: workspace() });
    await expect(first).resolves.toMatchObject({ ok: true });
    await expect(duplicate).resolves.toMatchObject({ ok: true });
    const detail = client.appClient.workspaces.get(WS);
    const duplicateDetail = client.appClient.workspaces.get(WS);
    expect(detail).toBe(duplicateDetail);
    expect(client.request).toHaveBeenCalledExactlyOnceWith('workspace.get', { workspaceId: WS });
    client.detailReply.resolve({ workspace: workspace() });
    await detail;
  });

  it('does not let A pending open satisfy B after same-id ownership replacement', async () => {
    const f = fixture();
    const a = canonicalClients(f);
    f.first.clients(a);
    f.admit();
    f.request();
    expect(a.invoke).toHaveBeenCalledTimes(1);
    f.first.retire();
    const next = f.owner();
    const b = canonicalClients(f);
    next.clients(b);
    f.request(next);
    expect(b.invoke).toHaveBeenCalledExactlyOnceWith(WORKSPACE_CHANNELS.OPEN, { id: WS });
    const count = f.actions.length;
    a.openReply.resolve({ ok: true, data: { ...workspace(), title: 'A' } });
    await settle();
    expect(f.actions).toHaveLength(count);
    expect(f.entity()).toBeUndefined();
    b.openReply.resolve({ ok: true, data: { ...workspace(), title: 'B' } });
    await settle();
    expect(f.entity()?.title).toBe('B');
    expect(f.load().status).toBe('ready');
    expectClean(f);
  });

  it('does not let A pending detail satisfy B or overwrite B paths', async () => {
    const f = fixture();
    const a = canonicalClients(f);
    f.first.clients(a);
    f.admit();
    f.request();
    a.openReply.resolve({ ok: true, data: workspace(WS, null) });
    await settle();
    expect(a.request).toHaveBeenCalledExactlyOnceWith('workspace.get', { workspaceId: WS });
    f.first.retire();
    const next = f.owner();
    const b = canonicalClients(f);
    next.clients(b);
    f.request(next);
    b.openReply.resolve({ ok: true, data: { ...workspace(WS, null), title: 'B' } });
    await settle();
    expect(b.request).toHaveBeenCalledExactlyOnceWith('workspace.get', { workspaceId: WS });
    const count = f.actions.length;
    a.detailReply.resolve({ workspace: { ...workspace(), path: '/A' } });
    await settle();
    expect(f.actions).toHaveLength(count);
    expect(f.entity()?.path).toBe('/checkout');
    b.detailReply.resolve({ workspace: { ...workspace(), path: '/B' } });
    await settle();
    expect(f.entity()?.path).toBe('/B');
    expect(f.entity()?.title).toBe('B');
    expectClean(f);
  });
});
