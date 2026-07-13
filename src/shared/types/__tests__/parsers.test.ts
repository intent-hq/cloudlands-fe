/**
 * Tests for Safe Parsers
 */

import {
  describe,
  it,
  expect,
} from 'vitest';
import {
  safeParseAgentSession,
  safeParseAgentMessage,
  safeParseContentBlock,
  safeParseToolCall,
  safeParseContentBlocks,
  safeParseAgentMessages,
  safeParseToolCalls,
  safeParseSessionWithMessages,
  safeParseMessageWithBlocks,
} from '../parsers';

describe('Safe Parsers', () => {
  describe('safeParseAgentSession', () => {
    it('should parse valid sessions', () => {
      const session = {
        id: 'agent-123',
        workspaceId: 'workspace-456',
        messages: [],
        status: 'active',
      };
      const result = safeParseAgentSession(session);
      expect(result).toEqual(session);
    });

    it('should return null for invalid sessions', () => {
      expect(safeParseAgentSession(null)).toBeNull();
      expect(safeParseAgentSession({})).toBeNull();
      expect(safeParseAgentSession('invalid')).toBeNull();
    });
  });

  describe('safeParseAgentMessage', () => {
    it('should parse valid messages', () => {
      const message = {
        id: 'msg-123',
        role: 'user',
        content: 'Hello',
        timestamp: new Date(),
      };
      const result = safeParseAgentMessage(message);
      expect(result).toEqual(message);
    });

    it('should return null for invalid messages', () => {
      expect(safeParseAgentMessage(null)).toBeNull();
      expect(safeParseAgentMessage({ id: 'msg-123' })).toBeNull();
    });
  });

  describe('safeParseContentBlock', () => {
    it('should parse valid blocks', () => {
      const block = { type: 'text', text: 'hello' };
      const result = safeParseContentBlock(block);
      expect(result).toEqual(block);
    });

    it('should return null for invalid blocks', () => {
      expect(safeParseContentBlock(null)).toBeNull();
      expect(safeParseContentBlock({ type: 'invalid' })).toBeNull();
    });
  });

  describe('safeParseToolCall', () => {
    it('should parse valid tool calls', () => {
      const call = {
        id: 'tool-123',
        name: 'test',
        timestamp: '2024-01-01T00:00:00Z',
      };
      const result = safeParseToolCall(call);
      expect(result).toEqual(call);
    });

    it('should return null for invalid tool calls', () => {
      expect(safeParseToolCall(null)).toBeNull();
      expect(safeParseToolCall({ id: 'tool-123' })).toBeNull();
    });
  });

  describe('safeParseContentBlocks', () => {
    it('should parse arrays of content blocks', () => {
      const blocks = [
        { type: 'text', text: 'hello' },
        { type: 'code', content: 'code' },
      ];
      const result = safeParseContentBlocks(blocks);
      expect(result).toEqual(blocks);
    });

    it('should filter out invalid blocks', () => {
      const blocks = [
        { type: 'text', text: 'hello' },
        { type: 'invalid' },
        { type: 'code', content: 'code' },
      ];
      const result = safeParseContentBlocks(blocks);
      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('text');
      expect(result[1].type).toBe('code');
    });

    it('should return empty array for non-arrays', () => {
      expect(safeParseContentBlocks(null)).toEqual([]);
      expect(safeParseContentBlocks('invalid')).toEqual([]);
    });
  });

  describe('safeParseAgentMessages', () => {
    it('should parse arrays of messages', () => {
      const messages = [
        { id: 'msg-1', role: 'user', content: 'hello', timestamp: new Date() },
        { id: 'msg-2', role: 'assistant', content: 'hi', timestamp: new Date() },
      ];
      const result = safeParseAgentMessages(messages);
      expect(result).toHaveLength(2);
    });

    it('should filter out invalid messages', () => {
      const messages = [
        { id: 'msg-1', role: 'user', content: 'hello', timestamp: new Date() },
        { id: 'msg-2' },
        { id: 'msg-3', role: 'assistant', content: 'hi', timestamp: new Date() },
      ];
      const result = safeParseAgentMessages(messages);
      expect(result).toHaveLength(2);
    });

    it('should return empty array for non-arrays', () => {
      expect(safeParseAgentMessages(null)).toEqual([]);
      expect(safeParseAgentMessages('invalid')).toEqual([]);
    });
  });

  describe('safeParseToolCalls', () => {
    it('should parse arrays of tool calls', () => {
      const calls = [
        { id: 'tool-1', name: 'test', timestamp: '2024-01-01T00:00:00Z' },
        { id: 'tool-2', name: 'test2', timestamp: '2024-01-01T00:00:00Z' },
      ];
      const result = safeParseToolCalls(calls);
      expect(result).toHaveLength(2);
    });

    it('should filter out invalid tool calls', () => {
      const calls = [
        { id: 'tool-1', name: 'test', timestamp: '2024-01-01T00:00:00Z' },
        { id: 'tool-2' },
        { id: 'tool-3', name: 'test3', timestamp: '2024-01-01T00:00:00Z' },
      ];
      const result = safeParseToolCalls(calls);
      expect(result).toHaveLength(2);
    });
  });

  describe('safeParseSessionWithMessages', () => {
    it('should parse session with validated messages', () => {
      const session = {
        id: 'agent-123',
        workspaceId: 'workspace-456',
        messages: [
          { id: 'msg-1', role: 'user', content: 'hello', timestamp: new Date() },
          { id: 'msg-2', role: 'assistant', content: 'hi', timestamp: new Date() },
        ],
        status: 'active',
      };
      const result = safeParseSessionWithMessages(session);
      expect(result).not.toBeNull();
      expect(result?.messages).toHaveLength(2);
    });

    it('should filter invalid messages from session', () => {
      const session = {
        id: 'agent-123',
        workspaceId: 'workspace-456',
        messages: [
          { id: 'msg-1', role: 'user', content: 'hello', timestamp: new Date() },
          { id: 'msg-2' },
          { id: 'msg-3', role: 'assistant', content: 'hi', timestamp: new Date() },
        ],
        status: 'active',
      };
      const result = safeParseSessionWithMessages(session);
      expect(result?.messages).toHaveLength(2);
    });

    it('should return null for invalid sessions', () => {
      expect(safeParseSessionWithMessages(null)).toBeNull();
      expect(safeParseSessionWithMessages({})).toBeNull();
    });
  });

  describe('safeParseMessageWithBlocks', () => {
    it('should parse message with validated blocks', () => {
      const message = {
        id: 'msg-123',
        role: 'assistant',
        content: 'hello',
        timestamp: new Date(),
        contentBlocks: [
          { type: 'text', text: 'hello' },
          { type: 'code', content: 'code' },
        ],
      };
      const result = safeParseMessageWithBlocks(message);
      expect(result).not.toBeNull();
      expect(result?.contentBlocks).toHaveLength(2);
    });

    it('should filter invalid blocks from message', () => {
      const message = {
        id: 'msg-123',
        role: 'assistant',
        content: 'hello',
        timestamp: new Date(),
        contentBlocks: [
          { type: 'text', text: 'hello' },
          { type: 'invalid' },
          { type: 'code', content: 'code' },
        ],
      };
      const result = safeParseMessageWithBlocks(message);
      expect(result?.contentBlocks).toHaveLength(2);
    });

    it('should return null for invalid messages', () => {
      expect(safeParseMessageWithBlocks(null)).toBeNull();
      expect(safeParseMessageWithBlocks({ id: 'msg-123' })).toBeNull();
    });
  });
});
