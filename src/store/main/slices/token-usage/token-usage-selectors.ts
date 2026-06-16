/**
 * Selectors for the token-usage slice.
 *
 * Selectors are created from the configured main-process StreamingStore.
 */

import { store } from "../../configured-store";
import type { WorkspaceTokenUsageState } from "./types";
import { emptyWorkspaceTokenUsageState } from "./types";

export const selectWorkspaceTokenUsage = store.createSelector(
  (state, wsId: string): WorkspaceTokenUsageState => {
    return state.tokenUsage.byWorkspaceId[wsId] ?? emptyWorkspaceTokenUsageState;
  },
);

