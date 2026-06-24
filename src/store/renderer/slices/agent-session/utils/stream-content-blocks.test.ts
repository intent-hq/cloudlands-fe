import { describe, expect, it } from 'vitest';
import type { ContentBlock } from '$shared/types';
import { dedupeStreamContentBlocks, resolveStreamContentBlocks } from './stream-content-blocks';

describe('stream-content-blocks utilities', () => {
  it('preserves text/tool ordering while merging adjacent text', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'Before ' },
      { type: 'text', text: 'tool' },
      { type: 'tool_use', id: 'tool-1', name: 'search' },
      { type: 'tool_result', tool_use_id: 'tool-1', output: 'ok' },
      { type: 'text', text: ' after' },
    ];

    expect(dedupeStreamContentBlocks(blocks)).toEqual([
      { type: 'text', text: 'Before tool' },
      { type: 'tool_use', id: 'tool-1', name: 'search' },
      { type: 'tool_result', tool_use_id: 'tool-1', output: 'ok' },
      { type: 'text', text: ' after' },
    ]);
  });

  it('dedupes tool_use updates and duplicate tool_result blocks', () => {
    const blocks: ContentBlock[] = [
      { type: 'tool_use', id: 'tool-1', name: 'search', input: { q: 'old' } },
      { type: 'tool_use', id: 'tool-1', name: 'search', input: { q: 'new' } },
      { type: 'tool_result', tool_use_id: 'tool-1', output: 'first' },
      { type: 'tool_result', tool_use_id: 'tool-1', output: 'second' },
    ];

    expect(dedupeStreamContentBlocks(blocks)).toEqual([
      { type: 'tool_use', id: 'tool-1', name: 'search', input: { q: 'new' } },
      { type: 'tool_result', tool_use_id: 'tool-1', output: 'first' },
    ]);
  });

  it('replaces duplicate generic ID-backed blocks with the latest block', () => {
    const blocks: ContentBlock[] = [
      { type: 'image', id: 'asset-1', data: 'old', mimeType: 'image/png' },
      { type: 'image', id: 'asset-1', data: 'new', mimeType: 'image/png' },
      { type: 'code', id: 'snippet-1', language: 'ts', text: 'old();' },
      { type: 'code', id: 'snippet-1', language: 'ts', text: 'new();' },
    ];

    expect(dedupeStreamContentBlocks(blocks)).toEqual([
      { type: 'image', id: 'asset-1', data: 'new', mimeType: 'image/png' },
      { type: 'code', id: 'snippet-1', language: 'ts', text: 'new();' },
    ]);
  });

  it('prevents active stream block and text regressions', () => {
    const current: ContentBlock[] = [
      { type: 'text', text: 'Before' },
      { type: 'tool_use', id: 'tool-1', name: 'search' },
      { type: 'text', text: 'After' },
    ];

    expect(
      resolveStreamContentBlocks(current, [{ type: 'text', text: 'Before' }], 'chunk'),
    ).toEqual(current);
    expect(resolveStreamContentBlocks(current, [{ type: 'text', text: 'Bef' }], 'chunk')).toEqual(
      current,
    );
  });

  it('keeps richer local content when completion payload is shorter', () => {
    const current: ContentBlock[] = [{ type: 'text', text: 'complete visible answer' }];
    const incoming: ContentBlock[] = [{ type: 'text', text: 'complete' }];

    expect(resolveStreamContentBlocks(current, incoming, 'complete')).toEqual(current);
  });

  it('reuses unchanged block and array references after resolving stream updates', () => {
    const current: ContentBlock[] = [
      { type: 'text', text: 'Before' },
      { type: 'tool_use', id: 'tool-1', name: 'search', input: { q: 'x' } },
      { type: 'tool_result', tool_use_id: 'tool-1', output: 'found' },
      { type: 'text', text: 'After' },
    ];

    const unchanged = resolveStreamContentBlocks(
      current,
      [
        { type: 'text', text: 'Before' },
        { type: 'tool_use', id: 'tool-1', name: 'search', input: { q: 'x' } },
        { type: 'tool_result', tool_use_id: 'tool-1', output: 'found' },
        { type: 'text', text: 'After' },
      ],
      'chunk',
    );
    expect(unchanged).toBe(current);

    const appended = resolveStreamContentBlocks(
      current,
      [
        { type: 'text', text: 'Before' },
        { type: 'tool_use', id: 'tool-1', name: 'search', input: { q: 'x' } },
        { type: 'tool_result', tool_use_id: 'tool-1', output: 'found' },
        { type: 'text', text: 'After more' },
      ],
      'chunk',
    );

    expect(appended).toEqual([
      { type: 'text', text: 'Before' },
      { type: 'tool_use', id: 'tool-1', name: 'search', input: { q: 'x' } },
      { type: 'tool_result', tool_use_id: 'tool-1', output: 'found' },
      { type: 'text', text: 'After more' },
    ]);
    expect(appended).not.toBe(current);
    expect(appended?.[0]).toBe(current[0]);
    expect(appended?.[1]).toBe(current[1]);
    expect(appended?.[2]).toBe(current[2]);
    expect(appended?.[3]).not.toBe(current[3]);
  });
});
