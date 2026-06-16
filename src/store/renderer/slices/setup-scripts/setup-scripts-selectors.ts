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

