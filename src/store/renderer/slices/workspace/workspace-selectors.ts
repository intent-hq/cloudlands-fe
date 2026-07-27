import { store } from "../../store";
import type { EnvironmentConfig, PullRequestInfo, Workspace } from "$shared/types";
import { CHIEF_WORKSPACE_ID, type WorkspaceId } from "$shared/types/branded-ids";
import {
  getItem,
  getItems,
} from "$lib/store-shim/utils/collections/collection-utils";
import { type WorkspaceRecencyState } from "./workspace-slice";
import { selectIsNewlyCreatedWorkspace } from "../workspace-agents/workspace-agents-selectors";
import {
  selectCurrentStagedWorkingChanges,
  selectCurrentUnstagedWorkingChanges,
  selectFileTrackingCommits,
} from "../changes/changes-selectors";
import { selectGitStatus } from "../git/git-selectors";
import type {
  WorkflowStage,
  WorkspaceProgressAction,
  WorkspaceProgressHeadline,
  WorkspaceProgressInput,
} from "./workspace-types";

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

export const selectWorkspacePendingDeletions = store.createSelector<[], Record<string, boolean>>((state) => {
  return state.workspace.pendingDeletions;
});

export const selectWorkspacePendingCreations = store.createSelector((state) => {
  return state.workspace.pendingCreations;
});

export const selectWorkspaceRecency = store.createSelector((state): WorkspaceRecencyState => {
  return state.workspace.recency;
});

export const selectWorkspacesSortedByRecency = store.createSelector<[workspaces: Workspace[]], Workspace[]>(
  (state, workspaces) => {
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
  }
);

// ---------------------------------------------------------------------------
// Workspace entity selectors
// ---------------------------------------------------------------------------

/**
 * Select a workspace entity by ID from Redux.
 * Returns undefined if not stored yet.
 */
export const selectWorkspaceById = store.createSelector<[wsId: string], Workspace | undefined>(
  (state, wsId) => {
    return getItem(state.workspace.workspaces, wsId as Workspace["id"]);
  }
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
  return getItem(state.workspace.workspaces, wsId as Workspace["id"]);
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
  const workspace = getItem(state.workspace.workspaces, wsId as Workspace["id"]);
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
    selectedNoteId === "spec" &&
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
  const { gitStatus, gitStatusLoading, taskStats, completionRatio, isAgentWorking, specHasContent } =
    input;
  const activePR = selectWorkspaceActivePullRequest.select(state, wsId) ?? undefined;

  // Still loading git status - only show loading if we have no cached data to display
  if (gitStatusLoading && !gitStatus) {
    const hasCachedPRData =
      activePR &&
      (activePR.status === "Open" ||
        activePR.status === "Draft" ||
        activePR.status === "Merged" ||
        activePR.status === "Closed");
    const hasTasks = taskStats.total > 0;
    if (!hasCachedPRData && !hasTasks) {
      return "loading";
    }
    // Otherwise fall through - use cached data while git status loads
  }

  // If agent is working and no tasks yet, it's creating the spec
  if (isAgentWorking && taskStats.total === 0) {
    return "spec-creating";
  }

  const hasUncommittedChanges = (gitStatus?.uncommittedCount ?? 0) > 0;
  const hasStagedChanges = (gitStatus?.stagedCount ?? 0) > 0;
  const hasUnpushedCommits =
    (gitStatus?.localCommits?.filter((c) => !c.isPushed).length ?? 0) > 0;
  const existingPR = gitStatus?.existingPR;
  const hasOpenTasks = taskStats.total > 0 && taskStats.completed < taskStats.total;

  if (existingPR) {
    if (existingPR.state === "merged") {
      // PR merged: open tasks or uncommitted changes mean there is still new work.
      if (!hasUncommittedChanges && !hasOpenTasks) {
        return "all-done";
      }
      // Otherwise fall through to the task-based and uncommitted-change states.
    } else if (existingPR.state === "closed") {
      if (!hasOpenTasks) {
        return "all-done";
      }
      // Open tasks remain: fall through to the task-based states.
    } else if (existingPR.state === "open") {
      if (activePR?.reviewDecision === "APPROVED") {
        return "pr-approved";
      }
      return "pr-open";
    }
  } else if (activePR && (activePR.status === "Open" || activePR.status === "Draft")) {
    // gitStatus not loaded yet, but we have cached activePullRequest - use it.
    if (activePR.reviewDecision === "APPROVED") {
      return "pr-approved";
    }
    return "pr-open";
  }

  // Tasks exist but none started
  if (taskStats.total > 0 && completionRatio === 0 && taskStats.inProgress === 0) {
    return "tasks-ready";
  }

  // Tasks in progress
  if (taskStats.inProgress > 0 || (taskStats.total > 0 && completionRatio < 1)) {
    return "tasks-in-progress";
  }

  // Unpushed commits (ready to push or create PR)
  if (hasUnpushedCommits && !hasUncommittedChanges) {
    return "commits-unpushed";
  }

  // Staged changes (ready to commit)
  if (hasStagedChanges) {
    return "changes-staged";
  }

  // Unstaged changes
  if (hasUncommittedChanges) {
    return "changes-unstaged";
  }

  // No git changes - check task status
  if (taskStats.total === 0) {
    if (specHasContent) {
      return "spec-ready";
    }
    return "spec-empty";
  }

  // All tasks complete, no changes
  return "all-done";
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
    case "loading":
      return { headline: "Loading...", subtext: "" };

    case "spec-empty":
      return { headline: "Brainstorm with an agent or write the Spec.", subtext: "" };

    case "spec-creating":
      return { headline: "Agent working on spec.", subtext: "" };

    case "spec-ready":
      return { headline: "Ready to start.", subtext: "" };

    case "tasks-ready":
      return { headline: "Tasks ready to go.", subtext: "" };

    case "tasks-in-progress": {
      if (completionRatio >= 0.75) {
        const remaining = taskStats.total - taskStats.completed;
        return {
          headline: `Almost there! ${remaining} task${remaining === 1 ? "" : "s"} remaining.`,
          subtext: "",
        };
      }
      if (completionRatio > 0.1) {
        return {
          headline: `Things are progressing nicely. We're ${Math.round(completionRatio * 100)}% through the work.`,
          subtext: "",
        };
      }
      return {
        headline: "Making progress.",
        subtext:
          taskStats.completed > 0 ? `${taskStats.completed} of ${taskStats.total} tasks done.` : "",
      };
    }

    case "changes-unstaged":
      // Only show file changes summary if tasks have been worked on
      if (taskStats.completed > 0 || taskStats.inProgress > 0) {
        return {
          headline: `Review ${uncommittedCount} file change${uncommittedCount === 1 ? "" : "s"}`,
          subtext: "Time to review the changes and push.",
        };
      }
      if (taskStats.total === 0) {
        return { headline: "Ready to start.", subtext: "" };
      }
      return { headline: "Tasks ready to go.", subtext: "" };

    case "changes-staged":
      return {
        headline: `${stagedCount} file${stagedCount === 1 ? "" : "s"} staged. Ready to commit.`,
        subtext: "",
      };

    case "commits-unpushed":
      return {
        headline: `${unpushedCommits.length} commit${unpushedCommits.length === 1 ? "" : "s"} to push`,
        subtext: existingPR ? "Push to update PR." : "Push to create a PR.",
      };

    case "pr-open": {
      const parts: string[] = [];
      if (activePR?.reviewDecision === "CHANGES_REQUESTED") {
        parts.push("changes requested");
      } else {
        parts.push("awaiting review");
      }
      if (activePR?.ciStatus && activePR.ciStatus.total > 0) {
        if (activePR.ciStatus.failed > 0) {
          let ciPart = `${activePR.ciStatus.failed}/${activePR.ciStatus.total} checks failing`;
          if (activePR.ciStatus.pending > 0) ciPart += ` (${activePR.ciStatus.pending} running)`;
          parts.push(ciPart);
        } else if (activePR.ciStatus.pending > 0) {
          parts.push(`${activePR.ciStatus.pending}/${activePR.ciStatus.total} checks running`);
        } else {
          parts.push(`${activePR.ciStatus.passed}/${activePR.ciStatus.total} checks passing`);
        }
      }
      const statusDetails = parts.join(", ");
      const { prNumber } = resolvePrIdentity(activePR, input);
      return { headline: `PR #${prNumber} open, ${statusDetails}.`, subtext: "" };
    }

    case "pr-approved": {
      let approvedBy = "";
      if (activePR?.approvedBy && activePR.approvedBy.length > 0) {
        approvedBy = ` by ${activePR.approvedBy.join(", ")}`;
      }
      let ciInfo = "";
      if (activePR?.ciStatus && activePR.ciStatus.total > 0) {
        if (activePR.ciStatus.failed > 0) {
          ciInfo = `, ${activePR.ciStatus.failed}/${activePR.ciStatus.total} checks failing`;
        } else if (activePR.ciStatus.pending > 0) {
          ciInfo = `, ${activePR.ciStatus.pending}/${activePR.ciStatus.total} checks pending`;
        } else {
          ciInfo = `, ${activePR.ciStatus.passed}/${activePR.ciStatus.total} checks passing`;
        }
      }
      const { prNumber } = resolvePrIdentity(activePR, input);
      return {
        headline: `PR #${prNumber} approved${approvedBy}, ready to merge${ciInfo}.`,
        subtext: "",
      };
    }

    case "pr-merged":
    case "all-done":
      return { headline: "All done!", subtext: "" };

    default:
      return { headline: "Ready to start.", subtext: "" };
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
  if (stage === "pr-approved") {
    if (!prUrl) return [];
    return [
      {
        id: "merge-pr",
        label: "Merge PR",
        iconKey: "code-branch",
        tooltip: "Opens the pull request on GitHub to merge.",
        url: prUrl,
      },
    ];
  }

  // For every other stage, an openable PR takes priority over the
  // stage-based Review/Commit/Push actions.
  if (prUrl) {
    return [
      {
        id: "view-pr",
        label: "View PR",
        iconKey: "code-branch",
        tooltip: "Opens the pull request on GitHub in your browser.",
        url: prUrl,
      },
    ];
  }

  switch (stage) {
    case "changes-unstaged":
      // Only offer the review action when tasks have actually been worked on.
      if (taskStats.completed > 0 || taskStats.inProgress > 0) {
        return [
          {
            id: "review-changes",
            label: "Review changes",
            iconKey: "file-lines",
            tooltip: "Opens the changes panel to review, stage, and commit file changes.",
          },
        ];
      }
      return [];

    case "changes-staged":
      return [
        {
          id: "commit",
          label: "Commit",
          iconKey: "check",
          tooltip: "Opens the changes panel to commit your staged changes.",
        },
      ];

    case "commits-unpushed":
      return [
        {
          id: "push-or-create-pr",
          label: existingPR ? "Push changes" : "Create PR",
          iconKey: "code-pull-request",
          tooltip: existingPR
            ? "Opens the changes panel to push commits to your existing PR."
            : "Opens the changes panel to push commits and create a pull request.",
        },
      ];

    default:
      return [];
  }
});