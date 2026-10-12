// Source compatibility bindings remain until the Svelte renderer cutover.
import { getPRStatusLastRefreshTime } from './pr-status-projections';
/**
 * PR Status Selectors
 *
 * Selectors for workspace-scoped PR status state.
 */

import { store } from '../../store';

export const selectPRStatusLastRefreshTime = store.createSelector(getPRStatusLastRefreshTime);
