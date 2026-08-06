/**
 * Placement decision for the presentation-only "New messages" divider.
 *
 * The daemon persists a per-session `lastSeenMessageId` marker (PROTOCOL §5.5,
 * `agent.markSeen`), served in AgentLite / agent.getSession `metadata` and
 * converged via `agent:updated`. On conversation entry (first transcript
 * hydration) the ChatPanel derives the anchor ONCE via
 * `resolveNewMessagesDividerAnchor` and latches it in Redux
 * (unreadTracking.dividerSessionByAgentId); rendering and entry scroll then
 * use only the latched anchor (`resolveLatchedDividerAnchor`), so later
 * marker convergence never moves the divider.
 *
 * Returns the id of the message the divider renders after, or `null` when
 * today's behavior applies (no divider, entry scroll-to-bottom):
 * - no marker,
 * - marker at the newest message (nothing unseen),
 * - dangling marker — id not in the transcript (e.g. the row was dropped by an
 *   `agent.editAndRegenerate` truncation).
 */
export function resolveNewMessagesDividerAnchor(
  messageIds: readonly string[],
  lastSeenMessageId: string | null | undefined,
): string | null {
  if (!lastSeenMessageId || messageIds.length === 0) return null;
  const markerIndex = messageIds.indexOf(lastSeenMessageId);
  if (markerIndex === -1) return null;
  if (markerIndex === messageIds.length - 1) return null;
  return lastSeenMessageId;
}

/**
 * Render-time placement from a LATCHED per-session anchor (never recomputed).
 *
 * Returns the anchor id when it is still present in the transcript, or `null`
 * (divider hidden) when:
 * - the session latched `null` — "session started, no divider" — so none may
 *   appear for the rest of the viewing session,
 * - the latched anchor is no longer in the transcript (e.g. dropped by an
 *   `agent.editAndRegenerate` truncation) — hidden, NOT re-derived.
 */
export function resolveLatchedDividerAnchor(
  messageIds: readonly string[],
  latchedAnchorId: string | null | undefined,
): string | null {
  if (!latchedAnchorId) return null;
  return messageIds.includes(latchedAnchorId) ? latchedAnchorId : null;
}

/**
 * Entry-scroll decision: would the divider still be visible with the viewport
 * scrolled fully to the bottom (i.e. does the whole unseen tail fit on
 * screen)?
 *
 * When true, entry behaves like a normal conversation open — scroll to the
 * end and keep auto-follow enabled (the frozen divider stays rendered where
 * it is). Only when the unseen tail is taller than the viewport does entry
 * land at the divider with follow disabled.
 *
 * `dividerOffsetTop` is the divider's top edge relative to the scrollable
 * content (container scrollTop + rect delta); `scrollHeight` /
 * `viewportHeight` are the container's scrollHeight / clientHeight.
 */
export function dividerVisibleWhenScrolledToBottom(
  dividerOffsetTop: number,
  scrollHeight: number,
  viewportHeight: number,
): boolean {
  return scrollHeight - dividerOffsetTop <= viewportHeight;
}
