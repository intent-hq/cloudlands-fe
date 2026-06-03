import { store } from "../../store";
import {
  getItem,
  getItems,
} from "ag-redux-toolkit/utils/collections/collection-utils";
import type { SetupScript } from "./setup-scripts-types";

/** Raw scripts collection (includes pending deletions) */
const selectScriptsCollection = store.createSelector(
  (state) => state.setupScripts.scripts
);

/** All visible scripts (excluding pending deletions) */
export const selectScripts = store.createSelector((state) => {
  const items = getItems(state.setupScripts.scripts);
  const pending = state.setupScripts.pendingDeletions;
  const hasAnyPending = Object.keys(pending).length > 0;
  if (!hasAnyPending) return items;
  return items.filter((s) => !pending[s.id]);
});

/** Get a single script by ID */
export const selectScriptById = store.createSelector(
  (state, scriptId: string) => getItem(selectScriptsCollection.select(state), scriptId),
);

/** Get scripts sorted by relevance for a given repo */
export const selectScriptsForRepo = store.createSelector(
  (state, repoPath?: string, projectType?: string) => {
    const items = selectScripts.select(state);
    const sorted = [...items];

    sorted.sort((a, b) => {
      // Same repo gets highest priority
      const aRepoMatch = repoPath && a.repoPath === repoPath;
      const bRepoMatch = repoPath && b.repoPath === repoPath;
      if (aRepoMatch && !bRepoMatch) return -1;
      if (!aRepoMatch && bRepoMatch) return 1;

      // Same project type gets second priority
      const aTypeMatch = projectType && a.projectType === projectType;
      const bTypeMatch = projectType && b.projectType === projectType;
      if (aTypeMatch && !bTypeMatch) return -1;
      if (!aTypeMatch && bTypeMatch) return 1;

      // Otherwise sort by usage count, then by last used
      if (b.usageCount !== a.usageCount) {
        return b.usageCount - a.usageCount;
      }
      return new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime();
    });

    return sorted;
  }
);

/** Get the last used script for a specific repo */
export const selectLastUsedScriptForRepo = store.createSelector(
  (state, repoPath: string) => {
    const items = getItems(state.setupScripts.scripts);
    return items
      .filter((s) => s.repoPath === repoPath)
      .sort(
        (a, b) =>
          new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime()
      )[0] as SetupScript | undefined;
  }
);

/** Check if a script is pending deletion */
export const selectIsPendingDeletion = store.createSelector(
  (state, scriptId: string) => {
    return !!state.setupScripts.pendingDeletions[scriptId];
  }
);

export const selectIsSetupScriptBannerDismissed = store.createSelector(
  (state, workspaceId: string) =>
    state.setupScripts.isBannerDismissedGlobally ||
    state.setupScripts.bannerDismissedByWorkspaceId[workspaceId] === true,
);

export const selectSetupScriptBannerDismissalRecord = store.createSelector((state) => {
  const dismissed: Record<string, boolean> = {};
  if (state.setupScripts.isBannerDismissedGlobally) dismissed._global = true;
  for (const workspaceId of Object.keys(state.setupScripts.bannerDismissedByWorkspaceId)) {
    dismissed[workspaceId] = true;
  }
  return dismissed;
});

