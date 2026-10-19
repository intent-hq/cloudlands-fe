import type { ContentBlock } from '$shared/types';
import { getContentBlockText } from '$shared/utils/content-block-helpers';
import {
  groupContentBlocks,
  type CollapsedRunCounts,
  type ContentBlockGroup,
  type RenderContentBlock,
} from '$lib/utils/messageParser';
import { normalizeResponseGroups } from './response-group-blocks';
import { classifyToolResults } from './tool-result-pairing';

/** Fewest tool calls plus thinking steps that collapse into one summary row. */
const MIN_COLLAPSED_RUN_LENGTH = 2;

/** Renderer-only identity for synthetic run groups (never an authored group name). */
const COLLAPSED_RUN_SOURCE_NAME = 'collapsed-operational-run';

function isRunMember(block: RenderContentBlock, standalone: ReadonlySet<unknown>): boolean {
  if (block.type === 'tool_result') return !standalone.has(block);
  return block.type === 'tool_use' || block.type === 'thinking';
}

/**
 * Wrap each run of consecutive top-level tool calls and thinking steps into a
 * synthetic response group so the chat shows one expandable summary row.
 *
 * Paired `tool_result` blocks (which render nothing on their own) travel with
 * their run and are not counted. Standalone results render a visible card, so
 * they end a run, as do prose, media, plans, proposals and authored groups;
 * nothing is reordered. A thinking step counts only once it has text, so the
 * empty live placeholder never forms a transient group. Runs shorter than
 * {@link MIN_COLLAPSED_RUN_LENGTH} stay as-is.
 */
export function collapseOperationalRuns(
  blocks: readonly RenderContentBlock[],
  { isStreaming = false }: { isStreaming?: boolean } = {},
): RenderContentBlock[] {
  const { standaloneResults } = classifyToolResults(blocks);
  const result: RenderContentBlock[] = [];
  let index = 0;
  while (index < blocks.length) {
    if (!isRunMember(blocks[index], standaloneResults)) {
      result.push(blocks[index]);
      index += 1;
      continue;
    }

    const start = index;
    const counts: CollapsedRunCounts = { tools: 0, thinking: 0 };
    while (index < blocks.length && isRunMember(blocks[index], standaloneResults)) {
      const block = blocks[index];
      if (block.type === 'tool_use') counts.tools += 1;
      else if (block.type === 'thinking' && getContentBlockText(block).trim()) counts.thinking += 1;
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

/**
 * The message block structure every chat surface renders and indexes: authored
 * groups, normalized reasoning, then (when enabled) collapsed tool runs. Search
 * and the renderers share it so block paths always agree.
 */
export function groupMessageBlocks(
  blocks: ContentBlock[],
  isStreaming: boolean,
  collapseToolRuns: boolean,
): RenderContentBlock[] {
  const normalized = normalizeResponseGroups(groupContentBlocks(blocks, isStreaming), isStreaming);
  return collapseToolRuns ? collapseOperationalRuns(normalized, { isStreaming }) : normalized;
}
