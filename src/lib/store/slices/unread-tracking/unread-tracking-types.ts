/**
 * Types for the unread-tracking Redux slice.
 *
 * Manages unread state for agent messages. An agent is marked as "unread" when
 * a new assistant message arrives AND the user is not currently viewing that agent.
 * State is persisted to localStorage via saga for survival across app refreshes.
 */

export type UnreadTrackingState = {
  /** Ordered list of agent IDs with unread messages (FIFO insertion order). */
  unreadAgentIds: string[];
  /** Maps agent IDs to their workspace IDs (for cross-workspace tab indicators). */
  agentWorkspaceMap: Record<string, string>;
  /** The agent currently being viewed (e.g. open in drawer/panel). */
  currentlyViewedAgentId: string | null;
};

