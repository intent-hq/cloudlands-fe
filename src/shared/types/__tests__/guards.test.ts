/**
 * Tests for Type Guards
 */

import {
  describe,
  it,
  expect,
} from 'vitest';
import {
  isAgentSession,
  isAgentMessage,
  isContentBlock,
  isTextBlock,
  isToolUseBlock,
  isToolResultBlock,
  isThinkingBlock,
  isCodeBlock,
  isContentBlockArray,
  isMessageArray,
  isToolCall,
  isToolCallArray,
  hasActiveBackendSession,
  isStreamingMessage,
  hasToolCalls,
} from '../guards';
import {
  isWorkspaceDisplayStatus,
  WORKSPACE_DISPLAY_STATUS_VALUES,
} from '../../types';
import type { AgentMessage } from '../agent-message';

describe('Type Guards', () => {
  describe('isAgentSession', () => {
    it('should identify valid agent sessions', () => {
      const session = {
        id: 'agent-123',
        workspaceId: 'workspace-456',
        messages: [],
        status: 'active',
      };
      expect(isAgentSession(session)).toBe(true);
    });

    it('should reject invalid sessions', () => {
      expect(isAgentSession(null)).toBe(false);
      expect(isAgentSession({})).toBe(false);
      expect(isAgentSession({ id: 'agent-123' })).toBe(false);
    });
  });

  describe('isAgentMessage', () => {
    it('should identify valid messages', () => {
      const message = {
        id: 'msg-123',
        role: 'user',
        content: 'Hello',
        timestamp: new Date(),
      };
      expect(isAgentMessage(message)).toBe(true);
    });

    it('should accept all valid roles', () => {
      const roles = ['user', 'assistant', 'system', 'error'];
      roles.forEach((role) => {
        const message = {
          id: 'msg-123',
          role,
          content: 'Hello',
          timestamp: new Date(),
        };
        expect(isAgentMessage(message)).toBe(true);
      });
    });

    it('should reject invalid messages', () => {
      expect(isAgentMessage(null)).toBe(false);
      expect(isAgentMessage({ id: 'msg-123', role: 'user' })).toBe(false);
    });
  });

  describe('isContentBlock', () => {
    it('should identify valid content blocks', () => {
      const types = ['text', 'code', 'tool_use', 'tool_result', 'thinking'];
      types.forEach((type) => {
        const block = { type };
        expect(isContentBlock(block)).toBe(true);
      });
    });

    it('should reject invalid blocks', () => {
      expect(isContentBlock(null)).toBe(false);
      expect(isContentBlock({})).toBe(false);
      expect(isContentBlock({ type: 'invalid' })).toBe(false);
    });
  });

  describe('Content block type guards', () => {
    it('should identify text blocks', () => {
      expect(isTextBlock({ type: 'text', text: 'hello' })).toBe(true);
      expect(isTextBlock({ type: 'text' })).toBe(false);
    });

    it('should identify tool use blocks', () => {
      expect(isToolUseBlock({ type: 'tool_use', name: 'test' })).toBe(true);
      expect(isToolUseBlock({ type: 'tool_use' })).toBe(false);
    });

    it('should identify tool result blocks', () => {
      expect(isToolResultBlock({ type: 'tool_result', tool_use_id: '123' })).toBe(true);
      expect(isToolResultBlock({ type: 'tool_result' })).toBe(false);
    });

    it('should identify thinking blocks', () => {
      expect(isThinkingBlock({ type: 'thinking' })).toBe(true);
      expect(isThinkingBlock({ type: 'text' })).toBe(false);
    });

    it('should identify code blocks', () => {
      expect(isCodeBlock({ type: 'code' })).toBe(true);
      expect(isCodeBlock({ type: 'text' })).toBe(false);
    });
  });

  describe('Array guards', () => {
    it('should identify content block arrays', () => {
      const blocks = [
        { type: 'text', text: 'hello' },
        { type: 'code', content: 'code' },
      ];
      expect(isContentBlockArray(blocks)).toBe(true);
      expect(isContentBlockArray([{ type: 'invalid' }])).toBe(false);
      expect(isContentBlockArray([])).toBe(true);
    });

    it('should identify message arrays', () => {
      const messages = [
        { id: 'msg-1', role: 'user', content: 'hello', timestamp: new Date() },
        { id: 'msg-2', role: 'assistant', content: 'hi', timestamp: new Date() },
      ];
      expect(isMessageArray(messages)).toBe(true);
      expect(isMessageArray([{ id: 'msg-1' }])).toBe(false);
    });
  });

  describe('Tool call guards', () => {
    it('should identify valid tool calls', () => {
      const call = {
        id: 'tool-123',
        name: 'test_tool',
        timestamp: '2024-01-01T00:00:00Z',
      };
      expect(isToolCall(call)).toBe(true);
    });

    it('should identify tool call arrays', () => {
      const calls = [
        { id: 'tool-1', name: 'test', timestamp: '2024-01-01T00:00:00Z' },
        { id: 'tool-2', name: 'test2', timestamp: '2024-01-01T00:00:00Z' },
      ];
      expect(isToolCallArray(calls)).toBe(true);
    });
  });

  describe('Session helper guards', () => {
    it('should check for active backend sessions', () => {
      const session: any = {
        id: 'agent-123',
        workspaceId: 'workspace-456',
        messages: [],
        status: 'active',
        backendSessionId: 'sess_123',
        name: 'Test Session',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      expect(hasActiveBackendSession(session)).toBe(true);

      const inactiveSession = { ...session, status: 'inactive' };
      expect(hasActiveBackendSession(inactiveSession)).toBe(false);

      const nullSession = { ...session, backendSessionId: null };
      expect(hasActiveBackendSession(nullSession)).toBe(false);
    });
  });

  describe('Message helper guards', () => {
    it('should check for streaming messages', () => {
      const message: AgentMessage = {
        id: 'msg-123',
        role: 'assistant',
        content: 'hello',
        timestamp: new Date(),
        isStreaming: true,
      };
      expect(isStreamingMessage(message)).toBe(true);

      const nonStreaming = { ...message, isStreaming: false };
      expect(isStreamingMessage(nonStreaming)).toBe(false);
    });

    it('should check for tool calls in messages', () => {
      const message: AgentMessage = {
        id: 'msg-123',
        role: 'assistant',
        content: 'hello',
        timestamp: new Date(),
        toolCalls: [
          { id: 'tool-1', name: 'test', arguments: {}, timestamp: '2024-01-01T00:00:00Z' },
        ],
      };
      expect(hasToolCalls(message)).toBe(true);

      const noTools = { ...message, toolCalls: [] };
      expect(hasToolCalls(noTools)).toBe(false);
    });
  });

  describe('isWorkspaceDisplayStatus', () => {
    it('accepts every canonical wire value, including needs_attention', () => {
      for (const value of WORKSPACE_DISPLAY_STATUS_VALUES) {
        expect(isWorkspaceDisplayStatus(value)).toBe(true);
      }
      expect(isWorkspaceDisplayStatus('needs_attention')).toBe(true);
    });

    it('rejects unknown or non-string values', () => {
      expect(isWorkspaceDisplayStatus('something_new')).toBe(false);
      expect(isWorkspaceDisplayStatus('')).toBe(false);
      expect(isWorkspaceDisplayStatus(undefined)).toBe(false);
      expect(isWorkspaceDisplayStatus(null)).toBe(false);
      expect(isWorkspaceDisplayStatus(42)).toBe(false);
    });
  });
});
