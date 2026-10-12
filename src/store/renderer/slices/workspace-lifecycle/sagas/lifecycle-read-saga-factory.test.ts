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
