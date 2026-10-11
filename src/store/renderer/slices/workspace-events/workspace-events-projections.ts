import type { WorkspaceEventsState } from './workspace-events-slice';
export const getDaemonEventsSubscriptionAttempt = (state: {
  workspaceEvents: WorkspaceEventsState;
}) => state.workspaceEvents.subscriptionAttempt;
