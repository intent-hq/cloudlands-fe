import type { ContentBlock } from '$shared/types';
import {
  buildToolResultsMap,
  findToolResult,
  getToolResultPayload,
  getToolResultText,
} from '$lib/components/chat/tool-result-pairing';
import { describe, expect, it } from 'vitest';

function toolUse(id: string, toolCallId: string): ContentBlock {
  return { type: 'tool_use', id, toolCallId, name: 'search', input: { query: 'test' } };
}

function toolResult(id: string, toolUseId: string, output: unknown, isError = false): ContentBlock {
  return { type: 'tool_result', id, tool_use_id: toolUseId, output, is_error: isError };
}

describe('Tool call display association', () => {
  it('associates each tool call with its daemon result without changing block order', () => {
    const useA = toolUse('msg-1:1', 'call-a');
    const resultA = toolResult('msg-1:2', 'call-a', 'A');
    const useB = toolUse('msg-1:3', 'call-b');
    const resultB = toolResult('msg-1:4', 'call-b', { count: 2 });
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'Searching' },
      useA,
      resultA,
      useB,
      resultB,
    ];

    const results = buildToolResultsMap(blocks);

    expect(blocks.map((block) => block.type)).toEqual([
      'text',
      'tool_use',
      'tool_result',
      'tool_use',
      'tool_result',
    ]);
    expect(findToolResult(results, useA)).toBe(resultA);
    expect(findToolResult(results, useB)).toBe(resultB);
  });

  it('uses the protocol toolCallId to tool_use_id association', () => {
    const use = toolUse('msg-2:0', 'provider-call-1');
    const result = toolResult('msg-2:1', 'provider-call-1', { stdout: 'ok' });

    expect(getToolResultPayload(findToolResult(buildToolResultsMap([use, result]), use))).toEqual({
      stdout: 'ok',
    });
  });

  it('preserves an associated tool error for display', () => {
    const use = toolUse('msg-3:0', 'provider-call-error');
    const result = toolResult('msg-3:1', 'provider-call-error', 'Tool execution failed', true);
    const found = findToolResult(buildToolResultsMap([use, result]), use);

    expect(found?.is_error).toBe(true);
    expect(getToolResultText(found)).toBe('Tool execution failed');
  });
});
