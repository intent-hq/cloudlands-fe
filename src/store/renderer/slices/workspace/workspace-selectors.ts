import { store } from "../../store";
import type { EnvironmentConfig, PullRequestInfo, Workspace } from "$shared/types";
import { CHIEF_WORKSPACE_ID, type WorkspaceId } from "$shared/types/branded-ids";
import {
  getItem,
  getItems,
} from "ag-redux-toolkit/utils/collections/collection-utils";
import { type WorkspaceRecencyState } from "./workspace-slice";
import { selectIsNewlyCreatedWorkspace } from "../workspace-agents/workspace-agents-selectors";
import {
  selectCurrentStagedWorkingChanges,
  selectCurrentUnstagedWorkingChanges,
  selectFileTrackingCommits,
} from "../changes/changes-selectors";
import { selectGitStatus } from "../git/git-selectors";

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