import { store } from '@/store';
import {
  getDividerSession,
  getCurrentlyViewedAgentId,
  getDividerBoundaryStateSnapshot,
} from '../../../../../src/store/renderer/slices/unread-tracking/unread-tracking-projections';
import { getAgentSessionHasStreamingTailMessage } from '../../../../../src/store/renderer/slices/agent-session/agent-session-projections';

export const selectDividerSession = store.createSelector(getDividerSession);
export const selectCurrentlyViewedAgentId = store.createSelector(getCurrentlyViewedAgentId);
export const selectDividerBoundaryStateSnapshot = store.createSelector(
  getDividerBoundaryStateSnapshot,
);
export const selectAgentSessionHasStreamingTailMessage = store.createSelector(
  getAgentSessionHasStreamingTailMessage,
);
