import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  workspaces: { list: vi.fn(), recentViews: vi.fn(), getTokenUsage: vi.fn(), getContext: vi.fn() },
  tasks: { list: vi.fn(), listAgentLinks: vi.fn() },
  events: { list: vi.fn() },
  skills: { list: vi.fn() },
  scripts: { list: vi.fn() },
  git: { prRefresh: vi.fn(), status: vi.fn(), trackedChanges: vi.fn(), commitsWithBoundary: vi.fn() },
  agents: { list: vi.fn() },
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
import { loadSkillsRequested } from '../../skills/skills-slice';
import { hydrateTaskAgentAssociationsRequested } from '../../task-agent-associations/task-agent-associations-slice';
import { hydrateTerminalsRequested } from '../../terminals/terminals-slice';
import { fetchWorkspaceTokenUsage } from '../../token-usage/token-usage-slice';
import { hydrateAgentsRequested } from '../../workspace-agents/workspace-agents-slice';
import { loadEventsRequested } from '../../workspace-events/workspace-events-slice';
import {
  ensureWorkspaceTasksLoaded,
  loadWorkspaceTasksRequested,
} from '../../workspace-tasks/workspace-tasks-slice';
import { loadWorkspacesRequested } from '../../workspace/workspace-slice';
import { workspaceDeleted, workspaceUnmounted } from '../workspace-lifecycle-slice';
import { lifecycleReadSaga } from './lifecycle-read-saga';

const WS = 'ws-lifecycle';
const NOW = new Date('2026-07-31T00:00:00.000Z');

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function state() {
  return {
    workspaceTasks: { byWorkspaceId: {} },
    changes: { agentStats: {}, agentLineStatsRequests: {} },
    workspace: { workspaces: createCollection('id', []) },
    agentSessions: { byAgentId: {} },
    workspaceAgents: { byWorkspaceId: {} },
    prStatus: { byWorkspaceId: {} },
  };
}

function start(current = state()) {
  const channel = stdChannel();
  const actions: unknown[] = [];
  const task = runSaga({ channel, dispatch: (action) => actions.push(action), getState: () => current }, lifecycleReadSaga);
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
    mocks.workspaces.list.mockResolvedValue([]);
    mocks.workspaces.recentViews.mockResolvedValue({});
    mocks.workspaces.getTokenUsage.mockResolvedValue(null);
    mocks.workspaces.getContext.mockResolvedValue([]);
    mocks.tasks.list.mockResolvedValue({ tasks: [], stats: { total: 0 } });
    mocks.tasks.listAgentLinks.mockResolvedValue({});
    mocks.events.list.mockResolvedValue([]);
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
    mocks.git.commitsWithBoundary.mockResolvedValue({ commits: [], boundarySha: null, nextToken: null });
    mocks.agents.list.mockResolvedValue([]);
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
    mocks.workspaces.list.mockResolvedValue([workspace]);
    mocks.workspaces.recentViews.mockResolvedValue({ [WS]: 42 });
    const run = start();
    run.channel.put(loadWorkspacesRequested());
    await settle();

    expect(mocks.workspaces.list.mock.calls).toEqual([[{ includeArchived: true }]]);
    expect(mocks.workspaces.recentViews.mock.calls).toEqual([[]]);
    expect(run.actions).toEqual([
      { type: 'workspace/replaceWorkspaceList', payload: [[workspace]] },
      { type: 'workspace/setWorkspaceHasLoaded', payload: [true] },
      { type: 'workspace/loadRecencyData', payload: [{ lastViewedAt: { [WS]: 42 } }] },
    ]);
    await stop(run.task);
  });

  it('guards ensure-tasks, force-loads the explicit trigger, and coalesces one key', async () => {
    const current = state();
    current.workspaceTasks.byWorkspaceId[WS] = { loading: false, initialized: true };
    const run = start(current);
    run.channel.put(ensureWorkspaceTasksLoaded(WS));
    await settle();
    expect(mocks.tasks.list.mock.calls).toEqual([]);
    expect(run.actions).toEqual([]);

    let resolve!: (value: { tasks: unknown[]; stats: { total: number } }) => void;
    mocks.tasks.list.mockReturnValue(new Promise((done) => { resolve = done; }));
    run.channel.put(loadWorkspaceTasksRequested(WS));
    run.channel.put(loadWorkspaceTasksRequested(WS));
    await settle();
    expect(mocks.tasks.list.mock.calls).toEqual([[WS]]);
    resolve({ tasks: [], stats: { total: 0 } });
    await settle();
    expect(run.actions).toEqual([
      { type: 'workspaceTasks/loadWorkspaceTasksSucceeded', payload: [WS, [], { total: 0 }] },
    ]);
    await stop(run.task);
  });

  it('routes event, context, task-link, skill, script, and terminal reads exactly', async () => {
    const event = { id: 'event-1', type: 'agent:created', wire_only: true };
    const item = { id: 'context-1', type: 'note', title: 'Context', provider: 'internal' };
    const links = { 'note-1': { 'agent:a': { agentId: 'a', taskKey: 'agent:a' } } };
    const skill = { name: 'review', description: 'Review code', wire_only: 'keep' };
    const script = { id: 'script-1', name: 'test', command: 'pnpm test', wire_only: 1 };
    const terminal = { id: 'terminal-1', workspaceId: WS, title: 'Shell', wire_only: 'keep' };
    mocks.events.list.mockResolvedValue([event]);
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

    expect(run.actions).toEqual([
      { type: 'workspaceEvents/eventsLoaded', payload: [WS, [event]] },
      { type: 'context/hydrateContextItems', payload: [WS, [item]] },
      { type: 'taskAgentAssociations/hydrateTaskAgentAssociations', payload: [WS, links] },
      { type: 'skills/setSkills', payload: [WS, [skill]] },
      { type: 'scripts/setScriptsData', payload: { wsId: WS, scripts: [script] } },
      { type: 'scripts/setInitialized', payload: [WS, true] },
      { type: 'terminals/loadWorkspaceTerminals', payload: [WS, [terminal]] },
    ]);
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
      byAgentId: { a: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 4 } },
      totals: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 4 },
      byModel: { opus: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 4 } },
      lastScanAt: '2026-07-30T00:00:00.000Z',
      wire_only: 'preserved',
    };
    mocks.workspaces.getTokenUsage.mockResolvedValue(usage);
    const run = start();
    run.channel.put(fetchWorkspaceTokenUsage(WS));
    await settle();
    expect(run.actions).toEqual([
      { type: 'tokenUsage/tokenUsageReceived', payload: [WS, usage] },
    ]);
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

  it('reports PR refresh success and maps only the branch lookup payload', async () => {
    const current = state();
    current.workspace.workspaces = createCollection('id', [{
      id: WS,
      branch: 'feature',
      repositoryOwner: 'acme',
      repositoryName: 'repo',
    }]);
    mocks.git.prRefresh.mockResolvedValue({ prNumber: 7, outcome: 'linked', wire_only: 'drop' });
    const run = start(current);
    run.channel.put(refreshPRStatusRequested(WS, true, true));
    await settle();

    expect(mocks.git.prRefresh.mock.calls).toEqual([[WS]]);
    expect(run.actions).toEqual([
      { type: 'prStatus/refreshStarted', payload: [WS] },
      { type: 'prStatus/refreshCompleted', payload: { wsId: WS, success: true, error: undefined, timestamp: NOW.getTime() } },
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
      { type: 'prStatus/refreshCompleted', payload: { wsId: WS, success: false, error: 'pr.refresh failed', timestamp: NOW.getTime() } },
      { type: 'prStatus/refreshStarted', payload: [WS] },
      { type: 'prStatus/refreshCompleted', payload: { wsId: WS, success: false, error: 'refresh failed', timestamp: NOW.getTime() } },
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
      { type: 'prStatus/refreshCompleted', payload: { wsId: WS, success: true, error: undefined, timestamp: NOW.getTime() } },
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
      { type: 'prStatus/refreshCompleted', payload: { wsId: WS, success: true, error: undefined, timestamp: NOW.getTime() } },
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
    const stale = { ...change, id: 'change-stale', file: '/repo/src/stale.ts', relativePath: 'src/stale.ts' };
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
    mocks.git.commitsWithBoundary.mockResolvedValue({ commits: [commit], boundarySha: 'abc', nextToken: 'wire-token' });
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
      { type: 'changes/setChangesData', payload: { wsId: WS, changes: reconciled, truncated: false, totalCount: 2 } },
      { type: 'changes/setCommitsData', payload: { wsId: WS, commits: [commit], boundarySha: 'abc' } },
      { type: 'changes/setHasLoadedInitialData', payload: [WS, true] },
      { type: 'changes/setChangesData', payload: { wsId: WS, changes: reconciled, truncated: false, totalCount: 2 } },
      { type: 'changes/setCommitsData', payload: { wsId: WS, commits: [commit], boundarySha: 'abc' } },
      { type: 'changes/setHasLoadedInitialData', payload: [WS, true] },
    ]);
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
          changes: [expect.objectContaining({
            relativePath: 'src/status-only.ts',
            stats: { additions: 0, deletions: 0 },
            attribution: { manual: true, timestamp: 0 },
          })],
          truncated: false,
          totalCount: 1,
        },
      },
      { type: 'changes/setCommitsData', payload: { wsId: WS, commits: [], boundarySha: null } },
      { type: 'changes/setHasLoadedInitialData', payload: [WS, true] },
    ]);
    await stop(run.task);
  });

  it('coalesces many in-flight changes triggers into one non-concurrent trailing refresh', async () => {
    let resolveStatus!: (value: Awaited<ReturnType<typeof mocks.git.status>>) => void;
    mocks.git.status.mockReturnValueOnce(new Promise((resolve) => { resolveStatus = resolve; }));
    const run = start();

    run.channel.put(refreshRequested(WS));
    await settle();
    run.channel.put(loadWorkspaceDataRequested(WS));
    run.channel.put(refreshRequested(WS));
    run.channel.put(loadWorkspaceDataRequested(WS));
    await settle();

    expect(mocks.git.status).toHaveBeenCalledTimes(1);
    expect(mocks.git.trackedChanges).toHaveBeenCalledTimes(1);
    expect(mocks.git.commitsWithBoundary).toHaveBeenCalledTimes(1);

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
    expect(mocks.git.trackedChanges).toHaveBeenCalledTimes(2);
    expect(mocks.git.commitsWithBoundary).toHaveBeenCalledTimes(2);
    await settle();
    expect(mocks.git.status).toHaveBeenCalledTimes(2);
    await stop(run.task);
  });

  it('loads older commits and always clears loading on failure and cancellation', async () => {
    const commit = { hash: 'old', message: 'old', wire_only: true };
    mocks.git.commitsWithBoundary.mockResolvedValueOnce({ commits: [commit], boundarySha: null, nextToken: null });
    const run = start();
    run.channel.put(loadOlderCommitsRequested(WS, 'boundary', 25));
    await settle();
    mocks.git.commitsWithBoundary.mockRejectedValueOnce(new Error('older failed'));
    run.channel.put(loadOlderCommitsRequested(WS, 'boundary', 25));
    await settle();

    let pending!: () => void;
    mocks.git.commitsWithBoundary.mockReturnValueOnce(new Promise((resolve) => { pending = () => resolve({ commits: [], boundarySha: null, nextToken: null }); }));
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
    current.changes.agentStats['agent-1'] = { additions: 8, deletions: 3, timestamp: NOW.toISOString() };
    run.channel.put(requestAgentLineStats('agent-1'));
    await settle();
    mocks.getAgentLineStats.mockRejectedValueOnce(new Error('metrics failed'));
    run.channel.put(requestAgentLineStats('agent-1', true));
    await settle();

    expect(mocks.getAgentLineStats.mock.calls).toEqual([['agent-1'], ['agent-1']]);
    expect(run.actions).toEqual([
      { type: 'changes/agentLineStatsRequestStarted', payload: { agentId: 'agent-1', requestedAt: NOW.toISOString() } },
      { type: 'changes/updateAgentStats', payload: { agentId: 'agent-1', stats: { additions: 8, deletions: 3, timestamp: NOW.toISOString() } } },
      { type: 'changes/agentLineStatsRequestSucceeded', payload: { agentId: 'agent-1', finishedAt: NOW.toISOString() } },
      { type: 'changes/agentLineStatsRequestStarted', payload: { agentId: 'agent-1', requestedAt: NOW.toISOString() } },
      { type: 'changes/agentLineStatsRequestFailed', payload: { agentId: 'agent-1', error: 'metrics failed', finishedAt: NOW.toISOString() } },
    ]);
    await stop(run.task);
  });

  it('hydrates agents, preserves transcripts, filters pending deletion, and selects foreground', async () => {
    const existing = agent('agent-keep', { messages: [{ id: 'm1', role: 'user', timestamp: NOW.toISOString() }] as never });
    const current = state();
    current.agentSessions.byAgentId['agent-keep'] = existing;
    mocks.isAgentDeletionPending.mockImplementation((id: string) => id === 'agent-drop');
    mocks.agents.list.mockResolvedValue([
      agent('agent-drop'),
      agent('agent-bg', { isBackground: true }),
      agent('agent-keep'),
    ]);
    const run = start(current);
    run.channel.put(hydrateAgentsRequested(WS));
    await settle();

    const kept = agent('agent-keep', { messages: existing.messages });
    const background = agent('agent-bg', { isBackground: true });
    expect(run.actions).toEqual([
      { type: 'workspaceAgents/setAgentsLoaded', payload: [WS, true] },
      { type: 'workspaceAgents/setAgents', payload: [WS, [background, kept]] },
      { type: 'agentSessions/bulkUpsertSessions', payload: [[background, kept]] },
      { type: 'agentSessions/upsertSession', payload: [background] },
      { type: 'agentSessions/upsertSession', payload: [kept] },
      { type: 'workspaceAgents/setActiveAgentId', payload: [WS, 'agent-keep'] },
    ]);
    await stop(run.task);
  });

  it('cancels workspace reads on delete and suppresses late results', async () => {
    let resolve!: (value: unknown[]) => void;
    mocks.events.list.mockReturnValue(new Promise((done) => { resolve = done; }));
    const run = start();
    run.channel.put(loadEventsRequested(WS));
    await settle();
    run.channel.put(workspaceDeleted(WS, []));
    await settle();
    resolve([{ id: 'late' }]);
    await settle();

    expect(mocks.events.list.mock.calls).toEqual([[WS]]);
    expect(run.actions).toEqual([]);
    await stop(run.task);
  });

  it('ignores malformed trigger payloads', async () => {
    const run = start();
    run.channel.put({ type: loadEventsRequested.type, payload: [] });
    await settle();
    expect(mocks.events.list.mock.calls).toEqual([]);
    expect(run.actions).toEqual([]);
    await stop(run.task);
  });
});