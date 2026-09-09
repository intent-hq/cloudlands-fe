import { createCollection, getItem } from '@augmentcode/themis/utils/collections/collection-utils';
import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  workspaces: { list: vi.fn(), recentViews: vi.fn(), getTokenUsage: vi.fn(), getContext: vi.fn() },
  workspaceServiceList: vi.fn(),
  tasks: { list: vi.fn(), listAgentLinks: vi.fn() },
  events: { queryPage: vi.fn() },
  skills: { list: vi.fn() },
  scripts: { list: vi.fn() },
  git: {
    prRefresh: vi.fn(),
    status: vi.fn(),
    trackedChanges: vi.fn(),
    commitsWithBoundary: vi.fn(),
  },
  agents: { list: vi.fn(), listWithMeta: vi.fn() },
  terminals: { list: vi.fn() },
  getAgentLineStats: vi.fn(),
  isAgentDeletionPending: vi.fn(),
}));

vi.mock('$lib/client', () => ({
  appClient: {
    workspaces: mocks.workspaces,
    tasks: mocks.tasks,
    events: mocks.events,
    skills: mocks.skills,
    scripts: mocks.scripts,
    git: mocks.git,
    agents: mocks.agents,
    terminals: mocks.terminals,
  },
}));
vi.mock('../../workspace/utils/workspace.client', () => ({
  workspaceClient: { list: mocks.workspaceServiceList },
}));
vi.mock('$features/line-changes/line-changes.client', () => ({
  getAgentLineStats: mocks.getAgentLineStats,
}));
vi.mock('$features/agent/utils/pending-agent-deletions', () => ({
  isAgentDeletionPending: mocks.isAgentDeletionPending,
}));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

import { AgentStatus, GitFileStatus, type AgentSession } from '$shared/types';
import {
  loadOlderCommitsRequested,
  loadWorkspaceDataRequested,
  refreshRequested,
  requestAgentLineStats,
} from '../../changes/changes-slice';
import { initContextForWorkspace } from '../../context/context-slice';
import { refreshPRStatusRequested } from '../../pr-status/pr-status-slice';
import { refreshScripts } from '../../scripts/scripts-slice';
import { loadGitStatus } from '../../git/git-slice';
import { loadSkillsRequested } from '../../skills/skills-slice';
import { hydrateTaskAgentAssociationsRequested } from '../../task-agent-associations/task-agent-associations-slice';
import { hydrateTerminalsRequested } from '../../terminals/terminals-slice';
import { fetchWorkspaceTokenUsage } from '../../token-usage/token-usage-slice';
import {
  fetchRetiredAgentsRequested,
  hydrateAgentsRequested,
  setAgentsLoaded,
} from '../../workspace-agents/workspace-agents-slice';
import {
  loadEventsRequested,
  loadOlderEventsRequested,
} from '../../workspace-events/workspace-events-slice';
import {
  ensureWorkspaceTasksLoaded,
  loadWorkspaceTasksRequested,
} from '../../workspace-tasks/workspace-tasks-slice';
import {
  loadWorkspacesRequested,
  replaceWorkspaceList,
  workspaceReducer,
} from '../../workspace/workspace-slice';
import { consoleOwnerChanged } from '../../hardware-console/hardware-console-slice';
import { bulkUpsertSessions } from '../../agent-session/agent-session-slice';
import { selectAgentSessionsById } from '../../agent-session/agent-session-selectors';
import { store as appStore } from '../../../store';
import { workspaceDeleted, workspaceUnmounted } from '../workspace-lifecycle-slice';
import { gitReadSaga } from '../../git/sagas/git-read-saga';
import { lifecycleReadSaga } from './lifecycle-read-saga';
import { MAX_CONCURRENT_WORKSPACE_READS } from './workspace-read-scheduler';

const WS = 'ws-lifecycle';
const NOW = new Date('2026-07-31T00:00:00.000Z');

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function state(currentTabId: string | null = null, eventsNextToken: string | null = null) {
  return {
    tabState: { currentTabId },
    workspaceTasks: { byWorkspaceId: {} },
    changes: { agentStats: {}, agentLineStatsRequests: {} },
    workspace: { workspaces: createCollection('id', []) },
    agentSessions: { byAgentId: {} },
    workspaceAgents: { byWorkspaceId: {} },
    workspaceEvents: {
      byWorkspaceId: eventsNextToken ? { [WS]: { nextToken: eventsNextToken } } : {},
    },
    prStatus: { byWorkspaceId: {} },
  };
}

function start(current = state()) {
  const channel = stdChannel();
  const actions: unknown[] = [];
  const task = runSaga(
    { channel, dispatch: (action) => actions.push(action), getState: () => current },
    lifecycleReadSaga,
  );
  return { channel, actions, task };
}

async function stop(task: ReturnType<typeof runSaga>) {
  task.cancel();
  await task.toPromise();
}

function agent(id: string, overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id,
    workspaceId: WS,
    backendSessionId: `backend-${id}`,
    name: id,
    status: AgentStatus.Idle,
    messages: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as AgentSession;
}

describe('lifecycleReadSaga', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mocks.workspaceServiceList.mockResolvedValue({ ok: true, data: [] });
    mocks.workspaces.recentViews.mockResolvedValue({});
    mocks.workspaces.getTokenUsage.mockResolvedValue(null);
    mocks.workspaces.getContext.mockResolvedValue([]);
    mocks.tasks.list.mockResolvedValue({ tasks: [], stats: { total: 0 } });
    mocks.tasks.listAgentLinks.mockResolvedValue({});
    mocks.events.queryPage.mockResolvedValue({ items: [], nextToken: null });
    mocks.skills.list.mockResolvedValue([]);
    mocks.scripts.list.mockResolvedValue([]);
    mocks.git.prRefresh.mockResolvedValue({ outcome: 'unchanged', pullRequests: [] });
    mocks.git.status.mockResolvedValue({
      branch: 'main',
      ahead: 0,
      behind: 0,
      diverged: false,
      files: [],
      hasUncommittedChanges: false,
      hasUntrackedFiles: false,
    });
    mocks.git.trackedChanges.mockResolvedValue([]);
    mocks.git.commitsWithBoundary.mockResolvedValue({
      commits: [],
      boundarySha: null,
      nextToken: null,
    });
    mocks.agents.list.mockResolvedValue([]);
    mocks.agents.listWithMeta.mockResolvedValue({ agents: [], retiredCount: 0 });
    mocks.terminals.list.mockResolvedValue([]);
    mocks.getAgentLineStats.mockResolvedValue(null);
    mocks.isAgentDeletionPending.mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('loads the workspace list and recency in middleware order', async () => {
    const workspace = { id: WS, branch: 'main', wire_only: 'drop' };
    mocks.workspaceServiceList.mockResolvedValue({ ok: true, data: [workspace] });
    mocks.workspaces.recentViews.mockResolvedValue({ [WS]: 42 });
    const run = start();
    run.channel.put(loadWorkspacesRequested());
    await settle();

    expect(mocks.workspaceServiceList.mock.calls).toEqual([[{ lite: true }]]);
    expect(mocks.workspaces.recentViews.mock.calls).toEqual([[]]);
    expect(run.actions).toEqual([
      { type: 'workspace/replaceWorkspaceList', payload: [[workspace]] },
      { type: 'workspace/setWorkspaceHasLoaded', payload: [true, 'local'] },
      { type: 'workspace/loadRecencyData', payload: [{ lastViewedAt: { [WS]: 42 } }] },
    ]);
    await stop(run.task);
  });

  it('publishes a workspace-scoped skills failure when loading rejects', async () => {
    mocks.skills.list.mockRejectedValue(new Error('skill load failed'));
    const run = start();

    run.channel.put(loadSkillsRequested(WS));
    await settle();

    expect(run.actions).toContainEqual({
      type: 'skills/loadSkillsFailed',
      payload: [WS, 'skill load failed'],
    });
    await stop(run.task);
  });

  it('coalesces workspace-list loads arriving mid-fetch into one trailing refetch', async () => {
    const resolvers: ((value: { ok: true; data: unknown[] }) => void)[] = [];
    mocks.workspaceServiceList.mockImplementation(
      () =>
        new Promise<{ ok: true; data: unknown[] }>((done) => {
          resolvers.push(done);
        }),
    );
    const run = start();
    run.channel.put(loadWorkspacesRequested());
    await settle();
    expect(mocks.workspaceServiceList.mock.calls).toEqual([[{ lite: true }]]);

    // A burst of triggers while the first fetch is in flight (e.g. remote
    // workspace:created events) must collapse into exactly one trailing
    // refetch — takeLeading would drop them and the first snapshot could
    // predate the creates (PR #1740 review).
    run.channel.put(loadWorkspacesRequested());
    run.channel.put(loadWorkspacesRequested());
    await settle();
    expect(mocks.workspaceServiceList.mock.calls).toHaveLength(1);

    resolvers[0]!({ ok: true, data: [] });
    await settle();
    expect(mocks.workspaceServiceList.mock.calls).toHaveLength(2);

    resolvers[1]!({ ok: true, data: [] });
    await settle();
    expect(mocks.workspaceServiceList.mock.calls).toHaveLength(2);
    await stop(run.task);
  });

  describe('attention reconciliation on focus / console-owner acquisition', () => {
    const wireWorkspace = (attention: 'none' | 'unread') =>
      ({ id: WS, branch: 'main', attention }) as unknown as import('$shared/types').Workspace;

    // These triggers dispatch loadWorkspacesRequested from inside the saga, so
    // the harness must loop dispatched actions back into the channel (the
    // default start() only records them) and apply the real workspaceReducer
    // to observe store convergence.
    function startWithLoopback() {
      const channel = stdChannel();
      const actions: { type: string }[] = [];
      let workspaceState = workspaceReducer(undefined, { type: '@@INIT' });
      const dispatch = (action: { type: string }) => {
        actions.push(action);
        workspaceState = workspaceReducer(workspaceState, action);
        channel.put(action);
        return action;
      };
      const current = state();
      const task = runSaga(
        {
          channel,
          dispatch,
          getState: () => ({ ...current, workspace: workspaceState }),
        },
        lifecycleReadSaga,
      );
      return { channel, actions, task, dispatch, getWorkspaceState: () => workspaceState };
    }

    it('refetches the workspace list when the window regains focus and converges stale attention', async () => {
      const run = startWithLoopback();
      // Seed a stale snapshot: attention raised before the window lost focus,
      // then cleared daemon-side while this window missed the deltas.
      run.dispatch(replaceWorkspaceList([wireWorkspace('unread')]));
      expect(getItem(run.getWorkspaceState().workspaces, WS)?.attention).toBe('unread');

      mocks.workspaceServiceList.mockResolvedValue({ ok: true, data: [wireWorkspace('none')] });
      window.dispatchEvent(new Event('focus'));
      await settle();
      await settle();

      expect(mocks.workspaceServiceList.mock.calls).toEqual([[{ lite: true }]]);
      expect(getItem(run.getWorkspaceState().workspaces, WS)?.attention).toBe('none');
      await stop(run.task);
    });

    it('coalesces a focus burst into one in-flight fetch plus one trailing refetch', async () => {
      const resolvers: ((value: { ok: true; data: unknown[] }) => void)[] = [];
      mocks.workspaceServiceList.mockImplementation(
        () =>
          new Promise<{ ok: true; data: unknown[] }>((done) => {
            resolvers.push(done);
          }),
      );
      const run = startWithLoopback();
      window.dispatchEvent(new Event('focus'));
      await settle();
      expect(mocks.workspaceServiceList.mock.calls).toHaveLength(1);

      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('focus'));
      await settle();
      expect(mocks.workspaceServiceList.mock.calls).toHaveLength(1);

      resolvers[0]!({ ok: true, data: [] });
      await settle();
      expect(mocks.workspaceServiceList.mock.calls).toHaveLength(2);

      resolvers[1]!({ ok: true, data: [] });
      await settle();
      expect(mocks.workspaceServiceList.mock.calls).toHaveLength(2);
      await stop(run.task);
    });

    it('refetches on console-owner acquisition and converges stale attention', async () => {
      const run = startWithLoopback();
      run.dispatch(replaceWorkspaceList([wireWorkspace('none')]));

      mocks.workspaceServiceList.mockResolvedValue({ ok: true, data: [wireWorkspace('unread')] });
      run.channel.put(consoleOwnerChanged(true));
      await settle();
      await settle();

      expect(mocks.workspaceServiceList.mock.calls).toEqual([[{ lite: true }]]);
      expect(getItem(run.getWorkspaceState().workspaces, WS)?.attention).toBe('unread');
      await stop(run.task);
    });

    it('does not refetch when console ownership is lost', async () => {
      const run = startWithLoopback();
      run.channel.put(consoleOwnerChanged(false));
      await settle();
      await settle();
      expect(mocks.workspaceServiceList.mock.calls).toEqual([]);
      await stop(run.task);
    });
  });

  it('guards ensure-tasks and coalesces explicit loads per workspace', async () => {
    const current = state();
    current.workspaceTasks.byWorkspaceId[WS] = { loading: false, initialized: true };
    const run = start(current);
    run.channel.put(ensureWorkspaceTasksLoaded(WS));
    await settle();
    expect(mocks.tasks.list.mock.calls).toEqual([]);
    expect(run.actions).toEqual([]);

    let resolve!: (value: { tasks: unknown[]; stats: { total: number } }) => void;
    mocks.tasks.list.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    run.channel.put(loadWorkspaceTasksRequested(WS));
    run.channel.put(loadWorkspaceTasksRequested(WS));
    await settle();
    expect(mocks.tasks.list.mock.calls).toEqual([[WS]]);
    resolve({ tasks: [], stats: { total: 0 } });
    await settle();
    expect(mocks.tasks.list.mock.calls).toEqual([[WS], [WS]]);
    expect(run.actions).toEqual([
      { type: 'workspaceTasks/loadWorkspaceTasksSucceeded', payload: [WS, [], { total: 0 }] },
      { type: 'workspaceTasks/loadWorkspaceTasksSucceeded', payload: [WS, [], { total: 0 }] },
    ]);
    await settle();
    expect(mocks.tasks.list.mock.calls).toHaveLength(2);
    await stop(run.task);
  });

  it('does not cancel concurrent ensure-tasks loads across workspaces (#1934)', async () => {
    const OTHER = 'ws-lifecycle-other';
    const resolvers: Record<
      string,
      (value: { tasks: unknown[]; stats: { total: number } }) => void
    > = {};
    mocks.tasks.list.mockImplementation(
      (workspaceId: string) =>
        new Promise((done) => {
          resolvers[workspaceId] = done;
        }),
    );
    const run = start();
    run.channel.put(ensureWorkspaceTasksLoaded(WS));
    run.channel.put(ensureWorkspaceTasksLoaded(OTHER));
    await settle();
    expect(mocks.tasks.list.mock.calls).toEqual([[WS], [OTHER]]);
    resolvers[WS]({ tasks: [], stats: { total: 1 } });
    resolvers[OTHER]({ tasks: [], stats: { total: 2 } });
    await settle();
    expect(run.actions).toEqual([
      { type: 'workspaceTasks/loadWorkspaceTasksSucceeded', payload: [WS, [], { total: 1 }] },
      { type: 'workspaceTasks/loadWorkspaceTasksSucceeded', payload: [OTHER, [], { total: 2 }] },
    ]);
    await stop(run.task);
  });

  it('preserves queued force intent when ensure is the latest trailing task trigger', async () => {
    const current = state();
    current.workspaceTasks.byWorkspaceId[WS] = { loading: false, initialized: true };
    let resolve!: (value: { tasks: unknown[]; stats: { total: number } }) => void;
    mocks.tasks.list.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const run = start(current);

    run.channel.put(loadWorkspaceTasksRequested(WS));
    await settle();
    run.channel.put(loadWorkspaceTasksRequested(WS));
    run.channel.put(ensureWorkspaceTasksLoaded(WS));
    await settle();
    expect(mocks.tasks.list.mock.calls).toEqual([[WS]]);

    resolve({ tasks: [], stats: { total: 1 } });
    await settle();
    expect(mocks.tasks.list.mock.calls).toEqual([[WS], [WS]]);
    expect(run.actions).toEqual([
      { type: 'workspaceTasks/loadWorkspaceTasksSucceeded', payload: [WS, [], { total: 1 }] },
      { type: 'workspaceTasks/loadWorkspaceTasksSucceeded', payload: [WS, [], { total: 0 }] },
    ]);
    await stop(run.task);
  });

  it('keeps ensure-only task bursts guarded while coalescing one trailing check', async () => {
    const current = state();
    let resolve!: (value: { tasks: unknown[]; stats: { total: number } }) => void;
    mocks.tasks.list.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const run = start(current);

    run.channel.put(ensureWorkspaceTasksLoaded(WS));
    await settle();
    run.channel.put(ensureWorkspaceTasksLoaded(WS));
    run.channel.put(ensureWorkspaceTasksLoaded(WS));
    current.workspaceTasks.byWorkspaceId[WS] = { loading: false, initialized: true };
    resolve({ tasks: [], stats: { total: 1 } });
    await settle();

    expect(mocks.tasks.list.mock.calls).toEqual([[WS]]);
    expect(run.actions).toEqual([
      { type: 'workspaceTasks/loadWorkspaceTasksSucceeded', payload: [WS, [], { total: 1 }] },
    ]);
    await stop(run.task);
  });

  it('preserves queued force intent after an in-flight task failure', async () => {
    const current = state();
    current.workspaceTasks.byWorkspaceId[WS] = { loading: false, initialized: true };
    let reject!: (reason?: unknown) => void;
    mocks.tasks.list.mockReturnValueOnce(
      new Promise((_, fail) => {
        reject = fail;
      }),
    );
    const run = start(current);

    run.channel.put(loadWorkspaceTasksRequested(WS));
    await settle();
    run.channel.put(loadWorkspaceTasksRequested(WS));
    run.channel.put(ensureWorkspaceTasksLoaded(WS));
    reject(new Error('offline'));
    await settle();

    expect(mocks.tasks.list.mock.calls).toEqual([[WS], [WS]]);
    expect(run.actions).toEqual([
      { type: 'workspaceTasks/loadWorkspaceTasksSucceeded', payload: [WS, [], { total: 0 }] },
    ]);

    run.channel.put(ensureWorkspaceTasksLoaded(WS));
    await settle();
    expect(mocks.tasks.list.mock.calls).toHaveLength(2);
    await stop(run.task);
  });

  it('clears queued task force intent on workspace cleanup and reuses the key', async () => {
    const current = state();
    current.workspaceTasks.byWorkspaceId[WS] = { loading: false, initialized: true };
    let resolve!: (value: { tasks: unknown[]; stats: { total: number } }) => void;
    mocks.tasks.list.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const run = start(current);

    run.channel.put(loadWorkspaceTasksRequested(WS));
    await settle();
    run.channel.put(loadWorkspaceTasksRequested(WS));
    run.channel.put(ensureWorkspaceTasksLoaded(WS));
    run.channel.put(workspaceUnmounted(WS));
    await settle();
    resolve({ tasks: [], stats: { total: 1 } });
    await settle();

    run.channel.put(ensureWorkspaceTasksLoaded(WS));
    await settle();
    expect(mocks.tasks.list.mock.calls).toEqual([[WS]]);
    expect(run.actions).toEqual([]);

    run.channel.put(loadWorkspaceTasksRequested(WS));
    await settle();
    expect(mocks.tasks.list.mock.calls).toEqual([[WS], [WS]]);
    expect(run.actions).toEqual([
      { type: 'workspaceTasks/loadWorkspaceTasksSucceeded', payload: [WS, [], { total: 0 }] },
    ]);
    await stop(run.task);
  });

  it('keeps queued task force intent isolated across workspaces', async () => {
    const OTHER = 'ws-lifecycle-other';
    const current = state();
    current.workspaceTasks.byWorkspaceId[WS] = { loading: false, initialized: true };
    current.workspaceTasks.byWorkspaceId[OTHER] = { loading: false, initialized: true };
    const resolvers: Record<
      string,
      Array<(value: { tasks: unknown[]; stats: { total: number } }) => void>
    > = {};
    mocks.tasks.list.mockImplementation(
      (workspaceId: string) =>
        new Promise((done) => {
          (resolvers[workspaceId] ??= []).push(done);
        }),
    );
    const run = start(current);

    run.channel.put(loadWorkspaceTasksRequested(WS));
    run.channel.put(loadWorkspaceTasksRequested(OTHER));
    await settle();
    run.channel.put(loadWorkspaceTasksRequested(WS));
    run.channel.put(ensureWorkspaceTasksLoaded(WS));
    run.channel.put(ensureWorkspaceTasksLoaded(OTHER));
    resolvers[WS][0]({ tasks: [], stats: { total: 1 } });
    resolvers[OTHER][0]({ tasks: [], stats: { total: 2 } });
    await settle();

    expect(mocks.tasks.list.mock.calls).toEqual([[WS], [OTHER], [WS]]);
    resolvers[WS][1]({ tasks: [], stats: { total: 3 } });
    await settle();
    expect(run.actions).toEqual([
      { type: 'workspaceTasks/loadWorkspaceTasksSucceeded', payload: [WS, [], { total: 1 }] },
      { type: 'workspaceTasks/loadWorkspaceTasksSucceeded', payload: [OTHER, [], { total: 2 }] },
      { type: 'workspaceTasks/loadWorkspaceTasksSucceeded', payload: [WS, [], { total: 3 }] },
    ]);
    await stop(run.task);
  });

  it('does not cancel concurrent explicit task loads across workspaces (#1934)', async () => {
    const OTHER = 'ws-lifecycle-other';
    const resolvers: Record<
      string,
      (value: { tasks: unknown[]; stats: { total: number } }) => void
    > = {};
    mocks.tasks.list.mockImplementation(
      (workspaceId: string) =>
        new Promise((done) => {
          resolvers[workspaceId] = done;
        }),
    );
    const run = start();
    run.channel.put(loadWorkspaceTasksRequested(WS));
    run.channel.put(loadWorkspaceTasksRequested(OTHER));
    await settle();
    expect(mocks.tasks.list.mock.calls).toEqual([[WS], [OTHER]]);
    resolvers[WS]({ tasks: [], stats: { total: 1 } });
    resolvers[OTHER]({ tasks: [], stats: { total: 2 } });
    await settle();
    expect(run.actions).toEqual([
      { type: 'workspaceTasks/loadWorkspaceTasksSucceeded', payload: [WS, [], { total: 1 }] },
      { type: 'workspaceTasks/loadWorkspaceTasksSucceeded', payload: [OTHER, [], { total: 2 }] },
    ]);
    await stop(run.task);
  });

  it('reuses a completed task key and runs one trailing read for a new burst', async () => {
    const resolvers: Array<(value: { tasks: unknown[]; stats: { total: number } }) => void> = [];
    mocks.tasks.list.mockImplementation(
      () =>
        new Promise((done) => {
          resolvers.push(done);
        }),
    );
    const run = start();
    run.channel.put(loadWorkspaceTasksRequested(WS));
    await settle();
    resolvers[0]({ tasks: [], stats: { total: 1 } });
    await settle();

    run.channel.put(loadWorkspaceTasksRequested(WS));
    run.channel.put(loadWorkspaceTasksRequested(WS));
    await settle();
    expect(mocks.tasks.list.mock.calls).toEqual([[WS], [WS]]);
    resolvers[1]({ tasks: [], stats: { total: 2 } });
    await settle();
    expect(mocks.tasks.list.mock.calls).toEqual([[WS], [WS], [WS]]);
    resolvers[2]({ tasks: [], stats: { total: 3 } });
    await settle();
    expect(run.actions).toEqual([
      { type: 'workspaceTasks/loadWorkspaceTasksSucceeded', payload: [WS, [], { total: 1 }] },
      { type: 'workspaceTasks/loadWorkspaceTasksSucceeded', payload: [WS, [], { total: 2 }] },
      { type: 'workspaceTasks/loadWorkspaceTasksSucceeded', payload: [WS, [], { total: 3 }] },
    ]);
    await stop(run.task);
  });

  it('routes event, context, task-link, skill, script, and terminal reads exactly', async () => {
    const newestEvent = { id: 'event-2', type: 'agent:created', wire_only: true };
    const oldestEvent = { id: 'event-1', type: 'agent:created', wire_only: true };
    const item = { id: 'context-1', type: 'note', title: 'Context', provider: 'internal' };
    const links = { 'note-1': { 'agent:a': { agentId: 'a', taskKey: 'agent:a' } } };
    const skill = { name: 'review', description: 'Review code', wire_only: 'keep' };
    const script = { id: 'script-1', name: 'test', command: 'pnpm test', wire_only: 1 };
    const terminal = { id: 'terminal-1', workspaceId: WS, title: 'Shell', wire_only: 'keep' };
    mocks.events.queryPage.mockResolvedValue({
      items: [newestEvent, oldestEvent],
      nextToken: 'older-events',
    });
    mocks.workspaces.getContext.mockResolvedValue([item]);
    mocks.tasks.listAgentLinks.mockResolvedValue(links);
    mocks.skills.list.mockResolvedValue([skill]);
    mocks.scripts.list.mockResolvedValue([script]);
    mocks.terminals.list.mockResolvedValue([terminal]);
    const run = start();

    run.channel.put(loadEventsRequested(WS));
    await settle();
    run.channel.put(initContextForWorkspace(WS));
    await settle();
    run.channel.put(hydrateTaskAgentAssociationsRequested(WS));
    await settle();
    run.channel.put(loadSkillsRequested(WS));
    await settle();
    run.channel.put(refreshScripts(WS));
    await settle();
    run.channel.put(hydrateTerminalsRequested(WS));
    await settle();

    expect(mocks.events.queryPage.mock.calls).toEqual([[WS, { limit: 100 }]]);
    expect(run.actions).toEqual([
      { type: 'workspaceEvents/eventsLoadStarted', payload: [WS] },
      {
        type: 'workspaceEvents/eventsLoaded',
        payload: [WS, [oldestEvent, newestEvent], 'older-events'],
      },
      { type: 'context/hydrateContextItems', payload: [WS, [item]] },
      { type: 'taskAgentAssociations/hydrateTaskAgentAssociations', payload: [WS, links] },
      { type: 'skills/setSkills', payload: [WS, [skill]] },
      { type: 'scripts/setScriptsData', payload: { wsId: WS, scripts: [script] } },
      { type: 'scripts/setInitialized', payload: [WS, true] },
      { type: 'terminals/loadWorkspaceTerminals', payload: [WS, [terminal]] },
    ]);
    await stop(run.task);
  });

  it('loads the next older events page from the stored cursor', async () => {
    const newest = { id: 'event-2' };
    const oldest = { id: 'event-1' };
    mocks.events.queryPage.mockResolvedValue({ items: [newest, oldest], nextToken: null });
    const run = start(state(null, 'older-cursor'));

    run.channel.put(loadOlderEventsRequested(WS));
    await settle();

    expect(mocks.events.queryPage.mock.calls).toEqual([
      [WS, { limit: 100, nextToken: 'older-cursor' }],
    ]);
    expect(run.actions).toEqual([
      {
        type: 'workspaceEvents/olderEventsLoaded',
        payload: [WS, [oldest, newest], null],
      },
    ]);
    await stop(run.task);
  });

  it('marks older event history complete without querying when no cursor remains', async () => {
    const run = start();

    run.channel.put(loadOlderEventsRequested(WS));
    await settle();

    expect(mocks.events.queryPage).not.toHaveBeenCalled();
    expect(run.actions).toEqual([
      { type: 'workspaceEvents/olderEventsLoaded', payload: [WS, [], null] },
    ]);
    await stop(run.task);
  });

  it('serializes a fresh events load behind an in-flight older-page load', async () => {
    let resolveOlder!: (value: { items: unknown[]; nextToken: string | null }) => void;
    const olderPage = { items: [{ id: 'older' }], nextToken: null };
    const freshPage = { items: [{ id: 'fresh' }], nextToken: 'fresh-cursor' };
    mocks.events.queryPage
      .mockReturnValueOnce(new Promise((done) => (resolveOlder = done)))
      .mockResolvedValueOnce(freshPage);
    const run = start(state(null, 'older-cursor'));

    run.channel.put(loadOlderEventsRequested(WS));
    await settle();
    run.channel.put(loadEventsRequested(WS));
    await settle();
    expect(mocks.events.queryPage.mock.calls).toEqual([
      [WS, { limit: 100, nextToken: 'older-cursor' }],
    ]);

    resolveOlder(olderPage);
    await settle();

    expect(mocks.events.queryPage.mock.calls).toEqual([
      [WS, { limit: 100, nextToken: 'older-cursor' }],
      [WS, { limit: 100 }],
    ]);
    expect(run.actions).toEqual([
      { type: 'workspaceEvents/olderEventsLoaded', payload: [WS, [{ id: 'older' }], null] },
      { type: 'workspaceEvents/eventsLoadStarted', payload: [WS] },
      {
        type: 'workspaceEvents/eventsLoaded',
        payload: [WS, [{ id: 'fresh' }], 'fresh-cursor'],
      },
    ]);
    await stop(run.task);
  });

  it('runs a replaced initial load before the trailing older-page request', async () => {
    let resolveOlder!: (value: { items: unknown[]; nextToken: string | null }) => void;
    let resolveFresh!: (value: { items: unknown[]; nextToken: string | null }) => void;
    mocks.events.queryPage
      .mockReturnValueOnce(new Promise((done) => (resolveOlder = done)))
      .mockReturnValueOnce(new Promise((done) => (resolveFresh = done)))
      .mockResolvedValueOnce({ items: [{ id: 'fresh-older' }], nextToken: null });
    const current = state(null, 'older-cursor');
    const run = start(current);

    run.channel.put(loadOlderEventsRequested(WS));
    await settle();
    run.channel.put(loadEventsRequested(WS));
    run.channel.put(loadOlderEventsRequested(WS));
    await settle();
    expect(mocks.events.queryPage.mock.calls).toEqual([
      [WS, { limit: 100, nextToken: 'older-cursor' }],
    ]);

    resolveOlder({ items: [{ id: 'leading-older' }], nextToken: 'stale-cursor' });
    await settle();
    expect(mocks.events.queryPage.mock.calls).toEqual([
      [WS, { limit: 100, nextToken: 'older-cursor' }],
      [WS, { limit: 100 }],
    ]);

    const eventState = current.workspaceEvents.byWorkspaceId[WS];
    expect(eventState).toBeDefined();
    if (!eventState) throw new Error('Expected seeded workspace event state');
    eventState.nextToken = 'fresh-cursor';
    resolveFresh({ items: [{ id: 'fresh' }], nextToken: 'fresh-cursor' });
    await settle();

    expect(mocks.events.queryPage.mock.calls).toEqual([
      [WS, { limit: 100, nextToken: 'older-cursor' }],
      [WS, { limit: 100 }],
      [WS, { limit: 100, nextToken: 'fresh-cursor' }],
    ]);
    expect(run.actions).toEqual([
      {
        type: 'workspaceEvents/olderEventsLoaded',
        payload: [WS, [{ id: 'leading-older' }], 'stale-cursor'],
      },
      { type: 'workspaceEvents/eventsLoadStarted', payload: [WS] },
      {
        type: 'workspaceEvents/eventsLoaded',
        payload: [WS, [{ id: 'fresh' }], 'fresh-cursor'],
      },
      {
        type: 'workspaceEvents/olderEventsLoaded',
        payload: [WS, [{ id: 'fresh-older' }], null],
      },
    ]);
    await stop(run.task);
  });

  it('runs a trailing script refresh after an in-flight response can become stale', async () => {
    let resolveFirst!: (scripts: unknown[]) => void;
    const stale = [{ id: 'script-old' }];
    const fresh = [{ id: 'script-new' }];
    mocks.scripts.list
      .mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce(fresh);
    const run = start();

    run.channel.put(refreshScripts(WS));
    await settle();
    run.channel.put(refreshScripts(WS));
    await settle();
    expect(mocks.scripts.list.mock.calls).toEqual([[WS]]);

    resolveFirst(stale);
    await settle();

    expect(mocks.scripts.list.mock.calls).toEqual([[WS], [WS]]);
    expect(run.actions).toEqual([
      { type: 'scripts/setScriptsData', payload: { wsId: WS, scripts: stale } },
      { type: 'scripts/setInitialized', payload: [WS, true] },
      { type: 'scripts/setScriptsData', payload: { wsId: WS, scripts: fresh } },
      { type: 'scripts/setInitialized', payload: [WS, true] },
    ]);
    await stop(run.task);
  });

  it('coalesces a same-workspace script refresh burst into one trailing read', async () => {
    let resolveFirst!: (scripts: unknown[]) => void;
    mocks.scripts.list
      .mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce([]);
    const run = start();

    run.channel.put(refreshScripts(WS));
    await settle();
    run.channel.put(refreshScripts(WS));
    run.channel.put(refreshScripts(WS));
    run.channel.put(refreshScripts(WS));
    await settle();
    expect(mocks.scripts.list.mock.calls).toEqual([[WS]]);

    resolveFirst([]);
    await settle();

    expect(mocks.scripts.list.mock.calls).toEqual([[WS], [WS]]);
    await settle();
    expect(mocks.scripts.list).toHaveBeenCalledTimes(2);
    await stop(run.task);
  });

  it('keeps in-flight and trailing script refreshes isolated by workspace', async () => {
    const otherWorkspaceId = 'ws-scripts-other';
    const pending: Record<string, Array<(scripts: unknown[]) => void>> = {};
    mocks.scripts.list.mockImplementation(
      (workspaceId: string) =>
        new Promise((resolve) => {
          (pending[workspaceId] ??= []).push(resolve);
        }),
    );
    const run = start();

    run.channel.put(refreshScripts(WS));
    run.channel.put(refreshScripts(otherWorkspaceId));
    await settle();
    run.channel.put(refreshScripts(WS));
    run.channel.put(refreshScripts(WS));
    await settle();
    expect(mocks.scripts.list.mock.calls).toEqual([[WS], [otherWorkspaceId]]);

    pending[otherWorkspaceId][0]([{ id: 'other' }]);
    await settle();
    expect(mocks.scripts.list.mock.calls).toEqual([[WS], [otherWorkspaceId]]);

    pending[WS][0]([{ id: 'stale' }]);
    await settle();
    expect(mocks.scripts.list.mock.calls).toEqual([[WS], [otherWorkspaceId], [WS]]);
    pending[WS][1]([{ id: 'fresh' }]);
    await settle();
    expect(run.actions).toContainEqual({
      type: 'scripts/setScriptsData',
      payload: { wsId: WS, scripts: [{ id: 'fresh' }] },
    });
    await stop(run.task);
  });

  it.each([
    ['unmount', () => workspaceUnmounted(WS)],
    ['delete', () => workspaceDeleted(WS, [])],
  ])('cancels a script refresh and its trailing rerun on workspace %s', async (_name, cleanup) => {
    let resolveFirst!: (scripts: unknown[]) => void;
    mocks.scripts.list
      .mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce([]);
    const run = start();

    run.channel.put(refreshScripts(WS));
    await settle();
    run.channel.put(refreshScripts(WS));
    run.channel.put(cleanup());
    await settle();
    resolveFirst([{ id: 'late' }]);
    await settle();

    expect(mocks.scripts.list.mock.calls).toEqual([[WS]]);
    expect(run.actions).toEqual([]);

    run.channel.put(refreshScripts(WS));
    await settle();
    expect(mocks.scripts.list.mock.calls).toEqual([[WS], [WS]]);
    await stop(run.task);
  });

  it('marks token usage stale for null and thrown reads', async () => {
    const run = start();
    run.channel.put(fetchWorkspaceTokenUsage(WS));
    await settle();
    mocks.workspaces.getTokenUsage.mockRejectedValueOnce(new Error('offline'));
    run.channel.put(fetchWorkspaceTokenUsage(WS));
    await settle();

    expect(run.actions).toEqual([
      { type: 'tokenUsage/tokenUsageFetchFailed', payload: [WS] },
      { type: 'tokenUsage/tokenUsageFetchFailed', payload: [WS] },
    ]);
    await stop(run.task);
  });

  it('stores the exact token-usage protocol payload', async () => {
    const usage = {
      byAgentId: {
        a: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 4 },
      },
      totals: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 4 },
      byModel: {
        opus: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 4 },
      },
      lastScanAt: '2026-07-30T00:00:00.000Z',
      wire_only: 'preserved',
    };
    mocks.workspaces.getTokenUsage.mockResolvedValue(usage);
    const run = start();
    run.channel.put(fetchWorkspaceTokenUsage(WS));
    await settle();
    expect(run.actions).toEqual([{ type: 'tokenUsage/tokenUsageReceived', payload: [WS, usage] }]);
    await stop(run.task);
  });

  it('scopes leading workspace reads and reuses completed workspace slots', async () => {
    const otherWorkspaceId = 'ws-other';
    const resolvers: Record<string, Array<(value: null) => void>> = {};
    mocks.workspaces.getTokenUsage.mockImplementation(
      (workspaceId: string) =>
        new Promise<null>((resolve) => {
          (resolvers[workspaceId] ??= []).push(resolve);
        }),
    );
    const run = start();

    run.channel.put(fetchWorkspaceTokenUsage(WS));
    run.channel.put(fetchWorkspaceTokenUsage(WS));
    run.channel.put(fetchWorkspaceTokenUsage(otherWorkspaceId));
    await settle();

    expect(mocks.workspaces.getTokenUsage.mock.calls).toEqual([[WS], [otherWorkspaceId]]);
    resolvers[WS][0](null);
    resolvers[otherWorkspaceId][0](null);
    await settle();

    run.channel.put(fetchWorkspaceTokenUsage(WS));
    await settle();
    expect(mocks.workspaces.getTokenUsage.mock.calls).toEqual([[WS], [otherWorkspaceId], [WS]]);
    resolvers[WS][1](null);
    await settle();
    await stop(run.task);
  });

  it('hydrates context once and releases the guard on unmount', async () => {
    const run = start();
    run.channel.put(initContextForWorkspace(WS));
    await settle();
    run.channel.put(initContextForWorkspace(WS));
    await settle();
    run.channel.put(workspaceUnmounted(WS));
    run.channel.put(initContextForWorkspace(WS));
    await settle();

    expect(mocks.workspaces.getContext.mock.calls).toEqual([[WS], [WS]]);
    expect(run.actions).toEqual([
      { type: 'context/hydrateContextItems', payload: [WS, []] },
      { type: 'context/hydrateContextItems', payload: [WS, []] },
    ]);
    await stop(run.task);
  });

  it('forces context hydration after the workspace was initialized', async () => {
    const run = start();
    run.channel.put(initContextForWorkspace(WS));
    await settle();
    run.channel.put(initContextForWorkspace(WS, true));
    await settle();

    expect(mocks.workspaces.getContext.mock.calls).toEqual([[WS], [WS]]);
    expect(run.actions).toEqual([
      { type: 'context/hydrateContextItems', payload: [WS, []] },
      { type: 'context/hydrateContextItems', payload: [WS, []] },
    ]);
    await stop(run.task);
  });

  it('replaces an in-flight context read with a fresh hydration generation', async () => {
    const stale = [{ id: 'stale', type: 'note', title: 'Stale', provider: 'internal' }];
    const fresh = [{ id: 'fresh', type: 'note', title: 'Fresh', provider: 'internal' }];
    let resolveStale!: (items: typeof stale) => void;
    let resolveFresh!: (items: typeof fresh) => void;
    mocks.workspaces.getContext
      .mockReturnValueOnce(new Promise((resolve) => (resolveStale = resolve)))
      .mockReturnValueOnce(new Promise((resolve) => (resolveFresh = resolve)));
    const run = start();

    run.channel.put(initContextForWorkspace(WS, false, 1));
    await settle();
    run.channel.put(initContextForWorkspace(WS, true, 2));
    await settle();

    expect(mocks.workspaces.getContext.mock.calls).toEqual([[WS], [WS]]);
    resolveFresh(fresh);
    await settle();
    resolveStale(stale);
    await settle();

    expect(run.actions).toEqual([{ type: 'context/hydrateContextItems', payload: [WS, fresh] }]);
    await stop(run.task);
  });

  it('replaces an in-flight context read when forced without a generation', async () => {
    const stale = [{ id: 'stale', type: 'note', title: 'Stale', provider: 'internal' }];
    const fresh = [{ id: 'fresh', type: 'note', title: 'Fresh', provider: 'internal' }];
    let resolveStale!: (items: typeof stale) => void;
    let resolveFresh!: (items: typeof fresh) => void;
    mocks.workspaces.getContext
      .mockReturnValueOnce(new Promise((resolve) => (resolveStale = resolve)))
      .mockReturnValueOnce(new Promise((resolve) => (resolveFresh = resolve)));
    const run = start();

    run.channel.put(initContextForWorkspace(WS));
    await settle();
    run.channel.put(initContextForWorkspace(WS, true));
    await settle();

    expect(mocks.workspaces.getContext.mock.calls).toEqual([[WS], [WS]]);
    resolveFresh(fresh);
    await settle();
    resolveStale(stale);
    await settle();

    expect(run.actions).toEqual([{ type: 'context/hydrateContextItems', payload: [WS, fresh] }]);
    await stop(run.task);
  });

  it('reports PR refresh success and maps only the branch lookup payload', async () => {
    const current = state();
    current.workspace.workspaces = createCollection('id', [
      {
        id: WS,
        branch: 'feature',
        repositoryOwner: 'acme',
        repositoryName: 'repo',
      },
    ]);
    mocks.git.prRefresh.mockResolvedValue({ prNumber: 7, outcome: 'linked', wire_only: 'drop' });
    const run = start(current);
    run.channel.put(refreshPRStatusRequested(WS, true, true));
    await settle();

    expect(mocks.git.prRefresh.mock.calls).toEqual([[WS]]);
    expect(run.actions).toEqual([
      { type: 'prStatus/refreshStarted', payload: [WS] },
      {
        type: 'prStatus/refreshCompleted',
        payload: { wsId: WS, success: true, error: undefined, timestamp: NOW.getTime() },
      },
      { type: 'prBranchLookup/succeeded', payload: { key: 'acme/repo#7', branch: 'feature' } },
    ]);
    await stop(run.task);
  });

  it('reports both folded-null and thrown PR failures without extra actions', async () => {
    const run = start();
    mocks.git.prRefresh.mockResolvedValueOnce(null);
    run.channel.put(refreshPRStatusRequested(WS, false, false));
    await settle();
    mocks.git.prRefresh.mockRejectedValueOnce(new Error('refresh failed'));
    run.channel.put(refreshPRStatusRequested(WS, false, false));
    await settle();

    expect(run.actions).toEqual([
      { type: 'prStatus/refreshStarted', payload: [WS] },
      {
        type: 'prStatus/refreshCompleted',
        payload: { wsId: WS, success: false, error: 'pr.refresh failed', timestamp: NOW.getTime() },
      },
      { type: 'prStatus/refreshStarted', payload: [WS] },
      {
        type: 'prStatus/refreshCompleted',
        payload: { wsId: WS, success: false, error: 'refresh failed', timestamp: NOW.getTime() },
      },
    ]);
    await stop(run.task);
  });

  it('skips a non-forced PR refresh within the freshness TTL', async () => {
    const current = state();
    current.prStatus.byWorkspaceId[WS] = {
      lastRefreshTime: NOW.getTime() - 59_000,
      isRefreshing: false,
      lastError: null,
    };
    const run = start(current);
    run.channel.put(refreshPRStatusRequested(WS, false, false));
    await settle();

    expect(mocks.git.prRefresh.mock.calls).toEqual([]);
    expect(run.actions).toEqual([]);
    await stop(run.task);
  });

  it('runs a non-forced PR refresh once the freshness TTL has expired', async () => {
    const current = state();
    current.prStatus.byWorkspaceId[WS] = {
      lastRefreshTime: NOW.getTime() - 60_000,
      isRefreshing: false,
      lastError: null,
    };
    const run = start(current);
    run.channel.put(refreshPRStatusRequested(WS, false, false));
    await settle();

    expect(mocks.git.prRefresh.mock.calls).toEqual([[WS]]);
    expect(run.actions).toEqual([
      { type: 'prStatus/refreshStarted', payload: [WS] },
      {
        type: 'prStatus/refreshCompleted',
        payload: { wsId: WS, success: true, error: undefined, timestamp: NOW.getTime() },
      },
    ]);
    await stop(run.task);
  });

  it('runs a forced PR refresh even within the freshness TTL', async () => {
    const current = state();
    current.prStatus.byWorkspaceId[WS] = {
      lastRefreshTime: NOW.getTime() - 1_000,
      isRefreshing: false,
      lastError: null,
    };
    const run = start(current);
    run.channel.put(refreshPRStatusRequested(WS, true, false));
    await settle();

    expect(mocks.git.prRefresh.mock.calls).toEqual([[WS]]);
    expect(run.actions).toEqual([
      { type: 'prStatus/refreshStarted', payload: [WS] },
      {
        type: 'prStatus/refreshCompleted',
        payload: { wsId: WS, success: true, error: undefined, timestamp: NOW.getTime() },
      },
    ]);
    await stop(run.task);
  });

  it('reconciles both changes triggers with parallel reads and keeps partial failure atomic', async () => {
    const change = {
      id: 'change-1',
      file: '/repo/src/a.ts',
      relativePath: 'src/a.ts',
      stage: 'unstaged',
      status: 'modified',
      stats: { additions: 4, deletions: 1 },
      attribution: { manual: true, timestamp: 1_750_000_000_000 },
    };
    const stale = {
      ...change,
      id: 'change-stale',
      file: '/repo/src/stale.ts',
      relativePath: 'src/stale.ts',
    };
    const commit = { hash: 'abc', message: 'change', wire_only: true };
    mocks.git.status.mockResolvedValue({
      branch: 'main',
      ahead: 0,
      behind: 0,
      diverged: false,
      files: [
        { path: 'src/a.ts', status: GitFileStatus.Modified, staged: false },
        { path: 'src/index-only.ts', status: GitFileStatus.Added, staged: true },
      ],
      hasUncommittedChanges: true,
      hasUntrackedFiles: false,
    });
    mocks.git.trackedChanges.mockResolvedValue([change, stale]);
    mocks.git.commitsWithBoundary.mockResolvedValue({
      commits: [commit],
      boundarySha: 'abc',
      nextToken: 'wire-token',
    });
    const run = start();
    run.channel.put(refreshRequested(WS));
    await settle();
    run.channel.put(loadWorkspaceDataRequested(WS));
    await settle();
    mocks.git.trackedChanges.mockRejectedValueOnce(new Error('changes failed'));
    run.channel.put(refreshRequested(WS));
    await settle();

    expect(mocks.git.status.mock.calls).toEqual([[WS], [WS], [WS]]);
    expect(mocks.git.trackedChanges.mock.calls).toEqual([[WS], [WS], [WS]]);
    expect(mocks.git.commitsWithBoundary.mock.calls).toEqual([[WS], [WS], [WS]]);
    const reconciled = [
      change,
      expect.objectContaining({
        relativePath: 'src/index-only.ts',
        stage: 'staged',
        status: 'added',
        stats: { additions: 0, deletions: 0 },
      }),
    ];
    expect(run.actions).toEqual([
      {
        type: 'changes/setChangesData',
        payload: { wsId: WS, changes: reconciled, truncated: false, totalCount: 2 },
      },
      {
        type: 'changes/setCommitsData',
        payload: { wsId: WS, commits: [commit], boundarySha: 'abc' },
      },
      { type: 'changes/setHasLoadedInitialData', payload: [WS, true] },
      {
        type: 'changes/setChangesData',
        payload: { wsId: WS, changes: reconciled, truncated: false, totalCount: 2 },
      },
      {
        type: 'changes/setCommitsData',
        payload: { wsId: WS, commits: [commit], boundarySha: 'abc' },
      },
      { type: 'changes/setHasLoadedInitialData', payload: [WS, true] },
    ]);
    await stop(run.task);
  });

  it('feeds both owners from a combined refresh while the live client coalesces their status read', async () => {
    const run = start();
    const gitTask = runSaga(
      { channel: run.channel, dispatch: (action) => run.actions.push(action) },
      gitReadSaga,
    );

    run.channel.put(loadGitStatus(WS, true));
    run.channel.put(refreshRequested(WS, true));
    await settle();

    expect(run.actions.filter((action: any) => action.type === 'git/setStatus')).toHaveLength(1);
    expect(
      run.actions.filter((action: any) => action.type === 'changes/setChangesData'),
    ).toHaveLength(1);
    await stop(gitTask);
    await stop(run.task);
  });

  it('accepts an empty tracked-change result but preserves state on a folded read failure', async () => {
    mocks.git.status.mockResolvedValue({
      branch: 'main',
      ahead: 0,
      behind: 0,
      diverged: false,
      files: [{ path: 'src/status-only.ts', status: GitFileStatus.Modified, staged: false }],
      hasUncommittedChanges: true,
      hasUntrackedFiles: false,
    });
    mocks.git.trackedChanges.mockResolvedValueOnce([]).mockResolvedValueOnce(null);
    const run = start();

    run.channel.put(refreshRequested(WS));
    await settle();
    run.channel.put(refreshRequested(WS));
    await settle();

    expect(mocks.git.status).toHaveBeenCalledTimes(2);
    expect(mocks.git.trackedChanges).toHaveBeenCalledTimes(2);
    expect(run.actions).toEqual([
      {
        type: 'changes/setChangesData',
        payload: {
          wsId: WS,
          changes: [
            expect.objectContaining({
              relativePath: 'src/status-only.ts',
              stats: { additions: 0, deletions: 0 },
              attribution: { manual: true, timestamp: 0 },
            }),
          ],
          truncated: false,
          totalCount: 1,
        },
      },
      { type: 'changes/setCommitsData', payload: { wsId: WS, commits: [], boundarySha: null } },
      { type: 'changes/setHasLoadedInitialData', payload: [WS, true] },
    ]);
    await stop(run.task);
  });

  it('keeps changes refreshes for different workspaces concurrent', async () => {
    let resolveStatus!: (value: Awaited<ReturnType<typeof mocks.git.status>>) => void;
    mocks.git.status.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveStatus = resolve;
      }),
    );
    const run = start();
    const otherWorkspaceId = 'ws-other';

    run.channel.put(refreshRequested(WS));
    await settle();
    run.channel.put(refreshRequested(otherWorkspaceId));
    await settle();

    expect(mocks.git.status).toHaveBeenCalledTimes(2);
    expect(mocks.git.trackedChanges).toHaveBeenCalledTimes(2);
    expect(mocks.git.commitsWithBoundary).toHaveBeenCalledTimes(2);

    resolveStatus({
      branch: 'main',
      ahead: 0,
      behind: 0,
      diverged: false,
      files: [],
      hasUncommittedChanges: false,
      hasUntrackedFiles: false,
    });
    await settle();

    expect(mocks.git.status).toHaveBeenCalledTimes(2);
    expect(run.actions).toContainEqual({
      type: 'changes/setHasLoadedInitialData',
      payload: [otherWorkspaceId, true],
    });
    expect(run.actions).toContainEqual({
      type: 'changes/setHasLoadedInitialData',
      payload: [WS, true],
    });
    await stop(run.task);
  });

  it('cancels a matching unmounted workspace changes refresh without affecting another workspace', async () => {
    const resolves = new Map<
      string,
      (value: Awaited<ReturnType<typeof mocks.git.status>>) => void
    >();
    mocks.git.status.mockImplementation(
      (workspaceId) =>
        new Promise((resolve) => {
          resolves.set(workspaceId, resolve);
        }),
    );
    const run = start();
    const otherWorkspaceId = 'ws-other';

    run.channel.put(refreshRequested(WS));
    run.channel.put(refreshRequested(otherWorkspaceId));
    await settle();
    run.channel.put(workspaceUnmounted(WS));
    resolves.get(otherWorkspaceId)!({
      branch: 'main',
      ahead: 0,
      behind: 0,
      diverged: false,
      files: [],
      hasUncommittedChanges: false,
      hasUntrackedFiles: false,
    });
    await settle();

    expect(mocks.git.status).toHaveBeenCalledTimes(2);
    expect(
      run.actions
        .filter((action: any) => action.type === 'changes/setChangesData')
        .map((action: any) => action.payload.wsId),
    ).toEqual([otherWorkspaceId]);
    await stop(run.task);
  });

  it('coalesces a same-workspace changes burst into one non-concurrent trailing refresh', async () => {
    let resolveStatus!: (value: Awaited<ReturnType<typeof mocks.git.status>>) => void;
    mocks.git.status.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveStatus = resolve;
      }),
    );
    const run = start();

    run.channel.put(refreshRequested(WS));
    await settle();
    run.channel.put(loadWorkspaceDataRequested(WS));
    run.channel.put(refreshRequested(WS));
    run.channel.put(loadWorkspaceDataRequested(WS));
    await settle();

    expect(mocks.git.status.mock.calls).toEqual([[WS]]);
    expect(mocks.git.trackedChanges.mock.calls).toEqual([[WS]]);
    expect(mocks.git.commitsWithBoundary.mock.calls).toEqual([[WS]]);

    resolveStatus({
      branch: 'main',
      ahead: 0,
      behind: 0,
      diverged: false,
      files: [],
      hasUncommittedChanges: false,
      hasUntrackedFiles: false,
    });
    await settle();

    expect(mocks.git.status.mock.calls).toEqual([[WS], [WS]]);
    expect(mocks.git.trackedChanges.mock.calls).toEqual([[WS], [WS]]);
    expect(mocks.git.commitsWithBoundary.mock.calls).toEqual([[WS], [WS]]);
    await settle();
    expect(mocks.git.status).toHaveBeenCalledTimes(2);
    await stop(run.task);
  });

  it('loads older commits and always clears loading on failure and cancellation', async () => {
    const commit = { hash: 'old', message: 'old', wire_only: true };
    mocks.git.commitsWithBoundary.mockResolvedValueOnce({
      commits: [commit],
      boundarySha: null,
      nextToken: null,
    });
    const run = start();
    run.channel.put(loadOlderCommitsRequested(WS, 'boundary', 25));
    await settle();
    mocks.git.commitsWithBoundary.mockRejectedValueOnce(new Error('older failed'));
    run.channel.put(loadOlderCommitsRequested(WS, 'boundary', 25));
    await settle();

    let pending!: () => void;
    mocks.git.commitsWithBoundary.mockReturnValueOnce(
      new Promise((resolve) => {
        pending = () => resolve({ commits: [], boundarySha: null, nextToken: null });
      }),
    );
    run.channel.put(loadOlderCommitsRequested(WS, 'boundary', 25));
    await settle();
    run.channel.put(workspaceUnmounted(WS));
    await settle();
    pending();

    expect(run.actions).toEqual([
      { type: 'changes/setLoadingOlderCommits', payload: [WS, true] },
      { type: 'changes/appendOlderCommits', payload: [WS, [commit]] },
      { type: 'changes/setLoadingOlderCommits', payload: [WS, false] },
      { type: 'changes/setLoadingOlderCommits', payload: [WS, true] },
      { type: 'changes/setLoadingOlderCommits', payload: [WS, false] },
      { type: 'changes/setLoadingOlderCommits', payload: [WS, true] },
      { type: 'changes/setLoadingOlderCommits', payload: [WS, false] },
    ]);
    await stop(run.task);
  });

  it('covers agent line-stat success, cache no-op, force, and failure', async () => {
    const current = state();
    mocks.getAgentLineStats.mockResolvedValueOnce({ additions: 8, deletions: 3, filesChanged: 2 });
    const run = start(current);
    run.channel.put(requestAgentLineStats('agent-1'));
    await settle();
    current.changes.agentStats['agent-1'] = {
      additions: 8,
      deletions: 3,
      timestamp: NOW.toISOString(),
    };
    run.channel.put(requestAgentLineStats('agent-1'));
    await settle();
    mocks.getAgentLineStats.mockRejectedValueOnce(new Error('metrics failed'));
    run.channel.put(requestAgentLineStats('agent-1', true));
    await settle();

    expect(mocks.getAgentLineStats.mock.calls).toEqual([['agent-1'], ['agent-1']]);
    expect(run.actions).toEqual([
      {
        type: 'changes/agentLineStatsRequestStarted',
        payload: { agentId: 'agent-1', requestedAt: NOW.toISOString() },
      },
      {
        type: 'changes/updateAgentStats',
        payload: {
          agentId: 'agent-1',
          stats: { additions: 8, deletions: 3, timestamp: NOW.toISOString() },
        },
      },
      {
        type: 'changes/agentLineStatsRequestSucceeded',
        payload: { agentId: 'agent-1', finishedAt: NOW.toISOString() },
      },
      {
        type: 'changes/agentLineStatsRequestStarted',
        payload: { agentId: 'agent-1', requestedAt: NOW.toISOString() },
      },
      {
        type: 'changes/agentLineStatsRequestFailed',
        payload: { agentId: 'agent-1', error: 'metrics failed', finishedAt: NOW.toISOString() },
      },
    ]);
    await stop(run.task);
  });

  it('scopes leading line-stat reads by agent and reuses completed agent slots', async () => {
    const resolvers: Record<string, Array<(value: null) => void>> = {};
    mocks.getAgentLineStats.mockImplementation(
      (agentId: string) =>
        new Promise<null>((resolve) => {
          (resolvers[agentId] ??= []).push(resolve);
        }),
    );
    const run = start();

    run.channel.put(requestAgentLineStats('agent-1'));
    run.channel.put(requestAgentLineStats('agent-1'));
    run.channel.put(requestAgentLineStats('agent-2'));
    await settle();

    expect(mocks.getAgentLineStats.mock.calls).toEqual([['agent-1'], ['agent-2']]);
    resolvers['agent-1'][0](null);
    resolvers['agent-2'][0](null);
    await settle();

    run.channel.put(requestAgentLineStats('agent-1'));
    await settle();
    expect(mocks.getAgentLineStats.mock.calls).toEqual([['agent-1'], ['agent-2'], ['agent-1']]);
    resolvers['agent-1'][1](null);
    await settle();
    await stop(run.task);
  });

  it('hydrates agents, preserves transcripts, filters pending deletion, and selects foreground', async () => {
    const existing = agent('agent-keep', {
      messages: [{ id: 'm1', role: 'user', timestamp: NOW.toISOString() }] as never,
    });
    const current = state();
    current.agentSessions.byAgentId['agent-keep'] = existing;
    mocks.isAgentDeletionPending.mockImplementation((id: string) => id === 'agent-drop');
    mocks.agents.listWithMeta.mockResolvedValue({
      agents: [
        agent('agent-drop'),
        agent('agent-daemon-pending', { pendingDeleteAt: '2026-08-11T00:00:15.000Z' }),
        agent('agent-bg', { isBackground: true }),
        agent('agent-keep'),
      ],
      retiredCount: 0,
    });
    const run = start(current);
    run.channel.put(hydrateAgentsRequested(WS));
    await settle();

    const kept = agent('agent-keep', { messages: existing.messages });
    const background = agent('agent-bg', { isBackground: true });
    expect(run.actions).toEqual([
      { type: 'workspaceAgents/setAgentsLoaded', payload: [WS, true] },
      { type: 'workspaceAgents/setRetiredCount', payload: [WS, 0] },
      { type: 'workspaceAgents/setAgents', payload: [WS, [background, kept]] },
      { type: 'agentSessions/bulkUpsertSessions', payload: [[background, kept]] },
      { type: 'workspaceAgents/setActiveAgentId', payload: [WS, 'agent-keep'] },
    ]);
    await stop(run.task);
  });

  it('clears a crash-leftover in-flight pair when the list snapshot reports the agent idle (monorepo#4135)', async () => {
    const current = state();
    current.agentSessions.byAgentId['agent-stale'] = agent('agent-stale', {
      isStreaming: true,
      isProcessing: true,
    });
    // The fresh daemon rows: agent-stale is idle (crash leftover — no event
    // will ever clear the stored pair), agent-normal has no stored session.
    const staleRow = agent('agent-stale');
    const normalRow = agent('agent-normal');
    mocks.agents.listWithMeta.mockResolvedValue({
      agents: [staleRow, normalRow],
      retiredCount: 0,
    });
    const run = start(current);

    run.channel.put(hydrateAgentsRequested(WS));
    await settle();

    // One batch carries per-agent stale-clear IDs so the snapshot's idle flags
    // win for the crash leftover while normal rows retain pair-guard semantics.
    const bulkUpserts = run.actions.filter(
      (action) => action.type === 'agentSessions/bulkUpsertSessions',
    );
    expect(bulkUpserts).toEqual([
      {
        type: 'agentSessions/bulkUpsertSessions',
        payload: [[staleRow, normalRow], { staleRuntimeFlagClearAgentIds: ['agent-stale'] }],
      },
    ]);
    await stop(run.task);
  });

  it('notifies the real agent-session selector once for a mixed N-agent hydration', async () => {
    const dispose = appStore.init();
    const stopSaga = appStore.runSaga(lifecycleReadSaga);
    appStore.dispatch(
      bulkUpsertSessions([
        agent('agent-stale', { isStreaming: true, isProcessing: true }),
        agent('agent-existing', { messages: [{ id: 'local' }] as never }),
      ]),
    );
    const emissions: Array<Readonly<Record<string, AgentSession>>> = [];
    let lastSelected: Readonly<Record<string, AgentSession>> | undefined;
    const unsubscribe = appStore.getReadableState().subscribe((state) => {
      const selected = selectAgentSessionsById.select(state);
      if (selected !== lastSelected) {
        emissions.push(selected);
        lastSelected = selected;
      }
    });
    mocks.agents.listWithMeta.mockResolvedValue({
      agents: [
        agent('agent-stale', { isStreaming: false, isProcessing: false }),
        agent('agent-existing'),
        agent('agent-new'),
      ],
      retiredCount: 0,
    });

    try {
      appStore.dispatch(hydrateAgentsRequested(WS));
      await settle();

      expect(Object.keys(appStore.state.agentSessions.byAgentId)).toEqual([
        'agent-stale',
        'agent-existing',
        'agent-new',
      ]);
      expect(appStore.state.agentSessions.byAgentId['agent-existing'].messages).toEqual([
        { id: 'local' },
      ]);
      expect(appStore.state.agentSessions.byAgentId['agent-stale']).toMatchObject({
        isStreaming: false,
        isProcessing: false,
      });
      expect(emissions).toHaveLength(2);
    } finally {
      unsubscribe();
      stopSaga();
      dispose();
    }
  });

  it('does not clear a pair set while the list fetch was in flight, even if the row reports idle', async () => {
    // Race regression (PR #2028 review): chatSendStarted lands the both-true
    // pair AFTER hydration starts but BEFORE the daemon list resolves. The
    // daemon snapshot was cut before the turn started, so the row reports
    // idle — but the pair does not predate the fetch, so it must keep the
    // default #1250 preservation semantics, not be treated as a crash
    // leftover.
    const current = state();
    const raceRow = agent('agent-race');
    mocks.agents.listWithMeta.mockImplementation(async () => {
      current.agentSessions.byAgentId['agent-race'] = agent('agent-race', {
        isStreaming: true,
        isProcessing: true,
      });
      return { agents: [raceRow], retiredCount: 0 };
    });
    const run = start(current);

    run.channel.put(hydrateAgentsRequested(WS));
    await settle();

    const bulkUpserts = run.actions.filter(
      (action) => action.type === 'agentSessions/bulkUpsertSessions',
    );
    expect(bulkUpserts).toEqual([
      { type: 'agentSessions/bulkUpsertSessions', payload: [[raceRow]] },
    ]);
    await stop(run.task);
  });

  it('keeps the pair-guard for a live in-flight pair the fresh snapshot still reports busy', async () => {
    const current = state();
    current.agentSessions.byAgentId['agent-live'] = agent('agent-live', {
      isStreaming: true,
      isProcessing: true,
    });
    const liveRow = agent('agent-live', { isStreaming: true });
    mocks.agents.listWithMeta.mockResolvedValue({ agents: [liveRow], retiredCount: 0 });
    const run = start(current);

    run.channel.put(hydrateAgentsRequested(WS));
    await settle();

    // The daemon reports the turn in flight, so the single optionless bulk
    // upsert keeps the default preservation semantics (monorepo#1250).
    const bulkUpserts = run.actions.filter(
      (action) => action.type === 'agentSessions/bulkUpsertSessions',
    );
    expect(bulkUpserts).toEqual([
      { type: 'agentSessions/bulkUpsertSessions', payload: [[liveRow]] },
    ]);
    await stop(run.task);
  });

  // The two tests below stub the seam (appClient.agents.listWithMeta), not the
  // wire. On an 8.2+ daemon the default read excludes retired rows, but the saga
  // must stay agnostic to row provenance: retired rows re-enter state via the
  // retiredOnly read (lazy retired bin), and the auto-select guard has to hold
  // no matter how a retired row reached the snapshot.
  it('keeps retired agents in state but never auto-selects them (§5.5 soft retire)', async () => {
    const retired = agent('agent-retired', { retiredAt: '2026-08-10T00:00:00.000Z' });
    const active = agent('agent-live');
    mocks.agents.listWithMeta.mockResolvedValue({ agents: [retired, active], retiredCount: 1 });
    const run = start();

    run.channel.put(hydrateAgentsRequested(WS));
    await settle();

    expect(mocks.agents.listWithMeta).toHaveBeenCalledWith(WS);
    expect(run.actions).toContainEqual({
      type: 'workspaceAgents/setRetiredCount',
      payload: [WS, 1],
    });
    expect(run.actions).toContainEqual({
      type: 'workspaceAgents/setAgents',
      payload: [WS, [retired, active]],
    });
    expect(run.actions).toContainEqual({
      type: 'workspaceAgents/setActiveAgentId',
      payload: [WS, 'agent-live'],
    });
    await stop(run.task);
  });

  it('does not auto-select any agent when every candidate is retired', async () => {
    mocks.agents.listWithMeta.mockResolvedValue({
      agents: [agent('agent-retired', { retiredAt: '2026-08-10T00:00:00.000Z' })],
      retiredCount: 1,
    });
    const run = start();

    run.channel.put(hydrateAgentsRequested(WS));
    await settle();

    expect(
      run.actions.find((action) => action.type === 'workspaceAgents/setActiveAgentId'),
    ).toBeUndefined();
    await stop(run.task);
  });

  it('converges to an authoritative empty daemon agent snapshot', async () => {
    mocks.agents.listWithMeta.mockResolvedValue({ agents: [], retiredCount: 0 });
    const run = start();

    run.channel.put(hydrateAgentsRequested(WS));
    await settle();

    expect(run.actions).toEqual([
      { type: 'workspaceAgents/setAgentsLoaded', payload: [WS, true] },
      { type: 'workspaceAgents/setRetiredCount', payload: [WS, 0] },
      { type: 'workspaceAgents/setAgents', payload: [WS, []] },
    ]);
    await stop(run.task);
  });

  it('rehydrates retired rows alongside the default read once they were lazily loaded', async () => {
    const retired = agent('agent-retired', { retiredAt: '2026-08-10T00:00:00.000Z' });
    const active = agent('agent-live');
    const current = state();
    current.workspaceAgents.byWorkspaceId = {
      [WS]: { retiredAgentsLoaded: true, isLoadingRetiredAgents: false },
    } as never;
    mocks.agents.listWithMeta.mockResolvedValue({ agents: [active], retiredCount: 1 });
    mocks.agents.list.mockResolvedValue([retired]);
    const run = start(current);

    run.channel.put(hydrateAgentsRequested(WS));
    await settle();

    expect(mocks.agents.list).toHaveBeenCalledWith(WS, { retiredOnly: true });
    expect(run.actions).toContainEqual({
      type: 'workspaceAgents/setAgents',
      payload: [WS, [active, retired]],
    });
    await stop(run.task);
  });

  it('lazy-loads retired rows on demand and re-baselines the count (§5.5 v8.2)', async () => {
    const retired = agent('agent-retired', { retiredAt: '2026-08-10T00:00:00.000Z' });
    mocks.agents.list.mockResolvedValue([retired]);
    const run = start();

    run.channel.put(fetchRetiredAgentsRequested(WS));
    await settle();

    expect(mocks.agents.list.mock.calls).toEqual([[WS, { retiredOnly: true }]]);
    expect(run.actions).toEqual([
      { type: 'workspaceAgents/setIsLoadingRetiredAgents', payload: [WS, true] },
      { type: 'agentSessions/bulkUpsertSessions', payload: [[retired]] },
      { type: 'workspaceAgents/addAgent', payload: [WS, retired] },
      { type: 'workspaceAgents/setRetiredCount', payload: [WS, 1] },
      { type: 'workspaceAgents/setRetiredAgentsLoaded', payload: [WS, true] },
      { type: 'workspaceAgents/setIsLoadingRetiredAgents', payload: [WS, false] },
    ]);
    await stop(run.task);
  });

  it('skips the retired load when the rows are already hydrated', async () => {
    const current = state();
    current.workspaceAgents.byWorkspaceId = {
      [WS]: { retiredAgentsLoaded: true, isLoadingRetiredAgents: false },
    } as never;
    const run = start(current);

    run.channel.put(fetchRetiredAgentsRequested(WS));
    await settle();

    expect(mocks.agents.list).not.toHaveBeenCalled();
    expect(run.actions).toEqual([]);
    await stop(run.task);
  });

  it('clears the retired loading flag and stays retryable after a failed load', async () => {
    mocks.agents.list.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([]);
    const run = start();

    run.channel.put(fetchRetiredAgentsRequested(WS));
    await settle();

    expect(run.actions).toEqual([
      { type: 'workspaceAgents/setIsLoadingRetiredAgents', payload: [WS, true] },
      { type: 'workspaceAgents/setIsLoadingRetiredAgents', payload: [WS, false] },
    ]);

    run.channel.put(fetchRetiredAgentsRequested(WS));
    await settle();
    expect(mocks.agents.list.mock.calls).toEqual([
      [WS, { retiredOnly: true }],
      [WS, { retiredOnly: true }],
    ]);
    expect(run.actions).toContainEqual({
      type: 'workspaceAgents/setRetiredAgentsLoaded',
      payload: [WS, true],
    });
    await stop(run.task);
  });

  it('dedupes an agent retired between the default and retired-only reads (prefers the fresher retired row)', async () => {
    const active = agent('agent-live');
    // Retired between the two round trips: the default read still returns the
    // stale non-retired row, the retired-only read returns the fresh one.
    const staleBoth = agent('agent-both');
    const freshBoth = agent('agent-both', { retiredAt: '2026-08-10T00:00:00.000Z' });
    const current = state();
    current.workspaceAgents.byWorkspaceId = {
      [WS]: { retiredAgentsLoaded: true, isLoadingRetiredAgents: false },
    } as never;
    mocks.agents.listWithMeta.mockResolvedValue({ agents: [active, staleBoth], retiredCount: 1 });
    mocks.agents.list.mockResolvedValue([freshBoth]);
    const run = start(current);

    run.channel.put(hydrateAgentsRequested(WS));
    await settle();

    expect(run.actions).toContainEqual({
      type: 'workspaceAgents/setAgents',
      payload: [WS, [active, freshBoth]],
    });
    await stop(run.task);
  });

  it('re-arms the lazy retired load when it completes mid-hydration (snapshot eviction guard)', async () => {
    // Force a real await inside the loaded-check → setAgents span so the
    // lazy-load completion can interleave (defense for the no-await invariant).
    let resolvePending!: (value: boolean) => void;
    mocks.isAgentDeletionPending.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        resolvePending = resolve;
      }) as never,
    );
    const active = agent('agent-live');
    const current = state();
    mocks.agents.listWithMeta.mockResolvedValue({ agents: [active], retiredCount: 1 });
    const run = start(current);

    run.channel.put(hydrateAgentsRequested(WS));
    await settle();

    // The lazy retired worker finishes while hydration is parked: rows added,
    // loaded flag now true — the hydration snapshot below would evict them.
    current.workspaceAgents.byWorkspaceId = {
      [WS]: { retiredAgentsLoaded: true, isLoadingRetiredAgents: false },
    } as never;
    resolvePending(false);
    await settle();

    const types = run.actions.map((action) => action.type);
    const setAgentsIndex = types.indexOf('workspaceAgents/setAgents');
    expect(setAgentsIndex).toBeGreaterThanOrEqual(0);
    // The mismatch resets the loaded flag and re-requests the retired rows so
    // the worker re-adds what the snapshot evicted.
    expect(run.actions.slice(setAgentsIndex)).toContainEqual({
      type: 'workspaceAgents/setRetiredAgentsLoaded',
      payload: [WS, false],
    });
    expect(run.actions).toContainEqual({
      type: 'workspaceAgents/fetchRetiredAgentsRequested',
      payload: [WS],
    });
    await stop(run.task);
  });

  it('preserves in-store transcripts on the lazy retired load (empty list rows never clobber)', async () => {
    const existing = agent('agent-retired', {
      retiredAt: '2026-08-10T00:00:00.000Z',
      messages: [{ id: 'm1', role: 'user', timestamp: NOW.toISOString() }] as never,
    });
    const current = state();
    current.agentSessions.byAgentId['agent-retired'] = existing;
    // List rows carry message counts, not transcripts — the wire row is empty.
    mocks.agents.list.mockResolvedValue([
      agent('agent-retired', { retiredAt: '2026-08-10T00:00:00.000Z' }),
    ]);
    const run = start(current);

    run.channel.put(fetchRetiredAgentsRequested(WS));
    await settle();

    const preserved = agent('agent-retired', {
      retiredAt: '2026-08-10T00:00:00.000Z',
      messages: existing.messages,
    });
    expect(run.actions).toContainEqual({
      type: 'workspaceAgents/addAgent',
      payload: [WS, preserved],
    });
    expect(run.actions).toContainEqual({
      type: 'agentSessions/bulkUpsertSessions',
      payload: [[preserved]],
    });
    await stop(run.task);
  });

  it('single-flights concurrent lazy retired loads (one daemon read per workspace)', async () => {
    let resolveList!: (value: AgentSession[]) => void;
    mocks.agents.list.mockReturnValueOnce(
      new Promise<AgentSession[]>((resolve) => {
        resolveList = resolve;
      }),
    );
    const run = start();

    run.channel.put(fetchRetiredAgentsRequested(WS));
    await settle();
    run.channel.put(fetchRetiredAgentsRequested(WS));
    run.channel.put(fetchRetiredAgentsRequested(WS));
    await settle();

    // takeLeading: re-triggers while the first read is parked are dropped.
    expect(mocks.agents.list.mock.calls).toEqual([[WS, { retiredOnly: true }]]);
    resolveList([]);
    await settle();

    expect(mocks.agents.list.mock.calls).toEqual([[WS, { retiredOnly: true }]]);
    expect(
      run.actions.filter(
        (action) =>
          action.type === 'workspaceAgents/setIsLoadingRetiredAgents' &&
          (action as { payload: [string, boolean] }).payload[1] === true,
      ),
    ).toHaveLength(1);
    await stop(run.task);
  });

  it('does not cancel concurrent agent hydrates across workspaces (#1934)', async () => {
    const otherWorkspaceId = 'ws-other';
    type ListWithMeta = { agents: AgentSession[]; retiredCount: number };
    const resolvers: Record<string, (value: ListWithMeta) => void> = {};
    mocks.agents.listWithMeta.mockImplementation(
      (workspaceId: string) =>
        new Promise<ListWithMeta>((resolve) => {
          resolvers[workspaceId] = resolve;
        }),
    );
    const run = start();

    run.channel.put(hydrateAgentsRequested(WS));
    await settle();
    run.channel.put(hydrateAgentsRequested(otherWorkspaceId));
    await settle();

    expect(mocks.agents.listWithMeta.mock.calls).toEqual([[WS], [otherWorkspaceId]]);

    resolvers[WS]!({ agents: [], retiredCount: 0 });
    resolvers[otherWorkspaceId]!({ agents: [], retiredCount: 0 });
    await settle();

    expect(run.actions).toContainEqual(setAgentsLoaded(WS, true));
    expect(run.actions).toContainEqual(setAgentsLoaded(otherWorkspaceId, true));
    await stop(run.task);
  });

  it('coalesces a newer same-workspace agent hydrate into one trailing rerun', async () => {
    type ListWithMeta = { agents: AgentSession[]; retiredCount: number };
    let resolveFirst!: (value: ListWithMeta) => void;
    mocks.agents.listWithMeta
      .mockReturnValueOnce(
        new Promise<ListWithMeta>((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockResolvedValueOnce({ agents: [], retiredCount: 0 });
    const run = start();

    run.channel.put(hydrateAgentsRequested(WS));
    await settle();
    run.channel.put(hydrateAgentsRequested(WS));
    await settle();

    expect(mocks.agents.listWithMeta.mock.calls).toEqual([[WS]]);
    resolveFirst({ agents: [], retiredCount: 0 });
    await settle();

    expect(mocks.agents.listWithMeta.mock.calls).toEqual([[WS], [WS]]);
    expect(run.actions.filter((action) => action.type === setAgentsLoaded.type)).toHaveLength(2);
    await stop(run.task);
  });

  it('runs one trailing agent hydrate after an in-flight failure', async () => {
    let rejectFirst!: (reason?: unknown) => void;
    mocks.agents.listWithMeta
      .mockReturnValueOnce(
        new Promise((_, reject) => {
          rejectFirst = reject;
        }),
      )
      .mockResolvedValueOnce({ agents: [], retiredCount: 0 });
    const run = start();

    run.channel.put(hydrateAgentsRequested(WS));
    await settle();
    run.channel.put(hydrateAgentsRequested(WS));
    run.channel.put(hydrateAgentsRequested(WS));
    await settle();
    expect(mocks.agents.listWithMeta.mock.calls).toEqual([[WS]]);

    rejectFirst(new Error('offline'));
    await settle();

    expect(mocks.agents.listWithMeta.mock.calls).toEqual([[WS], [WS]]);
    expect(run.actions).toEqual([
      setAgentsLoaded(WS, true),
      { type: 'workspaceAgents/setRetiredCount', payload: [WS, 0] },
      { type: 'workspaceAgents/setAgents', payload: [WS, []] },
    ]);
    await stop(run.task);
  });

  it('workspace cleanup cancels an agent hydrate and discards its trailing rerun', async () => {
    type ListWithMeta = { agents: AgentSession[]; retiredCount: number };
    let resolveFirst!: (value: ListWithMeta) => void;
    mocks.agents.listWithMeta
      .mockReturnValueOnce(
        new Promise<ListWithMeta>((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockResolvedValueOnce({ agents: [], retiredCount: 0 });
    const run = start();

    run.channel.put(hydrateAgentsRequested(WS));
    await settle();
    run.channel.put(hydrateAgentsRequested(WS));
    run.channel.put(hydrateAgentsRequested(WS));
    run.channel.put(workspaceUnmounted(WS));
    await settle();
    resolveFirst({ agents: [agent('agent-late')], retiredCount: 0 });
    await settle();

    expect(mocks.agents.listWithMeta.mock.calls).toEqual([[WS]]);
    expect(run.actions).toEqual([]);

    run.channel.put(hydrateAgentsRequested(WS));
    await settle();
    expect(mocks.agents.listWithMeta.mock.calls).toEqual([[WS], [WS]]);
    expect(run.actions).toEqual([
      setAgentsLoaded(WS, true),
      { type: 'workspaceAgents/setRetiredCount', payload: [WS, 0] },
      { type: 'workspaceAgents/setAgents', payload: [WS, []] },
    ]);
    await stop(run.task);
  });

  it('does not cancel workspace reads on deletion before tab removal', async () => {
    let resolve!: (value: { items: unknown[]; nextToken: string | null }) => void;
    mocks.events.queryPage.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const run = start();
    run.channel.put(loadEventsRequested(WS));
    await settle();
    run.channel.put(workspaceDeleted(WS, []));
    await settle();
    resolve({ items: [{ id: 'late' }], nextToken: null });
    await settle();

    expect(mocks.events.queryPage.mock.calls).toEqual([[WS, { limit: 100 }]]);
    expect(run.actions).toEqual([
      { type: 'workspaceEvents/eventsLoadStarted', payload: [WS] },
      { type: 'workspaceEvents/eventsLoaded', payload: [WS, [{ id: 'late' }], null] },
    ]);
    await stop(run.task);
  });

  it('drops a late older-events page after workspace unmount', async () => {
    let resolve!: (value: { items: unknown[]; nextToken: string | null }) => void;
    mocks.events.queryPage.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const run = start(state(null, 'older-cursor'));

    run.channel.put(loadOlderEventsRequested(WS));
    await settle();
    run.channel.put(workspaceUnmounted(WS));
    await settle();
    resolve({ items: [{ id: 'too-late' }], nextToken: null });
    await settle();

    expect(mocks.events.queryPage.mock.calls).toEqual([
      [WS, { limit: 100, nextToken: 'older-cursor' }],
    ]);
    expect(run.actions).toEqual([]);
    await stop(run.task);
  });

  describe('bounded read fan-out', () => {
    const FAN_OUT = 130;

    /** `tasks.list` calls that are parked until the test resolves them. */
    function parkTaskReads() {
      const pending: Array<{ workspaceId: string; resolve: () => void }> = [];
      mocks.tasks.list.mockImplementation(
        (workspaceId: string) =>
          new Promise<{ tasks: unknown[]; stats: { total: number } }>((done) => {
            pending.push({
              workspaceId,
              resolve: () => done({ tasks: [], stats: { total: 0 } }),
            });
          }),
      );
      return pending;
    }

    const issuedFor = (pending: Array<{ workspaceId: string }>) =>
      pending.map((entry) => entry.workspaceId);

    it('caps concurrent reads when every workspace refreshes in one tick', async () => {
      const pending = parkTaskReads();
      const run = start();

      for (let i = 0; i < FAN_OUT; i += 1) run.channel.put(loadWorkspaceTasksRequested(`ws-${i}`));
      await settle();

      // Without the scheduler this was one read per registered workspace.
      expect(pending).toHaveLength(MAX_CONCURRENT_WORKSPACE_READS);

      // A finished read admits exactly one queued read, in dispatch order.
      pending[0].resolve();
      await settle();
      expect(pending).toHaveLength(MAX_CONCURRENT_WORKSPACE_READS + 1);
      expect(pending[MAX_CONCURRENT_WORKSPACE_READS].workspaceId).toBe(
        `ws-${MAX_CONCURRENT_WORKSPACE_READS}`,
      );

      for (const entry of pending) entry.resolve();
      await settle();
      await stop(run.task);
    });

    it('drains the whole queue without exceeding the cap', async () => {
      const pending = parkTaskReads();
      const run = start();

      for (let i = 0; i < FAN_OUT; i += 1) run.channel.put(loadWorkspaceTasksRequested(`ws-${i}`));

      let resolved = 0;
      while (resolved < FAN_OUT) {
        await settle();
        expect(pending.length - resolved).toBeLessThanOrEqual(MAX_CONCURRENT_WORKSPACE_READS);
        pending[resolved].resolve();
        resolved += 1;
      }
      await settle();

      expect(issuedFor(pending)).toHaveLength(FAN_OUT);
      expect(new Set(issuedFor(pending)).size).toBe(FAN_OUT);
      await stop(run.task);
    });

    it('refreshes a newly active workspace ahead of the queued backlog', async () => {
      const HOT = 'ws-hot';
      const pending = parkTaskReads();
      const run = start(state(HOT));

      for (let i = 0; i < FAN_OUT; i += 1) run.channel.put(loadWorkspaceTasksRequested(`ws-${i}`));
      await settle();
      expect(issuedFor(pending)).not.toContain(HOT);

      // The workspace the user just opened queues ahead of the backlog.
      run.channel.put(loadWorkspaceTasksRequested(HOT));
      await settle();
      expect(issuedFor(pending)).not.toContain(HOT);

      pending[0].resolve();
      await settle();
      expect(pending[MAX_CONCURRENT_WORKSPACE_READS].workspaceId).toBe(HOT);

      for (const entry of pending) entry.resolve();
      await settle();
      await stop(run.task);
    });

    // Regression: the active workspace used to be captured once at saga start
    // (and prod passed none at all), so a workspace focused later — e.g. an
    // archived workspace opened via cmd+k — hydrated as a background read and
    // starved behind the backlog, leaving the chat area stuck loading.
    it('hydrates agents ahead of the backlog for a workspace focused after boot', async () => {
      const HOT = 'ws-archived';
      const pendingTasks = parkTaskReads();
      const agentReads: string[] = [];
      mocks.agents.listWithMeta.mockImplementation((workspaceId: string) => {
        agentReads.push(workspaceId);
        return Promise.resolve({ agents: [], retiredCount: 0 });
      });
      const current = state();
      const run = start(current);

      for (let i = 0; i < FAN_OUT; i += 1) run.channel.put(loadWorkspaceTasksRequested(`ws-${i}`));
      await settle();

      // Focus moves to this workspace only now, long after the saga started.
      current.tabState.currentTabId = HOT;
      run.channel.put(hydrateAgentsRequested(HOT));
      await settle();
      expect(agentReads).toEqual([]);

      pendingTasks[0].resolve();
      await settle();
      // The focused workspace's agents read runs next, ahead of the queued
      // background task reads.
      expect(agentReads).toEqual([HOT]);

      for (const entry of pendingTasks) entry.resolve();
      await settle();
      await stop(run.task);
    });

    // Cleanup ownership is split: coalesced domains (tasks) are cancelled by
    // their context watcher, non-coalesced ones (events) by the cleanup race in
    // runWorkspaceRead. Both must hand the slot back.
    it('keeps a coalesced read slot until deletion is followed by tab removal', async () => {
      const pending = parkTaskReads();
      const run = start();

      for (let i = 0; i < MAX_CONCURRENT_WORKSPACE_READS; i += 1) {
        run.channel.put(loadWorkspaceTasksRequested(`ws-${i}`));
      }
      run.channel.put(loadWorkspaceTasksRequested('ws-queued'));
      await settle();
      expect(pending).toHaveLength(MAX_CONCURRENT_WORKSPACE_READS);

      run.channel.put(workspaceDeleted('ws-0', []));
      await settle();
      expect(pending).toHaveLength(MAX_CONCURRENT_WORKSPACE_READS);

      run.channel.put(workspaceUnmounted('ws-0'));
      await settle();

      expect(pending[MAX_CONCURRENT_WORKSPACE_READS].workspaceId).toBe('ws-queued');
      for (const entry of pending) entry.resolve();
      await settle();
      await stop(run.task);
    });

    it('frees the slot held by a raced read cancelled by workspace unmount', async () => {
      const pending: Array<{ workspaceId: string; resolve: () => void }> = [];
      mocks.events.queryPage.mockImplementation(
        (workspaceId: string) =>
          new Promise<{ items: unknown[]; nextToken: null }>((done) => {
            pending.push({ workspaceId, resolve: () => done({ items: [], nextToken: null }) });
          }),
      );
      const run = start();

      for (let i = 0; i < MAX_CONCURRENT_WORKSPACE_READS; i += 1) {
        run.channel.put(loadEventsRequested(`ws-${i}`));
      }
      run.channel.put(loadEventsRequested('ws-queued'));
      await settle();
      expect(pending).toHaveLength(MAX_CONCURRENT_WORKSPACE_READS);

      run.channel.put(workspaceUnmounted('ws-0'));
      await settle();

      expect(pending[MAX_CONCURRENT_WORKSPACE_READS].workspaceId).toBe('ws-queued');
      for (const entry of pending) entry.resolve();
      await settle();
      await stop(run.task);
    });
  });

  it('ignores malformed trigger payloads', async () => {
    const run = start();
    run.channel.put({ type: loadEventsRequested.type, payload: [] });
    await settle();
    expect(mocks.events.queryPage.mock.calls).toEqual([]);
    expect(run.actions).toEqual([]);
    await stop(run.task);
  });
});
