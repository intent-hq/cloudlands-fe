/**
 * Token Usage Selectors (renderer)
 */

import { store } from '../../store';
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import type { TokenUsageCrossFilterRow } from '../../../../features/token-usage/token-usage-types';
import type { WorkspaceTokenUsageState } from './token-usage-types';
import { emptyWorkspaceTokenUsageState } from './token-usage-types';

/** Select the full token usage state for a workspace (empty fallback). */
export const selectWorkspaceTokenUsage = store.createSelector(
  (state, wsId: string): WorkspaceTokenUsageState =>
    state?.tokenUsage?.byWorkspaceId[wsId] ?? emptyWorkspaceTokenUsageState,
);

/** Producer-ordered rows; undefined means the daemon did not supply the projection. */
export const selectWorkspaceTokenUsageCrossFilterRows = store.createSelector(
  (state, wsId: string): TokenUsageCrossFilterRow[] | undefined => {
    const collection = selectWorkspaceTokenUsage.select(state, wsId).byAgentModel;
    return collection === undefined ? undefined : getItems(collection).map((entry) => entry.row);
  },
);
