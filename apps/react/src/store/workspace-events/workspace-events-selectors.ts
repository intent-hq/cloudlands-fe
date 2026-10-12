import { store } from '@/store';
import {
  getDaemonEventsSubscriptionAttempt,
  getOlderEventsNextToken,
} from '../../../../../src/store/renderer/slices/workspace-events/workspace-events-projections';
export const selectDaemonEventsSubscriptionAttempt = store.createSelector(
  getDaemonEventsSubscriptionAttempt,
);

export const selectOlderEventsNextToken = store.createSelector(getOlderEventsNextToken);
