import { store } from '@/store';
import { getDaemonEventsSubscriptionAttempt } from '../../../../../src/store/renderer/slices/workspace-events/workspace-events-projections';
export const selectDaemonEventsSubscriptionAttempt = store.createSelector(
  getDaemonEventsSubscriptionAttempt,
);
