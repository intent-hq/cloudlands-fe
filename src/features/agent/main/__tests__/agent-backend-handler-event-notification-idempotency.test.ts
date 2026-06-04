import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const mockPersistence = {
  loadAgent: vi.fn(),
  saveAgent: vi.fn(),
};

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/tmp/test-intent'),
    getName: vi.fn().mockReturnValue('Intent'),
    getVersion: vi.fn().mockReturnValue('1.0.0'),
    isReady: vi.fn(() => true),
    on: vi.fn(),
    once: vi.fn(),
    whenReady: vi.fn(() => Promise.resolve()),
    isPackaged: false,
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
    fromWebContents: vi.fn(() => null),
  },
  ipcMain: { on: vi.fn(), handle: vi.fn(), removeHandler: vi.fn() },
}));

vi.mock('../../../workspace/main/workspace.service', () => ({
  workspaceService: {
    getWorkspace: vi.fn(async () => ({ ok: true, data: { title: 'Workspace Agent' } })),
  },
}));

vi.mock('../agent-persistence', () => ({
  agentPersistence: mockPersistence,
  UnifiedPersistence: { getInstance: () => mockPersistence },
}));

vi.mock('../../../../store/main/redux-store-bridge', () => ({
  getMainState: vi.fn(() => ({ agentSubscriptions: { byWorkspaceId: {} } })),
}));

vi.mock('../../../../store/main/slices/agent-subscriptions/agent-subscriptions-selectors', () => ({
  selectAgentSubscriptions: { select: vi.fn(() => []) },
}));

vi.mock('$shared/main/memory-event-logger', () => ({
  memEvents: { custom: vi.fn() },
}));

vi.mock('../../system/main/system.ipc', () => ({
  getWindowIdForWorkspace: vi.fn(() => undefined),
  getWindowIdsForWorkspace: vi.fn(() => []),
}));

let AgentBackendHandlerClass: typeof import('../agent-backend-handler.service').AgentBackendHandler;

function createHandler(backendSession: any): any {
  const handler = Object.create(AgentBackendHandlerClass.prototype) as any;
  handler.providers = new Map();
  handler.providerLastUsed = new Map();
  handler.streamStartTimes = new Map();
  handler.pendingQueueProcessing = new Set();
  handler.pendingBackendDeliveries = new Set();
  handler.pendingBackendDeliveryTimeouts = new Map();
  handler.messageQueues = new Map();
  handler.isAgentDeleted = vi.fn(() => false);
  handler.requestFrontendHandler = vi.fn(async () => undefined);
  handler.handleBackendStreamMessage = vi.fn(async () => ({ success: true }));
  handler.getBackend = vi.fn(async () => ({
    getSession: vi.fn(() => backendSession),
  }));
  return handler;
}

describe('AgentBackendHandler event notification idempotency', () => {
  beforeAll(async () => {
    ({ AgentBackendHandler: AgentBackendHandlerClass } = await vi.importActual(
      '../agent-backend-handler.service',
    ));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockPersistence.saveAgent.mockResolvedValue({ success: true });
  });

  it('reuses an existing event-notification wake message for the same source event', async () => {
    const agentId = 'agent-coordinator';
    const workspaceId = 'ws-1';
    const sourceEventId = 'agent-idle-agent-child-event-1';
    const eventMetadata = {
      type: 'event_notification',
      eventCount: 1,
      eventTypes: ['agent:idle'],
      events: [
        {
          id: sourceEventId,
          type: 'agent:idle',
          timestamp: '2026-04-28T18:52:00.270Z',
          actor: { type: 'agent', id: 'agent-child' },
          data: { agentId: 'agent-child', taskNoteId: 'task-1' },
        },
      ],
    };
    const backendSession = {
      id: agentId,
      workspaceId,
      name: 'Coordinator',
      messages: [
        {
          id: 'msg_existing_wake',
          role: 'user',
          contentBlocks: [{ type: 'text', text: '[WORKSPACE EVENTS]' }],
          timestamp: '2026-04-28T18:52:00.271Z',
          metadata: { ...eventMetadata, eventNotificationKey: `ids:${sourceEventId}` },
        },
      ],
    };
    const handler = createHandler(backendSession);
    handler.providers.set(agentId, { isHealthy: vi.fn(() => true) });

    const result = await handler.sendBackendInitiatedMessage({
      sessionId: agentId,
      message: '[WORKSPACE EVENTS]',
      workspaceId,
      messageMetadata: eventMetadata,
    });

    const eventNotificationMessages = backendSession.messages.filter(
      (message: any) => message.metadata?.type === 'event_notification',
    );
    const streamRequest = handler.handleBackendStreamMessage.mock.calls[0][1];

    expect(result).toEqual({ success: true });
    expect(eventNotificationMessages).toHaveLength(1);
    expect(streamRequest.queuedMessageId).toBe('msg_existing_wake');
    expect(streamRequest.messages).toHaveLength(1);
    expect(mockPersistence.saveAgent).not.toHaveBeenCalled();
  });

  it('truncates stale tail messages after a reused event-notification wake message', async () => {
    const agentId = 'agent-coordinator';
    const workspaceId = 'ws-1';
    const sourceEventId = 'agent-idle-agent-child-event-2';
    const eventMetadata = {
      type: 'event_notification',
      eventCount: 1,
      eventTypes: ['agent:idle'],
      events: [
        {
          id: sourceEventId,
          type: 'agent:idle',
          timestamp: '2026-04-28T18:52:00.270Z',
          actor: { type: 'agent', id: 'agent-child' },
          data: { agentId: 'agent-child', taskNoteId: 'task-1' },
        },
      ],
    };
    const backendSession = {
      id: agentId,
      workspaceId,
      name: 'Coordinator',
      messages: [
        {
          id: 'msg_history',
          role: 'user',
          contentBlocks: [{ type: 'text', text: 'Earlier message' }],
          timestamp: '2026-04-28T18:51:00.000Z',
        },
        {
          id: 'msg_existing_wake',
          role: 'user',
          contentBlocks: [{ type: 'text', text: '[WORKSPACE EVENTS]' }],
          timestamp: '2026-04-28T18:52:00.271Z',
          metadata: { ...eventMetadata, eventNotificationKey: `ids:${sourceEventId}` },
        },
        {
          id: 'msg_partial_assistant',
          role: 'assistant',
          contentBlocks: [{ type: 'text', text: 'Partial response from failed stream' }],
          timestamp: '2026-04-28T18:52:01.000Z',
        },
      ],
    };
    const handler = createHandler(backendSession);
    handler.providers.set(agentId, { isHealthy: vi.fn(() => true) });

    const result = await handler.sendBackendInitiatedMessage({
      sessionId: agentId,
      message: '[WORKSPACE EVENTS]',
      workspaceId,
      messageMetadata: eventMetadata,
    });

    const streamRequest = handler.handleBackendStreamMessage.mock.calls[0][1];
    const lastStreamMessage = streamRequest.messages[streamRequest.messages.length - 1];

    expect(result).toEqual({ success: true });
    expect(backendSession.messages.map((message: any) => message.id)).toEqual([
      'msg_history',
      'msg_existing_wake',
    ]);
    expect(streamRequest.skipUserMessage).toBe(true);
    expect(streamRequest.messages.map((message: any) => message.id)).toEqual([
      'msg_history',
      'msg_existing_wake',
    ]);
    expect(lastStreamMessage).toMatchObject({ id: 'msg_existing_wake', role: 'user' });
    expect(mockPersistence.saveAgent).toHaveBeenCalledTimes(1);
    expect(mockPersistence.saveAgent).toHaveBeenCalledWith(backendSession);
  });

  it('skips a duplicate event-notification wake that already has a completed assistant response', async () => {
    const agentId = 'agent-coordinator';
    const workspaceId = 'ws-1';
    const sourceEventId = 'agent-idle-agent-verifier-event-1';
    const eventMetadata = {
      type: 'event_notification',
      eventCount: 1,
      eventTypes: ['agent:idle'],
      events: [
        {
          id: sourceEventId,
          type: 'agent:idle',
          timestamp: '2026-04-28T18:52:00.270Z',
          actor: { type: 'agent', id: 'agent-verifier' },
          data: { agentId: 'agent-verifier', taskNoteId: 'task-verify' },
        },
      ],
    };
    const backendSession = {
      id: agentId,
      workspaceId,
      name: 'Queue Bug Planner',
      messages: [
        {
          id: 'msg_existing_wake',
          role: 'user',
          contentBlocks: [{ type: 'text', text: '[WORKSPACE EVENTS]' }],
          timestamp: '2026-04-28T18:52:00.271Z',
          metadata: { ...eventMetadata, eventNotificationKey: `ids:${sourceEventId}` },
        },
        {
          id: 'msg_completed_response',
          appMessageId: 'app_msg_completed_response',
          role: 'assistant',
          contentBlocks: [{ type: 'text', text: 'Verifier completion already handled.' }],
          timestamp: '2026-04-28T18:52:01.000Z',
        },
      ],
    };
    const handler = createHandler(backendSession);
    handler.providers.set(agentId, { isHealthy: vi.fn(() => true) });

    const result = await handler.sendBackendInitiatedMessage({
      sessionId: agentId,
      message: '[WORKSPACE EVENTS]',
      workspaceId,
      messageMetadata: eventMetadata,
    });

    expect(result).toEqual({ success: true });
    expect(handler.handleBackendStreamMessage).not.toHaveBeenCalled();
    expect(backendSession.messages.map((message: any) => message.id)).toEqual([
      'msg_existing_wake',
      'msg_completed_response',
    ]);
    expect(mockPersistence.saveAgent).not.toHaveBeenCalled();
  });

  it('retries an existing wake when only an unrelated later user turn completed', async () => {
    const agentId = 'agent-coordinator';
    const workspaceId = 'ws-1';
    const sourceEventId = 'agent-idle-agent-verifier-event-retry';
    const eventMetadata = {
      type: 'event_notification',
      eventCount: 1,
      eventTypes: ['agent:idle'],
      events: [
        {
          id: sourceEventId,
          type: 'agent:idle',
          timestamp: '2026-04-28T18:52:00.270Z',
          actor: { type: 'agent', id: 'agent-verifier' },
          data: { agentId: 'agent-verifier', taskNoteId: 'task-verify' },
        },
      ],
    };
    const backendSession = {
      id: agentId,
      workspaceId,
      name: 'Queue Bug Planner',
      messages: [
        {
          id: 'msg_existing_wake',
          role: 'user',
          contentBlocks: [{ type: 'text', text: '[WORKSPACE EVENTS]' }],
          timestamp: '2026-04-28T18:52:00.271Z',
          metadata: { ...eventMetadata, eventNotificationKey: `ids:${sourceEventId}` },
        },
        {
          id: 'msg_interrupted_response',
          role: 'assistant',
          contentBlocks: [{ type: 'text', text: 'Partial response before interruption.' }],
          timestamp: '2026-04-28T18:52:01.000Z',
          streamingComplete: false,
          metadata: { interrupted: true },
        },
        {
          id: 'msg_later_user_turn',
          role: 'user',
          contentBlocks: [{ type: 'text', text: 'Unrelated follow-up' }],
          timestamp: '2026-04-28T18:53:00.000Z',
        },
        {
          id: 'msg_later_completed_response',
          appMessageId: 'app_msg_later_completed_response',
          role: 'assistant',
          contentBlocks: [{ type: 'text', text: 'Handled unrelated follow-up.' }],
          timestamp: '2026-04-28T18:53:01.000Z',
          streamingComplete: true,
        },
      ],
    };
    const handler = createHandler(backendSession);
    handler.providers.set(agentId, { isHealthy: vi.fn(() => true) });

    const result = await handler.sendBackendInitiatedMessage({
      sessionId: agentId,
      message: '[WORKSPACE EVENTS]',
      workspaceId,
      messageMetadata: eventMetadata,
    });

    const streamRequest = handler.handleBackendStreamMessage.mock.calls[0][1];

    expect(result).toEqual({ success: true });
    expect(handler.handleBackendStreamMessage).toHaveBeenCalledTimes(1);
    expect(streamRequest.queuedMessageId).toBe('msg_existing_wake');
    expect(streamRequest.messages.map((message: any) => message.id)).toEqual([
      'msg_existing_wake',
    ]);
    expect(backendSession.messages.map((message: any) => message.id)).toEqual([
      'msg_existing_wake',
    ]);
    expect(mockPersistence.saveAgent).toHaveBeenCalledWith(backendSession);
  });

  it('still delivers a later lifecycle event with a different source event id', async () => {
    const agentId = 'agent-coordinator';
    const workspaceId = 'ws-1';
    const firstEventId = 'agent-idle-agent-verifier-event-1';
    const nextEventId = 'agent-idle-agent-verifier-event-2';
    const firstEventMetadata = {
      type: 'event_notification',
      eventCount: 1,
      eventTypes: ['agent:idle'],
      events: [
        {
          id: firstEventId,
          type: 'agent:idle',
          timestamp: '2026-04-28T18:52:00.270Z',
          actor: { type: 'agent', id: 'agent-verifier' },
          data: { agentId: 'agent-verifier', taskNoteId: 'task-verify' },
        },
      ],
    };
    const nextEventMetadata = {
      ...firstEventMetadata,
      events: [
        {
          ...firstEventMetadata.events[0],
          id: nextEventId,
          timestamp: '2026-04-28T18:55:00.270Z',
        },
      ],
    };
    const backendSession = {
      id: agentId,
      workspaceId,
      name: 'Queue Bug Planner',
      messages: [
        {
          id: 'msg_existing_wake',
          role: 'user',
          contentBlocks: [{ type: 'text', text: '[WORKSPACE EVENTS]' }],
          timestamp: '2026-04-28T18:52:00.271Z',
          metadata: { ...firstEventMetadata, eventNotificationKey: `ids:${firstEventId}` },
        },
        {
          id: 'msg_completed_response',
          appMessageId: 'app_msg_completed_response',
          role: 'assistant',
          contentBlocks: [{ type: 'text', text: 'First verifier completion handled.' }],
          timestamp: '2026-04-28T18:52:01.000Z',
        },
      ],
    };
    const handler = createHandler(backendSession);
    handler.providers.set(agentId, { isHealthy: vi.fn(() => true) });

    const result = await handler.sendBackendInitiatedMessage({
      sessionId: agentId,
      message: '[WORKSPACE EVENTS]',
      workspaceId,
      messageMetadata: nextEventMetadata,
    });

    const eventNotificationMessages = backendSession.messages.filter(
      (message: any) => message.metadata?.type === 'event_notification',
    );
    const streamRequest = handler.handleBackendStreamMessage.mock.calls[0][1];

    expect(result).toEqual({ success: true });
    expect(eventNotificationMessages).toHaveLength(2);
    expect(streamRequest.queuedMessageId).not.toBe('msg_existing_wake');
    expect(streamRequest.messages.at(-1).metadata.eventNotificationKey).toBe(`ids:${nextEventId}`);
  });
});
