/**
 * Types for the unread-tracking Redux slice.
 *
 * Only the currently viewed agent is tracked here (it gates the chat stream
 * lifecycle). Unread state is backend-owned via `workspace.attention`.
 */

export type UnreadTrackingState = {
  /** The agent currently being viewed (e.g. open in drawer/panel). */
  currentlyViewedAgentId: string | null;
};

