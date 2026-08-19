/**
 * Token Usage Selectors (renderer)
 */

import { store } from '../../store';
import type { WorkspaceTokenUsageState } from './token-usage-types';
import { emptyWorkspaceTokenUsageState } from './token-usage-types';

/** Select the full token usage state for a workspace (empty fallback). */
export const selectWorkspaceTokenUsage = store.createSelector(
  (state, wsId: string): WorkspaceTokenUsageState =>
    state?.tokenUsage?.byWorkspaceId[wsId] ?? emptyWorkspaceTokenUsageState,
);
