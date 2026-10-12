// Actual ReactStore, acquired reducer, canonical queue/loader, status saga and React adapter.
// Only the declared preload boundary is controlled. No main allocation/hello provenance claim.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReactStore } from '@themislib/themis/react-store';
import type { StoreMiddleware } from '@themislib/themis/types';
import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import { call, cancel, fork, getContext, setContext } from 'typed-redux-saga';
import { WorkspaceId } from '$shared/types/branded-ids';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type { WorkspaceLoadRead, WorkspaceLoadRouteRef } from '$shared/types/workspace-load-route';
import { createBackendRuntime } from '$lib/client/live/backend-transport-runtime';
import { createElectronWorkspaceLoadTransport } from '$lib/client/live/workspace-load-route-transport';
import {
  connectionsListReceived,
  connectionsReducer,
} from '../../../../../src/store/renderer/slices/connections/connections-slice';
import {
  connectionStatusChanged,
  daemonHealthReducer,
} from '../../../../../src/store/renderer/slices/daemon-health/daemon-health-slice';
import {
  daemonEventsSubscribed,
  workspaceEventsReducer,
} from '../../../../../src/store/renderer/slices/workspace-events/workspace-events-slice';
import {
  principalContextChanged,
  principalReceived,
  principalReducer,
} from '../../../../../src/store/renderer/slices/principal/principal-slice';
import {
  getPrincipalActionContext,
  getPrincipalConnectionContext,
} from '../../../../../src/store/renderer/slices/principal/principal-projections';
import { userPreferencesReducer } from '../../../../../src/store/renderer/slices/user-preferences/user-preferences-slice';
import { workspaceReducer } from '../../../../../src/store/renderer/slices/workspace/workspace-slice';
import { acquiredTabStateReducer } from '../../../../../src/store/renderer/slices/tab-state/tab-state-acquisition-reducer';
import {
  openWorkspaceTab,
  closeWorkspaceTab,
  loadWorkspaceTabsState,
  serializeWorkspaceTabsState,
} from '../../../../../src/store/renderer/slices/tab-state/tab-state-slice';
import {
  workspaceLifecycleReducer,
  workspaceLoadRequested,
  workspaceLoadSucceeded,
  workspaceLoadCancelled,
  workspaceMounted,
  workspaceUnmounted,
} from '../../../../../src/store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { workspaceNavigationReducer } from '../../../../../src/store/renderer/slices/workspace-navigation/workspace-navigation-slice';
import {
  getWorkspaceSessionPhase,
  createIsWorkspaceSessionLiveProjection,
  getWorkspaceLoadState,
} from '../../../../../src/store/renderer/slices/workspace-lifecycle/workspace-lifecycle-projections';
import { createWorkspaceDeletionRuntime } from '../../../../../src/store/renderer/slices/workspace/utils/workspace-deletion-factory';
import { createWorkspaceTabCleanupSaga } from '../../../../../src/store/renderer/slices/workspace-lifecycle/sagas/workspace-tab-cleanup-saga-factory';
import { createWorkspaceLoadSaga } from '../../../../../src/store/renderer/slices/workspace-lifecycle/sagas/workspace-load-saga-factory';
import * as originOwnerModule from '../../../../../src/store/renderer/slices/workspace-lifecycle/workspace-load-origin-owner';
import type {
  WorkspaceLoadOriginIntent,
  WorkspaceLoadOriginPort,
  WorkspaceOriginReduxContext,
} from '../../../../../src/store/renderer/slices/workspace-lifecycle/workspace-load-origin-types';
import { backendConnectionSaga } from '../backend/sagas/backend-connection-saga';
import { observeWorkspaceLoadAuthority } from './workspace-load-read-scope';

const channels = IPC_CHANNELS.WORKSPACE_LOAD;
const A = '77777777-7777-4777-8777-777777777777';
const B = '88888888-8888-4888-8888-888888888888';
const reducers = {
  connections: connectionsReducer,
  daemonHealth: daemonHealthReducer,
  workspaceEvents: workspaceEventsReducer,
  principal: principalReducer,
  userPreferences: userPreferencesReducer,
  workspace: workspaceReducer,
  tabState: acquiredTabStateReducer,
  workspaceLifecycle: workspaceLifecycleReducer,
  workspaceNavigation: workspaceNavigationReducer,
};
type State = ReactStore<{
  [K in keyof typeof reducers]: ReturnType<(typeof reducers)[K]>;
}>['state'];
type Action = { type: string; payload?: unknown };
const stops: Array<() => void> = [];
afterEach(() => {
  for (const stop of stops.splice(0).reverse()) stop();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function wireWorkspace(id: string) {
  return {
    id,
    title: id,
    branch: 'main',
    path: '/repo/work',
    repositoryPath: '/repo',
    worktreePath: '/repo/work',
    status: 'active',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}
function fixture(
  initialPrincipal = true,
  onAuthorizationCurrent?: (intent: WorkspaceLoadOriginIntent) => void,
) {
  let authorizing: WorkspaceLoadOriginIntent | undefined;
  const authorizations: Array<{ intent: WorkspaceLoadOriginIntent; accepted: boolean }> = [];
  if (onAuthorizationCurrent) {
    const createOwner = originOwnerModule.createWorkspaceLoadOriginOwner;
    vi.spyOn(originOwnerModule, 'createWorkspaceLoadOriginOwner').mockImplementation(
      (readState) => {
        const owner = createOwner(readState);
        const begin = owner.begin;
        const instrumented = new WeakSet<WorkspaceLoadOriginIntent>();
        vi.spyOn(owner, 'begin').mockImplementation((...args) => {
          const intent = begin.apply(owner, args);
          if (intent && !instrumented.has(intent)) {
            instrumented.add(intent);
            const authorize = intent.authorizePublication;
            vi.spyOn(intent, 'authorizePublication').mockImplementation(() => {
              const previous = authorizing;
              authorizing = intent;
              try {
                const accepted = authorize.call(intent);
                authorizations.push({ intent, accepted });
                return accepted;
              } finally {
                authorizing = previous;
              }
            });
          }
          return intent;
        });
        return owner;
      },
    );
  }
  const actions: Action[] = [];
  const actionWaiters = new Map<string, ReturnType<typeof deferred<Action>>>();
  const record: StoreMiddleware = () => (next) => (action) => {
    actions.push(action as Action);
    const result = next(action);
    actionWaiters.get((action as Action).type)?.resolve(action as Action);
    return result;
  };
  const actual = new ReactStore(reducers, record);
  const dispose = actual.init();
  let redux!: WorkspaceOriginReduxContext<State>;
  actual.runSaga(function* readActualContext() {
    redux = yield* getContext<WorkspaceOriginReduxContext<State>>('reduxStore');
  })();
  const principal = actual.createSelector(getPrincipalActionContext);
  const entity = actual.createSelector(
    (s: State, id: string) =>
      getItem(s.workspace.workspaces, WorkspaceId(id)) ?? s.workspace.pendingCreations[id],
  );
  const phase = actual.createSelector(getWorkspaceSessionPhase);
  const live = actual.createSelector(createIsWorkspaceSessionLiveProjection(phase));
  const load = actual.createSelector(getWorkspaceLoadState);
  let holdNotifications = false;
  const postponed = new Set<() => void>();
  const observedRedux = {
    ...redux,
    subscribe(callback: () => void) {
      const stop = redux.subscribe(() =>
        holdNotifications ? postponed.add(callback) : callback(),
      );
      return () => {
        postponed.delete(callback);
        stop();
      };
    },
  };
  const deliveredOrigins = new Set<string>();
  const calls: Array<{
    channel: string;
    input: unknown;
    reply: ReturnType<typeof deferred<unknown>>;
  }> = [];
  const waiters = new Map<string, ReturnType<typeof deferred<(typeof calls)[number]>>>();
  const listeners = new Map<string, { channel: string; callback: (...args: unknown[]) => void }>();
  let nextId = 0;
  const invoke = vi.fn((channel: string, ...args: unknown[]): Promise<unknown> => {
    const reply = deferred<unknown>();
    const item = { channel, input: args[0], reply };
    const index = calls.filter((call) => call.channel === channel).length;
    calls.push(item);
    waiters.get(`${channel}:${index}`)?.resolve(item);
    if (channel === channels.RELEASE || channel === channels.RELEASE_ORIGIN)
      reply.resolve({ ok: true, result: undefined });
    else if (
      !new Set<string>([
        channels.OBSERVE_ORIGIN,
        channels.PREPARE,
        channels.READ,
        IPC_CHANNELS.BACKEND.GET_STATUS,
      ]).has(channel)
    )
      reply.reject(new Error(`Unexpected preload invocation ${channel}`));
    return reply.promise;
  });
  const api: Window['electronAPI'] & {
    platform: string;
    arch: string;
    versions: { node: string; chrome: string; electron: string };
  } = {
    invoke,
    send: vi.fn(),
    off: vi.fn(),
    on: vi.fn((channel: string, callback: (...args: unknown[]) => void) => {
      const id = `listener-${++nextId}`;
      listeners.set(id, { channel, callback });
      return id;
    }),
    offById: vi.fn((_channel: string, id: string) => {
      listeners.delete(id);
    }),
    removeAllListeners: vi.fn(() => listeners.clear()),
    platform: 'linux',
    arch: 'x64',
    versions: { node: '24.21.0', chrome: '153.0.8010.12', electron: '43.0.0' },
    devInstance: null,
    devPort: null,
  };
  vi.stubGlobal('window', { electronAPI: api });
  const backend = createBackendRuntime(() => ({
    remoteEnabled: () => actual.state.userPreferences.labsRemoteAgentsEnabled === true,
    connectionGeneration: () => actual.state.daemonHealth.connectionGeneration,
  }));
  const transport = createElectronWorkspaceLoadTransport(channels);
  const deletions = createWorkspaceDeletionRuntime(actual);
  const observations: Array<Promise<Awaited<ReturnType<typeof observeWorkspaceLoadAuthority>>>> =
    [];
  const signals: AbortSignal[] = [];
  const preparationPromises: Array<
    ReturnType<NonNullable<Awaited<ReturnType<typeof observeWorkspaceLoadAuthority>>>['prepare']>
  > = [];
  let port!: WorkspaceLoadOriginPort;
  const loader = createWorkspaceLoadSaga({
    selectWorkspaceById: entity,
    selectIsWorkspaceSessionLive: live,
    selectWorkspaceLoadState: load,
    admission: {
      kind: 'principal',
      contextSelector: principal,
      readCurrentContext: () => principal.select(actual.state),
      dispatch: actual.dispatch,
      captureRequest: (action) => port?.captureRequest(action) ?? null,
    },
  });
  const readyLookup = vi.fn(() => null);
  const cleanup = createWorkspaceTabCleanupSaga<State>({
    kind: 'origin',
    selectIsWorkspaceSessionLive: live,
    readReadyAuthority: readyLookup,
    observation: {
      wakeAction: connectionStatusChanged,
      readCurrentContext: () => principal.select(actual.state),
      observe(signal) {
        signals.push(signal);
        const promise = observeWorkspaceLoadAuthority(
          { transport, backend, store: actual, deletions },
          signal,
        ).then((authority) => {
          if (authority) {
            if (onAuthorizationCurrent) {
              const isCurrent = authority.isCurrent;
              vi.spyOn(authority, 'isCurrent').mockImplementation(() => {
                const current = isCurrent.call(authority);
                // Reenter only inside the real owner's authorization currentness check.
                // Every return value still comes from the original authority/owner.
                if (authorizing) onAuthorizationCurrent(authorizing);
                return current;
              });
            }
            const prepare = authority.prepare;
            // Call-through instrumentation retains the real object, method receiver and exact promise.
            vi.spyOn(authority, 'prepare').mockImplementation((request) => {
              const pending = prepare.call(authority, request);
              preparationPromises.push(pending);
              return pending;
            });
          }
          return authority;
        });
        observations.push(promise);
        return promise;
      },
    },
    bind(value) {
      port = value;
      return () => {};
    },
  });
  const errors: unknown[] = [];
  let stopRoot: (() => void) | undefined;
  let closed = false;
  function start() {
    stopRoot = actual.runSaga(function* fixtureRoot() {
      const status = yield* fork(backendConnectionSaga);
      const receiver = yield* fork(loader);
      try {
        yield* setContext({ reduxStore: observedRedux });
        yield* call(cleanup);
      } catch (error) {
        errors.push(error);
      } finally {
        yield* cancel(receiver);
        yield* cancel(status);
      }
    });
  }
  function close() {
    if (closed) return;
    closed = true;
    stopRoot?.();
    dispose();
    expect(errors).toEqual([]);
    expect(listeners.size).toBe(0);
    for (const originId of deliveredOrigins) {
      expect(
        calls.filter(
          (item) =>
            item.channel === channels.RELEASE_ORIGIN && Object(item.input).originId === originId,
        ),
      ).toHaveLength(1);
    }
  }
  stops.push(close);
  function emit(channel: string, payload: unknown) {
    for (const item of [...listeners.values()])
      if (item.channel === channel) item.callback(payload);
  }
  function list(channel: string) {
    return calls.filter((call) => call.channel === channel);
  }
  function next(channel: string, index = 0) {
    const present = list(channel)[index];
    if (present) return Promise.resolve(present);
    const key = `${channel}:${index}`;
    let waiter = waiters.get(key);
    if (!waiter) {
      waiter = deferred();
      waiters.set(key, waiter);
    }
    return waiter.promise;
  }
  function nextAction(type: string) {
    const waiter = deferred<Action>();
    actionWaiters.set(type, waiter);
    return waiter.promise;
  }
  function grant(id = 'reader') {
    const context = getPrincipalConnectionContext(actual.state);
    if (!context) throw new Error('Actual connection context missing');
    actual.dispatch(principalContextChanged(context));
    actual.dispatch(
      principalReceived(
        { context, invalidation: 0, presentationVersion: 0 },
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
  }
  actual.dispatch(
    connectionsListReceived({ connections: [], activeId: 'local', windowBackendId: 'local' }),
  );
  actual.dispatch(connectionStatusChanged('connected'));
  actual.dispatch(daemonEventsSubscribed());
  if (initialPrincipal) grant();
  async function resolveObservation(index: number, originId: string | null) {
    const item = await next(channels.OBSERVE_ORIGIN, index);
    if (originId) deliveredOrigins.add(originId);
    item.reply.resolve(
      originId
        ? { ok: true, result: { originId } }
        : {
            ok: false,
            error: {
              code: 'WORKSPACE_LOAD_ROUTE_UNAVAILABLE',
              message: 'Workspace load route unavailable',
            },
          },
    );
    await item.reply.promise;
    await observations[index]; // Original real adapter promise, not merely the native invocation.
  }
  async function prepare(index: number) {
    const item = await next(channels.PREPARE, index);
    const ref = { ...Object(item.input), routeId: `route-${index}` } as WorkspaceLoadRouteRef;
    item.reply.resolve({ ok: true, result: ref });
    await item.reply.promise;
    await preparationPromises[index]; // Drain the actual authority preparation, not just its wire reply.
    return ref;
  }
  async function succeedRead(index: number) {
    const item = await next(channels.READ, index);
    const { operation, ...ref } = item.input as WorkspaceLoadRead;
    item.reply.resolve({
      ok: true,
      result: {
        ref,
        current: true,
        settlement: {
          status: 'fulfilled',
          value:
            operation === 'open'
              ? { success: true, data: wireWorkspace(ref.workspaceId) }
              : { workspace: wireWorkspace(ref.workspaceId) },
        },
      },
    });
    await item.reply.promise;
  }
  return {
    actual,
    actions,
    invoke,
    listeners,
    observations,
    authorizations,
    signals,
    readyLookup,
    start,
    close,
    list,
    next,
    nextAction,
    port: () => port,
    grant,
    prepare,
    resolveObservation,
    succeedRead,
    wake: () => emit(IPC_CHANNELS.BACKEND.STATUS, { status: 'connected' }),
    emit,
    stopRoot: () => stopRoot?.(),
    hold() {
      holdNotifications = true;
    },
    flush() {
      holdNotifications = false;
      const callbacks = [...postponed];
      postponed.clear();
      for (const callback of callbacks) callback();
    },
    serial: (id: string) => actual.state.tabState.workspaceTabAcquisitions.serialByWorkspaceId[id],
  };
}

describe('asynchronous physical capture in the canonical tab owner', () => {
  it('parks a reentrant focus change inside actual authorization and closes capture until exact-intent refocus', async () => {
    const crossed = deferred<WorkspaceLoadOriginIntent>();
    let redirected = false;
    const f = fixture(true, (intent) => {
      if (redirected || intent.action.payload[0] !== A) return;
      redirected = true;
      // This dispatch runs synchronously inside real authority.isCurrent(), called by
      // the actual intent.authorizePublication(). No currentness result is substituted.
      f.actual.dispatch(openWorkspaceTab(B));
      crossed.resolve(intent);
    });
    f.start();
    f.actual.dispatch(openWorkspaceTab(A));
    const serial = f.serial(A);
    await f.resolveObservation(0, 'reentrant-A');
    const ref = await f.prepare(0);
    const intent = await crossed.promise;
    await f.next(channels.OBSERVE_ORIGIN, 1);
    expect(f.authorizations).toEqual([{ intent, accepted: true }]);
    expect(f.actual.state.tabState.currentTabId).toBe(B);
    expect(f.serial(A)).toBe(serial);
    expect(f.port().captureRequest(intent.action)).toBeNull();
    expect(f.actions.filter((action) => action.type === workspaceLoadRequested.type)).toEqual([]);
    expect(f.list(channels.READ)).toEqual([]);
    expect(f.list(channels.PREPARE)).toHaveLength(1);
    expect(f.list(channels.RELEASE_ORIGIN)).toEqual([]);

    f.actual.dispatch(openWorkspaceTab(A));
    const read = await f.next(channels.READ);
    expect(read.input).toEqual({ ...ref, operation: 'open' });
    expect(f.serial(A)).toBe(serial);
    const published = f.actions.filter((action) => action.type === workspaceLoadRequested.type);
    expect(published).toHaveLength(1);
    expect(published[0]).toBe(intent.action);
    expect(f.port().captureRequest(intent.action)).toBe(intent.lifetime);
    expect(f.port().captureRequest({ ...intent.action })).toBeNull();
    expect(f.list(channels.PREPARE)).toHaveLength(1);
    expect(f.list(channels.OBSERVE_ORIGIN)).toHaveLength(2);
    await f.resolveObservation(1, 'late-reentrant-B');
    expect((await f.next(channels.RELEASE_ORIGIN)).input).toEqual({ originId: 'late-reentrant-B' });
    f.close();
    expect(f.list(channels.RELEASE_ORIGIN).map((item) => item.input)).toEqual([
      { originId: 'late-reentrant-B' },
      { originId: 'reentrant-A' },
    ]);
  });

  it('discards focus demand when principal loss occurs after abort but before observation settlement', async () => {
    const f = fixture();
    f.start();
    f.actual.dispatch(openWorkspaceTab(A));
    await f.next(channels.OBSERVE_ORIGIN);
    // Keep all three transitions in one turn: the aborted actual adapter cannot finish yet.
    f.actual.dispatch(openWorkspaceTab(B));
    expect(f.signals[0].aborted).toBe(true);
    f.actual.dispatch(principalContextChanged(null));
    f.grant();
    await f.observations[0];
    await f.resolveObservation(0, 'late-before-principal-loss');
    expect((await f.next(channels.RELEASE_ORIGIN)).input).toEqual({
      originId: 'late-before-principal-loss',
    });
    expect(f.list(channels.OBSERVE_ORIGIN)).toHaveLength(1);
    expect(f.list(channels.PREPARE)).toEqual([]);
    expect(f.actions.filter((action) => action.type === workspaceLoadRequested.type)).toEqual([]);
    f.wake();
    await f.next(channels.OBSERVE_ORIGIN, 1);
    await f.resolveObservation(1, 'fresh-B');
    const prepared = await f.next(channels.PREPARE);
    expect(prepared.input).toMatchObject({ workspaceId: B, originId: 'fresh-B' });
  });

  it('retains a genuine post-loss wake while the focus-aborted observation is still settling', async () => {
    const f = fixture();
    f.start();
    f.actual.dispatch(openWorkspaceTab(A));
    await f.next(channels.OBSERVE_ORIGIN);
    f.actual.dispatch(openWorkspaceTab(B));
    f.actual.dispatch(principalContextChanged(null));
    f.grant();
    // This wake is after retirement. Repeated abort/finally bookkeeping must not erase it.
    f.wake();
    await f.observations[0];
    await f.next(channels.OBSERVE_ORIGIN, 1);
    await f.resolveObservation(0, 'retired-A');
    expect((await f.next(channels.RELEASE_ORIGIN)).input).toEqual({ originId: 'retired-A' });
    expect(f.list(channels.OBSERVE_ORIGIN)).toHaveLength(2);
    await f.resolveObservation(1, 'post-loss-B');
    expect((await f.next(channels.PREPARE)).input).toMatchObject({
      workspaceId: B,
      originId: 'post-loss-B',
    });
  });

  it('drops a pre-loss trailing wake and requires a fresh wake after a non-null principal change', async () => {
    const f = fixture();
    f.start();
    f.actual.dispatch(openWorkspaceTab(A));
    await f.next(channels.OBSERVE_ORIGIN);
    f.wake();
    const principal = f.actual.state.principal;
    const snapshot = principal.snapshot!;
    f.actual.dispatch(
      principalReceived(
        {
          context: principal.context!,
          invalidation: principal.invalidation,
          presentationVersion: principal.presentationVersion,
        },
        {
          ...snapshot,
          principal: { ...snapshot.principal, hostMembershipRevision: 2 },
        },
      ),
    );
    await f.observations[0];
    await f.resolveObservation(0, 'changed-principal');
    expect((await f.next(channels.RELEASE_ORIGIN)).input).toEqual({
      originId: 'changed-principal',
    });
    expect(f.list(channels.OBSERVE_ORIGIN)).toHaveLength(1);
    f.wake();
    await f.next(channels.OBSERVE_ORIGIN, 1);
  });

  it('uses the actual initial status snapshot as a wake after a null observation', async () => {
    const f = fixture();
    f.start();
    f.actual.dispatch(openWorkspaceTab(A));
    await f.resolveObservation(0, null);
    const snapshot = await f.next(IPC_CHANNELS.BACKEND.GET_STATUS);
    snapshot.reply.resolve({ status: 'connected' });
    await f.next(channels.OBSERVE_ORIGIN, 1);
    await f.resolveObservation(1, 'snapshot-origin');
    await f.next(channels.PREPARE);
  });

  it('does not turn a late initial snapshot into a wake after a newer pushed status', async () => {
    const f = fixture();
    f.start();
    f.actual.dispatch(openWorkspaceTab(A));
    await f.resolveObservation(0, null);
    f.wake();
    await f.resolveObservation(1, null);
    const snapshot = await f.next(IPC_CHANNELS.BACKEND.GET_STATUS);
    snapshot.reply.resolve({ status: 'connected' });
    await snapshot.reply.promise;
    expect(f.list(channels.OBSERVE_ORIGIN)).toHaveLength(2);
  });

  it('leaves post-publication principal loss to the canonical loader and suppresses late reads', async () => {
    const f = fixture();
    f.start();
    f.actual.dispatch(openWorkspaceTab(A));
    await f.resolveObservation(0, 'published-origin');
    await f.prepare(0);
    await f.next(channels.READ);
    const original = f.actions.find((a) => a.type === workspaceLoadRequested.type)!;
    f.actual.dispatch(principalContextChanged(null));
    expect((await f.next(channels.RELEASE_ORIGIN)).input).toEqual({ originId: 'published-origin' });
    expect(
      f.port().captureRequest(original as ReturnType<typeof workspaceLoadRequested>),
    ).toBeNull();
    await f.succeedRead(0);
    expect(f.actions.some((a) => a.type === workspaceLoadSucceeded.type)).toBe(false);
    f.grant();
    f.wake();
    await f.next(channels.OBSERVE_ORIGIN, 1);
  });

  it('retires parked A on principal loss instead of reviving it when the same context returns', async () => {
    const f = fixture();
    f.start();
    f.actual.dispatch(openWorkspaceTab(A));
    await f.resolveObservation(0, 'parked-A');
    await f.next(channels.PREPARE);
    f.actual.dispatch(openWorkspaceTab(B));
    await f.next(channels.OBSERVE_ORIGIN, 1);
    await f.prepare(0);
    f.actual.dispatch(principalContextChanged(null));
    f.grant();
    expect((await f.next(channels.RELEASE_ORIGIN)).input).toEqual({ originId: 'parked-A' });
    f.actual.dispatch(openWorkspaceTab(A));
    await f.next(channels.OBSERVE_ORIGIN, 2);
    expect(f.actions.some((a) => a.type === workspaceLoadRequested.type)).toBe(false);
    await f.resolveObservation(1, 'lost-B');
    expect(f.list(channels.PREPARE)).toHaveLength(1);
  });

  it('waits after null, then uses a genuine status wake without inventing readiness', async () => {
    const f = fixture();
    f.start();
    f.actual.dispatch(openWorkspaceTab(A));
    await f.resolveObservation(0, null);
    expect(f.list(channels.PREPARE)).toHaveLength(0);
    expect(f.list(channels.OBSERVE_ORIGIN)).toHaveLength(1);
    f.wake();
    await f.resolveObservation(1, 'allocated-origin');
    const pending = await f.next(channels.PREPARE);
    expect(pending.input).toMatchObject({ originId: 'allocated-origin', workspaceId: A });
    expect(f.list(channels.READ)).toHaveLength(0); // Pending capture before controlled hello/preparation.
    await f.prepare(0);
    const read = await f.next(channels.READ);
    expect(read.input).toMatchObject({
      originId: 'allocated-origin',
      workspaceId: A,
      operation: 'open',
    });
    expect(f.readyLookup).not.toHaveBeenCalled();
  });

  it('coalesces a burst during one observation to one trailing attempt and waits after its null', async () => {
    const f = fixture();
    f.start();
    f.actual.dispatch(openWorkspaceTab(A));
    await f.next(channels.OBSERVE_ORIGIN);
    for (let i = 0; i < 20; i++) f.wake();
    expect(f.list(channels.OBSERVE_ORIGIN)).toHaveLength(1);
    await f.resolveObservation(0, null);
    await f.next(channels.OBSERVE_ORIGIN, 1);
    await f.resolveObservation(1, null);
    expect(f.list(channels.OBSERVE_ORIGIN)).toHaveLength(2);
    expect(f.list(channels.PREPARE)).toHaveLength(0);
  });

  it('drains a cancelled A reply through its original bridge while focused B proceeds', async () => {
    const f = fixture();
    f.start();
    f.actual.dispatch(openWorkspaceTab(A));
    await f.next(channels.OBSERVE_ORIGIN);
    f.actual.dispatch(openWorkspaceTab(B));
    await f.next(channels.OBSERVE_ORIGIN, 1);
    expect(f.signals[0].aborted).toBe(true);
    await f.resolveObservation(1, 'B-origin');
    await f.prepare(0);
    const b = await f.next(channels.READ);
    expect(b.input).toMatchObject({ workspaceId: B });
    await f.resolveObservation(0, 'late-A');
    const released = await f.next(channels.RELEASE_ORIGIN);
    expect(released.input).toEqual({ originId: 'late-A' });
    expect(f.list(channels.PREPARE)).toHaveLength(1);
    expect(
      f.list(channels.RELEASE_ORIGIN).filter((x) => Object(x.input).originId === 'late-A'),
    ).toHaveLength(1);
    expect(
      f.list(channels.RELEASE_ORIGIN).some((x) => Object(x.input).originId === 'B-origin'),
    ).toBe(false);
  });

  it('parks late prepared A, keeps B loading, and publishes that exact A intent only on refocus', async () => {
    const f = fixture();
    f.start();
    f.actual.dispatch(openWorkspaceTab(A));
    await f.resolveObservation(0, 'A-origin');
    const a = await f.next(channels.PREPARE);
    f.actual.dispatch(openWorkspaceTab(B));
    await f.resolveObservation(1, 'B-origin');
    await f.prepare(1);
    const bRead = await f.next(channels.READ);
    expect(bRead.input).toMatchObject({ workspaceId: B });
    await f.prepare(0);
    expect(
      f.actions.filter((a) => a.type === workspaceLoadRequested.type).map((a) => a.payload),
    ).toEqual([[B]]);
    expect(f.actions.some((a) => a.type === workspaceLoadCancelled.type)).toBe(false);
    const bDone = f.nextAction(workspaceLoadSucceeded.type);
    await f.succeedRead(0);
    await bDone;
    f.actual.dispatch(workspaceMounted(B));
    const before = f.actions.filter(
      (a) => a.type === workspaceUnmounted.type && Object(a.payload)[0] === B,
    ).length;
    f.actual.dispatch(openWorkspaceTab(A));
    const aRead = await f.next(channels.READ, 1);
    expect(aRead.input).toMatchObject({
      ...Object(a.input),
      routeId: 'route-0',
      operation: 'open',
    });
    const action = f.actions.find(
      (a) => a.type === workspaceLoadRequested.type && Object(a.payload)[0] === A,
    )!;
    expect(
      f.port().captureRequest(action as ReturnType<typeof workspaceLoadRequested>),
    ).not.toBeNull();
    expect(
      f.port().captureRequest({ ...action } as ReturnType<typeof workspaceLoadRequested>),
    ).toBeNull();
    expect(
      f.actions.filter((a) => a.type === workspaceUnmounted.type && Object(a.payload)[0] === B),
    ).toHaveLength(before);
    expect(f.list(channels.PREPARE)).toHaveLength(2);
  });

  for (const replace of ['close-reopen', 'reset'] as const)
    it(`refuses a withheld capture after ${replace}`, async () => {
      const f = fixture();
      f.start();
      f.actual.dispatch(openWorkspaceTab(A));
      await f.next(channels.OBSERVE_ORIGIN);
      const serial = f.serial(A);
      if (replace === 'close-reopen') {
        f.actual.dispatch(closeWorkspaceTab(A));
        f.actual.dispatch(openWorkspaceTab(A));
      } else
        f.actual.dispatch(
          loadWorkspaceTabsState(serializeWorkspaceTabsState(f.actual.state.tabState)),
        );
      expect(f.serial(A)).not.toBe(serial);
      await f.next(channels.OBSERVE_ORIGIN, 1);
      await f.resolveObservation(0, 'old-origin');
      expect((await f.next(channels.RELEASE_ORIGIN)).input).toEqual({ originId: 'old-origin' });
      await f.resolveObservation(1, 'new-origin');
      expect((await f.next(channels.PREPARE)).input).toMatchObject({ originId: 'new-origin' });
      expect(f.list(channels.PREPARE)).toHaveLength(1);
    });

  for (const nextPrincipal of ['reader', 'replacement'] as const)
    it(`permanently retires observed principal loss before ${nextPrincipal} returns`, async () => {
      const f = fixture();
      f.start();
      f.actual.dispatch(openWorkspaceTab(A));
      await f.next(channels.OBSERVE_ORIGIN);
      f.actual.dispatch(principalContextChanged(null));
      f.grant(nextPrincipal);
      await f.observations[0];
      await f.resolveObservation(0, 'lost-principal-origin');
      expect((await f.next(channels.RELEASE_ORIGIN)).input).toEqual({
        originId: 'lost-principal-origin',
      });
      expect(f.list(channels.PREPARE)).toHaveLength(0);
      expect(f.list(channels.OBSERVE_ORIGIN)).toHaveLength(1);
      f.wake();
      await f.next(channels.OBSERVE_ORIGIN, 1);
    });

  it('latches the first non-null context while observation waits without granting reads', async () => {
    const f = fixture(false);
    f.start();
    f.actual.dispatch(openWorkspaceTab(A));
    await f.next(channels.OBSERVE_ORIGIN);
    f.grant();
    await f.resolveObservation(0, 'pending-hello');
    await f.next(channels.PREPARE);
    expect(f.list(channels.READ)).toHaveLength(0);
    await f.prepare(0);
    await f.next(channels.READ);
  });

  it('leaves principal readiness to the loader when publication happened before any principal', async () => {
    const f = fixture(false);
    f.start();
    f.actual.dispatch(openWorkspaceTab(A));
    await f.resolveObservation(0, 'early-origin');
    await f.prepare(0);
    const action = f.actions.find((a) => a.type === workspaceLoadRequested.type);
    // Synchronize on actual publication, not a guessed microtask count.
    if (!action) await f.nextAction(workspaceLoadRequested.type);
    expect(f.list(channels.READ)).toHaveLength(0);
    f.grant();
    await f.next(channels.READ);
  });

  for (const point of ['observation', 'preparation'] as const)
    it(`checks the direct snapshot at ${point} completion despite withheld notifications`, async () => {
      const f = fixture();
      f.start();
      f.actual.dispatch(openWorkspaceTab(A));
      if (point === 'preparation') {
        await f.resolveObservation(0, 'original');
        await f.next(channels.PREPARE);
      } else await f.next(channels.OBSERVE_ORIGIN);
      f.hold();
      f.actual.dispatch(principalContextChanged(null));
      if (point === 'observation') await f.resolveObservation(0, 'original');
      else await f.prepare(0);
      expect((await f.next(channels.RELEASE_ORIGIN)).input).toEqual({ originId: 'original' });
      expect(f.actions.some((a) => a.type === workspaceLoadRequested.type)).toBe(false);
      expect(f.list(channels.READ)).toHaveLength(0);
      f.flush();
    });

  it('releases a parked intent on physical retirement and does not resurrect it on refocus', async () => {
    const f = fixture();
    f.start();
    f.actual.dispatch(openWorkspaceTab(A));
    await f.resolveObservation(0, 'old-A');
    await f.next(channels.PREPARE);
    f.actual.dispatch(openWorkspaceTab(B));
    await f.resolveObservation(1, 'B-origin');
    await f.prepare(1);
    await f.next(channels.READ);
    const ref = await f.prepare(0);
    f.emit(channels.RETIRED, { kind: 'origin', originId: ref.originId });
    expect((await f.next(channels.RELEASE_ORIGIN)).input).toEqual({ originId: 'old-A' });
    f.actual.dispatch(openWorkspaceTab(A));
    await f.next(channels.OBSERVE_ORIGIN, 2);
    expect(
      f.actions.filter((a) => a.type === workspaceLoadRequested.type).map((a) => a.payload),
    ).toEqual([[B]]);
  });

  it('stops the root promptly, detaches listeners, and releases one late native reply', async () => {
    const f = fixture();
    f.start();
    f.actual.dispatch(openWorkspaceTab(A));
    await f.next(channels.OBSERVE_ORIGIN);
    f.stopRoot();
    expect(f.signals[0].aborted).toBe(true);
    await f.observations[0];
    expect(f.listeners.size).toBe(0);
    await f.resolveObservation(0, 'after-stop');
    expect((await f.next(channels.RELEASE_ORIGIN)).input).toEqual({ originId: 'after-stop' });
    expect(f.list(channels.RELEASE_ORIGIN)).toHaveLength(1);
    expect(f.list(channels.PREPARE)).toHaveLength(0);
  });

  it('keeps the queue draining close cleanup while an observation is withheld', async () => {
    const f = fixture();
    f.start();
    f.actual.dispatch(openWorkspaceTab(A));
    await f.next(channels.OBSERVE_ORIGIN);
    const before = f.actions.filter((a) => a.type === workspaceUnmounted.type).length;
    f.actual.dispatch(closeWorkspaceTab(A));
    expect(f.actions.filter((a) => a.type === workspaceUnmounted.type)).toHaveLength(before + 1);
    expect(f.signals[0].aborted).toBe(true);
    await f.resolveObservation(0, 'closed');
    expect((await f.next(channels.RELEASE_ORIGIN)).input).toEqual({ originId: 'closed' });
  });
});
