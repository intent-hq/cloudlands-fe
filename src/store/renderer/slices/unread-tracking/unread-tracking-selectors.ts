import { store } from '../../store';
import {
  getDividerSession,
  getCurrentlyViewedAgentId,
  getDividerBoundaryStateSnapshot,
} from './unread-tracking-projections';

import type { DividerBoundaryStateSnapshot } from './unread-tracking-types';

// Source selector/type compatibility until Svelte consumers retire.
export type {
  DividerBoundaryStateSnapshot,
  DividerBoundarySnapshot,
} from './unread-tracking-types';
export const selectDividerSession = store.createSelector(getDividerSession);
export const selectCurrentlyViewedAgentId = store.createSelector(getCurrentlyViewedAgentId);
export const selectDividerBoundaryStateSnapshot = store.createSelector<
  [],
  DividerBoundaryStateSnapshot
>(getDividerBoundaryStateSnapshot);
