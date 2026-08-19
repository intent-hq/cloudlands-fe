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
