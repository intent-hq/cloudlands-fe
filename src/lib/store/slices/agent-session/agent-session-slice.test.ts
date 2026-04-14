import { describe, expect, it } from 'vitest';
import type { AgentSession, AgentMessage, QueuedMessage } from '$shared/types';
import type { AgentSessionState } from './agent-session-types';
import type { StoreState } from '../../types';
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
} from './agent-session-slice';
import {
  removeAgentMessage,
  setAgentStreaming,
  upsertAgentSession,
} from '../workspace-agents/workspace-agents-slice';
import { chatSendStarted } from '../chat-state/chat-state-slice';
import {
  selectAgentSession,
  selectAgentMessages,
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

function storeWith(agentSessions: AgentSessionState): StoreState {
  return { agentSessions } as unknown as StoreState;
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
      expect(state.byAgentId['a1'].messages).toHaveLength(1);
    });

    it('overwrites existing session', () => {
      let state = agentSessionReducer(initialState, upsertSession(makeSession('a1')));
      state = agentSessionReducer(
        state,
        upsertSession(makeSession('a1', 'ws-1', { name: 'Updated' })),
      );
      expect(state.byAgentId['a1'].name).toBe('Updated');
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
      expect(state.byAgentId['a1'].messages).toHaveLength(1);
    });

    it('skips duplicate messages', () => {
      let state = agentSessionReducer(initialState, upsertSession(makeSession('a1')));
      state = agentSessionReducer(state, addMessage('a1', makeMessage('m1')));
      state = agentSessionReducer(state, addMessage('a1', makeMessage('m1')));
      expect(state.byAgentId['a1'].messages).toHaveLength(1);
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
      expect(state.byAgentId['a1'].messages).toHaveLength(500);
      // Should keep the latest messages (m1 .. m500), first message m0 should be pruned
      expect(state.byAgentId['a1'].messages[0].id).toBe('m1');
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
      expect(state.byAgentId['a1'].messages[0].role).toBe('assistant');
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
      expect(state.byAgentId['a1'].messages).toHaveLength(1);
      expect(state.byAgentId['a1'].messages[0].id).toBe('m1');
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
      expect(state.byAgentId['a1'].messages).toHaveLength(1);
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
});

describe('removeMessage (native action)', () => {
  it('removes a message by ID', () => {
    const session = makeSession('a1', 'ws-1', {
      messages: [makeMessage('m1'), makeMessage('m2'), makeMessage('m3')],
    });
    let state = agentSessionReducer(initialState, upsertSession(session));
    state = agentSessionReducer(state, removeMessage('a1', 'm2'));
    expect(state.byAgentId['a1'].messages).toHaveLength(2);
    expect(state.byAgentId['a1'].messages.map((m) => m.id)).toEqual(['m1', 'm3']);
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
      messages: [makeMessage('m1'), makeMessage('m2')],
    });
    let state = agentSessionReducer(initialState, upsertSession(session));
    state = agentSessionReducer(state, removeAgentMessage('ws-1', 'a1', 'm1'));
    expect(state.byAgentId['a1'].messages).toHaveLength(1);
    expect(state.byAgentId['a1'].messages[0].id).toBe('m2');
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
    expect(session.messages).toEqual([]);
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
