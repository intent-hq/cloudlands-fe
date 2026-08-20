/**
 * Sticky-row detection for the chat transcript.
 *
 * Decides which message row (user message or event-wakeup banner) is pinned at
 * the top of the chat scroll container. The detection is hysteretic: the
 * currently-pinned row's stay condition is keyed on its conversation turn's
 * geometry only — never on the sticky element's own rect — so the height change
 * caused by the row's own sticky compaction (line-clamp-6 → line-clamp-2 in
 * ChatMessage) can never un-stick it. Without this, compaction + scroll
 * anchoring formed a per-frame pin/un-pin feedback loop visible as flicker at
 * the top of the chat.
 */

/** A row becomes sticky when its top is within this many pixels of the container top. */
const STICKY_ENTER_THRESHOLD_PX = 20;

/**
 * Compute which message should be sticky given the current scroll geometry.
 *
 * @param scrollContainer - the chat scroll container
 * @param currentStickyId - the currently-pinned message id (hysteresis input)
 * @returns the message id that should be pinned, or null when none
 */
export function detectStickyMessageId(
  scrollContainer: HTMLElement,
  currentStickyId: string | null,
): string | null {
  // Find all user message containers (they have data-message-id and are sticky)
  const messageContainers = scrollContainer.querySelectorAll(
    '.message-nav-target[data-message-id]',
  );

  const scrollRect = scrollContainer.getBoundingClientRect();

  // Check each message to see if it's in sticky position
  for (const container of messageContainers) {
    // For EventWakeupBanner, the sticky element is inside the container
    // For regular messages, the container itself is sticky
    const stickyElement =
      container.querySelector('.sticky') ??
      (container.classList.contains('sticky') ? container : null);
    if (!stickyElement) continue;

    const conversationTurn = container.closest('.conversation-turn');
    if (!conversationTurn) continue;

    const rect = stickyElement.getBoundingClientRect();
    const turnRect = conversationTurn.getBoundingClientRect();

    // The turn "owns" the container top while it spans it: we've scrolled into
    // the turn and its bottom hasn't passed the container top yet.
    const turnSpansTop = turnRect.top < scrollRect.top && turnRect.bottom > scrollRect.top;

    // Hysteresis: the currently-pinned row STAYS pinned while its turn still
    // spans the container top. This stay condition is keyed on the turn's
    // geometry only — never on the sticky element's own rect — so the height
    // change caused by the row's own sticky compaction (line-clamp-6 →
    // line-clamp-2 in ChatMessage) can never un-stick it, and the row keeps
    // its compact rendering while it is pushed out at the end of the turn.
    if (container.getAttribute('data-message-id') === currentStickyId) {
      if (turnSpansTop) {
        return currentStickyId;
      }
      continue;
    }

    // Enter condition: a row becomes sticky when its top is at (or very close
    // to) the scroll container top. The sticky offset is -top-px which is -1px,
    // so check if within a few pixels.
    const isAtStickyPosition = Math.abs(rect.top - scrollRect.top + 1) < STICKY_ENTER_THRESHOLD_PX;

    // The element becomes sticky if:
    // 1. It's at the sticky position (near the top)
    // 2. The turn spans the container top (we've scrolled into the turn)
    // 3. The turn's bottom is still below the sticky element (the turn hasn't scrolled past)
    const turnStillVisible = turnRect.bottom > rect.bottom;
    if (isAtStickyPosition && turnSpansTop && turnStillVisible) {
      return container.getAttribute('data-message-id');
    }
  }

  return null;
}
