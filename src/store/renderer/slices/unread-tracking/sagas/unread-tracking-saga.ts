import { createUnreadTrackingSaga } from './unread-tracking-saga-factory';
import * as marker from '$features/agent/mark-agent-seen';
import { clearCachedChatScroll } from '$lib/components/chat/chat-scroll-cache';
import {
  selectAgentMessages,
  selectAgentSessionHasStreamingTailMessage,
} from '../../agent-session/agent-session-selectors';
import {
  selectCurrentlyViewedAgentId,
  selectDividerBoundaryStateSnapshot,
} from '../unread-tracking-selectors';
import { selectCurrentWorkspaceTabId } from '../../tab-state/tab-state-selectors';

// Source root/test compatibility until the Svelte renderer is retired.
import {
  detectDividerSessionBoundary as detectSharedDividerSessionBoundary,
  type DividerSessionBoundary,
} from '../unread-tracking-boundaries';
export type { DividerSessionBoundary } from '../unread-tracking-boundaries';
export const detectDividerSessionBoundary: (
  ...args: Parameters<typeof detectSharedDividerSessionBoundary>
) => DividerSessionBoundary | null = detectSharedDividerSessionBoundary;
export const unreadTrackingSaga = createUnreadTrackingSaga({
  marker,
  clearCachedChatScroll,
  selectAgentMessages,
  selectAgentSessionHasStreamingTailMessage,
  selectCurrentlyViewedAgentId,
  selectDividerBoundaryStateSnapshot,
  selectCurrentWorkspaceTabId,
});
