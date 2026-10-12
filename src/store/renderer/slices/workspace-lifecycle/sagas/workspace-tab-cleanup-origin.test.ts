// Actual installed Store, reducers, cleanup owner and b0 loader; controlled route contract only.
// No product host, physical backend identity or main bridge integration is claimed here.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReactStore } from '@themislib/themis/react-store';
import type { StoreDispatch, StoreMiddleware } from '@themislib/themis/types';
import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import { call, cancel, fork, getContext, setContext } from 'typed-redux-saga';
import { WorkspaceStatus, type Workspace, type Result } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
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
  principalReceived,
  principalReducer,
} from '../../principal/principal-slice';
import { userPreferencesReducer } from '../../user-preferences/user-preferences-slice';
import {
  closeWorkspaceTab,
  openWorkspaceTab,
  restoreWorkspaceTab,
} from '../../tab-state/tab-state-slice';
import { acquiredTabStateReducer } from '../../tab-state/tab-state-acquisition-reducer';
import { setWorkspaceEntity, workspaceReducer } from '../../workspace/workspace-slice';
import { workspaceNavigationReducer } from '../../workspace-navigation/workspace-navigation-slice';
import {
  workspaceHydrationRequested,
  workspaceLifecycleReducer,
  workspaceLoadFailed,
  workspaceLoadRequested,
  workspaceLoadStarted,
  workspaceLoadSucceeded,
  workspaceMounted,
  workspaceOpenSucceeded,
  workspaceUnmounted,
} from '../workspace-lifecycle-slice';
import {
  createIsWorkspaceSessionLiveProjection,
  getWorkspaceSessionPhase,
  getWorkspaceLoadState,
} from '../workspace-lifecycle-projections';
import type {
  WorkspaceLoadReadScope,
  WorkspaceLoadRequestLifetime,
} from '../workspace-load-admission-types';
import type {
  PreparedWorkspaceLoadOrigin,
  WorkspaceLoadOriginPort,
  WorkspaceOriginAuthority,
} from '../workspace-load-origin-types';
import { createWorkspaceLoadSaga } from './workspace-load-saga-factory';
import { createWorkspaceTabCleanupSaga } from './workspace-tab-cleanup-saga-factory';

const reducers = {
  connections: connectionsReducer,
  daemonHealth: daemonHealthReducer,
  workspaceEvents: workspaceEventsReducer,
  principal: principalReducer,
  userPreferences: userPreferencesReducer,
  workspace: workspaceReducer,
  workspaceLifecycle: workspaceLifecycleReducer,
  tabState: acquiredTabStateReducer,
  workspaceNavigation: workspaceNavigationReducer,
};
type DomainState = { [K in keyof typeof reducers]: ReturnType<(typeof reducers)[K]> };
type State = ReactStore<DomainState>['state'];
type Action = { type: string; payload?: unknown };
type ReduxContext = {
  getState(): State;
  dispatch: StoreDispatch;
  subscribe(fn: () => void): () => void;
};
const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0).reverse()) stop();
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
function workspace(id: string): Workspace {
  return {
    id: WorkspaceId(id),
    title: id,
    branch: 'main',
    path: '/checkout',
    repositoryPath: '/repo',
    worktreePath: '/checkout',
    status: WorkspaceStatus.Active,
    changesets: [],
    timeline: [],
    conversationInfo: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function fixture() {
  const actions: Action[] = [];
  const trace: string[] = [];
  const errors: unknown[] = [];
  const record: StoreMiddleware = () => (next) => (action) => {
    actions.push(action as Action);
    return next(action);
  };
  const actual = new ReactStore(reducers, record); // Store owns the ONLY saga middleware.
  const dispose = actual.init();
  let redux!: ReduxContext;
  actual.runSaga(function* readContext() {
    redux = yield* getContext<ReduxContext>('reduxStore');
  })();
  let held = false;
  let selectorSubscriptions = 0;
  const pending = new Set<() => void>();
  const selectorContext = {
    ...redux,
    subscribe(fn: () => void) {
      selectorSubscriptions++;
      const off = redux.subscribe(() => (held ? pending.add(fn) : fn()));
      return () => {
        selectorSubscriptions--;
        pending.delete(fn);
        off();
      };
    },
  };
  const principal = actual.createSelector(getPrincipalActionContext);
  const entity = actual.createSelector(
    (s: State, id: string) =>
      getItem(s.workspace.workspaces, WorkspaceId(id)) ?? s.workspace.pendingCreations[id],
  );
  const phase = actual.createSelector(getWorkspaceSessionPhase);
  const live = actual.createSelector(createIsWorkspaceSessionLiveProjection(phase));
  const load = actual.createSelector(getWorkspaceLoadState);
  let port: WorkspaceLoadOriginPort | undefined;
  const authorities = new Map<string, WorkspaceOriginAuthority>();
  const preparations: ReturnType<typeof preparation>[] = [];
  // This is a declared dependency-contract double, not a replacement production route/host.
  function preparation(request: WorkspaceLoadRequestLifetime) {
    const ready = deferred<PreparedWorkspaceLoadOrigin | null>();
    const opened = deferred<Result<Workspace, string>>();
    const resource = new AbortController();
    let released = false;
    const releaseScope = vi.fn(() => {
      trace.push(`scope-release:${request.workspaceId}`);
    });
    const open = vi.fn<(id: WorkspaceId) => Promise<Result<Workspace, string>>>(() => {
      trace.push(`open:${request.workspaceId}`);
      return opened.promise;
    });
    const get = vi.fn<(id: string) => Promise<Workspace | null>>().mockResolvedValue(null);
    let scope: WorkspaceLoadReadScope | undefined;
    const value: PreparedWorkspaceLoadOrigin = {
      requestIdentity: request.identity,
      signal: resource.signal,
      isCurrent: () => !released && !resource.signal.aborted,
      acquireReadScope: vi.fn((context) => {
        scope = {
          requestIdentity: request.identity,
          context,
          signal: resource.signal,
          isCurrent: () => !released && !resource.signal.aborted,
          workspaceClient: { open },
          appClient: { workspaces: { get } },
          release: releaseScope,
        };
        return scope;
      }),
      release: vi.fn(() => {
        if (released) return;
        released = true;
        trace.push(`route-release:${request.workspaceId}`);
      }),
    };
    request.signal.addEventListener(
      'abort',
      () => trace.push(`request-abort:${request.workspaceId}`),
      { once: true },
    );
    return {
      request,
      ready,
      opened,
      value,
      open,
      get,
      releaseScope,
      resource,
      scope: () => scope,
      admit: () => ready.resolve(value),
      succeed: () => opened.resolve({ ok: true, data: workspace(request.workspaceId) }),
    };
  }
  function authority(id: string) {
    const controller = new AbortController();
    const value: WorkspaceOriginAuthority = {
      identity: {},
      signal: controller.signal,
      isCurrent: () => !controller.signal.aborted,
      prepare: vi.fn((request) => {
        const item = preparation(request);
        preparations.push(item);
        trace.push(`prepare:${request.workspaceId}`);
        return item.ready.promise;
      }),
    };
    // Test-controlled original anchor is captured BEFORE submission, never on ready lookup.
    authorities.set(id, value);
    return { value, controller };
  }
  const firstA = authority('A');
  const firstB = authority('B');
  const loader = createWorkspaceLoadSaga({
    selectWorkspaceById: entity,
    selectIsWorkspaceSessionLive: live,
    selectWorkspaceLoadState: load,
    admission: {
      kind: 'principal',
      contextSelector: principal,
      readCurrentContext: () => getPrincipalActionContext(redux.getState()),
      dispatch: actual.dispatch,
      captureRequest: (action) => port?.captureRequest(action) ?? null,
    },
  });
  const cleanup = createWorkspaceTabCleanupSaga<State>({
    kind: 'origin',
    selectIsWorkspaceSessionLive: live,
    readReadyAuthority: (id) => authorities.get(id) ?? null,
    bind: (value) => {
      port = value;
      return () => {
        trace.push('owner-unbound');
      };
    },
  });
  let stopRoot: (() => void) | undefined;
  let disposed = false;
  function start() {
    stopRoot = actual.runSaga(function* testLifecycleRoot() {
      const receiver = yield* fork(function* canonicalLoaderWithHeldSelectorContext() {
        yield* setContext({ reduxStore: selectorContext });
        yield* call(loader);
      });
      try {
        yield* call(cleanup);
      } catch (error) {
        errors.push(error);
        trace.push('root-caught');
      } finally {
        // Explicit reviewable root contract; this does NOT activate a product root.
        trace.push('receiver-stopping');
        yield* cancel(receiver);
        trace.push('receiver-stopped');
      }
    });
  }
  function close() {
    if (disposed) return;
    disposed = true;
    stopRoot?.();
    trace.push('store-disposing');
    dispose();
  }
  stops.push(close);
  function onAction(type: string, fn: () => void) {
    let fired = false;
    const off = redux.subscribe(() => {
      if (!fired && actions.at(-1)?.type === type) {
        fired = true;
        fn();
      }
    });
    stops.push(off);
  }
  redux.dispatch(
    connectionsListReceived({
      connections: [],
      activeId: 'local',
      windowBackendId: 'local',
    }),
  );
  redux.dispatch(connectionStatusChanged('connected'));
  redux.dispatch(daemonEventsSubscribed());
  const connection = getPrincipalConnectionContext(redux.getState());
  expect(connection).not.toBeNull();
  redux.dispatch(principalContextChanged(connection));
  redux.dispatch(
    principalReceived(
      { context: connection!, invalidation: 0, presentationVersion: 0 },
      {
        principal: {
          id: 'reader',
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
  expect(getPrincipalActionContext(redux.getState())).not.toBeNull();
  return {
    actual,
    redux,
    actions,
    trace,
    errors,
    preparations,
    firstA,
    firstB,
    authority,
    start,
    close,
    stopRoot: () => stopRoot?.(),
    onAction,
    port: () => port!,
    items: (id: string) => preparations.filter((x) => x.request.workspaceId === id),
    phase: (id: string) => phase.select(redux.getState(), id),
    load: (id: string) => load.select(redux.getState(), id),
    entity: (id: string) => entity.select(redux.getState(), id),
    serial: (id: string) =>
      redux.getState().tabState.workspaceTabAcquisitions.serialByWorkspaceId[id],
    hold: () => {
      held = true;
    },
    subscriptions: () => selectorSubscriptions,
    flush: () => {
      held = false;
      const callbacks = [...pending];
      pending.clear();
      callbacks.forEach((fn) => fn());
    },
    count: (type: string, id: string) =>
      actions.filter((a) => a.type === type && Array.isArray(a.payload) && a.payload[0] === id)
        .length,
  };
}

async function openPrepared(item: ReturnType<ReturnType<typeof fixture>['items']>[number]) {
  item.admit();
  await vi.waitFor(() => expect(item.open).toHaveBeenCalledTimes(1));
}

describe('canonical accepted-tab origin owner with actual b0 receiver', () => {
  it('refuses missing inherited IDs and unowned actions without preparing or reading', () => {
    const f = fixture();
    f.start();
    expect(f.port().submit('__proto__', f.firstA.value)).toBe(false);
    expect(f.port().submit('constructor', f.firstA.value)).toBe(false);
    f.actual.dispatch(workspaceLoadRequested('A'));
    expect(f.preparations).toHaveLength(0);
    expect(f.count(workspaceLoadStarted.type, 'A')).toBe(0);
  });

  it('publishes only after cleanup and preparation, then exercises the real loader outputs', async () => {
    const f = fixture();
    f.start();
    f.actual.dispatch(openWorkspaceTab('A'));
    const item = f.items('A')[0];
    expect(item).toBeDefined();
    expect(f.count(workspaceUnmounted.type, 'A')).toBe(1);
    expect(f.count(workspaceLoadRequested.type, 'A')).toBe(0);
    await openPrepared(item);
    expect(item.open).toHaveBeenCalledWith(WorkspaceId('A'));
    expect(f.count(workspaceHydrationRequested.type, 'A')).toBe(1);
    item.succeed();
    await vi.waitFor(() => expect(f.load('A').status).toBe('ready'));
    expect(f.entity('A')).toEqual(workspace('A'));
    const relevant = f.actions.filter((a) =>
      [
        workspaceUnmounted.type,
        workspaceLoadRequested.type,
        workspaceLoadStarted.type,
        workspaceHydrationRequested.type,
      ].includes(a.type),
    );
    expect(relevant.map((a) => a.type)).toEqual([
      workspaceUnmounted.type,
      workspaceLoadRequested.type,
      workspaceLoadStarted.type,
      workspaceHydrationRequested.type,
    ]);
  });

  it('keeps focus/no-op/rejected actions on the same pending acquisition', () => {
    const f = fixture();
    f.start();
    f.actual.dispatch(openWorkspaceTab('A'));
    const item = f.items('A')[0];
    const serial = f.serial('A');
    f.actual.dispatch(restoreWorkspaceTab('B')); // Accepted background opening does not reload A.
    f.actual.dispatch(openWorkspaceTab('A'));
    f.actual.dispatch(openWorkspaceTab('new'));
    f.actual.dispatch(closeWorkspaceTab('missing', 1));
    expect(f.serial('A')).toBe(serial);
    expect(f.items('A')).toEqual([item]);
    expect(item.request.isCurrent()).toBe(true);
  });

  for (const order of ['earlier', 'later'] as const) {
    it(`rejects the closed opening even when an ${order} raw subscriber reopens before observation`, async () => {
      const f = fixture();
      let directAtClose: boolean | undefined;
      const reenter = () => {
        directAtClose = original.request.isCurrent();
        f.actual.dispatch(openWorkspaceTab('A'));
      };
      const observeClosed = () => {
        let fired = false;
        const off = f.redux.subscribe(() => {
          if (!fired && f.redux.getState().tabState.openTabs.A !== true) {
            fired = true;
            reenter();
          }
        });
        stops.push(off);
      };
      f.actual.dispatch(openWorkspaceTab('A'));
      if (order === 'earlier') observeClosed();
      f.start();
      const original = f.items('A')[0];
      await openPrepared(original);
      if (order === 'later') observeClosed();
      const serial = f.serial('A');
      f.actual.dispatch(closeWorkspaceTab('A', 2));
      expect(directAtClose).toBe(false); // Raw accepted ordinal is already authoritative.
      expect(f.serial('A')).not.toBe(serial);
      expect(original.request.signal.aborted).toBe(true);
      const successor = f.items('A').at(-1)!;
      expect(successor.request.identity).not.toBe(original.request.identity);
      await openPrepared(successor);
      original.opened.reject(new Error('retired read'));
      successor.succeed();
      await vi.waitFor(() => expect(f.load('A').status).toBe('ready'));
      expect(f.count(workspaceLoadFailed.type, 'A')).toBe(0);
    });
  }

  for (const trigger of ['startup', 'retirement'] as const) {
    it(`rechecks ownership during the ${trigger} cleanup dispatch before publishing`, async () => {
      const f = fixture();
      if (trigger === 'startup') f.actual.dispatch(openWorkspaceTab('A'));
      else {
        f.start();
        f.actual.dispatch(openWorkspaceTab('A'));
        await openPrepared(f.items('A')[0]);
      }
      const before = f.serial('A');
      f.onAction(workspaceUnmounted.type, () => {
        f.actual.dispatch(closeWorkspaceTab('A', 3));
        f.actual.dispatch(openWorkspaceTab('A'));
      });
      if (trigger === 'startup') f.start();
      else f.actual.dispatch(closeWorkspaceTab('A', 4));
      expect(f.serial('A')).not.toBe(before);
      const current = f.items('A').filter((item) => item.request.isCurrent());
      expect(current).toHaveLength(1);
      await openPrepared(current[0]);
      current[0].succeed();
      await vi.waitFor(() => expect(f.load('A').status).toBe('ready'));
      expect(f.phase('A')).toBe('opened');
    });
  }

  it('rejects the original publication when an earlier subscriber replaces its tab during dispatch', async () => {
    const f = fixture();
    f.onAction(workspaceLoadRequested.type, () => {
      f.actual.dispatch(closeWorkspaceTab('A', 9));
      f.actual.dispatch(openWorkspaceTab('A'));
    });
    f.start();
    f.actual.dispatch(openWorkspaceTab('A'));
    const old = f.items('A')[0];
    old.admit();
    await vi.waitFor(() => expect(f.items('A')).toHaveLength(2));
    const next = f.items('A')[1];
    await openPrepared(next);
    expect(old.open).not.toHaveBeenCalled();
    expect(old.request.signal.aborted).toBe(true);
    expect(f.count(workspaceLoadStarted.type, 'A')).toBe(1);
  });

  it('does not receipt or publish the authority replaced reentrantly inside cleanup', async () => {
    const f = fixture();
    f.start();
    const nextAuthority = f.authority('A');
    // Automatic opening uses the original captured handle; replacement is an explicit submission.
    f.onAction(workspaceUnmounted.type, () => f.port().submit('A', nextAuthority.value));
    // Set the originally captured authority back before the accepting tab action.
    const originalAuthority = f.authority('A');
    f.actual.dispatch(openWorkspaceTab('A'));
    expect(originalAuthority.value.prepare).not.toHaveBeenCalled();
    expect(nextAuthority.value.prepare).toHaveBeenCalledTimes(1);
    const next = f.items('A')[0];
    await openPrepared(next);
    next.succeed();
    await vi.waitFor(() => expect(f.load('A').status).toBe('ready'));
    expect(f.count(workspaceLoadRequested.type, 'A')).toBe(1);
    expect(f.count(workspaceUnmounted.type, 'A')).toBe(2);
  });

  it('cleans an already-live startup before a fresh scoped open', async () => {
    const f = fixture();
    f.actual.dispatch(openWorkspaceTab('A'));
    f.actual.dispatch(setWorkspaceEntity(workspace('A')));
    f.actual.dispatch(workspaceOpenSucceeded('A'));
    f.actual.dispatch(workspaceMounted('A'));
    f.actual.dispatch(workspaceLoadSucceeded('A'));
    expect(f.phase('A')).toBe('live');
    f.start();
    expect(f.phase('A')).toBeUndefined();
    expect(f.load('A').status).toBe('idle');
    await openPrepared(f.items('A')[0]);
    expect(f.count(workspaceHydrationRequested.type, 'A')).toBe(1);
  });

  it('cleans a new authority on an unchanged tab and fences the old scope finally', async () => {
    const f = fixture();
    f.start();
    f.actual.dispatch(openWorkspaceTab('A'));
    const old = f.items('A')[0];
    await openPrepared(old);
    f.actual.dispatch(workspaceOpenSucceeded('A'));
    f.actual.dispatch(workspaceMounted('A'));
    const serial = f.serial('A');
    const nextAuthority = f.authority('A');
    expect(f.port().submit('A', nextAuthority.value)).toBe(true);
    expect(f.serial('A')).toBe(serial);
    expect(f.phase('A')).toBeUndefined();
    expect(old.request.signal.aborted).toBe(true);
    const next = f.items('A')[1];
    await openPrepared(next);
    const releases = old.releaseScope.mock.calls.length;
    old.opened.resolve({
      ok: true,
      data: { ...workspace('A'), title: 'obsolete' },
    });
    expect(next.request.isCurrent()).toBe(true);
    next.succeed();
    await vi.waitFor(() => expect(f.load('A').status).toBe('ready'));
    expect(f.entity('A')?.title).toBe('A');
    expect(releases).toBe(1);
    expect(f.count(workspaceUnmounted.type, 'A')).toBe(2);
  });

  it('keeps a replacement submitted from the old scope finally release callback', async () => {
    const f = fixture();
    f.start();
    f.actual.dispatch(openWorkspaceTab('A'));
    const old = f.items('A')[0];
    await openPrepared(old);
    const nextAuthority = f.authority('A');
    old.releaseScope.mockImplementationOnce(() => {
      f.trace.push('scope-release:A');
      f.port().submit('A', nextAuthority.value);
    });
    // Real abort drives b0's actual finally, whose owned release reenters the canonical owner.
    f.firstA.controller.abort();
    const next = f.items('A')[1];
    expect(next.request.isCurrent()).toBe(true);
    await openPrepared(next);
    old.opened.reject(new Error('old finally completed'));
    next.succeed();
    await vi.waitFor(() => expect(f.load('A').status).toBe('ready'));
    expect(old.releaseScope).toHaveBeenCalledTimes(1);
    expect(f.count(workspaceLoadFailed.type, 'A')).toBe(0);
  });

  it('drains B cleanup while A preparation never settles', async () => {
    const f = fixture();
    f.start();
    f.actual.dispatch(openWorkspaceTab('B'));
    const oldB = f.items('B')[0];
    await openPrepared(oldB);
    f.actual.dispatch(workspaceMounted('B'));
    f.actual.dispatch(openWorkspaceTab('A')); // Leave A.ready.promise unresolved forever.
    const pendingA = f.items('A')[0];
    expect(pendingA.open).not.toHaveBeenCalled();
    const before = f.count(workspaceUnmounted.type, 'B');
    f.actual.dispatch(closeWorkspaceTab('B', 5));
    // Immediate, no timers or promise settlement: unrelated I/O cannot hold domain cleanup.
    expect(f.count(workspaceUnmounted.type, 'B')).toBe(before + 1);
    expect(f.phase('B')).toBeUndefined();
    expect(f.load('B').status).toBe('idle');
    expect(oldB.request.signal.aborted).toBe(true);
    f.actual.dispatch(openWorkspaceTab('B'));
    const newB = f.items('B')[1];
    expect(newB.request.identity).not.toBe(oldB.request.identity);
    expect(pendingA.request.isCurrent()).toBe(true);
    await openPrepared(newB);
    newB.succeed();
    await vi.waitFor(() => expect(f.load('B').status).toBe('ready'));
  });

  it('rejects stale reads with selector callbacks held across same-ID reopen', async () => {
    const f = fixture();
    f.start();
    f.actual.dispatch(openWorkspaceTab('A'));
    const old = f.items('A')[0];
    await openPrepared(old);
    f.hold();
    f.actual.dispatch(closeWorkspaceTab('A', 6));
    f.actual.dispatch(openWorkspaceTab('A'));
    expect(old.request.isCurrent()).toBe(false);
    const next = f.items('A')[1];
    await openPrepared(next);
    old.opened.reject(new Error('late failure'));
    next.succeed();
    await vi.waitFor(() => expect(f.load('A').status).toBe('ready'));
    f.flush();
    expect(f.count(workspaceLoadFailed.type, 'A')).toBe(0);
    expect(f.entity('A')?.title).toBe('A');
  });

  it('survives genuine authority-abort reentrance without retiring its replacement', async () => {
    const f = fixture();
    f.start();
    f.actual.dispatch(openWorkspaceTab('A'));
    const old = f.items('A')[0];
    await openPrepared(old);
    const nextAuthority = f.authority('A');
    old.request.signal.addEventListener(
      'abort',
      () => {
        f.port().submit('A', nextAuthority.value);
      },
      { once: true },
    );
    f.firstA.controller.abort();
    const next = f.items('A')[1];
    expect(next.request.isCurrent()).toBe(true);
    await openPrepared(next);
    next.succeed();
    await vi.waitFor(() => expect(f.load('A').status).toBe('ready'));
    expect(old.releaseScope).toHaveBeenCalledTimes(1);
  });

  it('rejects authority currentness that replaces the binding while returning true', async () => {
    const f = fixture();
    f.start();
    f.actual.dispatch(openWorkspaceTab('A'));
    const old = f.items('A')[0];
    const nextAuthority = f.authority('A');
    let armed = true;
    vi.spyOn(f.firstA.value, 'isCurrent').mockImplementation(() => {
      if (armed) {
        armed = false;
        f.port().submit('A', nextAuthority.value);
      }
      return true;
    });
    expect(old.request.isCurrent()).toBe(false);
    expect(old.request.signal.aborted).toBe(true);
    old.admit();
    const next = f.items('A')[1];
    await openPrepared(next);
    expect(old.open).not.toHaveBeenCalled();
    expect(next.request.isCurrent()).toBe(true);
    expect(f.count(workspaceLoadRequested.type, 'A')).toBe(1);
  });

  for (const boundary of ['installation', 'active-currentness'] as const) {
    it(`rejects prepared ${boundary} that replaces ownership while returning true`, async () => {
      const f = fixture();
      f.start();
      f.actual.dispatch(openWorkspaceTab('A'));
      const old = f.items('A')[0];
      if (boundary === 'active-currentness') await openPrepared(old);
      const nextAuthority = f.authority('A');
      let armed = true;
      vi.spyOn(old.value, 'isCurrent').mockImplementation(() => {
        if (armed) {
          armed = false;
          f.port().submit('A', nextAuthority.value);
        }
        return true;
      });
      if (boundary === 'installation') {
        old.admit();
        await vi.waitFor(() => expect(f.items('A')).toHaveLength(2));
        expect(old.open).not.toHaveBeenCalled();
      } else {
        expect(old.request.isCurrent()).toBe(false);
      }
      const next = f.items('A')[1];
      await openPrepared(next);
      expect(old.request.signal.aborted).toBe(true);
      expect(next.request.isCurrent()).toBe(true);
      expect(old.value.release).toHaveBeenCalledTimes(1);
      next.succeed();
      await vi.waitFor(() => expect(f.load('A').status).toBe('ready'));
      expect(f.count(workspaceLoadFailed.type, 'A')).toBe(0);
    });
  }

  for (const boundary of [
    'acquire',
    'scope-currentness',
    'identity-getter',
    'context-getter',
  ] as const) {
    it(`fences retirement from the scope ${boundary} callback`, async () => {
      const f = fixture();
      f.start();
      f.actual.dispatch(openWorkspaceTab('A'));
      const old = f.items('A')[0];
      const nextAuthority = f.authority('A');
      let armed = true;
      const replace = () => {
        if (armed) {
          armed = false;
          f.port().submit('A', nextAuthority.value);
        }
      };
      const acquire = vi.mocked(old.value.acquireReadScope).getMockImplementation()!;
      vi.mocked(old.value.acquireReadScope).mockImplementation((context) => {
        const scope = acquire(context)!;
        if (boundary === 'acquire') replace();
        if (boundary === 'scope-currentness')
          scope.isCurrent = () => {
            replace();
            return true;
          };
        if (boundary === 'identity-getter')
          Object.defineProperty(scope, 'requestIdentity', {
            get: () => {
              replace();
              return old.request.identity;
            },
          });
        if (boundary === 'context-getter')
          Object.defineProperty(scope, 'context', {
            get: () => {
              replace();
              return context;
            },
          });
        return scope;
      });
      old.admit();
      await vi.waitFor(() => expect(f.items('A')).toHaveLength(2));
      const next = f.items('A')[1];
      await openPrepared(next);
      expect(old.open).not.toHaveBeenCalled();
      expect(old.request.signal.aborted).toBe(true);
      expect(old.releaseScope).toHaveBeenCalledTimes(1);
      expect(next.request.isCurrent()).toBe(true);
      next.succeed();
      await vi.waitFor(() => expect(f.load('A').status).toBe('ready'));
      expect(f.count(workspaceLoadFailed.type, 'A')).toBe(0);
    });
  }

  it('releases late preparation after retirement without publishing or clearing its successor', async () => {
    const f = fixture();
    f.start();
    f.actual.dispatch(openWorkspaceTab('A'));
    const old = f.items('A')[0];
    f.actual.dispatch(closeWorkspaceTab('A', 7));
    f.actual.dispatch(openWorkspaceTab('A'));
    const next = f.items('A')[1];
    await openPrepared(next);
    old.admit();
    await vi.waitFor(() => expect(old.value.release).toHaveBeenCalledTimes(1));
    expect(old.open).not.toHaveBeenCalled();
    expect(next.request.isCurrent()).toBe(true);
    next.succeed();
    await vi.waitFor(() => expect(f.load('A').status).toBe('ready'));
    expect(f.count(workspaceLoadRequested.type, 'A')).toBe(1);
  });

  it('swallows retired preparation errors while the replacement remains active', async () => {
    const f = fixture();
    f.start();
    f.actual.dispatch(openWorkspaceTab('A'));
    const old = f.items('A')[0];
    f.actual.dispatch(closeWorkspaceTab('A', 8));
    f.actual.dispatch(openWorkspaceTab('A'));
    const next = f.items('A')[1];
    old.ready.reject(new Error('retired preparation'));
    await openPrepared(next);
    expect(f.errors).toEqual([]);
    expect(next.request.isCurrent()).toBe(true);
    expect(f.count(workspaceLoadFailed.type, 'A')).toBe(0);
  });

  it('retires before receiver/Store disposal and releases preparation arriving after cancellation', async () => {
    const f = fixture();
    f.start();
    f.actual.dispatch(openWorkspaceTab('A'));
    const pending = f.items('A')[0];
    f.close();
    expect(pending.request.signal.aborted).toBe(true);
    expect(f.trace.slice(-5)).toEqual([
      'request-abort:A',
      'owner-unbound',
      'receiver-stopping',
      'receiver-stopped',
      'store-disposing',
    ]);
    expect(f.port().submit('A', f.firstA.value)).toBe(false);
    const count = f.actions.length;
    pending.admit();
    await vi.waitFor(() => expect(pending.value.release).toHaveBeenCalledTimes(1));
    expect(f.actions).toHaveLength(count);
    expect(pending.open).not.toHaveBeenCalled();
    expect(f.subscriptions()).toBe(0);
  });

  it('orders active-scope release before receiver cancellation on root stop', async () => {
    const f = fixture();
    f.start();
    f.actual.dispatch(openWorkspaceTab('A'));
    const active = f.items('A')[0];
    await openPrepared(active);
    f.close();
    const abort = f.trace.indexOf('request-abort:A');
    const scope = f.trace.indexOf('scope-release:A');
    const route = f.trace.indexOf('route-release:A');
    const unbound = f.trace.indexOf('owner-unbound');
    const receiver = f.trace.indexOf('receiver-stopping');
    const store = f.trace.indexOf('store-disposing');
    expect(abort).toBeGreaterThanOrEqual(0);
    expect(scope).toBeGreaterThan(abort);
    expect(route).toBeGreaterThan(scope);
    expect(unbound).toBeGreaterThan(route);
    expect(receiver).toBeGreaterThan(unbound);
    expect(store).toBeGreaterThan(receiver);
    expect(active.releaseScope).toHaveBeenCalledTimes(1);
  });

  it('retires every request before propagating a current preparation crash to the root boundary', async () => {
    const f = fixture();
    f.start();
    f.actual.dispatch(openWorkspaceTab('A'));
    const pending = f.items('A')[0];
    const failure = new Error('prepare failed');
    pending.ready.reject(failure);
    await vi.waitFor(() => expect(f.errors).toEqual([failure]));
    expect(pending.request.signal.aborted).toBe(true);
    expect(f.trace.slice(-5)).toEqual([
      'request-abort:A',
      'owner-unbound',
      'root-caught',
      'receiver-stopping',
      'receiver-stopped',
    ]);
    expect(f.port().submit('A', f.firstA.value)).toBe(false);
    expect(f.count(workspaceLoadFailed.type, 'A')).toBe(0);
    expect(f.subscriptions()).toBe(0);
  });
});
