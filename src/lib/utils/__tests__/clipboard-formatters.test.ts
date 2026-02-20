/**
 * Tests for clipboard-formatters utility functions
 */

import { describe, it, expect } from 'vitest';
import {
  safeStringify,
  formatToolCallForClipboard,
  formatToolUseBlockForClipboard,
  formatToolResultBlockForClipboard,
  formatAgentMessagesForClipboard,
} from '../clipboard-formatters';

describe('clipboard-formatters', () => {
  describe('safeStringify', () => {
    it('returns empty string for undefined', () => {
      expect(safeStringify(undefined)).toBe('');
    });

    it('returns empty string for null', () => {
      expect(safeStringify(null)).toBe('');
    });

    it('returns string as-is', () => {
      expect(safeStringify('hello')).toBe('hello');
    });

    it('stringifies objects with indentation', () => {
      expect(safeStringify({ a: 1 })).toBe('{\n  "a": 1\n}');
    });

    it('handles circular references gracefully', () => {
      const obj: any = { a: 1 };
      obj.self = obj;
      // Should not throw, returns String(obj)
      expect(safeStringify(obj)).toBe('[object Object]');
    });
  });

  describe('formatToolCallForClipboard', () => {
    it('formats basic tool call', () => {
      const result = formatToolCallForClipboard({
        name: 'read_file',
        arguments: { path: 'test.txt' },
      });
      expect(result).toContain('🔧 Tool: read_file');
      expect(result).toContain('test.txt');
    });

    it('uses toolName as fallback', () => {
      const result = formatToolCallForClipboard({
        toolName: 'write_file',
        input: { content: 'hello' },
      });
      expect(result).toContain('🔧 Tool: write_file');
    });

    it('includes result when present', () => {
      const result = formatToolCallForClipboard({
        name: 'test',
        arguments: {},
        result: 'success',
      });
      expect(result).toContain('✅ Result:');
      expect(result).toContain('success');
    });

    it('includes error when present', () => {
      const result = formatToolCallForClipboard({
        name: 'test',
        arguments: {},
        error: 'failed',
      });
      expect(result).toContain('❌ Error: failed');
    });
  });

  describe('formatToolUseBlockForClipboard', () => {
    it('formats tool use block', () => {
      const result = formatToolUseBlockForClipboard({
        name: 'search',
        input: { query: 'test' },
      });
      expect(result).toContain('🔧 Tool: search');
      expect(result).toContain('query');
    });
  });

  describe('formatToolResultBlockForClipboard', () => {
    it('formats success result', () => {
      const result = formatToolResultBlockForClipboard({
        content: 'file contents',
        is_error: false,
      });
      expect(result).toContain('✅ Tool Result:');
      expect(result).toContain('file contents');
    });

    it('formats error result', () => {
      const result = formatToolResultBlockForClipboard({
        content: 'not found',
        isError: true,
      });
      expect(result).toContain('❌ Tool Error:');
    });
  });

  describe('formatAgentMessagesForClipboard', () => {
    it('formats simple text messages', () => {
      const messages = [
        {
          role: 'user',
          contentBlocks: [{ type: 'text', text: 'Hello' }],
        },
        {
          role: 'assistant',
          contentBlocks: [{ type: 'text', text: 'Hi there!' }],
        },
      ];
      const result = formatAgentMessagesForClipboard(messages);
      expect(result).toContain('User:');
      expect(result).toContain('Hello');
      expect(result).toContain('Assistant:');
      expect(result).toContain('Hi there!');
    });

    it('handles timestamp as string', () => {
      const messages = [
        {
          role: 'user',
          timestamp: '2024-01-15T10:30:00Z',
          contentBlocks: [{ type: 'text', text: 'Test' }],
        },
      ];
      const result = formatAgentMessagesForClipboard(messages);
      expect(result).toContain('User (');
      expect(result).toContain('):');
    });

    it('handles timestamp as Date', () => {
      const messages = [
        {
          role: 'user',
          timestamp: new Date('2024-01-15T10:30:00Z'),
          contentBlocks: [{ type: 'text', text: 'Test' }],
        },
      ];
      const result = formatAgentMessagesForClipboard(messages);
      expect(result).toContain('User (');
    });

    it('handles tool_use blocks', () => {
      const messages = [
        {
          role: 'assistant',
          contentBlocks: [
            { type: 'tool_use', id: 'tool-1', name: 'read_file', input: { path: 'test.txt' } },
          ],
        },
      ];
      const result = formatAgentMessagesForClipboard(messages);
      expect(result).toContain('🔧 Tool: read_file');
    });

    it('handles tool_result blocks', () => {
      const messages = [
        {
          role: 'user',
          contentBlocks: [
            { type: 'tool_result', tool_use_id: 'tool-1', content: 'file contents' },
          ],
        },
      ];
      const result = formatAgentMessagesForClipboard(messages);
      expect(result).toContain('✅ Tool Result:');
    });

    it('handles thinking blocks', () => {
      const messages = [
        {
          role: 'assistant',
          contentBlocks: [{ type: 'thinking', text: 'Let me think...' }],
        },
      ];
      const result = formatAgentMessagesForClipboard(messages);
      expect(result).toContain('💭 Thinking:');
      expect(result).toContain('Let me think...');
    });

    it('handles toolCalls array', () => {
      const messages = [
        {
          role: 'assistant',
          toolCalls: [{ id: 'tc-1', name: 'search', arguments: { q: 'test' } }],
        },
      ];
      const result = formatAgentMessagesForClipboard(messages);
      expect(result).toContain('🔧 Tool: search');
    });

    it('handles toolResults array', () => {
      const messages = [
        {
          role: 'user',
          toolResults: [{ toolCallId: 'tc-1', content: 'found it', isError: false }],
        },
      ];
      const result = formatAgentMessagesForClipboard(messages);
      expect(result).toContain('✅ Tool Result:');
    });

    it('adds separator between user and assistant', () => {
      const messages = [
        { role: 'assistant', contentBlocks: [{ type: 'text', text: 'Response' }] },
        { role: 'user', contentBlocks: [{ type: 'text', text: 'Follow up' }] },
      ];
      const result = formatAgentMessagesForClipboard(messages);
      expect(result).toContain('='.repeat(80));
    });

    it('skips empty messages', () => {
      const messages = [
        { role: 'user', contentBlocks: [] },
        { role: 'assistant', contentBlocks: [{ type: 'text', text: 'Hello' }] },
      ];
      const result = formatAgentMessagesForClipboard(messages);
      expect(result).not.toContain('User:');
      expect(result).toContain('Assistant:');
    });

    it('deduplicates tool calls in contentBlocks and toolCalls', () => {
      const messages = [
        {
          role: 'assistant',
          contentBlocks: [
            { type: 'tool_use', id: 'tool-1', name: 'read_file', input: { path: 'a.txt' } },
          ],
          toolCalls: [{ id: 'tool-1', name: 'read_file', arguments: { path: 'a.txt' } }],
        },
      ];
      const result = formatAgentMessagesForClipboard(messages);
      // Should only appear once
      const matches = result.match(/🔧 Tool: read_file/g);
      expect(matches?.length).toBe(1);
    });
  });
});
