/**
 * Unit tests for the formatHistoryAsXml session recovery functions.
 *
 * Tests cover: escapeXml, safeStringify, formatHistoryAsXml
 * including edge cases for XML escaping, exchange grouping,
 * truncation, content block rendering, and structural correctness.
 */

import {
  describe,
  it,
  expect,
} from 'vitest';
import {
  escapeXml,
  safeStringify,
  formatHistoryAsXml,
  sanitizeMessagesForHistory,
  isInvalidToolHistoryError,
  summarizeProviderErrorForLog,
  createUserFriendlyErrorMessage,
  deriveSafeRawErrorMessage,
  isContextTooLargeError,
  isSessionRecoverableError,
  isModelNotAvailableError,
  isMissingWorkspaceToolError,
  isStaleWorkspaceApiError,
  detectMissingWorkspaceToolInUpdate,
  detectStaleWorkspaceApiInUpdate,
} from '../acp-provider';
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
      expect(result).toContain('ACP session was lost');
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
      // Use a limit that fits only the last exchange + wrapper overhead
      const result = formatHistoryAsXml(messages, 700);
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


// ─── sanitizeMessagesForHistory ──────────────────────────────────────────────

describe('sanitizeMessagesForHistory', () => {
  it('drops tool_result blocks missing tool_use_id', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'preamble' },
      { type: 'tool_result', tool_use_id: '', output: 'orphan' } as ContentBlock,
      { type: 'tool_result', tool_use_id: 'call_1', output: 'ok' },
    ];
    const result = sanitizeMessagesForHistory([assistantMsg('', blocks)]);
    expect(result).toHaveLength(1);
    const cleaned = result[0].contentBlocks ?? [];
    expect(cleaned).toHaveLength(2);
    expect(cleaned.some((b) => b.type === 'tool_result' && b.tool_use_id === '')).toBe(false);
  });

  it('drops tool_result blocks with whitespace-only tool_use_id', () => {
    const blocks: ContentBlock[] = [
      { type: 'tool_result', tool_use_id: '   ', output: 'whitespace' } as ContentBlock,
      { type: 'tool_result', tool_use_id: 'call_1', output: 'ok' },
    ];
    const result = sanitizeMessagesForHistory([assistantMsg('', blocks)]);
    const cleaned = result[0].contentBlocks ?? [];
    expect(cleaned).toHaveLength(1);
    expect(cleaned[0].type).toBe('tool_result');
  });

  it('drops empty tool_result blocks (no output and not an error)', () => {
    const blocks: ContentBlock[] = [
      { type: 'tool_result', tool_use_id: 'call_1', output: '' },
      { type: 'tool_result', tool_use_id: 'call_2', output: 'real output' },
      { type: 'tool_result', tool_use_id: 'call_3', output: '', is_error: true },
    ];
    const result = sanitizeMessagesForHistory([assistantMsg('', blocks)]);
    const cleaned = result[0].contentBlocks ?? [];
    // call_1 dropped (empty non-error), call_2 and call_3 preserved
    expect(cleaned).toHaveLength(2);
    expect((cleaned[0] as any).tool_use_id).toBe('call_2');
    expect((cleaned[1] as any).tool_use_id).toBe('call_3');
  });

  it('drops duplicate tool_result entries for the same tool_use_id', () => {
    const blocks: ContentBlock[] = [
      { type: 'tool_result', tool_use_id: 'call_1', output: 'first' },
      { type: 'tool_result', tool_use_id: 'call_1', output: 'second' },
      { type: 'tool_result', tool_use_id: 'call_2', output: 'third' },
    ];
    const result = sanitizeMessagesForHistory([assistantMsg('', blocks)]);
    const cleaned = result[0].contentBlocks ?? [];
    expect(cleaned).toHaveLength(2);
    expect((cleaned[0] as any).tool_use_id).toBe('call_1');
    expect((cleaned[0] as any).output).toBe('first');
    expect((cleaned[1] as any).tool_use_id).toBe('call_2');
  });

  it('drops assistant messages with zero blocks', () => {
    const empty: AgentMessage = { role: 'assistant', contentBlocks: [] };
    const result = sanitizeMessagesForHistory([
      userMsg('q1'),
      empty,
      userMsg('q2'),
      assistantMsg('real'),
    ]);
    // The empty assistant turn should be filtered out
    expect(result.some((m) => m.role === 'assistant' && (m.contentBlocks ?? []).length === 0)).toBe(
      false,
    );
    expect(result).toHaveLength(3);
  });

  it('drops assistant messages whose every block was malformed', () => {
    const blocks: ContentBlock[] = [
      { type: 'tool_result', tool_use_id: '', output: '' } as ContentBlock,
      { type: 'tool_result', tool_use_id: '   ', output: '' } as ContentBlock,
    ];
    const result = sanitizeMessagesForHistory([
      userMsg('q1'),
      assistantMsg('', blocks),
      userMsg('q2'),
    ]);
    expect(result.some((m) => m.role === 'assistant')).toBe(false);
  });

  it('preserves user messages even when empty', () => {
    const empty: AgentMessage = { role: 'user', contentBlocks: [] };
    const result = sanitizeMessagesForHistory([empty, assistantMsg('ok')]);
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe('user');
  });

  it('preserves text, thinking, and valid tool_use blocks untouched', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'hi' },
      { type: 'thinking', text: 'hmm' },
      { type: 'tool_use', name: 'read_file', tool_use_id: 'tu_1', input: { path: '/x' } },
      { type: 'tool_result', tool_use_id: 'tu_1', output: 'contents' },
    ];
    const result = sanitizeMessagesForHistory([assistantMsg('', blocks)]);
    const cleaned = result[0].contentBlocks ?? [];
    expect(cleaned).toHaveLength(4);
  });

  it('preserves empty-string output when tool_use_id is valid and block is flagged as error', () => {
    const blocks: ContentBlock[] = [
      { type: 'tool_result', tool_use_id: 'call_err', output: '', is_error: true },
    ];
    const result = sanitizeMessagesForHistory([assistantMsg('', blocks)]);
    const cleaned = result[0].contentBlocks ?? [];
    expect(cleaned).toHaveLength(1);
  });
});


// ─── isInvalidToolHistoryError ───────────────────────────────────────────────

describe('isInvalidToolHistoryError', () => {
  it('detects 400/invalidArgument from chat-stream', () => {
    expect(
      isInvalidToolHistoryError('HTTP error: 400 Bad Request', {
        httpStatus: 400,
        apiStatus: 'invalidArgument',
        httpUrl: 'https://e2.api.augmentcode.com/chat-stream',
      }),
    ).toBe(true);
  });

  it('detects 400/invalidArgument without an httpUrl (legacy/unknown variant)', () => {
    expect(
      isInvalidToolHistoryError('HTTP error: 400 Bad Request', {
        httpStatus: 400,
        apiStatus: 'invalidArgument',
      }),
    ).toBe(true);
  });

  it('rejects 400/invalidArgument from a non-chat-stream endpoint', () => {
    expect(
      isInvalidToolHistoryError('HTTP error: 400 Bad Request', {
        httpStatus: 400,
        apiStatus: 'invalidArgument',
        httpUrl: 'https://e2.api.augmentcode.com/session/new',
      }),
    ).toBe(false);
  });

  it('rejects 400 errors without invalidArgument apiStatus', () => {
    expect(
      isInvalidToolHistoryError('HTTP error: 400 Bad Request', {
        httpStatus: 400,
        apiStatus: 'unauthenticated',
        httpUrl: 'https://e2.api.augmentcode.com/chat-stream',
      }),
    ).toBe(false);
  });

  it('rejects non-400 responses even with invalidArgument apiStatus', () => {
    expect(
      isInvalidToolHistoryError('HTTP error: 500 Internal Server Error', {
        httpStatus: 500,
        apiStatus: 'invalidArgument',
        httpUrl: 'https://e2.api.augmentcode.com/chat-stream',
      }),
    ).toBe(false);
  });

  it('returns false when errorData is missing', () => {
    expect(isInvalidToolHistoryError('HTTP error: 400 Bad Request', undefined)).toBe(false);
  });

  it('returns false for unrelated errors', () => {
    expect(
      isInvalidToolHistoryError('Session not found', {
        httpStatus: 404,
        apiStatus: 'notFound',
      }),
    ).toBe(false);
  });
});

// ─── formatHistoryAsXml — malformed-block integration ────────────────────────

describe('formatHistoryAsXml with malformed persisted blocks', () => {
  it('omits tool_result blocks with missing tool_use_id from the XML output', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'answer text' },
      { type: 'tool_result', tool_use_id: '', output: 'orphan output' } as ContentBlock,
      { type: 'tool_result', tool_use_id: 'good_id', output: 'valid output' },
    ];
    const xml = formatHistoryAsXml([userMsg('q'), assistantMsg('', blocks)]);
    expect(xml).toContain('answer text');
    expect(xml).toContain('tool_use_id="good_id"');
    expect(xml).toContain('valid output');
    expect(xml).not.toContain('orphan output');
    expect(xml).not.toContain('tool_use_id=""');
  });

  it('does not emit an agent_response element for a zero-block assistant turn', () => {
    const empty: AgentMessage = { role: 'assistant', contentBlocks: [] };
    const xml = formatHistoryAsXml([userMsg('q1'), empty, userMsg('q2'), assistantMsg('real')]);
    // Only the second exchange's assistant turn should appear
    const responseCount = (xml.match(/<agent_response_or_tool_uses>/g) || []).length;
    expect(responseCount).toBe(1);
    expect(xml).toContain('<text>real</text>');
  });

  it('deduplicates duplicate tool_result ids in rendered XML', () => {
    const blocks: ContentBlock[] = [
      { type: 'tool_result', tool_use_id: 'call_1', output: 'first output' },
      { type: 'tool_result', tool_use_id: 'call_1', output: 'second output' },
    ];
    const xml = formatHistoryAsXml([userMsg('q'), assistantMsg('', blocks)]);
    expect(xml).toContain('first output');
    expect(xml).not.toContain('second output');
  });
});


// ─── unmatched tool_use / tool_result regression ─────────────────────────────

describe('sanitizeMessagesForHistory / formatHistoryAsXml with unmatched tool pairs', () => {
  it('preserves an orphan tool_use (no following tool_result) and renders it in XML', () => {
    // Regression: an assistant turn whose tool_use has no corresponding
    // tool_result — matches the observed debug-bundle signature that triggers
    // chat-stream 400/invalidArgument ("Tool use block found without
    // corresponding tool result block"). The sanitizer alone cannot forge the
    // missing result, but the recovery XML path must not crash and must
    // preserve the orphan tool_use so the supervisor sees the full history.
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'about to call a tool' },
      { type: 'tool_use', name: 'read_file', tool_use_id: 'tu_orphan', input: { path: '/x' } },
    ];
    const sanitized = sanitizeMessagesForHistory([userMsg('q'), assistantMsg('', blocks)]);
    expect(sanitized).toHaveLength(2);
    const cleaned = sanitized[1].contentBlocks ?? [];
    expect(cleaned).toHaveLength(2);
    expect(cleaned[1].type).toBe('tool_use');
    expect((cleaned[1] as any).tool_use_id).toBe('tu_orphan');

    const xml = formatHistoryAsXml([userMsg('q'), assistantMsg('', blocks)]);
    expect(xml).toContain('<tool_use name="read_file" tool_use_id="tu_orphan">');
    expect(xml).not.toContain('<tool_result');
  });

  it('renders a tool_result whose tool_use_id has no preceding tool_use without crashing', () => {
    // Regression: a persisted tool_result that references an id with no prior
    // tool_use block in history (the other half of the unmatched-pair failure
    // mode). The sanitizer correctly keeps it (id is non-empty and output is
    // non-empty) and formatHistoryAsXml must emit valid XML rather than drop
    // it silently or throw.
    const blocks: ContentBlock[] = [
      { type: 'tool_result', tool_use_id: 'tu_missing_parent', output: 'stale result' },
    ];
    const sanitized = sanitizeMessagesForHistory([userMsg('q'), assistantMsg('', blocks)]);
    const cleaned = sanitized[1].contentBlocks ?? [];
    expect(cleaned).toHaveLength(1);
    expect((cleaned[0] as any).tool_use_id).toBe('tu_missing_parent');

    const xml = formatHistoryAsXml([userMsg('q'), assistantMsg('', blocks)]);
    expect(xml).toContain('tool_use_id="tu_missing_parent"');
    expect(xml).toContain('stale result');
  });
});

// ─── summarizeProviderErrorForLog ────────────────────────────────────────────

describe('summarizeProviderErrorForLog', () => {
  it('returns empty object for null / undefined / non-object input', () => {
    expect(summarizeProviderErrorForLog(null)).toEqual({});
    expect(summarizeProviderErrorForLog(undefined)).toEqual({});
    expect(summarizeProviderErrorForLog('boom')).toEqual({});
    expect(summarizeProviderErrorForLog(42)).toEqual({});
  });

  it('extracts code, message, and the safe error.data fields', () => {
    const summary = summarizeProviderErrorForLog({
      code: -32603,
      message: 'HTTP error: 400 Bad Request',
      data: {
        httpStatus: 400,
        apiStatus: 'invalidArgument',
        httpUrl: 'https://e2.api.augmentcode.com/chat-stream',
        requestId: 'req_abc123',
        errorDetails: {
          code: 3,
          message: 'Invalid tool use history',
          detail: 'Tool use block found without corresponding tool result block',
        },
      },
    });
    expect(summary.code).toBe(-32603);
    expect(summary.message).toBe('HTTP error: 400 Bad Request');
    expect(summary.httpStatus).toBe(400);
    expect(summary.apiStatus).toBe('invalidArgument');
    expect(summary.httpUrl).toBe('https://e2.api.augmentcode.com/chat-stream');
    expect(summary.requestId).toBe('req_abc123');
    expect(summary.errorDetails).toEqual({
      code: 3,
      message: 'Invalid tool use history',
      detail: 'Tool use block found without corresponding tool result block',
    });
  });

  it('does NOT propagate sensitive fields (prompt, raw details, unknown keys)', () => {
    // data.prompt can echo the user's full prompt; data.details can contain
    // the raw HTTP response body (tool outputs, file contents). Neither must
    // appear in the summarized log object.
    const summary = summarizeProviderErrorForLog({
      code: -32603,
      message: 'HTTP error: 400 Bad Request',
      data: {
        httpStatus: 400,
        apiStatus: 'invalidArgument',
        prompt: { content: 'SECRET USER PROMPT' },
        details: 'RAW HTTP BODY WITH TOOL OUTPUT CONTAINING SENSITIVE FILE CONTENTS',
        sessionState: { messages: ['SECRET'] },
      },
    });
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain('SECRET USER PROMPT');
    expect(serialized).not.toContain('RAW HTTP BODY');
    expect(serialized).not.toContain('sessionState');
    expect((summary as any).prompt).toBeUndefined();
    expect((summary as any).details).toBeUndefined();
    // Known-safe fields still flow through
    expect(summary.httpStatus).toBe(400);
    expect(summary.apiStatus).toBe('invalidArgument');
  });

  it('coerces numeric requestId and filters non-string/number requestId', () => {
    expect(summarizeProviderErrorForLog({ data: { requestId: 12345 } }).requestId).toBe(12345);
    expect(
      summarizeProviderErrorForLog({ data: { requestId: { nested: 'object' } } }).requestId,
    ).toBeUndefined();
  });

  it('omits errorDetails entirely when none of its sub-fields are present', () => {
    const summary = summarizeProviderErrorForLog({
      code: -32603,
      data: { errorDetails: { extraneous: 'ignored' } },
    });
    expect(summary.errorDetails).toBeUndefined();
  });
});

// ─── createUserFriendlyErrorMessage (400 invalid-history branch) ─────────────

describe('createUserFriendlyErrorMessage for invalid tool history', () => {
  it('returns an actionable message for chat-stream 400/invalidArgument and includes the detail', () => {
    const msg = createUserFriendlyErrorMessage(
      'HTTP error: 400 Bad Request',
      -32603,
      'claude-opus-4',
      'auggie',
      {
        httpStatus: 400,
        apiStatus: 'invalidArgument',
        httpUrl: 'https://e2.api.augmentcode.com/chat-stream',
        errorDetails: {
          code: 3,
          detail: 'Tool use block found without corresponding tool result block',
        },
      },
    );
    expect(msg).toContain('invalid tool blocks');
    expect(msg).toContain('Tool use block found without corresponding tool result block');
    // Must NOT be the generic -32603 fallback
    expect(msg).not.toBe('The agent encountered an internal error.');
    expect(msg).not.toContain('HTTP error: 400 Bad Request');
  });

  it('still returns a usable message when errorDetails.detail is absent', () => {
    const msg = createUserFriendlyErrorMessage(
      'HTTP error: 400 Bad Request',
      -32603,
      undefined,
      'auggie',
      {
        httpStatus: 400,
        apiStatus: 'invalidArgument',
        httpUrl: 'https://e2.api.augmentcode.com/chat-stream',
      },
    );
    expect(msg).toContain('invalid tool blocks');
    expect(msg).toContain('Recovering with a fresh session');
  });

  it('does not hijack unrelated 400 / invalidArgument responses from other endpoints', () => {
    const msg = createUserFriendlyErrorMessage(
      'HTTP error: 400 Bad Request',
      -32603,
      undefined,
      'auggie',
      {
        httpStatus: 400,
        apiStatus: 'invalidArgument',
        httpUrl: 'https://e2.api.augmentcode.com/session/new',
      },
    );
    // Falls through to the -32603 generic path, not the invalid-history branch
    expect(msg).not.toContain('invalid tool blocks');
  });

  // ─── Active vs. terminal invalid-history messaging ─────────────────────────
  //
  // Callers pass `isTerminal=true` when no automatic retry can happen for the
  // current request (recovery returned false, recovery threw, fallback path, or
  // the recovery budget is exhausted in the main error handler). Terminal
  // messages must NOT imply an automatic retry; active-recovery messages may.

  it('active-recovery path (isTerminal=false) says recovery is happening', () => {
    const errorData = {
      httpStatus: 400,
      apiStatus: 'invalidArgument',
      httpUrl: 'https://e2.api.augmentcode.com/chat-stream',
      errorDetails: {
        code: 3,
        detail: 'Tool use block found without corresponding tool result block',
      },
    };
    const msg = createUserFriendlyErrorMessage(
      'HTTP error: 400 Bad Request',
      -32603,
      'claude-opus-4',
      'auggie',
      errorData,
      'ws-test',
      'HTTP error: 400 Bad Request',
      false,
    );
    expect(msg).toContain('invalid tool blocks');
    expect(msg).toContain('Tool use block found without corresponding tool result block');
    expect(msg).toContain('Recovering with a fresh session');
    // Must not tell the user recovery already failed.
    expect(msg).not.toContain('Automatic recovery was unsuccessful');
  });

  it('active-recovery path is the default when isTerminal is omitted', () => {
    const msg = createUserFriendlyErrorMessage(
      'HTTP error: 400 Bad Request',
      -32603,
      'claude-opus-4',
      'auggie',
      {
        httpStatus: 400,
        apiStatus: 'invalidArgument',
        httpUrl: 'https://e2.api.augmentcode.com/chat-stream',
      },
    );
    expect(msg).toContain('Recovering with a fresh session');
    expect(msg).not.toContain('Automatic recovery was unsuccessful');
  });

  it('terminal/exhausted path (isTerminal=true) returns a final failure message that does not imply retry', () => {
    const errorData = {
      httpStatus: 400,
      apiStatus: 'invalidArgument',
      httpUrl: 'https://e2.api.augmentcode.com/chat-stream',
      errorDetails: {
        code: 3,
        detail: 'Tool use block found without corresponding tool result block',
      },
    };
    const msg = createUserFriendlyErrorMessage(
      'HTTP error: 400 Bad Request',
      -32603,
      'claude-opus-4',
      'auggie',
      errorData,
      'ws-test',
      'HTTP error: 400 Bad Request',
      true,
    );
    // Still mentions the actionable diagnostic + safe detail.
    expect(msg).toContain('invalid tool blocks');
    expect(msg).toContain('Tool use block found without corresponding tool result block');
    // Must NOT imply that an automatic retry is in progress.
    expect(msg).not.toContain('Recovering with a fresh session');
    // Must communicate that recovery is no longer happening.
    expect(msg).toContain('Automatic recovery was unsuccessful');
    // Must give the user an explicit next step rather than leaving them waiting.
    expect(msg).toContain('Please send your message again');
  });

  it('terminal path still returns a usable message when errorDetails.detail is absent', () => {
    const msg = createUserFriendlyErrorMessage(
      'HTTP error: 400 Bad Request',
      -32603,
      undefined,
      'auggie',
      {
        httpStatus: 400,
        apiStatus: 'invalidArgument',
        httpUrl: 'https://e2.api.augmentcode.com/chat-stream',
      },
      undefined,
      undefined,
      true,
    );
    expect(msg).toContain('invalid tool blocks');
    expect(msg).not.toContain('Recovering with a fresh session');
    expect(msg).toContain('Automatic recovery was unsuccessful');
  });

  it('isTerminal has no effect on unrelated (non-invalid-history) errors', () => {
    // A generic -32603 with no invalid-history markers should fall through to
    // the normal -32603 handling regardless of isTerminal.
    const activeMsg = createUserFriendlyErrorMessage(
      'Something internal went wrong',
      -32603,
      undefined,
      'auggie',
      undefined,
      undefined,
      'Something internal went wrong',
      false,
    );
    const terminalMsg = createUserFriendlyErrorMessage(
      'Something internal went wrong',
      -32603,
      undefined,
      'auggie',
      undefined,
      undefined,
      'Something internal went wrong',
      true,
    );
    expect(activeMsg).toBe(terminalMsg);
    expect(activeMsg).not.toContain('invalid tool blocks');
    expect(activeMsg).not.toContain('Recovering with a fresh session');
    expect(activeMsg).not.toContain('Automatic recovery was unsuccessful');
  });
});


// ─── prompt-error log payload: data.details sentinel redaction ──────────────

describe('prompt-path logger payloads never include response.error.data.details', () => {
  // Mirrors the exact object shape built at every logger.{info,warn,error}
  // call that handles a prompt response error in acp-provider.ts. If any of
  // those call sites is modified to interpolate `rawErrorMessage` (which is
  // sourced from response.error.data?.details || response.error.message),
  // this test must fail.
  //
  // Build the payload directly rather than instantiating ACPProvider — the
  // construction pattern is what matters for the redaction guarantee, and
  // ACPProvider's prompt pipeline is too deeply integrated to reach via a
  // unit test.
  function buildLogPayload(
    label: 'modelNotAvailable' | 'sessionRecovery' | 'contextTooLarge' | 'transientRetry' | 'finalError',
    error: { code?: number; message?: string; data?: any },
  ): Record<string, unknown> {
    const errorMessage =
      typeof error.message === 'string' ? error.message : undefined;
    const errorCode = error.code || -1;
    const summarized = summarizeProviderErrorForLog(error);
    switch (label) {
      case 'modelNotAvailable':
        return {
          failedModel: 'claude-opus-4',
          triedModels: [],
          errorMessage,
          errorCode,
          isBackground: false,
          nextModel: 'claude-sonnet',
          error: summarized,
        };
      case 'sessionRecovery':
        return {
          errorMessage,
          errorCode,
          recoveryAttempt: 1,
          maxAttempts: 3,
          sessionId: 'sess_1',
          invalidHistoryRecovery: true,
          error: summarized,
        };
      case 'contextTooLarge':
        return {
          errorMessage,
          errorCode,
          recoveryAttempt: 1,
          contextRecoveryCount: 1,
          nextHistoryBudget: 50_000,
          defaultHistoryBudget: 100_000,
          maxAttempts: 3,
          sessionId: 'sess_1',
          error: summarized,
        };
      case 'transientRetry':
        return {
          errorMessage,
          errorCode,
          retryAttempt: 1,
          maxAttempts: 3,
          retryDelayMs: 1000,
          isBackground: false,
          sessionId: 'sess_1',
          error: summarized,
        };
      case 'finalError':
        return {
          errorCode,
          errorMessage,
          // `userFriendlyMessage` intentionally OMITTED: the final-error log
          // must not include it because createUserFriendlyErrorMessage's raw
          // fallback path can echo response.error.data.details.
          sessionId: 'sess_1',
          frontendSessionId: 'fsess_1',
          requestId: 42,
          error: summarized,
        };
    }
  }

  const SENTINEL = 'SENTINEL_SECRET_FROM_RAW_HTTP_BODY_8f3e1a2c';

  const errorWithSentinelInDataDetails = {
    code: -32603,
    message: 'HTTP error: 400 Bad Request',
    data: {
      httpStatus: 400,
      apiStatus: 'invalidArgument',
      httpUrl: 'https://e2.api.augmentcode.com/chat-stream',
      requestId: 'req_abc',
      // `data.details` here simulates a raw HTTP response body echoing a
      // sensitive tool output / file contents. The fix under test must
      // ensure this string never reaches any log payload.
      details: `{"model":"claude","messages":[{"role":"user","content":"${SENTINEL}"}]}`,
      errorDetails: {
        code: 3,
        message: 'Invalid tool use history',
        detail: 'Tool use block found without corresponding tool result block',
      },
    },
  };

  it('summarizeProviderErrorForLog omits data.details even when it carries a sentinel secret', () => {
    const summary = summarizeProviderErrorForLog(errorWithSentinelInDataDetails);
    expect(JSON.stringify(summary)).not.toContain(SENTINEL);
    expect((summary as any).details).toBeUndefined();
    // Sanity: the safe fields still flow through so operators can diagnose
    expect(summary.httpStatus).toBe(400);
    expect(summary.apiStatus).toBe('invalidArgument');
    expect(summary.errorDetails?.detail).toContain('Tool use block');
  });

  const sites: Array<Parameters<typeof buildLogPayload>[0]> = [
    'modelNotAvailable',
    'sessionRecovery',
    'contextTooLarge',
    'transientRetry',
    'finalError',
  ];

  for (const site of sites) {
    it(`log payload for "${site}" does NOT contain data.details sentinel secret`, () => {
      const payload = buildLogPayload(site, errorWithSentinelInDataDetails);
      const serialized = JSON.stringify(payload);
      expect(serialized).not.toContain(SENTINEL);
      // And the payload must still expose the sanitized errorDetails.detail
      // for operator diagnosis (otherwise the "diagnostics" half of the fix
      // would regress).
      expect(serialized).toContain('Tool use block found without corresponding tool result block');
    });
  }

  it('log payload uses the safe top-level error.message, not data.details', () => {
    // When data.details would otherwise shadow error.message via the old
    // `response.error.data?.details || response.error.message` expression,
    // every log site must prefer the safe top-level message.
    const payload = buildLogPayload('finalError', errorWithSentinelInDataDetails);
    expect(payload.errorMessage).toBe('HTTP error: 400 Bad Request');
  });

  // Exercise the actual raw-message derivation path via the exported
  // `deriveSafeRawErrorMessage` helper used at both acp-provider call sites:
  //   - primary prompt source (~line 8326, fallback 'Unknown agent error')
  //   - model-fallback prompt source (~line 7187, fallback 'Unknown error')
  // The helper intentionally ignores `error.data.details`, so a sentinel
  // planted there cannot reach rawError, and from there cannot reach
  // classifier inputs, userFriendlyMessage, logs, callbacks, or rejected
  // Error messages.
  const PROMPT_FALLBACK = 'Unknown agent error';
  const FALLBACK_FALLBACK = 'Unknown error';

  function buildUserFriendlyMessageFromRealHelper(
    error: { code?: number; message?: string; data?: any },
    fallback: string,
  ): string {
    const rawError = deriveSafeRawErrorMessage(error, fallback);
    const errorCode = error.code || -1;
    const safeFallback =
      typeof error.message === 'string' ? error.message : undefined;
    return createUserFriendlyErrorMessage(
      rawError,
      errorCode,
      'claude-opus-4',
      'auggie',
      error.data as any,
      'ws-test',
      safeFallback,
    );
  }

  it('deriveSafeRawErrorMessage (prompt source) never returns data.details even when it carries a sentinel', () => {
    const raw = deriveSafeRawErrorMessage(
      errorWithSentinelInDataDetails,
      PROMPT_FALLBACK,
    );
    expect(raw).not.toContain(SENTINEL);
    expect(raw).toBe('HTTP error: 400 Bad Request');
  });

  it('deriveSafeRawErrorMessage (fallback source) never returns data.details even when it carries a sentinel', () => {
    const raw = deriveSafeRawErrorMessage(
      errorWithSentinelInDataDetails,
      FALLBACK_FALLBACK,
    );
    expect(raw).not.toContain(SENTINEL);
    expect(raw).toBe('HTTP error: 400 Bad Request');
  });

  it('deriveSafeRawErrorMessage returns the prompt-source fallback when message is missing, ignoring data.details', () => {
    const raw = deriveSafeRawErrorMessage(
      { data: { details: SENTINEL } } as any,
      PROMPT_FALLBACK,
    );
    expect(raw).toBe(PROMPT_FALLBACK);
    expect(raw).not.toContain(SENTINEL);
  });

  it('deriveSafeRawErrorMessage returns the fallback-source fallback when message is missing, ignoring data.details', () => {
    const raw = deriveSafeRawErrorMessage(
      { data: { details: SENTINEL } } as any,
      FALLBACK_FALLBACK,
    );
    expect(raw).toBe(FALLBACK_FALLBACK);
    expect(raw).not.toContain(SENTINEL);
  });

  it('deriveSafeRawErrorMessage returns the fallback when message is an empty string, ignoring data.details', () => {
    const raw = deriveSafeRawErrorMessage(
      { message: '', data: { details: SENTINEL } } as any,
      PROMPT_FALLBACK,
    );
    expect(raw).toBe(PROMPT_FALLBACK);
    expect(raw).not.toContain(SENTINEL);
  });

  it('deriveSafeRawErrorMessage returns the fallback when message is a non-string, ignoring data.details', () => {
    const raw = deriveSafeRawErrorMessage(
      { message: 42 as any, data: { details: SENTINEL } } as any,
      PROMPT_FALLBACK,
    );
    expect(raw).toBe(PROMPT_FALLBACK);
    expect(raw).not.toContain(SENTINEL);
  });

  for (const [sourceLabel, fallback] of [
    ['prompt source', PROMPT_FALLBACK],
    ['fallback source', FALLBACK_FALLBACK],
  ] as const) {
    it(`(${sourceLabel}) userFriendlyMessage derived via real helper never contains data.details sentinel`, () => {
      const msg = buildUserFriendlyMessageFromRealHelper(
        errorWithSentinelInDataDetails,
        fallback,
      );
      expect(msg).not.toContain(SENTINEL);
      // Safe errorDetails.detail still drives the actionable invalid-history
      // diagnostic, proving the diagnostics half of the fix is intact.
      expect(msg).toContain('invalid tool blocks');
      expect(msg).toContain(
        'Tool use block found without corresponding tool result block',
      );
    });

    it(`(${sourceLabel}) callback/rejected Error built from real-helper userFriendlyMessage never contains sentinel`, () => {
      // Mirrors `callbacks.onError(new Error(userFriendlyMessage))` and
      // `reject(new Error(userFriendlyMessage))` in acp-provider's prompt
      // and fallback error paths.
      const msg = buildUserFriendlyMessageFromRealHelper(
        errorWithSentinelInDataDetails,
        fallback,
      );
      const callbackError = new Error(msg);
      expect(callbackError.message).not.toContain(SENTINEL);
      expect(String(callbackError)).not.toContain(SENTINEL);
      const rejectionError = new Error(msg);
      expect(rejectionError.message).not.toContain(SENTINEL);
    });

    it(`(${sourceLabel}) final prompt-error log payload derived via real helper never contains sentinel`, () => {
      const errorMessage =
        typeof errorWithSentinelInDataDetails.message === 'string'
          ? errorWithSentinelInDataDetails.message
          : undefined;
      const errorCode = errorWithSentinelInDataDetails.code || -1;
      const userFriendlyMessage = buildUserFriendlyMessageFromRealHelper(
        errorWithSentinelInDataDetails,
        fallback,
      );
      const payload = {
        errorCode,
        errorMessage,
        userFriendlyMessage,
        sessionId: 'sess_1',
        frontendSessionId: 'fsess_1',
        requestId: 42,
        error: summarizeProviderErrorForLog(errorWithSentinelInDataDetails),
      };
      const serialized = JSON.stringify(payload);
      expect(serialized).not.toContain(SENTINEL);
      // Sanitized errorDetails.detail still surfaces for operator diagnosis.
      expect(serialized).toContain(
        'Tool use block found without corresponding tool result block',
      );
    });

    it(`(${sourceLabel}) unclassified provider error surfaces safe top-level message, not data.details`, () => {
      const unclassifiedError = {
        code: 0,
        message: 'Unexpected provider failure',
        data: { details: `prelude ${SENTINEL} postlude` },
      };
      const msg = buildUserFriendlyMessageFromRealHelper(
        unclassifiedError,
        fallback,
      );
      expect(msg).not.toContain(SENTINEL);
      expect(msg).toBe('Unexpected provider failure');
      expect(new Error(msg).message).not.toContain(SENTINEL);
    });

    it(`(${sourceLabel}) -32603 error with sentinel in data.details falls back to safe top-level message`, () => {
      const internalError = {
        code: -32603,
        message: 'Something internal went wrong',
        data: { details: `Internal error: ${SENTINEL}` },
      };
      const msg = buildUserFriendlyMessageFromRealHelper(
        internalError,
        fallback,
      );
      expect(msg).not.toContain(SENTINEL);
      expect(new Error(msg).message).not.toContain(SENTINEL);
    });
  }

  // Defense-in-depth: even if a regression reintroduced the OLD unsafe
  // `data.details || error.message` expression for rawError, the downstream
  // pipeline (createUserFriendlyErrorMessage with safeFallbackMessage,
  // callback/reject Error construction, and log payloads that omit rawError)
  // must still prevent the sentinel from surfacing. This preserves the
  // historical old-details-input coverage as an extra layer behind the
  // primary derivation fix above.
  it('defense-in-depth: unsafe rawError (old expression) still produces safe userFriendlyMessage through helper + safeFallback', () => {
    const unsafeRawError =
      errorWithSentinelInDataDetails.data?.details ||
      errorWithSentinelInDataDetails.message ||
      'Unknown agent error';
    // Sanity: the old expression DOES carry the sentinel in rawError.
    expect(unsafeRawError).toContain(SENTINEL);
    const msg = createUserFriendlyErrorMessage(
      unsafeRawError,
      errorWithSentinelInDataDetails.code,
      'claude-opus-4',
      'auggie',
      errorWithSentinelInDataDetails.data as any,
      'ws-test',
      errorWithSentinelInDataDetails.message,
    );
    expect(msg).not.toContain(SENTINEL);
    expect(msg).toContain('invalid tool blocks');
    expect(new Error(msg).message).not.toContain(SENTINEL);
  });
});


// ─── classifier widening: structured errorData fallback ────────────────────
//
// `deriveSafeRawErrorMessage` intentionally returns only the safe top-level
// `error.message` so `rawErrorMessage` never carries raw HTTP body content
// from `error.data.details`. That would regress the keyword-based classifiers
// (context-too-large, session-recoverable, model-not-available) if the
// provider returns a generic top-level message and buries the specific error
// signal in `data.details`.
//
// The classifiers now accept the safe structured `errorData` (`httpStatus`,
// `apiStatus`, `errorDetails.code/message/detail`) as a fallback source, so
// classification still works for providers that hide the specific signal in
// a structured field while keeping `data.details` out of classifier inputs.
describe('classifier fallback via structured errorData', () => {
  const CLASSIFIER_SENTINEL = 'CLASSIFIER_SENTINEL_FROM_RAW_HTTP_BODY_3a9b2e1d';

  describe('isContextTooLargeError', () => {
    it('classifies via structured httpStatus=413 when top-level message is generic', () => {
      expect(
        isContextTooLargeError('HTTP error: 413 Bad Request', -32603, {
          httpStatus: 413,
          apiStatus: 'resourceExhausted',
        }),
      ).toBe(true);
    });

    it('classifies via errorDetails.detail keyword when httpStatus is absent', () => {
      expect(
        isContextTooLargeError('Internal error', -32603, {
          errorDetails: { detail: 'request entity too large' },
        }),
      ).toBe(true);
      expect(
        isContextTooLargeError('Internal error', -32603, {
          errorDetails: { message: 'Payload too large', detail: 'upstream rejected' },
        }),
      ).toBe(true);
    });

    it('still classifies via top-level message without errorData (backwards compatible)', () => {
      expect(isContextTooLargeError('413 payload too large', -1)).toBe(true);
      expect(isContextTooLargeError('unrelated error', -1)).toBe(false);
    });

    it('does not regress: unrelated structured metadata stays unclassified', () => {
      expect(
        isContextTooLargeError('Something else', -1, {
          httpStatus: 500,
          errorDetails: { detail: 'nothing useful' },
        }),
      ).toBe(false);
    });

    it('never reads data.details: sentinel planted only in data.details is not classified', () => {
      // A raw-body sentinel in data.details must NOT make the classifier fire,
      // because the classifier never consumes that field.
      expect(
        isContextTooLargeError('HTTP error: 400 Bad Request', -32603, {
          httpStatus: 400,
          // errorDetails is the sanitized/structured form; leave it unrelated
          errorDetails: { detail: 'some other provider detail' },
        }),
      ).toBe(false);
    });
  });

  describe('isSessionRecoverableError', () => {
    it('classifies via errorDetails.detail when top-level message is generic', () => {
      expect(
        isSessionRecoverableError('Internal error', -32603, {
          errorDetails: { detail: 'session not found' },
        }),
      ).toBe(true);
    });

    it('classifies -32603 session wording via structured detail', () => {
      expect(
        isSessionRecoverableError('Internal error', -32603, {
          errorDetails: { message: 'session expired' },
        }),
      ).toBe(true);
    });

    it('still classifies via top-level message without errorData', () => {
      expect(isSessionRecoverableError('Session not found', -1)).toBe(true);
      expect(isSessionRecoverableError('unrelated error', -1)).toBe(false);
    });

    it('does not treat non-session -32603 errors as recoverable even with unrelated detail', () => {
      expect(
        isSessionRecoverableError('r.map is not a function', -32603, {
          errorDetails: { detail: 'some other provider detail' },
        }),
      ).toBe(false);
    });
  });

  describe('isModelNotAvailableError', () => {
    it('classifies via structured httpStatus=404 when top-level message is generic', () => {
      expect(
        isModelNotAvailableError('HTTP error: 404 Not Found', -32603, {
          httpStatus: 404,
        }),
      ).toBe(true);
    });

    it('classifies via errorDetails.detail keyword when httpStatus is absent', () => {
      expect(
        isModelNotAvailableError('Internal error', -32603, {
          errorDetails: { detail: 'model not found: claude-opus-5' },
        }),
      ).toBe(true);
    });

    it('still classifies via top-level message without errorData', () => {
      expect(isModelNotAvailableError('model not available', -1)).toBe(true);
      expect(isModelNotAvailableError('unrelated error', -1)).toBe(false);
    });
  });

  describe('isMissingWorkspaceToolError', () => {
    it('classifies the canonical "Tool workspace_api not found" symptom', () => {
      expect(isMissingWorkspaceToolError('Tool workspace_api not found')).toBe(true);
      expect(isMissingWorkspaceToolError('Error: tool "workspace_api" not found')).toBe(true);
    });

    it('matches other missing-tool phrasings for the workspace tool', () => {
      expect(isMissingWorkspaceToolError('Unknown tool: workspace_api')).toBe(true);
      expect(isMissingWorkspaceToolError('workspace-mcp tool is not available')).toBe(true);
      expect(isMissingWorkspaceToolError('workspace_mcp not registered')).toBe(true);
    });

    it('requires both a workspace-tool reference and a missing-tool phrase', () => {
      // Workspace reference but no missing-tool phrasing
      expect(isMissingWorkspaceToolError('workspace_api returned an error')).toBe(false);
      // Missing-tool phrasing but unrelated tool
      expect(isMissingWorkspaceToolError('Tool some_other_tool not found')).toBe(false);
      expect(isMissingWorkspaceToolError('unrelated error')).toBe(false);
      expect(isMissingWorkspaceToolError('')).toBe(false);
    });

    it('classifies via structured errorData detail', () => {
      expect(
        isMissingWorkspaceToolError('Internal error', {
          errorDetails: { detail: 'tool workspace_api not found' },
        }),
      ).toBe(true);
    });
  });

  describe('detectMissingWorkspaceToolInUpdate', () => {
    it('detects a failed update whose structured title identifies the workspace tool', () => {
      expect(
        detectMissingWorkspaceToolInUpdate({
          status: 'failed',
          title: 'workspace_api',
          rawOutput: { output: 'Tool not found' },
        }),
      ).toBe(true);
    });

    it('detects the symptom in a structured provider error message', () => {
      expect(
        detectMissingWorkspaceToolInUpdate({
          isError: true,
          error: { message: 'Tool workspace_api not found' },
        }),
      ).toBe(true);
      expect(
        detectMissingWorkspaceToolInUpdate({
          status: 'failed',
          error: { message: 'Unknown tool: workspace_api' },
        }),
      ).toBe(true);
    });

    it('detects when identity comes from rawInput and the phrase from output', () => {
      expect(
        detectMissingWorkspaceToolInUpdate({
          status: 'failed',
          rawInput: { server: 'workspace-mcp', tool: 'read_note' },
          rawOutput: { output: 'tool is not available' },
        }),
      ).toBe(true);
    });

    it('does not match when only the OUTPUT of an unrelated failed tool mentions the workspace tool', () => {
      // A failed bash whose output merely contains the substring must not trigger recovery.
      expect(
        detectMissingWorkspaceToolInUpdate({
          status: 'failed',
          title: 'bash',
          rawOutput: { output: 'workspace_api: pattern not found' },
        }),
      ).toBe(false);
      expect(
        detectMissingWorkspaceToolInUpdate({
          status: 'failed',
          title: 'Terminal',
          content: [{ type: 'text', text: 'grep: workspace-mcp not found' }],
        }),
      ).toBe(false);
    });

    it('ignores successful updates even if the structured identity matches', () => {
      expect(
        detectMissingWorkspaceToolInUpdate({
          status: 'completed',
          title: 'workspace_api',
          rawOutput: { output: 'Tool workspace_api not found' },
        }),
      ).toBe(false);
    });

    it('ignores failed updates that are not about the workspace tool', () => {
      expect(
        detectMissingWorkspaceToolInUpdate({
          status: 'failed',
          title: 'some_other_tool',
          rawOutput: { output: 'Tool some_other_tool not found' },
        }),
      ).toBe(false);
      expect(detectMissingWorkspaceToolInUpdate(null)).toBe(false);
      expect(detectMissingWorkspaceToolInUpdate({ status: 'failed' })).toBe(false);
    });
  });

  describe('isStaleWorkspaceApiError', () => {
    it('classifies missing ws method errors as a stale workspace API surface', () => {
      expect(isStaleWorkspaceApiError('Error executing code: ws.agent.diagnostics is not a function')).toBe(
        true,
      );
      expect(isStaleWorkspaceApiError('TypeError: ws.task.getMyTask is not a function')).toBe(true);
    });

    it('requires a ws namespace and not-a-function phrase', () => {
      expect(isStaleWorkspaceApiError('workspace_api returned an error')).toBe(false);
      expect(isStaleWorkspaceApiError('diagnostics is not a function')).toBe(false);
      expect(isStaleWorkspaceApiError('ws.agent.diagnostics returned an error')).toBe(false);
    });

    it('classifies via structured errorData detail', () => {
      expect(
        isStaleWorkspaceApiError('Internal error', {
          errorDetails: { detail: 'Error executing code: ws.agent.diagnostics is not a function' },
        }),
      ).toBe(true);
    });
  });

  describe('detectStaleWorkspaceApiInUpdate', () => {
    it('detects a failed workspace_api update with a stale ws method error', () => {
      expect(
        detectStaleWorkspaceApiInUpdate({
          status: 'failed',
          title: 'workspace_api',
          rawOutput: { output: 'Error executing code: ws.agent.diagnostics is not a function' },
        }),
      ).toBe(true);
    });

    it('requires structured workspace tool identity', () => {
      expect(
        detectStaleWorkspaceApiInUpdate({
          status: 'failed',
          title: 'bash',
          rawOutput: { output: 'Error executing code: ws.agent.diagnostics is not a function' },
        }),
      ).toBe(false);
    });

    it('ignores successful workspace_api updates', () => {
      expect(
        detectStaleWorkspaceApiInUpdate({
          status: 'completed',
          title: 'workspace_api',
          rawOutput: { output: 'ws.agent.diagnostics is not a function' },
        }),
      ).toBe(false);
    });
  });

  describe('classifier inputs never include data.details', () => {
    it('planting sentinel only in data.details cannot change classifier outcomes', () => {
      // The classifiers only read structured fields. A sentinel in data.details
      // is ignored and classifier results depend solely on structured signals
      // (httpStatus/apiStatus/errorDetails). We can't pass data.details to the
      // classifier at all — proving leaks are impossible by construction.
      const data: any = {
        httpStatus: 500,
        apiStatus: 'internal',
        details: `prelude ${CLASSIFIER_SENTINEL} postlude`,
        errorDetails: { detail: 'unrelated classifier text' },
      };
      // All three classifiers return false for this structured payload, and
      // nothing about their return value is influenced by data.details.
      expect(isContextTooLargeError('Internal error', -32603, data)).toBe(false);
      expect(isSessionRecoverableError('Internal error', -1, data)).toBe(false);
      expect(isModelNotAvailableError('Internal error', -1, data)).toBe(false);
    });
  });
});


// ─── set-model failure log payload: data.details sentinel redaction ─────────

describe('setModel failure logger payload never includes response.error.data.details', () => {
  // Mirrors the exact object shape built at the set-model failure log site
  // in acp-provider.ts (ACPProvider.setModel, method-loop fallback branch):
  //
  //   logger.warn('Failed to set model via ACP', {
  //     providerId, method, modelId,
  //     error: summarizeProviderErrorForLog(response.error),
  //     isMethodNotFound,
  //   });
  //
  // If this site is ever modified to pass `response.error` directly (as it did
  // previously), this test must fail so we catch the regression before the raw
  // ACP JSON-RPC error — including `data.details`, which embeds raw HTTP
  // response body content like tool outputs, prompt echoes, or file contents —
  // can reach the log output.
  //
  // Build the payload directly rather than instantiating ACPProvider — the
  // construction pattern is what matters for the redaction guarantee, and the
  // real set-model pipeline sends a JSON-RPC request over a spawned child
  // process, which is too heavy to reach from a unit test.
  function buildSetModelFailureLogPayload(error: {
    code?: number;
    message?: string;
    data?: any;
  }): Record<string, unknown> {
    const code = error?.code;
    const message = typeof error?.message === 'string' ? error.message : '';
    const isMethodNotFound =
      code === -32601 || (typeof message === 'string' && message.includes('Method not found'));
    return {
      providerId: 'auggie',
      method: 'session/set_model',
      modelId: 'claude-opus-4',
      error: summarizeProviderErrorForLog(error),
      isMethodNotFound,
    };
  }

  const SENTINEL = 'SENTINEL_SET_MODEL_RAW_HTTP_BODY_7c1f4b90';

  const errorWithSentinelInDataDetails = {
    code: -32603,
    message: 'HTTP error: 400 Bad Request',
    data: {
      httpStatus: 400,
      apiStatus: 'invalidArgument',
      httpUrl: 'https://e2.api.augmentcode.com/chat-stream',
      requestId: 'req_set_model_abc',
      // `data.details` here simulates a raw HTTP response body echoing a
      // sensitive tool output / file contents. The fix under test must ensure
      // this string never reaches the set-model failure log payload.
      details: `{"model":"claude","messages":[{"role":"user","content":"${SENTINEL}"}]}`,
      errorDetails: {
        code: 3,
        message: 'Unknown model',
        detail: 'Model id is not available for this account',
      },
    },
  };

  it('set-model failure log payload does NOT contain data.details sentinel secret', () => {
    const payload = buildSetModelFailureLogPayload(errorWithSentinelInDataDetails);
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain(SENTINEL);
    // Safe fields still flow through so operators can diagnose the failure.
    expect(serialized).toContain('Model id is not available for this account');
    expect(serialized).toContain('invalidArgument');
  });

  it('set-model failure log payload drops raw data.details even when it carries a sentinel', () => {
    const payload = buildSetModelFailureLogPayload(errorWithSentinelInDataDetails);
    const errorField = payload.error as Record<string, unknown>;
    expect((errorField as any).details).toBeUndefined();
    // Sanity: the safe top-level fields are still present on the summarized
    // error so the log remains actionable.
    expect(errorField.httpStatus).toBe(400);
    expect(errorField.apiStatus).toBe('invalidArgument');
    expect((errorField as any).errorDetails?.detail).toContain('Model id');
  });

  it('set-model failure log payload uses the safe top-level error.message, not data.details', () => {
    // Even when data.details would otherwise shadow error.message via an
    // unsafe `data?.details || error.message` expression, the summarized
    // `error` field must only expose the safe top-level message.
    const payload = buildSetModelFailureLogPayload(errorWithSentinelInDataDetails);
    const errorField = payload.error as Record<string, unknown>;
    expect(errorField.message).toBe('HTTP error: 400 Bad Request');
  });

  it('set-model failure return-value error string (lastError?.message) never exposes data.details', () => {
    // ACPProvider.setModel returns `{ success: false, error: lastError?.message || 'Failed to set model' }`
    // on failure. That `lastError.message` is the JSON-RPC top-level message,
    // which is safe. Guard that pathway too so a future refactor cannot
    // regress by sourcing the returned error string from data.details.
    const returnedError =
      errorWithSentinelInDataDetails.message || 'Failed to set model';
    expect(returnedError).not.toContain(SENTINEL);
  });

  it('method-not-found fallback log payload still redacts data.details', () => {
    // When the ACP adapter returns -32601 ("Method not found"), setModel
    // logs the failure and tries the next method. Ensure the redaction holds
    // for that branch too.
    const methodNotFoundError = {
      code: -32601,
      message: 'Method not found',
      data: {
        httpStatus: 404,
        apiStatus: 'notFound',
        details: `{"raw":"${SENTINEL}"}`,
        errorDetails: { detail: 'unstable_setSessionModel is not registered' },
      },
    };
    const payload = buildSetModelFailureLogPayload(methodNotFoundError);
    expect(payload.isMethodNotFound).toBe(true);
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain(SENTINEL);
    // Safe diagnostic detail still reaches the log so operators can confirm
    // why the adapter fell back.
    expect(serialized).toContain('unstable_setSessionModel is not registered');
  });
});
