/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import type { ContentBlock } from '$shared/types';
import {
  groupContentBlocks,
  type ContentBlockGroup,
  type RenderContentBlock,
} from '$lib/utils/messageParser';
import { classifyToolResults, isStandaloneToolResult } from '../tool-result-pairing';
import { getResponseGroupChildBoundary, normalizeResponseGroups } from '../response-group-blocks';

const reasoning: ContentBlock = {
  type: 'thinking',
  id: 'reasoning',
  text: '**Updating the watcher spec**\n\n**Updating the PR notes**\n\n**Preparing PR note updates**',
};
const tool: ContentBlock = {
  type: 'tool_use',
  id: 'read',
  toolCallId: 'read',
  name: 'view',
  input: { path: 'src/example.ts' },
};
const paired: ContentBlock = {
  type: 'tool_result',
  id: 'paired',
  tool_use_id: 'read',
  output: 'Paired output',
};
const prose: ContentBlock = { type: 'text', id: 'prose', text: 'The fix is pushed.' };
const open: ContentBlock = { type: 'text', id: 'open', text: '<group:Prepping>' };
const close: ContentBlock = { type: 'text', id: 'close', text: '</group:Prepping>' };

function parse(content: ContentBlock[], isStreaming = false) {
  const blocks = normalizeResponseGroups(groupContentBlocks(content, isStreaming), isStreaming);
  const index = blocks.findIndex((block) => block.type === 'content_group');
  const group = blocks[index] as ContentBlockGroup;
  const results = classifyToolResults(blocks);
  const visible = (block: RenderContentBlock) =>
    block.type !== 'tool_result' || isStandaloneToolResult(results, block);
  const boundary = (childIndex: number) =>
    getResponseGroupChildBoundary(blocks, index, childIndex, visible, visible);
  return { blocks, group, boundary };
}

describe('response group child boundary selection', () => {
  it('inherits the preceding reasoning when an open phase finishes or explicitly closes', () => {
    const content = [reasoning, open, prose];
    const live = parse(content, true);
    expect(live.boundary(0)).toEqual([live.group.children[0]]);

    const closed = parse([...content, close], true);
    expect(closed.boundary(0)).toEqual([reasoning, closed.group.children[0]]);

    const completed = parse(content);
    expect(completed.boundary(0)).toEqual([reasoning, completed.group.children[0]]);
    expect(completed.group.children).toEqual(live.group.children);
  });

  it('skips paired results outside and inside the group but keeps an orphan result visible', () => {
    const outside = parse([tool, reasoning, paired, open, prose, close]);
    expect(outside.boundary(0)).toEqual([reasoning, outside.group.children[0]]);

    const inside = parse([tool, reasoning, open, paired, prose, close]);
    expect(inside.boundary(0)).toEqual([]);
    expect(inside.boundary(1)).toEqual([reasoning, inside.group.children[1]]);

    const orphan: ContentBlock = { ...paired, id: 'orphan', tool_use_id: 'missing' };
    const unmatched = parse([reasoning, open, orphan, prose, close]);
    expect(unmatched.boundary(1)).toEqual([orphan, unmatched.group.children[1]]);
  });

  it('uses the nearest local child once, retaining title and tool boundaries', () => {
    const { group, boundary } = parse([reasoning, open, prose, tool, paired, close]);
    expect(boundary(1)).toEqual([group.children[0], tool]);
    expect(boundary(2)).toEqual([]);

    const toolFirst = parse([reasoning, open, tool, paired, prose, close]);
    expect(toolFirst.boundary(0)).toEqual([reasoning, tool]);
    expect(toolFirst.boundary(2)).toEqual([tool, toolFirst.group.children[2]]);
  });

  it('has no preceding boundary at message start or inside a named disclosure', () => {
    const start = parse([open, prose, close]);
    expect(start.boundary(0)).toEqual([start.group.children[0]]);

    const named = parse([
      reasoning,
      { ...open, text: '<group:Working>' },
      prose,
      { ...close, text: '</group:Working>' },
    ]);
    expect(named.boundary(0)).toEqual([named.group.children[0]]);
  });
});
