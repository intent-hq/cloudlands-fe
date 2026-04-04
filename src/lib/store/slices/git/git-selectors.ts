/**
 * Git Selectors
 *
 * Selectors for workspace-scoped git state.
 */

import { createSelector } from "../../utils/create-selector";
import { getGitWorkspaceState } from "./git-slice";

// ── Raw state selectors ──

export const selectGitWorkspaceState = createSelector(
  (state, wsId: string) => getGitWorkspaceState(state.git, wsId)
);

export const selectGitStatus = createSelector(
  (state, wsId: string) => getGitWorkspaceState(state.git, wsId).status
);

export const selectGitCommits = createSelector(
  (state, wsId: string) => getGitWorkspaceState(state.git, wsId).commits
);

export const selectGitDiffs = createSelector(
  (state, wsId: string) => getGitWorkspaceState(state.git, wsId).diffs
);

export const selectGitLoading = createSelector(
  (state, wsId: string) => getGitWorkspaceState(state.git, wsId).loading
);

export const selectGitError = createSelector(
  (state, wsId: string) => getGitWorkspaceState(state.git, wsId).error
);

export const selectGitBranch = createSelector(
  (state, wsId: string) => getGitWorkspaceState(state.git, wsId).branch
);

export const selectGitAhead = createSelector(
  (state, wsId: string) => getGitWorkspaceState(state.git, wsId).ahead
);

export const selectGitBehind = createSelector(
  (state, wsId: string) => getGitWorkspaceState(state.git, wsId).behind
);

// ── Derived selectors ──

export const selectGitHasChanges = createSelector(
  (state, wsId: string) => {
    const status = getGitWorkspaceState(state.git, wsId).status;
    return status ? status.files.length > 0 : false;
  }
);

export const selectGitHasUnstagedChanges = createSelector(
  (state, wsId: string) => {
    const status = getGitWorkspaceState(state.git, wsId).status;
    return status?.files.some((f) => !f.staged) || false;
  }
);

export const selectGitHasStagedChanges = createSelector(
  (state, wsId: string) => {
    const status = getGitWorkspaceState(state.git, wsId).status;
    return status?.files.some((f) => f.staged) || false;
  }
);

export const selectGitHasUnpushedCommits = createSelector(
  (state, wsId: string) => getGitWorkspaceState(state.git, wsId).ahead > 0
);

export const selectGitHasUnpulledCommits = createSelector(
  (state, wsId: string) => getGitWorkspaceState(state.git, wsId).behind > 0
);

export const selectGitUnstagedFiles = createSelector(
  (state, wsId: string) => {
    const status = getGitWorkspaceState(state.git, wsId).status;
    return status?.files.filter((f) => !f.staged) || [];
  }
);

export const selectGitStagedFiles = createSelector(
  (state, wsId: string) => {
    const status = getGitWorkspaceState(state.git, wsId).status;
    return status?.files.filter((f) => f.staged) || [];
  }
);

export const selectGitModifiedFiles = createSelector(
  (state, wsId: string) => {
    const status = getGitWorkspaceState(state.git, wsId).status;
    return status?.files || [];
  }
);

export const selectGitStagedCount = createSelector(
  (state, wsId: string) => {
    const status = getGitWorkspaceState(state.git, wsId).status;
    return status ? status.files.filter((f) => f.staged).length : 0;
  }
);

export const selectGitUnstagedCount = createSelector(
  (state, wsId: string) => {
    const status = getGitWorkspaceState(state.git, wsId).status;
    return status ? status.files.filter((f) => !f.staged).length : 0;
  }
);

export const selectGitIsDiverged = createSelector(
  (state, wsId: string) => {
    const status = getGitWorkspaceState(state.git, wsId).status;
    return status?.diverged ?? false;
  }
);

// ── Sidebar-specific selectors (stable references for template props) ──

type SidebarCommitFile = { path: string; additions: number; deletions: number };
type SidebarCommit = {
  hash: string;
  message: string;
  author: string;
  date: string;
  filesChanged: number;
  isPushed: boolean;
  files: SidebarCommitFile[];
};

const EMPTY_SIDEBAR_COMMITS: SidebarCommit[] = [];
const EMPTY_FILES: SidebarCommitFile[] = [];

/**
 * Returns the unpushed commits formatted for the sidebar component.
 * Uses createSelector's built-in caching so the same array reference is
 * returned when the underlying data hasn't changed.
 */
export const selectSidebarCommits = createSelector<[wsId: string], SidebarCommit[]>(
  (state, wsId) => {
    const gitState = getGitWorkspaceState(state.git, wsId);
    const commits = gitState.commits ?? [];
    const ahead = gitState.ahead ?? 0;
    if (!commits.length || !ahead) return EMPTY_SIDEBAR_COMMITS;
    return commits.slice(0, ahead).map((c) => ({
      hash: c.hash,
      message: c.message,
      author: c.author || "",
      date: c.date || "",
      filesChanged: c.files?.length || 0,
      isPushed: false,
      files: c.files?.map((f: string) => ({ path: f, additions: 0, deletions: 0 })) || EMPTY_FILES,
    }));
  }
);

