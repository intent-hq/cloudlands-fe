import type { ContentBlockGroup, RenderContentBlock } from '$lib/utils/messageParser';

/** Fewest tool calls plus thinking steps that collapse into one summary row. */
export const MIN_COLLAPSED_RUN_LENGTH = 2;

/** Renderer-only identity for synthetic run groups (never an authored group name). */
export const COLLAPSED_RUN_SOURCE_NAME = 'collapsed-operational-run';

export interface CollapsedRunCounts {
  tools: number;
  thinking: number;
}

function isRunMember(block: RenderContentBlock): boolean {
  return block.type === 'tool_use' || block.type === 'thinking' || block.type === 'tool_result';
}

/**
 * Wrap each run of consecutive top-level tool calls and thinking steps into a
 * synthetic response group so the chat shows one expandable summary row.
 *
 * Paired `tool_result` blocks travel with their run and are not counted.
 * Prose, media, plans, proposals and authored groups end a run and are never
 * reordered. Runs shorter than {@link MIN_COLLAPSED_RUN_LENGTH} stay as-is.
 */
export function collapseOperationalRuns(
  blocks: readonly RenderContentBlock[],
  { isStreaming = false }: { isStreaming?: boolean } = {},
): RenderContentBlock[] {
  const result: RenderContentBlock[] = [];
  let index = 0;
  while (index < blocks.length) {
    if (!isRunMember(blocks[index])) {
      result.push(blocks[index]);
      index += 1;
      continue;
    }

    const start = index;
    const counts: CollapsedRunCounts = { tools: 0, thinking: 0 };
    while (index < blocks.length && isRunMember(blocks[index])) {
      const block = blocks[index];
      if (block.type === 'tool_use') counts.tools += 1;
      else if (block.type === 'thinking') counts.thinking += 1;
      index += 1;
    }
    const run = blocks.slice(start, index);

    if (counts.tools + counts.thinking < MIN_COLLAPSED_RUN_LENGTH) {
      result.push(...run);
      continue;
    }

    const group: ContentBlockGroup = {
      type: 'content_group',
      name: '',
      sourceName: COLLAPSED_RUN_SOURCE_NAME,
      isStreaming: isStreaming && index === blocks.length,
      children: run as ContentBlockGroup['children'],
      collapsedRun: counts,
    };
    result.push(group);
  }
  return result;
}
