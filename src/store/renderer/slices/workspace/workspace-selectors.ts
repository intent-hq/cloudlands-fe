import { store } from '../../store';
import type { EnvironmentConfig, PullRequestInfo, Workspace } from '$shared/types';
import { CHIEF_WORKSPACE_ID, type WorkspaceId } from '$shared/types/branded-ids';
import { getItem, getItems } from '$lib/store-shim/utils/collections/collection-utils';
import { type WorkspaceRecencyState } from './workspace-slice';
import { selectIsNewlyCreatedWorkspace } from '../workspace-agents/workspace-agents-selectors';
import {
  selectCurrentStagedWorkingChanges,
  selectCurrentUnstagedWorkingChanges,
  selectFileTrackingCommits,
} from '../changes/changes-selectors';
import { selectGitStatus } from '../git/git-selectors';
import type {
  WorkflowStage,
  WorkspaceProgressAction,
  WorkspaceProgressHeadline,
  WorkspaceProgressInput,
} from './workspace-types';
import { m } from '$shared/paraglide/messages.js';
import { formatInteger, formatNumber } from '$lib/i18n/format';

export const selectActiveWorkspaceId = store.createSelector((state) => {
  return state.workspace.activeWorkspaceId as WorkspaceId | null;
});

export const selectWorkspaceLoading = store.createSelector((state) => {
  return state.workspace.loading;
});

export const selectWorkspaceHasLoaded = store.createSelector((state) => {
  return state.workspace.hasLoaded;
});

export const selectWorkspaceIsCreating = store.createSelector((state) => {
  return state.workspace.isCreating;
});

export const selectWorkspacePendingDeletions = store.createSelector<[], Record<string, boolean>>(
  (state) => {
    return state.workspace.pendingDeletions;
  },
);

export const selectWorkspacePendingCreations = store.createSelector((state) => {
  return state.workspace.pendingCreations;
});

export const selectWorkspaceRecency = store.createSelector((state): WorkspaceRecencyState => {
  return state.workspace.recency;
});

export const selectWorkspacesSortedByRecency = store.createSelector<
  [workspaces: Workspace[]],
  Workspace[]
>((state, workspaces) => {
  return [...workspaces].sort((a, b) => {
    const aTime = state.workspace.recency.lastViewedAt[a.id] ?? 0;
    const bTime = state.workspace.recency.lastViewedAt[b.id] ?? 0;

    if (aTime && bTime) {
      return bTime - aTime;
    }

    if (aTime) return -1;
    if (bTime) return 1;
    return 0;
  });
});

// ---------------------------------------------------------------------------
// Workspace entity selectors
// ---------------------------------------------------------------------------

/**
 * Select a workspace entity by ID from Redux.
 * Returns undefined if not stored yet.
 */
export const selectWorkspaceById = store.createSelector<[wsId: string], Workspace | undefined>(
  (state, wsId) => {
    return getItem(state.workspace.workspaces, wsId as Workspace['id']);
  },
);

export const selectWorkspaceEnvironmentConfig = store.createSelector<
  [wsId: string],
  EnvironmentConfig | undefined
>((state, wsId) => selectWorkspaceById.select(state, wsId)?.environmentConfig);

export const selectWorkspaceItems = store.createSelector<[], Workspace[]>((state) => {
  return getItems(state.workspace.workspaces).filter(
    (workspace) => workspace.id !== CHIEF_WORKSPACE_ID,
  );
});

export const selectWorkspaceIsEmpty = store.createSelector((state) => {
  return state.workspace.workspaces.ids.length === 0;
});

/**
 * Select the active workspace entity from Redux.
 * Resolves `activeWorkspaceId` against the stored workspace collection.
 * Returns undefined if no active workspace or if it hasn't been hydrated yet.
 */
export const selectActiveWorkspace = store.createSelector<[], Workspace | undefined>((state) => {
  const wsId = state.workspace.activeWorkspaceId;
  if (!wsId) return undefined;
  return getItem(state.workspace.workspaces, wsId as Workspace['id']);
});

export const selectCurrentWorkspace = selectActiveWorkspace;

// ---------------------------------------------------------------------------
// Sidebar-specific selectors (stable references for template props)
// ---------------------------------------------------------------------------

/**
 * Returns the active pull request for a workspace, or null if none exists.
 * Uses createSelector's built-in caching so the same reference is
 * returned when the underlying data hasn't changed.
 */
export const selectWorkspaceActivePullRequest = store.createSelector<
  [wsId: string],
  PullRequestInfo | null
>((state, wsId) => {
  const workspace = getItem(state.workspace.workspaces, wsId as Workspace['id']);
  return workspace?.activePullRequest ?? null;
});

/**
 * Returns whether this is a brand-new workspace session (no changes, no commits,
 * viewing the spec). Evaluates to a primitive boolean so it won't cause
 * re-render cycles.
 */
export const selectIsNewWorkspaceSession = store.createSelector<
  [wsId: string, selectedNoteId: string | null],
  boolean
>((state, wsId, selectedNoteId) => {
  const isNewlyCreated = selectIsNewlyCreatedWorkspace.select(state, wsId);
  const staged = selectCurrentStagedWorkingChanges.select(state);
  const unstaged = selectCurrentUnstagedWorkingChanges.select(state);
  const commits = selectFileTrackingCommits.select(state, wsId) ?? [];
  const gitStatus = selectGitStatus.select(state, wsId);
  return !!(
    isNewlyCreated &&
    selectedNoteId === 'spec' &&
    !staged.length &&
    !unstaged.length &&
    !commits.length &&
    !gitStatus?.files.length
  );
});

// ---------------------------------------------------------------------------
// Workspace progress card selectors
//
// Single source of truth for the sidebar progress card's workflow stage,
// headline/subtext copy, and action descriptors. PR identity is read
// AUTHORITATIVELY from the slice (activePullRequest) and resolved ONCE via
// `resolvePrIdentity` so the stage, headline, and actions never disagree
// (fixes the inconsistent "PR #undefined" rendering).
// ---------------------------------------------------------------------------

/**
 * Resolve PR number/url from the authoritative active PR (slice) with a fallback
 * to the lagging `gitStatus.existingPR` snapshot. Single implementation shared by
 * the headline and action selectors so PR identity is consistent everywhere.
 */
function resolvePrIdentity(
  activePR: PullRequestInfo | undefined,
  input: WorkspaceProgressInput,
): { prNumber: number | undefined; prUrl: string | undefined } {
  const existingPR = input.gitStatus?.existingPR;
  return {
    prNumber: activePR?.number ?? existingPR?.number,
    prUrl: activePR?.url ?? existingPR?.htmlUrl,
  };
}

export const selectWorkflowStage = store.createSelector<
  [wsId: string, input: WorkspaceProgressInput],
  WorkflowStage
>((state, wsId, input) => {
  const {
    gitStatus,
    gitStatusLoading,
    taskStats,
    completionRatio,
    isAgentWorking,
    specHasContent,
  } = input;
  const activePR = selectWorkspaceActivePullRequest.select(state, wsId) ?? undefined;

  // Still loading git status - only show loading if we have no cached data to display
  if (gitStatusLoading && !gitStatus) {
    const hasCachedPRData =
      activePR &&
      (activePR.status === 'Open' ||
        activePR.status === 'Draft' ||
        activePR.status === 'Merged' ||
        activePR.status === 'Closed');
    const hasTasks = taskStats.total > 0;
    if (!hasCachedPRData && !hasTasks) {
      return 'loading';
    }
    // Otherwise fall through - use cached data while git status loads
  }

  // If agent is working and no tasks yet, it's creating the spec
  if (isAgentWorking && taskStats.total === 0) {
    return 'spec-creating';
  }

  const hasUncommittedChanges = (gitStatus?.uncommittedCount ?? 0) > 0;
  const hasStagedChanges = (gitStatus?.stagedCount ?? 0) > 0;
  const hasUnpushedCommits = (gitStatus?.localCommits?.filter((c) => !c.isPushed).length ?? 0) > 0;
  const existingPR = gitStatus?.existingPR;
  const hasOpenTasks = taskStats.total > 0 && taskStats.completed < taskStats.total;

  if (existingPR) {
    if (existingPR.state === 'merged' || existingPR.state === 'closed') {
      // PR merged/closed: open tasks, uncommitted/staged changes, or unpushed
      // commits mean there is still new work. The just-merged branch's own
      // commits never read as unpushed here: per-commit `isPushed` is computed
      // against origin/<branch>, and those commits were pushed to open the PR.
      if (!hasUncommittedChanges && !hasStagedChanges && !hasUnpushedCommits && !hasOpenTasks) {
        return 'all-done';
      }
      // Otherwise fall through to the task-based and git-change states.
    } else if (existingPR.state === 'open') {
      if (activePR?.reviewDecision === 'APPROVED') {
        return 'pr-approved';
      }
      return 'pr-open';
    }
  } else if (activePR && (activePR.status === 'Open' || activePR.status === 'Draft')) {
    // gitStatus not loaded yet, but we have cached activePullRequest - use it.
    if (activePR.reviewDecision === 'APPROVED') {
      return 'pr-approved';
    }
    return 'pr-open';
  }

  // Tasks exist but none started
  if (taskStats.total > 0 && completionRatio === 0 && taskStats.inProgress === 0) {
    return 'tasks-ready';
  }

  // Tasks in progress
  if (taskStats.inProgress > 0 || (taskStats.total > 0 && completionRatio < 1)) {
    return 'tasks-in-progress';
  }

  // Unpushed commits (ready to push or create PR)
  if (hasUnpushedCommits && !hasUncommittedChanges) {
    return 'commits-unpushed';
  }

  // Staged changes (ready to commit)
  if (hasStagedChanges) {
    return 'changes-staged';
  }

  // Unstaged changes
  if (hasUncommittedChanges) {
    return 'changes-unstaged';
  }

  // No git changes - check task status
  if (taskStats.total === 0) {
    if (specHasContent) {
      return 'spec-ready';
    }
    return 'spec-empty';
  }

  // All tasks complete, no changes
  return 'all-done';
});

export const selectWorkspaceProgressHeadline = store.createSelector<
  [wsId: string, input: WorkspaceProgressInput],
  WorkspaceProgressHeadline
>((state, wsId, input) => {
  const stage = selectWorkflowStage.select(state, wsId, input);
  const { gitStatus, taskStats, completionRatio } = input;
  const uncommittedCount = gitStatus?.uncommittedCount ?? 0;
  const stagedCount = gitStatus?.stagedCount ?? 0;
  const unpushedCommits = gitStatus?.localCommits?.filter((c) => !c.isPushed) ?? [];
  const existingPR = gitStatus?.existingPR;
  const activePR = selectWorkspaceActivePullRequest.select(state, wsId) ?? undefined;

  switch (stage) {
    case 'loading':
      return { headline: m.workspace_progress_loading_headline(), subtext: '' };

    case 'spec-empty':
      return { headline: m.workspace_progress_specEmpty_headline(), subtext: '' };

    case 'spec-creating':
      return { headline: m.workspace_progress_specCreating_headline(), subtext: '' };

    case 'spec-ready':
      return { headline: m.workspace_progress_ready_headline(), subtext: '' };

    case 'tasks-ready':
      return { headline: m.workspace_progress_tasksReady_headline(), subtext: '' };

    case 'tasks-in-progress': {
      if (completionRatio >= 0.75) {
        const remaining = taskStats.total - taskStats.completed;
        return {
          headline:
            remaining === 1
              ? m.workspace_progress_almostThere_one({ count: formatInteger(remaining) })
              : m.workspace_progress_almostThere_many({ count: formatInteger(remaining) }),
          subtext: '',
        };
      }
      if (completionRatio > 0.1) {
        return {
          headline: m.workspace_progress_percent_headline({
            percent: `${formatNumber(Math.round(completionRatio * 100))}%`,
          }),
          subtext: '',
        };
      }
      return {
        headline: m.workspace_progress_making_headline(),
        subtext:
          taskStats.completed > 0
            ? m.workspace_progress_tasksDone_subtext({
                completed: formatInteger(taskStats.completed),
                total: formatInteger(taskStats.total),
              })
            : '',
      };
    }

    case 'changes-unstaged':
      // Only show file changes summary if tasks have been worked on
      if (taskStats.completed > 0 || taskStats.inProgress > 0) {
        return {
          headline:
            uncommittedCount === 1
              ? m.workspace_progress_reviewChanges_one({ count: formatInteger(uncommittedCount) })
              : m.workspace_progress_reviewChanges_many({ count: formatInteger(uncommittedCount) }),
          subtext: m.workspace_progress_reviewChanges_subtext(),
        };
      }
      if (taskStats.total === 0) {
        return { headline: m.workspace_progress_ready_headline(), subtext: '' };
      }
      return { headline: m.workspace_progress_tasksReady_headline(), subtext: '' };

    case 'changes-staged':
      return {
        headline:
          stagedCount === 1
            ? m.workspace_progress_staged_one({ count: formatInteger(stagedCount) })
            : m.workspace_progress_staged_many({ count: formatInteger(stagedCount) }),
        subtext: '',
      };

    case 'commits-unpushed': {
      // Only an open/draft PR can be updated by a push; after a merge/close the
      // remaining commits need a new PR.
      const prIsUpdatable = existingPR?.state === 'open' || existingPR?.state === 'draft';
      return {
        headline:
          unpushedCommits.length === 1
            ? m.workspace_progress_commitsToPush_one({
                count: formatInteger(unpushedCommits.length),
              })
            : m.workspace_progress_commitsToPush_many({
                count: formatInteger(unpushedCommits.length),
              }),
        subtext: prIsUpdatable
          ? m.workspace_progress_pushUpdate_subtext()
          : m.workspace_progress_pushCreate_subtext(),
      };
    }

    case 'pr-open': {
      const parts: string[] = [];
      if (activePR?.reviewDecision === 'CHANGES_REQUESTED') {
        parts.push(m.workspace_progress_changesRequested_part());
      } else {
        parts.push(m.workspace_progress_awaitingReview_part());
      }
      if (activePR?.ciStatus && activePR.ciStatus.total > 0) {
        const total = formatInteger(activePR.ciStatus.total);
        if (activePR.ciStatus.failed > 0) {
          const failed = formatInteger(activePR.ciStatus.failed);
          parts.push(
            activePR.ciStatus.pending > 0
              ? m.workspace_progress_checksFailingRunning_part({
                  failed,
                  total,
                  pending: formatInteger(activePR.ciStatus.pending),
                })
              : m.workspace_progress_checksFailing_part({ failed, total }),
          );
        } else if (activePR.ciStatus.pending > 0) {
          parts.push(
            m.workspace_progress_checksRunning_part({
              pending: formatInteger(activePR.ciStatus.pending),
              total,
            }),
          );
        } else {
          parts.push(
            m.workspace_progress_checksPassing_part({
              passed: formatInteger(activePR.ciStatus.passed),
              total,
            }),
          );
        }
      }
      const statusDetails = parts.join(', ');
      const { prNumber } = resolvePrIdentity(activePR, input);
      return {
        headline: m.workspace_progress_prOpen_headline({
          number: String(prNumber),
          details: statusDetails,
        }),
        subtext: '',
      };
    }

    case 'pr-approved': {
      let approvedBy = '';
      if (activePR?.approvedBy && activePR.approvedBy.length > 0) {
        approvedBy = ` ${m.workspace_progress_prApprovedBy_part({ names: activePR.approvedBy.join(', ') })}`;
      }
      let ciInfo = '';
      if (activePR?.ciStatus && activePR.ciStatus.total > 0) {
        const total = formatInteger(activePR.ciStatus.total);
        if (activePR.ciStatus.failed > 0) {
          ciInfo = `, ${m.workspace_progress_checksFailing_part({ failed: formatInteger(activePR.ciStatus.failed), total })}`;
        } else if (activePR.ciStatus.pending > 0) {
          ciInfo = `, ${m.workspace_progress_checksPending_part({ pending: formatInteger(activePR.ciStatus.pending), total })}`;
        } else {
          ciInfo = `, ${m.workspace_progress_checksPassing_part({ passed: formatInteger(activePR.ciStatus.passed), total })}`;
        }
      }
      const { prNumber } = resolvePrIdentity(activePR, input);
      return {
        headline: m.workspace_progress_prApproved_headline({
          number: String(prNumber),
          approvedBy,
          ciInfo,
        }),
        subtext: '',
      };
    }

    case 'pr-merged':
    case 'all-done':
      return { headline: m.workspace_progress_allDone_headline(), subtext: '' };

    default:
      return { headline: m.workspace_progress_ready_headline(), subtext: '' };
  }
});

export const selectWorkspaceProgressActions = store.createSelector<
  [wsId: string, input: WorkspaceProgressInput],
  WorkspaceProgressAction[]
>((state, wsId, input) => {
  const stage = selectWorkflowStage.select(state, wsId, input);
  const { taskStats } = input;
  const existingPR = input.gitStatus?.existingPR;
  const activePR = selectWorkspaceActivePullRequest.select(state, wsId) ?? undefined;
  const { prUrl } = resolvePrIdentity(activePR, input);

  // The approved stage retains its dedicated Merge PR action.
  if (stage === 'pr-approved') {
    if (!prUrl) return [];
    return [
      {
        id: 'merge-pr',
        label: m.workspace_progress_mergePr_label(),
        iconKey: 'code-branch',
        tooltip: m.workspace_progress_mergePr_tooltip(),
        url: prUrl,
      },
    ];
  }

  // For every other stage, an openable PR takes priority over the
  // stage-based Review/Commit/Push actions.
  if (prUrl) {
    return [
      {
        id: 'view-pr',
        label: m.workspace_progress_viewPr_label(),
        iconKey: 'code-branch',
        tooltip: m.workspace_progress_viewPr_tooltip(),
        url: prUrl,
      },
    ];
  }

  switch (stage) {
    case 'changes-unstaged':
      // Only offer the review action when tasks have actually been worked on.
      if (taskStats.completed > 0 || taskStats.inProgress > 0) {
        return [
          {
            id: 'review-changes',
            label: m.workspace_progress_reviewAction_label(),
            iconKey: 'file-lines',
            tooltip: m.workspace_progress_reviewAction_tooltip(),
          },
        ];
      }
      return [];

    case 'changes-staged':
      return [
        {
          id: 'commit',
          label: m.workspace_progress_commit_label(),
          iconKey: 'check',
          tooltip: m.workspace_progress_commit_tooltip(),
        },
      ];

    case 'commits-unpushed':
      return [
        {
          id: 'push-or-create-pr',
          label: existingPR
            ? m.workspace_progress_pushChanges_label()
            : m.workspace_progress_createPr_label(),
          iconKey: 'code-pull-request',
          tooltip: existingPR
            ? m.workspace_progress_pushChanges_tooltip()
            : m.workspace_progress_createPr_tooltip(),
        },
      ];

    default:
      return [];
  }
});
