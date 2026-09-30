import type { PullRequestInfo, Workspace, WorkspaceId } from '$shared/types';
import { PullRequestStatus, WorkspaceStatusEnum } from '$shared/types';
import type { WorkspaceGitStatus } from '$features/accept-changes/types';
import type { TaskStats } from '$shared/utils/task-stats';
import { describe, expect, it } from 'vitest';
import type { StoreState } from '../../types';
import { initialState, setWorkspaceEntity, workspaceReducer } from './workspace-slice';
import { initialState as daemonHealthInitialState } from '../daemon-health/daemon-health-slice';
import {
  selectIsWorkspaceHostLocal,
  selectWorkflowStage,
  selectWorkspaceActivePrSummary,
  selectWorkspaceIsWaiting,
  selectWorkspaceProgressActions,
  selectWorkspaceProgressHeadline,
} from './workspace-selectors';
import type { WorkspaceProgressInput } from './workspace-types';
import {
  initialState as prMonitorInitialState,
  prMonitorReducer,
  prMonitorsUpdated,
} from '../pr-monitor/pr-monitor-slice';
import type { PrMonitorRow, PrMonitorSnapshot } from '$features/pr-monitor/pr-monitor-service';

const WS_ID = 'ws-1';

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: WS_ID as WorkspaceId,
    title: 'Test Workspace',
    branch: 'main',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatusEnum.Active,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as Workspace;
}

/** Build store state with a single workspace, optionally carrying an active PR. */
function mockState(activePullRequest?: PullRequestInfo): StoreState {
  const ws = makeWorkspace(activePullRequest ? { activePullRequest } : {});
  return {
    workspace: workspaceReducer(initialState, setWorkspaceEntity(ws)),
  } as StoreState;
}

function makeTaskStats(overrides: Partial<TaskStats> = {}): TaskStats {
  return { total: 0, completed: 0, inProgress: 0, ...overrides };
}

function makeInput(overrides: Partial<WorkspaceProgressInput> = {}): WorkspaceProgressInput {
  return {
    gitStatus: null,
    gitStatusLoading: false,
    taskStats: makeTaskStats(),
    completionRatio: 0,
    isAgentWorking: false,
    specHasContent: false,
    ...overrides,
  };
}

function makeGitStatus(overrides: Partial<WorkspaceGitStatus> = {}): WorkspaceGitStatus {
  return {
    branch: 'feature',
    trunkBranch: 'main',
    aheadOfTrunk: 0,
    behindTrunk: 0,
    hasRemote: true,
    isPushed: false,
    uncommittedCount: 0,
    stagedCount: 0,
    localCommits: [],
    ...overrides,
  };
}

function makePR(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    id: 'pr-1',
    number: 42,
    url: 'https://github.com/example/repo/pull/42',
    title: 'Example PR',
    status: PullRequestStatus.Open,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

/**
 * Build store state for locality tests: daemon locality via the BE-reported
 * `hostLocality`, plus an optional workspace entity.
 */
function mockLocalityState(hostLocality: 'local' | 'remote', workspace?: Workspace): StoreState {
  return {
    workspace: workspace
      ? workspaceReducer(initialState, setWorkspaceEntity(workspace))
      : initialState,
    daemonHealth: { ...daemonHealthInitialState, hostLocality },
  } as StoreState;
}

describe('selectIsWorkspaceHostLocal (monorepo#2171)', () => {
  it('is true for a local workspace on a local daemon', () => {
    const state = mockLocalityState('local', makeWorkspace());
    expect(selectIsWorkspaceHostLocal.select(state, WS_ID)).toBe(true);
  });

  it("is false for a remote workspace (environmentConfig.type === 'remote') on a local daemon", () => {
    const state = mockLocalityState(
      'local',
      makeWorkspace({
        environmentConfig: { type: 'remote', ssh: { host: 'example.com', user: 'dev' } },
      }),
    );
    expect(selectIsWorkspaceHostLocal.select(state, WS_ID)).toBe(false);
  });

  it('is false for a legacy isRemote workspace on a local daemon', () => {
    const state = mockLocalityState('local', makeWorkspace({ isRemote: true }));
    expect(selectIsWorkspaceHostLocal.select(state, WS_ID)).toBe(false);
  });

  it('is false for a local workspace on a remote daemon', () => {
    const state = mockLocalityState('remote', makeWorkspace());
    expect(selectIsWorkspaceHostLocal.select(state, WS_ID)).toBe(false);
  });

  it('treats a missing workspace entity as local (optimistic default; remote workspaces always carry environmentConfig)', () => {
    const state = mockLocalityState('local');
    expect(selectIsWorkspaceHostLocal.select(state, WS_ID)).toBe(true);
  });
});

describe('selectWorkspaceIsWaiting', () => {
  function mockWaitingState(workspace?: Workspace): StoreState {
    return {
      workspace: workspace
        ? workspaceReducer(initialState, setWorkspaceEntity(workspace))
        : initialState,
    } as StoreState;
  }

  it('is true when the daemon marked the workspace as waiting', () => {
    const state = mockWaitingState(makeWorkspace({ waiting: true }));
    expect(selectWorkspaceIsWaiting.select(state, WS_ID)).toBe(true);
  });

  it('is false when waiting is false', () => {
    const state = mockWaitingState(makeWorkspace({ waiting: false }));
    expect(selectWorkspaceIsWaiting.select(state, WS_ID)).toBe(false);
  });

  it('is false when the field is absent (older daemons never send it)', () => {
    const state = mockWaitingState(makeWorkspace());
    expect(selectWorkspaceIsWaiting.select(state, WS_ID)).toBe(false);
  });

  it('is false for a missing workspace entity', () => {
    const state = mockWaitingState();
    expect(selectWorkspaceIsWaiting.select(state, WS_ID)).toBe(false);
  });
});

describe('selectWorkflowStage', () => {
  it("returns 'loading' while git status loads with no cached PR or tasks", () => {
    const input = makeInput({ gitStatusLoading: true, gitStatus: null });
    expect(selectWorkflowStage.select(mockState(), WS_ID, input)).toBe('loading');
  });

  it("returns 'spec-empty' when there is no content, no tasks, no changes", () => {
    expect(selectWorkflowStage.select(mockState(), WS_ID, makeInput())).toBe('spec-empty');
  });

  it("returns 'spec-creating' when an agent is working and there are no tasks", () => {
    const input = makeInput({ isAgentWorking: true });
    expect(selectWorkflowStage.select(mockState(), WS_ID, input)).toBe('spec-creating');
  });

  it("returns 'spec-ready' when the spec has content but no tasks", () => {
    const input = makeInput({ specHasContent: true });
    expect(selectWorkflowStage.select(mockState(), WS_ID, input)).toBe('spec-ready');
  });

  it("returns 'tasks-ready' when tasks exist but none are started", () => {
    const input = makeInput({ taskStats: makeTaskStats({ total: 3 }) });
    expect(selectWorkflowStage.select(mockState(), WS_ID, input)).toBe('tasks-ready');
  });

  it("returns 'tasks-in-progress' when at least one task is in progress", () => {
    const input = makeInput({ taskStats: makeTaskStats({ total: 3, inProgress: 1 }) });
    expect(selectWorkflowStage.select(mockState(), WS_ID, input)).toBe('tasks-in-progress');
  });

  it("returns 'changes-unstaged' when there are uncommitted changes", () => {
    const input = makeInput({ gitStatus: makeGitStatus({ uncommittedCount: 2 }) });
    expect(selectWorkflowStage.select(mockState(), WS_ID, input)).toBe('changes-unstaged');
  });

  it("returns 'changes-staged' when there are staged changes", () => {
    const input = makeInput({ gitStatus: makeGitStatus({ stagedCount: 1 }) });
    expect(selectWorkflowStage.select(mockState(), WS_ID, input)).toBe('changes-staged');
  });

  it("returns 'commits-unpushed' when there are unpushed commits and no changes", () => {
    const gitStatus = makeGitStatus({
      localCommits: [
        { hash: 'a', message: 'm', author: 'a', date: 'd', filesChanged: 1, isPushed: false },
      ],
    });
    expect(selectWorkflowStage.select(mockState(), WS_ID, makeInput({ gitStatus }))).toBe(
      'commits-unpushed',
    );
  });

  it("returns 'pr-open' from a cached active PR before git status loads", () => {
    const input = makeInput();
    const state = mockState(makePR({ status: PullRequestStatus.Open }));
    expect(selectWorkflowStage.select(state, WS_ID, input)).toBe('pr-open');
  });

  it("returns 'pr-open' for an open existing PR awaiting review", () => {
    const gitStatus = makeGitStatus({
      existingPR: { number: 42, url: 'u', htmlUrl: 'h', title: 't', state: 'open' },
    });
    expect(selectWorkflowStage.select(mockState(), WS_ID, makeInput({ gitStatus }))).toBe(
      'pr-open',
    );
  });

  it("returns 'pr-approved' when an open PR has an APPROVED review decision", () => {
    const gitStatus = makeGitStatus({
      existingPR: { number: 42, url: 'u', htmlUrl: 'h', title: 't', state: 'open' },
    });
    const state = mockState(makePR({ reviewDecision: 'APPROVED' }));
    expect(selectWorkflowStage.select(state, WS_ID, makeInput({ gitStatus }))).toBe('pr-approved');
  });

  it("returns 'all-done' when the PR is merged and there are no uncommitted changes", () => {
    const gitStatus = makeGitStatus({
      existingPR: { number: 42, url: 'u', htmlUrl: 'h', title: 't', state: 'merged' },
    });
    expect(selectWorkflowStage.select(mockState(), WS_ID, makeInput({ gitStatus }))).toBe(
      'all-done',
    );
  });

  it("returns 'all-done' when the PR is merged and all tasks are complete", () => {
    const gitStatus = makeGitStatus({
      existingPR: { number: 42, url: 'u', htmlUrl: 'h', title: 't', state: 'merged' },
    });
    const input = makeInput({
      gitStatus,
      taskStats: makeTaskStats({ total: 2, completed: 2 }),
      completionRatio: 1,
    });
    expect(selectWorkflowStage.select(mockState(), WS_ID, input)).toBe('all-done');
  });

  it("returns 'tasks-ready' when the PR is merged but unstarted tasks remain", () => {
    const gitStatus = makeGitStatus({
      existingPR: { number: 42, url: 'u', htmlUrl: 'h', title: 't', state: 'merged' },
    });
    const input = makeInput({ gitStatus, taskStats: makeTaskStats({ total: 3 }) });
    expect(selectWorkflowStage.select(mockState(), WS_ID, input)).toBe('tasks-ready');
  });

  it("returns 'tasks-in-progress' when the PR is merged but open tasks remain", () => {
    const gitStatus = makeGitStatus({
      existingPR: { number: 42, url: 'u', htmlUrl: 'h', title: 't', state: 'merged' },
    });
    const input = makeInput({
      gitStatus,
      taskStats: makeTaskStats({ total: 4, completed: 2, inProgress: 1 }),
      completionRatio: 0.5,
    });
    expect(selectWorkflowStage.select(mockState(), WS_ID, input)).toBe('tasks-in-progress');
  });

  it("returns 'changes-unstaged' when the PR is merged with uncommitted changes and no tasks", () => {
    const gitStatus = makeGitStatus({
      existingPR: { number: 42, url: 'u', htmlUrl: 'h', title: 't', state: 'merged' },
      uncommittedCount: 2,
    });
    expect(selectWorkflowStage.select(mockState(), WS_ID, makeInput({ gitStatus }))).toBe(
      'changes-unstaged',
    );
  });

  it("returns 'changes-staged' when the PR is merged but staged changes remain", () => {
    const gitStatus = makeGitStatus({
      existingPR: { number: 42, url: 'u', htmlUrl: 'h', title: 't', state: 'merged' },
      stagedCount: 1,
    });
    expect(selectWorkflowStage.select(mockState(), WS_ID, makeInput({ gitStatus }))).toBe(
      'changes-staged',
    );
  });

  it("returns 'commits-unpushed' when the PR is merged but unpushed commits remain", () => {
    const gitStatus = makeGitStatus({
      existingPR: { number: 42, url: 'u', htmlUrl: 'h', title: 't', state: 'merged' },
      localCommits: [
        { hash: 'a', message: 'm', author: 'a', date: 'd', filesChanged: 1, isPushed: false },
      ],
    });
    expect(selectWorkflowStage.select(mockState(), WS_ID, makeInput({ gitStatus }))).toBe(
      'commits-unpushed',
    );
  });

  it("returns 'all-done' when the PR is merged and all local commits are pushed", () => {
    // The just-merged branch's own commits (pushed to open the PR) must not
    // read as new work after the merge.
    const gitStatus = makeGitStatus({
      existingPR: { number: 42, url: 'u', htmlUrl: 'h', title: 't', state: 'merged' },
      localCommits: [
        { hash: 'a', message: 'm', author: 'a', date: 'd', filesChanged: 1, isPushed: true },
      ],
    });
    expect(selectWorkflowStage.select(mockState(), WS_ID, makeInput({ gitStatus }))).toBe(
      'all-done',
    );
  });

  it("returns 'all-done' when the PR is closed", () => {
    const gitStatus = makeGitStatus({
      existingPR: { number: 42, url: 'u', htmlUrl: 'h', title: 't', state: 'closed' },
    });
    expect(selectWorkflowStage.select(mockState(), WS_ID, makeInput({ gitStatus }))).toBe(
      'all-done',
    );
  });

  it('returns a task stage when the PR is closed but open tasks remain', () => {
    const gitStatus = makeGitStatus({
      existingPR: { number: 42, url: 'u', htmlUrl: 'h', title: 't', state: 'closed' },
    });
    const input = makeInput({
      gitStatus,
      taskStats: makeTaskStats({ total: 3, completed: 1, inProgress: 1 }),
      completionRatio: 1 / 3,
    });
    expect(selectWorkflowStage.select(mockState(), WS_ID, input)).toBe('tasks-in-progress');
  });

  it("returns 'changes-unstaged' when the PR is closed but uncommitted changes remain", () => {
    const gitStatus = makeGitStatus({
      existingPR: { number: 42, url: 'u', htmlUrl: 'h', title: 't', state: 'closed' },
      uncommittedCount: 2,
    });
    expect(selectWorkflowStage.select(mockState(), WS_ID, makeInput({ gitStatus }))).toBe(
      'changes-unstaged',
    );
  });

  it("returns 'changes-staged' when the PR is closed but staged changes remain", () => {
    const gitStatus = makeGitStatus({
      existingPR: { number: 42, url: 'u', htmlUrl: 'h', title: 't', state: 'closed' },
      stagedCount: 1,
    });
    expect(selectWorkflowStage.select(mockState(), WS_ID, makeInput({ gitStatus }))).toBe(
      'changes-staged',
    );
  });

  it("returns 'commits-unpushed' when the PR is closed but unpushed commits remain", () => {
    const gitStatus = makeGitStatus({
      existingPR: { number: 42, url: 'u', htmlUrl: 'h', title: 't', state: 'closed' },
      localCommits: [
        { hash: 'a', message: 'm', author: 'a', date: 'd', filesChanged: 1, isPushed: false },
      ],
    });
    expect(selectWorkflowStage.select(mockState(), WS_ID, makeInput({ gitStatus }))).toBe(
      'commits-unpushed',
    );
  });

  it("returns 'all-done' when all tasks are complete with no changes", () => {
    const input = makeInput({
      taskStats: makeTaskStats({ total: 2, completed: 2 }),
      completionRatio: 1,
    });
    expect(selectWorkflowStage.select(mockState(), WS_ID, input)).toBe('all-done');
  });
});

describe('selectWorkspaceProgressHeadline', () => {
  it('returns the loading headline', () => {
    const input = makeInput({ gitStatusLoading: true });
    expect(selectWorkspaceProgressHeadline.select(mockState(), WS_ID, input)).toEqual({
      headline: 'Loading...',
      subtext: '',
    });
  });

  it('returns the spec-empty headline', () => {
    expect(selectWorkspaceProgressHeadline.select(mockState(), WS_ID, makeInput())).toEqual({
      headline: 'Brainstorm with an agent or write the Spec.',
      subtext: '',
    });
  });

  it("returns an 'almost there' headline when nearly complete", () => {
    const input = makeInput({
      taskStats: makeTaskStats({ total: 5, completed: 4, inProgress: 1 }),
      completionRatio: 0.8,
    });
    expect(selectWorkspaceProgressHeadline.select(mockState(), WS_ID, input).headline).toBe(
      'Almost there! 1 task remaining.',
    );
  });

  it('returns a percentage headline mid-progress', () => {
    const input = makeInput({
      taskStats: makeTaskStats({ total: 4, completed: 2, inProgress: 1 }),
      completionRatio: 0.5,
    });
    expect(selectWorkspaceProgressHeadline.select(mockState(), WS_ID, input).headline).toBe(
      "Things are progressing nicely. We're 50% through the work.",
    );
  });

  it('summarizes file changes once tasks have been worked', () => {
    const input = makeInput({
      gitStatus: makeGitStatus({ uncommittedCount: 2 }),
      taskStats: makeTaskStats({ total: 2, completed: 2 }),
      completionRatio: 1,
    });
    expect(selectWorkspaceProgressHeadline.select(mockState(), WS_ID, input)).toEqual({
      headline: 'Review 2 file changes',
      subtext: 'Time to review the changes and push.',
    });
  });

  it('resolves the PR number from the active PR for the pr-open headline', () => {
    const gitStatus = makeGitStatus({
      existingPR: { number: 7, url: 'u', htmlUrl: 'h', title: 't', state: 'open' },
    });
    const state = mockState(makePR({ number: 99 }));
    expect(
      selectWorkspaceProgressHeadline.select(state, WS_ID, makeInput({ gitStatus })).headline,
    ).toBe('PR #99 open, awaiting review.');
  });

  it("falls back to existingPR.number when there is no active PR (no 'PR #undefined')", () => {
    const gitStatus = makeGitStatus({
      existingPR: { number: 7, url: 'u', htmlUrl: 'h', title: 't', state: 'open' },
    });
    const headline = selectWorkspaceProgressHeadline.select(
      mockState(),
      WS_ID,
      makeInput({ gitStatus }),
    ).headline;
    expect(headline).toBe('PR #7 open, awaiting review.');
    expect(headline).not.toContain('undefined');
  });

  it('suggests creating a PR for unpushed commits with no existing PR', () => {
    const gitStatus = makeGitStatus({
      localCommits: [
        { hash: 'a', message: 'm', author: 'a', date: 'd', filesChanged: 1, isPushed: false },
      ],
    });
    expect(
      selectWorkspaceProgressHeadline.select(mockState(), WS_ID, makeInput({ gitStatus })),
    ).toEqual({
      headline: '1 commit to push',
      subtext: 'Push to create a PR.',
    });
  });

  it('suggests updating the PR for unpushed commits with an updatable PR', () => {
    // An open PR resolves to the pr-open stage, so a draft PR (also updatable
    // by a push) is the state that reaches commits-unpushed with a live PR.
    const gitStatus = makeGitStatus({
      existingPR: { number: 42, url: 'u', htmlUrl: 'h', title: 't', state: 'draft' },
      localCommits: [
        { hash: 'a', message: 'm', author: 'a', date: 'd', filesChanged: 1, isPushed: false },
      ],
    });
    expect(
      selectWorkspaceProgressHeadline.select(mockState(), WS_ID, makeInput({ gitStatus })).subtext,
    ).toBe('Push to update PR.');
  });

  it('suggests creating a new PR for unpushed commits after the PR merged', () => {
    const gitStatus = makeGitStatus({
      existingPR: { number: 42, url: 'u', htmlUrl: 'h', title: 't', state: 'merged' },
      localCommits: [
        { hash: 'a', message: 'm', author: 'a', date: 'd', filesChanged: 1, isPushed: false },
      ],
    });
    expect(
      selectWorkspaceProgressHeadline.select(mockState(), WS_ID, makeInput({ gitStatus })),
    ).toEqual({
      headline: '1 commit to push',
      subtext: 'Push to create a PR.',
    });
  });

  it('includes approver and CI info in the pr-approved headline', () => {
    const gitStatus = makeGitStatus({
      existingPR: { number: 42, url: 'u', htmlUrl: 'h', title: 't', state: 'open' },
    });
    const state = mockState(
      makePR({
        reviewDecision: 'APPROVED',
        approvedBy: ['alice'],
        ciStatus: { total: 3, passed: 3, failed: 0, pending: 0 },
      }),
    );
    expect(
      selectWorkspaceProgressHeadline.select(state, WS_ID, makeInput({ gitStatus })).headline,
    ).toBe('PR #42 approved by alice, ready to merge, 3/3 checks passing.');
  });
});

describe('selectWorkspaceProgressActions', () => {
  it('uses the shared active PR summary for the Changes card and View PR action', () => {
    const state = mockState(makePR({ number: 1373, url: 'https://gh/pr/1373' }));
    const summary = selectWorkspaceActivePrSummary.select(state, WS_ID);
    const [action] = selectWorkspaceProgressActions.select(state, WS_ID, makeInput());

    expect(summary).toMatchObject({
      number: 1373,
      url: 'https://gh/pr/1373',
    });
    expect(action).toMatchObject({
      id: 'view-pr',
      label: summary?.actionLabel,
      tooltip: summary?.actionTooltip,
      url: summary?.url,
    });
  });

  it('offers a review-changes action once tasks have been worked', () => {
    const input = makeInput({
      gitStatus: makeGitStatus({ uncommittedCount: 2 }),
      taskStats: makeTaskStats({ total: 2, completed: 2 }),
      completionRatio: 1,
    });
    expect(selectWorkspaceProgressActions.select(mockState(), WS_ID, input)).toEqual([
      {
        id: 'review-changes',
        label: 'Review changes',
        iconKey: 'file-lines',
        tooltip: 'Opens the changes panel to review, stage, and commit file changes.',
      },
    ]);
  });

  it('returns no actions for unstaged changes before any task work', () => {
    const input = makeInput({ gitStatus: makeGitStatus({ uncommittedCount: 2 }) });
    expect(selectWorkspaceProgressActions.select(mockState(), WS_ID, input)).toEqual([]);
  });

  it('offers a commit action for staged changes', () => {
    const input = makeInput({ gitStatus: makeGitStatus({ stagedCount: 1 }) });
    const [action] = selectWorkspaceProgressActions.select(mockState(), WS_ID, input);
    expect(action).toMatchObject({ id: 'commit', iconKey: 'check' });
  });

  it('offers a Create PR action for unpushed commits with no existing PR', () => {
    const gitStatus = makeGitStatus({
      localCommits: [
        { hash: 'a', message: 'm', author: 'a', date: 'd', filesChanged: 1, isPushed: false },
      ],
    });
    const [action] = selectWorkspaceProgressActions.select(
      mockState(),
      WS_ID,
      makeInput({ gitStatus }),
    );
    expect(action).toMatchObject({
      id: 'push-or-create-pr',
      label: 'Create PR',
      iconKey: 'code-pull-request',
    });
    expect(action.url).toBeUndefined();
  });

  it('offers a View PR action carrying the resolved PR url', () => {
    const gitStatus = makeGitStatus({
      existingPR: { number: 7, url: 'u', htmlUrl: 'https://gh/pr/7', title: 't', state: 'open' },
    });
    const [action] = selectWorkspaceProgressActions.select(
      mockState(),
      WS_ID,
      makeInput({ gitStatus }),
    );
    expect(action).toMatchObject({ id: 'view-pr', iconKey: 'code-branch', url: 'https://gh/pr/7' });
  });

  it('offers a Merge PR action when the PR is approved', () => {
    const gitStatus = makeGitStatus({
      existingPR: { number: 42, url: 'u', htmlUrl: 'https://gh/pr/42', title: 't', state: 'open' },
    });
    const state = mockState(makePR({ reviewDecision: 'APPROVED', url: 'https://gh/pr/42' }));
    const [action] = selectWorkspaceProgressActions.select(state, WS_ID, makeInput({ gitStatus }));
    expect(action).toMatchObject({
      id: 'merge-pr',
      iconKey: 'code-branch',
      url: 'https://gh/pr/42',
    });
  });

  it('prefers View PR over Review changes for unstaged changes with a resolvable PR', () => {
    const state = mockState(makePR({ status: PullRequestStatus.Merged, url: 'https://gh/pr/100' }));
    const input = makeInput({
      gitStatus: makeGitStatus({ uncommittedCount: 2 }),
      taskStats: makeTaskStats({ total: 2, completed: 2 }),
      completionRatio: 1,
    });
    expect(selectWorkspaceProgressActions.select(state, WS_ID, input)).toEqual([
      {
        id: 'view-pr',
        label: '#42: Example PR',
        iconKey: 'code-branch',
        tooltip: 'Opens pull request #42 on GitHub in your browser.',
        url: 'https://gh/pr/100',
      },
    ]);
  });

  it('prefers View PR over Commit for staged changes with a resolvable PR', () => {
    const state = mockState(makePR({ status: PullRequestStatus.Merged, url: 'https://gh/pr/101' }));
    const input = makeInput({ gitStatus: makeGitStatus({ stagedCount: 1 }) });
    const [action] = selectWorkspaceProgressActions.select(state, WS_ID, input);
    expect(action).toMatchObject({
      id: 'view-pr',
      iconKey: 'code-branch',
      url: 'https://gh/pr/101',
    });
  });

  it('prefers View PR over Push/Create PR for unpushed commits with a resolvable PR', () => {
    const state = mockState(makePR({ status: PullRequestStatus.Merged, url: 'https://gh/pr/102' }));
    const gitStatus = makeGitStatus({
      localCommits: [
        { hash: 'a', message: 'm', author: 'a', date: 'd', filesChanged: 1, isPushed: false },
      ],
    });
    const [action] = selectWorkspaceProgressActions.select(state, WS_ID, makeInput({ gitStatus }));
    expect(action).toMatchObject({
      id: 'view-pr',
      iconKey: 'code-branch',
      url: 'https://gh/pr/102',
    });
  });

  it('offers a View PR action once a merged PR leaves work all done', () => {
    const gitStatus = makeGitStatus({
      existingPR: {
        number: 42,
        url: 'u',
        htmlUrl: 'https://gh/pr/42',
        title: 't',
        state: 'merged',
      },
    });
    const [action] = selectWorkspaceProgressActions.select(
      mockState(),
      WS_ID,
      makeInput({ gitStatus }),
    );
    expect(action).toMatchObject({
      id: 'view-pr',
      iconKey: 'code-branch',
      url: 'https://gh/pr/42',
    });
  });

  it('returns no actions for non-actionable stages', () => {
    const input = makeInput({ taskStats: makeTaskStats({ total: 3 }) });
    expect(selectWorkspaceProgressActions.select(mockState(), WS_ID, input)).toEqual([]);
  });

  // ─── Monitored-PR fallback (PROTOCOL §6.9) ───

  function makeMonitor(overrides: Partial<PrMonitorRow> = {}): PrMonitorRow {
    return {
      monitorId: 'mon-1',
      workspaceId: WS_ID,
      agentId: 'agent-1',
      repo: 'acme/widgets',
      prNumber: 77,
      state: 'active',
      pendingChanges: [],
      hasPendingChanges: false,
      createdAt: '2026-08-07T10:00:00Z',
      updatedAt: '2026-08-07T10:05:00Z',
      url: 'https://github.com/acme/widgets/pull/77',
      ...overrides,
    };
  }

  /** State with a workspace (repo acme/widgets) plus live pr-monitor rows. */
  function mockStateWithMonitors(monitors: PrMonitorRow[]): StoreState {
    const ws = makeWorkspace({
      repositoryOwner: 'acme',
      repositoryName: 'widgets',
    } as Partial<Workspace>);
    return {
      workspace: workspaceReducer(initialState, setWorkspaceEntity(ws)),
      prMonitor: prMonitorReducer(prMonitorInitialState, prMonitorsUpdated(WS_ID, monitors)),
    } as StoreState;
  }

  it('falls back to the first ACTIVE monitored PR when no branch-linked PR exists', () => {
    const state = mockStateWithMonitors([
      makeMonitor({ monitorId: 'mon-0', state: 'completed', prNumber: 5 }),
      makeMonitor(),
    ]);
    const input = makeInput({ taskStats: makeTaskStats({ total: 3 }) });
    const [action] = selectWorkspaceProgressActions.select(state, WS_ID, input);
    expect(action).toMatchObject({
      id: 'view-pr',
      label: 'widgets #77',
      iconKey: 'code-branch',
      url: 'https://github.com/acme/widgets/pull/77',
    });
  });

  it('labels a cross-repo monitored-PR fallback with its org/repo context', () => {
    const state = mockStateWithMonitors([
      makeMonitor({
        repo: 'other/lib',
        url: 'https://github.com/other/lib/pull/1373',
        prNumber: 1373,
      }),
    ]);
    const input = makeInput({ taskStats: makeTaskStats({ total: 3 }) });
    const [action] = selectWorkspaceProgressActions.select(state, WS_ID, input);
    const summary = selectWorkspaceActivePrSummary.select(state, WS_ID);
    expect(action.label).toBe('other/lib #1373');
    expect(action.tooltip).toContain('other/lib#1,373');
    expect(action.url).toBe('https://github.com/other/lib/pull/1373');
    expect(summary).toMatchObject({
      number: 1373,
      actionLabel: action.label,
      actionTooltip: action.tooltip,
      url: action.url,
    });
  });

  it('prefers the branch-linked PR over monitored PRs', () => {
    const ws = makeWorkspace({
      activePullRequest: makePR({ url: 'https://gh/pr/42' }),
      repositoryOwner: 'acme',
      repositoryName: 'widgets',
    } as Partial<Workspace>);
    const state = {
      workspace: workspaceReducer(initialState, setWorkspaceEntity(ws)),
      prMonitor: prMonitorReducer(prMonitorInitialState, prMonitorsUpdated(WS_ID, [makeMonitor()])),
    } as StoreState;
    const gitStatus = makeGitStatus({
      existingPR: {
        number: 42,
        url: 'u',
        htmlUrl: 'https://gh/pr/42',
        title: 't',
        state: 'merged',
      },
    });
    const [action] = selectWorkspaceProgressActions.select(state, WS_ID, makeInput({ gitStatus }));
    expect(action.url).toBe('https://gh/pr/42');
  });
});

describe('selectWorkspaceActivePrSummary (rich chip fields)', () => {
  function makeMonitor(overrides: Partial<PrMonitorRow> = {}): PrMonitorRow {
    return {
      monitorId: 'mon-1',
      workspaceId: WS_ID,
      agentId: 'agent-1',
      repo: 'acme/widgets',
      prNumber: 77,
      state: 'active',
      pendingChanges: [],
      hasPendingChanges: false,
      createdAt: '2026-08-07T10:00:00Z',
      updatedAt: '2026-08-07T10:05:00Z',
      url: 'https://github.com/acme/widgets/pull/77',
      ...overrides,
    };
  }

  function makeSnapshot(overrides: Partial<PrMonitorSnapshot> = {}): PrMonitorSnapshot {
    return {
      state: 'open',
      isDraft: false,
      hasConflicts: false,
      isBehind: false,
      checks: {
        total: 0,
        passed: 0,
        failed: 0,
        pending: 0,
        failingRequired: 0,
        pendingRequired: 0,
        requiredKnown: false,
      },
      approvals: { decision: '', have: 0, changesRequested: 0 },
      threads: { unresolved: 0 },
      rulesKnown: false,
      ...overrides,
    };
  }

  /** State with a workspace (repo acme/widgets), optional PR, and monitor rows. */
  function mockRichState(workspace: Partial<Workspace>, monitors: PrMonitorRow[] = []): StoreState {
    const ws = makeWorkspace(workspace);
    return {
      workspace: workspaceReducer(initialState, setWorkspaceEntity(ws)),
      prMonitor: prMonitorReducer(prMonitorInitialState, prMonitorsUpdated(WS_ID, monitors)),
    } as StoreState;
  }

  it('enriches a workspace-repo branch-linked PR with chip label, title, and status', () => {
    const state = mockRichState({
      activePullRequest: makePR({ number: 1365, url: 'https://gh/pr/1365', title: 'Fix widgets' }),
      repositoryOwner: 'acme',
      repositoryName: 'widgets',
    } as Partial<Workspace>);
    expect(selectWorkspaceActivePrSummary.select(state, WS_ID)).toEqual({
      number: 1365,
      url: 'https://gh/pr/1365',
      repo: 'acme/widgets',
      chipLabel: 'widgets #1365',
      title: 'Fix widgets',
      status: 'open',
      actionLabel: 'widgets #1365: Fix widgets',
      actionTooltip: 'Opens pull request acme/widgets#1,365 on GitHub in your browser.',
    });
  });

  it('honors isDraft over an Open status for the branch-linked PR', () => {
    const state = mockRichState({
      activePullRequest: makePR({ isDraft: true }),
    } as Partial<Workspace>);
    expect(selectWorkspaceActivePrSummary.select(state, WS_ID)?.status).toBe('draft');
  });

  it('degrades the legacy prNumber/prUrl path gracefully (no title, unknown status)', () => {
    const state = mockRichState({ prNumber: 7, prUrl: 'https://gh/pr/7' } as Partial<Workspace>);
    expect(selectWorkspaceActivePrSummary.select(state, WS_ID)).toEqual({
      number: 7,
      url: 'https://gh/pr/7',
      repo: undefined,
      chipLabel: '#7',
      title: undefined,
      status: 'unknown',
      actionLabel: '#7',
      actionTooltip: 'Opens pull request #7 on GitHub in your browser.',
    });
  });

  it('enriches a cross-repo monitor with its repo, title, and snapshot status', () => {
    const state = mockRichState(
      { repositoryOwner: 'acme', repositoryName: 'widgets' } as Partial<Workspace>,
      [
        makeMonitor({
          repo: 'other/lib',
          prNumber: 1373,
          url: 'https://github.com/other/lib/pull/1373',
          title: 'Fix lib',
          lastSnapshot: makeSnapshot({ state: 'merged' }),
        }),
      ],
    );
    expect(selectWorkspaceActivePrSummary.select(state, WS_ID)).toEqual({
      number: 1373,
      url: 'https://github.com/other/lib/pull/1373',
      repo: 'other/lib',
      chipLabel: 'other/lib #1373',
      title: 'Fix lib',
      status: 'merged',
      actionLabel: 'other/lib #1373: Fix lib',
      actionTooltip: 'Opens pull request other/lib#1,373 on GitHub in your browser.',
    });
  });

  it('marks a draft monitored PR from the snapshot draft flag', () => {
    const state = mockRichState(
      { repositoryOwner: 'acme', repositoryName: 'widgets' } as Partial<Workspace>,
      [makeMonitor({ lastSnapshot: makeSnapshot({ isDraft: true }) })],
    );
    expect(selectWorkspaceActivePrSummary.select(state, WS_ID)?.status).toBe('draft');
  });

  it('omits title and reports unknown status for a monitor never polled', () => {
    const state = mockRichState(
      { repositoryOwner: 'acme', repositoryName: 'widgets' } as Partial<Workspace>,
      [makeMonitor({ url: undefined })],
    );
    expect(selectWorkspaceActivePrSummary.select(state, WS_ID)).toEqual({
      number: 77,
      url: 'https://github.com/acme/widgets/pull/77',
      repo: 'acme/widgets',
      chipLabel: 'widgets #77',
      title: undefined,
      status: 'unknown',
      actionLabel: 'widgets #77',
      actionTooltip: 'Opens pull request acme/widgets#77 on GitHub in your browser.',
    });
  });
});
