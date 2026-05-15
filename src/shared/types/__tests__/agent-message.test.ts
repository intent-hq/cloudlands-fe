/**
 * Tests for Unified AgentMessage Type
 */

import {
  describe,
  it,
  expect,
} from 'vitest';
import type {
  AgentMessage,
  ProviderMessage,
  ToolCall,
  ToolResult,
  MessageMetadata,
} from '../agent-message';
import {
  toProviderMessage,
  fromProviderMessage,
  extractContentFromBlocks,
  normalizeAgentMessage,
  mergeMessages,
} from '../agent-message.conversion';

describe('AgentMessage Type Consolidation', () => {
  describe('Type Definitions', () => {
    it('should create a valid AgentMessage', () => {
      const message: AgentMessage = {
        id: 'msg-123',
        role: 'assistant',
        content: 'Hello',
        timestamp: new Date().toISOString(),
      };
      expect(message.id).toBe('msg-123');
      expect(message.role).toBe('assistant');
      expect(message.content).toBe('Hello');
    });

    it('should create a valid ProviderMessage', () => {
      const message: ProviderMessage = {
        role: 'user',
        content: 'Hi there',
      };
      expect(message.role).toBe('user');
      expect(message.content).toBe('Hi there');
    });

    it('should support ToolCall with optional fields', () => {
      const toolCall: ToolCall = {
        id: 'tool-1',
        name: 'read_file',
        arguments: { path: 'test.txt' },
        timestamp: new Date().toISOString(),
        toolName: 'read_file', // Optional alias
        status: 'completed',
      };
      expect(toolCall.name).toBe('read_file');
      expect(toolCall.toolName).toBe('read_file');
      expect(toolCall.status).toBe('completed');
    });

    it('should support ToolResult', () => {
      const result: ToolResult = {
        toolCallId: 'tool-1',
        content: 'File contents',
        isError: false,
      };
      expect(result.toolCallId).toBe('tool-1');
      expect(result.content).toBe('File contents');
    });

    it('should support MessageMetadata', () => {
      const metadata: MessageMetadata = {
        model: 'gpt-4',
        usage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
        },
        duration_ms: 1000,
      };
      expect(metadata.model).toBe('gpt-4');
      expect(metadata.usage?.totalTokens).toBe(150);
    });
  });

  describe('Conversion Utilities', () => {
    it('should convert AgentMessage to ProviderMessage', () => {
      const agentMsg: AgentMessage = {
        id: 'msg-123',
        role: 'assistant',
        contentBlocks: [{ type: 'text', text: 'Response' }],
        timestamp: new Date().toISOString(),
      };
      const providerMsg = toProviderMessage(agentMsg);
      expect(providerMsg.role).toBe('assistant');
      expect(providerMsg.contentBlocks).toEqual([{ type: 'text', text: 'Response' }]);
      expect((providerMsg as any).id).toBeUndefined();
    });

    it('should convert ProviderMessage to AgentMessage', () => {
      const providerMsg: ProviderMessage = {
        role: 'user',
        contentBlocks: [{ type: 'text', text: 'Question' }],
      };
      const agentMsg = fromProviderMessage(providerMsg, undefined, 'msg-456');
      expect(agentMsg.id).toBe('msg-456');
      expect(agentMsg.role).toBe('user');
      expect(agentMsg.contentBlocks).toEqual([{ type: 'text', text: 'Question' }]);
    });

    it('should extract content from blocks', () => {
      const blocks = [
        { type: 'text' as const, text: 'Hello' },
        { type: 'text' as const, text: ' World' },
      ];
      const content = extractContentFromBlocks(blocks);
      expect(content).toBe('Hello World');
    });

    it('should normalize AgentMessage', () => {
      const msg: AgentMessage = {
        id: 'msg-123',
        role: 'assistant',
        content: 'Test',
        timestamp: new Date().toISOString(),
      };
      const normalized = normalizeAgentMessage(msg);
      expect(normalized.id).toBe('msg-123');
      expect(normalized.role).toBe('assistant');
    });

    it('should merge multiple messages', () => {
      const msg1: AgentMessage = {
        id: 'msg-1',
        role: 'assistant',
        contentBlocks: [{ type: 'text', text: 'Hello' }],
        timestamp: new Date().toISOString(),
      };
      const msg2: AgentMessage = {
        id: 'msg-2',
        role: 'assistant',
        contentBlocks: [{ type: 'text', text: ' World' }],
        timestamp: new Date().toISOString(),
      };
      const merged = mergeMessages([msg1, msg2]);
      expect(merged.contentBlocks).toHaveLength(2);
      expect(merged.contentBlocks?.[0]).toEqual({ type: 'text', text: 'Hello' });
      expect(merged.contentBlocks?.[1]).toEqual({ type: 'text', text: ' World' });
    });
  });
});
