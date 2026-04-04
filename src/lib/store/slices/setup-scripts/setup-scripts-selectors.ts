import { createSelector, createCollectionItemSelector } from "../../utils/create-selector";
import { getItems } from "../../utils/collection-utils";
import type { SetupScript } from "./setup-scripts-types";

/** Raw scripts collection (includes pending deletions) */
const selectScriptsCollection = createSelector(
  (state) => state.setupScripts.scripts
);

/** All visible scripts (excluding pending deletions) */
export const selectScripts = createSelector((state) => {
  const items = getItems(state.setupScripts.scripts);
  const pending = state.setupScripts.pendingDeletions;
  const hasAnyPending = Object.keys(pending).length > 0;
  if (!hasAnyPending) return items;
  return items.filter((s) => !pending[s.id]);
});

/** Get a single script by ID */
export const selectScriptById = createCollectionItemSelector<SetupScript, "id">(
  selectScriptsCollection.select
);

/** Get scripts sorted by relevance for a given repo */
export const selectScriptsForRepo = createSelector(
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
export const selectLastUsedScriptForRepo = createSelector(
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
export const selectIsPendingDeletion = createSelector(
  (state, scriptId: string) => {
    return !!state.setupScripts.pendingDeletions[scriptId];
  }
);

