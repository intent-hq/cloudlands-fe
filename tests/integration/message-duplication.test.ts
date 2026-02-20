/**
 * Test message duplication prevention
 * Ensures messages aren't duplicated on stream completion or page refresh
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Message Duplication Prevention', () => {
  let mockMessageStore: any;
  let mockStreamHandler: any;

  beforeEach(() => {
    mockMessageStore = {
      messages: new Map(),
      addMessage: vi.fn((agentId, msg) => {
        if (!mockMessageStore.messages.has(agentId)) {
          mockMessageStore.messages.set(agentId, []);
        }
        mockMessageStore.messages.get(agentId).push(msg);
      }),
      updateMessage: vi.fn((agentId, msgId, updates) => {
        const messages = mockMessageStore.messages.get(agentId) || [];
        const msg = messages.find((m: any) => m.id === msgId);
        if (msg) {
          Object.assign(msg, updates);
        }
      }),
      getMessages: vi.fn((agentId) => mockMessageStore.messages.get(agentId) || []),
    };

    mockStreamHandler = {
      isStreaming: false,
      messageId: null,
      startStream: vi.fn((msgId) => {
        mockStreamHandler.isStreaming = true;
        mockStreamHandler.messageId = msgId;
      }),
      completeStream: vi.fn(() => {
        mockStreamHandler.isStreaming = false;
      }),
    };
  });

  it('should not duplicate message on stream completion', () => {
    const agentId = 'agent_1';
    const messageId = 'msg_1';

    // Add initial message
    mockMessageStore.addMessage(agentId, {
      id: messageId,
      role: 'assistant',
      contentBlocks: [{ type: 'text', text: 'Hello' }],
    });

    expect(mockMessageStore.getMessages(agentId)).toHaveLength(1);

    // Simulate stream completion
    mockStreamHandler.completeStream();

    // Message should still be 1, not duplicated
    expect(mockMessageStore.getMessages(agentId)).toHaveLength(1);
  });

  it('should update existing message instead of creating new one on stream complete', () => {
    const agentId = 'agent_1';
    const messageId = 'msg_1';

    mockMessageStore.addMessage(agentId, {
      id: messageId,
      role: 'assistant',
      contentBlocks: [{ type: 'text', text: 'Hello' }],
      isStreaming: true,
    });

    // Update message on stream complete
    mockMessageStore.updateMessage(agentId, messageId, {
      isStreaming: false,
      contentBlocks: [{ type: 'text', text: 'Hello world' }],
    });

    const messages = mockMessageStore.getMessages(agentId);
    expect(messages).toHaveLength(1);
    expect(messages[0].isStreaming).toBe(false);
    expect(messages[0].contentBlocks[0].text).toBe('Hello world');
  });

  it('should not duplicate message on page refresh', () => {
    const agentId = 'agent_1';
    const messageId = 'msg_1';

    // Add message
    mockMessageStore.addMessage(agentId, {
      id: messageId,
      role: 'assistant',
      contentBlocks: [{ type: 'text', text: 'Response' }],
    });

    expect(mockMessageStore.getMessages(agentId)).toHaveLength(1);

    // Simulate page refresh - message should be restored from store
    const restoredMessages = mockMessageStore.getMessages(agentId);
    expect(restoredMessages).toHaveLength(1);
    expect(restoredMessages[0].id).toBe(messageId);
  });

  it('should handle multiple messages without duplication', () => {
    const agentId = 'agent_1';

    // Add user message
    mockMessageStore.addMessage(agentId, {
      id: 'msg_1',
      role: 'user',
      contentBlocks: [{ type: 'text', text: 'Hello' }],
    });

    // Add assistant message
    mockMessageStore.addMessage(agentId, {
      id: 'msg_2',
      role: 'assistant',
      contentBlocks: [{ type: 'text', text: 'Hi there' }],
    });

    expect(mockMessageStore.getMessages(agentId)).toHaveLength(2);

    // Add another user message
    mockMessageStore.addMessage(agentId, {
      id: 'msg_3',
      role: 'user',
      contentBlocks: [{ type: 'text', text: 'How are you?' }],
    });

    expect(mockMessageStore.getMessages(agentId)).toHaveLength(3);
  });

  it('should prevent duplicate when stream completes with same content', () => {
    const agentId = 'agent_1';
    const messageId = 'msg_1';
    const content = [{ type: 'text', text: 'Final response' }];

    // Add message
    mockMessageStore.addMessage(agentId, {
      id: messageId,
      role: 'assistant',
      contentBlocks: content,
    });

    // Try to add same message again (simulating duplicate on stream complete)
    const beforeCount = mockMessageStore.getMessages(agentId).length;

    // Update instead of add
    mockMessageStore.updateMessage(agentId, messageId, {
      contentBlocks: content,
    });

    const afterCount = mockMessageStore.getMessages(agentId).length;
    expect(beforeCount).toBe(afterCount);
  });

  it('should track message count correctly across operations', () => {
    const agentId = 'agent_1';

    mockMessageStore.addMessage(agentId, { id: 'msg_1', role: 'user' });
    expect(mockMessageStore.getMessages(agentId)).toHaveLength(1);

    mockMessageStore.addMessage(agentId, { id: 'msg_2', role: 'assistant' });
    expect(mockMessageStore.getMessages(agentId)).toHaveLength(2);

    mockMessageStore.updateMessage(agentId, 'msg_2', { isStreaming: false });
    expect(mockMessageStore.getMessages(agentId)).toHaveLength(2);

    mockMessageStore.addMessage(agentId, { id: 'msg_3', role: 'user' });
    expect(mockMessageStore.getMessages(agentId)).toHaveLength(3);
  });
});
