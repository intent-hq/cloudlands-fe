// Real client factories, backend runtime, isolated ReactStore and accepted-tab owner.
// Only preload delivery is controlled. No product root, native bridge or daemon claim.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReactStore } from '@themislib/themis/react-store';
import { WorkspaceStatus } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { WORKSPACE_CHANNELS } from '$shared/ipc/channels';
import type { WorkspaceLoadRead, WorkspaceLoadRouteRef } from '$shared/types/workspace-load-route';
import { createBackendRuntime } from '$lib/client/live/backend-transport-runtime';
import { createWorkspaceClientRuntime } from '$lib/client/live/backend-workspace-client';
import {
  createElectronWorkspaceLoadTransport,
  type WorkspaceLoadBridgeChannels,
} from '$lib/client/live/workspace-load-route-transport';
import { connectionsReducer } from '../../../../../src/store/renderer/slices/connections/connections-slice';
import { daemonHealthReducer } from '../../../../../src/store/renderer/slices/daemon-health/daemon-health-slice';
import { workspaceEventsReducer } from '../../../../../src/store/renderer/slices/workspace-events/workspace-events-slice';
import { principalReducer } from '../../../../../src/store/renderer/slices/principal/principal-slice';
import { userPreferencesReducer } from '../../../../../src/store/renderer/slices/user-preferences/user-preferences-slice';
import { workspaceReducer } from '../../../../../src/store/renderer/slices/workspace/workspace-slice';
import { acquiredTabStateReducer } from '../../../../../src/store/renderer/slices/tab-state/tab-state-acquisition-reducer';
import {
  openWorkspaceTab,
  closeWorkspaceTab,
} from '../../../../../src/store/renderer/slices/tab-state/tab-state-slice';
import { createWorkspaceLoadOriginOwner } from '../../../../../src/store/renderer/slices/workspace-lifecycle/workspace-load-origin-owner';
import { createWorkspaceDeletionRuntime } from '../../../../../src/store/renderer/slices/workspace/utils/workspace-deletion-factory';
import { createWorkspaceDomainClientRuntime } from '../../../../../src/store/renderer/slices/workspace/utils/workspace-domain-client-factory';
import { observeWorkspaceLoadAuthority } from './workspace-load-read-scope';

const channels: WorkspaceLoadBridgeChannels = {
  OBSERVE_ORIGIN: 'test:workspace-load:observe',
  PREPARE: 'test:workspace-load:prepare',
  READ: 'test:workspace-load:read',
  RELEASE: 'test:workspace-load:release',
  RELEASE_ORIGIN: 'test:workspace-load:release-origin',
  RETIRED: 'test:workspace-load:retired',
};
const workspaceId = WorkspaceId('77777777-7777-4777-8777-777777777777');
const stops: Array<() => void> = [];
afterEach(() => {
  for (const stop of stops.splice(0).reverse()) stop();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function workspace() {
  return {
    id: workspaceId,
    title: 'Original workspace',
    branch: 'main',
    status: 'archived',
    path: 'C:\\repo\\work',
    repositoryPath: 'C:\\repo',
    worktreePath: 'C:\\repo\\work',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    originalExtraField: 'preserved',
  };
}
function fixture() {
  const actual = new ReactStore({
    connections: connectionsReducer,
    daemonHealth: daemonHealthReducer,
    workspaceEvents: workspaceEventsReducer,
    principal: principalReducer,
    userPreferences: userPreferencesReducer,
    workspace: workspaceReducer,
    tabState: acquiredTabStateReducer,
  });
  stops.push(actual.init());
  const owner = createWorkspaceLoadOriginOwner(() => actual.state);
  stops.push(owner.dispose);
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const reads: Array<{ input: WorkspaceLoadRead; reply: ReturnType<typeof deferred<unknown>> }> =
    [];
  const prepareReplies: Array<{
    ref: WorkspaceLoadRouteRef;
    reply: ReturnType<typeof deferred<unknown>>;
  }> = [];
  let holdPrepare = false;
  let serial = 0;
  const invoke = vi.fn(async (channel: string, ...args: unknown[]): Promise<unknown> => {
    if (channel === channels.OBSERVE_ORIGIN)
      return { ok: true, result: { originId: `origin-${++serial}` } };
    if (channel === channels.PREPARE) {
      const ref = { ...Object(args[0]), routeId: `route-${++serial}` } as WorkspaceLoadRouteRef;
      if (!holdPrepare) return { ok: true, result: ref };
      const reply = deferred<unknown>();
      prepareReplies.push({ ref, reply });
      return reply.promise;
    }
    if (channel === channels.READ) {
      const reply = deferred<unknown>();
      reads.push({ input: args[0] as WorkspaceLoadRead, reply });
      return reply.promise;
    }
    if (channel === channels.RELEASE || channel === channels.RELEASE_ORIGIN)
      return { ok: true, result: undefined };
    if (channel === IPC_CHANNELS.BACKEND.REQUEST)
      return { ok: true, result: { workspaces: [workspace()] } };
    if (channel === WORKSPACE_CHANNELS.LIST) return { success: true, data: [workspace()] };
    if (
      channel === WORKSPACE_CHANNELS.GET_DIFF_SUMMARY ||
      channel === WORKSPACE_CHANNELS.GET_GIT_SUMMARY
    )
      return { ok: true, data: null };
    if (channel === WORKSPACE_CHANNELS.GET_TASKS) return { ok: true, data: [] };
    throw new Error(`Unexpected channel ${channel}`);
  });
  const apiValue = {
    invoke,
    send: vi.fn(),
    on: vi.fn((_channel: string, callback: (...args: unknown[]) => void) => {
      const id = `listener-${++serial}`;
      listeners.set(id, callback);
      return id;
    }),
    off: vi.fn(),
    offById: vi.fn((_channel: string, id: string) => {
      listeners.delete(id);
    }),
    removeAllListeners: vi.fn(() => listeners.clear()),
    once: vi.fn(),
    platform: 'linux',
    arch: 'x64',
    versions: { node: '24.21.0', chrome: '153.0.8010.12', electron: '43.0.0' },
    devInstance: null,
    devPort: null,
  };
  const api: Window['electronAPI'] = apiValue;
  vi.stubGlobal('window', { electronAPI: api });
  const backend = createBackendRuntime(() => ({
    remoteEnabled: () => actual.state.userPreferences.labsRemoteAgentsEnabled === true,
    connectionGeneration: () => actual.state.daemonHealth.connectionGeneration,
  }));
  const deletions = createWorkspaceDeletionRuntime(actual);
  const transport = createElectronWorkspaceLoadTransport(channels);
  async function authority() {
    const value = await observeWorkspaceLoadAuthority({
      transport,
      backend,
      store: actual,
      deletions,
    });
    if (!value) throw new Error('Expected controlled authority');
    stops.push(value.release);
    return value;
  }
  async function acquire(
    value: NonNullable<Awaited<ReturnType<typeof authority>>>,
    context = 'original-context',
  ) {
    actual.dispatch(openWorkspaceTab(workspaceId));
    const intent = owner.begin(workspaceId, value);
    if (!intent) throw new Error('Expected accepted-tab intent');
    const prepared = await value.prepare(intent.lifetime);
    if (!prepared || !intent.installPrepared(prepared) || !intent.authorizePublication())
      throw new Error('Expected original prepared request');
    const request = owner.captureRequest(intent.action);
    const scope = request?.acquireReadScope(context);
    if (!scope) throw new Error('Expected original read scope');
    return { intent, request, prepared, scope };
  }
  function settle(index: number, value: unknown) {
    const item = reads[index]!;
    const { operation: _operation, ...ref } = item.input;
    item.reply.resolve({
      ok: true,
      result: { ref, current: true, settlement: { status: 'fulfilled', value } },
    });
  }
  return {
    actual,
    owner,
    backend,
    deletions,
    transport,
    authority,
    acquire,
    reads,
    settle,
    invoke,
    api,
    prepareReplies,
    holdPreparation(hold = true) {
      holdPrepare = hold;
    },
    emit(payload: unknown) {
      for (const listener of [...listeners.values()]) listener(payload);
    },
  };
}

describe('real canonical clients per workspace-load acquisition', () => {
  it('acquires synchronously without reads and binds the original request/context', async () => {
    const f = fixture();
    const authority = await f.authority();
    const owned = await f.acquire(authority);
    expect(owned.scope.requestIdentity).toBe(owned.intent.lifetime.identity);
    expect(owned.scope.context).toBe('original-context');
    expect(owned.intent.lifetime.isCurrent()).toBe(true); // Exercises owner -> prepared without recursion.
    expect(owned.prepared.acquireReadScope('another-context')).toBeNull();
    expect(f.reads).toHaveLength(0);
    expect(f.invoke.mock.calls.map(([channel]) => channel)).toEqual([
      channels.OBSERVE_ORIGIN,
      channels.PREPARE,
    ]);
    expect(Object.keys(owned.scope.workspaceClient)).toEqual(['open']);
    expect(Object.keys(owned.scope.appClient.workspaces)).toEqual(['get']);
  });

  it('uses actual domain path normalization and actual wire workspace normalization', async () => {
    const f = fixture();
    const { scope } = await f.acquire(await f.authority());
    const opened = scope.workspaceClient.open(workspaceId);
    const got = scope.appClient.workspaces.get(workspaceId);
    expect(f.reads.map((item) => item.input.operation)).toEqual(['open', 'get']);
    expect(f.reads[0]!.input).toMatchObject({ workspaceId, operation: 'open' });
    expect(f.reads[1]!.input).toEqual({ ...f.reads[0]!.input, operation: 'get' });
    f.settle(0, { success: true, data: workspace() });
    f.settle(1, { workspace: workspace() });
    expect(await opened).toMatchObject({
      ok: true,
      data: {
        path: 'C:/repo/work',
        repositoryPath: 'C:/repo',
        worktreePath: 'C:/repo/work',
        originalExtraField: 'preserved',
      },
    });
    expect(await got).toMatchObject({
      id: workspaceId,
      status: WorkspaceStatus.Archived,
      originalExtraField: 'preserved',
    });
    expect(
      f.invoke.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.BACKEND.REQUEST),
    ).toHaveLength(0);
    expect(f.actual.state.workspace.workspaces.ids).toHaveLength(0);
  });

  it('deduplicates within each actual client but keeps reopened acquisitions independent', async () => {
    const f = fixture();
    const authority = await f.authority();
    const a = await f.acquire(authority);
    const old = Promise.allSettled([
      a.scope.workspaceClient.open(workspaceId),
      a.scope.workspaceClient.open(workspaceId),
      a.scope.appClient.workspaces.get(workspaceId),
      a.scope.appClient.workspaces.get(workspaceId),
    ]);
    expect(f.reads).toHaveLength(2);
    f.actual.dispatch(closeWorkspaceTab(workspaceId));
    f.owner.observeAcceptedState();
    const b = await f.acquire(authority);
    const current = Promise.all([
      b.scope.workspaceClient.open(workspaceId),
      b.scope.workspaceClient.open(workspaceId),
      b.scope.appClient.workspaces.get(workspaceId),
      b.scope.appClient.workspaces.get(workspaceId),
    ]);
    expect(f.reads).toHaveLength(4);
    expect(f.reads[0]!.input.requestId).not.toBe(f.reads[2]!.input.requestId);
    expect(a.scope.signal.aborted).toBe(true);
    f.settle(2, { ok: true, data: workspace() });
    f.settle(3, { workspace: workspace() });
    const outcomes = await current;
    expect(outcomes.slice(0, 2)).toMatchObject([{ ok: true }, { ok: true }]);
    expect(outcomes.slice(2)).toMatchObject([{ id: workspaceId }, { id: workspaceId }]);
    f.settle(0, { ok: true, data: workspace() });
    f.settle(1, { workspace: workspace() });
    const prior = await old;
    // Canonical invoke catches its leading await, while a deduplicated caller returns
    // the original pending promise directly; preserve that distinct rejection behavior.
    expect(prior.slice(0, 2)).toMatchObject([
      { status: 'fulfilled', value: { ok: false } },
      { status: 'rejected', reason: { code: 'WORKSPACE_LOAD_ROUTE_UNAVAILABLE' } },
    ]);
    expect(prior.slice(2)).toMatchObject([{ status: 'rejected' }, { status: 'rejected' }]);
    expect(b.scope.isCurrent()).toBe(true);
    expect(authority.isCurrent()).toBe(true);
  });

  it.each(['retired', 'malformed', 'outer'] as const)(
    'retires original authority before canonical open folds %s',
    async (kind) => {
      const f = fixture();
      const authority = await f.authority();
      const owned = await f.acquire(authority);
      const order: string[] = [];
      authority.signal.addEventListener('abort', () => order.push('retired'));
      const opened = owned.scope.workspaceClient.open(workspaceId).then((result) => {
        order.push('folded');
        return result;
      });
      const { operation: _operation, ...ref } = f.reads[0]!.input;
      const response =
        kind === 'retired'
          ? { ok: true, result: { ref, current: false, reason: 'retired' } }
          : kind === 'malformed'
            ? { ok: true, result: { ref, current: true, settlement: { status: 'invalid' } } }
            : { ok: false, error: { code: 'UNAVAILABLE', message: 'offline' } };
      f.reads[0]!.reply.resolve(response);
      expect(await opened).toMatchObject({ ok: false });
      expect(order).toEqual(['retired', 'folded']);
      expect(owned.intent.lifetime.signal.aborted).toBe(true);
      expect(owned.intent.authorizePublication()).toBe(false);
      expect(f.owner.captureRequest(owned.intent.action)).toBeNull();
      expect(f.actual.state.workspace.workspaces.ids).toHaveLength(0);
    },
  );

  it('retains ordinary current rejection folding without retiring the original intent', async () => {
    const f = fixture();
    const authority = await f.authority();
    const owned = await f.acquire(authority);
    const opened = owned.scope.workspaceClient.open(workspaceId);
    const { operation: _operation, ...ref } = f.reads[0]!.input;
    f.reads[0]!.reply.resolve({
      ok: true,
      result: {
        ref,
        current: true,
        settlement: {
          status: 'rejected',
          error: {
            code: 'FORBIDDEN',
            message: 'original daemon failure',
            rpcCode: -32003,
            data: { detail: 'retained' },
          },
        },
      },
    });
    expect(await opened).toEqual({ ok: false, error: 'original daemon failure' });
    expect(owned.intent.lifetime.isCurrent()).toBe(true);
    expect(authority.signal.aborted).toBe(false);
  });

  it.each([
    'exact',
    'outer',
    'malformed',
    'foreign-origin',
    'foreign-request',
    'foreign-workspace',
    'rejection',
    'throwing-cancelled-signal',
    'throwing-cleanup',
  ] as const)(
    'keeps successor clients current after cancelled PREPARE %s and earlier route notices',
    async (kind) => {
      const f = fixture();
      const authority = await f.authority();
      f.actual.dispatch(openWorkspaceTab(workspaceId));
      const intent = f.owner.begin(workspaceId, authority)!;
      f.holdPreparation();
      let cleanupFailure = false;
      const originalRemove = intent.lifetime.signal.removeEventListener;
      vi.spyOn(intent.lifetime.signal, 'removeEventListener').mockImplementation((...args) => {
        Reflect.apply(originalRemove, intent.lifetime.signal, args);
        if (cleanupFailure) throw new Error('old listener cleanup failed');
      });
      const pending = authority.prepare(intent.lifetime);
      const item = f.prepareReplies[0]!;
      // This valid early notice belongs only to A and must be removed on cancellation.
      f.emit({ kind: 'route', ...item.ref });
      intent.retire();
      f.holdPreparation(false);
      const successor = await f.acquire(authority);
      if (kind === 'throwing-cancelled-signal')
        vi.spyOn(intent.lifetime.signal, 'aborted', 'get').mockImplementation(() => {
          throw new Error('old aborted getter must not be read again');
        });
      if (kind === 'throwing-cleanup') {
        // Transport captured the original remove method before invoke; its implementation
        // is controlled below through the spy installed before preparation.
        cleanupFailure = true;
      }
      f.emit({ kind: 'route', ...item.ref });
      f.emit({ kind: 'route', ...item.ref, workspaceId: 'foreign-workspace' });
      expect(successor.scope.isCurrent()).toBe(true);
      if (kind === 'rejection') item.reply.reject(new Error('late prepare failure'));
      else if (kind === 'outer')
        item.reply.resolve({ ok: false, error: { code: 'OFFLINE', message: 'late failure' } });
      else if (kind === 'malformed') item.reply.resolve({ ok: true, result: { routeId: 7 } });
      else {
        const result = { ...item.ref };
        if (kind === 'foreign-origin') result.originId = 'foreign';
        if (kind === 'foreign-request') result.requestId = 'foreign';
        if (kind === 'foreign-workspace') result.workspaceId = 'foreign';
        item.reply.resolve({ ok: true, result });
      }
      expect(await pending).toBeNull();
      expect(f.invoke.mock.calls.filter(([channel]) => channel === channels.RELEASE)).toEqual(
        ['exact', 'throwing-cancelled-signal', 'throwing-cleanup'].includes(kind)
          ? [[channels.RELEASE, item.ref]]
          : [],
      );
      expect(
        f.invoke.mock.calls.filter(([channel]) => channel === channels.RELEASE_ORIGIN),
      ).toEqual([]);
      expect(authority.signal.aborted).toBe(false);
      if (kind !== 'throwing-cancelled-signal') expect(intent.lifetime.signal.aborted).toBe(true);
      expect(successor.intent.authorizePublication()).toBe(true);
      const opened = successor.scope.workspaceClient.open(workspaceId);
      const got = successor.scope.appClient.workspaces.get(workspaceId);
      f.settle(0, { ok: true, data: workspace() });
      f.settle(1, { workspace: workspace() });
      expect(await opened).toMatchObject({ ok: true, data: { id: workspaceId } });
      expect(await got).toMatchObject({ id: workspaceId, status: WorkspaceStatus.Archived });
      expect(successor.scope.isCurrent()).toBe(true);
    },
  );

  it('keeps a successor alive when cancellation and route notice precede the prepare await continuation', async () => {
    const f = fixture();
    const authority = await f.authority();
    f.actual.dispatch(openWorkspaceTab(workspaceId));
    const intent = f.owner.begin(workspaceId, authority)!;
    const originalRemove = intent.lifetime.signal.removeEventListener;
    let lateRef: WorkspaceLoadRouteRef | undefined;
    let successor: ReturnType<typeof f.acquire> | undefined;
    let queued = false;
    vi.spyOn(intent.lifetime.signal, 'removeEventListener').mockImplementation((...args) => {
      Reflect.apply(originalRemove, intent.lifetime.signal, args);
      if (queued) return;
      queued = true;
      // Native queue order: transport finishes and inserts route A before this runs,
      // while composition's await continuation is still queued behind it.
      queueMicrotask(() => {
        intent.retire();
        successor = f.acquire(authority);
        f.emit({ kind: 'route', ...lateRef! });
      });
    });
    f.holdPreparation();
    const pending = authority.prepare(intent.lifetime);
    const item = f.prepareReplies[0]!;
    lateRef = item.ref;
    f.holdPreparation(false);
    item.reply.resolve({ ok: true, result: item.ref });
    expect(await pending).toBeNull();
    const owned = await successor!;
    expect(owned.scope.isCurrent()).toBe(true);
    const opened = owned.scope.workspaceClient.open(workspaceId);
    const got = owned.scope.appClient.workspaces.get(workspaceId);
    f.settle(0, { ok: true, data: workspace() });
    f.settle(1, { workspace: workspace() });
    expect(await opened).toMatchObject({ ok: true });
    expect(await got).toMatchObject({ id: workspaceId });
    expect(f.invoke.mock.calls.filter(([channel]) => channel === channels.RELEASE)).toEqual([
      [channels.RELEASE, item.ref],
    ]);
    expect(authority.isCurrent()).toBe(true);
  });

  it('keeps origin retirement terminal while a cancelled PREPARE is still in flight', async () => {
    const f = fixture();
    const authority = await f.authority();
    f.actual.dispatch(openWorkspaceTab(workspaceId));
    const intent = f.owner.begin(workspaceId, authority)!;
    f.holdPreparation();
    const pending = authority.prepare(intent.lifetime);
    const item = f.prepareReplies[0]!;
    intent.retire();
    f.holdPreparation(false);
    const successor = await f.acquire(authority);
    f.emit({ kind: 'origin', originId: item.ref.originId });
    expect(successor.scope.signal.aborted).toBe(true);
    expect(successor.intent.authorizePublication()).toBe(false);
    item.reply.resolve({ ok: true, result: item.ref });
    expect(await pending).toBeNull();
    expect(f.invoke).toHaveBeenCalledWith(channels.RELEASE, item.ref);
    expect(authority.isCurrent()).toBe(false);
    expect(f.reads).toHaveLength(0);
  });

  it.each(['outer', 'malformed', 'rejection'] as const)(
    'retires the original accepted intent after uncancelled PREPARE %s',
    async (kind) => {
      const f = fixture();
      const authority = await f.authority();
      f.actual.dispatch(openWorkspaceTab(workspaceId));
      const intent = f.owner.begin(workspaceId, authority)!;
      f.holdPreparation();
      const pending = authority.prepare(intent.lifetime);
      const item = f.prepareReplies[0]!;
      if (kind === 'rejection') item.reply.reject(new Error('prepare failed'));
      else
        item.reply.resolve(
          kind === 'outer'
            ? { ok: false, error: { code: 'OFFLINE', message: 'failure' } }
            : { ok: true, result: { routeId: 7 } },
        );
      expect(await pending).toBeNull();
      expect(authority.signal.aborted).toBe(true);
      expect(intent.lifetime.signal.aborted).toBe(true);
      expect(intent.authorizePublication()).toBe(false);
      expect(f.reads).toHaveLength(0);
    },
  );

  it('permanently rejects observed bridge replacement even if the old bridge returns', async () => {
    const f = fixture();
    const authority = await f.authority();
    const owned = await f.acquire(authority);
    vi.stubGlobal('window', { electronAPI: { ...f.api, invoke: vi.fn() } });
    expect(owned.scope.isCurrent()).toBe(false);
    vi.stubGlobal('window', { electronAPI: f.api });
    expect(owned.scope.isCurrent()).toBe(false);
    await expect(owned.scope.appClient.workspaces.get(workspaceId)).rejects.toBeDefined();
    expect(f.reads).toHaveLength(0);
  });

  it('refuses acquisition after a genuine dependency getter synchronously retires its request', async () => {
    const f = fixture();
    const authority = await f.authority();
    f.actual.dispatch(openWorkspaceTab(workspaceId));
    const intent = f.owner.begin(workspaceId, authority)!;
    const prepared = (await authority.prepare(intent.lifetime))!;
    expect(intent.installPrepared(prepared)).toBe(true);
    const original = f.deletions.currentWorkspaceDeletion;
    Object.defineProperty(f.deletions, 'currentWorkspaceDeletion', {
      configurable: true,
      get() {
        intent.retire();
        return original;
      },
    });
    expect(prepared.acquireReadScope('original-context')).toBeNull();
    expect(intent.lifetime.signal.aborted).toBe(true);
    expect(f.reads).toHaveLength(0);
  });

  it('contains a throwing dependency getter and retires the authority before refusing acquisition', async () => {
    const f = fixture();
    const authority = await f.authority();
    f.actual.dispatch(openWorkspaceTab(workspaceId));
    const intent = f.owner.begin(workspaceId, authority)!;
    const prepared = (await authority.prepare(intent.lifetime))!;
    expect(intent.installPrepared(prepared)).toBe(true);
    Object.defineProperty(f.deletions, 'currentWorkspaceDeletion', {
      configurable: true,
      get() {
        throw new Error('dependency failed');
      },
    });
    expect(prepared.acquireReadScope('original-context')).toBeNull();
    expect(authority.signal.aborted).toBe(true);
    expect(intent.lifetime.signal.aborted).toBe(true);
    expect(f.reads).toHaveLength(0);
  });

  it('does not prepare the same accepted request twice or acquire after its release', async () => {
    const f = fixture();
    const authority = await f.authority();
    const owned = await f.acquire(authority);
    expect(await authority.prepare(owned.intent.lifetime)).toBeNull();
    owned.scope.release();
    expect(owned.prepared.acquireReadScope('replacement-context')).toBeNull();
    expect(f.invoke.mock.calls.filter(([channel]) => channel === channels.PREPARE)).toHaveLength(1);
    expect(f.reads).toHaveLength(0);
  });

  it('keeps genuine complete backend and all four other domain handlers callable', async () => {
    const f = fixture();
    const origin = (await f.transport.observeOrigin())!;
    stops.push(origin.release);
    const route = (await origin.prepare(
      'other-method-proof',
      workspaceId,
      new AbortController().signal,
    ))!;
    const WireClient = createWorkspaceClientRuntime(f.backend);
    const wire = new WireClient();
    const DomainClient = createWorkspaceDomainClientRuntime({
      store: f.actual,
      workspaces: wire,
      deletions: f.deletions,
      transport: route.createDomainReadTransport(),
    });
    const domain = new DomainClient();
    expect(await wire.list()).toMatchObject([
      { id: workspaceId, status: WorkspaceStatus.Archived },
    ]);
    expect(f.invoke).toHaveBeenCalledWith(IPC_CHANNELS.BACKEND.REQUEST, {
      method: 'workspace.list',
      params: undefined,
    });
    expect(await domain.list({ lite: true })).toMatchObject({
      ok: true,
      complete: true,
      data: [{ repositoryPath: 'C:/repo' }],
    });
    expect(await domain.getDiffSummary(workspaceId)).toEqual({ ok: true, data: null });
    expect(await domain.getGitSummary(workspaceId)).toEqual({ ok: true, data: null });
    expect(await domain.getTasks(workspaceId)).toEqual({ ok: true, data: [] });
    expect(f.invoke).toHaveBeenCalledWith(WORKSPACE_CHANNELS.LIST, { lite: true });
    for (const channel of [
      WORKSPACE_CHANNELS.GET_DIFF_SUMMARY,
      WORKSPACE_CHANNELS.GET_GIT_SUMMARY,
      WORKSPACE_CHANNELS.GET_TASKS,
    ]) {
      expect(f.invoke).toHaveBeenCalledWith(channel, { workspaceId });
    }
    expect(f.reads).toHaveLength(0);
  });

  it('signals cancellation before release IPC and never sends a second release', async () => {
    const f = fixture();
    const authority = await f.authority();
    const owned = await f.acquire(authority);
    const observed: boolean[] = [];
    const originalInvoke = f.invoke.getMockImplementation()!;
    f.invoke.mockImplementation(async (channel, ...args) => {
      if (channel === channels.RELEASE)
        observed.push(owned.scope.signal.aborted && owned.intent.lifetime.signal.aborted);
      return originalInvoke(channel, ...args);
    });
    owned.scope.release();
    owned.scope.release();
    expect(observed).toEqual([true]);
    expect(authority.isCurrent()).toBe(true);
  });
});
