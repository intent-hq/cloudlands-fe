/**
 * Cross-Client User Message Sync Tests (iOS → Electron)
 *
 * Tests the canonical Redux path for syncing user messages sent from external
 * clients (e.g., iOS via WebSocket) into the Electron renderer's state:
 *
 * 1. Main process emits `agent:user-message:sent` as a workspace event.
 * 2. Workspace-events IPC delivery dispatches `workspaceEvents/eventReceived`.
 * 3. The agent-session reducer updates canonical renderer state once.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { createAgentId } from '../../../../shared/types/branded-ids';
import { AgentStatus } from '../../../../shared/types';
import type { AgentSession, AgentMessage } from '../../../../shared/types';
import {
  agentSessionReducer,
  initialState as agentSessionInitialState,
  bulkUpsertSessions,
} from '../../../../store/renderer/slices/agent-session/agent-session-slice';
import { eventReceived } from '../../../../store/renderer/slices/workspace-events/workspace-events-slice';

describe('Cross-Client User Message Sync (iOS → Electron)', () => {
  let agentId: ReturnType<typeof createAgentId>;
  let agentSession: AgentSession;

  beforeEach(() => {
    agentId = createAgentId(randomUUID());

    agentSession = {
      id: agentId,
      workspaceId: 'ws-test' as any,
      status: AgentStatus.Idle,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      backendSessionId: agentId,
      name: 'Test Agent',
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function reduceCanonicalUserMessageEvent(
    data: Record<string, unknown> | null | undefined,
    session: AgentSession | null = agentSession,
  ) {
    const startState = session
      ? agentSessionReducer(
          agentSessionInitialState,
          bulkUpsertSessions([session], { preserveExplicitRuntimeFlags: false }),
        )
      : agentSessionInitialState;
    const workspaceId = (data?.workspaceId as string | undefined) ?? 'ws-test';
    return agentSessionReducer(
      startState,
      eventReceived(workspaceId, {
        id: `evt-${String(data?.messageId ?? 'missing')}`,
        type: 'agent:user-message:sent',
        workspaceId,
        timestamp: '2024-01-01T00:00:00.000Z',
        actor: { type: 'user', id: 'user' },
        data,
      } as any),
    );
  }

  it('updates canonical agent-session Redux state from a workspace event', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    const state = reduceCanonicalUserMessageEvent({
      agentId: agentId as string,
      messageId: 'msg-from-ios-001',
      appMessageId: 'app-msg-from-ios-001',
      content: 'Hello from iOS!',
    });

    expect(state.byAgentId[agentId].messages).toMatchObject([
      {
        id: 'msg-from-ios-001',
        appMessageId: 'app-msg-from-ios-001',
        role: 'user',
        contentBlocks: [{ type: 'text', text: 'Hello from iOS!' }],
      },
    ]);
    expect(dispatchSpy).not.toHaveBeenCalled();

    dispatchSpy.mockRestore();
  });

  it('preserves image blocks on the canonical workspace event path', () => {
    const imageBlocks = [{ type: 'image' as const, data: 'base64data', mimeType: 'image/png' }];

    const state = reduceCanonicalUserMessageEvent({
      agentId: agentId as string,
      messageId: 'msg-with-image',
      content: 'Check this screenshot',
      imageBlocks,
    });

    expect(state.byAgentId[agentId].messages[0].contentBlocks).toEqual([
      { type: 'text', text: 'Check this screenshot' },
      { type: 'image', data: 'base64data', mimeType: 'image/png' },
    ]);
  });

  it('does not duplicate a message already present from backend persistence', () => {
    const existingMessage: AgentMessage = {
      id: 'msg-from-ios-001',
      role: 'user',
      contentBlocks: [{ type: 'text', text: 'Hello from iOS!' }],
      timestamp: '2024-01-01T00:00:00.000Z',
    };
    const persistedSession = { ...agentSession, messages: [existingMessage] };

    const state = reduceCanonicalUserMessageEvent(
      {
        agentId: agentId as string,
        messageId: 'msg-from-ios-001',
        content: 'Hello from iOS!',
      },
      persistedSession,
    );

    expect(state.byAgentId[agentId].messages).toHaveLength(1);
    expect(state.byAgentId[agentId].messages[0].id).toBe('msg-from-ios-001');
  });

  it('is a no-op when the target session is not loaded', () => {
    const state = reduceCanonicalUserMessageEvent(
      { agentId: 'nonexistent-agent-id', messageId: 'msg-orphan', content: 'Dropped' },
      null,
    );

    expect(state.byAgentId).toEqual({});
  });

  it('is a no-op for malformed workspace-event data', () => {
    const state = reduceCanonicalUserMessageEvent({
      agentId: agentId as string,
      content: 'Missing messageId',
    });

    expect(state.byAgentId[agentId].messages).toHaveLength(0);
  });
});

