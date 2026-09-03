/**
 * Tool-call pairing per PROTOCOL.md §7.1.
 *
 * The daemon synthesizes `tool_use` blocks `{ type, id, name, input, toolCallId,
 * metadata }` and `tool_result` blocks `{ type, id, tool_use_id, output, is_error }`,
 * paired by toolCallId ↔ tool_use_id. These tests drive daemon-shaped payloads
 * through the pairing helpers shared by MessageContent / StreamingMessageContent.
 */

import { describe, it, expect } from 'vitest';
import type { ContentBlock } from '$shared/types';
import {
  buildToolResultsMap,
  classifyToolResults,
  extractPayloadText,
  findToolResult,
  getStandaloneToolResultPresentation,
  getToolResultPayload,
  getToolResultText,
  isStandaloneToolResult,
} from '../tool-result-pairing';

/** Daemon-shaped tool_use block (PROTOCOL §7.1). */
function toolUse(id: string, toolCallId: string): ContentBlock {
  return {
    type: 'tool_use',
    id,
    name: 'read_file',
    input: { path: 'foo.ts' },
    toolCallId,
    metadata: { toolKind: 'read', status: 'completed' },
  };
}

/** Daemon-shaped tool_result block (PROTOCOL §7.1). */
function toolResult(id: string, toolUseId: string, output: unknown, isError = false): ContentBlock {
  return { type: 'tool_result', id, tool_use_id: toolUseId, output, is_error: isError };
}

describe('buildToolResultsMap / findToolResult — §7.1 pairing', () => {
  it('pairs a tool_use with its tool_result by toolCallId ↔ tool_use_id', () => {
    const use = toolUse('msg_1:0', 'tc_1');
    const result = toolResult('msg_1:1', 'tc_1', { stdout: 'ok' });
    const map = buildToolResultsMap([use, result]);

    expect(findToolResult(map, use)).toBe(result);
  });

  it('resolves an error tool_result (is_error: true) for its tool_use', () => {
    const use = toolUse('msg_1:0', 'tc_1');
    const result = toolResult('msg_1:1', 'tc_1', 'Tool failed: boom', true);
    const map = buildToolResultsMap([use, result]);

    const found = findToolResult(map, use);
    expect(found).toBe(result);
    expect(found?.is_error).toBe(true);
  });

  it('still resolves when tool_use_id matches the tool_use block id (legacy pairing)', () => {
    const use = toolUse('msg_1:0', 'tc_1');
    const result = toolResult('msg_1:1', 'msg_1:0', 'ok');
    const map = buildToolResultsMap([use, result]);

    expect(findToolResult(map, use)).toBe(result);
  });

  it('pairs each of several tool calls with its own result', () => {
    const useA = toolUse('msg_1:0', 'tc_a');
    const useB = toolUse('msg_1:2', 'tc_b');
    const resultA = toolResult('msg_1:1', 'tc_a', 'A');
    const resultB = toolResult('msg_1:3', 'tc_b', 'B');
    const map = buildToolResultsMap([useA, resultA, useB, resultB]);

    expect(findToolResult(map, useA)).toBe(resultA);
    expect(findToolResult(map, useB)).toBe(resultB);
  });

  it('returns undefined when no result references the tool_use', () => {
    const use = toolUse('msg_1:0', 'tc_1');
    const other = toolResult('msg_1:3', 'tc_other', 'ok');
    const map = buildToolResultsMap([use, other]);

    expect(findToolResult(map, use)).toBeUndefined();
  });

  it('leaves an error result with empty tool_use_id unpaired (no position fallback)', () => {
    const use = toolUse('msg_1:0', 'tc_1');
    const orphanError: ContentBlock = {
      type: 'tool_result',
      tool_use_id: '',
      output: 'Error: exploded',
      is_error: true,
    };
    const map = buildToolResultsMap([use, orphanError]);

    expect(findToolResult(map, use)).toBeUndefined();
  });

  it('ignores non-error results with empty tool_use_id (no position fallback)', () => {
    const use = toolUse('msg_1:0', 'tc_1');
    const orphan: ContentBlock = { type: 'tool_result', tool_use_id: '', output: 'ok' };
    const map = buildToolResultsMap([use, orphan]);

    expect(findToolResult(map, use)).toBeUndefined();
  });
});

describe('classifyToolResults — transcript visibility', () => {
  it('classifies protocol-paired results as attached and unmatched results as standalone', () => {
    const use = toolUse('msg_1:0', 'tc_1');
    const paired = toolResult('msg_1:1', 'tc_1', 'paired');
    const legacyPaired = toolResult('msg_1:2', 'msg_1:0', 'legacy paired');
    const orphan = toolResult('msg_1:3', 'missing', 'orphan');
    const classification = classifyToolResults([use, paired, legacyPaired, orphan]);

    expect(isStandaloneToolResult(classification, paired)).toBe(false);
    expect(isStandaloneToolResult(classification, legacyPaired)).toBe(false);
    expect(isStandaloneToolResult(classification, orphan)).toBe(true);
  });

  it('keeps duplicate paired results out of standalone rows and attaches the latest once', () => {
    const use = toolUse('msg_1:0', 'tc_1');
    const first = toolResult('msg_1:1', 'tc_1', 'first');
    const latest = toolResult('msg_1:2', 'tc_1', 'latest');
    const classification = classifyToolResults([use, first, latest]);

    expect(classification.standaloneResults.size).toBe(0);
    expect(findToolResult(classification.resultsMap, use)).toBe(latest);
  });

  it('classifies a result with no reference as standalone', () => {
    const result = { type: 'tool_result', id: 'msg_1:0', output: 'orphan' } as ContentBlock;
    const classification = classifyToolResults([result]);

    expect(isStandaloneToolResult(classification, result)).toBe(true);
  });

  it('classifies paired and orphan results recursively inside content groups', () => {
    const use = toolUse('msg_1:0', 'tc_grouped');
    const paired = toolResult('msg_1:1', 'tc_grouped', 'paired');
    const orphan = toolResult('msg_1:2', 'missing', 'orphan');
    const classification = classifyToolResults([
      { type: 'content_group', children: [use, paired, orphan] },
    ]);

    expect(findToolResult(classification.resultsMap, use)).toBe(paired);
    expect(isStandaloneToolResult(classification, paired)).toBe(false);
    expect(isStandaloneToolResult(classification, orphan)).toBe(true);
  });
});

describe('getToolResultPayload / getToolResultText — §7.1 output extraction', () => {
  it('reads the §7.1 `output` field', () => {
    const result = toolResult('msg_1:1', 'tc_1', { stdout: 'ok' });
    expect(getToolResultPayload(result)).toEqual({ stdout: 'ok' });
  });

  it('falls back to legacy `content` when `output` is absent', () => {
    const legacy: ContentBlock = { type: 'tool_result', tool_use_id: 'tc_1', content: 'legacy' };
    expect(getToolResultPayload(legacy)).toBe('legacy');
  });

  it('prefers `output` over `content` when both are present', () => {
    const both: ContentBlock = {
      type: 'tool_result',
      tool_use_id: 'tc_1',
      output: 'from output',
      content: 'from content',
    };
    expect(getToolResultPayload(both)).toBe('from output');
  });

  it('returns null for a missing result or empty payload', () => {
    expect(getToolResultPayload(undefined)).toBeNull();
    expect(getToolResultPayload({ type: 'tool_result', tool_use_id: 'tc_1' })).toBeNull();
  });

  it('returns string payloads as text and empty string for non-text payloads', () => {
    expect(getToolResultText(toolResult('b', 'tc_1', 'Error: nope'))).toBe('Error: nope');
    expect(getToolResultText(toolResult('b', 'tc_1', { nested: true }))).toBe('');
    expect(getToolResultText(undefined)).toBe('');
  });

  it('extracts text from MCP content-item array payloads (§7.1)', () => {
    const arrayResult = toolResult('b', 'tc_1', [
      { type: 'text', text: 'Error: exploded' },
      { type: 'image', data: 'aaaa' },
      { type: 'text', text: 'second line' },
    ]);
    expect(getToolResultText(arrayResult)).toBe('Error: exploded\nsecond line');
  });
});

describe('extractPayloadText — §7.1 payload shapes', () => {
  it('returns strings as-is and reads the fallback `output` object shape', () => {
    expect(extractPayloadText('plain')).toBe('plain');
    expect(extractPayloadText({ output: 'from output' })).toBe('from output');
  });

  it('joins text items from MCP content-item arrays', () => {
    expect(
      extractPayloadText([
        { type: 'text', text: 'one' },
        { type: 'text', text: 'two' },
      ]),
    ).toBe('one\ntwo');
  });

  it('returns null when no text can be extracted', () => {
    expect(extractPayloadText(null)).toBeNull();
    expect(extractPayloadText(undefined)).toBeNull();
    expect(extractPayloadText([{ type: 'image', data: 'aaaa' }])).toBeNull();
    expect(extractPayloadText({ code: -1 })).toBeNull();
  });
});

describe('getStandaloneToolResultPresentation — visible/searchable parity', () => {
  it('preserves strings and content arrays', () => {
    const blocks = [{ type: 'text', text: 'array text' }];
    expect(getStandaloneToolResultPresentation(toolResult('a', 'missing', 'plain'))).toEqual({
      payload: 'plain',
      searchableText: 'plain',
    });
    expect(getStandaloneToolResultPresentation(toolResult('b', 'missing', blocks))).toEqual({
      payload: blocks,
      searchableText: 'array text',
    });
  });

  it('presents only explicit object-envelope output text', () => {
    expect(
      getStandaloneToolResultPresentation(
        toolResult('a', 'missing', { output: 'object-orphan-marker', privateMetadata: 'hidden' }),
      ),
    ).toEqual({ payload: 'object-orphan-marker', searchableText: 'object-orphan-marker' });
    expect(
      getStandaloneToolResultPresentation(
        toolResult('b', 'missing', { privateMetadata: 'unsupported-object-hidden-marker' }),
      ),
    ).toEqual({ payload: null, searchableText: '' });
  });
});
