import { describe, expect, it } from 'vitest';
import type { ContentBlock } from '$shared/types';
import { mergeStreamContentBlocks, resolveStreamContentBlocks } from './stream-content-blocks';

const M = '01a014bc-beb5-7ac1-aea7-ac220436f7ca';

const text = (id: string | undefined, t: string): ContentBlock => ({
  type: 'text',
  ...(id ? { id } : {}),
  text: t,
});
const toolUse = (id: string, toolCallId: string, status: string): ContentBlock => ({
  type: 'tool_use',
  id,
  toolCallId,
  name: 'codebase-retrieval',
  metadata: { status },
});

describe('mergeStreamContentBlocks', () => {
  it('preserves subscription-owned text blocks a tool-only update does not carry (monorepo#2814)', () => {
    const existing = [
      text(`${M}:0`, '<group:Researching>\nintro'),
      toolUse(`${M}:1`, 'toolu_01', 'started'),
    ];
    const incoming = [toolUse(`${M}:1`, 'toolu_01', 'completed')];
    const merged = mergeStreamContentBlocks(existing, incoming);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ type: 'text', text: '<group:Researching>\nintro' });
    expect(merged[1]).toMatchObject({ type: 'tool_use', metadata: { status: 'completed' } });
  });

  it('strong-matches tool_use by toolCallId even when block ids differ', () => {
    const existing = [toolUse(`${M}:1`, 'toolu_01', 'started')];
    const incoming = [{ ...toolUse('other-id', 'toolu_01', 'completed') }];
    const merged = mergeStreamContentBlocks(existing, incoming);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ metadata: { status: 'completed' } });
  });

  it('strong-matches tool_result by tool_use_id', () => {
    const existing: ContentBlock[] = [
      { type: 'tool_result', tool_use_id: 'toolu_01', output: 'old' },
    ];
    const incoming: ContentBlock[] = [
      { type: 'tool_result', tool_use_id: 'toolu_01', output: 'new' },
    ];
    expect(mergeStreamContentBlocks(existing, incoming)).toEqual([
      { type: 'tool_result', tool_use_id: 'toolu_01', output: 'new' },
    ]);
  });

  it('appends unmatched incoming blocks in incoming order', () => {
    const existing = [text(`${M}:0`, 'intro')];
    const incoming = [
      toolUse(`${M}:1`, 'toolu_01', 'started'),
      toolUse(`${M}:3`, 'toolu_02', 'started'),
    ];
    const merged = mergeStreamContentBlocks(existing, incoming);
    expect(merged.map((b) => b.type)).toEqual(['text', 'tool_use', 'tool_use']);
    expect(merged[0]).toMatchObject({ text: 'intro' });
  });

  it('degenerates to a replace when every existing block matches (firehose-only accumulator)', () => {
    const existing = [toolUse(`${M}:1`, 'toolu_01', 'started')];
    const incoming = [
      toolUse(`${M}:1`, 'toolu_01', 'completed'),
      toolUse(`${M}:3`, 'toolu_02', 'started'),
    ];
    expect(mergeStreamContentBlocks(existing, incoming)).toEqual(incoming);
  });

  it('ordinal fallback: the id-less stream:start placeholder pairs with the id-stamped first chunk', () => {
    const existing = [text(undefined, '')];
    const incoming = [text(`${M}:0`, 'Waking up: ')];
    expect(mergeStreamContentBlocks(existing, incoming)).toEqual([text(`${M}:0`, 'Waking up: ')]);
  });

  it('ordinal fallback: an id-less legacy chunk pairs with its subscription-written block', () => {
    const existing = [text(`${M}:0`, 'partial')];
    const incoming = [text(undefined, 'partial plus more')];
    expect(mergeStreamContentBlocks(existing, incoming)).toEqual([
      text(undefined, 'partial plus more'),
    ]);
  });

  it('two differing strong identities never cross-pair — both survive', () => {
    const existing = [toolUse(`${M}:1`, 'toolu_01', 'started')];
    const incoming = [toolUse(`${M}:3`, 'toolu_02', 'started')];
    const merged = mergeStreamContentBlocks(existing, incoming);
    expect(merged.map((b) => b.toolCallId)).toEqual(['toolu_01', 'toolu_02']);
  });

  it('KNOWN CONSTRAINT (dead legacy chunk wire): an id-less incoming text block pairs with the FIRST unmatched same-type block', () => {
    // A legacy content-bearing agent:stream:chunk without blockId cannot say
    // which daemon block it belongs to; with several text blocks present it
    // replaces the first. No current daemon emits this wire (post-intentd#775)
    // — this characterizes the constraint should the chunk wire ever return.
    const existing = [text(`${M}:0`, 'first'), text(`${M}:2`, 'second')];
    const incoming = [text(undefined, 'chunk for daemon block 2')];
    const merged = mergeStreamContentBlocks(existing, incoming);
    expect(merged).toEqual([text(undefined, 'chunk for daemon block 2'), text(`${M}:2`, 'second')]);
  });
});

describe('resolveStreamContentBlocks', () => {
  it('routes through the merge when existing blocks are present', () => {
    const existing = [text(`${M}:0`, 'intro'), toolUse(`${M}:1`, 'toolu_01', 'started')];
    const incoming = [toolUse(`${M}:1`, 'toolu_01', 'completed')];
    const resolved = resolveStreamContentBlocks(existing, incoming, 'content-blocks');
    expect(resolved).toHaveLength(2);
    expect(resolved?.[0]).toMatchObject({ type: 'text', text: 'intro' });
  });

  it('returns incoming as-is when there are no existing blocks', () => {
    const incoming = [text(`${M}:0`, 'fresh')];
    expect(resolveStreamContentBlocks(undefined, incoming, 'chunk')).toBe(incoming);
    expect(resolveStreamContentBlocks([], incoming, 'chunk')).toBe(incoming);
  });

  it('without incoming: keeps existing only on terminal events', () => {
    const existing = [text(`${M}:0`, 'kept')];
    expect(resolveStreamContentBlocks(existing, undefined, 'complete')).toBe(existing);
    expect(resolveStreamContentBlocks(existing, undefined, 'error')).toBe(existing);
    expect(resolveStreamContentBlocks(existing, undefined, 'timeout')).toBe(existing);
    expect(resolveStreamContentBlocks(existing, undefined, 'chunk')).toBeUndefined();
  });
});
