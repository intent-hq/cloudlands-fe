import { describe, expect, it } from 'vitest';
import type { AgentSession, AgentMessage, QueuedMessage } from '$shared/types';
import type { AgentSessionState } from './agent-session-types';
import type { StoreState } from '../../types';
import { createCollection, getItems } from '../../utils/collection-utils';
import {
  agentSessionReducer,
  initialState,
  upsertSession,
  removeSession,
  setSessionStreaming,
  addMessage,
  removeMessage,
  updateMessage,
  replaceMessages,
  updateSession,
  setQueuedMessages,
  updateDigest,
  renameSession,
  bulkUpsertSessions,
  removeWorkspaceSessions,
  clearAllSessions,
  computeMessageContentHash,
  hasCanonicalId,
  isTimestampClose,
  replaceMessageById,
} from './agent-session-slice';
import {
  addAgentMessage,
  removeAgentMessage,
  replaceAgentMessageById,
  setAgentStreaming,
  upsertAgentSession,
} from '../workspace-agents/workspace-agents-slice';
import { chatSendStarted } from '../chat-state/chat-state-slice';
import {
  selectAgentSession,
  selectAgentSessionsByIds,
  selectAgentMessages,
  selectAgentMessageById,
  selectAgentSessionsByWorkspace,
  selectAllAgentSessions,
  selectAgentIsStreaming,
  selectAgentQueuedMessages,
  selectAllStreamingAgents,
} from './agent-session-selectors';

// ============================================================================
// Helpers
// ============================================================================

function makeMessage(id: string, role: 'user' | 'assistant' = 'user'): AgentMessage {
  return { id, role, timestamp: '2024-01-01T00:00:00.000Z' };
}

/** Like makeMessage but with unique content so content-hash dedup doesn't collapse them. */
function makeUniqueMessage(id: string, role: 'user' | 'assistant' = 'user', timestamp = '2024-01-01T00:00:00.000Z'): AgentMessage {
  return { id, role, timestamp, contentBlocks: [{ type: 'text' as const, text: `content-${id}` }] };
}

function makeSession(
  id: string,
  wsId: string = 'ws-1',
  overrides: Partial<AgentSession> = {},
): AgentSession {
  return {
    id: id as any,
    backendSessionId: null,
    workspaceId: wsId as any,
    name: `Agent ${id}`,
    status: 'idle' as any,
    messages: [],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * Accepts a raw agent-session state shape whose sessions still carry
 * `messages: AgentMessage[]` for test ergonomics and converts each session's
 * `messages` field into the Collection shape expected by the slice at runtime.
 */
function storeWith(agentSessions: {
  byAgentId: Record<string, AgentSession>;
  agentIdsByWorkspace: Record<string, string[]>;
}): StoreState {
  const converted: AgentSessionState = {
    byAgentId: {},
    agentIdsByWorkspace: agentSessions.agentIdsByWorkspace,
  };
  for (const [id, session] of Object.entries(agentSessions.byAgentId)) {
    const messages = Array.isArray(session.messages) ? session.messages : [];
    converted.byAgentId[id] = {
      ...session,
      messages: createCollection<AgentMessage, 'id'>('id', messages),
    };
  }
  return { agentSessions: converted } as unknown as StoreState;
}

/**
 * Test helper: materialize the Collection-backed `messages` field for a stored
 * session back to the ordered `AgentMessage[]` shape that tests historically
 * asserted on. Returns an empty array when the session isn't present.
 */
function getMsgs(state: AgentSessionState, agentId: string): AgentMessage[] {
  const stored = state.byAgentId[agentId];
  return stored ? getItems(stored.messages) : [];
}

// ============================================================================
// Reducer Tests
// ============================================================================

describe('agent-session-slice reducer', () => {
  it('returns initial state', () => {
    const state = agentSessionReducer(undefined, { type: '@@INIT', payload: undefined });
    expect(state).toEqual(initialState);
  });

  describe('upsertSession', () => {
    it('adds a new session and registers in workspace index', () => {
      const session = makeSession('a1', 'ws-1');
      const state = agentSessionReducer(initialState, upsertSession(session));
      expect(state.byAgentId['a1']).toBeDefined();
      expect(state.byAgentId['a1'].name).toBe('Agent a1');
      expect(state.agentIdsByWorkspace['ws-1']).toEqual(['a1']);
    });

    it('normalizes Date objects to ISO strings', () => {
      const session = makeSession('a1', 'ws-1', {
        createdAt: new Date('2024-06-01T12:00:00Z'),
        updatedAt: new Date('2024-06-01T12:00:00Z'),
      });
      const state = agentSessionReducer(initialState, upsertSession(session));
      expect(state.byAgentId['a1'].createdAt).toBe('2024-06-01T12:00:00.000Z');
      expect(state.byAgentId['a1'].updatedAt).toBe('2024-06-01T12:00:00.000Z');
    });

    it('deduplicates messages on upsert', () => {
      const msg = makeMessage('m1');
      const session = makeSession('a1', 'ws-1', { messages: [msg, msg, msg] });
      const state = agentSessionReducer(initialState, upsertSession(session));
      expect(getMsgs(state, 'a1')).toHaveLength(1);
    });

    it('overwrites existing session', () => {
      let state = agentSessionReducer(initialState, upsertSession(makeSession('a1')));
      state = agentSessionReducer(
        state,
        upsertSession(makeSession('a1', 'ws-1', { name: 'Updated' })),
      );
      expect(state.byAgentId['a1'].name).toBe('Updated');
    });

    it('returns same state reference when upserting an equivalent stored session', () => {
      const messages = [makeUniqueMessage('m1'), makeUniqueMessage('m2')];
      const session = makeSession('a1', 'ws-1', { messages });
      const state = agentSessionReducer(initialState, upsertSession(session));

      const next = agentSessionReducer(
        state,
        upsertSession(makeSession('a1', 'ws-1', { messages: [...messages] })),
      );

      expect(next).toBe(state);
    });

    it('keeps the no-op guard bounded to message count and last message ID', () => {
      const messages = [makeUniqueMessage('m1'), makeUniqueMessage('m2')];
      const state = agentSessionReducer(
        initialState,
        upsertSession(makeSession('a1', 'ws-1', { messages })),
      );

      const next = agentSessionReducer(
        state,
        upsertSession(
          makeSession('a1', 'ws-1', {
            messages: [
              { ...messages[0], contentBlocks: [{ type: 'text', text: 'changed' }] },
              messages[1],
            ],
          }),
        ),
      );

      expect(next).toBe(state);
    });
  });

  describe('removeSession', () => {
    it('removes session and cleans workspace index', () => {
      let state = agentSessionReducer(initialState, upsertSession(makeSession('a1', 'ws-1')));
      state = agentSessionReducer(state, removeSession('a1'));
      expect(state.byAgentId['a1']).toBeUndefined();
      expect(state.agentIdsByWorkspace['ws-1']).toBeUndefined();
    });

    it('is a no-op for unknown agentId', () => {
      const state = agentSessionReducer(initialState, removeSession('unknown'));
      expect(state).toBe(initialState);
    });
  });

  describe('setSessionStreaming', () => {
    it('sets isStreaming flag', () => {
      let state = agentSessionReducer(initialState, upsertSession(makeSession('a1')));
      state = agentSessionReducer(state, setSessionStreaming('a1', true));
      expect(state.byAgentId['a1'].isStreaming).toBe(true);
    });

    it('is no-op if value unchanged', () => {
      const state = agentSessionReducer(
        initialState,
        upsertSession(makeSession('a1', 'ws-1', { isStreaming: true })),
      );
      const next = agentSessionReducer(state, setSessionStreaming('a1', true));
      expect(next).toBe(state);
    });
  });

  describe('addMessage', () => {
    it('adds a message to an existing session', () => {
      let state = agentSessionReducer(initialState, upsertSession(makeSession('a1')));
      state = agentSessionReducer(state, addMessage('a1', makeMessage('m1')));
      expect(getMsgs(state, 'a1')).toHaveLength(1);
    });

    it('skips duplicate messages', () => {
      let state = agentSessionReducer(initialState, upsertSession(makeSession('a1')));
      state = agentSessionReducer(state, addMessage('a1', makeMessage('m1')));
      state = agentSessionReducer(state, addMessage('a1', makeMessage('m1')));
      expect(getMsgs(state, 'a1')).toHaveLength(1);
    });

    it('merges messages with the same appMessageId without requiring matching message ids', () => {
      const appMessageId = 'app_msg_same';
      const localMsg = { ...makeUniqueMessage('local-id', 'assistant'), appMessageId };
      const backendMsg = {
        ...makeUniqueMessage('msg_backend', 'assistant'),
        appMessageId,
        metadata: { model: 'test-model' },
      };
      let state = agentSessionReducer(initialState, upsertSession(makeSession('a1')));
      state = agentSessionReducer(state, addMessage('a1', localMsg));
      state = agentSessionReducer(state, addMessage('a1', backendMsg));

      expect(getMsgs(state, 'a1')).toHaveLength(1);
      expect(getMsgs(state, 'a1')[0]).toMatchObject({
        id: 'msg_backend',
        appMessageId,
        metadata: { model: 'test-model' },
      });
    });

    it('is no-op for unknown agentId', () => {
      const state = agentSessionReducer(initialState, addMessage('unknown', makeMessage('m1')));
      expect(state).toBe(initialState);
    });

    it('prunes messages beyond 500', () => {
      const msgs = Array.from({ length: 501 }, (_, i) => makeMessage(`m${i}`));
      let state = agentSessionReducer(
        initialState,
        upsertSession(makeSession('a1', 'ws-1', { messages: [] })),
      );
      for (const msg of msgs) {
        state = agentSessionReducer(state, addMessage('a1', msg));
      }
      expect(getMsgs(state, 'a1')).toHaveLength(500);
      // Should keep the latest messages (m1 .. m500), first message m0 should be pruned
      expect(getMsgs(state, 'a1')[0].id).toBe('m1');
    });
  });

  describe('updateMessage', () => {
    it('updates a message by id', () => {
      const msg = makeMessage('m1', 'user');
      let state = agentSessionReducer(
        initialState,
        upsertSession(makeSession('a1', 'ws-1', { messages: [msg] })),
      );
      state = agentSessionReducer(state, updateMessage('a1', 'm1', { role: 'assistant' }));
      expect(getMsgs(state, 'a1')[0].role).toBe('assistant');
    });

    it('is no-op for unknown message', () => {
      const state = agentSessionReducer(initialState, upsertSession(makeSession('a1')));
      const next = agentSessionReducer(
        state,
        updateMessage('a1', 'unknown', { role: 'assistant' }),
      );
      expect(next).toBe(state);
    });
  });

  describe('replaceMessages', () => {
    it('replaces all messages with dedup/prune', () => {
      const msg = makeMessage('m1');
      let state = agentSessionReducer(
        initialState,
        upsertSession(makeSession('a1', 'ws-1', { messages: [makeMessage('old')] })),
      );
      state = agentSessionReducer(state, replaceMessages('a1', [msg, msg]));
      expect(getMsgs(state, 'a1')).toHaveLength(1);
      expect(getMsgs(state, 'a1')[0].id).toBe('m1');
    });

    it('deduplicates replacement snapshots by appMessageId', () => {
      const appMessageId = 'app_msg_snapshot';
      let state = agentSessionReducer(initialState, upsertSession(makeSession('a1')));
      state = agentSessionReducer(
        state,
        replaceMessages('a1', [
          { ...makeUniqueMessage('local-id', 'assistant'), appMessageId },
          { ...makeUniqueMessage('msg_backend', 'assistant'), appMessageId },
        ]),
      );

      expect(getMsgs(state, 'a1')).toHaveLength(1);
      expect(getMsgs(state, 'a1')[0]).toMatchObject({ id: 'msg_backend', appMessageId });
    });

    it('prefers canonical message identity when same-appMessageId snapshot order is reversed', () => {
      const appMessageId = 'app_msg_reversed';
      const backendMsg: AgentMessage = {
        id: 'msg_backend',
        appMessageId,
        role: 'assistant',
        timestamp: '2024-01-01T00:00:02.000Z',
        contentBlocks: [{ type: 'text', text: 'Final backend content' }],
        metadata: { source: 'backend' },
      };
      const localMsg: AgentMessage = {
        id: 'local-id',
        appMessageId,
        role: 'assistant',
        timestamp: '2024-01-01T00:00:03.000Z',
        contentBlocks: [{ type: 'text', text: 'Stale local content' }],
        metadata: { source: 'local' },
      };
      let state = agentSessionReducer(initialState, upsertSession(makeSession('a1')));
      state = agentSessionReducer(
        state,
        replaceMessages('a1', [backendMsg, localMsg]),
      );

      expect(getMsgs(state, 'a1')).toHaveLength(1);
      expect(getMsgs(state, 'a1')[0]).toMatchObject({
        id: 'msg_backend',
        appMessageId,
        timestamp: '2024-01-01T00:00:02.000Z',
        contentBlocks: [{ type: 'text', text: 'Final backend content' }],
        metadata: { source: 'backend' },
      });
    });
  });

  describe('updateSession', () => {
    it('updates non-message fields', () => {
      let state = agentSessionReducer(initialState, upsertSession(makeSession('a1')));
      state = agentSessionReducer(state, updateSession('a1', { name: 'New Name' }));
      expect(state.byAgentId['a1'].name).toBe('New Name');
    });

    it('handles messages in updates with dedup', () => {
      const msg = makeMessage('m1');
      let state = agentSessionReducer(initialState, upsertSession(makeSession('a1')));
      state = agentSessionReducer(state, updateSession('a1', { messages: [msg, msg] }));
      expect(getMsgs(state, 'a1')).toHaveLength(1);
    });
  });

  describe('setQueuedMessages', () => {
    it('sets queued messages', () => {
      const qm: QueuedMessage = { id: 'q1', content: 'hello', queuedAt: '2024-01-01', position: 0 };
      let state = agentSessionReducer(initialState, upsertSession(makeSession('a1')));
      state = agentSessionReducer(state, setQueuedMessages('a1', [qm]));
      expect(state.byAgentId['a1'].queuedMessages).toHaveLength(1);
    });
  });

  describe('updateDigest', () => {
    it('sets digest', () => {
      let state = agentSessionReducer(initialState, upsertSession(makeSession('a1')));
      state = agentSessionReducer(state, updateDigest('a1', 'summary'));
      expect(state.byAgentId['a1'].digest).toBe('summary');
    });

    it('clears digest with null', () => {
      let state = agentSessionReducer(
        initialState,
        upsertSession(makeSession('a1', 'ws-1', { digest: 'old' })),
      );
      state = agentSessionReducer(state, updateDigest('a1', null));
      expect(state.byAgentId['a1'].digest).toBeUndefined();
    });
  });

  describe('renameSession', () => {
    it('renames session', () => {
      let state = agentSessionReducer(initialState, upsertSession(makeSession('a1')));
      state = agentSessionReducer(state, renameSession('a1', 'New Name'));
      expect(state.byAgentId['a1'].name).toBe('New Name');
    });

    it('is no-op if name unchanged', () => {
      const state = agentSessionReducer(
        initialState,
        upsertSession(makeSession('a1', 'ws-1', { name: 'Same' })),
      );
      const next = agentSessionReducer(state, renameSession('a1', 'Same'));
      expect(next).toBe(state);
    });
  });

  describe('bulkUpsertSessions', () => {
    it('upserts multiple sessions', () => {
      const s1 = makeSession('a1', 'ws-1');
      const s2 = makeSession('a2', 'ws-2');
      const state = agentSessionReducer(initialState, bulkUpsertSessions([s1, s2]));
      expect(Object.keys(state.byAgentId)).toHaveLength(2);
      expect(state.agentIdsByWorkspace['ws-1']).toEqual(['a1']);
      expect(state.agentIdsByWorkspace['ws-2']).toEqual(['a2']);
    });

    it('preserves isStreaming/isProcessing flags from placeholder when incoming omits them', () => {
      // Simulate: chatSendStarted creates placeholder with flags=true
      let state = agentSessionReducer(initialState, chatSendStarted('a1', 'ws-1'));
      expect(state.byAgentId['a1'].isStreaming).toBe(true);
      expect(state.byAgentId['a1'].isProcessing).toBe(true);

      // bulkUpsertSessions arrives with disk data that omits the flags (undefined)
      const diskSession = makeSession('a1', 'ws-1', {
        name: 'Loaded Agent',
      });
      // Remove the flags so they are undefined (not explicitly false)
      delete (diskSession as any).isStreaming;
      delete (diskSession as any).isProcessing;
      state = agentSessionReducer(state, bulkUpsertSessions([diskSession]));

      // Flags should be preserved from the placeholder
      expect(state.byAgentId['a1'].isStreaming).toBe(true);
      expect(state.byAgentId['a1'].isProcessing).toBe(true);
      // But real session data should be applied
      expect(state.byAgentId['a1'].name).toBe('Loaded Agent');
    });

    it('preserves in-flight streaming flags even when incoming has explicit false', () => {
      // Simulate: factory sets streaming=true, then bulkUpsertSessions arrives
      // with disk data that has isStreaming: false. Disk data is stale for
      // ephemeral flags, so the in-flight true must be preserved.
      let state = agentSessionReducer(initialState, chatSendStarted('a1', 'ws-1'));
      expect(state.byAgentId['a1'].isStreaming).toBe(true);
      expect(state.byAgentId['a1'].isProcessing).toBe(true);

      const diskSession = makeSession('a1', 'ws-1', {
        isStreaming: false,
        isProcessing: false,
        name: 'Loaded Agent',
      });
      state = agentSessionReducer(state, bulkUpsertSessions([diskSession]));

      // In-flight true is preserved — disk false is stale
      expect(state.byAgentId['a1'].isStreaming).toBe(true);
      expect(state.byAgentId['a1'].isProcessing).toBe(true);
      expect(state.byAgentId['a1'].name).toBe('Loaded Agent');
    });

    it('does NOT force flags true when existing session had them false', () => {
      const existing = makeSession('a1', 'ws-1', { isStreaming: false, isProcessing: false });
      let state = agentSessionReducer(initialState, upsertSession(existing));

      const incoming = makeSession('a1', 'ws-1', {
        isStreaming: false,
        isProcessing: false,
        name: 'Updated',
      });
      state = agentSessionReducer(state, bulkUpsertSessions([incoming]));

      expect(state.byAgentId['a1'].isStreaming).toBeFalsy();
      expect(state.byAgentId['a1'].isProcessing).toBeFalsy();
    });
  });

  describe('removeWorkspaceSessions', () => {
    it('removes all sessions for a workspace', () => {
      const s1 = makeSession('a1', 'ws-1');
      const s2 = makeSession('a2', 'ws-1');
      const s3 = makeSession('a3', 'ws-2');
      let state = agentSessionReducer(initialState, bulkUpsertSessions([s1, s2, s3]));
      state = agentSessionReducer(state, removeWorkspaceSessions('ws-1'));
      expect(state.byAgentId['a1']).toBeUndefined();
      expect(state.byAgentId['a2']).toBeUndefined();
      expect(state.byAgentId['a3']).toBeDefined();
      expect(state.agentIdsByWorkspace['ws-1']).toBeUndefined();
      expect(state.agentIdsByWorkspace['ws-2']).toEqual(['a3']);
    });
  });

  describe('clearAllSessions', () => {
    it('resets to initial state', () => {
      let state = agentSessionReducer(initialState, upsertSession(makeSession('a1')));
      state = agentSessionReducer(state, clearAllSessions());
      expect(state).toEqual(initialState);
    });
  });
});

// ============================================================================
// Selector Tests
// ============================================================================

describe('agent-session selectors', () => {
  it('selectAgentSession returns session or undefined', () => {
    const session = makeSession('a1');
    const state = storeWith({ byAgentId: { a1: session }, agentIdsByWorkspace: {} });
    expect(selectAgentSession.select(state, 'a1')).toEqual(session);
    expect(selectAgentSession.select(state, 'unknown')).toBeUndefined();
  });

  it('selectAgentSessionsByIds returns only requested sessions', () => {
    const s1 = makeSession('a1');
    const s2 = makeSession('a2');
    const s3 = makeSession('a3');
    const state = storeWith({ byAgentId: { a1: s1, a2: s2, a3: s3 }, agentIdsByWorkspace: {} });
    expect(selectAgentSessionsByIds.select(state, ['a2', 'missing', 'a1'])).toEqual([s2, s1]);
  });

  it('selectAgentMessages returns messages or empty array', () => {
    const msg = makeMessage('m1');
    const session = makeSession('a1', 'ws-1', { messages: [msg] });
    const state = storeWith({ byAgentId: { a1: session }, agentIdsByWorkspace: {} });
    expect(selectAgentMessages.select(state, 'a1')).toEqual([msg]);
    expect(selectAgentMessages.select(state, 'unknown')).toEqual([]);
  });

  it('selectAgentSessionsByWorkspace returns sessions for a workspace', () => {
    const s1 = makeSession('a1', 'ws-1');
    const s2 = makeSession('a2', 'ws-1');
    const state = storeWith({
      byAgentId: { a1: s1, a2: s2 },
      agentIdsByWorkspace: { 'ws-1': ['a1', 'a2'] },
    });
    expect(selectAgentSessionsByWorkspace.select(state, 'ws-1')).toHaveLength(2);
    expect(selectAgentSessionsByWorkspace.select(state, 'ws-2')).toEqual([]);
  });

  it('selectAllAgentSessions returns all sessions', () => {
    const s1 = makeSession('a1');
    const s2 = makeSession('a2');
    const state = storeWith({ byAgentId: { a1: s1, a2: s2 }, agentIdsByWorkspace: {} });
    expect(selectAllAgentSessions.select(state)).toHaveLength(2);
  });

  it('selectAgentIsStreaming returns streaming flag', () => {
    const session = makeSession('a1', 'ws-1', { isStreaming: true });
    const state = storeWith({ byAgentId: { a1: session }, agentIdsByWorkspace: {} });
    expect(selectAgentIsStreaming.select(state, 'a1')).toBe(true);
    expect(selectAgentIsStreaming.select(state, 'unknown')).toBe(false);
  });

  it('selectAgentQueuedMessages returns queued messages or empty array', () => {
    const qm: QueuedMessage = { id: 'q1', content: 'hi', queuedAt: '2024-01-01', position: 0 };
    const session = makeSession('a1', 'ws-1', { queuedMessages: [qm] });
    const state = storeWith({ byAgentId: { a1: session }, agentIdsByWorkspace: {} });
    expect(selectAgentQueuedMessages.select(state, 'a1')).toEqual([qm]);
    expect(selectAgentQueuedMessages.select(state, 'unknown')).toEqual([]);
  });

  it('selectAllStreamingAgents returns only streaming sessions', () => {
    const s1 = makeSession('a1', 'ws-1', { isStreaming: true });
    const s2 = makeSession('a2', 'ws-1', { isStreaming: false });
    const state = storeWith({ byAgentId: { a1: s1, a2: s2 }, agentIdsByWorkspace: {} });
    const streaming = selectAllStreamingAgents.select(state);
    expect(streaming).toHaveLength(1);
    expect(streaming[0].id).toBe('a1');
  });

  describe('selectAgentMessageById', () => {
    it('returns the matching message when agent and message exist (hit)', () => {
      const m1 = makeMessage('m1');
      const m2 = makeMessage('m2', 'assistant');
      const session = makeSession('a1', 'ws-1', { messages: [m1, m2] });
      const state = storeWith({ byAgentId: { a1: session }, agentIdsByWorkspace: {} });
      expect(selectAgentMessageById.select(state, 'a1', 'm2')).toEqual(m2);
    });

    it('returns undefined for an unknown messageId in an existing session (miss)', () => {
      const session = makeSession('a1', 'ws-1', { messages: [makeMessage('m1')] });
      const state = storeWith({ byAgentId: { a1: session }, agentIdsByWorkspace: {} });
      expect(selectAgentMessageById.select(state, 'a1', 'unknown')).toBeUndefined();
    });

    it('returns undefined when the agent session does not exist (no session)', () => {
      const state = storeWith({ byAgentId: {}, agentIdsByWorkspace: {} });
      expect(selectAgentMessageById.select(state, 'a1', 'm1')).toBeUndefined();
    });

    it('returns undefined when agentSessions state is undefined', () => {
      const state = { agentSessions: undefined } as unknown as StoreState;
      expect(selectAgentMessageById.select(state, 'a1', 'm1')).toBeUndefined();
    });

    it('returns undefined when agentId or messageId is empty', () => {
      const session = makeSession('a1', 'ws-1', { messages: [makeMessage('m1')] });
      const state = storeWith({ byAgentId: { a1: session }, agentIdsByWorkspace: {} });
      expect(selectAgentMessageById.select(state, '', 'm1')).toBeUndefined();
      expect(selectAgentMessageById.select(state, 'a1', '')).toBeUndefined();
    });
  });
});

describe('removeMessage (native action)', () => {
  it('removes a message by ID', () => {
    const session = makeSession('a1', 'ws-1', {
      messages: [makeUniqueMessage('m1'), makeUniqueMessage('m2'), makeUniqueMessage('m3')],
    });
    let state = agentSessionReducer(initialState, upsertSession(session));
    state = agentSessionReducer(state, removeMessage('a1', 'm2'));
    expect(getMsgs(state, 'a1')).toHaveLength(2);
    expect(getMsgs(state, 'a1').map((m) => m.id)).toEqual(['m1', 'm3']);
  });

  it('returns same state when message not found', () => {
    const session = makeSession('a1', 'ws-1', {
      messages: [makeMessage('m1')],
    });
    const state = agentSessionReducer(initialState, upsertSession(session));
    const next = agentSessionReducer(state, removeMessage('a1', 'nonexistent'));
    expect(next).toBe(state);
  });

  it('returns same state when agent not found', () => {
    const next = agentSessionReducer(initialState, removeMessage('unknown-agent', 'm1'));
    expect(next).toBe(initialState);
  });
});

describe('removeAgentMessage (cross-slice action)', () => {
  it('atomically removes a message by ID from agent-session state', () => {
    const session = makeSession('a1', 'ws-1', {
      messages: [makeUniqueMessage('m1'), makeUniqueMessage('m2')],
    });
    let state = agentSessionReducer(initialState, upsertSession(session));
    state = agentSessionReducer(state, removeAgentMessage('ws-1', 'a1', 'm1'));
    expect(getMsgs(state, 'a1')).toHaveLength(1);
    expect(getMsgs(state, 'a1')[0].id).toBe('m2');
  });

  it('returns same state when message not found', () => {
    const session = makeSession('a1', 'ws-1', {
      messages: [makeMessage('m1')],
    });
    const state = agentSessionReducer(initialState, upsertSession(session));
    const next = agentSessionReducer(state, removeAgentMessage('ws-1', 'a1', 'nonexistent'));
    expect(next).toBe(state);
  });
});

describe('setAgentStreaming (cross-slice action — single source of truth)', () => {
  it('updates isStreaming in agent-session state via cross-slice handler', () => {
    const session = makeSession('a1', 'ws-1', { isStreaming: false });
    let state = agentSessionReducer(initialState, upsertSession(session));
    expect(state.byAgentId['a1'].isStreaming).toBeFalsy();

    // Dispatch workspace-agents' setAgentStreaming — the cross-slice handler
    // in agent-session-slice should react and update streaming state
    state = agentSessionReducer(state, setAgentStreaming('ws-1', 'a1', true));
    expect(state.byAgentId['a1'].isStreaming).toBe(true);

    state = agentSessionReducer(state, setAgentStreaming('ws-1', 'a1', false));
    expect(state.byAgentId['a1'].isStreaming).toBe(false);
  });

  it('is no-op when agent session does not exist', () => {
    const state = agentSessionReducer(initialState, setAgentStreaming('ws-1', 'unknown', true));
    expect(state).toBe(initialState);
  });

  it('is no-op when streaming value is unchanged', () => {
    const session = makeSession('a1', 'ws-1', { isStreaming: true });
    const state = agentSessionReducer(initialState, upsertSession(session));
    const next = agentSessionReducer(state, setAgentStreaming('ws-1', 'a1', true));
    expect(next).toBe(state);
  });
});

// ===========================================================================
// Regression: chatSendStarted placeholder session for restored workspaces
// ===========================================================================

describe('chatSendStarted — placeholder session (restored workspace regression)', () => {
  it('creates a placeholder session with isProcessing=true when no session exists', () => {
    // Before the fix, chatSendStarted was a no-op when the session didn't exist.
    // In a restored workspace, the session hasn't loaded from disk yet when the
    // user sends a message, so the UI had no loading indicator.
    const state = agentSessionReducer(initialState, chatSendStarted('agent-new', 'ws-1'));

    const session = state.byAgentId['agent-new'];
    expect(session).toBeDefined();
    expect(session.isProcessing).toBe(true);
    expect(session.isStreaming).toBe(true);
    expect(getMsgs(state, 'agent-new')).toEqual([]);
    expect(session.workspaceId).toBe('ws-1');
    // Placeholder should be registered in workspace index
    expect(state.agentIdsByWorkspace['ws-1']).toContain('agent-new');
  });

  it('sets isProcessing and isStreaming on an existing session', () => {
    const existing = makeSession('a1', 'ws-1', { isProcessing: false, isStreaming: false });
    let state = agentSessionReducer(initialState, upsertSession(existing));

    state = agentSessionReducer(state, chatSendStarted('a1', 'ws-1'));

    expect(state.byAgentId['a1'].isProcessing).toBe(true);
    expect(state.byAgentId['a1'].isStreaming).toBe(true);
  });
});

// ===========================================================================
// Regression: upsertAgentSession preserves in-flight flags from placeholder
// ===========================================================================

describe('upsertAgentSession — preserves isProcessing/isStreaming from placeholder (regression)', () => {
  it('preserves isProcessing=true from placeholder when incoming session omits flags', () => {
    // Simulate the restored workspace flow:
    // 1. chatSendStarted creates a placeholder with isProcessing=true
    // 2. The full session loads from disk without flag fields (undefined)
    // The fix ensures the flags are preserved so the UI keeps showing the indicator.
    let state = agentSessionReducer(initialState, chatSendStarted('a1', 'ws-1'));
    expect(state.byAgentId['a1'].isProcessing).toBe(true);
    expect(state.byAgentId['a1'].isStreaming).toBe(true);

    // upsertAgentSession arrives with the real session (flags omitted / undefined)
    const realSession = makeSession('a1', 'ws-1', {
      name: 'Real Agent',
    });
    delete (realSession as any).isProcessing;
    delete (realSession as any).isStreaming;
    state = agentSessionReducer(state, upsertAgentSession('ws-1', realSession));

    // Flags should be preserved from the placeholder
    expect(state.byAgentId['a1'].isProcessing).toBe(true);
    expect(state.byAgentId['a1'].isStreaming).toBe(true);
    // But the real session data should be applied
    expect(state.byAgentId['a1'].name).toBe('Real Agent');
  });

  it('respects explicit false flags over placeholder flags', () => {
    // Safety timeout or explicit clear should win over placeholder flags
    let state = agentSessionReducer(initialState, chatSendStarted('a1', 'ws-1'));
    expect(state.byAgentId['a1'].isProcessing).toBe(true);
    expect(state.byAgentId['a1'].isStreaming).toBe(true);

    const realSession = makeSession('a1', 'ws-1', {
      isProcessing: false,
      isStreaming: false,
      name: 'Real Agent',
    });
    state = agentSessionReducer(state, upsertAgentSession('ws-1', realSession));

    // Explicit false should win
    expect(state.byAgentId['a1'].isProcessing).toBe(false);
    expect(state.byAgentId['a1'].isStreaming).toBe(false);
    expect(state.byAgentId['a1'].name).toBe('Real Agent');
  });

  it('does NOT force flags true when placeholder had them false', () => {
    // If the existing session doesn't have the flags set, don't force them
    const existing = makeSession('a1', 'ws-1', { isProcessing: false, isStreaming: false });
    let state = agentSessionReducer(initialState, upsertSession(existing));

    const incoming = makeSession('a1', 'ws-1', {
      isProcessing: false,
      isStreaming: false,
      name: 'Updated',
    });
    state = agentSessionReducer(state, upsertAgentSession('ws-1', incoming));

    expect(state.byAgentId['a1'].isProcessing).toBeFalsy();
    expect(state.byAgentId['a1'].isStreaming).toBeFalsy();
  });
});


// ============================================================================
// Content-hash helper tests
// ============================================================================

describe('computeMessageContentHash', () => {
  it('produces the same hash for identical text-block messages regardless of ID', () => {
    const a: AgentMessage = {
      id: 'local-uuid-1',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'text', text: 'Hello world' }],
    };
    const b: AgentMessage = {
      id: 'msg_backend-uuid-1',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:05.000Z',
      contentBlocks: [{ type: 'text', text: 'Hello world' }],
    };
    expect(computeMessageContentHash(a)).toBe(computeMessageContentHash(b));
  });

  it('produces different hashes for different roles', () => {
    const a: AgentMessage = {
      id: 'a',
      role: 'user',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'text', text: 'Hello' }],
    };
    const b: AgentMessage = {
      id: 'b',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'text', text: 'Hello' }],
    };
    expect(computeMessageContentHash(a)).not.toBe(computeMessageContentHash(b));
  });

  it('produces different hashes for different content', () => {
    const a: AgentMessage = {
      id: 'a',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'text', text: 'Hello' }],
    };
    const b: AgentMessage = {
      id: 'b',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'text', text: 'Goodbye' }],
    };
    expect(computeMessageContentHash(a)).not.toBe(computeMessageContentHash(b));
  });

  it('handles tool_use blocks deterministically', () => {
    const msg: AgentMessage = {
      id: 'x',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [
        { type: 'tool_use', name: 'read_file', input: { path: 'foo.ts' } },
      ],
    };
    const hash1 = computeMessageContentHash(msg);
    const hash2 = computeMessageContentHash({ ...msg, id: 'y' });
    expect(hash1).toBe(hash2);
  });

  it('returns null for messages with no contentBlocks', () => {
    const msg: AgentMessage = { id: 'x', role: 'assistant', timestamp: '2024-01-01T00:00:00.000Z' };
    const hash = computeMessageContentHash(msg);
    expect(hash).toBeNull();
  });
});

describe('computeMessageContentHash — media blocks', () => {
  it('produces a non-null hash for image-only messages', () => {
    const msg: AgentMessage = {
      id: 'img1',
      role: 'user',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'image', data: 'base64data', mimeType: 'image/png' }],
    };
    expect(computeMessageContentHash(msg)).not.toBeNull();
  });

  it('produces a non-null hash for audio-only messages', () => {
    const msg: AgentMessage = {
      id: 'aud1',
      role: 'user',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'audio', data: 'audiodata', mimeType: 'audio/mp3', transcript: 'hello' }],
    };
    expect(computeMessageContentHash(msg)).not.toBeNull();
  });

  it('produces a non-null hash for file-only messages', () => {
    const msg: AgentMessage = {
      id: 'file1',
      role: 'user',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'file', data: 'filedata', mimeType: 'text/plain', fileName: 'readme.txt' }],
    };
    expect(computeMessageContentHash(msg)).not.toBeNull();
  });

  it('produces the same hash for two logically-equal image messages', () => {
    const a: AgentMessage = {
      id: 'local-uuid',
      role: 'user',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'image', data: 'base64data', mimeType: 'image/png' }],
    };
    const b: AgentMessage = {
      id: 'msg_backend',
      role: 'user',
      timestamp: '2024-01-01T00:00:01.000Z',
      contentBlocks: [{ type: 'image', data: 'base64data', mimeType: 'image/png' }],
    };
    expect(computeMessageContentHash(a)).toBe(computeMessageContentHash(b));
  });

  it('produces the same hash for two logically-equal audio messages', () => {
    const a: AgentMessage = {
      id: 'a1',
      role: 'user',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'audio', data: 'audiodata', mimeType: 'audio/mp3', transcript: 'hi' }],
    };
    const b: AgentMessage = {
      id: 'b1',
      role: 'user',
      timestamp: '2024-01-01T00:00:01.000Z',
      contentBlocks: [{ type: 'audio', data: 'audiodata', mimeType: 'audio/mp3', transcript: 'hi' }],
    };
    expect(computeMessageContentHash(a)).toBe(computeMessageContentHash(b));
  });

  it('produces the same hash for two logically-equal file messages', () => {
    const a: AgentMessage = {
      id: 'a1',
      role: 'user',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'file', data: 'filedata', mimeType: 'text/plain', fileName: 'readme.txt' }],
    };
    const b: AgentMessage = {
      id: 'b1',
      role: 'user',
      timestamp: '2024-01-01T00:00:01.000Z',
      contentBlocks: [{ type: 'file', data: 'filedata', mimeType: 'text/plain', fileName: 'readme.txt' }],
    };
    expect(computeMessageContentHash(a)).toBe(computeMessageContentHash(b));
  });

  it('produces different hashes for images whose data differs in length', () => {
    const a: AgentMessage = {
      id: 'a1',
      role: 'user',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'image', data: 'short', mimeType: 'image/png' }],
    };
    const b: AgentMessage = {
      id: 'b1',
      role: 'user',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'image', data: 'much-longer-payload', mimeType: 'image/png' }],
    };
    expect(computeMessageContentHash(a)).not.toBe(computeMessageContentHash(b));
  });

  it('produces different hashes for images whose data differs in bytes but has the same length', () => {
    // A compact payload fingerprint (djb2) is mixed into the hash alongside
    // mime + length so two distinct same-size images do not collide and cause
    // content-match dedup to replace the wrong message.
    const a: AgentMessage = {
      id: 'a1',
      role: 'user',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }],
    };
    const b: AgentMessage = {
      id: 'b1',
      role: 'user',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'image', data: 'BBBB', mimeType: 'image/png' }],
    };
    expect(computeMessageContentHash(a)).not.toBe(computeMessageContentHash(b));
  });

  it('produces identical hashes for images whose data is byte-identical', () => {
    const a: AgentMessage = {
      id: 'a1',
      role: 'user',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }],
    };
    const b: AgentMessage = {
      id: 'b1',
      role: 'user',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }],
    };
    expect(computeMessageContentHash(a)).toBe(computeMessageContentHash(b));
  });

  it('produces different hashes for audio blocks whose data differs in bytes but has the same length', () => {
    const a: AgentMessage = {
      id: 'a1',
      role: 'user',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'audio', data: 'AAAA', mimeType: 'audio/wav' }],
    };
    const b: AgentMessage = {
      id: 'b1',
      role: 'user',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'audio', data: 'BBBB', mimeType: 'audio/wav' }],
    };
    expect(computeMessageContentHash(a)).not.toBe(computeMessageContentHash(b));
  });

  it('produces different hashes for file blocks whose data differs in bytes but has the same length and name', () => {
    const a: AgentMessage = {
      id: 'a1',
      role: 'user',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [
        { type: 'file', data: 'AAAA', mimeType: 'application/pdf', fileName: 'doc.pdf' },
      ],
    };
    const b: AgentMessage = {
      id: 'b1',
      role: 'user',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [
        { type: 'file', data: 'BBBB', mimeType: 'application/pdf', fileName: 'doc.pdf' },
      ],
    };
    expect(computeMessageContentHash(a)).not.toBe(computeMessageContentHash(b));
  });

  // ---------------------------------------------------------------------
  // Bounded-cost hash for large media payloads
  // ---------------------------------------------------------------------

  // Helper: build a deterministic base64-ish payload of exact `len` with a
  // configurable `marker` at a specific offset so we can vary a single byte.
  function makePayload(len: number, marker: string, markerOffset: number): string {
    const base = 'A'.repeat(len);
    if (markerOffset >= len) return base;
    return base.slice(0, markerOffset) + marker + base.slice(markerOffset + marker.length);
  }

  it('distinguishes large same-length payloads that differ near the start', () => {
    const LEN = 2_000_000; // ~2 MB base64
    const a: AgentMessage = {
      id: 'a', role: 'user', timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'image', data: makePayload(LEN, 'X', 10), mimeType: 'image/png' }],
    };
    const b: AgentMessage = {
      id: 'b', role: 'user', timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'image', data: makePayload(LEN, 'Y', 10), mimeType: 'image/png' }],
    };
    expect(computeMessageContentHash(a)).not.toBe(computeMessageContentHash(b));
  });

  it('distinguishes large same-length payloads that differ near the end', () => {
    const LEN = 2_000_000;
    const a: AgentMessage = {
      id: 'a', role: 'user', timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'image', data: makePayload(LEN, 'X', LEN - 20), mimeType: 'image/png' }],
    };
    const b: AgentMessage = {
      id: 'b', role: 'user', timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'image', data: makePayload(LEN, 'Y', LEN - 20), mimeType: 'image/png' }],
    };
    expect(computeMessageContentHash(a)).not.toBe(computeMessageContentHash(b));
  });

  it('distinguishes large same-length payloads that differ across the interior region', () => {
    // Sampling is intentionally not byte-perfect: a single-byte change at an
    // arbitrary interior offset may or may not land on a sampled position.
    // What matters for real-world dedup is that distinct attachments — which
    // diverge across most of their body — are always distinguished.  Here
    // both payloads share identical head/tail but differ at *every* interior
    // character, guaranteeing divergence at every strided interior sample.
    const LEN = 1_000_000;
    const EDGE = 128;
    const head = 'A'.repeat(EDGE);
    const tail = 'A'.repeat(EDGE);
    const aInterior = 'X'.repeat(LEN - 2 * EDGE);
    const bInterior = 'Y'.repeat(LEN - 2 * EDGE);
    const a: AgentMessage = {
      id: 'a', role: 'user', timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'audio', data: head + aInterior + tail, mimeType: 'audio/wav' }],
    };
    const b: AgentMessage = {
      id: 'b', role: 'user', timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'audio', data: head + bInterior + tail, mimeType: 'audio/wav' }],
    };
    expect(computeMessageContentHash(a)).not.toBe(computeMessageContentHash(b));
  });

  it('produces a deterministic hash for multi-MB payloads (reducer-safe)', () => {
    // Sampling is O(1) in payload size by construction; a correctness check
    // (same input hashes to the same value, back-to-back) is deterministic
    // and CI-safe.  Timing assertions would be flaky across hardware.
    const LEN = 5_000_000;
    const data = 'A'.repeat(LEN);
    const msg: AgentMessage = {
      id: 'big', role: 'user', timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'file', data, mimeType: 'application/octet-stream', fileName: 'blob.bin' }],
    };
    const h1 = computeMessageContentHash(msg);
    const h2 = computeMessageContentHash(msg);
    expect(h1).not.toBeNull();
    expect(h1).toBe(h2);
  });

  it('produces the same hash for tool_use blocks whose input has different key order', () => {
    const a: AgentMessage = {
      id: 'a1',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [
        { type: 'tool_use', name: 'search', input: { query: 'hi', limit: 10, nested: { a: 1, b: 2 } } },
      ],
    };
    const b: AgentMessage = {
      id: 'b1',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [
        { type: 'tool_use', name: 'search', input: { nested: { b: 2, a: 1 }, limit: 10, query: 'hi' } },
      ],
    };
    expect(computeMessageContentHash(a)).toBe(computeMessageContentHash(b));
  });

  it('produces the same hash for tool_result blocks whose output has different key order', () => {
    const a: AgentMessage = {
      id: 'a1',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [
        { type: 'tool_result', tool_use_id: 't1', output: { ok: true, items: [{ x: 1, y: 2 }] } },
      ],
    };
    const b: AgentMessage = {
      id: 'b1',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [
        { type: 'tool_result', tool_use_id: 't1', output: { items: [{ y: 2, x: 1 }], ok: true } },
      ],
    };
    expect(computeMessageContentHash(a)).toBe(computeMessageContentHash(b));
  });

  it('treats undefined object values as absent when hashing tool blocks', () => {
    // stableStringify must match JSON.stringify's treatment of undefined — keys
    // with undefined values should be dropped rather than emitted as `...:undefined`
    // which would produce non-canonical output and break dedup across producers
    // that omit vs. include optional fields.
    const a: AgentMessage = {
      id: 'a1',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [
        { type: 'tool_use', name: 'search', input: { query: 'hi', extra: undefined } },
      ],
    };
    const b: AgentMessage = {
      id: 'b1',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [
        { type: 'tool_use', name: 'search', input: { query: 'hi' } },
      ],
    };
    expect(computeMessageContentHash(a)).toBe(computeMessageContentHash(b));
  });
});

describe('pruneMessages sorts before pruning (prune-after-sort)', () => {
  it('keeps newest messages by timestamp when input exceeds prune limit and is out-of-order', () => {
    // Create 502 messages. The first 2 (by array position) have the NEWEST timestamps,
    // and the remaining 500 have older timestamps. With the old sort(prune(dedup(...)))
    // order, prune would run first on the unsorted list and drop the last 2 by array
    // position (which are actually old messages — correct by accident in-order, but
    // wrong when out-of-order). With the fix prune(sort(dedup(...))), sort runs first,
    // then prune drops the oldest by timestamp.
    const messages: AgentMessage[] = [];
    // Two newest messages placed first in the array (out of order)
    messages.push(makeUniqueMessage('newest-1', 'user', '2025-12-31T23:59:58.000Z'));
    messages.push(makeUniqueMessage('newest-2', 'user', '2025-12-31T23:59:59.000Z'));
    // 500 older messages
    for (let i = 0; i < 500; i++) {
      const ts = `2024-01-01T${String(Math.floor(i / 3600)).padStart(2, '0')}:${String(Math.floor((i % 3600) / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000Z`;
      messages.push(makeUniqueMessage(`old-${i}`, 'user', ts));
    }
    // Total: 502 messages, exceeds MAX_MESSAGES_PER_AGENT (500)

    const session = makeSession('a1', 'ws-1', { messages });
    const state = agentSessionReducer(initialState, upsertSession(session));
    const result = getMsgs(state, 'a1');

    expect(result).toHaveLength(500);
    // The two newest messages MUST survive (they should be at the end after sort+prune)
    const ids = result.map((m) => m.id);
    expect(ids).toContain('newest-1');
    expect(ids).toContain('newest-2');
    // The two oldest messages (old-0 and old-1) should have been pruned
    expect(ids).not.toContain('old-0');
    expect(ids).not.toContain('old-1');
  });
});

describe('hasCanonicalId', () => {
  it('returns true for msg_-prefixed IDs', () => {
    expect(hasCanonicalId('msg_abc-123')).toBe(true);
  });
  it('returns false for plain UUIDs', () => {
    expect(hasCanonicalId('abc-123-def')).toBe(false);
  });
});

describe('isTimestampClose', () => {
  it('returns true when timestamps are within tolerance', () => {
    expect(isTimestampClose('2024-01-01T00:00:00.000Z', '2024-01-01T00:00:05.000Z')).toBe(true);
  });
  it('returns false when timestamps are far apart', () => {
    expect(isTimestampClose('2024-01-01T00:00:00.000Z', '2024-01-01T01:00:00.000Z')).toBe(false);
  });
  it('returns false when first timestamp is undefined (fail-closed)', () => {
    expect(isTimestampClose(undefined, '2024-01-01T00:00:00.000Z', 30_000)).toBe(false);
  });
  it('returns false when second timestamp is undefined (fail-closed)', () => {
    expect(isTimestampClose('2024-01-01T00:00:00.000Z', undefined, 30_000)).toBe(false);
  });
  it('returns false when a timestamp is unparseable (fail-closed)', () => {
    expect(isTimestampClose('garbage-string', '2024-01-01T00:00:00.000Z', 30_000)).toBe(false);
  });
  it('returns true for close timestamps (sanity regression)', () => {
    expect(isTimestampClose('2026-04-15T10:00:00Z', '2026-04-15T10:00:05Z', 30_000)).toBe(true);
  });
  it('returns false for timestamps outside tolerance (out of range)', () => {
    expect(isTimestampClose('2026-04-15T10:00:00Z', '2026-04-15T11:00:00Z', 30_000)).toBe(false);
  });
});

// ============================================================================
// Content-match dedup in reducers
// ============================================================================

describe('addMessage content-match dedup', () => {
  function makeContentMessage(
    id: string,
    role: 'user' | 'assistant',
    text: string,
    ts: string = '2024-01-01T00:00:00.000Z',
  ): AgentMessage {
    return {
      id,
      role,
      timestamp: ts,
      contentBlocks: [{ type: 'text', text }],
    };
  }

  it('replaces local-UUID message with incoming msg_* message when content matches', () => {
    const localMsg = makeContentMessage('local-uuid', 'assistant', 'Hello world');
    let state = agentSessionReducer(initialState, upsertSession(makeSession('a1', 'ws-1', { messages: [localMsg] })));
    const backendMsg = makeContentMessage('msg_backend', 'assistant', 'Hello world', '2024-01-01T00:00:02.000Z');
    state = agentSessionReducer(state, addMessage('a1', backendMsg));
    // Should still have exactly 1 message, with the canonical ID
    expect(getMsgs(state, 'a1')).toHaveLength(1);
    expect(getMsgs(state, 'a1')[0].id).toBe('msg_backend');
  });

  it('replaces local-UUID with incoming msg_* when explicit turnNumber matches', () => {
    const localMsg = { ...makeContentMessage('local-uuid', 'assistant', 'Hello world'), turnNumber: 2 };
    let state = agentSessionReducer(initialState, upsertSession(makeSession('a1', 'ws-1', { messages: [localMsg] })));
    const backendMsg = {
      ...makeContentMessage('msg_backend', 'assistant', 'Hello world', '2024-01-01T00:00:02.000Z'),
      turnNumber: 2,
    };
    state = agentSessionReducer(state, addMessage('a1', backendMsg));
    expect(getMsgs(state, 'a1')).toHaveLength(1);
    expect(getMsgs(state, 'a1')[0].id).toBe('msg_backend');
  });

  it('keeps local-UUID and canonical assistant messages when explicit turnNumbers differ', () => {
    const localMsg = { ...makeContentMessage('local-uuid', 'assistant', 'Hello world'), turnNumber: 1 };
    let state = agentSessionReducer(initialState, upsertSession(makeSession('a1', 'ws-1', { messages: [localMsg] })));
    const backendMsg = {
      ...makeContentMessage('msg_backend', 'assistant', 'Hello world', '2024-01-01T00:00:02.000Z'),
      turnNumber: 2,
    };
    state = agentSessionReducer(state, addMessage('a1', backendMsg));
    expect(getMsgs(state, 'a1').map((m) => m.id)).toEqual(['local-uuid', 'msg_backend']);
  });

  it('skips incoming canonical assistant duplicate when existing msg_* content matches', () => {
    const existing: AgentMessage = {
      id: 'msg_existing',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'tool_use', name: 'read_file', input: { path: 'foo.ts' } }],
    };
    const incoming: AgentMessage = {
      id: 'msg_incoming',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:02.000Z',
      contentBlocks: [{ type: 'tool_use', name: 'read_file', input: { path: 'foo.ts' } }],
    };
    let state = agentSessionReducer(initialState, upsertSession(makeSession('a1', 'ws-1', { messages: [existing] })));
    state = agentSessionReducer(state, addMessage('a1', incoming));
    expect(getMsgs(state, 'a1')).toHaveLength(1);
    expect(getMsgs(state, 'a1')[0].id).toBe('msg_existing');
  });

  it('keeps repeated canonical assistant messages when appMessageIds differ', () => {
    const existing: AgentMessage = {
      id: 'msg_existing',
      appMessageId: 'app_msg_existing',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'text', text: 'Repeated answer' }],
    };
    const incoming: AgentMessage = {
      id: 'msg_incoming',
      appMessageId: 'app_msg_incoming',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:02.000Z',
      contentBlocks: [{ type: 'text', text: 'Repeated answer' }],
    };
    let state = agentSessionReducer(initialState, upsertSession(makeSession('a1', 'ws-1', { messages: [existing] })));
    state = agentSessionReducer(state, addMessage('a1', incoming));
    expect(getMsgs(state, 'a1').map((m) => m.id)).toEqual(['msg_existing', 'msg_incoming']);
  });

  it('does not use content fallback when exactly one message has appMessageId', () => {
    const existing = makeContentMessage('local-uuid', 'assistant', 'Hello world');
    const incoming = {
      ...makeContentMessage('msg_backend', 'assistant', 'Hello world', '2024-01-01T00:00:02.000Z'),
      appMessageId: 'app_msg_incoming',
    };
    let state = agentSessionReducer(initialState, upsertSession(makeSession('a1', 'ws-1', { messages: [existing] })));
    state = agentSessionReducer(state, addMessage('a1', incoming));
    expect(getMsgs(state, 'a1').map((m) => m.id)).toEqual(['local-uuid', 'msg_backend']);
  });

  it('keeps close-timestamp canonical assistant messages from different turns', () => {
    const existing: AgentMessage = {
      id: 'msg_existing',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:00.000Z',
      turnNumber: 1,
      contentBlocks: [{ type: 'text', text: 'Repeated answer' }],
    };
    const incoming: AgentMessage = {
      id: 'msg_incoming',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:02.000Z',
      turnNumber: 2,
      contentBlocks: [{ type: 'text', text: 'Repeated answer' }],
    };
    let state = agentSessionReducer(initialState, upsertSession(makeSession('a1', 'ws-1', { messages: [existing] })));
    state = agentSessionReducer(state, addMessage('a1', incoming));
    expect(getMsgs(state, 'a1')).toHaveLength(2);
  });

  it('still skips a same-turn canonical duplicate after a different-turn repeat', () => {
    const turnOne: AgentMessage = {
      id: 'msg_turn_one',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:00.000Z',
      turnNumber: 1,
      contentBlocks: [{ type: 'text', text: 'Repeated answer' }],
    };
    const turnTwo: AgentMessage = {
      id: 'msg_turn_two',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:01.000Z',
      turnNumber: 2,
      contentBlocks: [{ type: 'text', text: 'Repeated answer' }],
    };
    const turnTwoDuplicate: AgentMessage = {
      id: 'msg_turn_two_duplicate',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:02.000Z',
      turnNumber: 2,
      contentBlocks: [{ type: 'text', text: 'Repeated answer' }],
    };
    let state = agentSessionReducer(
      initialState,
      upsertSession(makeSession('a1', 'ws-1', { messages: [turnOne, turnTwo] })),
    );
    state = agentSessionReducer(state, addMessage('a1', turnTwoDuplicate));
    expect(getMsgs(state, 'a1').map((m) => m.id)).toEqual(['msg_turn_one', 'msg_turn_two']);
  });

  it('does not replace when content differs', () => {
    const localMsg = makeContentMessage('local-uuid', 'assistant', 'Hello world');
    let state = agentSessionReducer(initialState, upsertSession(makeSession('a1', 'ws-1', { messages: [localMsg] })));
    const backendMsg = makeContentMessage('msg_backend', 'assistant', 'Goodbye world', '2024-01-01T00:00:02.000Z');
    state = agentSessionReducer(state, addMessage('a1', backendMsg));
    // Should have 2 messages (no match)
    expect(getMsgs(state, 'a1')).toHaveLength(2);
  });

  it('does not replace when roles differ', () => {
    const localMsg = makeContentMessage('local-uuid', 'user', 'Hello world');
    let state = agentSessionReducer(initialState, upsertSession(makeSession('a1', 'ws-1', { messages: [localMsg] })));
    const backendMsg = makeContentMessage('msg_backend', 'assistant', 'Hello world', '2024-01-01T00:00:02.000Z');
    state = agentSessionReducer(state, addMessage('a1', backendMsg));
    expect(getMsgs(state, 'a1')).toHaveLength(2);
  });

  it('does not replace when timestamps are far apart', () => {
    const localMsg = makeContentMessage('local-uuid', 'assistant', 'Hello world', '2024-01-01T00:00:00.000Z');
    let state = agentSessionReducer(initialState, upsertSession(makeSession('a1', 'ws-1', { messages: [localMsg] })));
    const backendMsg = makeContentMessage('msg_backend', 'assistant', 'Hello world', '2024-01-01T01:00:00.000Z');
    state = agentSessionReducer(state, addMessage('a1', backendMsg));
    expect(getMsgs(state, 'a1')).toHaveLength(2);
  });

  it('does not replace when incoming ID is not canonical', () => {
    const localMsg = makeContentMessage('local-uuid-1', 'assistant', 'Hello world');
    let state = agentSessionReducer(initialState, upsertSession(makeSession('a1', 'ws-1', { messages: [localMsg] })));
    const otherMsg = makeContentMessage('local-uuid-2', 'assistant', 'Hello world', '2024-01-01T00:00:02.000Z');
    state = agentSessionReducer(state, addMessage('a1', otherMsg));
    // Both should remain since the incoming ID isn't canonical
    expect(getMsgs(state, 'a1')).toHaveLength(2);
  });
});

describe('addAgentMessage (cross-slice) content-match dedup', () => {
  function makeContentMessage(
    id: string,
    role: 'user' | 'assistant',
    text: string,
    ts: string = '2024-01-01T00:00:00.000Z',
  ): AgentMessage {
    return { id, role, timestamp: ts, contentBlocks: [{ type: 'text', text }] };
  }

  it('replaces local-UUID message with incoming msg_* message when content matches', () => {
    const localMsg = makeContentMessage('local-uuid', 'assistant', 'Reply text');
    let state = agentSessionReducer(initialState, upsertSession(makeSession('a1', 'ws-1', { messages: [localMsg] })));
    const backendMsg = makeContentMessage('msg_canonical', 'assistant', 'Reply text', '2024-01-01T00:00:03.000Z');
    state = agentSessionReducer(state, addAgentMessage('ws-1', 'a1', backendMsg));
    expect(getMsgs(state, 'a1')).toHaveLength(1);
    expect(getMsgs(state, 'a1')[0].id).toBe('msg_canonical');
  });

  it('keeps local-UUID and canonical assistant messages when explicit turnNumbers differ', () => {
    const localMsg = { ...makeContentMessage('local-uuid', 'assistant', 'Reply text'), turnNumber: 1 };
    let state = agentSessionReducer(initialState, upsertSession(makeSession('a1', 'ws-1', { messages: [localMsg] })));
    const backendMsg = {
      ...makeContentMessage('msg_canonical', 'assistant', 'Reply text', '2024-01-01T00:00:03.000Z'),
      turnNumber: 2,
    };
    state = agentSessionReducer(state, addAgentMessage('ws-1', 'a1', backendMsg));
    expect(getMsgs(state, 'a1').map((m) => m.id)).toEqual(['local-uuid', 'msg_canonical']);
  });

  it('skips incoming canonical assistant duplicate when existing msg_* content matches', () => {
    const existing = makeContentMessage('msg_existing', 'assistant', 'Reply text');
    let state = agentSessionReducer(initialState, upsertSession(makeSession('a1', 'ws-1', { messages: [existing] })));
    const incoming = makeContentMessage('msg_incoming', 'assistant', 'Reply text', '2024-01-01T00:00:03.000Z');
    state = agentSessionReducer(state, addAgentMessage('ws-1', 'a1', incoming));
    expect(getMsgs(state, 'a1')).toHaveLength(1);
    expect(getMsgs(state, 'a1')[0].id).toBe('msg_existing');
  });

  it('keeps different turns but skips the matching same-turn canonical duplicate', () => {
    const turnOne = { ...makeContentMessage('msg_turn_one', 'assistant', 'Reply text'), turnNumber: 1 };
    const turnTwo = {
      ...makeContentMessage('msg_turn_two', 'assistant', 'Reply text', '2024-01-01T00:00:01.000Z'),
      turnNumber: 2,
    };
    const turnTwoDuplicate = {
      ...makeContentMessage('msg_turn_two_duplicate', 'assistant', 'Reply text', '2024-01-01T00:00:02.000Z'),
      turnNumber: 2,
    };
    let state = agentSessionReducer(
      initialState,
      upsertSession(makeSession('a1', 'ws-1', { messages: [turnOne, turnTwo] })),
    );
    state = agentSessionReducer(state, addAgentMessage('ws-1', 'a1', turnTwoDuplicate));
    expect(getMsgs(state, 'a1').map((m) => m.id)).toEqual(['msg_turn_one', 'msg_turn_two']);
  });
});

describe('replaceMessageById', () => {
  it('replaces a message in-place preserving array position', () => {
    const msgA: AgentMessage = {
      id: 'msg_a', role: 'user', timestamp: '2024-01-01T00:00:10.000Z',
      contentBlocks: [{ type: 'text', text: 'First' }],
    };
    const localB: AgentMessage = {
      id: 'local-uuid-b', role: 'assistant', timestamp: '2024-01-01T00:00:20.000Z',
      contentBlocks: [{ type: 'text', text: 'Middle' }],
    };
    const msgC: AgentMessage = {
      id: 'msg_c', role: 'user', timestamp: '2024-01-01T00:00:30.000Z',
      contentBlocks: [{ type: 'text', text: 'Third' }],
    };
    let state = agentSessionReducer(initialState, upsertSession(makeSession('a1', 'ws-1', { messages: [msgA, localB, msgC] })));
    const canonicalB: AgentMessage = {
      id: 'msg_b_canonical', role: 'assistant', timestamp: '2024-01-01T00:00:20.000Z',
      contentBlocks: [{ type: 'text', text: 'Middle' }],
    };
    state = agentSessionReducer(state, replaceMessageById('a1', 'local-uuid-b', canonicalB));
    const msgs = getMsgs(state, 'a1');
    expect(msgs).toHaveLength(3);
    expect(msgs[0].id).toBe('msg_a');
    expect(msgs[1].id).toBe('msg_b_canonical');
    expect(msgs[2].id).toBe('msg_c');
  });

  it('is a no-op when oldId is not found', () => {
    const msg: AgentMessage = {
      id: 'msg_a', role: 'user', timestamp: '2024-01-01T00:00:10.000Z',
      contentBlocks: [{ type: 'text', text: 'Hello' }],
    };
    let state = agentSessionReducer(initialState, upsertSession(makeSession('a1', 'ws-1', { messages: [msg] })));
    const replacement: AgentMessage = {
      id: 'msg_new', role: 'user', timestamp: '2024-01-01T00:00:10.000Z',
      contentBlocks: [{ type: 'text', text: 'Hello' }],
    };
    const before = state;
    state = agentSessionReducer(state, replaceMessageById('a1', 'nonexistent-id', replacement));
    expect(state).toBe(before);
  });

  it('preserves position even when new timestamp would sort to end', () => {
    const m1: AgentMessage = {
      id: 'msg_m1', role: 'user', timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'text', text: 'First' }],
    };
    const m2: AgentMessage = {
      id: 'msg_m2', role: 'assistant', timestamp: '2024-01-01T00:00:10.000Z',
      contentBlocks: [{ type: 'text', text: 'Second' }],
    };
    const m3: AgentMessage = {
      id: 'msg_m3', role: 'user', timestamp: '2024-01-01T00:00:20.000Z',
      contentBlocks: [{ type: 'text', text: 'Third' }],
    };
    let state = agentSessionReducer(initialState, upsertSession(makeSession('a1', 'ws-1', { messages: [m1, m2, m3] })));
    const newMsg: AgentMessage = {
      id: 'msg_new', role: 'assistant', timestamp: '2024-01-01T00:01:40.000Z',
      contentBlocks: [{ type: 'text', text: 'Second' }],
    };
    state = agentSessionReducer(state, replaceMessageById('a1', 'msg_m2', newMsg));
    const msgs = getMsgs(state, 'a1');
    expect(msgs).toHaveLength(3);
    expect(msgs[0].id).toBe('msg_m1');
    expect(msgs[1].id).toBe('msg_new');
    expect(msgs[2].id).toBe('msg_m3');
  });

  it('drops a stale duplicate when the replacement ID already exists elsewhere', () => {
    const local: AgentMessage = {
      id: 'local-uuid', role: 'assistant', timestamp: '2024-01-01T00:00:10.000Z',
      contentBlocks: [{ type: 'text', text: 'Reply' }],
    };
    const canonicalAlreadyThere: AgentMessage = {
      id: 'msg_canonical', role: 'assistant', timestamp: '2024-01-01T00:00:11.000Z',
      contentBlocks: [{ type: 'text', text: 'Reply' }],
    };
    let state = agentSessionReducer(
      initialState,
      upsertSession(makeSession('a1', 'ws-1', { messages: [local, canonicalAlreadyThere] })),
    );
    state = agentSessionReducer(state, replaceMessageById('a1', 'local-uuid', canonicalAlreadyThere));
    const msgs = getMsgs(state, 'a1');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].id).toBe('msg_canonical');
  });

  it('drops a stale canonical assistant duplicate with a different ID', () => {
    const local: AgentMessage = {
      id: 'local-uuid', role: 'assistant', timestamp: '2024-01-01T00:00:10.000Z',
      contentBlocks: [{ type: 'text', text: 'Draft reply' }],
    };
    const existingCanonical: AgentMessage = {
      id: 'msg_existing', role: 'assistant', timestamp: '2024-01-01T00:00:11.000Z',
      contentBlocks: [{ type: 'text', text: 'Final reply' }],
    };
    const replacement: AgentMessage = {
      id: 'msg_replacement', role: 'assistant', timestamp: '2024-01-01T00:00:12.000Z',
      contentBlocks: [{ type: 'text', text: 'Final reply' }],
    };
    let state = agentSessionReducer(
      initialState,
      upsertSession(makeSession('a1', 'ws-1', { messages: [local, existingCanonical] })),
    );
    state = agentSessionReducer(state, replaceMessageById('a1', 'local-uuid', replacement));
    const msgs = getMsgs(state, 'a1');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].id).toBe('msg_replacement');
  });
});

describe('replaceAgentMessageById', () => {
  it('preserves position even when new timestamp would sort to end', () => {
    const m1: AgentMessage = {
      id: 'msg_m1', role: 'user', timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'text', text: 'First' }],
    };
    const m2: AgentMessage = {
      id: 'msg_m2', role: 'assistant', timestamp: '2024-01-01T00:00:10.000Z',
      contentBlocks: [{ type: 'text', text: 'Second' }],
    };
    const m3: AgentMessage = {
      id: 'msg_m3', role: 'user', timestamp: '2024-01-01T00:00:20.000Z',
      contentBlocks: [{ type: 'text', text: 'Third' }],
    };
    let state = agentSessionReducer(initialState, upsertSession(makeSession('a1', 'ws-1', { messages: [m1, m2, m3] })));
    const newMsg: AgentMessage = {
      id: 'msg_new', role: 'assistant', timestamp: '2024-01-01T00:01:40.000Z',
      contentBlocks: [{ type: 'text', text: 'Second' }],
    };
    state = agentSessionReducer(state, replaceAgentMessageById('ws-1', 'a1', 'msg_m2', newMsg));
    const msgs = getMsgs(state, 'a1');
    expect(msgs).toHaveLength(3);
    expect(msgs[0].id).toBe('msg_m1');
    expect(msgs[1].id).toBe('msg_new');
    expect(msgs[2].id).toBe('msg_m3');
  });

  it('drops a stale duplicate when the replacement ID already exists elsewhere', () => {
    const local: AgentMessage = {
      id: 'local-uuid', role: 'assistant', timestamp: '2024-01-01T00:00:10.000Z',
      contentBlocks: [{ type: 'text', text: 'Reply' }],
    };
    const canonicalAlreadyThere: AgentMessage = {
      id: 'msg_canonical', role: 'assistant', timestamp: '2024-01-01T00:00:11.000Z',
      contentBlocks: [{ type: 'text', text: 'Reply' }],
    };
    let state = agentSessionReducer(
      initialState,
      upsertSession(makeSession('a1', 'ws-1', { messages: [local, canonicalAlreadyThere] })),
    );
    state = agentSessionReducer(state, replaceAgentMessageById('ws-1', 'a1', 'local-uuid', canonicalAlreadyThere));
    const msgs = getMsgs(state, 'a1');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].id).toBe('msg_canonical');
  });

  it('drops a stale canonical assistant duplicate with a different ID', () => {
    const local: AgentMessage = {
      id: 'local-uuid', role: 'assistant', timestamp: '2024-01-01T00:00:10.000Z',
      contentBlocks: [{ type: 'text', text: 'Draft reply' }],
    };
    const existingCanonical: AgentMessage = {
      id: 'msg_existing', role: 'assistant', timestamp: '2024-01-01T00:00:11.000Z',
      contentBlocks: [{ type: 'text', text: 'Final reply' }],
    };
    const replacement: AgentMessage = {
      id: 'msg_replacement', role: 'assistant', timestamp: '2024-01-01T00:00:12.000Z',
      contentBlocks: [{ type: 'text', text: 'Final reply' }],
    };
    let state = agentSessionReducer(
      initialState,
      upsertSession(makeSession('a1', 'ws-1', { messages: [local, existingCanonical] })),
    );
    state = agentSessionReducer(
      state,
      replaceAgentMessageById('ws-1', 'a1', 'local-uuid', replacement),
    );
    const msgs = getMsgs(state, 'a1');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].id).toBe('msg_replacement');
  });
});

describe('deduplicateMessages content-hash tiebreaker', () => {
  it('collapses content-duplicate messages keeping msg_* ID on upsert', () => {
    const localMsg: AgentMessage = {
      id: 'local-uuid',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'text', text: 'Duplicate content' }],
    };
    const canonicalMsg: AgentMessage = {
      id: 'msg_canonical',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:02.000Z',
      contentBlocks: [{ type: 'text', text: 'Duplicate content' }],
    };
    // upsertSession runs deduplicateMessages internally
    const session = makeSession('a1', 'ws-1', { messages: [localMsg, canonicalMsg] });
    const state = agentSessionReducer(initialState, upsertSession(session));
    expect(getMsgs(state, 'a1')).toHaveLength(1);
    expect(getMsgs(state, 'a1')[0].id).toBe('msg_canonical');
  });

  it('uses legacy content fallback when both appMessageIds are missing', () => {
    const localMsg: AgentMessage = {
      id: 'local-uuid',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'text', text: 'Legacy duplicate content' }],
    };
    const canonicalMsg: AgentMessage = {
      id: 'msg_canonical',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:02.000Z',
      contentBlocks: [{ type: 'text', text: 'Legacy duplicate content' }],
    };
    const state = agentSessionReducer(
      initialState,
      upsertSession(makeSession('a1', 'ws-1', { messages: [localMsg, canonicalMsg] })),
    );
    expect(getMsgs(state, 'a1').map((m) => m.id)).toEqual(['msg_canonical']);
  });

  it('does not use legacy content fallback when exactly one message has appMessageId on upsert', () => {
    const localMsg: AgentMessage = {
      id: 'local-uuid',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'text', text: 'Duplicate content' }],
    };
    const canonicalMsg: AgentMessage = {
      id: 'msg_canonical',
      appMessageId: 'app_msg_canonical',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:02.000Z',
      contentBlocks: [{ type: 'text', text: 'Duplicate content' }],
    };
    const session = makeSession('a1', 'ws-1', { messages: [localMsg, canonicalMsg] });
    const state = agentSessionReducer(initialState, upsertSession(session));
    expect(getMsgs(state, 'a1').map((m) => m.id)).toEqual(['local-uuid', 'msg_canonical']);
  });

  it('does not use legacy content fallback when appMessageIds differ on upsert', () => {
    const firstCanonical: AgentMessage = {
      id: 'msg_first',
      appMessageId: 'app_msg_first',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'text', text: 'Repeated answer' }],
    };
    const secondCanonical: AgentMessage = {
      id: 'msg_second',
      appMessageId: 'app_msg_second',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:02.000Z',
      contentBlocks: [{ type: 'text', text: 'Repeated answer' }],
    };
    const session = makeSession('a1', 'ws-1', { messages: [firstCanonical, secondCanonical] });
    const state = agentSessionReducer(initialState, upsertSession(session));
    expect(getMsgs(state, 'a1').map((m) => m.id)).toEqual(['msg_first', 'msg_second']);
  });

  it('keeps local-UUID and canonical messages on upsert when explicit turnNumbers differ', () => {
    const localMsg: AgentMessage = {
      id: 'local-uuid',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:00.000Z',
      turnNumber: 1,
      contentBlocks: [{ type: 'text', text: 'Duplicate content' }],
    };
    const canonicalMsg: AgentMessage = {
      id: 'msg_canonical',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:02.000Z',
      turnNumber: 2,
      contentBlocks: [{ type: 'text', text: 'Duplicate content' }],
    };
    const session = makeSession('a1', 'ws-1', { messages: [localMsg, canonicalMsg] });
    const state = agentSessionReducer(initialState, upsertSession(session));
    expect(getMsgs(state, 'a1').map((m) => m.id)).toEqual(['local-uuid', 'msg_canonical']);
  });

  it('collapses duplicate canonical assistant messages with equivalent tool-use blocks on upsert', () => {
    const firstCanonical: AgentMessage = {
      id: 'msg_first',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'tool_use', name: 'search', input: { query: 'hi', limit: 10 } }],
    };
    const duplicateCanonical: AgentMessage = {
      id: 'msg_duplicate',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:02.000Z',
      contentBlocks: [{ type: 'tool_use', name: 'search', input: { limit: 10, query: 'hi' } }],
    };
    const session = makeSession('a1', 'ws-1', { messages: [firstCanonical, duplicateCanonical] });
    const state = agentSessionReducer(initialState, upsertSession(session));
    expect(getMsgs(state, 'a1')).toHaveLength(1);
    expect(getMsgs(state, 'a1')[0].id).toBe('msg_first');
  });

  it('keeps repeated canonical assistant messages when timestamps are far apart', () => {
    const firstCanonical: AgentMessage = {
      id: 'msg_first',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'text', text: 'Repeated answer' }],
    };
    const laterCanonical: AgentMessage = {
      id: 'msg_later',
      role: 'assistant',
      timestamp: '2024-01-01T00:01:00.000Z',
      contentBlocks: [{ type: 'text', text: 'Repeated answer' }],
    };
    const session = makeSession('a1', 'ws-1', { messages: [firstCanonical, laterCanonical] });
    const state = agentSessionReducer(initialState, upsertSession(session));
    expect(getMsgs(state, 'a1')).toHaveLength(2);
  });

  it('keeps close-timestamp repeated canonical assistant messages from different turns', () => {
    const firstCanonical: AgentMessage = {
      id: 'msg_first',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:00.000Z',
      turnNumber: 1,
      contentBlocks: [{ type: 'text', text: 'Repeated answer' }],
    };
    const laterCanonical: AgentMessage = {
      id: 'msg_later',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:02.000Z',
      turnNumber: 2,
      contentBlocks: [{ type: 'text', text: 'Repeated answer' }],
    };
    const session = makeSession('a1', 'ws-1', { messages: [firstCanonical, laterCanonical] });
    const state = agentSessionReducer(initialState, upsertSession(session));
    expect(getMsgs(state, 'a1')).toHaveLength(2);
  });

  it('collapses same-turn canonical duplicates while preserving a different-turn repeat', () => {
    const turnOne: AgentMessage = {
      id: 'msg_turn_one',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:00.000Z',
      turnNumber: 1,
      contentBlocks: [{ type: 'text', text: 'Repeated answer' }],
    };
    const turnTwo: AgentMessage = {
      id: 'msg_turn_two',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:01.000Z',
      turnNumber: 2,
      contentBlocks: [{ type: 'text', text: 'Repeated answer' }],
    };
    const turnTwoDuplicate: AgentMessage = {
      id: 'msg_turn_two_duplicate',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:02.000Z',
      turnNumber: 2,
      contentBlocks: [{ type: 'text', text: 'Repeated answer' }],
    };
    const session = makeSession('a1', 'ws-1', {
      messages: [turnOne, turnTwo, turnTwoDuplicate],
    });
    const state = agentSessionReducer(initialState, upsertSession(session));
    expect(getMsgs(state, 'a1').map((m) => m.id)).toEqual(['msg_turn_one', 'msg_turn_two']);
  });

  it('keeps both messages when content differs', () => {
    const msg1: AgentMessage = {
      id: 'local-uuid',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'text', text: 'First reply' }],
    };
    const msg2: AgentMessage = {
      id: 'msg_canonical',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:02.000Z',
      contentBlocks: [{ type: 'text', text: 'Second reply' }],
    };
    const session = makeSession('a1', 'ws-1', { messages: [msg1, msg2] });
    const state = agentSessionReducer(initialState, upsertSession(session));
    expect(getMsgs(state, 'a1')).toHaveLength(2);
  });

  it('collapses multiple non-canonical duplicates when canonical arrives (localA, localB, canonical)', () => {
    const localA: AgentMessage = {
      id: 'local-uuid-a',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'text', text: 'Duplicate content' }],
    };
    const localB: AgentMessage = {
      id: 'local-uuid-b',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:01.000Z',
      contentBlocks: [{ type: 'text', text: 'Duplicate content' }],
    };
    const canonical: AgentMessage = {
      id: 'msg_canonical',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:02.000Z',
      contentBlocks: [{ type: 'text', text: 'Duplicate content' }],
    };
    const session = makeSession('a1', 'ws-1', { messages: [localA, localB, canonical] });
    const state = agentSessionReducer(initialState, upsertSession(session));
    expect(getMsgs(state, 'a1')).toHaveLength(1);
    expect(getMsgs(state, 'a1')[0].id).toBe('msg_canonical');
  });

  it('does NOT collapse same-text messages when one has a missing timestamp (fail-closed)', () => {
    const msgA: AgentMessage = {
      id: 'local-uuid-a',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'text', text: 'thanks' }],
    };
    const msgB: AgentMessage = {
      id: 'msg_canonical',
      role: 'assistant',
      timestamp: undefined as unknown as string,
      contentBlocks: [{ type: 'text', text: 'thanks' }],
    };
    const session = makeSession('a1', 'ws-1', { messages: [msgA, msgB] });
    const state = agentSessionReducer(initialState, upsertSession(session));
    // Both must survive — missing timestamp prevents content-hash collapse
    expect(getMsgs(state, 'a1')).toHaveLength(2);
  });

  it('collapses multiple non-canonical duplicates when canonical is first (canonical, localA, localB)', () => {
    const canonical: AgentMessage = {
      id: 'msg_canonical',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'text', text: 'Duplicate content' }],
    };
    const localA: AgentMessage = {
      id: 'local-uuid-a',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:01.000Z',
      contentBlocks: [{ type: 'text', text: 'Duplicate content' }],
    };
    const localB: AgentMessage = {
      id: 'local-uuid-b',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:02.000Z',
      contentBlocks: [{ type: 'text', text: 'Duplicate content' }],
    };
    const session = makeSession('a1', 'ws-1', { messages: [canonical, localA, localB] });
    const state = agentSessionReducer(initialState, upsertSession(session));
    expect(getMsgs(state, 'a1')).toHaveLength(1);
    expect(getMsgs(state, 'a1')[0].id).toBe('msg_canonical');
  });
});

// ===========================================================================
// Part C: Timestamp sort and content dedup on session load
// ===========================================================================

describe('sortMessagesByTimestamp — messages are ordered after upsert', () => {
  it('sorts messages by timestamp ascending on upsertSession', () => {
    const session = makeSession('a1', 'ws-1', {
      messages: [
        makeUniqueMessage('m3', 'user', '2024-01-01T00:00:03.000Z'),
        makeUniqueMessage('m1', 'user', '2024-01-01T00:00:01.000Z'),
        makeUniqueMessage('m2', 'user', '2024-01-01T00:00:02.000Z'),
      ],
    });
    const state = agentSessionReducer(initialState, upsertSession(session));
    const msgs = getMsgs(state, 'a1');
    expect(msgs.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('sorts messages by timestamp ascending on upsertAgentSession', () => {
    const session = makeSession('a1', 'ws-1', {
      messages: [
        makeUniqueMessage('m3', 'user', '2024-01-01T00:00:03.000Z'),
        makeUniqueMessage('m1', 'user', '2024-01-01T00:00:01.000Z'),
        makeUniqueMessage('m2', 'user', '2024-01-01T00:00:02.000Z'),
      ],
    });
    const state = agentSessionReducer(initialState, upsertAgentSession('ws-1', session));
    const msgs = getMsgs(state, 'a1');
    expect(msgs.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('sorts messages by timestamp ascending on replaceMessages', () => {
    let state = agentSessionReducer(initialState, upsertSession(makeSession('a1')));
    const messages = [
      makeUniqueMessage('m3', 'user', '2024-01-01T00:00:03.000Z'),
      makeUniqueMessage('m1', 'user', '2024-01-01T00:00:01.000Z'),
      makeUniqueMessage('m2', 'user', '2024-01-01T00:00:02.000Z'),
    ];
    state = agentSessionReducer(state, replaceMessages('a1', messages));
    const msgs = getMsgs(state, 'a1');
    expect(msgs.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('sorts messages by timestamp ascending on bulkUpsertSessions', () => {
    const session = makeSession('a1', 'ws-1', {
      messages: [
        makeUniqueMessage('m3', 'user', '2024-01-01T00:00:03.000Z'),
        makeUniqueMessage('m1', 'user', '2024-01-01T00:00:01.000Z'),
        makeUniqueMessage('m2', 'user', '2024-01-01T00:00:02.000Z'),
      ],
    });
    const state = agentSessionReducer(initialState, bulkUpsertSessions([session]));
    const msgs = getMsgs(state, 'a1');
    expect(msgs.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('preserves order for messages with equal timestamps (stable sort)', () => {
    const session = makeSession('a1', 'ws-1', {
      messages: [
        makeUniqueMessage('m1', 'user', '2024-01-01T00:00:01.000Z'),
        makeUniqueMessage('m2', 'user', '2024-01-01T00:00:01.000Z'),
        makeUniqueMessage('m3', 'user', '2024-01-01T00:00:01.000Z'),
      ],
    });
    const state = agentSessionReducer(initialState, upsertSession(session));
    const msgs = getMsgs(state, 'a1');
    expect(msgs.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });
});

describe('fixture regression: agent-b93c1222-corrupted.json', () => {
  // Load the corrupted fixture — it has 6 messages total where 2 are content
  // duplicates of earlier messages with plain-UUID IDs and later timestamps.
  // After content dedup + sort, we expect 4 unique messages in timestamp order.
  const fixture = require('../../../../test/fixtures/agent-b93c1222-corrupted.json');

  it('collapses content-duplicate messages and sorts by timestamp', () => {
    const session: AgentSession = {
      ...fixture,
      id: fixture.id as any,
      workspaceId: fixture.workspaceId as any,
    };
    const state = agentSessionReducer(initialState, upsertSession(session));
    const msgs = getMsgs(state, fixture.id);

    // Should have collapsed from 6 to 4 (2 duplicate pairs removed)
    expect(msgs).toHaveLength(4);

    // Messages should be in timestamp order
    for (let i = 1; i < msgs.length; i++) {
      expect(msgs[i].timestamp >= msgs[i - 1].timestamp).toBe(true);
    }

    // The canonical msg_*-prefixed IDs should be preserved
    expect(msgs[0].id).toBe('msg_aaa00001');
    expect(msgs[1].id).toBe('msg_aaa00002');
    expect(msgs[2].id).toBe('msg_aaa00003');
    expect(msgs[3].id).toBe('msg_aaa00004');
  });

  it('works through bulkUpsertSessions (session-load path)', () => {
    const session: AgentSession = {
      ...fixture,
      id: fixture.id as any,
      workspaceId: fixture.workspaceId as any,
    };
    const state = agentSessionReducer(initialState, bulkUpsertSessions([session]));
    const msgs = getMsgs(state, fixture.id);

    expect(msgs).toHaveLength(4);

    // Verify timestamp order
    for (let i = 1; i < msgs.length; i++) {
      expect(msgs[i].timestamp >= msgs[i - 1].timestamp).toBe(true);
    }
  });

  it('works through upsertAgentSession (cross-slice load path)', () => {
    const session: AgentSession = {
      ...fixture,
      id: fixture.id as any,
      workspaceId: fixture.workspaceId as any,
    };
    const state = agentSessionReducer(
      initialState,
      upsertAgentSession(fixture.workspaceId, session),
    );
    const msgs = getMsgs(state, fixture.id);

    expect(msgs).toHaveLength(4);
    expect(msgs.map((m) => m.id)).toEqual([
      'msg_aaa00001',
      'msg_aaa00002',
      'msg_aaa00003',
      'msg_aaa00004',
    ]);
  });
});
