import { describe, expect, it } from 'vitest';
import type { ContentBlock } from '$shared/types';
import type { ContentBlockGroup, RenderContentBlock } from '$lib/utils/messageParser';
import { collapseOperationalRuns } from './operational-run-collapse';

const tool = (id: string): ContentBlock =>
  ({ type: 'tool_use', id, name: 'view', input: {} }) as ContentBlock;
const result = (id: string): ContentBlock =>
  ({ type: 'tool_result', tool_use_id: id, output: 'ok' }) as ContentBlock;
const thinking = (id: string): ContentBlock => ({ type: 'thinking', id, text: 'Plan' });
const text = (value: string): ContentBlock => ({ type: 'text', text: value });

function groups(blocks: RenderContentBlock[]): ContentBlockGroup[] {
  return blocks.filter((block): block is ContentBlockGroup => block.type === 'content_group');
}

describe('collapseOperationalRuns', () => {
  it('wraps consecutive tool calls and thinking steps into one counted group', () => {
    const blocks = [tool('a'), result('a'), thinking('t1'), tool('b'), result('b')];
    const collapsed = collapseOperationalRuns(blocks);

    expect(collapsed).toHaveLength(1);
    const [group] = groups(collapsed);
    expect(group.collapsedRun).toEqual({ tools: 2, thinking: 1 });
    expect(group.children).toEqual(blocks);
    expect(group.isStreaming).toBe(false);
  });

  it('keeps prose between runs in place and collapses each run separately', () => {
    const intro = text('Setup finished.');
    const middle = text('The approach looks feasible.');
    const blocks = [intro, tool('a'), tool('b'), middle, thinking('t1'), tool('c'), tool('d')];
    const collapsed = collapseOperationalRuns(blocks);

    expect(collapsed.map((block) => block.type)).toEqual([
      'text',
      'content_group',
      'text',
      'content_group',
    ]);
    expect(collapsed[0]).toBe(intro);
    expect(collapsed[2]).toBe(middle);
    expect(groups(collapsed).map((group) => group.collapsedRun)).toEqual([
      { tools: 2, thinking: 0 },
      { tools: 2, thinking: 1 },
    ]);
  });

  it('leaves a lone tool call or thinking step unwrapped', () => {
    const blocks = [tool('a'), result('a'), text('Done.'), thinking('t1'), text('More.')];
    expect(collapseOperationalRuns(blocks)).toEqual(blocks);
  });

  it('does not count tool results toward the minimum run length', () => {
    const blocks = [result('earlier'), tool('a'), result('a')];
    expect(collapseOperationalRuns(blocks)).toEqual(blocks);
  });

  it('never absorbs authored groups, images or plans', () => {
    const authored: ContentBlockGroup = {
      type: 'content_group',
      name: 'Working',
      isStreaming: false,
      children: [tool('x'), tool('y')],
    };
    const image = { type: 'image', data: 'AAAA', mimeType: 'image/png' } as ContentBlock;
    const blocks: RenderContentBlock[] = [tool('a'), authored, tool('b'), image, tool('c')];
    expect(collapseOperationalRuns(blocks)).toEqual(blocks);
  });

  it('marks only a trailing run of a streaming message as streaming', () => {
    const blocks = [tool('a'), tool('b'), text('Next.'), tool('c'), thinking('t1')];
    const streaming = groups(collapseOperationalRuns(blocks, { isStreaming: true }));
    expect(streaming.map((group) => group.isStreaming)).toEqual([false, true]);

    const finished = groups(collapseOperationalRuns(blocks, { isStreaming: false }));
    expect(finished.map((group) => group.isStreaming)).toEqual([false, false]);
  });

  it('returns an empty list unchanged', () => {
    expect(collapseOperationalRuns([])).toEqual([]);
  });
});
