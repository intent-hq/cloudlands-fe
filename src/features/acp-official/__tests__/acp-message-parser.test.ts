/**
 * Tests for ACP Message Parser
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseACPMessage,
  ACPStreamParser,
  extractACPToolCalls,
} from '../parsers/acp-message-parser';

// Shared mock functions so we can inspect calls from the module-level logger
const { mockWarn, mockError } = vi.hoisted(() => ({
  mockWarn: vi.fn(),
  mockError: vi.fn(),
}));

// Mock the Logger
vi.mock('../../../shared/logger', () => ({
  Logger: class MockLogger {
    debug = vi.fn();
    info = vi.fn();
    warn = mockWarn;
    error = mockError;
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

    it('preserves attached note resource URI when the visible title would slug differently', () => {
      const targetNoteId = '7f0f6b66-5c52-40b7-a76b-9d1f5d58a4bb';
      const targetUri = `intent://local/source-workspace-id/note/${targetNoteId}`;
      const result = parseACPMessage({
        content: [
          {
            type: 'resource',
            resource: {
              uri: targetUri,
              text: 'Safety review details',
              _meta: { title: 'PR 17 Safety Review' },
            },
          },
        ],
      });

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('text');
      expect((result[0] as any).text).toContain(`[PR 17 Safety Review](${targetUri})`);
      expect((result[0] as any).text).not.toContain('intent://local/note/pr-17-safety-review');
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

    afterEach(() => {
      vi.useRealTimers();
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

    it('should parse messages slightly larger than 1MB', () => {
      // Create a message with ~1.1MB of content (this would fail with old 1MB threshold)
      const largeText = 'x'.repeat(1.1 * 1024 * 1024);
      const largeMessage = JSON.stringify({ method: 'large', data: largeText });

      // Send the message as a single NDJSON line
      const messages = parser.parseChunk(largeMessage + '\n');
      expect(messages).toHaveLength(1);
      expect(messages[0].method).toBe('large');
      expect(messages[0].data.length).toBe(largeText.length);
    });

    it('should parse large messages arriving in multiple chunks', () => {
      const largeText = 'y'.repeat(1.05 * 1024 * 1024);
      const fullLine = JSON.stringify({ method: 'chunked', payload: largeText }) + '\n';

      // Split into 3 chunks
      const chunkSize = Math.ceil(fullLine.length / 3);
      const chunk1 = fullLine.substring(0, chunkSize);
      const chunk2 = fullLine.substring(chunkSize, chunkSize * 2);
      const chunk3 = fullLine.substring(chunkSize * 2);

      const messages1 = parser.parseChunk(chunk1);
      expect(messages1).toHaveLength(0);

      const messages2 = parser.parseChunk(chunk2);
      expect(messages2).toHaveLength(0);

      const messages3 = parser.parseChunk(chunk3);
      expect(messages3).toHaveLength(1);
      expect(messages3[0].method).toBe('chunked');
    });

    it('should reset buffer when it exceeds the cleanup threshold (5MB) with unparseable content', () => {
      // Feed >5MB of non-JSON data without newlines
      const garbageChunk = 'not-json-'.repeat(600_000); // ~5.4MB
      const messages1 = parser.parseChunk(garbageChunk);
      // Buffer should have been reset after exceeding threshold
      expect(messages1).toHaveLength(0);

      // Parser should still work after reset
      const messages2 = parser.parseChunk('{"method":"recovered"}\n');
      expect(messages2).toHaveLength(1);
      expect(messages2[0].method).toBe('recovered');
    });

    it('should not call tryParseCompleteJson for large buffers when NDJSON lines yield messages', () => {
      // When we get complete NDJSON lines and a large trailing buffer,
      // tryParseCompleteJson should be skipped for performance.
      // Build a trailing *complete* JSON object > 256KB (no trailing \n).
      // If tryParseCompleteJson ran, it would find and parse this object,
      // giving us 2 messages instead of 1.
      const largeComplete = '{"data":"' + 'x'.repeat(300 * 1024) + '"}';
      const messages = parser.parseChunk('{"method":"line1"}\n' + largeComplete);
      expect(messages).toHaveLength(1);
      expect(messages[0].method).toBe('line1');
    });

    it('should still parse trailing complete JSON after NDJSON lines when buffer is small', () => {
      // When buffer is small (< 256KB), tryParseCompleteJson should be called
      // even if NDJSON lines already yielded messages, to catch trailing objects
      // without a trailing newline.
      const messages = parser.parseChunk('{"method":"line1"}\n{"method":"trailing"}');
      expect(messages).toHaveLength(2);
      expect(messages[0].method).toBe('line1');
      expect(messages[1].method).toBe('trailing');
    });

    it('should handle single chunk larger than MAX_BUFFER_SIZE', () => {
      // A single chunk > 10MB should be dropped entirely, not overflow the buffer
      const hugeChunk = 'x'.repeat(11 * 1024 * 1024); // 11MB, > MAX_BUFFER_SIZE
      const messages = parser.parseChunk(hugeChunk);
      expect(messages).toHaveLength(0);

      // Parser should still work after dropping the oversized chunk
      const messages2 = parser.parseChunk('{"method":"after_huge"}\n');
      expect(messages2).toHaveLength(1);
      expect(messages2[0].method).toBe('after_huge');
    });

    it('should rate-limit warning logs for large buffers', () => {
      vi.useFakeTimers();
      mockWarn.mockClear();
      mockError.mockClear();

      const rateLimitParser = new ACPStreamParser();
      const largeContent = 'a'.repeat(5.5 * 1024 * 1024); // >5MB

      // First call - should trigger warn + error logs
      rateLimitParser.parseChunk(largeContent);
      const warnCountAfterFirst = mockWarn.mock.calls.length;
      const errorCountAfterFirst = mockError.mock.calls.length;
      expect(warnCountAfterFirst + errorCountAfterFirst).toBeGreaterThan(0);

      // Second call immediately (within 5s window) - should be rate-limited
      rateLimitParser.parseChunk(largeContent);
      expect(mockWarn.mock.calls.length).toBe(warnCountAfterFirst);
      expect(mockError.mock.calls.length).toBe(errorCountAfterFirst);

      // Advance time past the rate limit window (5 seconds)
      vi.advanceTimersByTime(5001);

      // Third call - should log again since rate limit expired
      rateLimitParser.parseChunk(largeContent);
      const totalAfterThird = mockWarn.mock.calls.length + mockError.mock.calls.length;
      const totalAfterSecond = warnCountAfterFirst + errorCountAfterFirst;
      expect(totalAfterThird).toBeGreaterThan(totalAfterSecond);

      // Parser should still function
      const messages = rateLimitParser.parseChunk('{"method":"after_rate_limit"}\n');
      expect(messages).toHaveLength(1);
      expect(messages[0].method).toBe('after_rate_limit');

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
