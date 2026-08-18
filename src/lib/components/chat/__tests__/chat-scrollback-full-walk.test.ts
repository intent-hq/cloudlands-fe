import { describe, expect, it } from 'vitest';

import type { AgentMessage, AgentSession } from '$shared/types';
import {
  agentSessionReducer,
  initialState,
  bulkUpsertSessions,
  prependHistoryMessages,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import type { AgentSessionState } from '$store/renderer/slices/agent-session/agent-session-types';
import {
  selectAgentHistoryMessages,
  selectAgentMessages,
  selectHistorySegmentMeta,
} from '$store/renderer/slices/agent-session/agent-session-selectors';

// ============================================================================
// Deterministic full-walk scrollback harness
//
// Simulates the ChatPanel scrollback pipeline end-to-end WITHOUT a DOM:
// wire-shaped rows drive the REAL reducer + selectors, and (in later
// increments) the real spacer math (splitUnloadedRows / reconcileVirtualSpacer
// / absorbPrependedHeightIntoSpacer) against a simulated viewport with a
// deterministic per-row height table. Ground truth is the full conversation,
// so extent error, blank-viewport overlap, and exhaustion snap are all
// directly assertable.
// ============================================================================

/** Conversation size for the walk scenarios. */
const CONVERSATION_ROWS = 200;
/** Saga page size (tiny-caps PAGE_LIMIT is 10; prod 50). */
const PAGE_ROWS = 10;

const AGENT_ID = 'agent-walk';
const BASE_MS = Date.parse('2026-01-01T00:00:00.000Z');

/** Wire-shaped message: ordinal `i` of the ground-truth conversation. */
function wireMsg(i: number): AgentMessage {
  const role = i % 2 === 0 ? 'user' : 'assistant';
  return {
    id: `m-${String(i).padStart(5, '0')}`,
    role,
    timestamp: new Date(BASE_MS + i * 1000).toISOString(),
    contentBlocks: [{ type: 'text' as const, text: `row ${i} (${role})` }],
  };
}

/** Full ground-truth conversation, oldest → newest. */
function buildConversation(rows = CONVERSATION_ROWS): AgentMessage[] {
  return Array.from({ length: rows }, (_, i) => wireMsg(i));
}

/**
 * Deterministic row height by ordinal: mimics mixed short/long turns.
 * Values chosen to average ~72px so the EMA has real variance to chase.
 */
function rowHeight(i: number): number {
  const cycle = [48, 64, 220, 56, 96, 40, 180, 72][i % 8];
  return cycle;
}

function makeSession(tail: AgentMessage[]): AgentSession {
  return {
    id: AGENT_ID,
    backendSessionId: null,
    workspaceId: 'ws-1',
    name: 'Walk harness agent',
    status: 'idle',
    messages: tail,
    createdAt: new Date(BASE_MS).toISOString(),
    updatedAt: new Date(BASE_MS).toISOString(),
  } as unknown as AgentSession;
}

/** Seed the store with the newest `tailRows` of the conversation as the tail. */
function seedState(conversation: AgentMessage[], tailRows: number): AgentSessionState {
  const tail = conversation.slice(conversation.length - tailRows);
  return agentSessionReducer(
    initialState,
    bulkUpsertSessions([makeSession(tail)], { preserveExplicitRuntimeFlags: false }),
  );
}

/** Wrap slice state for the store-shaped selectors. */
function storeState(agentSessions: AgentSessionState) {
  return { agentSessions } as never;
}

describe('full-walk scrollback harness', () => {
  it('drives one older-history page through the real reducer', () => {
    const conversation = buildConversation();
    const tailRows = 20;
    let state = seedState(conversation, tailRows);

    expect(selectAgentMessages.select(storeState(state), AGENT_ID)).toHaveLength(tailRows);
    expect(rowHeight(0)).toBeGreaterThan(0);

    // The saga's older-history worker pages backwards from the oldest
    // resident row: fetch the PAGE_ROWS rows preceding the tail.
    const oldestResident = conversation.length - tailRows;
    const page = conversation.slice(oldestResident - PAGE_ROWS, oldestResident);
    state = agentSessionReducer(state, prependHistoryMessages(AGENT_ID, page));

    const history = selectAgentHistoryMessages.select(storeState(state), AGENT_ID);
    expect(history).toHaveLength(PAGE_ROWS);
    expect(history[0].id).toBe(conversation[oldestResident - PAGE_ROWS].id);

    const meta = selectHistorySegmentMeta.select(storeState(state), AGENT_ID);
    expect(meta.historyCount).toBe(PAGE_ROWS);
    expect(meta.tailCount).toBe(tailRows);
    expect(meta.gapToTail).toBe(false);
    expect(meta.oldestReached).toBe(false);
  });
});
