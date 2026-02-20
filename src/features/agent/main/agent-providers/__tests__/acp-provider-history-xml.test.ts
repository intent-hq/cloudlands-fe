/**
 * Unit tests for the formatHistoryAsXml session recovery functions.
 *
 * Tests cover: escapeXml, safeStringify, formatHistoryAsXml
 * including edge cases for XML escaping, exchange grouping,
 * truncation, content block rendering, and structural correctness.
 */

import { describe, it, expect } from 'vitest';
import { escapeXml, safeStringify, formatHistoryAsXml } from '../acp-provider';
import type { AgentMessage } from '../base-provider';
import type { ContentBlock } from '../../../../../shared/types/content-block';

// Helper to create a user message
function userMsg(text: string, blocks?: ContentBlock[]): AgentMessage {
  return {
    role: 'user',
    contentBlocks: blocks ?? [{ type: 'text', text }],
  };
}

// Helper to create an assistant message
function assistantMsg(text: string, blocks?: ContentBlock[]): AgentMessage {
  return {
    role: 'assistant',
    contentBlocks: blocks ?? [{ type: 'text', text }],
  };
}

// Helper to create an error message
function errorMsg(errorText?: string): AgentMessage {
  const msg: any = { role: 'error' as const, contentBlocks: [] };
  if (errorText !== undefined) msg.error = errorText;
  return msg;
}

// ─── escapeXml ───────────────────────────────────────────────────────────────

describe('escapeXml', () => {
  it('should return empty string unchanged', () => {
    expect(escapeXml('')).toBe('');
  });

  it('should return string with no special chars unchanged', () => {
    expect(escapeXml('hello world')).toBe('hello world');
  });

  it('should escape ampersand', () => {
    expect(escapeXml('a & b')).toBe('a &amp; b');
  });

  it('should escape less-than', () => {
    expect(escapeXml('a < b')).toBe('a &lt; b');
  });

  it('should escape greater-than', () => {
    expect(escapeXml('a > b')).toBe('a &gt; b');
  });

  it('should escape double quotes', () => {
    expect(escapeXml('a "b" c')).toBe('a &quot;b&quot; c');
  });

  it('should escape all special chars in one string', () => {
    expect(escapeXml('if (a < b && c > d) { x = "y"; }')).toBe(
      'if (a &lt; b &amp;&amp; c &gt; d) { x = &quot;y&quot;; }',
    );
  });

  it('should handle code with generics like Array<string>', () => {
    expect(escapeXml('Array<string>')).toBe('Array&lt;string&gt;');
  });

  it('should not double-escape already-escaped content', () => {
    // If someone passes already-escaped text, it gets double-escaped (expected behavior)
    expect(escapeXml('&amp;')).toBe('&amp;amp;');
  });

  it('should handle multi-line strings', () => {
    const input = 'line1 <tag>\nline2 & more\nline3 "quoted"';
    const expected = 'line1 &lt;tag&gt;\nline2 &amp; more\nline3 &quot;quoted&quot;';
    expect(escapeXml(input)).toBe(expected);
  });
});

// ─── safeStringify ───────────────────────────────────────────────────────────

describe('safeStringify', () => {
  it('should return strings as-is', () => {
    expect(safeStringify('hello')).toBe('hello');
  });

  it('should return empty string as-is', () => {
    expect(safeStringify('')).toBe('');
  });

  it('should stringify objects', () => {
    expect(safeStringify({ a: 1 })).toBe('{"a":1}');
  });

  it('should stringify arrays', () => {
    expect(safeStringify([1, 2, 3])).toBe('[1,2,3]');
  });

  it('should stringify null', () => {
    expect(safeStringify(null)).toBe('null');
  });

  it('should handle undefined gracefully', () => {
    const result = safeStringify(undefined);
    expect(typeof result).toBe('string');
    expect(result).toBe('undefined');
  });

  it('should stringify numbers', () => {
    expect(safeStringify(42)).toBe('42');
  });

  it('should stringify booleans', () => {
    expect(safeStringify(true)).toBe('true');
  });

  it('should stringify nested objects', () => {
    expect(safeStringify({ a: { b: 'c' } })).toBe('{"a":{"b":"c"}}');
  });

  it('should handle circular references without throwing', () => {
    const obj: any = { a: 1 };
    obj.self = obj;
    const result = safeStringify(obj);
    expect(result).toBe('[serialization error]');
  });

  it('should stringify empty object', () => {
    expect(safeStringify({})).toBe('{}');
  });

  it('should handle BigInt without throwing', () => {
    const result = safeStringify(BigInt(42));
    expect(typeof result).toBe('string');
    // BigInt throws in JSON.stringify, so it should hit the catch
    expect(result).toBe('[serialization error]');
  });
});

// ─── formatHistoryAsXml — basic cases ────────────────────────────────────────

describe('formatHistoryAsXml', () => {
  describe('basic cases', () => {
    it('should return empty string for empty messages', () => {
      expect(formatHistoryAsXml([])).toBe('');
    });

    it('should wrap a single user message in supervisor and exchange tags', () => {
      const result = formatHistoryAsXml([userMsg('hello')]);
      expect(result).toContain('<supervisor>');
      expect(result).toContain('</supervisor>');
      expect(result).toContain('<exchange>');
      expect(result).toContain('</exchange>');
      expect(result).toContain('<user_request_or_tool_results>');
      expect(result).toContain('<text>hello</text>');
    });

    it('should handle a single assistant message', () => {
      const result = formatHistoryAsXml([assistantMsg('response')]);
      expect(result).toContain('<agent_response_or_tool_uses>');
      expect(result).toContain('<text>response</text>');
    });

    it('should handle a user→assistant exchange pair', () => {
      const result = formatHistoryAsXml([userMsg('question'), assistantMsg('answer')]);
      expect(result).toContain('<user_request_or_tool_results>');
      expect(result).toContain('<text>question</text>');
      expect(result).toContain('<agent_response_or_tool_uses>');
      expect(result).toContain('<text>answer</text>');
      // Both should be in the same exchange
      const exchangeCount = (result.match(/<exchange>/g) || []).length;
      expect(exchangeCount).toBe(1);
    });

    it('should handle multiple exchange pairs', () => {
      const result = formatHistoryAsXml([
        userMsg('q1'),
        assistantMsg('a1'),
        userMsg('q2'),
        assistantMsg('a2'),
      ]);
      const exchangeCount = (result.match(/<exchange>/g) || []).length;
      expect(exchangeCount).toBe(2);
    });

    it('should include recovery preamble text', () => {
      const result = formatHistoryAsXml([userMsg('hello')]);
      expect(result).toContain('recovered session');
      expect(result).toContain('Continue the conversation from this point.');
    });
  });

  // ─── XML escaping in context ───────────────────────────────────────────────

  describe('XML escaping in content', () => {
    it('should escape special chars in user text', () => {
      const result = formatHistoryAsXml([userMsg('if (a < b && c > d) {}')]);
      expect(result).toContain('&lt;');
      expect(result).toContain('&amp;');
      expect(result).toContain('&gt;');
      // Should NOT contain raw < or > inside text elements
      expect(result).not.toMatch(/<text>[^<]*[<][^/][^<]*<\/text>/);
    });

    it('should escape special chars in assistant text', () => {
      const result = formatHistoryAsXml([
        userMsg('test'),
        assistantMsg('Use Array<string> & Map<K, V>'),
      ]);
      expect(result).toContain('Array&lt;string&gt; &amp; Map&lt;K, V&gt;');
    });

    it('should escape tool names containing special chars', () => {
      const blocks: ContentBlock[] = [
        { type: 'tool_use', name: 'tool<name>', tool_use_id: 'id&1', input: {} },
      ];
      const result = formatHistoryAsXml([userMsg('test'), assistantMsg('', blocks)]);
      expect(result).toContain('name="tool&lt;name&gt;"');
      expect(result).toContain('tool_use_id="id&amp;1"');
    });

    it('should escape tool_result content', () => {
      const blocks: ContentBlock[] = [
        { type: 'tool_result', tool_use_id: 'id1', output: 'result with <html> & "quotes"' },
      ];
      const result = formatHistoryAsXml([userMsg('test', blocks)]);
      expect(result).toContain('&lt;html&gt;');
      expect(result).toContain('&amp;');
      expect(result).toContain('&quot;quotes&quot;');
    });
  });

  // ─── Exchange grouping ─────────────────────────────────────────────────────

  describe('exchange grouping', () => {
    it('should group consecutive assistants with preceding user into one exchange', () => {
      const result = formatHistoryAsXml([
        userMsg('question'),
        assistantMsg('part 1'),
        assistantMsg('part 2'),
      ]);
      const exchangeCount = (result.match(/<exchange>/g) || []).length;
      expect(exchangeCount).toBe(1);
      expect(result).toContain('<text>part 1</text>');
      expect(result).toContain('<text>part 2</text>');
    });

    it('should create separate exchanges for consecutive assistants without user', () => {
      const result = formatHistoryAsXml([assistantMsg('first'), assistantMsg('second')]);
      const exchangeCount = (result.match(/<exchange>/g) || []).length;
      expect(exchangeCount).toBe(2);
    });

    it('should include error messages in the current exchange', () => {
      const msg = errorMsg('something went wrong');
      const result = formatHistoryAsXml([userMsg('test'), assistantMsg('response'), msg]);
      const exchangeCount = (result.match(/<exchange>/g) || []).length;
      expect(exchangeCount).toBe(1);
      expect(result).toContain('<error>');
      expect(result).toContain('</error>');
    });

    it('should render error text from the error property', () => {
      const msg = errorMsg('fail reason');
      const result = formatHistoryAsXml([userMsg('test'), msg]);
      expect(result).toContain('<text>fail reason</text>');
    });

    it('should handle user-only exchanges', () => {
      const result = formatHistoryAsXml([userMsg('q1'), userMsg('q2')]);
      const exchangeCount = (result.match(/<exchange>/g) || []).length;
      expect(exchangeCount).toBe(2);
    });

    it('should filter out system messages (no system in output)', () => {
      // System messages are filtered upstream, but if one slips through it's ignored
      const sysMsg: AgentMessage = { role: 'system' as any, contentBlocks: [{ type: 'text', text: 'system prompt' }] };
      const result = formatHistoryAsXml([sysMsg, userMsg('hello')]);
      expect(result).not.toContain('system prompt');
      // Only the user exchange
      const exchangeCount = (result.match(/<exchange>/g) || []).length;
      expect(exchangeCount).toBe(1);
    });

    it('should handle complex sequence: user, assistant, error, user, assistant', () => {
      const result = formatHistoryAsXml([
        userMsg('q1'),
        assistantMsg('a1'),
        errorMsg('err'),
        userMsg('q2'),
        assistantMsg('a2'),
      ]);
      const exchangeCount = (result.match(/<exchange>/g) || []).length;
      expect(exchangeCount).toBe(2);
    });
  });

  // ─── Truncation ──────────────────────────────────────────────────────────────

  describe('truncation', () => {
    it('should include all exchanges when they fit under maxChars', () => {
      const result = formatHistoryAsXml(
        [userMsg('q1'), assistantMsg('a1'), userMsg('q2'), assistantMsg('a2')],
        100000,
      );
      expect(result).toContain('<text>q1</text>');
      expect(result).toContain('<text>a1</text>');
      expect(result).toContain('<text>q2</text>');
      expect(result).toContain('<text>a2</text>');
      expect(result).not.toContain('omitted');
    });

    it('should omit older exchanges when over maxChars limit', () => {
      // Use a very small maxChars to force truncation
      const messages = [
        userMsg('first question that is fairly long'),
        assistantMsg('first answer that is also fairly long'),
        userMsg('second question'),
        assistantMsg('second answer'),
      ];
      // Use a limit that fits only the last exchange + wrapper
      const result = formatHistoryAsXml(messages, 600);
      // Should include the newer exchange
      expect(result).toContain('second');
      // Should have an omission comment
      expect(result).toContain('omitted due to size limits');
    });

    it('should keep exchanges contiguous (no gaps)', () => {
      // Create 5 exchanges of varying sizes
      const messages: AgentMessage[] = [];
      for (let i = 0; i < 5; i++) {
        messages.push(userMsg(`question ${i}`));
        messages.push(assistantMsg(`answer ${i}`));
      }
      // Use a limit that forces some truncation
      const result = formatHistoryAsXml(messages, 1000);

      // If exchange N is included, all exchanges after N must also be included
      // (contiguity guarantee)
      const included: number[] = [];
      for (let i = 0; i < 5; i++) {
        if (result.includes(`question ${i}`)) {
          included.push(i);
        }
      }
      // Verify contiguity: indices should be consecutive
      for (let i = 1; i < included.length; i++) {
        expect(included[i]).toBe(included[i - 1] + 1);
      }
    });

    it('should handle a single huge exchange that does not fit', () => {
      const longText = 'x'.repeat(10000);
      const result = formatHistoryAsXml([userMsg(longText)], 500);
      // Should still produce valid output with omission comment
      expect(result).toContain('<supervisor>');
      expect(result).toContain('</supervisor>');
      expect(result).toContain('omitted');
      // The huge exchange should NOT be included
      expect(result).not.toContain(longText);
    });

    it('should not include omission comment when all exchanges fit', () => {
      const result = formatHistoryAsXml([userMsg('hi'), assistantMsg('hello')], 100000);
      expect(result).not.toContain('omitted');
    });

    it('should never exceed maxChars in total output length', () => {
      const messages: AgentMessage[] = [];
      for (let i = 0; i < 20; i++) {
        messages.push(userMsg(`question ${i} with some padding text to make it longer`));
        messages.push(assistantMsg(`answer ${i} with some padding text to make it longer too`));
      }
      const maxChars = 2000;
      const result = formatHistoryAsXml(messages, maxChars);
      expect(result.length).toBeLessThanOrEqual(maxChars);
    });
  });

  // ─── Content blocks ────────────────────────────────────────────────────────

  describe('content blocks', () => {
    it('should render text blocks', () => {
      const result = formatHistoryAsXml([userMsg('hello world')]);
      expect(result).toContain('<text>hello world</text>');
    });

    it('should render thinking blocks', () => {
      const blocks: ContentBlock[] = [{ type: 'thinking', text: 'let me think...' }];
      const result = formatHistoryAsXml([userMsg('q'), assistantMsg('', blocks)]);
      expect(result).toContain('<thinking>let me think...</thinking>');
    });

    it('should render tool_use blocks with escaped input', () => {
      const blocks: ContentBlock[] = [
        {
          type: 'tool_use',
          name: 'read_file',
          tool_use_id: 'call_123',
          input: { path: '/tmp/test.ts' },
        },
      ];
      const result = formatHistoryAsXml([userMsg('q'), assistantMsg('', blocks)]);
      expect(result).toContain('name="read_file"');
      expect(result).toContain('tool_use_id="call_123"');
      expect(result).toContain('/tmp/test.ts');
    });

    it('should render tool_result blocks with is_error flag', () => {
      const blocks: ContentBlock[] = [
        { type: 'tool_result', tool_use_id: 'call_123', output: 'file not found', is_error: true },
      ];
      const result = formatHistoryAsXml([userMsg('q', blocks)]);
      expect(result).toContain('tool_use_id="call_123"');
      expect(result).toContain('is_error="true"');
      expect(result).toContain('file not found');
    });

    it('should render tool_result blocks with isError alias', () => {
      const blocks: ContentBlock[] = [
        { type: 'tool_result', tool_use_id: 'call_456', output: 'error output', isError: true },
      ];
      const result = formatHistoryAsXml([userMsg('q', blocks)]);
      expect(result).toContain('is_error="true"');
    });

    it('should handle messages with no contentBlocks', () => {
      const msg: AgentMessage = { role: 'user', contentBlocks: undefined };
      const result = formatHistoryAsXml([msg]);
      expect(result).toContain('<exchange>');
      expect(result).toContain('<user_request_or_tool_results>');
    });

    it('should handle messages with empty contentBlocks array', () => {
      const msg: AgentMessage = { role: 'user', contentBlocks: [] };
      const result = formatHistoryAsXml([msg]);
      expect(result).toContain('<exchange>');
    });

    it('should render mixed content blocks in order', () => {
      const blocks: ContentBlock[] = [
        { type: 'thinking', text: 'thinking first' },
        { type: 'text', text: 'then text' },
        { type: 'tool_use', name: 'exec', tool_use_id: 'c1', input: { cmd: 'ls' } },
      ];
      const result = formatHistoryAsXml([userMsg('q'), assistantMsg('', blocks)]);
      const thinkIdx = result.indexOf('thinking first');
      const textIdx = result.indexOf('then text');
      const toolIdx = result.indexOf('exec');
      expect(thinkIdx).toBeLessThan(textIdx);
      expect(textIdx).toBeLessThan(toolIdx);
    });

    it('should skip unknown block types like image and audio', () => {
      const blocks: ContentBlock[] = [
        { type: 'image' as any, data: 'base64data' },
        { type: 'text', text: 'visible text' },
      ];
      const result = formatHistoryAsXml([userMsg('q', blocks)]);
      expect(result).not.toContain('base64data');
      expect(result).toContain('visible text');
    });

    it('should use content field as fallback when text field is missing', () => {
      const blocks: ContentBlock[] = [{ type: 'text', content: 'from content field' }];
      const result = formatHistoryAsXml([userMsg('q', blocks)]);
      expect(result).toContain('from content field');
    });

    it('should use toolName alias when name is missing', () => {
      const blocks: ContentBlock[] = [
        { type: 'tool_use', toolName: 'alt_tool', tool_use_id: 'c1', input: {} },
      ];
      const result = formatHistoryAsXml([userMsg('q'), assistantMsg('', blocks)]);
      expect(result).toContain('name="alt_tool"');
    });

    it('should escape thinking block content', () => {
      const blocks: ContentBlock[] = [{ type: 'thinking', text: 'if (x < 10 && y > 5) {}' }];
      const result = formatHistoryAsXml([userMsg('q'), assistantMsg('', blocks)]);
      expect(result).toContain('<thinking>if (x &lt; 10 &amp;&amp; y &gt; 5) {}</thinking>');
    });

    it('should escape tool_use input containing special chars', () => {
      const blocks: ContentBlock[] = [
        { type: 'tool_use', name: 'write', tool_use_id: 'c1', input: { content: '<div class="x">&' } },
      ];
      const result = formatHistoryAsXml([userMsg('q'), assistantMsg('', blocks)]);
      // The input gets JSON.stringified then XML-escaped
      expect(result).toContain('&lt;div');
      expect(result).toContain('&amp;');
    });
  });

  // ─── Edge cases ──────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should handle error message with no error property gracefully', () => {
      const msg = errorMsg(); // no error text
      const result = formatHistoryAsXml([userMsg('test'), msg]);
      expect(result).toContain('<error>');
      expect(result).toContain('</error>');
      // Should not crash
    });

    it('should show correct omission count when truncating', () => {
      const messages: AgentMessage[] = [];
      for (let i = 0; i < 10; i++) {
        messages.push(userMsg(`q${i} ${'x'.repeat(100)}`));
        messages.push(assistantMsg(`a${i} ${'y'.repeat(100)}`));
      }
      // Force heavy truncation
      const result = formatHistoryAsXml(messages, 800);
      const match = result.match(/<!-- (\d+) earlier exchanges omitted/);
      if (match) {
        const omittedCount = parseInt(match[1], 10);
        const includedCount = (result.match(/<exchange>/g) || []).length;
        // Total exchanges = 10, so omitted + included should = 10
        expect(omittedCount + includedCount).toBe(10);
      }
    });

    it('should handle assistant-only start followed by normal exchanges', () => {
      const result = formatHistoryAsXml([
        assistantMsg('orphan'),
        userMsg('q1'),
        assistantMsg('a1'),
      ]);
      const exchangeCount = (result.match(/<exchange>/g) || []).length;
      expect(exchangeCount).toBe(2);
      expect(result).toContain('<text>orphan</text>');
      expect(result).toContain('<text>q1</text>');
    });
  });
});
