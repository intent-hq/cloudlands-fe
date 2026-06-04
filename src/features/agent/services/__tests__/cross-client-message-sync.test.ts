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
import {
  createAgentId,
} from '../../../../shared/types/branded-ids';
import { AgentStatus } from '../../../../shared/types';
import type { AgentSession, AgentMessage } from '../../../../shared/types';
import {
  agentSessionReducer,
  initialState as agentSessionInitialState,
  upsertSession,
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
      ? agentSessionReducer(agentSessionInitialState, upsertSession(session))
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
      content: 'Hello from iOS!',
    });

    expect(state.byAgentId[agentId].messages).toMatchObject([
      {
        id: 'msg-from-ios-001',
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

/**
 * Adapter User Message → Workspace Event Emission Tests
 *
 * Tests the fire-and-forget workspace event emission in agent-backend-adapter.ts
 * that emits 'agent:user-message:sent' after a successful handleSendMessage call.
 *
 * Replicates the adapter's emission logic in a testable helper.
 */
describe('Adapter: agent:user-message:sent workspace event emission', () => {
  let mockMainDispatch: ReturnType<typeof vi.fn>;
  let mockEmitWorkspaceEvent: ReturnType<typeof vi.fn>;
  let mockCreateWorkspaceEvent: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMainDispatch = vi.fn();
    mockEmitWorkspaceEvent = vi.fn((event: any) => ({ type: 'EMIT_WORKSPACE_EVENT', payload: event }));
    mockCreateWorkspaceEvent = vi.fn((type: string, workspaceId: string, actor: any, data: any) => ({
      id: 'evt_test',
      type,
      workspaceId,
      actor,
      data,
      timestamp: new Date().toISOString(),
    }));
  });

  /**
   * Replicates the workspace event emission logic from agent-backend-adapter.ts
   * sendMessage method (lines ~109-129). Instead of dynamic imports, takes
   * dependencies as parameters.
   *
   * @param sendMessageSuccess - whether handleSendMessage succeeded
   * @param workspaceId - the workspace ID from streamWorkspaceIds (empty string = not available)
   * @param request - the sendMessage request
   * @param messageId - the generated message ID
   */
  function simulateAdapterEventEmission(
    sendMessageSuccess: boolean,
    workspaceId: string,
    request: { agentId: string; content: string },
    messageId: string,
    deps: {
      mainDispatch: typeof mockMainDispatch;
      emitWorkspaceEvent: typeof mockEmitWorkspaceEvent;
      createWorkspaceEvent: typeof mockCreateWorkspaceEvent;
    },
  ): { emitted: boolean } {
    if (!sendMessageSuccess) {
      // In real code, an error is thrown before reaching the event emission
      return { emitted: false };
    }

    if (workspaceId) {
      deps.mainDispatch(deps.emitWorkspaceEvent(deps.createWorkspaceEvent(
        'agent:user-message:sent' as any,
        workspaceId,
        { type: 'user' as const, id: 'user' },
        {
          agentId: request.agentId,
          messageId,
          content: request.content,
        },
      )));
      return { emitted: true };
    }

    return { emitted: false };
  }

  it('should emit agent:user-message:sent event after successful sendMessage', () => {
    const result = simulateAdapterEventEmission(
      true,
      'ws-test-1',
      { agentId: 'agent-1', content: 'Hello from WebSocket!' },
      'msg-001',
      { mainDispatch: mockMainDispatch, emitWorkspaceEvent: mockEmitWorkspaceEvent, createWorkspaceEvent: mockCreateWorkspaceEvent },
    );

    expect(result.emitted).toBe(true);
    expect(mockCreateWorkspaceEvent).toHaveBeenCalledWith(
      'agent:user-message:sent',
      'ws-test-1',
      { type: 'user', id: 'user' },
      { agentId: 'agent-1', messageId: 'msg-001', content: 'Hello from WebSocket!' },
    );
    expect(mockMainDispatch).toHaveBeenCalledTimes(1);
  });

  it('should include agentId, messageId, and content in event data', () => {
    simulateAdapterEventEmission(
      true,
      'ws-data-check',
      { agentId: 'agent-data', content: 'Check my data fields' },
      'msg-data-001',
      { mainDispatch: mockMainDispatch, emitWorkspaceEvent: mockEmitWorkspaceEvent, createWorkspaceEvent: mockCreateWorkspaceEvent },
    );

    const eventData = mockCreateWorkspaceEvent.mock.calls[0][3];
    expect(eventData).toEqual({
      agentId: 'agent-data',
      messageId: 'msg-data-001',
      content: 'Check my data fields',
    });
  });

  it('should use user actor type with id "user"', () => {
    simulateAdapterEventEmission(
      true,
      'ws-actor-check',
      { agentId: 'agent-actor', content: 'Actor test' },
      'msg-actor-001',
      { mainDispatch: mockMainDispatch, emitWorkspaceEvent: mockEmitWorkspaceEvent, createWorkspaceEvent: mockCreateWorkspaceEvent },
    );

    const actor = mockCreateWorkspaceEvent.mock.calls[0][2];
    expect(actor).toEqual({ type: 'user', id: 'user' });
  });

  it('should NOT emit event when workspaceId is empty string', () => {
    const result = simulateAdapterEventEmission(
      true,
      '', // empty string = not available (falsy)
      { agentId: 'agent-no-ws', content: 'No workspace' },
      'msg-no-ws',
      { mainDispatch: mockMainDispatch, emitWorkspaceEvent: mockEmitWorkspaceEvent, createWorkspaceEvent: mockCreateWorkspaceEvent },
    );

    expect(result.emitted).toBe(false);
    expect(mockCreateWorkspaceEvent).not.toHaveBeenCalled();
    expect(mockMainDispatch).not.toHaveBeenCalled();
  });

  it('should NOT emit event when sendMessage fails', () => {
    const result = simulateAdapterEventEmission(
      false, // sendMessage failed
      'ws-fail-test',
      { agentId: 'agent-fail', content: 'This should fail' },
      'msg-fail',
      { mainDispatch: mockMainDispatch, emitWorkspaceEvent: mockEmitWorkspaceEvent, createWorkspaceEvent: mockCreateWorkspaceEvent },
    );

    expect(result.emitted).toBe(false);
    expect(mockCreateWorkspaceEvent).not.toHaveBeenCalled();
    expect(mockMainDispatch).not.toHaveBeenCalled();
  });

  it('should use the correct workspace event type string', () => {
    simulateAdapterEventEmission(
      true,
      'ws-type-check',
      { agentId: 'agent-type', content: 'Type check' },
      'msg-type',
      { mainDispatch: mockMainDispatch, emitWorkspaceEvent: mockEmitWorkspaceEvent, createWorkspaceEvent: mockCreateWorkspaceEvent },
    );

    expect(mockCreateWorkspaceEvent.mock.calls[0][0]).toBe('agent:user-message:sent');
  });

  it('should pass the correct workspaceId to createWorkspaceEvent', () => {
    simulateAdapterEventEmission(
      true,
      'specific-workspace-id-123',
      { agentId: 'agent-ws', content: 'WS check' },
      'msg-ws',
      { mainDispatch: mockMainDispatch, emitWorkspaceEvent: mockEmitWorkspaceEvent, createWorkspaceEvent: mockCreateWorkspaceEvent },
    );

    expect(mockCreateWorkspaceEvent.mock.calls[0][1]).toBe('specific-workspace-id-123');
  });
});

/**
 * Electron → WebSocket: handleSendMessage emits agent:user-message:sent
 *
 * Tests the fire-and-forget workspace event emission added to
 * agent-backend-handler.service.ts handleSendMessage, which emits
 * 'agent:user-message:sent' after a user message is created from the
 * Electron UI so that WebSocket API subscribers are notified.
 */
describe('Electron → WebSocket: handleSendMessage emits agent:user-message:sent', () => {
  let mockMainDispatch: ReturnType<typeof vi.fn>;
  let mockEmitWorkspaceEvent: ReturnType<typeof vi.fn>;
  let mockCreateWorkspaceEvent: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMainDispatch = vi.fn();
    mockEmitWorkspaceEvent = vi.fn((event: any) => ({ type: 'EMIT_WORKSPACE_EVENT', payload: event }));
    mockCreateWorkspaceEvent = vi.fn((type: string, workspaceId: string, actor: any, data: any) => ({
      id: 'evt_test',
      type,
      workspaceId,
      actor,
      data,
      timestamp: new Date().toISOString(),
    }));
  });

  /**
   * Replicates the emission logic from agent-backend-handler.service.ts
   * handleSendMessage. Instead of dynamic imports, takes dependencies as
   * parameters for testability.
   */
  function simulateHandlerEventEmission(
    userMessage: { id: string; role: string; contentBlocks: any[] } | null,
    workspaceId: string | undefined,
    request: { agentId: string; content: string },
    deps: {
      mainDispatch: typeof mockMainDispatch;
      emitWorkspaceEvent: typeof mockEmitWorkspaceEvent;
      createWorkspaceEvent: typeof mockCreateWorkspaceEvent;
    },
  ): { emitted: boolean } {
    if (userMessage && workspaceId) {
      deps.mainDispatch(deps.emitWorkspaceEvent(deps.createWorkspaceEvent(
        'agent:user-message:sent' as any,
        workspaceId,
        { type: 'user' as const, id: 'user' },
        {
          agentId: request.agentId,
          messageId: userMessage.id,
          content: request.content,
        },
      )));
      return { emitted: true };
    }
    return { emitted: false };
  }

  it('should emit event when userMessage is created and workspaceId is present', () => {
    const userMessage = { id: 'msg-electron-001', role: 'user', contentBlocks: [{ type: 'text', text: 'Hello from Electron!' }] };
    const result = simulateHandlerEventEmission(
      userMessage,
      'ws-electron-test',
      { agentId: 'agent-electron-1', content: 'Hello from Electron!' },
      { mainDispatch: mockMainDispatch, emitWorkspaceEvent: mockEmitWorkspaceEvent, createWorkspaceEvent: mockCreateWorkspaceEvent },
    );

    expect(result.emitted).toBe(true);
    expect(mockCreateWorkspaceEvent).toHaveBeenCalledWith(
      'agent:user-message:sent',
      'ws-electron-test',
      { type: 'user', id: 'user' },
      { agentId: 'agent-electron-1', messageId: 'msg-electron-001', content: 'Hello from Electron!' },
    );
    expect(mockMainDispatch).toHaveBeenCalledTimes(1);
  });

  it('should NOT emit event when skipUserMessage is true (userMessage is null)', () => {
    const result = simulateHandlerEventEmission(
      null, // skipUserMessage === true → userMessage is null
      'ws-skip-test',
      { agentId: 'agent-skip', content: 'This was skipped' },
      { mainDispatch: mockMainDispatch, emitWorkspaceEvent: mockEmitWorkspaceEvent, createWorkspaceEvent: mockCreateWorkspaceEvent },
    );

    expect(result.emitted).toBe(false);
    expect(mockCreateWorkspaceEvent).not.toHaveBeenCalled();
    expect(mockMainDispatch).not.toHaveBeenCalled();
  });

  it('should NOT emit event when workspaceId is missing', () => {
    const userMessage = { id: 'msg-no-ws', role: 'user', contentBlocks: [{ type: 'text', text: 'No workspace' }] };
    const result = simulateHandlerEventEmission(
      userMessage,
      undefined, // workspaceId is falsy
      { agentId: 'agent-no-ws', content: 'No workspace' },
      { mainDispatch: mockMainDispatch, emitWorkspaceEvent: mockEmitWorkspaceEvent, createWorkspaceEvent: mockCreateWorkspaceEvent },
    );

    expect(result.emitted).toBe(false);
    expect(mockCreateWorkspaceEvent).not.toHaveBeenCalled();
    expect(mockMainDispatch).not.toHaveBeenCalled();
  });

  it('should include agentId, messageId, and content in event data', () => {
    const userMessage = { id: 'msg-data-check', role: 'user', contentBlocks: [{ type: 'text', text: 'Data check' }] };
    simulateHandlerEventEmission(
      userMessage,
      'ws-data-verify',
      { agentId: 'agent-data-verify', content: 'Data check' },
      { mainDispatch: mockMainDispatch, emitWorkspaceEvent: mockEmitWorkspaceEvent, createWorkspaceEvent: mockCreateWorkspaceEvent },
    );

    const eventData = mockCreateWorkspaceEvent.mock.calls[0][3];
    expect(eventData).toEqual({
      agentId: 'agent-data-verify',
      messageId: 'msg-data-check',
      content: 'Data check',
    });
  });
});
