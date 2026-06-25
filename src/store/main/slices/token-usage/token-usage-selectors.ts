/**
 * Selectors for the token-usage slice.
 *
 * Plain selectors invoked with an explicit main-process state snapshot.
 */

import { createMainSelector } from "../../create-main-selector";
import type { WorkspaceTokenUsageState } from "./types";
import { emptyWorkspaceTokenUsageState } from "./types";

export const selectWorkspaceTokenUsage = createMainSelector(
  (state, wsId: string): WorkspaceTokenUsageState => {
    return state.tokenUsage.byWorkspaceId[wsId] ?? emptyWorkspaceTokenUsageState;
  },
);

