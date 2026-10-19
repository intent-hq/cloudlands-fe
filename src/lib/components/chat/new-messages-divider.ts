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
 * Unread-entry phase while the initial history window may still be streaming
 * (PROTOCOL §7.1 progressive delivery: newest row first, then one OLDER row
 * per push until `complete`).
 *
 * Because rows arrive newest-first, every row loaded before the seen-marker
 * row is unseen, so the reading point is the top of the loaded content until
 * the marker row lands; once it lands the divider position is final (only
 * older, already-seen rows remain to arrive).
 *
 * - `'none'` — no unread entry applies: no marker, empty transcript, marker at
 *   the newest message, or a dangling marker once the whole conversation is
 *   loaded (`complete` and not `truncated`, e.g. dropped by an
 *   `agent.editAndRegenerate` truncation) — entry follows the bottom.
 * - `'marker-pending'` — transfer incomplete and the marker row has not
 *   arrived yet: every loaded row is unseen.
 * - `'marker-loaded'` — the marker row is loaded and older than the newest
 *   message: the divider anchor is final.
 * - `'marker-beyond-window'` — transfer complete, marker absent, and older
 *   history exists: the marker is older than the initial window, so every
 *   loaded row is unseen and no divider can be placed.
 */
export type UnreadEntryPhase = 'none' | 'marker-pending' | 'marker-loaded' | 'marker-beyond-window';

export function resolveUnreadEntryPhase(
  messageIds: readonly string[],
  lastSeenMessageId: string | null | undefined,
  initialHistory: { complete: boolean; truncated: boolean },
): UnreadEntryPhase {
  if (!lastSeenMessageId || messageIds.length === 0) return 'none';
  const markerIndex = messageIds.indexOf(lastSeenMessageId);
  if (markerIndex === messageIds.length - 1) return 'none';
  if (markerIndex !== -1) return 'marker-loaded';
  if (!initialHistory.complete) return 'marker-pending';
  return initialHistory.truncated ? 'marker-beyond-window' : 'none';
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

/**
 * Fraction of the viewport height (from the top) where the divider's top
 * edge lands on entry — the whole placement contract of
 * `dividerEntryScrollTop`.
 */
export const DIVIDER_ENTRY_VIEWPORT_FRACTION = 0.2;

/**
 * Entry-scroll target when landing on the divider: position the container's
 * scrollTop so the divider's top edge sits at
 * `DIVIDER_ENTRY_VIEWPORT_FRACTION` of the viewport height from the viewport
 * top, maximizing visible unseen content below it.
 *
 * `dividerOffsetTop` is the divider's top edge relative to the scrollable
 * content (container scrollTop + rect delta); `viewportHeight` /
 * `scrollHeight` are the container's clientHeight / scrollHeight. The result
 * is clamped to `[0, maxScrollTop]`.
 */
export function dividerEntryScrollTop(
  dividerOffsetTop: number,
  viewportHeight: number,
  scrollHeight: number,
): number {
  const maxScrollTop = Math.max(0, scrollHeight - viewportHeight);
  const target = dividerOffsetTop - DIVIDER_ENTRY_VIEWPORT_FRACTION * viewportHeight;
  return Math.min(Math.max(0, target), maxScrollTop);
}

/**
 * Turn-boundary placement: when the latched anchor is a turn's LAST rendered
 * message and another turn follows, the divider renders after the inter-turn
 * spacer (directly above the next turn) instead of inside the anchor's turn.
 *
 * Returns `false` (keep the inline after-the-message placement) for mid-turn
 * anchors and for the end-of-transcript case (no following turn).
 */
export function dividerDefersToTurnBoundary(
  anchorId: string | null,
  turnLastRenderedMessageId: string | null | undefined,
  hasFollowingTurn: boolean,
): boolean {
  return anchorId !== null && hasFollowingTurn && anchorId === turnLastRenderedMessageId;
}
