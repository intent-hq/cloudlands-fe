import {
  describe,
  expect,
  it,
} from 'vitest';
import type { ContentBlock } from '$shared/types';
import {
  getContentBlockFingerprint,
  getContentBlockRichness,
  getContentBlocksRichness,
  getIdBackedContentBlockKey,
  getToolResultContentBlockKey,
  getToolUseContentBlockKey,
} from '../content-block-helpers';

describe('content-block helpers', () => {
  it('computes text, thinking, and code richness from text/content aliases', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'hello' },
      { type: 'thinking', content: 'ponder' },
      { type: 'code', text: 'const x = 1;' },
      { type: 'tool_use', id: 'tool-1' },
    ];

    expect(blocks.map(getContentBlockRichness)).toEqual([5, 6, 12, 1]);
    expect(getContentBlocksRichness(blocks)).toBe(24);
  });

  it('builds tool_use keys from canonical id before legacy toolCallId', () => {
    expect(
      getToolUseContentBlockKey({ type: 'tool_use', id: 'tool-1', toolCallId: 'legacy' }),
    ).toBe('tool-1');
    expect(getToolUseContentBlockKey({ type: 'tool_use', toolCallId: 'legacy' })).toBe('legacy');
    expect(getToolUseContentBlockKey({ type: 'text', text: 'hello' })).toBeUndefined();
  });

  it('builds tool_result keys from result linkage before legacy ids', () => {
    expect(
      getToolResultContentBlockKey({
        type: 'tool_result',
        tool_use_id: 'use-1',
        toolCallId: 'legacy',
      }),
    ).toBe('use-1');
    expect(getToolResultContentBlockKey({ type: 'tool_result', toolCallId: 'legacy' })).toBe(
      'legacy',
    );
    expect(getToolResultContentBlockKey({ type: 'tool_result', id: 'result-1' })).toBe('result-1');
  });

  it('builds generic ID-backed keys only for non-text blocks', () => {
    expect(getIdBackedContentBlockKey({ type: 'image', id: 'asset-1' })).toBe('image:asset-1');
    expect(getIdBackedContentBlockKey({ type: 'code', id: 'snippet-1' })).toBe('code:snippet-1');
    expect(
      getIdBackedContentBlockKey({ type: 'text', id: 'text-1', text: 'hello' }),
    ).toBeUndefined();
  });

  it('fingerprints structured tool/code blocks deterministically', () => {
    expect(
      getContentBlockFingerprint({ type: 'tool_use', name: 'search', input: { b: 2, a: 1 } }),
    ).toBe(getContentBlockFingerprint({ type: 'tool_use', name: 'search', input: { a: 1, b: 2 } }));
    expect(
      getContentBlockFingerprint({ type: 'tool_result', toolCallId: 'tool-1', output: 'ok' }),
    ).toBe('tool_result:tool-1:"ok"');
    expect(
      getContentBlockFingerprint({ type: 'code', language: 'ts', content: 'const x = 1;' }),
    ).toBe('code:ts:const x = 1;');
  });
});
