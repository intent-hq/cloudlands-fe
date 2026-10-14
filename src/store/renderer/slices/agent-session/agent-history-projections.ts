import type { AgentMessage } from '$shared/types';
import type { AgentSessionState } from './agent-session-types';
type HistoryProjectionState = { agentSessions?: AgentSessionState };
const EMPTY_HISTORY_MESSAGES: AgentMessage[] = [];

/** Select the hydrated scrollback history segment rows for a given agent (ordered array). */
export const getAgentHistoryMessages = (
  state: HistoryProjectionState,
  agentId: string,
): AgentMessage[] => {
  const segment = state.agentSessions?.historySegmentsByAgentId?.[agentId];
  return segment ? segment.messages : EMPTY_HISTORY_MESSAGES;
};

/**
 * True when a scrollback history segment RECORD exists for the agent — even
 * with zero hydrated rows (a page whose rows were all tail-resident merges to
 * an empty segment but keeps the record). Segment-clearing paths remove the
 * record entirely.
 */
export const getHasHistorySegment = (state: HistoryProjectionState, agentId: string): boolean =>
  state.agentSessions?.historySegmentsByAgentId?.[agentId] !== undefined;

export interface HistorySegmentMeta {
  /** true when a hole is open between history and the tail. */
  gapToTail: boolean;
  /** true once the conversation's true first message has been hydrated. */
  oldestReached: boolean;
  /** Number of hydrated history rows. */
  historyCount: number;
  /** Number of resident tail rows. */
  tailCount: number;
  /**
   * Estimated conversation ordinal of the segment's first row (seek-seeded
   * segments only); null for serial-walk segments (split by
   * `holeRowsEstimate` instead).
   */
  startOrdinalEstimate: number | null;
  /**
   * Estimated rows inside the open history→tail hole (serial-walk segments:
   * newest-side cap prunes minus gap refills); null when untracked.
   */
  holeRowsEstimate: number | null;
}

/** Select scrollback history segment metadata (gap flag, oldestReached, counts). */
export const getHistorySegmentMeta = (
  state: HistoryProjectionState,
  agentId: string,
): HistorySegmentMeta => {
  const segment = state.agentSessions?.historySegmentsByAgentId?.[agentId];
  const tailCount = state.agentSessions?.byAgentId[agentId]?.messages.length ?? 0;
  return {
    gapToTail: segment?.gapToTail === true,
    oldestReached: segment?.oldestReached === true,
    historyCount: segment?.messages.length ?? 0,
    tailCount,
    startOrdinalEstimate: segment?.startOrdinalEstimate ?? null,
    holeRowsEstimate: segment?.holeRowsEstimate ?? null,
  };
};
