import { runSaga, stdChannel } from 'redux-saga';
import { all, fork } from 'typed-redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  tasks: vi.fn(),
  events: vi.fn(),
  scripts: vi.fn(),
  skills: vi.fn(),
  prRefresh: vi.fn(),
  gitStatus: vi.fn(),
  trackedChanges: vi.fn(),
  commits: vi.fn(),
  agents: vi.fn(),
  terminals: vi.fn(),
  taskLinks: vi.fn(),
  context: vi.fn(),
  acceptStatus: vi.fn(),
}));

vi.mock('../../workspace/utils/workspace.client', () => ({
  workspaceClient: { open: mocks.open, list: vi.fn() },
}));
vi.mock('$lib/client', () => ({
  appClient: {
    workspaces: { recentViews: vi.fn(), getTokenUsage: vi.fn(), getContext: mocks.context },
    tasks: { list: mocks.tasks, listAgentLinks: mocks.taskLinks },
    events: { queryPage: mocks.events },
    scripts: { list: mocks.scripts },
    skills: { list: mocks.skills },
    git: {
      prRefresh: mocks.prRefresh,
      status: mocks.gitStatus,
      trackedChanges: mocks.trackedChanges,
      commitsWithBoundary: mocks.commits,
    },
    agents: { list: vi.fn(), listWithMeta: mocks.agents },
    terminals: { list: mocks.terminals },
  },
}));
vi.mock('$features/accept-changes/accept-changes.client', () => ({
  AcceptChangesClient: { getStatus: mocks.acceptStatus },
}));
vi.mock('$features/agent/utils/pending-agent-deletions', () => ({
  isAgentDeletionPending: () => false,
}));
vi.mock('$features/line-changes/line-changes.client', () => ({ getAgentLineStats: vi.fn() }));
vi.mock('$features/github-auth/renderer/github-auth.client', () => ({
  githubAuthClient: { listRepos: vi.fn() },
}));
vi.mock('$features/external-editors/external-editors.client', () => ({
  externalEditorsClient: { detectInstalled: vi.fn() },
}));
vi.mock('$lib/electron-bridge', () => ({ invoke: vi.fn() }));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

import type { Workspace } from '$shared/types';
import type { WorkspaceGitStatus } from '$features/accept-changes/types';
import { reducers } from '../../../reducer';
import { closeWorkspaceTab, openWorkspaceTab } from '../../tab-state/tab-state-slice';
import { acceptChangesConsumerMounted, acceptChangesConsumerUnmounted } from '../../git/git-slice';
import { acceptChangesStatusSaga } from '../../git/sagas/accept-changes-status-saga';
import { workspaceLoadRequested, workspaceUnmounted } from '../workspace-lifecycle-slice';
import { lifecycleIpcReadSaga } from './lifecycle-ipc-read-saga';
import { lifecycleReadSaga } from './lifecycle-read-saga';
import { workspaceLoadSaga } from './workspace-load-saga';
import { WORKSPACE_HYDRATION_IDLE_FALLBACK_MS } from './workspace-read-scheduler';

type Action = { type: string; payload?: unknown };
type RootState = Record<string, unknown>;

function workspace(id: string): Workspace {
  return {
    id,
    title: `Workspace ${id}`,
    branch: id,
    repositoryPath: '/repo',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: 'Active',
    createdAt: '2026-09-03T00:00:00.000Z',
    updatedAt: '2026-09-03T00:00:00.000Z',
  } as Workspace;
}

function acceptStatus(id: string): WorkspaceGitStatus {
  return {
    branch: id,
    trunkBranch: 'main',
    aheadOfTrunk: 0,
    behindTrunk: 0,
    hasRemote: true,
    isPushed: true,
    uncommittedCount: 0,
    stagedCount: 0,
    localCommits: [],
    canMergeDirectly: false,
    hasConflicts: false,
    hasDivergedFromRemote: false,
  };
}

function reduce(state: RootState | undefined, action: Action): RootState {
  return Object.fromEntries(
    Object.entries(reducers).map(([key, reducer]) => [
      key,
      reducer(state?.[key] as never, action as never),
    ]),
  );
}

function* switchSagas() {
  yield* all([
    fork(workspaceLoadSaga),
    fork(lifecycleIpcReadSaga),
    fork(lifecycleReadSaga),
    fork(acceptChangesStatusSaga),
  ]);
}

const settle = async () => {
  for (let pass = 0; pass < 12; pass += 1) await Promise.resolve();
};

describe('rapid workspace switch ownership', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.open.mockImplementation(async (id: string) => ({ ok: true, data: workspace(id) }));
    mocks.tasks.mockResolvedValue({ tasks: [], stats: { total: 0 } });
    mocks.events.mockResolvedValue({ items: [], nextToken: null });
    mocks.scripts.mockResolvedValue([]);
    mocks.skills.mockResolvedValue([]);
    mocks.prRefresh.mockResolvedValue({ outcome: 'unchanged', pullRequests: [] });
    mocks.gitStatus.mockResolvedValue({
      branch: 'main',
      ahead: 0,
      behind: 0,
      diverged: false,
      files: [],
      hasUncommittedChanges: false,
      hasUntrackedFiles: false,
    });
    mocks.trackedChanges.mockResolvedValue([]);
    mocks.commits.mockResolvedValue({ commits: [], boundarySha: null, nextToken: null });
    mocks.agents.mockResolvedValue({ agents: [], retiredCount: 0 });
    mocks.terminals.mockResolvedValue([]);
    mocks.taskLinks.mockResolvedValue({});
    mocks.context.mockResolvedValue([]);
    mocks.acceptStatus.mockImplementation(async (id: string) => acceptStatus(id));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('cancels stale generations and leaves one lease and final state for D', async () => {
    const channel = stdChannel();
    const actions: Action[] = [];
    const leases = new Map<string, number>();
    let state = reduce(undefined, { type: '@@INIT' });
    const dispatch = (action: Action) => {
      state = reduce(state, action);
      actions.push(action);
      if (action.type === acceptChangesConsumerMounted.type) {
        const id = (action.payload as [string])[0];
        leases.set(id, (leases.get(id) ?? 0) + 1);
      }
      if (action.type === acceptChangesConsumerUnmounted.type) {
        const id = (action.payload as [string])[0];
        leases.set(id, Math.max(0, (leases.get(id) ?? 0) - 1));
      }
      channel.put(action);
      return action;
    };
    const task = runSaga({ channel, dispatch, getState: () => state }, switchSagas);
    const retained: string[] = [];
    const select = async (id: string) => {
      dispatch(openWorkspaceTab(id));
      dispatch(acceptChangesConsumerMounted(id));
      dispatch(workspaceLoadRequested(id));
      retained.push(id);
      if (retained.length > 2) {
        const evicted = retained.shift()!;
        dispatch(acceptChangesConsumerUnmounted(evicted));
        dispatch(closeWorkspaceTab(evicted, 1));
        dispatch(workspaceUnmounted(evicted));
      }
      await settle();
    };

    try {
      await select('A');
      await select('B');
      await select('C');
      await select('D');

      expect(Object.fromEntries(leases)).toEqual({ A: 0, B: 0, C: 1, D: 1 });
      expect(vi.getTimerCount()).toBe(2);
      await vi.advanceTimersByTimeAsync(WORKSPACE_HYDRATION_IDLE_FALLBACK_MS);
      await settle();
      expect(vi.getTimerCount()).toBe(0);

      const deferredRpcWorkspaces = [
        mocks.events,
        mocks.scripts,
        mocks.skills,
        mocks.prRefresh,
        mocks.gitStatus,
        mocks.context,
      ].flatMap((mock) => mock.mock.calls.map(([id]) => id));
      expect(deferredRpcWorkspaces).not.toContain('A');
      expect(deferredRpcWorkspaces).not.toContain('B');
      expect(new Set(deferredRpcWorkspaces)).toEqual(new Set(['C', 'D']));
      expect(new Set(mocks.acceptStatus.mock.calls.map(([id]) => id))).toEqual(
        new Set(['A', 'B', 'C', 'D']),
      );
      expect((state.tabState as { currentTabId: string | null }).currentTabId).toBe('D');
      expect(
        (
          state.git as {
            byWorkspaceId: Record<string, { acceptChangesStatus: WorkspaceGitStatus }>;
          }
        ).byWorkspaceId.D.acceptChangesStatus.branch,
      ).toBe('D');
      expect(
        actions
          .filter((action) => action.type === workspaceUnmounted.type)
          .map((action) => (action.payload as [string])[0]),
      ).toEqual(['A', 'B']);
    } finally {
      task.cancel();
      await task.toPromise();
    }
  });
});
