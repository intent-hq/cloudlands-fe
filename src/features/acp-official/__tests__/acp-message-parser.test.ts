/**
 * Tests for ACP Message Parser
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseACPMessage,
  ACPStreamParser,
  extractACPToolCalls,
} from '../parsers/acp-message-parser';

// Mock the Logger
vi.mock('../../../shared/logger', () => ({
  Logger: class MockLogger {
    debug = vi.fn();
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
}));

describe('acp-message-parser', () => {
  describe('parseACPMessage', () => {
    it('should parse string content', () => {
      const result = parseACPMessage('Hello, world!');
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('text');
      expect((result[0] as any).text).toBe('Hello, world!');
    });

    it('should parse object with text property', () => {
      const result = parseACPMessage({ text: 'Hello from object' });
      expect(result).toHaveLength(1);
      expect((result[0] as any).text).toBe('Hello from object');
    });

    it('should parse array of text blocks', () => {
      const result = parseACPMessage({
        content: [
          { type: 'text', text: 'First block' },
          { type: 'text', text: 'Second block' },
        ],
      });
      expect(result).toHaveLength(2);
      expect((result[0] as any).text).toBe('First block');
      expect((result[1] as any).text).toBe('Second block');
    });

    it('should handle tool_use blocks', () => {
      const result = parseACPMessage({
        content: [
          {
            type: 'tool_use',
            id: 'tool-123',
            name: 'read_file',
            input: { path: '/test.txt' },
          },
        ],
      });
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('tool_use');
      expect((result[0] as any).name).toBe('read_file');
    });

    it('should handle empty content', () => {
      const result = parseACPMessage({ content: [] });
      expect(result).toHaveLength(0);
    });

    it('should handle null/undefined gracefully', () => {
      const result = parseACPMessage(null);
      expect(result).toHaveLength(0);
    });
  });

  describe('ACPStreamParser', () => {
    let parser: ACPStreamParser;

    beforeEach(() => {
      parser = new ACPStreamParser();
    });

    it('should parse complete JSON line', () => {
      const messages = parser.parseChunk('{"method":"test"}\n');
      expect(messages).toHaveLength(1);
      expect(messages[0].method).toBe('test');
    });

    it('should parse multiple JSON lines', () => {
      const messages = parser.parseChunk('{"method":"first"}\n{"method":"second"}\n');
      expect(messages).toHaveLength(2);
      expect(messages[0].method).toBe('first');
      expect(messages[1].method).toBe('second');
    });

    it('should handle incomplete JSON across chunks', () => {
      const messages1 = parser.parseChunk('{"method":');
      expect(messages1).toHaveLength(0);

      const messages2 = parser.parseChunk('"test"}\n');
      expect(messages2).toHaveLength(1);
      expect(messages2[0].method).toBe('test');
    });

    it('should skip empty lines', () => {
      const messages = parser.parseChunk('\n\n{"method":"test"}\n\n');
      expect(messages).toHaveLength(1);
    });

    it('should reset buffer', () => {
      parser.parseChunk('{"incomplete":');
      parser.reset();
      const messages = parser.parseChunk('{"method":"fresh"}\n');
      expect(messages).toHaveLength(1);
      expect(messages[0].method).toBe('fresh');
    });
  });

  describe('extractACPToolCalls', () => {
    it('should extract tool calls from content', () => {
      const content = [
        { type: 'text', text: 'Some text' },
        { type: 'tool_use', id: 'tool-1', name: 'read_file', input: { path: '/test.txt' } },
        { type: 'tool_use', id: 'tool-2', name: 'write_file', input: { path: '/out.txt' } },
      ];

      const toolCalls = extractACPToolCalls(content);
      expect(toolCalls).toHaveLength(2);
      expect(toolCalls[0].name).toBe('read_file');
      expect(toolCalls[1].name).toBe('write_file');
    });

    it('should return empty array for non-array input', () => {
      const toolCalls = extractACPToolCalls('not an array' as any);
      expect(toolCalls).toHaveLength(0);
    });

    it('should return empty array when no tool calls', () => {
      const content = [{ type: 'text', text: 'Just text' }];
      const toolCalls = extractACPToolCalls(content);
      expect(toolCalls).toHaveLength(0);
    });
  });
});
