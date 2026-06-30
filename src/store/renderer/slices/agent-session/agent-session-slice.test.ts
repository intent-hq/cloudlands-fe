import { describe, expect, it } from 'vitest';
import type { AgentSession, AgentMessage, QueuedMessage } from '$shared/types';
import type { AgentSessionState } from './agent-session-types';
import type { StoreState } from '../../types';
import {
  agentQueueReducer,
  initialState as initialAgentQueueState,
  replaceAgentQueue,
} from '../agent-queue/agent-queue-slice';
import {
  agentSessionReducer,
  initialState,
  upsertSession as upsertSessionAction,
  removeSession,
  addMessage,
  removeMessage,
  updateMessage,
  replaceMessages,
  updateSession,
  setAgentStreaming,
  updateAgentDigest,
  renameSession,
  renameAgent,
  bulkUpsertSessions,
  removeWorkspaceSessions,
  clearAllSessions,
  computeMessageContentHash,
  hasCanonicalId,
  isTimestampClose,
  replaceMessageById,
} from './agent-session-slice';
import {
  chatSendFailed,
  chatSendStarted,
  chatInitialized,
  streamCompleted,
} from '../chat-state/chat-state-slice';
import { eventReceived } from '../workspace-events/workspace-events-slice';
import {
  selectAgentSession,
  selectAgentSessionsByIds,
  selectAgentMessages,
  selectAgentMessageById,
  selectAgentSessionExists,
  selectAgentSessionIsProcessing,
  selectAgentSessionIsStreaming,
  selectAgentSessionStreamingContent,
  selectAgentSessionWorkspaceId,
  selectAgentQueuedMessages,
  selectAgentIsResponding,
  selectAgentIsThinking,
  selectAgentIsWaiting,
  selectAgentIsWaitingForOtherAgents,
  selectAgentIsRunning,
  selectAllRetainedAgentSessions,
} from './agent-session-selectors';

// ============================================================================
// Helpers
// ============================================================================

function makeMessage(id: string, role: 'user' | 'assistant' = 'user'): AgentMessage {
  return { id, role, timestamp: '2024-01-01T00:00:00.000Z' };
}

/** Like makeMessage but with unique content so content-hash dedup doesn't collapse them. */
function makeUniqueMessage(
  id: string,
  role: 'user' | 'assistant' = 'user',
  timestamp = '2024-01-01T00:00:00.000Z',
): AgentMessage {
  return { id, role, timestamp, contentBlocks: [{ type: 'text' as const, text: `content-${id}` }] };
}

function makeAcpAccumulatedAssistantMessage(
  id: string,
  appMessageId: string,
  timestamp = '2024-01-01T00:00:02.000Z',
  metadata: Record<string, unknown> = {},
): AgentMessage {
  return {
    id,
    appMessageId,
    role: 'assistant',
    timestamp,
    contentBlocks: [
      { type: 'text' as const, text: 'I will inspect the file.' },
      {
        type: 'tool_use' as const,
        id: 'toolu_1',
        name: 'read_file',
        input: { path: 'src/foo.ts' },
      },
      {
        type: 'tool_result' as const,
        tool_use_id: 'toolu_1',
        output: { content: 'file contents' },
      },
    ],
    metadata: {
      originalSessionId: 'agent-c1e02497-d633-466f-8426-eb53cb0b957e',
      accumulatorSessionId: 'agent-c1e02497-d633-466f-8426-eb53cb0b957e',
      auggieSessionId: '1b5b4d76-43a7-4092-a73e-d4bb96bb2d7e',
      ...metadata,
    },
  };
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

function upsertSession(session: AgentSession) {
  return bulkUpsertSessions([session], { preserveExplicitRuntimeFlags: false });
}

/**
 * Accepts a raw agent-session state shape whose sessions carry the same ordered
 * `messages: AgentMessage[]` storage used by the slice at runtime.
 */
function storeWith(
  agentSessions: {
    byAgentId: Record<string, AgentSession>;
    agentIdsByWorkspace?: Record<string, string[]>;
  },
  workspaceAgentIds: Record<string, string[]> = {},
): StoreState {
  const converted: AgentSessionState = {
    byAgentId: agentSessions.byAgentId,
    agentIdsByWorkspace: agentSessions.agentIdsByWorkspace ?? workspaceAgentIds,
  };
  return {
    agentSessions: converted,
    workspaceAgents: {
      byWorkspaceId: Object.fromEntries(
        Object.entries(workspaceAgentIds).map(([wsId, agentIds]) => [wsId, { agentIds }]),
      ),
    },
  } as unknown as StoreState;
}

/**
 * Test helper: returns the stored ordered `AgentMessage[]` for a session, or an
 * empty array when the session isn't present.
 */
function getMsgs(state: AgentSessionState, agentId: string): AgentMessage[] {
  const stored = state.byAgentId[agentId];
  return stored ? stored.messages : [];
}

// ============================================================================
// Reducer Tests
// ============================================================================

describe('agent-session-slice reducer', () => {
  it('returns initial state', () => {
    const state = agentSessionReducer(undefined, { type: '@@INIT', payload: undefined });
    expect(state).toEqual(initialState);
  });

  describe('upsertSession fan-out action', () => {
    it('does not mutate reducer storage directly', () => {
      const state = agentSessionReducer(
        initialState,
        upsertSessionAction(makeSession('a1', 'ws-1')),
      );
      expect(state).toBe(initialState);
    });
  });

  describe('bulkUpsertSessions batched upsert storage semantics', () => {
    it('adds a new session by agent ID', () => {
      const session = makeSession('a1', 'ws-1');
      const state = agentSessionReducer(initialState, upsertSession(session));
      expect(state.byAgentId['a1']).toBeDefined();
      expect(state.byAgentId['a1'].name).toBe('Agent a1');
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
    it('removes session by agent ID', () => {
      let state = agentSessionReducer(initialState, upsertSession(makeSession('a1', 'ws-1')));
      state = agentSessionReducer(state, removeSession('a1'));
      expect(state.byAgentId['a1']).toBeUndefined();
    });

    it('is a no-op for unknown agentId', () => {
      const state = agentSessionReducer(initialState, removeSession('unknown'));
      expect(state).toBe(initialState);
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

    it('merges messages with the same appMessageId on the normal add path', () => {
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

      expect(getMsgs(state, 'a1')).toMatchObject([
        { id: 'msg_backend', appMessageId, metadata: { model: 'test-model' } },
      ]);
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

    it('deduplicates same-appMessageId replacement snapshots', () => {
      const appMessageId = 'app_msg_snapshot';
      let state = agentSessionReducer(initialState, upsertSession(makeSession('a1')));
      state = agentSessionReducer(
        state,
        replaceMessages('a1', [
          { ...makeUniqueMessage('local-id', 'assistant'), appMessageId },
          { ...makeUniqueMessage('msg_backend', 'assistant'), appMessageId },
        ]),
      );

      expect(getMsgs(state, 'a1').map((m) => m.id)).toEqual(['msg_backend']);
    });

    it('keeps canonical identity after same-appMessageId replacement snapshot dedup', () => {
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
      state = agentSessionReducer(state, replaceMessages('a1', [backendMsg, localMsg]));

      expect(getMsgs(state, 'a1')).toMatchObject([
        { id: 'msg_backend', appMessageId, metadata: { source: 'backend' } },
      ]);
    });
  });

  describe('updateSession', () => {
    it('updates non-message fields', () => {
      let state = agentSessionReducer(initialState, upsertSession(makeSession('a1')));
      state = agentSessionReducer(state, updateSession('a1', { name: 'New Name' }));
      expect(state.byAgentId['a1'].name).toBe('New Name');
    });

    it('handles messages in updates with normalization and logical dedup', () => {
      const msg = makeMessage('m1');
      let state = agentSessionReducer(initialState, upsertSession(makeSession('a1')));
      state = agentSessionReducer(state, updateSession('a1', { messages: [msg, msg] }));
      expect(getMsgs(state, 'a1')).toHaveLength(1);
    });

    it('deduplicates same-appMessageId messages in updateSession message arrays', () => {
      const appMessageId = 'app_msg_update';
      let state = agentSessionReducer(initialState, upsertSession(makeSession('a1')));
      state = agentSessionReducer(
        state,
        updateSession('a1', {
          messages: [
            { ...makeUniqueMessage('local-id', 'assistant'), appMessageId },
            { ...makeUniqueMessage('msg_backend', 'assistant'), appMessageId },
          ],
        }),
      );
      expect(getMsgs(state, 'a1').map((m) => m.id)).toEqual(['msg_backend']);
    });
  });

  describe('canonical status reconciliation', () => {
    it('merges canonical fields from workspace status events', () => {
      let state = agentSessionReducer(initialState, upsertSession(makeSession('a1')));

      state = agentSessionReducer(
        state,
        eventReceived('ws-1', {
          type: 'agent:status-changed',
          data: {
            agentId: 'a1',
            status: 'responding',
            activationState: 'active',
            isActive: true,
            isStreaming: true,
            isProcessing: true,
            isResponding: true,
            stopReason: null,
          },
        } as any),
      );

      expect(state.byAgentId['a1']).toMatchObject({
        status: 'responding',
        activationState: 'active',
        isActive: true,
        isStreaming: true,
        isProcessing: true,
        isResponding: true,
      });
    });

    it('adds cross-client user messages from canonical workspace events', () => {
      let state = agentSessionReducer(initialState, upsertSession(makeSession('a1')));

      state = agentSessionReducer(
        state,
        eventReceived('ws-1', {
          id: 'evt-user-message',
          type: 'agent:user-message:sent',
          timestamp: '2024-01-01T00:00:01.000Z',
          workspaceId: 'ws-1',
          data: {
            agentId: 'a1',
            messageId: 'msg-user-1',
            content: 'Hello from iOS',
          },
        } as any),
      );

      expect(getMsgs(state, 'a1')).toMatchObject([
        {
          id: 'msg-user-1',
          role: 'user',
          timestamp: '2024-01-01T00:00:01.000Z',
          contentBlocks: [{ type: 'text', text: 'Hello from iOS' }],
        },
      ]);
    });

    it('preserves image blocks from canonical cross-client user message events', () => {
      let state = agentSessionReducer(initialState, upsertSession(makeSession('a1')));
      const imageBlocks = [{ type: 'image' as const, data: 'base64data', mimeType: 'image/png' }];

      state = agentSessionReducer(
        state,
        eventReceived('ws-1', {
          id: 'evt-user-message-image',
          type: 'agent:user-message:sent',
          timestamp: '2024-01-01T00:00:02.000Z',
          workspaceId: 'ws-1',
          data: {
            agentId: 'a1',
            messageId: 'msg-user-image',
            content: 'Screenshot',
            imageBlocks,
          },
        } as any),
      );

      expect(getMsgs(state, 'a1')[0].contentBlocks).toEqual([
        { type: 'text', text: 'Screenshot' },
        { type: 'image', data: 'base64data', mimeType: 'image/png' },
      ]);
    });

    it('does not duplicate a user message already persisted before workspace event delivery', () => {
      const existingMessage = makeUniqueMessage('msg-existing', 'user');
      let state = agentSessionReducer(
        initialState,
        upsertSession(makeSession('a1', 'ws-1', { messages: [existingMessage] })),
      );

      state = agentSessionReducer(
        state,
        eventReceived('ws-1', {
          id: 'evt-duplicate-user-message',
          type: 'agent:user-message:sent',
          timestamp: '2024-01-01T00:00:03.000Z',
          workspaceId: 'ws-1',
          data: {
            agentId: 'a1',
            messageId: 'msg-existing',
            content: 'content-msg-existing',
          },
        } as any),
      );

      expect(getMsgs(state, 'a1')).toHaveLength(1);
      expect(getMsgs(state, 'a1')[0].id).toBe('msg-existing');
    });

    it('merges a local optimistic user message with the canonical workspace event by appMessageId', () => {
      const appMessageId = 'app_msg_user_send';
      const optimisticMessage: AgentMessage = {
        id: 'optimistic_app_msg_user_send',
        appMessageId,
        role: 'user',
        timestamp: '2024-01-01T00:00:02.000Z',
        contentBlocks: [{ type: 'text', text: 'Approve both tasks.' }],
      };
      let state = agentSessionReducer(
        initialState,
        upsertSession(makeSession('a1', 'ws-1', { messages: [optimisticMessage] })),
      );

      state = agentSessionReducer(
        state,
        eventReceived('ws-1', {
          id: 'evt-canonical-user-message',
          type: 'agent:user-message:sent',
          timestamp: '2024-01-01T00:00:03.000Z',
          workspaceId: 'ws-1',
          data: {
            agentId: 'a1',
            messageId: 'msg-canonical-user',
            appMessageId,
            content: 'Approve both tasks.',
          },
        } as any),
      );

      expect(getMsgs(state, 'a1')).toMatchObject([
        { id: 'msg-canonical-user', appMessageId, role: 'user' },
      ]);
    });

    it('ignores malformed cross-client user message workspace events', () => {
      const state = agentSessionReducer(
        agentSessionReducer(initialState, upsertSession(makeSession('a1'))),
        eventReceived('ws-1', {
          id: 'evt-malformed-user-message',
          type: 'agent:user-message:sent',
          timestamp: '2024-01-01T00:00:04.000Z',
          workspaceId: 'ws-1',
          data: { agentId: 'a1', content: 'Missing messageId' },
        } as any),
      );

      expect(getMsgs(state, 'a1')).toHaveLength(0);
    });

    it('clears runtime flags from terminal session-completed events', () => {
      let state = agentSessionReducer(
        initialState,
        upsertSession(
          makeSession('a1', 'ws-1', {
            isStreaming: true,
            isProcessing: true,
            isResponding: true,
          }),
        ),
      );

      state = agentSessionReducer(
        state,
        eventReceived('ws-1', {
          type: 'agent:session-completed',
          data: {
            workspaceId: 'ws-1',
            sessionId: 'a1',
            status: 'completed',
            activationState: null,
            isActive: false,
            isStreaming: false,
            isProcessing: false,
            isResponding: false,
            stopReason: 'complete',
          },
        } as any),
      );

      expect(state.byAgentId['a1']).toMatchObject({
        status: 'completed',
        isActive: false,
        isStreaming: false,
        isProcessing: false,
        isResponding: false,
        stopReason: 'complete',
      });
    });

    it('preserves agent:idle lastResponseSummary as the last agent response', () => {
      let state = agentSessionReducer(initialState, upsertSession(makeSession('a1')));

      state = agentSessionReducer(
        state,
        eventReceived('ws-1', {
          id: 'evt-1',
          type: 'agent:idle',
          timestamp: '2024-01-01T00:00:00.000Z',
          workspaceId: 'ws-1',
          data: {
            agentId: 'a1',
            status: 'idle',
            isStreaming: false,
            isProcessing: false,
            isResponding: false,
            lastResponseSummary: '<<<COMMIT_MESSAGE>>>fix: generated<<<\/COMMIT_MESSAGE>>>',
          },
        } as any),
      );

      expect(state.byAgentId['a1'].lastAgentResponse).toBe(
        '<<<COMMIT_MESSAGE>>>fix: generated<<<\/COMMIT_MESSAGE>>>',
      );
    });
  });

  describe('updateAgentDigest', () => {
    it('handles workspace-scoped updateAgentDigest compatibility action', () => {
      let state = agentSessionReducer(initialState, upsertSession(makeSession('a1')));
      state = agentSessionReducer(state, updateAgentDigest('ws-1', 'a1', 'summary'));
      expect(state.byAgentId['a1'].digest).toBe('summary');
      expect(updateAgentDigest.type).toBe('workspaceAgents/updateAgentDigest');
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

    it('handles workspace-scoped renameAgent compatibility action', () => {
      let state = agentSessionReducer(initialState, upsertSession(makeSession('a1')));
      state = agentSessionReducer(state, renameAgent('ws-1', 'a1', 'New Name'));
      expect(state.byAgentId['a1'].name).toBe('New Name');
      expect(renameAgent.type).toBe('workspaceAgents/renameAgent');
    });
  });

  describe('bulkUpsertSessions', () => {
    it('upserts multiple sessions', () => {
      const s1 = makeSession('a1', 'ws-1');
      const s2 = makeSession('a2', 'ws-2');
      const state = agentSessionReducer(initialState, bulkUpsertSessions([s1, s2]));
      expect(Object.keys(state.byAgentId)).toHaveLength(2);
      expect(state.byAgentId['a1']).toBeDefined();
      expect(state.byAgentId['a2']).toBeDefined();
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

    it('preserves a missing optimistic user message when an active upsert snapshot is stale', () => {
      const persistedUser = makeUniqueMessage('msg-user-1', 'user', '2024-01-01T00:00:00.000Z');
      const optimisticUser: AgentMessage = {
        id: 'optimistic_app_msg_retry',
        appMessageId: 'app_msg_retry',
        role: 'user',
        timestamp: '2024-01-01T00:00:02.000Z',
        contentBlocks: [{ type: 'text', text: 'Retry while refresh is stale' }],
      };
      let state = agentSessionReducer(
        initialState,
        bulkUpsertSessions(
          [
            makeSession('a1', 'ws-1', {
              messages: [persistedUser, optimisticUser],
              isStreaming: true,
              isProcessing: true,
            }),
          ],
          { preserveExplicitRuntimeFlags: false },
        ),
      );

      state = agentSessionReducer(
        state,
        bulkUpsertSessions(
          [
            makeSession('a1', 'ws-1', {
              name: 'Stale Refresh Snapshot',
              messages: [persistedUser],
              isStreaming: false,
              isProcessing: false,
            }),
          ],
          { preserveExplicitRuntimeFlags: false },
        ),
      );

      expect(state.byAgentId['a1'].name).toBe('Stale Refresh Snapshot');
      expect(state.byAgentId['a1'].isStreaming).toBe(true);
      expect(state.byAgentId['a1'].isProcessing).toBe(true);
      expect(getMsgs(state, 'a1').map((message) => message.id)).toEqual([
        'msg-user-1',
        'optimistic_app_msg_retry',
      ]);
    });

    it('does not preserve non-optimistic messages from active state when an upsert snapshot truncates them', () => {
      const persistedUser = makeUniqueMessage('msg-user-1', 'user', '2024-01-01T00:00:00.000Z');
      const removedAssistant = makeUniqueMessage(
        'msg-assistant-removed',
        'assistant',
        '2024-01-01T00:00:01.000Z',
      );
      let state = agentSessionReducer(
        initialState,
        bulkUpsertSessions(
          [
            makeSession('a1', 'ws-1', {
              messages: [persistedUser, removedAssistant],
              isStreaming: true,
              isProcessing: true,
            }),
          ],
          { preserveExplicitRuntimeFlags: false },
        ),
      );

      state = agentSessionReducer(
        state,
        bulkUpsertSessions(
          [
            makeSession('a1', 'ws-1', {
              messages: [persistedUser],
              isStreaming: false,
              isProcessing: false,
            }),
          ],
          { preserveExplicitRuntimeFlags: false },
        ),
      );

      expect(getMsgs(state, 'a1').map((message) => message.id)).toEqual(['msg-user-1']);
    });

    it('lets batched upsert storage clear a non-active runtime flag with explicit false', () => {
      // Not an in-flight turn (only one flag set), so a batched explicit-false
      // upsert is allowed to clear it. Active turns (both flags set) are guarded
      // separately — see the Wave 10 preservation test above.
      let state = agentSessionReducer(
        initialState,
        bulkUpsertSessions([makeSession('a1', 'ws-1', { isStreaming: true, isProcessing: false })]),
      );
      expect(state.byAgentId['a1'].isStreaming).toBe(true);

      state = agentSessionReducer(
        state,
        bulkUpsertSessions(
          [
            makeSession('a1', 'ws-1', {
              isStreaming: false,
              isProcessing: false,
            }),
          ],
          { preserveExplicitRuntimeFlags: false },
        ),
      );

      expect(state.byAgentId['a1'].isStreaming).toBe(false);
      expect(state.byAgentId['a1'].isProcessing).toBe(false);
    });

    // Wave 10 — Test C (Cause 2): a stale backend session snapshot arriving
    // mid-turn must NOT clobber the in-flight streaming flags. After
    // chatSendStarted marks the turn active (both flags true), a batched
    // upsert carrying explicit `false` (the batcher passes
    // preserveExplicitRuntimeFlags:false) is stale for these ephemeral flags.
    it('Wave 10: preserves in-flight flags when a batched explicit-false upsert is stale', () => {
      let state = agentSessionReducer(initialState, chatSendStarted('a1', 'ws-1'));
      expect(state.byAgentId['a1'].isStreaming).toBe(true);
      expect(state.byAgentId['a1'].isProcessing).toBe(true);

      state = agentSessionReducer(
        state,
        bulkUpsertSessions(
          [
            makeSession('a1', 'ws-1', {
              isStreaming: false,
              isProcessing: false,
              name: 'Snapshot',
            }),
          ],
          { preserveExplicitRuntimeFlags: false },
        ),
      );

      // In-flight turn flags survive — only an explicit clear action may end them.
      expect(state.byAgentId['a1'].isStreaming).toBe(true);
      expect(state.byAgentId['a1'].isProcessing).toBe(true);
      expect(state.byAgentId['a1'].name).toBe('Snapshot');
    });

    it('lets normalized restore snapshots clear stale both-true runtime flags', () => {
      let state = agentSessionReducer(initialState, chatSendStarted('a1', 'ws-1'));
      expect(state.byAgentId['a1'].isStreaming).toBe(true);
      expect(state.byAgentId['a1'].isProcessing).toBe(true);

      state = agentSessionReducer(
        state,
        bulkUpsertSessions(
          [
            makeSession('a1', 'ws-1', {
              status: 'Idle' as any,
              isStreaming: false,
              isProcessing: false,
              isResponding: false,
              name: 'Restored Idle Snapshot',
            }),
          ],
          {
            preserveExplicitRuntimeFlags: false,
            allowActiveTurnRuntimeFlagClear: true,
          },
        ),
      );

      expect(state.byAgentId['a1']).toMatchObject({
        status: 'Idle',
        isStreaming: false,
        isProcessing: false,
        isResponding: false,
        name: 'Restored Idle Snapshot',
      });
    });

    it('still clears isProcessing via upsert once isStreaming was cleared first (safety timeout)', () => {
      // Mirrors agent-stream-saga's safety-timeout path: setAgentStreaming(false)
      // flips isStreaming off first, then an upsert clears the remaining
      // isProcessing flag. Because the pair is no longer both-true, the upsert
      // is allowed to clear.
      let state = agentSessionReducer(initialState, chatSendStarted('a1', 'ws-1'));
      state = agentSessionReducer(state, setAgentStreaming('a1', false));
      expect(state.byAgentId['a1'].isStreaming).toBe(false);
      expect(state.byAgentId['a1'].isProcessing).toBe(true);

      state = agentSessionReducer(
        state,
        bulkUpsertSessions(
          [makeSession('a1', 'ws-1', { isStreaming: false, isProcessing: false })],
          { preserveExplicitRuntimeFlags: false },
        ),
      );

      expect(state.byAgentId['a1'].isStreaming).toBe(false);
      expect(state.byAgentId['a1'].isProcessing).toBe(false);
    });

    it('applies same-agent batched upserts in original order', () => {
      const state = agentSessionReducer(
        initialState,
        bulkUpsertSessions(
          [
            makeSession('a1', 'ws-1', { name: 'First' }),
            makeSession('a1', 'ws-1', { name: 'Second' }),
          ],
          { preserveExplicitRuntimeFlags: false },
        ),
      );

      expect(state.byAgentId['a1'].name).toBe('Second');
      expect(state.agentIdsByWorkspace['ws-1']).toEqual(['a1']);
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
    const state = storeWith({ byAgentId: { a1: session } });
    expect(selectAgentSession.select(state, 'a1')).toEqual(session);
    expect(selectAgentSession.select(state, 'unknown')).toBeUndefined();
    expect(selectAgentSession.select(state, '')).toBeUndefined();
    expect(selectAgentSession.select(state)).toBeUndefined();
  });

  it('selectAgentSessionsByIds returns only requested sessions', () => {
    const s1 = makeSession('a1');
    const s2 = makeSession('a2');
    const s3 = makeSession('a3');
    const state = storeWith({ byAgentId: { a1: s1, a2: s2, a3: s3 } });
    expect(selectAgentSessionsByIds.select(state, ['a2', 'missing', 'a1'])).toEqual([s2, s1]);
  });

  it('selectAgentMessages returns messages or empty array', () => {
    const msg = makeMessage('m1');
    const session = makeSession('a1', 'ws-1', { messages: [msg] });
    const state = storeWith({ byAgentId: { a1: session } });
    expect(selectAgentMessages.select(state, 'a1')).toEqual([msg]);
    expect(selectAgentMessages.select(state, 'unknown')).toEqual([]);
  });

  describe('selectAgentSessionStreamingContent', () => {
    it('derives the active text segment from the streaming assistant message', () => {
      const session = makeSession('a1', 'ws-1', {
        isStreaming: true,
        messages: [makeMessage('u1', 'user'), makeUniqueMessage('a1', 'assistant')],
      });
      const state = storeWith({ byAgentId: { a1: session } });

      expect(selectAgentSessionStreamingContent.select(state, 'a1')).toBe('content-a1');
    });

    it('clears visible text at a tool_use boundary without dropping persisted blocks', () => {
      const session = makeSession('a1', 'ws-1', {
        isStreaming: true,
        messages: [
          {
            ...makeMessage('a1', 'assistant'),
            contentBlocks: [
              { type: 'text' as const, text: 'Before tool' },
              { type: 'tool_use' as const, id: 'tool-1', name: 'read_file', input: {} },
            ],
          },
        ],
      });
      const state = storeWith({ byAgentId: { a1: session } });

      expect(selectAgentSessionStreamingContent.select(state, 'a1')).toBe('');
      expect(selectAgentMessages.select(state, 'a1')[0].contentBlocks).toHaveLength(2);
    });

    it('returns only text streamed after the latest tool_use boundary', () => {
      const session = makeSession('a1', 'ws-1', {
        isStreaming: true,
        messages: [
          {
            ...makeMessage('a1', 'assistant'),
            contentBlocks: [
              { type: 'text' as const, text: 'Before tool' },
              { type: 'tool_use' as const, id: 'tool-1', name: 'read_file', input: {} },
              { type: 'tool_result' as const, tool_use_id: 'tool-1', output: { content: 'ok' } },
              { type: 'text' as const, content: 'After ' },
              { type: 'text' as const, text: 'tool' },
            ],
          },
        ],
      });
      const state = storeWith({ byAgentId: { a1: session } });

      expect(selectAgentSessionStreamingContent.select(state, 'a1')).toBe('After tool');
    });

    it('keeps concurrently streaming agent content isolated by agent ID', () => {
      const state = storeWith({
        byAgentId: {
          'agent-X': makeSession('agent-X', 'ws-1', {
            isStreaming: true,
            messages: [makeUniqueMessage('assistant-X', 'assistant')],
          }),
          'agent-Y': makeSession('agent-Y', 'ws-2', {
            isStreaming: true,
            messages: [makeUniqueMessage('assistant-Y', 'assistant')],
          }),
        },
      });

      expect(selectAgentSessionStreamingContent.select(state, 'agent-X')).toBe(
        'content-assistant-X',
      );
      expect(selectAgentSessionStreamingContent.select(state, 'agent-Y')).toBe(
        'content-assistant-Y',
      );
    });

    it('does not expose a previous completed assistant when the latest turn has no assistant yet', () => {
      const session = makeSession('a1', 'ws-1', {
        isStreaming: true,
        messages: [
          makeUniqueMessage('old-assistant', 'assistant'),
          makeMessage('new-user', 'user'),
        ],
      });
      const state = storeWith({ byAgentId: { a1: session } });

      expect(selectAgentSessionStreamingContent.select(state, 'a1')).toBe('');
      expect(selectAgentSessionStreamingContent.select(state, 'unknown')).toBe('');
    });
  });

  it('selectAgentSessionExists returns whether a session is present for the agent ID', () => {
    const session = makeSession('a1');
    const state = storeWith({ byAgentId: { a1: session } });
    expect(selectAgentSessionExists.select(state, 'a1')).toBe(true);
    expect(selectAgentSessionExists.select(state, 'unknown')).toBe(false);
  });

  it('selectAgentSessionIsStreaming returns the raw streaming flag', () => {
    const streaming = makeSession('streaming', 'ws-1', { isStreaming: true });
    const idle = makeSession('idle', 'ws-1', { isStreaming: false });
    const state = storeWith({ byAgentId: { streaming, idle } });
    expect(selectAgentSessionIsStreaming.select(state, 'streaming')).toBe(true);
    expect(selectAgentSessionIsStreaming.select(state, 'idle')).toBe(false);
    expect(selectAgentSessionIsStreaming.select(state, 'unknown')).toBe(false);
  });

  it('selectAgentSessionWorkspaceId returns the workspace id for an agent session', () => {
    const session = makeSession('a1', 'ws-1');
    const state = storeWith({ byAgentId: { a1: session } });
    expect(selectAgentSessionWorkspaceId.select(state, 'a1')).toBe('ws-1');
    expect(selectAgentSessionWorkspaceId.select(state, 'unknown')).toBeUndefined();
  });

  describe('selectAgentSessionIsProcessing', () => {
    it('returns the raw processing flag without conflating responding or waiting state', () => {
      const processing = makeSession('processing', 'ws-1', { isProcessing: true });
      const responding = makeSession('responding', 'ws-1', { isResponding: true });
      const waiting = makeSession('waiting', 'ws-1', { status: 'Waiting' as any });
      const state = storeWith({
        byAgentId: { processing, responding, waiting },
        agentIdsByWorkspace: {},
      });

      expect(selectAgentSessionIsProcessing.select(state, 'processing')).toBe(true);
      expect(selectAgentSessionIsProcessing.select(state, 'responding')).toBe(false);
      expect(selectAgentSessionIsProcessing.select(state, 'waiting')).toBe(false);
      expect(selectAgentSessionIsProcessing.select(state, 'unknown')).toBe(false);
    });
  });

  describe('selectAgentIsResponding', () => {
    it('returns true for active session lifecycle flags and statuses', () => {
      const activeSessions = [
        makeSession('streaming', 'ws-1', { isStreaming: true }),
        makeSession('processing-flag', 'ws-1', { isProcessing: true }),
        makeSession('responding-flag', 'ws-1', { isResponding: true }),
        makeSession('activating', 'ws-1', { activationState: 'activating' as any }),
        makeSession('active-status', 'ws-1', { status: 'active' as any }),
        makeSession('processing-status', 'ws-1', { status: 'Processing' as any }),
        makeSession('waiting-status', 'ws-1', { status: 'Waiting' as any }),
      ];
      const state = storeWith({
        byAgentId: Object.fromEntries(activeSessions.map((session) => [session.id, session])),
        agentIdsByWorkspace: {},
      });

      for (const session of activeSessions) {
        expect(selectAgentIsResponding.select(state, session.id)).toBe(true);
      }
    });

    it('returns false for a blank idle-created agent session', () => {
      const session = makeSession('blank-created', 'ws-1', {
        status: 'Idle' as any,
        messages: [],
        isStreaming: false,
        isProcessing: false,
        isResponding: false,
      });
      const state = storeWith({
        byAgentId: { 'blank-created': session },
        agentIdsByWorkspace: {},
      });

      expect(selectAgentIsResponding.select(state, 'blank-created')).toBe(false);
    });

    it('returns true when the daemon reports the turn is waiting on a tool', () => {
      const session = makeSession('a1', 'ws-1', { isWaitingOnTool: true });
      const state = storeWith({ byAgentId: { a1: session }, agentIdsByWorkspace: {} });
      expect(selectAgentIsResponding.select(state, 'a1')).toBe(true);
    });

    it('does not infer responding from a streaming assistant message when BE flags are idle', () => {
      const session = makeSession('a1', 'ws-1', {
        status: 'idle' as any,
        isStreaming: false,
        isProcessing: false,
        isResponding: false,
        messages: [
          {
            ...makeMessage('m1', 'assistant'),
            isStreaming: true,
            contentBlocks: [{ type: 'text', text: 'Streaming response' }],
          },
        ],
      });
      const state = storeWith({ byAgentId: { a1: session }, agentIdsByWorkspace: {} });
      expect(selectAgentIsResponding.select(state, 'a1')).toBe(false);
    });

    it('ignores stale streaming fields on interrupted/cancelled assistant messages', () => {
      const session = makeSession('a1', 'ws-1', {
        status: 'Idle' as any,
        isStreaming: false,
        isProcessing: false,
        isResponding: false,
        messages: [
          {
            ...makeMessage('m1', 'assistant'),
            isStreaming: true,
            streamingComplete: false,
            metadata: { interrupted: true, stopReason: 'cancelled' },
            contentBlocks: [{ type: 'text', text: 'Stopped response' }],
          },
        ],
      });
      const state = storeWith({ byAgentId: { a1: session }, agentIdsByWorkspace: {} });
      expect(selectAgentIsResponding.select(state, 'a1')).toBe(false);
    });

    it('ignores stale streaming fields on terminal assistant messages', () => {
      const session = makeSession('a1', 'ws-1', {
        messages: [
          {
            ...makeMessage('m1', 'assistant'),
            isStreaming: true,
            streamingComplete: false,
            metadata: { stopReason: 'end_turn' },
            contentBlocks: [{ type: 'text', text: 'Finished response' }],
          },
        ],
      });
      const state = storeWith({ byAgentId: { a1: session }, agentIdsByWorkspace: {} });
      expect(selectAgentIsResponding.select(state, 'a1')).toBe(false);
    });

    it('returns true while the daemon flags the turn waiting on a tool', () => {
      const session = makeSession('a1', 'ws-1', { isWaitingOnTool: true });
      const state = storeWith({ byAgentId: { a1: session }, agentIdsByWorkspace: {} });
      expect(selectAgentIsResponding.select(state, 'a1')).toBe(true);
    });

    it('returns false for completed tool use without another active lifecycle signal', () => {
      const session = makeSession('a1', 'ws-1', {
        messages: [
          {
            ...makeMessage('m1', 'assistant'),
            contentBlocks: [
              { type: 'tool_use', id: 'tool-1', name: 'read_file', input: {} },
              { type: 'tool_result', tool_use_id: 'tool-1', output: 'done' },
            ],
          },
        ],
      });
      const state = storeWith({ byAgentId: { a1: session }, agentIdsByWorkspace: {} });
      expect(selectAgentIsResponding.select(state, 'a1')).toBe(false);
    });

    it('returns false for inactive agents', () => {
      const session = makeSession('a1', 'ws-1', {
        status: 'Completed' as any,
        isStreaming: true,
        isProcessing: true,
      });
      const state = storeWith({ byAgentId: { a1: session }, agentIdsByWorkspace: {} });
      expect(selectAgentIsResponding.select(state, 'a1')).toBe(false);
      expect(selectAgentIsResponding.select(state, 'unknown')).toBe(false);
    });

    it('ignores unresolved tool_use on terminal messages (interrupted)', () => {
      const session = makeSession('a1', 'ws-1', {
        status: 'Idle' as any,
        isStreaming: false,
        isProcessing: false,
        isResponding: false,
        messages: [
          {
            ...makeMessage('m1', 'assistant'),
            isStreaming: false,
            streamingComplete: true,
            metadata: { interrupted: true, stopReason: 'interrupted' },
            contentBlocks: [{ type: 'tool_use', id: 'tool-1', name: 'read_file', input: {} }],
          },
        ],
      });
      const state = storeWith({ byAgentId: { a1: session }, agentIdsByWorkspace: {} });
      expect(selectAgentIsResponding.select(state, 'a1')).toBe(false);
    });

    it('ignores unresolved tool_use on messages with streamingComplete=true', () => {
      const session = makeSession('a1', 'ws-1', {
        status: 'Idle' as any,
        isStreaming: false,
        isProcessing: false,
        isResponding: false,
        messages: [
          {
            ...makeMessage('m1', 'assistant'),
            isStreaming: false,
            streamingComplete: true,
            contentBlocks: [{ type: 'tool_use', id: 'tool-1', name: 'read_file', input: {} }],
          },
        ],
      });
      const state = storeWith({ byAgentId: { a1: session }, agentIdsByWorkspace: {} });
      expect(selectAgentIsResponding.select(state, 'a1')).toBe(false);
    });

    it('pairs tool_use.toolCallId with tool_result.tool_use_id per PROTOCOL.md wire shape', () => {
      // PROTOCOL.md §7 (Streaming): tool_use blocks carry both an addressable
      // block `id` (messageId:blockIndex) and a provider `toolCallId`, and
      // tool_result blocks reference the call via `tool_use_id` set to the
      // toolCallId. Selectors must pair on toolCallId, not just the block id,
      // otherwise an otherwise-finished assistant turn looks unresolved and
      // the UI sits forever in "Thinking".
      const session = makeSession('a1', 'ws-1', {
        status: 'Idle' as any,
        isStreaming: false,
        isProcessing: false,
        isResponding: false,
        messages: [
          {
            ...makeMessage('m1', 'assistant'),
            contentBlocks: [
              {
                type: 'tool_use',
                id: '019f092b-msg:0',
                toolCallId: 'toolu_01JC',
                name: 'sub-agent-validate',
                input: {},
              },
              {
                type: 'tool_result',
                id: '019f092b-msg:1',
                tool_use_id: 'toolu_01JC',
                output: 'ok',
              },
              { type: 'text', text: 'done' },
            ],
          },
        ],
      });
      const state = storeWith({ byAgentId: { a1: session }, agentIdsByWorkspace: {} });
      expect(selectAgentIsResponding.select(state, 'a1')).toBe(false);
      expect(selectAgentIsThinking.select(state, 'a1')).toBe(false);
    });

    it('does not infer responding from an unresolved tool_use when BE flags are idle', () => {
      // The FE no longer derives "working" from message internals: an unresolved
      // tool_use without the daemon's isWaitingOnTool/isResponding flag is idle.
      const session = makeSession('a1', 'ws-1', {
        status: 'Idle' as any,
        isStreaming: false,
        isProcessing: false,
        isResponding: false,
        isWaitingOnTool: false,
        messages: [
          {
            ...makeMessage('m1', 'assistant'),
            contentBlocks: [
              {
                type: 'tool_use',
                id: '019f092b-msg:0',
                toolCallId: 'toolu_01JC',
                name: 'sub-agent-validate',
                input: {},
              },
            ],
          },
        ],
      });
      const state = storeWith({ byAgentId: { a1: session }, agentIdsByWorkspace: {} });
      expect(selectAgentIsResponding.select(state, 'a1')).toBe(false);
      expect(selectAgentIsThinking.select(state, 'a1')).toBe(false);
    });
  });

  it('selectAgentQueuedMessages returns agentQueue messages or empty array', () => {
    const qm: QueuedMessage = { id: 'q1', content: 'hi', queuedAt: '2024-01-01', position: 0 };
    const session = makeSession('a1');
    const state = {
      ...storeWith({ byAgentId: { a1: session }, agentIdsByWorkspace: {} }),
      agentQueue: agentQueueReducer(initialAgentQueueState, replaceAgentQueue('a1', [qm])),
    } as StoreState;
    expect(selectAgentQueuedMessages.select(state, 'a1')).toEqual([qm]);
    expect(selectAgentQueuedMessages.select(state, 'unknown')).toEqual([]);
  });

  describe('BE activity-flag wire-contract regression (AUDIT-P1-4)', () => {
    it('hydrating a completed session with idle BE flags leaves it not responding (composer usable)', () => {
      // PROTOCOL §5.5: terminal agents report all activity flags false. Hydrate
      // through the canonical reducer intake and assert the FE renders idle
      // verbatim rather than re-deriving "working" from the persisted transcript.
      const completed = makeSession('done', 'ws-1', {
        status: 'completed' as any,
        isResponding: false,
        isWaitingOnTool: false,
        isWaitingForOtherAgents: false,
        messages: [
          {
            ...makeMessage('m1', 'assistant'),
            streamingComplete: true,
            metadata: { stopReason: 'end_turn' } as any,
            contentBlocks: [{ type: 'text', text: 'All done.' }],
          },
        ],
      });
      const reduced = agentSessionReducer(initialState, bulkUpsertSessions([completed]));
      const state = storeWith({
        byAgentId: reduced.byAgentId,
        agentIdsByWorkspace: reduced.agentIdsByWorkspace,
      });

      expect(selectAgentIsResponding.select(state, 'done')).toBe(false);
      expect(selectAgentIsThinking.select(state, 'done')).toBe(false);
      expect(selectAgentIsRunning.select(state, 'done')).toBe(false);
    });

    it('renders an in-flight daemon turn (isResponding) as responding verbatim', () => {
      const live = makeSession('live', 'ws-1', { status: 'active' as any, isResponding: true });
      const reduced = agentSessionReducer(initialState, bulkUpsertSessions([live]));
      const state = storeWith({
        byAgentId: reduced.byAgentId,
        agentIdsByWorkspace: reduced.agentIdsByWorkspace,
      });

      expect(selectAgentIsResponding.select(state, 'live')).toBe(true);
    });
  });

  describe('selectAgentIsThinking', () => {
    it('preserves the verified active-thread behavior via selector composition', () => {
      const session = makeSession('a1', 'ws-1', { isResponding: true });
      const state = storeWith({ byAgentId: { a1: session }, agentIdsByWorkspace: {} });

      expect(selectAgentIsThinking.select(state, 'a1')).toBe(true);
      expect(selectAgentIsThinking.select(state, 'unknown')).toBe(false);
    });
  });

  describe('selectAgentIsWaitingForOtherAgents', () => {
    it('renders the daemon isWaitingForOtherAgents flag verbatim', () => {
      const session = makeSession('a1', 'ws-1', { isWaitingForOtherAgents: true });
      const state = storeWith({ byAgentId: { a1: session }, agentIdsByWorkspace: {} });

      expect(selectAgentIsWaitingForOtherAgents.select(state, 'a1')).toBe(true);
    });

    it('returns false when the flag is unset/false, terminal, or unknown', () => {
      const unset = makeSession('unset', 'ws-1', {});
      const explicitFalse = makeSession('explicit-false', 'ws-1', {
        isWaitingForOtherAgents: false,
      });
      const terminal = makeSession('terminal', 'ws-1', {
        status: 'Completed' as any,
        isWaitingForOtherAgents: true,
      });
      const state = storeWith({
        byAgentId: { unset, 'explicit-false': explicitFalse, terminal },
        agentIdsByWorkspace: {},
      });

      expect(selectAgentIsWaitingForOtherAgents.select(state, 'unset')).toBe(false);
      expect(selectAgentIsWaitingForOtherAgents.select(state, 'explicit-false')).toBe(false);
      expect(selectAgentIsWaitingForOtherAgents.select(state, 'terminal')).toBe(false);
      expect(selectAgentIsWaitingForOtherAgents.select(state, 'unknown')).toBe(false);
    });
  });

  describe('selectAgentIsWaiting', () => {
    it('returns true for explicit Waiting status', () => {
      const session = makeSession('a1', 'ws-1', { status: 'Waiting' as any });
      const state = storeWith({ byAgentId: { a1: session }, agentIdsByWorkspace: {} });

      expect(selectAgentIsWaiting.select(state, 'a1')).toBe(true);
    });

    it('returns true for waiting-for-other-agents relationships', () => {
      const session = makeSession('a1', 'ws-1', { isWaitingForOtherAgents: true });
      const state = storeWith({ byAgentId: { a1: session }, agentIdsByWorkspace: {} });

      expect(selectAgentIsWaiting.select(state, 'a1')).toBe(true);
      expect(selectAgentIsWaitingForOtherAgents.select(state, 'a1')).toBe(true);
    });

    it('returns true while the daemon flags the turn waiting on a tool', () => {
      const session = makeSession('a1', 'ws-1', { isWaitingOnTool: true });
      const state = storeWith({ byAgentId: { a1: session }, agentIdsByWorkspace: {} });

      expect(selectAgentIsWaiting.select(state, 'a1')).toBe(true);
    });

    it('does not infer waiting from message tool calls when BE flags are idle', () => {
      const session = makeSession('a1', 'ws-1', {
        status: 'idle' as any,
        isWaitingOnTool: false,
        messages: [
          {
            ...makeMessage('m1', 'assistant'),
            toolCalls: [{ id: 'tool-1', name: 'read_file', arguments: {}, status: 'running' }],
          },
        ],
      });
      const state = storeWith({ byAgentId: { a1: session }, agentIdsByWorkspace: {} });

      expect(selectAgentIsWaiting.select(state, 'a1')).toBe(false);
    });

    it('returns false after a message tool result resolves the tool call', () => {
      const session = makeSession('a1', 'ws-1', {
        messages: [
          {
            ...makeMessage('m1', 'assistant'),
            toolCalls: [{ id: 'tool-1', name: 'read_file', arguments: {} }],
            toolResults: [{ toolCallId: 'tool-1', content: 'done' }],
          },
        ],
      });
      const state = storeWith({ byAgentId: { a1: session }, agentIdsByWorkspace: {} });

      expect(selectAgentIsWaiting.select(state, 'a1')).toBe(false);
    });

    it('returns false after a tool result resolves the tool use', () => {
      const session = makeSession('a1', 'ws-1', {
        messages: [
          {
            ...makeMessage('m1', 'assistant'),
            contentBlocks: [
              { type: 'tool_use', id: 'tool-1', name: 'read_file', input: {} },
              { type: 'tool_result', tool_use_id: 'tool-1', output: 'done' },
            ],
          },
        ],
      });
      const state = storeWith({ byAgentId: { a1: session }, agentIdsByWorkspace: {} });

      expect(selectAgentIsWaiting.select(state, 'a1')).toBe(false);
    });

    it('returns false for terminal or unknown agents', () => {
      const session = makeSession('a1', 'ws-1', {
        status: 'Completed' as any,
        metadata: { waitingForAgentIds: ['a2'] } as any,
        messages: [
          {
            ...makeMessage('m1', 'assistant'),
            contentBlocks: [{ type: 'tool_use', id: 'tool-1', name: 'read_file', input: {} }],
          },
        ],
      });
      const state = storeWith({ byAgentId: { a1: session }, agentIdsByWorkspace: {} });

      expect(selectAgentIsWaiting.select(state, 'a1')).toBe(false);
      expect(selectAgentIsWaiting.select(state, 'unknown')).toBe(false);
    });
  });

  describe('selectAgentIsRunning', () => {
    it('returns true for active session lifecycle flags and statuses', () => {
      const activeSessions = [
        makeSession('streaming', 'ws-1', { isStreaming: true }),
        makeSession('processing-flag', 'ws-1', { isProcessing: true }),
        makeSession('responding', 'ws-1', { isResponding: true }),
        makeSession('activating', 'ws-1', { activationState: 'activating' as any }),
        makeSession('status-active', 'ws-1', { status: 'active' as any }),
        makeSession('status-processing', 'ws-1', { status: 'Processing' as any }),
        makeSession('status-waiting', 'ws-1', { status: 'Waiting' as any }),
      ];
      const state = storeWith({
        byAgentId: Object.fromEntries(activeSessions.map((s) => [s.id, s])),
        agentIdsByWorkspace: {},
      });

      for (const session of activeSessions) {
        expect(selectAgentIsRunning.select(state, session.id)).toBe(true);
      }
    });

    it('returns true when processing only with no streaming text', () => {
      const session = makeSession('a1', 'ws-1', {
        isProcessing: true,
        isStreaming: false,
        messages: [makeMessage('m1', 'assistant')],
      });
      const state = storeWith({ byAgentId: { a1: session }, agentIdsByWorkspace: {} });
      expect(selectAgentIsRunning.select(state, 'a1')).toBe(true);
    });

    it('returns true while the daemon flags the turn waiting on a tool', () => {
      const session = makeSession('a1', 'ws-1', {
        isStreaming: false,
        isProcessing: false,
        isWaitingOnTool: true,
      });
      const state = storeWith({ byAgentId: { a1: session }, agentIdsByWorkspace: {} });
      expect(selectAgentIsRunning.select(state, 'a1')).toBe(true);
    });

    it('returns true while ACTIVATING', () => {
      const session = makeSession('a1', 'ws-1', {
        activationState: 'activating' as any,
        isStreaming: false,
        isProcessing: false,
      });
      const state = storeWith({ byAgentId: { a1: session }, agentIdsByWorkspace: {} });
      expect(selectAgentIsRunning.select(state, 'a1')).toBe(true);
    });

    it('returns true for status Active with no streaming text', () => {
      const session = makeSession('a1', 'ws-1', {
        status: 'active' as any,
        isStreaming: false,
        isProcessing: false,
        messages: [makeMessage('m1', 'assistant')],
      });
      const state = storeWith({ byAgentId: { a1: session }, agentIdsByWorkspace: {} });
      expect(selectAgentIsRunning.select(state, 'a1')).toBe(true);
    });

    it('returns true for waiting-for-other-agents relationships', () => {
      const session = makeSession('a1', 'ws-1', {
        status: 'idle' as any,
        isStreaming: false,
        isProcessing: false,
        isWaitingForOtherAgents: true,
      });
      const state = storeWith({ byAgentId: { a1: session }, agentIdsByWorkspace: {} });
      expect(selectAgentIsRunning.select(state, 'a1')).toBe(true);
    });

    it('returns true for a BE-reported in-flight (responding) turn', () => {
      const session = makeSession('a1', 'ws-1', {
        isStreaming: false,
        isProcessing: false,
        isResponding: true,
      });
      const state = storeWith({ byAgentId: { a1: session }, agentIdsByWorkspace: {} });
      expect(selectAgentIsRunning.select(state, 'a1')).toBe(true);
    });

    it('returns false for terminal statuses', () => {
      const terminalSessions = [
        makeSession('completed', 'ws-1', {
          status: 'Completed' as any,
          isStreaming: true,
          isProcessing: true,
          metadata: { waitingForAgentIds: ['a2'] } as any,
        }),
        makeSession('error', 'ws-1', { status: 'error' as any, isStreaming: true }),
        makeSession('deleted', 'ws-1', { status: 'deleted' as any, isProcessing: true }),
      ];
      const state = storeWith({
        byAgentId: Object.fromEntries(terminalSessions.map((s) => [s.id, s])),
        agentIdsByWorkspace: {},
      });

      for (const session of terminalSessions) {
        expect(selectAgentIsRunning.select(state, session.id)).toBe(false);
      }
    });

    it('returns false for a cleanly ended turn (end_turn, not streaming, idle)', () => {
      const session = makeSession('a1', 'ws-1', {
        status: 'idle' as any,
        isStreaming: false,
        isProcessing: false,
        isResponding: false,
        messages: [
          {
            ...makeMessage('m1', 'assistant'),
            streamingComplete: true,
            metadata: { stopReason: 'end_turn' } as any,
            contentBlocks: [{ type: 'text', text: 'Done.' }],
          },
        ],
      });
      const state = storeWith({ byAgentId: { a1: session }, agentIdsByWorkspace: {} });
      expect(selectAgentIsRunning.select(state, 'a1')).toBe(false);
    });

    it('returns false for unknown agents', () => {
      const state = storeWith({ byAgentId: {}, agentIdsByWorkspace: {} });
      expect(selectAgentIsRunning.select(state, 'unknown')).toBe(false);
    });
  });

  describe('selectAllRetainedAgentSessions', () => {
    it('retains agents with raw streaming/processing/responding flags', () => {
      const streaming = makeSession('streaming', 'ws-1', { isStreaming: true });
      const processing = makeSession('processing', 'ws-1', { isProcessing: true });
      const responding = makeSession('responding', 'ws-1', { isResponding: true });
      const state = storeWith({
        byAgentId: { streaming, processing, responding },
        agentIdsByWorkspace: {},
      });

      const ids = selectAllRetainedAgentSessions.select(state).map((s) => s.id);
      expect(ids.sort()).toEqual(['processing', 'responding', 'streaming']);
    });

    it('retains agents waiting for other agents', () => {
      const session = makeSession('coordinator', 'ws-1', {
        status: 'idle' as any,
        isStreaming: false,
        isProcessing: false,
        isResponding: false,
        isWaitingForOtherAgents: true,
      });
      const state = storeWith({ byAgentId: { coordinator: session }, agentIdsByWorkspace: {} });

      expect(selectAllRetainedAgentSessions.select(state).map((s) => s.id)).toEqual([
        'coordinator',
      ]);
    });

    it('retains agents in Waiting status', () => {
      const session = makeSession('waiting', 'ws-1', {
        status: 'Waiting' as any,
        isStreaming: false,
        isProcessing: false,
        isResponding: false,
      });
      const state = storeWith({ byAgentId: { waiting: session }, agentIdsByWorkspace: {} });

      expect(selectAllRetainedAgentSessions.select(state).map((s) => s.id)).toEqual(['waiting']);
    });

    it('retains agents the daemon flags as waiting on a tool', () => {
      const session = makeSession('tooling', 'ws-1', {
        status: 'idle' as any,
        isStreaming: false,
        isProcessing: false,
        isResponding: false,
        isWaitingOnTool: true,
      });
      const state = storeWith({ byAgentId: { tooling: session }, agentIdsByWorkspace: {} });

      expect(selectAllRetainedAgentSessions.select(state).map((s) => s.id)).toEqual(['tooling']);
    });

    it('does not retain terminal or idle agents', () => {
      const completed = makeSession('completed', 'ws-1', {
        status: 'Completed' as any,
        isStreaming: true,
        metadata: { waitingForAgentIds: ['child'] } as any,
      });
      const idle = makeSession('idle', 'ws-1', {
        status: 'idle' as any,
        isStreaming: false,
        isProcessing: false,
        isResponding: false,
      });
      const state = storeWith({
        byAgentId: { completed, idle },
        agentIdsByWorkspace: {},
      });

      expect(selectAllRetainedAgentSessions.select(state)).toEqual([]);
    });
  });

  describe('selectAgentMessageById', () => {
    it('returns the matching message when agent and message exist (hit)', () => {
      const m1 = makeMessage('m1');
      const m2 = makeMessage('m2', 'assistant');
      const session = makeSession('a1', 'ws-1', { messages: [m1, m2] });
      const state = storeWith({ byAgentId: { a1: session } });
      expect(selectAgentMessageById.select(state, 'a1', 'm2')).toEqual(m2);
    });

    it('returns undefined for an unknown messageId in an existing session (miss)', () => {
      const session = makeSession('a1', 'ws-1', { messages: [makeMessage('m1')] });
      const state = storeWith({ byAgentId: { a1: session } });
      expect(selectAgentMessageById.select(state, 'a1', 'unknown')).toBeUndefined();
    });

    it('returns undefined when the agent session does not exist (no session)', () => {
      const state = storeWith({ byAgentId: {} });
      expect(selectAgentMessageById.select(state, 'a1', 'm1')).toBeUndefined();
    });

    it('returns undefined when agentSessions state is undefined', () => {
      const state = { agentSessions: undefined } as unknown as StoreState;
      expect(selectAgentMessageById.select(state, 'a1', 'm1')).toBeUndefined();
    });

    it('returns undefined when agentId or messageId is empty', () => {
      const session = makeSession('a1', 'ws-1', { messages: [makeMessage('m1')] });
      const state = storeWith({ byAgentId: { a1: session } });
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

describe('setAgentStreaming (agent-session action — single source of truth)', () => {
  it('updates isStreaming in agent-session state', () => {
    const session = makeSession('a1', 'ws-1', { isStreaming: false });
    let state = agentSessionReducer(initialState, upsertSession(session));
    expect(state.byAgentId['a1'].isStreaming).toBeFalsy();

    state = agentSessionReducer(state, setAgentStreaming('a1', true));
    expect(state.byAgentId['a1'].isStreaming).toBe(true);

    state = agentSessionReducer(state, setAgentStreaming('a1', false));
    expect(state.byAgentId['a1'].isStreaming).toBe(false);
  });

  it('is no-op when agent session does not exist', () => {
    const state = agentSessionReducer(initialState, setAgentStreaming('unknown', true));
    expect(state).toBe(initialState);
  });

  it('is no-op when streaming value is unchanged', () => {
    const session = makeSession('a1', 'ws-1', { isStreaming: true });
    const state = agentSessionReducer(initialState, upsertSession(session));
    const next = agentSessionReducer(state, setAgentStreaming('a1', true));
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
    const sentAt = Date.parse('2024-01-02T03:04:05.000Z');
    const state = agentSessionReducer(initialState, chatSendStarted('agent-new', 'ws-1', sentAt));

    const session = state.byAgentId['agent-new'];
    expect(session).toBeDefined();
    expect(session.isProcessing).toBe(true);
    expect(session.isStreaming).toBe(true);
    expect(getMsgs(state, 'agent-new')).toEqual([]);
    expect(session.workspaceId).toBe('ws-1');
    expect(session.createdAt).toBe('2024-01-02T03:04:05.000Z');
    expect(session.updatedAt).toBe('2024-01-02T03:04:05.000Z');
  });

  it('sets isProcessing and isStreaming on an existing session', () => {
    const existing = makeSession('a1', 'ws-1', { isProcessing: false, isStreaming: false });
    let state = agentSessionReducer(initialState, upsertSession(existing));

    state = agentSessionReducer(state, chatSendStarted('a1', 'ws-1'));

    expect(state.byAgentId['a1'].isProcessing).toBe(true);
    expect(state.byAgentId['a1'].isStreaming).toBe(true);
  });

  it('does not create a placeholder session when wsId is unavailable', () => {
    const state = agentSessionReducer(initialState, chatSendStarted('agent-new'));

    expect(state).toBe(initialState);
    expect(state.byAgentId['agent-new']).toBeUndefined();
  });
});

describe('stream completion clears stale responding flags', () => {
  it('clears isResponding when a stream completes', () => {
    const existing = makeSession('a1', 'ws-1', {
      isStreaming: true,
      isProcessing: true,
      isResponding: true,
    });
    let state = agentSessionReducer(initialState, upsertSession(existing));

    state = agentSessionReducer(
      state,
      streamCompleted('a1', { lastAttemptedMessage: null, modelUnavailable: null }),
    );

    expect(state.byAgentId['a1'].isStreaming).toBe(false);
    expect(state.byAgentId['a1'].isProcessing).toBe(false);
    expect(state.byAgentId['a1'].isResponding).toBe(false);
  });

  it('clears isResponding when send fails before completion', () => {
    const existing = makeSession('a1', 'ws-1', {
      isStreaming: true,
      isProcessing: true,
      isResponding: true,
    });
    let state = agentSessionReducer(initialState, upsertSession(existing));

    state = agentSessionReducer(state, chatSendFailed('a1', ''));

    expect(state.byAgentId['a1'].isStreaming).toBe(false);
    expect(state.byAgentId['a1'].isProcessing).toBe(false);
    expect(state.byAgentId['a1'].isResponding).toBe(false);
  });
});

// ===========================================================================
// Regression: upsertSession preserves in-flight flags from placeholder
// ===========================================================================

describe('upsertSession — preserves isProcessing/isStreaming from placeholder (regression)', () => {
  it('uses the session workspaceId for storage and workspace indexing', () => {
    const session = makeSession('a1', 'ws-1');

    const state = agentSessionReducer(initialState, upsertSession(session));

    expect(state.byAgentId['a1'].workspaceId).toBe('ws-1');
    expect(state.agentIdsByWorkspace['ws-1']).toEqual(['a1']);
  });

  it('preserves isProcessing=true from placeholder when incoming session omits flags', () => {
    // Simulate the restored workspace flow:
    // 1. chatSendStarted creates a placeholder with isProcessing=true
    // 2. The full session loads from disk without flag fields (undefined)
    // The fix ensures the flags are preserved so the UI keeps showing the indicator.
    let state = agentSessionReducer(initialState, chatSendStarted('a1', 'ws-1'));
    expect(state.byAgentId['a1'].isProcessing).toBe(true);
    expect(state.byAgentId['a1'].isStreaming).toBe(true);

    // upsertSession arrives with the real session (flags omitted / undefined)
    const realSession = makeSession('a1', 'ws-1', {
      name: 'Real Agent',
    });
    delete (realSession as any).isProcessing;
    delete (realSession as any).isStreaming;
    state = agentSessionReducer(
      state,
      upsertSession({
        ...realSession,
        workspaceId: 'ws-1' as AgentSession['workspaceId'],
      }),
    );

    // Flags should be preserved from the placeholder
    expect(state.byAgentId['a1'].isProcessing).toBe(true);
    expect(state.byAgentId['a1'].isStreaming).toBe(true);
    // But the real session data should be applied
    expect(state.byAgentId['a1'].name).toBe('Real Agent');
  });

  it('respects explicit clear (safety timeout) when a flag is flipped off first', () => {
    // Wave 10: an explicit clear still wins, but only through the real
    // safety-timeout sequence — setAgentStreaming(false) flips isStreaming off
    // first, breaking the both-true active-turn guard, then the upsert clears
    // the remaining isProcessing flag. A snapshot alone may not clobber a
    // genuinely in-flight (both-true) turn — see Test C.
    let state = agentSessionReducer(initialState, chatSendStarted('a1', 'ws-1'));
    expect(state.byAgentId['a1'].isProcessing).toBe(true);
    expect(state.byAgentId['a1'].isStreaming).toBe(true);

    state = agentSessionReducer(state, setAgentStreaming('a1', false));

    const realSession = makeSession('a1', 'ws-1', {
      isProcessing: false,
      isStreaming: false,
      name: 'Real Agent',
    });
    state = agentSessionReducer(
      state,
      upsertSession({
        ...realSession,
        workspaceId: 'ws-1' as AgentSession['workspaceId'],
      }),
    );

    // Explicit clear wins
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
    state = agentSessionReducer(
      state,
      upsertSession({
        ...incoming,
        workspaceId: 'ws-1' as AgentSession['workspaceId'],
      }),
    );

    expect(state.byAgentId['a1'].isProcessing).toBeFalsy();
    expect(state.byAgentId['a1'].isStreaming).toBeFalsy();
  });
});

// ===========================================================================
// Regression: chatInitialized must not re-set isStreaming after agent:idle
// ===========================================================================

describe('chatInitialized — does not override agent:idle cleanup', () => {
  it('does NOT re-set isStreaming=true when session is authoritatively idle', () => {
    // Simulate the late stale initialization condition:
    // 1. chatSendStarted sets isStreaming=true
    // 2. agent:idle event clears isStreaming and sets status='idle', stopReason='end_turn'
    // 3. chatInitialized arrives with stale isStreaming=true from saga

    // Step 1: Start streaming
    let state = agentSessionReducer(initialState, chatSendStarted('a1', 'ws-1'));
    expect(state.byAgentId['a1'].isStreaming).toBe(true);

    // Step 2: agent:idle event clears streaming
    state = agentSessionReducer(
      state,
      eventReceived('ws-1', {
        id: 'evt-1',
        type: 'agent:idle',
        timestamp: '2024-01-01T00:00:00.000Z',
        workspaceId: 'ws-1',
        data: {
          agentId: 'a1',
          status: 'idle',
          isStreaming: false,
          isProcessing: false,
          isResponding: false,
          stopReason: 'end_turn',
        },
      } as any),
    );
    expect(state.byAgentId['a1'].isStreaming).toBe(false);
    expect(state.byAgentId['a1'].status).toBe('idle');
    expect(state.byAgentId['a1'].stopReason).toBe('end_turn');

    // Step 3: chatInitialized arrives with stale isStreaming=true — no-op
    state = agentSessionReducer(
      state,
      chatInitialized('a1', {
        isStreaming: true,
        lastAttemptedMessage: null,
      }),
    );

    // isStreaming must remain false — chatInitialized never sets isStreaming=true
    expect(state.byAgentId['a1'].isStreaming).toBe(false);
    expect(state.byAgentId['a1'].isProcessing).toBe(false);
  });

  it('chatInitialized with isStreaming=true is a no-op (does not change existing flags)', () => {
    // chatInitialized only clears streaming, never sets it.
    // When saga says streaming=true, the existing value is preserved unchanged.
    const session = makeSession('a1', 'ws-1', {
      status: 'responding',
      isStreaming: true,
      isProcessing: true,
    });
    let state = agentSessionReducer(initialState, upsertSession(session));

    state = agentSessionReducer(
      state,
      chatInitialized('a1', {
        isStreaming: true,
        lastAttemptedMessage: null,
      }),
    );

    // isStreaming stays true — it was already true from chatSendStarted/upsertSession
    expect(state.byAgentId['a1'].isStreaming).toBe(true);
    expect(state.byAgentId['a1'].isProcessing).toBe(true);
  });

  it('chatInitialized with isStreaming=false clears streaming flags', () => {
    // When the saga determines the agent is NOT streaming,
    // chatInitialized propagates the clear.
    const session = makeSession('a1', 'ws-1', {
      status: 'idle',
      isStreaming: true,
      isProcessing: true,
    });
    let state = agentSessionReducer(initialState, upsertSession(session));

    state = agentSessionReducer(
      state,
      chatInitialized('a1', {
        isStreaming: false,
        lastAttemptedMessage: null,
      }),
    );

    expect(state.byAgentId['a1'].isStreaming).toBe(false);
    expect(state.byAgentId['a1'].isProcessing).toBe(false);
  });

  it('upsertSession does not re-introduce isStreaming=true on authoritatively idle session', () => {
    // Simulate: agent:idle clears flags, then saga dispatches upsertSession with stale data
    // Step 1: Start streaming
    let state = agentSessionReducer(initialState, chatSendStarted('a1', 'ws-1'));
    expect(state.byAgentId['a1'].isStreaming).toBe(true);

    // Step 2: agent:idle clears streaming
    state = agentSessionReducer(
      state,
      eventReceived('ws-1', {
        id: 'evt-1',
        type: 'agent:idle',
        timestamp: '2024-01-01T00:00:00.000Z',
        workspaceId: 'ws-1',
        data: {
          agentId: 'a1',
          status: 'idle',
          isStreaming: false,
          isProcessing: false,
          isResponding: false,
          stopReason: 'end_turn',
        },
      } as any),
    );
    expect(state.byAgentId['a1'].isStreaming).toBe(false);

    // Step 3: Saga dispatches upsertSession with stale isStreaming=true
    const staleSession = makeSession('a1', 'ws-1', {
      status: 'idle',
      isStreaming: true,
      isProcessing: true,
      stopReason: 'end_turn',
    });
    state = agentSessionReducer(state, upsertSession(staleSession));

    // isStreaming must remain false — upsertSession guard preserves idle cleanup
    expect(state.byAgentId['a1'].isStreaming).toBe(false);
    expect(state.byAgentId['a1'].isProcessing).toBe(false);
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
      contentBlocks: [{ type: 'tool_use', name: 'read_file', input: { path: 'foo.ts' } }],
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
      contentBlocks: [
        { type: 'audio', data: 'audiodata', mimeType: 'audio/mp3', transcript: 'hello' },
      ],
    };
    expect(computeMessageContentHash(msg)).not.toBeNull();
  });

  it('produces a non-null hash for file-only messages', () => {
    const msg: AgentMessage = {
      id: 'file1',
      role: 'user',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [
        { type: 'file', data: 'filedata', mimeType: 'text/plain', fileName: 'readme.txt' },
      ],
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
      contentBlocks: [
        { type: 'audio', data: 'audiodata', mimeType: 'audio/mp3', transcript: 'hi' },
      ],
    };
    const b: AgentMessage = {
      id: 'b1',
      role: 'user',
      timestamp: '2024-01-01T00:00:01.000Z',
      contentBlocks: [
        { type: 'audio', data: 'audiodata', mimeType: 'audio/mp3', transcript: 'hi' },
      ],
    };
    expect(computeMessageContentHash(a)).toBe(computeMessageContentHash(b));
  });

  it('produces the same hash for two logically-equal file messages', () => {
    const a: AgentMessage = {
      id: 'a1',
      role: 'user',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [
        { type: 'file', data: 'filedata', mimeType: 'text/plain', fileName: 'readme.txt' },
      ],
    };
    const b: AgentMessage = {
      id: 'b1',
      role: 'user',
      timestamp: '2024-01-01T00:00:01.000Z',
      contentBlocks: [
        { type: 'file', data: 'filedata', mimeType: 'text/plain', fileName: 'readme.txt' },
      ],
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
      id: 'a',
      role: 'user',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'image', data: makePayload(LEN, 'X', 10), mimeType: 'image/png' }],
    };
    const b: AgentMessage = {
      id: 'b',
      role: 'user',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'image', data: makePayload(LEN, 'Y', 10), mimeType: 'image/png' }],
    };
    expect(computeMessageContentHash(a)).not.toBe(computeMessageContentHash(b));
  });

  it('distinguishes large same-length payloads that differ near the end', () => {
    const LEN = 2_000_000;
    const a: AgentMessage = {
      id: 'a',
      role: 'user',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [
        { type: 'image', data: makePayload(LEN, 'X', LEN - 20), mimeType: 'image/png' },
      ],
    };
    const b: AgentMessage = {
      id: 'b',
      role: 'user',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [
        { type: 'image', data: makePayload(LEN, 'Y', LEN - 20), mimeType: 'image/png' },
      ],
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
      id: 'a',
      role: 'user',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'audio', data: head + aInterior + tail, mimeType: 'audio/wav' }],
    };
    const b: AgentMessage = {
      id: 'b',
      role: 'user',
      timestamp: '2024-01-01T00:00:00.000Z',
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
      id: 'big',
      role: 'user',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [
        { type: 'file', data, mimeType: 'application/octet-stream', fileName: 'blob.bin' },
      ],
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
        {
          type: 'tool_use',
          name: 'search',
          input: { query: 'hi', limit: 10, nested: { a: 1, b: 2 } },
        },
      ],
    };
    const b: AgentMessage = {
      id: 'b1',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [
        {
          type: 'tool_use',
          name: 'search',
          input: { nested: { b: 2, a: 1 }, limit: 10, query: 'hi' },
        },
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
      contentBlocks: [{ type: 'tool_use', name: 'search', input: { query: 'hi' } }],
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
// Shared logical dedup applies in reducer insert/replace paths
// ============================================================================

describe('addMessage with shared logical dedup', () => {
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

  it('collapses local-UUID into incoming msg_* when content matches', () => {
    const localMsg = makeContentMessage('local-uuid', 'assistant', 'Hello world');
    let state = agentSessionReducer(
      initialState,
      upsertSession(makeSession('a1', 'ws-1', { messages: [localMsg] })),
    );
    const backendMsg = makeContentMessage(
      'msg_backend',
      'assistant',
      'Hello world',
      '2024-01-01T00:00:02.000Z',
    );
    state = agentSessionReducer(state, addMessage('a1', backendMsg));
    expect(getMsgs(state, 'a1').map((m) => m.id)).toEqual(['msg_backend']);
  });

  it('collapses local-UUID into incoming msg_* when explicit turnNumber matches', () => {
    const localMsg = {
      ...makeContentMessage('local-uuid', 'assistant', 'Hello world'),
      turnNumber: 2,
    };
    let state = agentSessionReducer(
      initialState,
      upsertSession(makeSession('a1', 'ws-1', { messages: [localMsg] })),
    );
    const backendMsg = {
      ...makeContentMessage('msg_backend', 'assistant', 'Hello world', '2024-01-01T00:00:02.000Z'),
      turnNumber: 2,
    };
    state = agentSessionReducer(state, addMessage('a1', backendMsg));
    expect(getMsgs(state, 'a1').map((m) => m.id)).toEqual(['msg_backend']);
  });

  it('keeps local-UUID and canonical assistant messages when explicit turnNumbers differ', () => {
    const localMsg = {
      ...makeContentMessage('local-uuid', 'assistant', 'Hello world'),
      turnNumber: 1,
    };
    let state = agentSessionReducer(
      initialState,
      upsertSession(makeSession('a1', 'ws-1', { messages: [localMsg] })),
    );
    const backendMsg = {
      ...makeContentMessage('msg_backend', 'assistant', 'Hello world', '2024-01-01T00:00:02.000Z'),
      turnNumber: 2,
    };
    state = agentSessionReducer(state, addMessage('a1', backendMsg));
    expect(getMsgs(state, 'a1').map((m) => m.id)).toEqual(['local-uuid', 'msg_backend']);
  });

  it('keeps incoming canonical assistant duplicate when turnNumber is missing', () => {
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
    let state = agentSessionReducer(
      initialState,
      upsertSession(makeSession('a1', 'ws-1', { messages: [existing] })),
    );
    state = agentSessionReducer(state, addMessage('a1', incoming));
    expect(getMsgs(state, 'a1').map((m) => m.id)).toEqual(['msg_existing', 'msg_incoming']);
  });

  it('collapses same-turn assistant duplicates when appMessageIds differ', () => {
    const existing: AgentMessage = {
      id: 'msg_existing',
      appMessageId: 'app_msg_existing',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:00.000Z',
      turnNumber: 2,
      contentBlocks: [{ type: 'text', text: 'Repeated answer' }],
    };
    const incoming: AgentMessage = {
      id: 'msg_incoming',
      appMessageId: 'app_msg_incoming',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:02.000Z',
      turnNumber: 2,
      contentBlocks: [{ type: 'text', text: 'Repeated answer' }],
    };
    let state = agentSessionReducer(
      initialState,
      upsertSession(makeSession('a1', 'ws-1', { messages: [existing] })),
    );
    state = agentSessionReducer(state, addMessage('a1', incoming));
    expect(getMsgs(state, 'a1').map((m) => m.id)).toEqual(['msg_incoming']);
  });

  it('keeps ACP accumulated assistant messages with distinct appMessageIds when turnNumber is missing', () => {
    const existing = makeAcpAccumulatedAssistantMessage(
      'msg_existing_acp',
      'app_msg_existing_acp',
      '2024-01-01T00:00:00.000Z',
      { source: 'streaming-snapshot' },
    );
    const finalMessage = makeAcpAccumulatedAssistantMessage(
      'msg_final_acp',
      'app_msg_final_acp',
      '2024-01-01T00:00:02.000Z',
      { stopReason: 'end_turn', model: 'gpt-test' },
    );
    let state = agentSessionReducer(
      initialState,
      upsertSession(makeSession('a1', 'ws-1', { messages: [existing] })),
    );
    state = agentSessionReducer(state, addMessage('a1', finalMessage));

    const messages = getMsgs(state, 'a1');
    expect(messages.map((m) => m.id)).toEqual(['msg_existing_acp', 'msg_final_acp']);
  });

  it('collapses stale streaming placeholder and finalized assistant message when appMessageIds differ', () => {
    const placeholder = {
      ...makeContentMessage('msg_streaming', 'assistant', 'Repeated answer'),
      appMessageId: 'app_msg_streaming',
      isStreaming: true,
    };
    let state = agentSessionReducer(
      initialState,
      upsertSession(makeSession('a1', 'ws-1', { messages: [placeholder], isStreaming: true })),
    );

    const finalMessage = {
      ...makeContentMessage(
        'msg_final',
        'assistant',
        'Repeated answer',
        '2024-01-01T00:00:02.000Z',
      ),
      appMessageId: 'app_msg_final',
      isStreaming: false,
    };
    state = agentSessionReducer(state, addMessage('a1', finalMessage));

    const messages = getMsgs(state, 'a1');
    expect(messages.map((m) => m.id)).toEqual(['msg_final']);
  });

  it('keeps final-final assistant replies when exactly one message has appMessageId and turnNumber is missing', () => {
    const existing = makeContentMessage('local-uuid', 'assistant', 'Hello world');
    const incoming = {
      ...makeContentMessage('msg_backend', 'assistant', 'Hello world', '2024-01-01T00:00:02.000Z'),
      appMessageId: 'app_msg_incoming',
    };
    let state = agentSessionReducer(
      initialState,
      upsertSession(makeSession('a1', 'ws-1', { messages: [existing] })),
    );
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
    let state = agentSessionReducer(
      initialState,
      upsertSession(makeSession('a1', 'ws-1', { messages: [existing] })),
    );
    state = agentSessionReducer(state, addMessage('a1', incoming));
    expect(getMsgs(state, 'a1')).toHaveLength(2);
  });

  it('collapses a same-turn canonical duplicate after preserving a different-turn repeat', () => {
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
    let state = agentSessionReducer(
      initialState,
      upsertSession(makeSession('a1', 'ws-1', { messages: [localMsg] })),
    );
    const backendMsg = makeContentMessage(
      'msg_backend',
      'assistant',
      'Goodbye world',
      '2024-01-01T00:00:02.000Z',
    );
    state = agentSessionReducer(state, addMessage('a1', backendMsg));
    // Should have 2 messages (no match)
    expect(getMsgs(state, 'a1')).toHaveLength(2);
  });

  it('does not replace when roles differ', () => {
    const localMsg = makeContentMessage('local-uuid', 'user', 'Hello world');
    let state = agentSessionReducer(
      initialState,
      upsertSession(makeSession('a1', 'ws-1', { messages: [localMsg] })),
    );
    const backendMsg = makeContentMessage(
      'msg_backend',
      'assistant',
      'Hello world',
      '2024-01-01T00:00:02.000Z',
    );
    state = agentSessionReducer(state, addMessage('a1', backendMsg));
    expect(getMsgs(state, 'a1')).toHaveLength(2);
  });

  it('does not replace when timestamps are far apart', () => {
    const localMsg = makeContentMessage(
      'local-uuid',
      'assistant',
      'Hello world',
      '2024-01-01T00:00:00.000Z',
    );
    let state = agentSessionReducer(
      initialState,
      upsertSession(makeSession('a1', 'ws-1', { messages: [localMsg] })),
    );
    const backendMsg = makeContentMessage(
      'msg_backend',
      'assistant',
      'Hello world',
      '2024-01-01T01:00:00.000Z',
    );
    state = agentSessionReducer(state, addMessage('a1', backendMsg));
    expect(getMsgs(state, 'a1')).toHaveLength(2);
  });

  it('does not replace when incoming ID is not canonical', () => {
    const localMsg = makeContentMessage('local-uuid-1', 'assistant', 'Hello world');
    let state = agentSessionReducer(
      initialState,
      upsertSession(makeSession('a1', 'ws-1', { messages: [localMsg] })),
    );
    const otherMsg = makeContentMessage(
      'local-uuid-2',
      'assistant',
      'Hello world',
      '2024-01-01T00:00:02.000Z',
    );
    state = agentSessionReducer(state, addMessage('a1', otherMsg));
    // Both should remain since the incoming ID isn't canonical
    expect(getMsgs(state, 'a1')).toHaveLength(2);
  });
});

describe('replaceMessageById', () => {
  it('replaces a message in-place preserving array position', () => {
    const msgA: AgentMessage = {
      id: 'msg_a',
      role: 'user',
      timestamp: '2024-01-01T00:00:10.000Z',
      contentBlocks: [{ type: 'text', text: 'First' }],
    };
    const localB: AgentMessage = {
      id: 'local-uuid-b',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:20.000Z',
      contentBlocks: [{ type: 'text', text: 'Middle' }],
    };
    const msgC: AgentMessage = {
      id: 'msg_c',
      role: 'user',
      timestamp: '2024-01-01T00:00:30.000Z',
      contentBlocks: [{ type: 'text', text: 'Third' }],
    };
    let state = agentSessionReducer(
      initialState,
      upsertSession(makeSession('a1', 'ws-1', { messages: [msgA, localB, msgC] })),
    );
    const canonicalB: AgentMessage = {
      id: 'msg_b_canonical',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:20.000Z',
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
      id: 'msg_a',
      role: 'user',
      timestamp: '2024-01-01T00:00:10.000Z',
      contentBlocks: [{ type: 'text', text: 'Hello' }],
    };
    let state = agentSessionReducer(
      initialState,
      upsertSession(makeSession('a1', 'ws-1', { messages: [msg] })),
    );
    const replacement: AgentMessage = {
      id: 'msg_new',
      role: 'user',
      timestamp: '2024-01-01T00:00:10.000Z',
      contentBlocks: [{ type: 'text', text: 'Hello' }],
    };
    const before = state;
    state = agentSessionReducer(state, replaceMessageById('a1', 'nonexistent-id', replacement));
    expect(state).toBe(before);
  });

  it('preserves position even when new timestamp would sort to end', () => {
    const m1: AgentMessage = {
      id: 'msg_m1',
      role: 'user',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [{ type: 'text', text: 'First' }],
    };
    const m2: AgentMessage = {
      id: 'msg_m2',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:10.000Z',
      contentBlocks: [{ type: 'text', text: 'Second' }],
    };
    const m3: AgentMessage = {
      id: 'msg_m3',
      role: 'user',
      timestamp: '2024-01-01T00:00:20.000Z',
      contentBlocks: [{ type: 'text', text: 'Third' }],
    };
    let state = agentSessionReducer(
      initialState,
      upsertSession(makeSession('a1', 'ws-1', { messages: [m1, m2, m3] })),
    );
    const newMsg: AgentMessage = {
      id: 'msg_new',
      role: 'assistant',
      timestamp: '2024-01-01T00:01:40.000Z',
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
      id: 'local-uuid',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:10.000Z',
      contentBlocks: [{ type: 'text', text: 'Reply' }],
    };
    const canonicalAlreadyThere: AgentMessage = {
      id: 'msg_canonical',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:11.000Z',
      contentBlocks: [{ type: 'text', text: 'Reply' }],
    };
    let state = agentSessionReducer(
      initialState,
      upsertSession(makeSession('a1', 'ws-1', { messages: [local, canonicalAlreadyThere] })),
    );
    state = agentSessionReducer(
      state,
      replaceMessageById('a1', 'local-uuid', canonicalAlreadyThere),
    );
    const msgs = getMsgs(state, 'a1');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].id).toBe('msg_canonical');
  });

  it('keeps canonical assistant messages with different IDs when turnNumber is missing', () => {
    const local: AgentMessage = {
      id: 'local-uuid',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:10.000Z',
      contentBlocks: [{ type: 'text', text: 'Draft reply' }],
    };
    const existingCanonical: AgentMessage = {
      id: 'msg_existing',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:11.000Z',
      contentBlocks: [{ type: 'text', text: 'Final reply' }],
    };
    const replacement: AgentMessage = {
      id: 'msg_replacement',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:12.000Z',
      contentBlocks: [{ type: 'text', text: 'Final reply' }],
    };
    let state = agentSessionReducer(
      initialState,
      upsertSession(makeSession('a1', 'ws-1', { messages: [local, existingCanonical] })),
    );
    state = agentSessionReducer(state, replaceMessageById('a1', 'local-uuid', replacement));
    const msgs = getMsgs(state, 'a1');
    expect(msgs.map((m) => m.id)).toEqual(['msg_replacement', 'msg_existing']);
  });
});

describe('upsertSession with shared logical dedup', () => {
  it('deduplicates content-duplicate messages on upsert', () => {
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
    const session = makeSession('a1', 'ws-1', { messages: [localMsg, canonicalMsg] });
    const state = agentSessionReducer(initialState, upsertSession(session));
    expect(getMsgs(state, 'a1').map((m) => m.id)).toEqual(['msg_canonical']);
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

  it('keeps final-final assistant replies with exactly one appMessageId on upsert when turnNumber is missing', () => {
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

  it('deduplicates stale streaming placeholder with finalized message on upsert when appMessageIds differ', () => {
    const placeholder: AgentMessage = {
      id: 'msg_streaming',
      appMessageId: 'app_msg_streaming',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:00.000Z',
      isStreaming: true,
      contentBlocks: [{ type: 'text', text: 'Finalized content' }],
    };
    const finalMessage: AgentMessage = {
      id: 'msg_final',
      appMessageId: 'app_msg_final',
      role: 'assistant',
      timestamp: '2024-01-01T00:00:02.000Z',
      isStreaming: false,
      contentBlocks: [{ type: 'text', text: 'Finalized content' }],
    };
    const state = agentSessionReducer(
      initialState,
      upsertSession(makeSession('a1', 'ws-1', { messages: [placeholder, finalMessage] })),
    );

    const messages = getMsgs(state, 'a1');
    expect(messages.map((m) => m.id)).toEqual(['msg_final']);
  });

  it('keeps ACP accumulated assistant messages with distinct appMessageIds on upsert when turnNumber is missing', () => {
    const firstCanonical = makeAcpAccumulatedAssistantMessage(
      'msg_first_acp',
      'app_msg_first_acp',
      '2024-01-01T00:00:00.000Z',
      { source: 'streaming-snapshot' },
    );
    const secondCanonical = makeAcpAccumulatedAssistantMessage(
      'msg_second_acp',
      'app_msg_second_acp',
      '2024-01-01T00:00:02.000Z',
      { stopReason: 'end_turn' },
    );
    const session = makeSession('a1', 'ws-1', { messages: [firstCanonical, secondCanonical] });
    const state = agentSessionReducer(initialState, upsertSession(session));
    expect(getMsgs(state, 'a1').map((m) => m.id)).toEqual(['msg_first_acp', 'msg_second_acp']);
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

  it('keeps canonical assistant messages with equivalent tool-use blocks on upsert when turnNumber is missing', () => {
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
    expect(getMsgs(state, 'a1').map((m) => m.id)).toEqual(['msg_first', 'msg_duplicate']);
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

  it('deduplicates same-turn canonical duplicates while preserving a different-turn repeat', () => {
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

  it('deduplicates multiple non-canonical duplicates when canonical arrives (localA, localB, canonical)', () => {
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
    expect(getMsgs(state, 'a1').map((m) => m.id)).toEqual(['msg_canonical']);
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

  it('deduplicates multiple non-canonical duplicates when canonical is first (canonical, localA, localB)', () => {
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
    expect(getMsgs(state, 'a1').map((m) => m.id)).toEqual(['msg_canonical']);
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

  it('sorts messages by timestamp ascending on upsertSession', () => {
    const session = makeSession('a1', 'ws-1', {
      messages: [
        makeUniqueMessage('m3', 'user', '2024-01-01T00:00:03.000Z'),
        makeUniqueMessage('m1', 'user', '2024-01-01T00:00:01.000Z'),
        makeUniqueMessage('m2', 'user', '2024-01-01T00:00:02.000Z'),
      ],
    });
    const state = agentSessionReducer(
      initialState,
      upsertSession({
        ...session,
        workspaceId: 'ws-1' as AgentSession['workspaceId'],
      }),
    );
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

  it('keeps a user reply before a near-simultaneous assistant reply on replaceMessages', () => {
    let state = agentSessionReducer(initialState, upsertSession(makeSession('a1')));
    const user = makeUniqueMessage('msg_user', 'user', '2024-01-01T00:00:01.010Z');
    const assistant = makeUniqueMessage('msg_assistant', 'assistant', '2024-01-01T00:00:01.000Z');

    state = agentSessionReducer(state, replaceMessages('a1', [user, assistant]));

    expect(getMsgs(state, 'a1').map((m) => m.id)).toEqual(['msg_user', 'msg_assistant']);
  });

  it('orders an out-of-order orphan assistant append after its user reply', () => {
    const assistant = {
      ...makeUniqueMessage('msg_assistant', 'assistant', '2024-01-01T00:00:01.000Z'),
      isStreaming: true,
      streamingComplete: false,
    };
    const user = makeUniqueMessage('msg_user', 'user', '2024-01-01T00:00:01.010Z');
    let state = agentSessionReducer(
      initialState,
      upsertSession(makeSession('a1', 'ws-1', { messages: [assistant] })),
    );

    state = agentSessionReducer(state, addMessage('a1', user));

    expect(getMsgs(state, 'a1').map((m) => m.id)).toEqual(['msg_user', 'msg_assistant']);
  });

  it('does not move a new user reply above the previous assistant turn', () => {
    const previousUser = makeUniqueMessage('msg_user_1', 'user', '2024-01-01T00:00:01.000Z');
    const previousAssistant = makeUniqueMessage(
      'msg_assistant_1',
      'assistant',
      '2024-01-01T00:00:01.500Z',
    );
    const nextUser = makeUniqueMessage('msg_user_2', 'user', '2024-01-01T00:00:01.510Z');

    const state = agentSessionReducer(
      initialState,
      upsertSession(
        makeSession('a1', 'ws-1', { messages: [previousUser, previousAssistant, nextUser] }),
      ),
    );

    expect(getMsgs(state, 'a1').map((m) => m.id)).toEqual([
      'msg_user_1',
      'msg_assistant_1',
      'msg_user_2',
    ]);
  });
});

describe('fixture regression: agent-b93c1222-corrupted.json', () => {
  // Load the corrupted fixture — it has 6 messages total where 2 are content
  // duplicates of earlier messages with plain-UUID IDs and later timestamps.
  // Reducer load paths now logically deduplicate those messages while sorting by timestamp.
  const fixture = require('../../../../test/fixtures/agent-b93c1222-corrupted.json');

  it('deduplicates content-duplicate messages and sorts by timestamp', () => {
    const session: AgentSession = {
      ...fixture,
      id: fixture.id as any,
      workspaceId: fixture.workspaceId as any,
    };
    const state = agentSessionReducer(initialState, upsertSession(session));
    const msgs = getMsgs(state, fixture.id);

    expect(msgs).toHaveLength(4);

    // Messages should be in timestamp order
    for (let i = 1; i < msgs.length; i++) {
      expect(msgs[i].timestamp >= msgs[i - 1].timestamp).toBe(true);
    }

    expect(msgs.map((m) => m.id)).toEqual([
      'msg_aaa00001',
      'msg_aaa00002',
      'msg_aaa00003',
      'msg_aaa00004',
    ]);
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

  it('works through upsertSession (cross-slice load path)', () => {
    const session: AgentSession = {
      ...fixture,
      id: fixture.id as any,
      workspaceId: fixture.workspaceId as any,
    };
    const state = agentSessionReducer(
      initialState,
      upsertSession({
        ...session,
        workspaceId: fixture.workspaceId as AgentSession['workspaceId'],
      }),
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
