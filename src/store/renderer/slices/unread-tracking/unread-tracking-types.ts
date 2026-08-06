/**
 * Types for the unread-tracking Redux slice.
 *
 * Only the currently viewed agent is tracked here (it gates the chat stream
 * lifecycle). Unread state is backend-owned via `workspace.attention`.
 */

/** A latched "New messages" divider viewing session for one agent conversation. */
export type DividerSession = {
  /**
   * Message id the divider anchors at, derived once at conversation entry.
   * `null` means the session started with no divider — none may appear later
   * in the session.
   */
  anchorId: string | null;
};

export type UnreadTrackingState = {
  /** The agent currently being viewed (e.g. open in drawer/panel). */
  currentlyViewedAgentId: string | null;
  /**
   * Per-agent viewing-session latch for the "New messages" divider. Presence
   * of an entry means the viewing session has started (first-write-wins); the
   * latch clears only at stop-looking boundaries (chat tab close, active
   * workspace switch) — never on same-workspace tab deactivation or cached
   * panel destroy. Transient renderer state: app relaunch clears it.
   */
  dividerSessionByAgentId: Record<string, DividerSession>;
};

