/**
 * Integration Tests for handleAgentMessageSent
 *
 * Tests the message delivery handler in src/features/events/main/event-triggered-agents.ts
 * Verifies proper handling of:
 * - Target agent validation
 * - Interrupt priority handling (stop + send)
 * - Queue fallback paths
 * - clearInterruptedFlag call patterns
 * - Delivery failure events
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';

// Mock the AgentBackendHandler module
const mockHandler = {
  getAgent: vi.fn(),
  isAgentDeleted: vi.fn(),
  getActiveStreams: vi.fn(),
  stopAgent: vi.fn(),
  sendBackendInitiatedMessage: vi.fn(),
  handleQueueMessage: vi.fn(),
  clearInterruptedFlag: vi.fn(),
};

vi.mock('$features/agent/main/agent-backend-handler.service', () => ({
  AgentBackendHandler: {
    getInstance: () => mockHandler,
  },
}));

// Mock electron-store (required by agent-backend-handler)
vi.mock('electron-store', () => ({
  default: class MockStore {
    private data: Record<string, unknown> = {};
    get(key: string) {
      return this.data[key];
    }
    set(key: string, value: unknown) {
      this.data[key] = value;
    }
  },
}));

// Mock workspace-event-bus for emitMessageDeliveryFailure
const mockEmitEvent = vi.fn();
vi.mock('$features/events/main/workspace-event-bus', () => ({
  getWorkspaceEventBus: () => ({
    emitEvent: mockEmitEvent,
  }),
}));

// Mock createWorkspaceEvent from ../types
vi.mock('$features/events/types', () => ({
  createWorkspaceEvent: vi.fn((type, workspaceId, actor, data) => ({
    id: 'mock-event-id',
    type,
    workspaceId,
    actor,
    data,
    timestamp: new Date().toISOString(),
    metadata: {},
  })),
}));

// Mock logger
vi.mock('$shared/logger', () => ({
  Logger: class {
    debug = vi.fn();
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
}));

// Import the function under test AFTER mocks are set up
import { handleAgentMessageSent } from '$features/events/main/event-triggered-agents';
import type { AgentMessageSentEvent } from '$features/events/types';

/** Create a test event with default values */
function createTestEvent(overrides: Partial<AgentMessageSentEvent['data']> = {}): AgentMessageSentEvent {
  return {
    id: 'test-event-id',
    type: 'agent:message:sent',
    workspaceId: 'test-workspace',
    timestamp: new Date().toISOString(),
    actor: {
      type: 'agent',
      id: 'from-agent-id',
      name: 'Sender Agent',
    },
    data: {
      fromAgentId: 'from-agent-id',
      fromAgentName: 'Sender Agent',
      toAgentId: 'to-agent-id',
      toAgentName: 'Target Agent',
      message: 'Hello from another agent',
      priority: 'normal',
      ...overrides,
    },
    metadata: {},
  };
}

describe('handleAgentMessageSent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: target agent exists and is not deleted
    mockHandler.getAgent.mockResolvedValue({ id: 'to-agent-id', name: 'Target Agent' });
    mockHandler.isAgentDeleted.mockReturnValue(false);
    mockHandler.getActiveStreams.mockReturnValue([]);
    mockHandler.sendBackendInitiatedMessage.mockResolvedValue({ success: true });
    mockHandler.handleQueueMessage.mockResolvedValue({ success: true, queuedMessage: { id: 'msg-1' } });
    mockHandler.stopAgent.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('Target Agent Validation', () => {
    it('should return early if target agent is not found', async () => {
      mockHandler.getAgent.mockResolvedValue(null);

      await handleAgentMessageSent(createTestEvent());

      expect(mockHandler.getAgent).toHaveBeenCalledWith('to-agent-id');
      expect(mockHandler.isAgentDeleted).not.toHaveBeenCalled();
      expect(mockHandler.sendBackendInitiatedMessage).not.toHaveBeenCalled();
      expect(mockHandler.handleQueueMessage).not.toHaveBeenCalled();
    });

    it('should return early if target agent was deleted', async () => {
      mockHandler.isAgentDeleted.mockReturnValue(true);

      await handleAgentMessageSent(createTestEvent());

      expect(mockHandler.isAgentDeleted).toHaveBeenCalledWith('to-agent-id');
      expect(mockHandler.sendBackendInitiatedMessage).not.toHaveBeenCalled();
      expect(mockHandler.handleQueueMessage).not.toHaveBeenCalled();
    });
  });

  describe('Interrupt Priority - Agent Streaming', () => {
    beforeEach(() => {
      // Agent is streaming
      mockHandler.getActiveStreams.mockReturnValue([{ agentId: 'to-agent-id' }]);
    });

    it('should stop agent and send message directly on successful interrupt', async () => {
      const event = createTestEvent({ priority: 'interrupt' });
      mockHandler.stopAgent.mockResolvedValue(undefined);
      mockHandler.sendBackendInitiatedMessage.mockResolvedValue({ success: true });

      await handleAgentMessageSent(event);

      // Verify stopAgent was called with correct args
      expect(mockHandler.stopAgent).toHaveBeenCalledWith('to-agent-id', 'agent_interrupt_message');

      // Verify call sequence: stop BEFORE send using invocationCallOrder
      const stopOrder = mockHandler.stopAgent.mock.invocationCallOrder[0];
      const sendOrder = mockHandler.sendBackendInitiatedMessage.mock.invocationCallOrder[0];
      expect(stopOrder).toBeLessThan(sendOrder);

      // Verify sendBackendInitiatedMessage received correct message content
      expect(mockHandler.sendBackendInitiatedMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'to-agent-id',
          workspaceId: 'test-workspace',
          messageMetadata: expect.objectContaining({
            type: 'agent_message',
            fromAgentId: 'from-agent-id',
            fromAgentName: 'Sender Agent',
            priority: 'interrupt',
          }),
        })
      );
      // Verify message contains both (INTERRUPT) marker and original message
      const sendCall = mockHandler.sendBackendInitiatedMessage.mock.calls[0][0];
      expect(sendCall.message).toContain('(INTERRUPT)');
      expect(sendCall.message).toContain('Hello from another agent');

      // Verify NO queue fallback on happy path
      expect(mockHandler.handleQueueMessage).not.toHaveBeenCalled();

      // clearInterruptedFlag should NOT be called on happy path
      expect(mockHandler.clearInterruptedFlag).not.toHaveBeenCalled();
    });

    it('should fallback to queue if send fails after stop, and clear interrupted flag', async () => {
      const event = createTestEvent({ priority: 'interrupt' });
      mockHandler.stopAgent.mockResolvedValue(undefined);
      mockHandler.sendBackendInitiatedMessage.mockResolvedValue({
        success: false,
        error: 'Send failed',
        errorCode: 'UNKNOWN_ERROR',
      });
      mockHandler.handleQueueMessage.mockResolvedValue({ success: true, queuedMessage: { id: 'msg-1' } });

      await handleAgentMessageSent(event);

      // Verify stop was called first, then send, then queue fallback
      expect(mockHandler.stopAgent).toHaveBeenCalledWith('to-agent-id', 'agent_interrupt_message');
      expect(mockHandler.sendBackendInitiatedMessage).toHaveBeenCalled();
      expect(mockHandler.handleQueueMessage).toHaveBeenCalled();
      // clearInterruptedFlag IS called on fallback queue path
      expect(mockHandler.clearInterruptedFlag).toHaveBeenCalledWith('to-agent-id');
      // No delivery failure event since queue succeeded
      expect(mockEmitEvent).not.toHaveBeenCalled();
    });

    it('should emit failure event if both send and queue fail after stop, and clear interrupted flag', async () => {
      const event = createTestEvent({ priority: 'interrupt' });
      mockHandler.stopAgent.mockResolvedValue(undefined);
      mockHandler.sendBackendInitiatedMessage.mockResolvedValue({
        success: false,
        error: 'Send failed',
      });
      mockHandler.handleQueueMessage.mockResolvedValue({
        success: false,
        error: 'Queue also failed',
      });

      await handleAgentMessageSent(event);

      // clearInterruptedFlag IS called when both fail
      expect(mockHandler.clearInterruptedFlag).toHaveBeenCalledWith('to-agent-id');
      // Delivery failure event should be emitted
      expect(mockEmitEvent).toHaveBeenCalled();
    });

    it('should fallback to queue if stopAgent throws, and clear interrupted flag', async () => {
      const event = createTestEvent({ priority: 'interrupt' });
      mockHandler.stopAgent.mockRejectedValue(new Error('Stop failed'));
      mockHandler.handleQueueMessage.mockResolvedValue({ success: true, queuedMessage: { id: 'msg-1' } });

      await handleAgentMessageSent(event);

      expect(mockHandler.stopAgent).toHaveBeenCalled();
      expect(mockHandler.sendBackendInitiatedMessage).not.toHaveBeenCalled();
      expect(mockHandler.handleQueueMessage).toHaveBeenCalled();
      // clearInterruptedFlag IS called on stop failure fallback
      expect(mockHandler.clearInterruptedFlag).toHaveBeenCalledWith('to-agent-id');
    });

    it('should emit failure event if stopAgent throws and queue fails, and clear interrupted flag', async () => {
      const event = createTestEvent({ priority: 'interrupt' });
      mockHandler.stopAgent.mockRejectedValue(new Error('Stop failed'));
      mockHandler.handleQueueMessage.mockResolvedValue({
        success: false,
        error: 'Queue failed too',
      });

      await handleAgentMessageSent(event);

      expect(mockHandler.clearInterruptedFlag).toHaveBeenCalledWith('to-agent-id');
      expect(mockEmitEvent).toHaveBeenCalled();
    });
  });

  describe('Non-Interrupt Priority - Agent Streaming', () => {
    beforeEach(() => {
      mockHandler.getActiveStreams.mockReturnValue([{ agentId: 'to-agent-id' }]);
    });

    it('should queue message when agent is streaming (non-interrupt)', async () => {
      const event = createTestEvent({ priority: 'normal' });
      mockHandler.handleQueueMessage.mockResolvedValue({ success: true, queuedMessage: { id: 'msg-1' } });

      await handleAgentMessageSent(event);

      expect(mockHandler.stopAgent).not.toHaveBeenCalled();
      expect(mockHandler.sendBackendInitiatedMessage).not.toHaveBeenCalled();
      expect(mockHandler.handleQueueMessage).toHaveBeenCalledWith(null, {
        agentId: 'to-agent-id',
        content: expect.stringContaining('Hello from another agent'),
      });
      expect(mockHandler.clearInterruptedFlag).not.toHaveBeenCalled();
    });

    it('should emit failure event if queue fails when streaming', async () => {
      const event = createTestEvent({ priority: 'high' });
      mockHandler.handleQueueMessage.mockResolvedValue({
        success: false,
        error: 'Queue full',
      });

      await handleAgentMessageSent(event);

      expect(mockEmitEvent).toHaveBeenCalled();
    });
  });

  describe('Agent Idle - Direct Send', () => {
    beforeEach(() => {
      mockHandler.getActiveStreams.mockReturnValue([]);
    });

    it('should send message directly when agent is idle', async () => {
      const event = createTestEvent({ priority: 'normal' });
      mockHandler.sendBackendInitiatedMessage.mockResolvedValue({ success: true });

      await handleAgentMessageSent(event);

      expect(mockHandler.sendBackendInitiatedMessage).toHaveBeenCalledWith({
        sessionId: 'to-agent-id',
        message: expect.stringContaining('Hello from another agent'),
        workspaceId: 'test-workspace',
        messageMetadata: {
          type: 'agent_message',
          fromAgentId: 'from-agent-id',
          fromAgentName: 'Sender Agent',
          priority: 'normal',
        },
      });
      expect(mockHandler.handleQueueMessage).not.toHaveBeenCalled();
      expect(mockHandler.clearInterruptedFlag).not.toHaveBeenCalled();
    });

    it('should fallback to queue if send fails with QUEUE_PENDING', async () => {
      const event = createTestEvent({ priority: 'normal' });
      mockHandler.sendBackendInitiatedMessage.mockResolvedValue({
        success: false,
        errorCode: 'QUEUE_PENDING',
      });
      mockHandler.handleQueueMessage.mockResolvedValue({ success: true, queuedMessage: { id: 'msg-1' } });

      await handleAgentMessageSent(event);

      expect(mockHandler.handleQueueMessage).toHaveBeenCalled();
      expect(mockEmitEvent).not.toHaveBeenCalled();
    });

    it('should fallback to queue if send fails with ALREADY_STREAMING', async () => {
      const event = createTestEvent({ priority: 'normal' });
      mockHandler.sendBackendInitiatedMessage.mockResolvedValue({
        success: false,
        errorCode: 'ALREADY_STREAMING',
      });
      mockHandler.handleQueueMessage.mockResolvedValue({ success: true, queuedMessage: { id: 'msg-1' } });

      await handleAgentMessageSent(event);

      expect(mockHandler.handleQueueMessage).toHaveBeenCalled();
    });

    it('should emit failure if queue fallback fails after QUEUE_PENDING', async () => {
      const event = createTestEvent({ priority: 'normal' });
      mockHandler.sendBackendInitiatedMessage.mockResolvedValue({
        success: false,
        errorCode: 'QUEUE_PENDING',
      });
      mockHandler.handleQueueMessage.mockResolvedValue({
        success: false,
        error: 'Queue failed',
      });

      await handleAgentMessageSent(event);

      expect(mockEmitEvent).toHaveBeenCalled();
    });

    it('should emit failure event on other send errors (no queue fallback)', async () => {
      const event = createTestEvent({ priority: 'normal' });
      mockHandler.sendBackendInitiatedMessage.mockResolvedValue({
        success: false,
        error: 'Unknown error',
        errorCode: 'UNKNOWN',
      });

      await handleAgentMessageSent(event);

      expect(mockHandler.handleQueueMessage).not.toHaveBeenCalled();
      expect(mockEmitEvent).toHaveBeenCalled();
    });
  });

  describe('Message Formatting', () => {
    it('should format normal priority message without label', async () => {
      const event = createTestEvent({ priority: 'normal' });
      mockHandler.sendBackendInitiatedMessage.mockResolvedValue({ success: true });

      await handleAgentMessageSent(event);

      const call = mockHandler.sendBackendInitiatedMessage.mock.calls[0][0];
      expect(call.message).toContain('**Message from agent "Sender Agent":**');
      expect(call.message).not.toContain('INTERRUPT');
      expect(call.message).not.toContain('HIGH PRIORITY');
    });

    it('should format interrupt priority message with label', async () => {
      const event = createTestEvent({ priority: 'interrupt' });
      // Make agent not streaming so it goes direct send path
      mockHandler.getActiveStreams.mockReturnValue([]);
      mockHandler.sendBackendInitiatedMessage.mockResolvedValue({ success: true });

      await handleAgentMessageSent(event);

      const call = mockHandler.sendBackendInitiatedMessage.mock.calls[0][0];
      expect(call.message).toContain('(INTERRUPT)');
    });

    it('should format high priority message with label', async () => {
      const event = createTestEvent({ priority: 'high' });
      mockHandler.sendBackendInitiatedMessage.mockResolvedValue({ success: true });

      await handleAgentMessageSent(event);

      const call = mockHandler.sendBackendInitiatedMessage.mock.calls[0][0];
      expect(call.message).toContain('(HIGH PRIORITY)');
    });
  });

  describe('Top-Level Error Handling', () => {
    it('should catch unexpected errors and emit failure event', async () => {
      mockHandler.getAgent.mockRejectedValue(new Error('Unexpected DB error'));

      await handleAgentMessageSent(createTestEvent());

      expect(mockEmitEvent).toHaveBeenCalled();
    });
  });
});

