/**
 * Placement decision for the presentation-only "New messages" divider.
 *
 * The daemon persists a per-session `lastSeenMessageId` marker (PROTOCOL §5.5,
 * `agent.markSeen`), served in AgentLite / agent.getSession `metadata` and
 * converged via `agent:updated`. On conversation entry the ChatPanel renders a
 * synthetic divider right after the marker message and starts the viewport
 * there instead of at the bottom.
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
