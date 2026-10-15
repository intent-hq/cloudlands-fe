/**
 * Source-mode integration coverage for the extracted complete receiver.
 * The real source facade supplies all canonical selectors, LiveAppClient methods,
 * script journal, list-only authority, membership and reconnect bindings.
 * Each case owns init/dispose of the configured source Store and its sole saga
 * middleware. Only the IPC boundary is controlled; no selector/client/saga mock.
 * This intentionally has a source-only test closure. It is NOT a React adapter
 * or evidence that React's missing projections/clients have been implemented.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceStatus, type Workspace } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { WORKSPACE_CHANNELS } from '$shared/ipc/channels';
import { mockInvoke, overrideMockIpcHandler } from '$shared/ipc-mock-router';
import { store } from '../../../store';
import { lifecycleReadSaga } from './lifecycle-read-saga';
import { connectionsListReceived } from '../../connections/connections-slice';
import { connectionStatusChanged } from '../../daemon-health/daemon-health-slice';
import {
  daemonEventsSubscribed,
  loadEventsRequested,
  loadOlderEventsRequested,
} from '../../workspace-events/workspace-events-slice';
import { selectWorkspaceEvents } from '../../workspace-events/workspace-events-selectors';
import { principalContextChanged, principalReceived } from '../../principal/principal-slice';
import { getPrincipalConnectionContext } from '../../principal/principal-projections';
import {
  setWorkspaceEntity,
  loadWorkspacesRequested,
  refreshWorkspaceMembershipRequested,
} from '../../workspace/workspace-slice';
import {
  selectWorkspaceById,
  selectWorkspaceListLoadedForBackend,
} from '../../workspace/workspace-selectors';
import {
  acquireWorkspaceTasksDemand,
  releaseWorkspaceTasksDemand,
} from '../../workspace-tasks/workspace-tasks-slice';
import {
  selectWorkspaceTasks,
  selectWorkspaceTaskProgress,
} from '../../workspace-tasks/workspace-tasks-selectors';
import { hydrateTaskAgentAssociationsRequested } from '../../task-agent-associations/task-agent-associations-slice';
import { hydrateTerminalsRequested } from '../../terminals/terminals-slice';
import { loadSkillsRequested } from '../../skills/skills-slice';
import { initContextForWorkspace } from '../../context/context-slice';
import { workspaceUnmounted } from '../workspace-lifecycle-slice';

const WS = '11111111-1111-4111-8111-111111111111';
const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups
    .splice(0)
    .reverse()
    .forEach((cleanup) => cleanup());
  vi.restoreAllMocks();
});
async function settle() {
  for (let turn = 0; turn < 20; turn++) await Promise.resolve();
}
function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function workspace(id = WS): Workspace {
  return {
    id: WorkspaceId(id),
    title: id,
    branch: 'main',
    status: WorkspaceStatus.Active,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    myRole: 'owner',
    canManage: true,
    memberCount: 1,
    openInviteCount: 0,
  };
}
function event(id: string) {
  return {
    id,
    workspaceId: WS,
    type: 'agent:created',
    timestamp:
      (
        {
          first: '2026-01-01T00:00:01.000Z',
          second: '2026-01-01T00:00:02.000Z',
          third: '2026-01-01T00:00:03.000Z',
        } as Record<string, string>
      )[id] ?? '2026-01-01T00:00:04.000Z',
    actor: { type: 'system' },
  };
}
function fixture() {
  store.dispose();
  const dispose = store.init();
  const requests: Array<{ method: string; params: unknown; reply: (result: unknown) => void }> = [];
  const lists: Array<{ params: unknown; reply: (result: unknown) => void }> = [];
  const restoreBackend = overrideMockIpcHandler(IPC_CHANNELS.BACKEND.REQUEST, (payload) => {
    const { method, params } = payload as { method: string; params?: unknown };
    const pending = deferred();
    requests.push({ method, params, reply: (result) => pending.resolve({ ok: true, result }) });
    return pending.promise;
  });
  const restoreList = overrideMockIpcHandler(WORKSPACE_CHANNELS.LIST, (params) => {
    const pending = deferred();
    lists.push({ params, reply: pending.resolve });
    return pending.promise;
  });
  // Both real generated IPC and real Electron backend requests use the one mock router.
  vi.spyOn(window.electronAPI, 'invoke').mockImplementation((channel, ...args) =>
    mockInvoke(channel, ...args),
  );
  let stop: (() => void) | undefined;
  cleanups.push(() => {
    stop?.();
    dispose();
    restoreList();
    restoreBackend();
  });
  store.dispatch(
    connectionsListReceived({ connections: [], activeId: 'local', windowBackendId: 'local' }),
  );
  store.dispatch(connectionStatusChanged('connected'));
  store.dispatch(daemonEventsSubscribed());
  const context = getPrincipalConnectionContext(store.state);
  if (context === null) throw new Error('Canonical connection admission failed');
  store.dispatch(principalContextChanged(context));
  store.dispatch(
    principalReceived(
      { context, invalidation: 0, presentationVersion: 0 },
      {
        principal: {
          id: 'reader',
          login: null,
          displayName: null,
          avatarUrl: null,
          isAdministrator: true,
          hostRole: 'owner',
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
  store.dispatch(setWorkspaceEntity(workspace()));
  return {
    requests,
    lists,
    start: () => {
      stop = store.runSaga(lifecycleReadSaga);
    },
    stop: () => stop?.(),
  };
}

// These are new-factory/source-facade cases. Existing lifecycle-read-saga.test.ts
// remains unchanged and supplies the wider worker/agent/script regression suite.
describe('Complete extracted receiver through its genuine source facade', () => {
  it('performs no eager reads and binds real list and membership owners exactly once', async () => {
    const f = fixture();
    f.start();
    expect(f.requests).toHaveLength(0);
    expect(f.lists).toHaveLength(0);
    store.dispatch(loadWorkspacesRequested());
    expect(f.lists.map(({ params }) => params)).toEqual([{ lite: true }]);
    f.lists[0].reply({ ok: true, data: [workspace()] });
    await settle();
    expect(selectWorkspaceListLoadedForBackend.select(store.state, 'local')).toBe(true);
    store.dispatch(refreshWorkspaceMembershipRequested(WS));
    expect(f.requests.map(({ method, params }) => ({ method, params }))).toEqual([
      { method: 'workspace.get', params: { workspaceId: WS } },
    ]);
    f.requests[0].reply({ workspace: { ...workspace(), memberCount: 4 } });
    await settle();
    expect(selectWorkspaceById.select(store.state, WS)?.memberCount).toBe(4);
  });

  it('shares six slots across unrelated reads and membership, then releases cancelled slots', async () => {
    const f = fixture();
    f.start();
    store.dispatch(loadEventsRequested(WS));
    store.dispatch(acquireWorkspaceTasksDemand(WS, 'visible'));
    store.dispatch(loadSkillsRequested(WS));
    store.dispatch(hydrateTerminalsRequested(WS));
    store.dispatch(hydrateTaskAgentAssociationsRequested(WS));
    store.dispatch(refreshWorkspaceMembershipRequested(WS));
    store.dispatch(loadEventsRequested('receiver-b'));
    expect(f.requests.map(({ method, params }) => ({ method, params }))).toEqual([
      { method: 'event.query', params: { workspaceId: WS, limit: 100, paginate: true } },
      { method: 'task.list', params: { workspaceId: WS } },
      { method: 'skill.list', params: { workspaceId: WS } },
      { method: 'terminal.list', params: { workspaceId: WS } },
      { method: 'task.listAgentLinks', params: { workspaceId: WS } },
      { method: 'workspace.get', params: { workspaceId: WS } },
    ]);
    store.dispatch(workspaceUnmounted(WS));
    await settle();
    expect(f.requests[6]).toMatchObject({
      method: 'event.query',
      params: { workspaceId: 'receiver-b', limit: 100, paginate: true },
    });
    // Source membership deliberately does not race unmount. Do not strengthen it here.
    f.requests[5].reply({ workspace: { ...workspace(), memberCount: 8 } });
    f.requests[6].reply({ items: [], nextToken: null });
    await settle();
    expect(selectWorkspaceById.select(store.state, WS)?.memberCount).toBe(8);
  });

  it('coalesces the event burst while preserving newest-first wire and oldest-first state', async () => {
    const f = fixture();
    f.start();
    store.dispatch(loadEventsRequested(WS));
    store.dispatch(loadEventsRequested(WS));
    store.dispatch(loadEventsRequested(WS));
    expect(f.requests).toHaveLength(1);
    f.requests[0].reply({ items: [event('second'), event('first')], nextToken: 'older-page' });
    await settle();
    expect(f.requests).toHaveLength(2);
    f.requests[1].reply({ items: [event('third'), event('second')], nextToken: 'older-page' });
    await settle();
    expect(selectWorkspaceEvents.select(store.state, WS).map((row) => row.id)).toEqual([
      'second',
      'third',
    ]);
    store.dispatch(loadOlderEventsRequested(WS));
    expect(f.requests[2]).toMatchObject({
      method: 'event.query',
      params: { workspaceId: WS, limit: 100, nextToken: 'older-page', paginate: true },
    });
    f.requests[2].reply({ items: [event('first')], nextToken: null });
    await settle();
    expect(selectWorkspaceEvents.select(store.state, WS).map((row) => row.id)).toEqual([
      'first',
      'second',
      'third',
    ]);
  });

  it('rechecks task demand after waiting for a slot and preserves daemon rollups', async () => {
    const f = fixture();
    f.start();
    for (let index = 0; index < 6; index++) store.dispatch(loadEventsRequested(`busy-${index}`));
    store.dispatch(acquireWorkspaceTasksDemand(WS, 'visible'));
    store.dispatch(releaseWorkspaceTasksDemand(WS, 'visible'));
    f.requests[0].reply({ items: [], nextToken: null });
    await settle();
    expect(f.requests.some(({ method }) => method === 'task.list')).toBe(false);
    store.dispatch(acquireWorkspaceTasksDemand(WS, 'visible-again'));
    expect(f.requests[6]).toMatchObject({ method: 'task.list', params: { workspaceId: WS } });
    f.requests[6].reply({
      tasks: [{ id: 'task-a', title: 'Task', status: 'in_progress' }],
      stats: { total: 13, completed: 7, inProgress: 2 },
    });
    await settle();
    expect(selectWorkspaceTasks.select(store.state, WS).map((task) => task.id)).toEqual(['task-a']);
    expect(selectWorkspaceTaskProgress.select(store.state, WS)).toMatchObject({
      total: 13,
      completed: 7,
      inProgress: 2,
    });
  });

  it('allocates a fresh context cache per run while retaining canonical reducer state', async () => {
    const f = fixture();
    f.start();
    store.dispatch(initContextForWorkspace(WS));
    expect(f.requests[0]).toMatchObject({
      method: 'workspace.getContext',
      params: { workspaceId: WS },
    });
    f.requests[0].reply({ items: [] });
    await settle();
    store.dispatch(initContextForWorkspace(WS));
    expect(f.requests).toHaveLength(1);
    f.stop();
    f.start();
    store.dispatch(initContextForWorkspace(WS));
    expect(f.requests).toHaveLength(2);
    f.requests[1].reply({ items: [] });
    await settle();
  });

  it('cancels old read settlement and starts six new reads after root restart', async () => {
    const f = fixture();
    f.start();
    for (let index = 0; index < 6; index++) store.dispatch(loadEventsRequested(`old-${index}`));
    f.stop();
    f.start();
    for (let index = 0; index < 6; index++) store.dispatch(loadEventsRequested(`new-${index}`));
    expect(f.requests).toHaveLength(12);
    f.requests[0].reply({ items: [{ ...event('late'), workspaceId: 'old-0' }], nextToken: null });
    await settle();
    expect(selectWorkspaceEvents.select(store.state, 'old-0')).toEqual([]);
    f.requests[6].reply({
      items: [{ ...event('current'), workspaceId: 'new-0' }],
      nextToken: null,
    });
    await settle();
    expect(selectWorkspaceEvents.select(store.state, 'new-0').map((row) => row.id)).toEqual([
      'current',
    ]);
  });
});

// Controlled-port worker evidence only. This is NOT complete React receiver composition:
// list/membership startup is parked, and unrelated selector operations fail if reached.
import { setImmediate } from 'node:timers/promises';
import { ClientLogger } from '$lib/utils/client-logger';
import { take, type SagaGenerator } from 'typed-redux-saga';
import { createAction } from '@themislib/themis/utils/store/create-action';
import type { GenericAction } from '@themislib/themis/types';
import { appClient } from '$lib/client';
import { createLifecycleReadSaga } from './lifecycle-read-saga-factory';
import type {
  LifecycleReadDependencies,
  ScopedGitReadPorts,
  ScopedGitReadScope,
} from '../lifecycle-read-types';
import { getAdmittedWorkspaceReadContext } from '../utils/workspace-read-admission';
import { selectPrincipalActionContext, selectHostRole } from '../../principal/principal-selectors';
import { setWorkspaceHasLoaded } from '../../workspace/workspace-slice';
import {
  prStatusRefreshCompleted,
  prStatusScopedRefreshSucceeded,
  refreshPRStatusRequested,
} from '../../pr-status/pr-status-slice';
import {
  refreshRequested,
  loadOlderCommitsRequested,
  setLoadingOlderCommits,
} from '../../changes/changes-slice';
import { getPRStatusRefreshMetadata } from '../../pr-status/pr-status-projections';
import type { PrRefreshResult } from '../../../../../lib/client/lifecycle-read-client-types';

const controlledOwnerStop = createAction('test/scopedGitOwnerStop');
const controlledAdmissionSelectors = {
  selectPrincipalActionContext,
  selectHostRole,
  selectWorkspaceById,
  selectWorkspaceListLoadedForBackend,
};
const controlledGitAdmission = store.createSelector((state, id: string) =>
  getAdmittedWorkspaceReadContext(state, id, controlledAdmissionSelectors),
);
function* unusedGitDependency(): SagaGenerator<never> {
  throw new Error('Unrelated controlled dependency was reached');
}
function* parkedGitDependency(): SagaGenerator<void> {
  yield* take(controlledOwnerStop);
}
function controlledReply<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const observed = promise.then(
    (value) => ({ status: 'fulfilled' as const, value }),
    (error) => ({ status: 'rejected' as const, error: error as unknown }),
  );
  return { promise, resolve, reject, observed };
}
async function withControlledGit(
  run: (f: {
    ports: ScopedGitReadPorts<typeof store.state>;
    actions: GenericAction[];
    scopes: Array<ReturnType<typeof makeScope>>;
    acquired: string[];
    request(force?: boolean, manual?: boolean, workspaceId?: string): void;
    nextToken(value: string): void;
    refuse(value: boolean): void;
    onPut(fn: (action: GenericAction) => void): void;
    onWorkspaceSelection(fn: () => void): void;
    onAcquire(fn: (scope: ReturnType<typeof makeScope>) => void): void;
    context(): string;
  }) => Promise<void>,
) {
  fixture(); // Actual source Store setup, existing declared IPC control; no source saga started.
  const context = selectPrincipalActionContext.select(store.state);
  if (!context) throw new Error('Actual principal context missing');
  store.dispatch(setWorkspaceHasLoaded(true, 'local', context));
  const actions: GenericAction[] = [];
  const acquired: string[] = [];
  const scopes: Array<ReturnType<typeof makeScope>> = [];
  let token = 'owner-A';
  let unavailable = false;
  let duringPut: (action: GenericAction) => void = () => {};
  let duringSelection: () => void = () => {};
  let acquiredScope: (scope: ReturnType<typeof makeScope>) => void = () => {};
  const dispatch = (action: GenericAction) => {
    actions.push(action);
    const result = store.dispatch(action);
    duringPut(action);
    return result;
  };
  const ports: ScopedGitReadPorts<typeof store.state> = {
    admission: controlledGitAdmission,
    readCurrentContext: (id) => controlledGitAdmission.select(store.state, id),
    readMetadata: (id) => getPRStatusRefreshMetadata(store.state, id),
    getDispatch: () => dispatch,
    acquire: async (id, signal) => {
      acquired.push(id);
      if (unavailable) return { kind: 'unavailable' };
      const scope = makeScope(id, token, signal);
      scopes.push(scope);
      acquiredScope(scope);
      return { kind: 'acquired', scope };
    },
  };
  const unused = { effect: unusedGitDependency };
  const dependencies: LifecycleReadDependencies<typeof store.state, { requestId: string }> = {
    appClient,
    scopedGit: ports,
    getAgentLineStats: async () => {
      throw new Error('Unexpected stats');
    },
    beginScriptRead: unusedGitDependency,
    isScriptReadCurrent: unusedGitDependency,
    reconcileScriptRead: unusedGitDependency,
    refreshIntegrationAuthAfterReconnect: unusedGitDependency,
    workspaceAuthoritySaga: parkedGitDependency,
    createMembershipSaga: () => parkedGitDependency,
    selectors: {
      ...controlledAdmissionSelectors,
      selectWorkspaceById: {
        select: selectWorkspaceById.select,
        effect: function* (id) {
          const value = yield* selectWorkspaceById.effect(id);
          duringSelection();
          return value;
        },
      },
      selectCurrentWorkspaceTabId: {
        effect: function* () {
          return WS;
        },
      },
      selectAllWorkspaceScriptEntries: unused,
      selectAgentSessionWorkspaceId: unused,
      selectAgentSession: unused,
      selectAgentSessionsById: unused,
      selectShouldRequestAgentLineStats: unused,
      selectPRStatusLastRefreshTime: unused,
      selectTerminalsForWorkspace: unused,
      selectActiveAgentId: unused,
      selectWorkspaceAgentIds: unused,
      selectAllWorkspaceAgents: unused,
      selectRetiredAgentsLoaded: unused,
      selectIsLoadingRetiredAgents: unused,
      selectDelegatedAgentsLoaded: unused,
      selectIsLoadingDelegatedAgents: unused,
      selectBackgroundAgentsLoaded: unused,
      selectIsLoadingBackgroundAgents: unused,
      selectOrphanedDelegatedAgentsLoaded: unused,
      selectIsLoadingOrphanedDelegatedAgents: unused,
      selectDelegatedParentLoaded: unused,
      selectIsLoadingDelegatedParent: unused,
      selectLoadedDelegatedParentIds: unused,
      selectScopeCounts: unused,
      selectDelegatedCounts: unused,
      selectScopeCountsGeneration: unused,
      selectOlderEventsNextToken: unused,
      selectDemandedTaskWorkspaceIds: unused,
      selectWorkspaceTasksShouldLoad: unused,
    },
  };
  const stop = store.runSaga(createLifecycleReadSaga(dependencies));
  const errors: unknown[] = [];
  try {
    await run({
      ports,
      actions,
      acquired,
      scopes,
      context: () => context,
      request: (force = false, manual = false, id = WS) =>
        store.dispatch(refreshPRStatusRequested(id, force, manual)),
      nextToken: (value) => {
        token = value;
      },
      refuse: (value) => {
        unavailable = value;
      },
      onPut: (fn) => {
        duringPut = fn;
      },
      onWorkspaceSelection: (fn) => {
        duringSelection = fn;
      },
      onAcquire: (fn) => {
        acquiredScope = fn;
      },
    });
  } catch (error) {
    errors.push(error);
  }
  try {
    stop();
  } catch (error) {
    errors.push(error);
  }
  for (const scope of scopes) {
    try {
      scope.release();
    } catch (error) {
      errors.push(error);
    }
    scope.pr.resolve(null);
    scope.statusReply.resolve(null);
    try {
      await scope.pr.observed;
      await scope.statusReply.observed;
    } catch (error) {
      errors.push(error);
    }
  }
  await setImmediate();
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, 'Controlled Git case/cleanup failures');
}
function makeScope(workspaceId: string, token: string, parent: AbortSignal) {
  const controller = new AbortController();
  const pr = controlledReply<PrRefreshResult | null>();
  const statusReply = controlledReply<Awaited<ReturnType<ScopedGitReadScope['reads']['status']>>>();
  let released = false;
  let heldStatus = false;
  let releaseError: unknown;
  const calls: Array<{ operation: string; args: unknown[] }> = [];
  const releases: string[] = [];
  function release() {
    if (released) return;
    released = true;
    controller.abort();
    releases.push(workspaceId);
    if (releaseError !== undefined) throw releaseError;
  }
  // Controlled port observes parent cancellation in isCurrent; actual prompt transport drainage is tested separately.
  const scope: ScopedGitReadScope = {
    identity: {},
    signal: controller.signal,
    isCurrent: () => !released && !parent.aborted,
    release,
    reads: {
      status: async (...args) => {
        calls.push({ operation: 'status', args });
        return heldStatus
          ? statusReply.promise
          : {
              branch: 'main',
              ahead: 0,
              behind: 0,
              diverged: false,
              files: [],
              hasUncommittedChanges: false,
              hasUntrackedFiles: false,
            };
      },
      trackedChanges: async (...args) => {
        calls.push({ operation: 'tracked', args });
        return [];
      },
      commitsWithBoundary: async (...args) => {
        calls.push({ operation: 'commits', args });
        return { commits: [], boundarySha: null, nextToken: null };
      },
    },
    preparePrRefresh: async () => {
      calls.push({ operation: 'prepare', args: [] });
      return {
        provenance: { physicalOwnerId: token },
        isCurrent: scopeCurrent,
        read: async (...args) => {
          calls.push({ operation: 'pr', args });
          return pr.promise;
        },
      };
    },
  };
  function scopeCurrent() {
    return scope.isCurrent();
  }
  return {
    ...scope,
    calls,
    releases,
    pr,
    statusReply,
    holdStatus: () => {
      heldStatus = true;
    },
    failRelease: (error: unknown) => {
      releaseError = error;
    },
  };
}
const scopedPrSuccess: PrRefreshResult = { outcome: 'linked', prNumber: 7, pullRequests: [] };
const gitActions = (actions: GenericAction[]) =>
  actions.filter(
    (a) =>
      a.type.startsWith('prStatus/') ||
      a.type.startsWith('changes/') ||
      a.type.startsWith('prBranchLookup/'),
  );

describe('canonical receiver scoped workers with explicitly controlled ports', () => {
  it.each([
    { elapsed: 59_999, read: false },
    { elapsed: 60_000, read: true },
  ])(
    'preserves the exact TTL boundary at $elapsed milliseconds after genuine prepare',
    async ({ elapsed, read }) =>
      withControlledGit(async (f) => {
        vi.spyOn(Date, 'now').mockReturnValue(100_000);
        store.dispatch(
          prStatusScopedRefreshSucceeded(WS, {
            principalContext: f.context(),
            physicalOwnerId: 'owner-A',
          }),
        );
        vi.mocked(Date.now).mockReturnValue(100_000 + elapsed);
        f.request();
        await setImmediate();
        expect(f.acquired).toEqual([WS]);
        expect(f.scopes[0].calls[0]).toEqual({ operation: 'prepare', args: [] });
        expect(f.scopes[0].calls.some((x) => x.operation === 'pr')).toBe(read);
        if (read) {
          f.scopes[0].pr.resolve(scopedPrSuccess);
          await setImmediate();
        } else {
          expect(gitActions(f.actions)).toEqual([]);
          expect(f.scopes[0].releases).toEqual([WS]);
        }
        expect(store.state.prStatus.byWorkspaceId[WS].lastRefreshTime).toBe(
          read ? 160_000 : 100_000,
        );
      }),
  );
  it.each([
    { force: true, manual: false },
    { force: true, manual: true },
    { force: false, manual: true },
  ])(
    'preserves force=$force and manual=$manual without changing automatic admission',
    async ({ force, manual }) =>
      withControlledGit(async (f) => {
        if (force)
          store.dispatch(
            prStatusScopedRefreshSucceeded(WS, {
              principalContext: f.context(),
              physicalOwnerId: 'owner-A',
            }),
          );
        if (force)
          f.ports.readMetadata = () => {
            throw new Error('Forced refresh must bypass metadata lookup');
          };
        f.request(force, manual);
        await setImmediate();
        expect(f.scopes[0].calls).toEqual([
          { operation: 'prepare', args: [] },
          { operation: 'pr', args: [{ automatic: !manual }] },
        ]);
        f.scopes[0].pr.resolve(scopedPrSuccess);
        await setImmediate();
        expect(
          f.actions.filter((a) => a.type === prStatusScopedRefreshSucceeded.type),
        ).toHaveLength(1);
        expect(f.actions.filter((a) => a.type === prStatusRefreshCompleted.type)).toEqual([]);
      }),
  );
  it('cannot inherit a same-clock legacy timestamp or a different physical/principal provenance', async () =>
    withControlledGit(async (f) => {
      vi.spyOn(Date, 'now').mockReturnValue(1000);
      store.dispatch(
        prStatusScopedRefreshSucceeded(WS, {
          principalContext: f.context(),
          physicalOwnerId: 'owner-A',
        }),
      );
      store.dispatch(prStatusRefreshCompleted(WS, true));
      f.request();
      await setImmediate();
      expect(f.scopes[0].calls.at(-1)?.operation).toBe('pr');
      f.scopes[0].pr.resolve(scopedPrSuccess);
      await setImmediate();
      for (const token of ['owner-B', 'owner-A-after-retirement']) {
        f.nextToken(token);
        f.request();
        await setImmediate();
        const scope = f.scopes.at(-1)!;
        expect(scope.calls.at(-1)?.operation).toBe('pr');
        scope.pr.resolve(scopedPrSuccess);
        await setImmediate();
        expect(store.state.prStatus.byWorkspaceId[WS].refreshProvenance?.physicalOwnerId).toBe(
          token,
        );
      }
      // Actual physical A->B->A non-revival is separately covered by the accepted main prerequisite.
      store.dispatch(
        prStatusScopedRefreshSucceeded(WS, {
          principalContext: 'other-principal',
          physicalOwnerId: 'owner-A-after-retirement',
        }),
      );
      f.request();
      await setImmediate();
      expect(f.scopes.at(-1)!.calls.at(-1)?.operation).toBe('pr');
      f.scopes.at(-1)!.pr.resolve(scopedPrSuccess);
      await setImmediate();
    }));
  it('does not turn acquisition refusal into command, metadata or hydration success even with fresh metadata', async () =>
    withControlledGit(async (f) => {
      store.dispatch(
        prStatusScopedRefreshSucceeded(WS, {
          principalContext: f.context(),
          physicalOwnerId: 'owner-A',
        }),
      );
      const before = store.state.prStatus;
      f.refuse(true);
      f.request();
      await setImmediate();
      expect(f.acquired).toEqual([WS]);
      expect(f.scopes).toEqual([]);
      expect(gitActions(f.actions)).toEqual([]);
      expect(store.state.prStatus).toBe(before);
    }));
  it('keeps the original parent through success publication and releases it exactly once afterward', async () =>
    withControlledGit(async (f) => {
      const observed: boolean[] = [];
      f.onPut((action) => {
        if (action.type === prStatusScopedRefreshSucceeded.type)
          observed.push(f.scopes[0].isCurrent());
      });
      f.request();
      await setImmediate();
      expect(f.scopes[0].releases).toEqual([]);
      f.scopes[0].pr.resolve(scopedPrSuccess);
      await setImmediate();
      expect(observed).toEqual([true]);
      expect(f.scopes[0].releases).toEqual([WS]);
      expect(store.state.prStatus.byWorkspaceId[WS].refreshProvenance).toEqual({
        principalContext: f.context(),
        physicalOwnerId: 'owner-A',
      });
    }));
  it.each(['prStatus/refreshStarted', 'prStatus/scopedRefreshSucceeded'])(
    'fences later PR publications when %s reenters retirement',
    async (type) =>
      withControlledGit(async (f) => {
        f.onPut((action) => {
          if (action.type === type) f.scopes[0].release();
        });
        f.request();
        await setImmediate();
        if (type.endsWith('Succeeded')) {
          f.scopes[0].pr.resolve(scopedPrSuccess);
          await setImmediate();
        }
        expect(f.actions.some((a) => a.type === 'prBranchLookup/succeeded')).toBe(false);
        if (type.endsWith('Started')) {
          expect(f.scopes[0].calls.some((x) => x.operation === 'pr')).toBe(false);
          expect(store.state.prStatus.byWorkspaceId[WS].lastRefreshTime).toBeNull();
        }
        expect(f.scopes[0].releases).toEqual([WS]);
      }),
  );
  it('rechecks physical ownership after the workspace selection before publishing PR branch linkage', async () =>
    withControlledGit(async (f) => {
      store.dispatch(
        setWorkspaceEntity({ ...workspace(), repositoryOwner: 'owner', repositoryName: 'repo' }),
      );
      f.onWorkspaceSelection(() => f.scopes[0].release());
      f.request();
      await setImmediate();
      f.scopes[0].pr.resolve(scopedPrSuccess);
      await setImmediate();
      expect(f.actions.filter((a) => a.type === prStatusScopedRefreshSucceeded.type)).toHaveLength(
        1,
      );
      expect(f.actions.some((a) => a.type.startsWith('prBranchLookup/'))).toBe(false);
    }));
  it('retires A-null-A irreversibly and refuses a held success before a new genuine demand', async () =>
    withControlledGit(async (f) => {
      f.request();
      await setImmediate();
      const snapshot = store.state.principal.snapshot;
      const connectionContext = getPrincipalConnectionContext(store.state);
      if (!snapshot || !connectionContext)
        throw new Error('Original canonical principal is required');
      store.dispatch(principalContextChanged(null));
      // A genuine canonical re-admission cannot unretire this older attempt.
      store.dispatch(principalContextChanged(connectionContext));
      store.dispatch(
        principalReceived(
          { context: connectionContext, invalidation: 0, presentationVersion: 0 },
          snapshot,
        ),
      );
      expect(f.ports.readCurrentContext(WS)).toBe(f.context());
      f.scopes[0].pr.resolve(scopedPrSuccess);
      await setImmediate();
      expect(f.scopes[0].releases).toEqual([WS]);
      expect(f.actions.filter((a) => a.type === prStatusScopedRefreshSucceeded.type)).toEqual([]);
      expect(f.acquired).toEqual([WS]);
    }));
  it('fences a held result against a direct current-state change even without selector delivery', async () =>
    withControlledGit(async (f) => {
      f.request();
      await setImmediate();
      f.ports.readCurrentContext = () => null;
      f.scopes[0].pr.resolve(scopedPrSuccess);
      await setImmediate();
      expect(f.actions.filter((a) => a.type === prStatusScopedRefreshSucceeded.type)).toEqual([]);
      expect(f.scopes[0].releases).toEqual([WS]);
    }));
  it.each(['changes/setChangesData', 'changes/setCommitsData', 'changes/setHasLoadedInitialData'])(
    'fences Changes publication after reentrancy at %s',
    async (type) =>
      withControlledGit(async (f) => {
        f.onPut((action) => {
          if (action.type === type) f.scopes[0].release();
        });
        store.dispatch(refreshRequested(WS));
        await setImmediate();
        expect(f.scopes[0].calls).toEqual([
          { operation: 'status', args: [WS] },
          { operation: 'tracked', args: [WS] },
          { operation: 'commits', args: [WS] },
        ]);
        const types = gitActions(f.actions).map((a) => a.type);
        const order = [
          'changes/setChangesData',
          'changes/setCommitsData',
          'changes/setHasLoadedInitialData',
        ];
        expect(types).toEqual(order.slice(0, order.indexOf(type) + 1));
        expect(f.scopes[0].releases).toEqual([WS]);
      }),
  );
  it('preserves includeOlder and never lets retired finally clear successor loading', async () =>
    withControlledGit(async (f) => {
      f.onPut((action) => {
        if (action.type === 'changes/appendOlderCommits') {
          f.scopes[0].release();
          store.dispatch(setLoadingOlderCommits(WS, true));
        }
      });
      store.dispatch(loadOlderCommitsRequested(WS, 'boundary'));
      await setImmediate();
      expect(f.scopes[0].calls).toEqual([{ operation: 'commits', args: [WS, true] }]);
      expect(
        f.actions.filter((a) => a.type === 'changes/setLoadingOlderCommits').map((a) => a.payload),
      ).toEqual([[WS, true]]);
      expect(store.state.changes.byWorkspaceId[WS].history.older.loading).toBe(true);
    }));

  it('acquires Changes scopes only after six real scheduler slots while PR remains unscheduled', async () =>
    withControlledGit(async (f) => {
      f.onAcquire((scope) => scope.holdStatus());
      const ids = Array.from({ length: 7 }, (_, index) => `slot-${index}`);
      for (const id of ids) store.dispatch(setWorkspaceEntity(workspace(id)));
      for (const id of ids) store.dispatch(refreshRequested(id));
      await setImmediate();
      expect(f.acquired).toEqual(ids.slice(0, 6));
      f.request();
      await setImmediate();
      expect(f.acquired).toEqual([...ids.slice(0, 6), WS]);
      f.scopes[6].pr.resolve(scopedPrSuccess);
      await setImmediate();
      expect(f.acquired).not.toContain(ids[6]);
      f.scopes[0].statusReply.resolve(null);
      await setImmediate();
      expect(f.acquired).toEqual([...ids.slice(0, 6), WS, ids[6]]);
      expect(f.scopes[0].releases).toEqual([ids[0]]);
    }));
  it('retains the original failure before an independent cleanup failure at the existing error owner', async () =>
    withControlledGit(async (f) => {
      const logged = vi.spyOn(ClientLogger.prototype, 'error');
      const original = new Error('original PR rejection');
      const cleanup = new Error('independent release failure');
      f.request();
      await setImmediate();
      f.scopes[0].failRelease(cleanup);
      f.scopes[0].pr.reject(original);
      await setImmediate();
      const failures = logged.mock.calls
        .map((call) => call[1])
        .filter((error): error is AggregateError => error instanceof AggregateError);
      expect(failures).toHaveLength(1);
      expect(failures[0].errors).toEqual([original, cleanup]);
      expect(store.state.prStatus.byWorkspaceId[WS].lastRefreshTime).toBeNull();
      expect(f.scopes[0].releases).toEqual([WS]);
    }));
  it.each([true, false])(
    'fences older loading=%s dispatch reentrancy and still releases its original scope',
    async (loading) =>
      withControlledGit(async (f) => {
        f.onPut((action) => {
          if (
            action.type === 'changes/setLoadingOlderCommits' &&
            Array.isArray(action.payload) &&
            action.payload[1] === loading
          ) {
            f.scopes[0].release();
            store.dispatch(setLoadingOlderCommits(WS, true));
          }
        });
        store.dispatch(loadOlderCommitsRequested(WS, 'boundary'));
        await setImmediate();
        expect(
          f.actions
            .filter((a) => a.type === 'changes/setLoadingOlderCommits')
            .map((a) => a.payload),
        ).toEqual(
          loading
            ? [[WS, true]]
            : [
                [WS, true],
                [WS, false],
              ],
        );
        expect(f.scopes[0].releases).toEqual([WS]);
        expect(store.state.changes.byWorkspaceId[WS].history.older.loading).toBe(true);
        if (loading) expect(f.scopes[0].calls).toEqual([]);
      }),
  );
  it('does not grant freshness for null or errors but retains the existing non-null skipped success policy', async () =>
    withControlledGit(async (f) => {
      f.request();
      await setImmediate();
      f.scopes[0].pr.resolve(null);
      await setImmediate();
      expect(store.state.prStatus.byWorkspaceId[WS].lastRefreshTime).toBeNull();
      expect(f.actions.filter((a) => a.type === prStatusScopedRefreshSucceeded.type)).toEqual([]);
      f.request();
      await setImmediate();
      f.scopes[1].pr.resolve({ outcome: 'skipped', pullRequests: [] });
      await setImmediate();
      expect(f.actions.filter((a) => a.type === prStatusScopedRefreshSucceeded.type)).toHaveLength(
        1,
      );
      expect(store.state.prStatus.byWorkspaceId[WS].refreshProvenance).toEqual({
        principalContext: f.context(),
        physicalOwnerId: 'owner-A',
      });
    }));
});
