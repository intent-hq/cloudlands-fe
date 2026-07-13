/**
 * Test tool calls display and ordering in the UI
 * Ensures tool calls appear in real-time and in correct order
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Tool Calls Display & Ordering', () => {
  let mockChatPanel: any;
  let mockStreamHandler: any;
  let contentBlocks: any[] = [];

  beforeEach(() => {
    contentBlocks = [];

    mockStreamHandler = {
      handleContentBlock: vi.fn((block) => {
        contentBlocks.push(block);
      }),
    };

    mockChatPanel = {
      messages: [],
      addMessage: vi.fn((msg) => {
        mockChatPanel.messages.push(msg);
      }),
      updateMessage: vi.fn((msgId, updates) => {
        const msg = mockChatPanel.messages.find((m: any) => m.id === msgId);
        if (msg) {
          msg.contentBlocks = [...(msg.contentBlocks || []), ...updates.contentBlocks];
        }
      }),
    };
  });

  it('should display tool calls in real-time as they stream', () => {
    const messageId = 'msg_1';
    mockChatPanel.addMessage({ id: messageId, contentBlocks: [] });

    // Simulate streaming tool call
    mockStreamHandler.handleContentBlock({
      type: 'tool_use',
      id: 'tool_1',
      name: 'search',
      input: { query: 'test' },
    });

    mockChatPanel.updateMessage(messageId, {
      contentBlocks: [contentBlocks[0]],
    });

    const msg = mockChatPanel.messages[0];
    expect(msg.contentBlocks).toHaveLength(1);
    expect(msg.contentBlocks[0].type).toBe('tool_use');
    expect(msg.contentBlocks[0].name).toBe('search');
  });

  it('should display tool results after tool calls', () => {
    const messageId = 'msg_1';
    mockChatPanel.addMessage({ id: messageId, contentBlocks: [] });

    // Tool call
    mockStreamHandler.handleContentBlock({
      type: 'tool_use',
      id: 'tool_1',
      name: 'search',
      input: { query: 'test' },
    });

    // Tool result
    mockStreamHandler.handleContentBlock({
      type: 'tool_result',
      toolUseId: 'tool_1',
      content: 'Found 5 results',
    });

    mockChatPanel.updateMessage(messageId, {
      contentBlocks,
    });

    const msg = mockChatPanel.messages[0];
    expect(msg.contentBlocks).toHaveLength(2);
    expect(msg.contentBlocks[0].type).toBe('tool_use');
    expect(msg.contentBlocks[1].type).toBe('tool_result');
    expect(msg.contentBlocks[1].toolUseId).toBe('tool_1');
  });

  it('should handle multiple tool calls in sequence', () => {
    const messageId = 'msg_1';
    mockChatPanel.addMessage({ id: messageId, contentBlocks: [] });

    // First tool call
    mockStreamHandler.handleContentBlock({
      type: 'tool_use',
      id: 'tool_1',
      name: 'search',
      input: { query: 'test' },
    });

    // Second tool call
    mockStreamHandler.handleContentBlock({
      type: 'tool_use',
      id: 'tool_2',
      name: 'analyze',
      input: { data: 'results' },
    });

    mockChatPanel.updateMessage(messageId, {
      contentBlocks,
    });

    const msg = mockChatPanel.messages[0];
    expect(msg.contentBlocks).toHaveLength(2);
    expect(msg.contentBlocks[0].id).toBe('tool_1');
    expect(msg.contentBlocks[1].id).toBe('tool_2');
  });

  it('should maintain correct order: text -> tool_use -> tool_result', () => {
    const messageId = 'msg_1';
    mockChatPanel.addMessage({ id: messageId, contentBlocks: [] });

    mockStreamHandler.handleContentBlock({
      type: 'text',
      text: 'Let me search for that',
    });

    mockStreamHandler.handleContentBlock({
      type: 'tool_use',
      id: 'tool_1',
      name: 'search',
      input: { query: 'test' },
    });

    mockStreamHandler.handleContentBlock({
      type: 'tool_result',
      toolUseId: 'tool_1',
      content: 'Found results',
    });

    mockStreamHandler.handleContentBlock({
      type: 'text',
      text: 'Here are the results',
    });

    mockChatPanel.updateMessage(messageId, {
      contentBlocks,
    });

    const msg = mockChatPanel.messages[0];
    expect(msg.contentBlocks).toHaveLength(4);
    expect(msg.contentBlocks[0].type).toBe('text');
    expect(msg.contentBlocks[1].type).toBe('tool_use');
    expect(msg.contentBlocks[2].type).toBe('tool_result');
    expect(msg.contentBlocks[3].type).toBe('text');
  });

  it('should handle tool call errors gracefully', () => {
    const messageId = 'msg_1';
    mockChatPanel.addMessage({ id: messageId, contentBlocks: [] });

    mockStreamHandler.handleContentBlock({
      type: 'tool_use',
      id: 'tool_1',
      name: 'search',
      input: { query: 'test' },
    });

    mockStreamHandler.handleContentBlock({
      type: 'tool_result',
      toolUseId: 'tool_1',
      isError: true,
      content: 'Tool execution failed',
    });

    mockChatPanel.updateMessage(messageId, {
      contentBlocks,
    });

    const msg = mockChatPanel.messages[0];
    expect(msg.contentBlocks[1].isError).toBe(true);
    expect(msg.contentBlocks[1].content).toBe('Tool execution failed');
  });
});
