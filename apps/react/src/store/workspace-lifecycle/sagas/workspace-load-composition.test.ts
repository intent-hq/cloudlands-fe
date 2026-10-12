// The configured React Store and production composition are the test subjects.
// Only declared preload delivery is controlled; no real main/socket origin is claimed.
import { setImmediate } from 'node:timers/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { takeEvery } from 'typed-redux-saga';
import type { GenericAction } from '@themislib/themis/types';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type {
  WorkspaceLoadPrepare,
  WorkspaceLoadRead,
  WorkspaceLoadRouteRef,
} from '$shared/types/workspace-load-route';
import { store } from '@/store';
import { selectPrincipalConnectionContext } from '../../principal/principal-selectors';
import { selectWorkspaceById } from '../../workspace/workspace-selectors';
import { workspaceLoadCompositionSaga } from './workspace-load-composition';
import { connectionsListReceived } from '../../../../../../src/store/renderer/slices/connections/connections-slice';
import { connectionStatusChanged } from '../../../../../../src/store/renderer/slices/daemon-health/daemon-health-slice';
import { daemonEventsSubscribed } from '../../../../../../src/store/renderer/slices/workspace-events/workspace-events-slice';
import {
  principalContextChanged,
  principalReceived,
} from '../../../../../../src/store/renderer/slices/principal/principal-slice';
import {
  closeWorkspaceTab,
  loadWorkspaceTabsState,
  openWorkspaceTab,
  serializeWorkspaceTabsState,
} from '../../../../../../src/store/renderer/slices/tab-state/tab-state-slice';
import {
  workspaceDeleted,
  workspaceHydrationRequested,
  workspaceLoadCancelled,
  workspaceLoadFailed,
  workspaceLoadRequested,
  workspaceLoadSucceeded,
  workspaceMounted,
  workspaceUnmounted,
} from '../../../../../../src/store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { markWorkspaceNavigationInitialized } from '../../../../../../src/store/renderer/slices/workspace-navigation/workspace-navigation-slice';

const channels = IPC_CHANNELS.WORKSPACE_LOAD;
const A = '77777777-7777-4777-8777-777777777777';
const B = '88888888-8888-4888-8888-888888888888';
const unavailable = {
  ok: false,
  error: { code: 'WORKSPACE_LOAD_ROUTE_UNAVAILABLE', message: 'Workspace load route unavailable' },
};
function deferred<T>() {
  let accept!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    accept = resolve;
  });
  let settled = false;
  return {
    promise,
    get settled() {
      return settled;
    },
    resolve(value: T) {
      if (settled) throw new Error('The original fixture reply was already settled');
      settled = true;
      accept(value);
    },
  };
}
type WireCall = {
  channel: string;
  args: unknown[];
  receiver: Window['electronAPI'];
  reply: ReturnType<typeof deferred<unknown>>;
};
function createBridge() {
  const calls: WireCall[] = [];
  const waiters = new Map<string, ReturnType<typeof deferred<WireCall>>>();
  const listeners = new Map<string, { channel: string; callback: (...args: unknown[]) => void }>();
  const removedWhileStoreAlive: boolean[] = [];
  const unexpected: string[] = [];
  const deliveredOrigins: string[] = [];
  const dispatch = store.dispatch;
  let listenerSequence = 0;
  const list = (channel: string) => calls.filter((entry) => entry.channel === channel);
  const api: Window['electronAPI'] = {
    invoke: vi.fn(function (this: Window['electronAPI'], channel: string, ...args: unknown[]) {
      const reply = deferred<unknown>();
      const index = list(channel).length;
      const entry = { channel, args, receiver: this, reply };
      calls.push(entry);
      waiters.get(`${channel}:${index}`)?.resolve(entry);
      if (channel === channels.RELEASE || channel === channels.RELEASE_ORIGIN) {
        reply.resolve({ ok: true, result: undefined });
      } else if (
        !new Set<string>([channels.OBSERVE_ORIGIN, channels.PREPARE, channels.READ]).has(channel)
      ) {
        unexpected.push(channel);
        reply.resolve(unavailable);
      }
      return reply.promise;
    }),
    on: vi.fn((channel: string, callback: (...args: unknown[]) => void) => {
      const id = `listener-${++listenerSequence}`;
      listeners.set(id, { channel, callback });
      return id;
    }),
    offById: vi.fn((channel: string, id: string) => {
      expect(listeners.get(id)?.channel).toBe(channel);
      try {
        removedWhileStoreAlive.push(store.dispatch === dispatch);
      } catch {
        removedWhileStoreAlive.push(false);
      }
      listeners.delete(id);
    }),
    send: vi.fn(),
    off: vi.fn(),
    removeAllListeners: vi.fn(),
    devInstance: null,
    devPort: null,
  };
  function next(channel: string, index = 0): Promise<WireCall> {
    const present = list(channel)[index];
    if (present) return Promise.resolve(present);
    const key = `${channel}:${index}`;
    let waiter = waiters.get(key);
    if (!waiter) {
      waiter = deferred<WireCall>();
      waiters.set(key, waiter);
    }
    return waiter.promise;
  }
  async function deliver(entry: WireCall, reply: unknown) {
    entry.reply.resolve(reply);
    await entry.reply.promise; // Drain the ORIGINAL invoke, including late replies after cancellation.
    // One event-loop turn lets all already-queued native Promise continuations run.
    // No elapsed-time budget, sleep, retry or polling; pending wire replies stay explicitly held.
    await setImmediate();
  }
  async function observe(index: number, originId: string | null) {
    const entry = await next(channels.OBSERVE_ORIGIN, index);
    expect(entry.args).toEqual([]);
    if (originId !== null) deliveredOrigins.push(originId);
    await deliver(entry, originId === null ? unavailable : { ok: true, result: { originId } });
  }
  async function prepare(index: number, originId: string, workspaceId: string) {
    const entry = await next(channels.PREPARE, index);
    expect(entry.args).toEqual([{ originId, workspaceId, requestId: expect.any(String) }]);
    const input = entry.args[0] as WorkspaceLoadPrepare;
    const ref: WorkspaceLoadRouteRef = { ...input, routeId: `route-${index}` };
    await deliver(entry, { ok: true, result: ref });
    return ref;
  }
  async function read(index: number, value: unknown) {
    const entry = await next(channels.READ, index);
    const { operation: _operation, ...ref } = entry.args[0] as WorkspaceLoadRead;
    await deliver(entry, {
      ok: true,
      result: { ref, current: true, settlement: { status: 'fulfilled', value } },
    });
  }
  return {
    api,
    calls,
    list,
    next,
    listeners,
    removedWhileStoreAlive,
    unexpected,
    deliveredOrigins,
    deliver,
    observe,
    prepare,
    read,
    emit(payload: unknown) {
      for (const listener of [...listeners.values()]) listener.callback(payload);
    },
  };
}
function workspace(id: string) {
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
function attemptCleanup(errors: unknown[], operation: () => void) {
  try {
    operation();
  } catch (error) {
    errors.push(error);
  }
}
function throwCleanupErrors(errors: unknown[]) {
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1)
    throw new AggregateError(errors, 'Workspace composition fixture cleanup failed');
}
const cleanups: Array<(errors: unknown[]) => Promise<void>> = [];
afterEach(async () => {
  const errors: unknown[] = [];
  for (const cleanup of cleanups.splice(0).reverse()) {
    try {
      await cleanup(errors);
    } catch (error) {
      errors.push(error);
    }
  }
  attemptCleanup(errors, () => vi.unstubAllGlobals());
  attemptCleanup(errors, () => vi.restoreAllMocks());
  // Vitest appends hook failures to the original test errors; none are replaced here.
  throwCleanupErrors(errors);
});
function fixture(initialPrincipal = true) {
  const releases: Array<() => void> = [];
  const bridges: Array<ReturnType<typeof createBridge>> = [];
  let stopProbe: (() => void) | undefined;
  let closed = false;
  const disposeStore = store.init();
  // Own the disposer before any probe, bridge, global or principal setup can fail.
  cleanups.push(async (errors) => {
    retireAndDispose(errors);
    for (const item of bridges) {
      for (const pending of item.calls) {
        try {
          if (!pending.reply.settled) await item.deliver(pending, unavailable);
          else await pending.reply.promise;
        } catch (error) {
          errors.push(error);
        }
      }
      attemptCleanup(errors, () => expect(item.unexpected).toEqual([]));
      attemptCleanup(errors, () => expect(item.api.off).not.toHaveBeenCalled());
      attemptCleanup(errors, () => expect(item.api.removeAllListeners).not.toHaveBeenCalled());
      for (const call of item.calls) {
        attemptCleanup(errors, () => expect(call.receiver).toBe(item.api));
      }
      for (const originId of item.deliveredOrigins) {
        attemptCleanup(errors, () => {
          expect(
            item
              .list(channels.RELEASE_ORIGIN)
              .filter((call) => Object(call.args[0]).originId === originId),
          ).toHaveLength(1);
        });
      }
    }
  });
  const actions: GenericAction[] = [];
  const actionWaiters = new Map<string, ReturnType<typeof deferred<GenericAction>>>();
  const observedTypes = [
    workspaceLoadRequested,
    workspaceLoadSucceeded,
    workspaceLoadFailed,
    workspaceLoadCancelled,
    workspaceHydrationRequested,
    workspaceMounted,
    workspaceUnmounted,
    markWorkspaceNavigationInitialized,
  ];
  const listActions = (type: string) => actions.filter((action) => action.type === type);
  // Read-only observation of actual actions; no production method or result is substituted.
  stopProbe = store.runSaga(function* workspaceCompositionActionProbe() {
    yield* takeEvery(observedTypes, function record(action: GenericAction) {
      const index = listActions(action.type).length;
      actions.push(action);
      actionWaiters.get(`${action.type}:${index}`)?.resolve(action);
    });
  });
  const bridge = createBridge();
  bridges.push(bridge);
  vi.stubGlobal('window', { electronAPI: bridge.api });
  store.dispatch(
    connectionsListReceived({ connections: [], activeId: 'local', windowBackendId: 'local' }),
  );
  store.dispatch(connectionStatusChanged('connected'));
  store.dispatch(daemonEventsSubscribed());
  function grant(id = 'reader') {
    const context = selectPrincipalConnectionContext.select(store.state);
    if (!context) throw new Error('The actual connection prerequisites are not ready');
    store.dispatch(principalContextChanged(context));
    store.dispatch(
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
  if (initialPrincipal) grant();
  function start() {
    const cancel = store.runSaga(workspaceLoadCompositionSaga);
    let released = false;
    // Caller ownership only: Store's raw cancel handle is deliberately called once.
    const stop = () => {
      if (released) return;
      released = true;
      cancel();
    };
    releases.push(stop);
    return stop;
  }
  function nextAction(type: string, index = 0) {
    const present = listActions(type)[index];
    if (present) return Promise.resolve(present);
    const key = `${type}:${index}`;
    let waiter = actionWaiters.get(key);
    if (!waiter) {
      waiter = deferred<GenericAction>();
      actionWaiters.set(key, waiter);
    }
    return waiter.promise;
  }
  function retireAndDispose(errors: unknown[]) {
    if (closed) return;
    closed = true;
    for (const stop of releases.splice(0).reverse()) attemptCleanup(errors, stop);
    if (stopProbe) attemptCleanup(errors, stopProbe);
    for (const item of bridges) {
      attemptCleanup(errors, () => expect(item.listeners.size).toBe(0));
      attemptCleanup(errors, () => expect(item.removedWhileStoreAlive.every(Boolean)).toBe(true));
    }
    attemptCleanup(errors, disposeStore);
  }
  function close() {
    const errors: unknown[] = [];
    retireAndDispose(errors);
    throwCleanupErrors(errors);
  }
  return {
    bridge,
    actions,
    listActions,
    start,
    close,
    grant,
    nextAction,
    serial: (id: string) => store.state.tabState.workspaceTabAcquisitions.serialByWorkspaceId[id],
    wake: () => store.dispatch(connectionStatusChanged('connected')),
    replaceBridge() {
      const replacement = createBridge();
      bridges.push(replacement);
      vi.stubGlobal('window', { electronAPI: replacement.api });
      return replacement;
    },
  };
}
async function succeed(f: ReturnType<typeof fixture>, index: number, id: string, origin: string) {
  await f.bridge.observe(index, origin);
  const ref = await f.bridge.prepare(index, origin, id);
  const read = await f.bridge.next(channels.READ, index);
  expect(read.args).toEqual([{ ...ref, operation: 'open' }]);
  await f.bridge.read(index, { success: true, data: workspace(id) });
  await f.nextAction(markWorkspaceNavigationInitialized.type, index);
  return ref;
}

describe('inactive load composition on the configured React Store', () => {
  it('registers actual acquisition state without starting a load owner', () => {
    const f = fixture();
    store.dispatch(openWorkspaceTab(A));
    const serial = f.serial(A);
    expect(serial).toBeGreaterThan(0);
    store.dispatch(openWorkspaceTab(A));
    expect(f.serial(A)).toBe(serial);
    const persisted = serializeWorkspaceTabsState(store.state.tabState);
    expect(persisted).toEqual({
      openTabs: [A],
      currentTabId: A,
      pinnedTabs: [],
      unsavedTabs: [],
      optimisticTabs: [],
      tabOrder: [A],
      workspaceStacks: [[A]],
    });
    store.dispatch(loadWorkspaceTabsState(persisted));
    expect(f.serial(A)).toBeGreaterThan(serial);
    expect(f.bridge.calls).toEqual([]);
    expect(f.bridge.listeners.size).toBe(0);
    expect(f.actions).toEqual([]);
  });

  it('receives an already-open tab before first publication and commits load/navigation without fake hydration', async () => {
    const f = fixture();
    store.dispatch(openWorkspaceTab(A));
    f.start();
    await succeed(f, 0, A, 'preexisting-tab');
    expect(selectWorkspaceById.select(store.state, A)).toMatchObject(workspace(A));
    expect(store.state.workspaceLifecycle.loadByWorkspaceId[A]).toEqual({
      status: 'ready',
      error: null,
    });
    expect(store.state.workspaceNavigation.byWorkspaceId[A].ui.hasInitialized).toBe(true);
    expect(store.state.workspaceLifecycle.sessionPhaseByWorkspaceId[A]).toBe('opened');
    expect(f.listActions(workspaceHydrationRequested.type)).toHaveLength(1);
    expect(f.listActions(workspaceMounted.type)).toEqual([]);
    expect(f.listActions(workspaceLoadRequested.type)).toHaveLength(1);
  });

  it('refuses an unversioned public load action before a genuinely accepted tab intent', async () => {
    const f = fixture();
    f.start();
    store.dispatch(workspaceLoadRequested(A));
    expect(f.bridge.calls).toEqual([]);
    expect(store.state.workspaceLifecycle.loadByWorkspaceId[A]).toBeUndefined();
    store.dispatch(openWorkspaceTab(A));
    await succeed(f, 0, A, 'accepted-intent');
    expect(f.bridge.list(channels.READ)).toHaveLength(1);
    expect(f.listActions(workspaceLoadSucceeded.type)).toHaveLength(1);
  });

  it('allows initial-null observation but waits for canonical principal readiness before reading', async () => {
    const f = fixture(false);
    f.start();
    store.dispatch(openWorkspaceTab(A));
    await f.bridge.observe(0, 'initial-null');
    const ref = await f.bridge.prepare(0, 'initial-null', A);
    await f.nextAction(workspaceLoadRequested.type);
    expect(f.bridge.list(channels.READ)).toEqual([]);
    expect(store.state.workspaceLifecycle.loadByWorkspaceId[A]).toBeUndefined();
    f.grant();
    expect((await f.bridge.next(channels.READ)).args).toEqual([{ ...ref, operation: 'open' }]);
    await f.bridge.read(0, { success: true, data: workspace(A) });
    await f.nextAction(markWorkspaceNavigationInitialized.type);
    expect(f.bridge.list(channels.OBSERVE_ORIGIN)).toHaveLength(1);
  });

  it('does not substitute another transport when preload is absent', async () => {
    const f = fixture();
    vi.stubGlobal('window', {});
    f.start();
    store.dispatch(openWorkspaceTab(A));
    await setImmediate();
    expect(f.bridge.calls).toEqual([]);
    expect(f.listActions(workspaceLoadRequested.type)).toEqual([]);
    expect(store.state.workspaceLifecycle.loadByWorkspaceId[A]).toBeUndefined();
    vi.stubGlobal('window', { electronAPI: f.bridge.api });
    f.wake();
    await succeed(f, 0, A, 'available-preload');
  });

  it('keeps unavailable observation refused until a genuine status wake', async () => {
    const f = fixture();
    f.start();
    store.dispatch(openWorkspaceTab(A));
    await f.bridge.observe(0, null);
    expect(f.bridge.list(channels.PREPARE)).toEqual([]);
    expect(f.bridge.list(channels.OBSERVE_ORIGIN)).toHaveLength(1);
    f.wake();
    await f.bridge.observe(1, 'ready-after-wake');
    await f.bridge.prepare(0, 'ready-after-wake', A);
    await f.bridge.read(0, { success: true, data: workspace(A) });
    await f.nextAction(markWorkspaceNavigationInitialized.type);
  });

  it('aborts unfocused observation promptly and releases its late original without disturbing B', async () => {
    const f = fixture();
    f.start();
    store.dispatch(openWorkspaceTab(A));
    await f.bridge.next(channels.OBSERVE_ORIGIN);
    store.dispatch(openWorkspaceTab(B));
    await f.bridge.next(channels.OBSERVE_ORIGIN, 1); // Does not wait for A's original invoke.
    await f.bridge.observe(0, 'late-A');
    expect((await f.bridge.next(channels.RELEASE_ORIGIN)).args).toEqual([{ originId: 'late-A' }]);
    await f.bridge.observe(1, 'focused-B');
    await f.bridge.prepare(0, 'focused-B', B);
    await f.bridge.read(0, { success: true, data: workspace(B) });
    await f.nextAction(markWorkspaceNavigationInitialized.type);
    expect(selectWorkspaceById.select(store.state, A)).toBeUndefined();
    expect(f.bridge.list(channels.PREPARE)).toHaveLength(1);
    expect(f.listActions(workspaceLoadRequested.type).map((action) => action.payload)).toEqual([
      [B],
    ]);
  });

  it('parks prepared A until the same serial refocuses, with no new A preparation', async () => {
    const f = fixture();
    f.start();
    store.dispatch(openWorkspaceTab(A));
    const serial = f.serial(A);
    await f.bridge.observe(0, 'parked-A');
    await f.bridge.next(channels.PREPARE);
    store.dispatch(openWorkspaceTab(B));
    await f.bridge.next(channels.OBSERVE_ORIGIN, 1);
    const ref = await f.bridge.prepare(0, 'parked-A', A);
    expect(f.bridge.list(channels.READ)).toEqual([]);
    expect(f.listActions(workspaceLoadRequested.type)).toEqual([]);
    store.dispatch(openWorkspaceTab(A));
    expect((await f.bridge.next(channels.READ)).args).toEqual([{ ...ref, operation: 'open' }]);
    expect(f.serial(A)).toBe(serial);
    expect(f.bridge.list(channels.PREPARE)).toHaveLength(1);
    await f.bridge.observe(1, 'late-parked-B');
    await f.bridge.read(0, { success: true, data: workspace(A) });
    await f.nextAction(markWorkspaceNavigationInitialized.type);
  });

  it('gives a same-id reopen a new serial and cancels only the old prepare tuple/full ref', async () => {
    const f = fixture();
    f.start();
    store.dispatch(openWorkspaceTab(A));
    const first = f.serial(A);
    await f.bridge.observe(0, 'closed-A');
    const preparing = await f.bridge.next(channels.PREPARE);
    store.dispatch(closeWorkspaceTab(A));
    store.dispatch(openWorkspaceTab(A));
    expect(f.serial(A)).toBeGreaterThan(first);
    // Whole-origin retirement cancels this prepare; only its late full ref needs child release.
    expect((await f.bridge.next(channels.RELEASE_ORIGIN)).args).toEqual([{ originId: 'closed-A' }]);
    expect(f.bridge.list(channels.RELEASE_ORIGIN).map((entry) => entry.args)).toEqual([
      [{ originId: 'closed-A' }],
    ]);
    expect(f.bridge.list(channels.RELEASE)).toEqual([]);
    await f.bridge.next(channels.OBSERVE_ORIGIN, 1);
    const stale = await f.bridge.prepare(0, 'closed-A', A);
    await preparing.reply.promise; // Drain the original PREPARE, even though its origin retired.
    expect(f.bridge.list(channels.RELEASE).map((entry) => entry.args)).toEqual([[stale]]);
    await f.bridge.observe(1, 'reopened-A');
    const fresh = await f.bridge.prepare(1, 'reopened-A', A);
    expect(f.bridge.list(channels.RELEASE_ORIGIN).map((entry) => entry.args)).toEqual([
      [{ originId: 'closed-A' }],
    ]);
    expect(f.bridge.list(channels.RELEASE).map((entry) => entry.args)).toEqual([[stale]]);
    expect((await f.bridge.next(channels.READ)).args).toEqual([{ ...fresh, operation: 'open' }]);
    await f.bridge.read(0, { success: true, data: workspace(A) });
    await f.nextAction(markWorkspaceNavigationInitialized.type);
    expect(f.listActions(workspaceLoadRequested.type)).toHaveLength(1);
  });

  it('does not regrant a deleted acquisition while the original tab is still open', async () => {
    const f = fixture();
    f.start();
    store.dispatch(openWorkspaceTab(A));
    await f.bridge.next(channels.OBSERVE_ORIGIN);
    store.dispatch(workspaceDeleted(A, []));
    store.dispatch(openWorkspaceTab(A));
    expect(f.serial(A)).toBeUndefined();
    await f.bridge.observe(0, 'deleted-origin');
    expect(f.bridge.list(channels.PREPARE)).toEqual([]);
    store.dispatch(closeWorkspaceTab(A));
    store.dispatch(openWorkspaceTab(A));
    await f.bridge.next(channels.OBSERVE_ORIGIN, 1);
    expect(f.serial(A)).toBeGreaterThan(0);
  });

  it('retires A-to-null-to-A preparation instead of reviving the old principal attempt', async () => {
    const f = fixture();
    f.start();
    store.dispatch(openWorkspaceTab(A));
    await f.bridge.observe(0, 'principal-before-loss');
    const preparing = await f.bridge.next(channels.PREPARE);
    store.dispatch(principalContextChanged(null));
    f.grant();
    expect((await f.bridge.next(channels.RELEASE_ORIGIN)).args).toEqual([
      { originId: 'principal-before-loss' },
    ]);
    expect(f.bridge.list(channels.RELEASE_ORIGIN).map((entry) => entry.args)).toEqual([
      [{ originId: 'principal-before-loss' }],
    ]);
    expect(f.bridge.list(channels.RELEASE)).toEqual([]);
    const stale = await f.bridge.prepare(0, 'principal-before-loss', A);
    await preparing.reply.promise; // Restoring the principal does not revive this original prepare.
    expect(f.bridge.list(channels.RELEASE).map((entry) => entry.args)).toEqual([[stale]]);
    expect(f.bridge.list(channels.READ)).toEqual([]);
    expect(f.bridge.list(channels.OBSERVE_ORIGIN)).toHaveLength(1);
    f.wake();
    await f.bridge.observe(1, 'principal-after-wake');
    const fresh = await f.bridge.prepare(1, 'principal-after-wake', A);
    expect(f.bridge.list(channels.RELEASE_ORIGIN).map((entry) => entry.args)).toEqual([
      [{ originId: 'principal-before-loss' }],
    ]);
    expect(f.bridge.list(channels.RELEASE).map((entry) => entry.args)).toEqual([[stale]]);
    expect((await f.bridge.next(channels.READ)).args).toEqual([{ ...fresh, operation: 'open' }]);
    await f.bridge.read(0, { success: true, data: workspace(A) });
    await f.nextAction(markWorkspaceNavigationInitialized.type);
  });

  it('rejects a late A read after a different principal becomes current', async () => {
    const f = fixture();
    f.start();
    store.dispatch(openWorkspaceTab(A));
    await f.bridge.observe(0, 'reader-one');
    await f.bridge.prepare(0, 'reader-one', A);
    await f.bridge.next(channels.READ);
    store.dispatch(principalContextChanged(null));
    f.grant('reader-two');
    store.dispatch(openWorkspaceTab(B));
    await f.bridge.observe(1, 'reader-two');
    await f.bridge.prepare(1, 'reader-two', B);
    await f.bridge.next(channels.READ, 1);
    await f.bridge.read(0, { success: true, data: workspace(A) });
    await f.bridge.read(1, { success: true, data: workspace(B) });
    await f.nextAction(markWorkspaceNavigationInitialized.type);
    expect(selectWorkspaceById.select(store.state, A)).toBeUndefined();
    expect(selectWorkspaceById.select(store.state, B)).toMatchObject(workspace(B));
    expect(f.listActions(workspaceLoadSucceeded.type).map((action) => action.payload)).toEqual([
      [B],
    ]);
  });

  it('fences held reads across actual connection-state generation changes', async () => {
    const f = fixture();
    f.start();
    store.dispatch(openWorkspaceTab(A));
    await f.bridge.observe(0, 'old-connection');
    await f.bridge.prepare(0, 'old-connection', A);
    await f.bridge.next(channels.READ);
    const generation = store.state.daemonHealth.connectionGeneration;
    store.dispatch(
      connectionsListReceived({
        connections: [],
        activeId: 'next-backend',
        windowBackendId: 'next-backend',
      }),
    );
    // The late result is refused while A is still open: closing alone is not the oracle.
    await f.bridge.read(0, { success: true, data: workspace(A) });
    expect(selectWorkspaceById.select(store.state, A)).toBeUndefined();
    expect(f.listActions(workspaceLoadSucceeded.type)).toEqual([]);
    // Physical retirement still comes from the declared bridge, not a fabricated Redux identity.
    f.bridge.emit({ kind: 'origin', originId: 'old-connection' });
    store.dispatch(closeWorkspaceTab(A));
    store.dispatch(connectionStatusChanged('disconnected'));
    store.dispatch(connectionStatusChanged('connected'));
    store.dispatch(daemonEventsSubscribed());
    f.grant();
    store.dispatch(openWorkspaceTab(B));
    expect(store.state.daemonHealth.connectionGeneration).toBeGreaterThan(generation);
    await f.bridge.observe(1, 'new-connection');
    await f.bridge.prepare(1, 'new-connection', B);
    await f.bridge.next(channels.READ, 1);
    await f.bridge.read(1, { success: true, data: workspace(B) });
    await f.nextAction(markWorkspaceNavigationInitialized.type);
    expect(selectWorkspaceById.select(store.state, A)).toBeUndefined();
    expect(f.listActions(workspaceLoadSucceeded.type).map((action) => action.payload)).toEqual([
      [B],
    ]);
  });

  it('shares duplicate Store starts and retires only after both owners release', async () => {
    const f = fixture();
    const firstStop = f.start();
    const secondStop = f.start();
    store.dispatch(openWorkspaceTab(A));
    await f.bridge.observe(0, 'shared-run');
    await f.bridge.next(channels.PREPARE);
    expect(f.bridge.list(channels.OBSERVE_ORIGIN)).toHaveLength(1);
    expect(f.bridge.listeners.size).toBe(1);
    firstStop();
    expect(f.bridge.listeners.size).toBe(1);
    expect(f.bridge.list(channels.RELEASE)).toEqual([]);
    expect(f.bridge.list(channels.RELEASE_ORIGIN)).toEqual([]);
    const ref = await f.bridge.prepare(0, 'shared-run', A);
    const heldRead = await f.bridge.next(channels.READ);
    expect(heldRead.args).toEqual([{ ...ref, operation: 'open' }]);
    secondStop();
    expect(f.bridge.listeners.size).toBe(0);
    expect(f.bridge.list(channels.RELEASE)).toEqual([]);
    expect(f.bridge.list(channels.RELEASE_ORIGIN).map((entry) => entry.args)).toEqual([
      [{ originId: 'shared-run' }],
    ]);
    await f.bridge.read(0, { success: true, data: workspace(A) });
    await heldRead.reply.promise;
    expect(f.bridge.listeners.size).toBe(0);
    expect(f.bridge.list(channels.RELEASE)).toEqual([]);
    expect(f.bridge.list(channels.RELEASE_ORIGIN).map((entry) => entry.args)).toEqual([
      [{ originId: 'shared-run' }],
    ]);
    expect(selectWorkspaceById.select(store.state, A)).toBeUndefined();
    expect(f.listActions(workspaceLoadSucceeded.type)).toEqual([]);
  });

  it('starts a fresh run while the old observation drains through its captured original bridge', async () => {
    const f = fixture();
    store.dispatch(openWorkspaceTab(A));
    const firstStop = f.start();
    await f.bridge.next(channels.OBSERVE_ORIGIN);
    firstStop();
    expect(f.bridge.listeners.size).toBe(0);
    const next = f.replaceBridge();
    f.start();
    await next.next(channels.OBSERVE_ORIGIN);
    await f.bridge.observe(0, 'late-retired-run');
    expect(f.bridge.list(channels.RELEASE_ORIGIN).map((entry) => entry.args)).toEqual([
      [{ originId: 'late-retired-run' }],
    ]);
    expect(next.list(channels.RELEASE_ORIGIN)).toEqual([]);
    await next.observe(0, 'fresh-run');
    const ref = await next.prepare(0, 'fresh-run', A);
    expect((await next.next(channels.READ)).args).toEqual([{ ...ref, operation: 'open' }]);
    await next.read(0, { success: true, data: workspace(A) });
    await f.nextAction(markWorkspaceNavigationInitialized.type);
    expect(next.listeners.size).toBe(0);
    expect(next.list(channels.RELEASE).map((entry) => entry.args)).toEqual([[ref]]);
    expect(next.list(channels.RELEASE_ORIGIN).map((entry) => entry.args)).toEqual([
      [{ originId: 'fresh-run' }],
    ]);
    expect(selectWorkspaceById.select(store.state, A)).toMatchObject(workspace(A));
    expect(store.state.workspaceNavigation.byWorkspaceId[A].ui.hasInitialized).toBe(true);

    // A completed load releases its lease; a genuine B demand still reaches the running producer.
    store.dispatch(openWorkspaceTab(B));
    await next.observe(1, 'fresh-run-B');
    const nextRef = await next.prepare(1, 'fresh-run-B', B);
    expect((await next.next(channels.READ, 1)).args).toEqual([{ ...nextRef, operation: 'open' }]);
    expect(next.list(channels.RELEASE).map((entry) => entry.args)).toEqual([[ref]]);
    expect(next.list(channels.RELEASE_ORIGIN).map((entry) => entry.args)).toEqual([
      [{ originId: 'fresh-run' }],
    ]);
    await next.read(1, { success: true, data: workspace(B) });
    await f.nextAction(markWorkspaceNavigationInitialized.type, 1);
    expect(selectWorkspaceById.select(store.state, A)).toMatchObject(workspace(A));
    expect(selectWorkspaceById.select(store.state, B)).toMatchObject(workspace(B));
    expect(store.state.workspaceNavigation.byWorkspaceId[B].ui.hasInitialized).toBe(true);
    expect(f.listActions(workspaceLoadSucceeded.type).map((action) => action.payload)).toEqual([
      [A],
      [B],
    ]);
    expect(next.listeners.size).toBe(0);
    expect(next.list(channels.RELEASE).map((entry) => entry.args)).toEqual([[ref], [nextRef]]);
    expect(next.list(channels.RELEASE_ORIGIN).map((entry) => entry.args)).toEqual([
      [{ originId: 'fresh-run' }],
      [{ originId: 'fresh-run-B' }],
    ]);
    expect(f.bridge.list(channels.RELEASE_ORIGIN).map((entry) => entry.args)).toEqual([
      [{ originId: 'late-retired-run' }],
    ]);
    expect(f.bridge.list(channels.RELEASE)).toEqual([]);
    expect(f.bridge.list(channels.PREPARE)).toEqual([]);
    expect(f.bridge.list(channels.READ)).toEqual([]);
  });

  it('retires listeners before Store teardown and drains a late observation afterward', async () => {
    const f = fixture();
    f.start();
    store.dispatch(openWorkspaceTab(A));
    await f.bridge.next(channels.OBSERVE_ORIGIN);
    f.close();
    expect(f.bridge.removedWhileStoreAlive).toEqual([true]);
    await f.bridge.observe(0, 'after-store-disposal');
    expect(f.bridge.list(channels.RELEASE_ORIGIN).map((entry) => entry.args)).toEqual([
      [{ originId: 'after-store-disposal' }],
    ]);
    expect(f.bridge.list(channels.PREPARE)).toEqual([]);
  });

  it('preserves ordinary daemon failure folding without publishing success or using a fallback', async () => {
    const f = fixture();
    f.start();
    store.dispatch(openWorkspaceTab(A));
    await f.bridge.observe(0, 'read-refusal');
    const ref = await f.bridge.prepare(0, 'read-refusal', A);
    const read = await f.bridge.next(channels.READ);
    await f.bridge.deliver(read, {
      ok: true,
      result: {
        ref,
        current: true,
        settlement: {
          status: 'rejected',
          error: { code: 'FORBIDDEN', message: 'Workspace access denied', rpcCode: -32003 },
        },
      },
    });
    await f.nextAction(workspaceLoadFailed.type);
    expect(store.state.workspaceLifecycle.loadByWorkspaceId[A]).toMatchObject({
      status: 'error',
      error: { kind: 'error' },
    });
    expect(selectWorkspaceById.select(store.state, A)).toBeUndefined();
    expect(f.listActions(workspaceLoadSucceeded.type)).toEqual([]);
    expect(f.bridge.list(channels.READ)).toHaveLength(1);
    expect(f.bridge.unexpected).toEqual([]);
  });

  it('uses the same captured route for optional canonical workspace detail reads', async () => {
    const f = fixture();
    f.start();
    store.dispatch(openWorkspaceTab(A));
    await f.bridge.observe(0, 'detail-origin');
    const ref = await f.bridge.prepare(0, 'detail-origin', A);
    await f.bridge.read(0, { success: true, data: { ...workspace(A), repositoryPath: undefined } });
    const detail = await f.bridge.next(channels.READ, 1);
    expect(detail.args).toEqual([{ ...ref, operation: 'get' }]);
    await f.bridge.read(1, { workspace: workspace(A) });
    expect(selectWorkspaceById.select(store.state, A)?.repositoryPath).toBe('/repo');
    expect(f.bridge.list(channels.PREPARE)).toHaveLength(1);
    expect(f.bridge.unexpected).toEqual([]);
  });
});
