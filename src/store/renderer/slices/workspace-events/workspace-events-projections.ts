import { emptyWorkspaceEventsState, type WorkspaceEventsState } from './workspace-events-slice';
export const getDaemonEventsSubscriptionAttempt = (state: {
  workspaceEvents: WorkspaceEventsState;
}) => state.workspaceEvents.subscriptionAttempt;

/** Canonical pagination cursor; the renderer bindings share the original fallback. */
export const getOlderEventsNextToken = (
  state: { workspaceEvents: WorkspaceEventsState },
  workspaceId: string,
): string | null => {
  return (state.workspaceEvents.byWorkspaceId[workspaceId] ?? emptyWorkspaceEventsState).nextToken;
};
