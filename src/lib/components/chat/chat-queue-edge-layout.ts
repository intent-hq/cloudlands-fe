export interface ChatQueueEdgeLayout {
  isChiefWorkspace: boolean;
  isCompactMode: boolean;
  showQueue: boolean;
}

/** The transcript column is the single authority for its outer bottom inset. */
export function chatTranscriptBottomInsetClass({
  isChiefWorkspace,
  isCompactMode,
  showQueue,
}: ChatQueueEdgeLayout): string {
  if (isChiefWorkspace || showQueue) return '';
  return isCompactMode ? 'pb-3' : 'pb-6';
}

/** Keep the semantic end of the scroll surface without adding visible space. */
export const CHAT_SCROLL_END_MARKER_CLASS = 'h-0 min-w-6 shrink-0';

/**
 * Overflow contract for the transcript scroll viewport: vertical scrolling
 * only. Decorative full-bleed elements (e.g. the queued-messages divider,
 * sized against the panel container) may extend past the viewport's content
 * box and must be clipped instead of spawning a horizontal scrollbar.
 */
export const CHAT_TRANSCRIPT_OVERFLOW_CLASS = 'overflow-y-auto overflow-x-hidden';
