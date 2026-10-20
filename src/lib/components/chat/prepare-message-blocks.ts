import type { ContentBlock, MessageRole } from '$shared/types';
import { dedupeAgentVideoContentBlocks, normalizeAgentVideoContentBlocks } from '$shared/types';
import { isQuestionResourceBlock } from '$shared/types/question-resource';
import { dedupeResourceBlocks } from '$shared/types/resource-block-identity';
import {
  parseSuggestedPrompts,
  parseSuggestedPromptsFromContentBlocks,
} from '$lib/utils/messageParser';

export interface PrepareMessageBlocksOptions {
  role: MessageRole;
  /** Owning workspace; decides which workspace-relative video sources are trusted. */
  workspaceId?: string;
  isStreaming: boolean;
  /** Drop tool_use and tool_result rows entirely. */
  hideToolCalls?: boolean;
}

function hasVisibleText(block: ContentBlock): boolean {
  const text = block.text || block.content || '';
  return parseSuggestedPrompts(text).cleanedContent.trim().length > 0;
}

/**
 * The single preparation step between a message's content blocks and the
 * chat renderers' `groupMessageBlocks` call. Chat search runs the same step,
 * so its `b:<index>` block paths always address the rendered rows.
 *
 * Order matters and mirrors what the transcript shows:
 * 1. strip suggested prompts (rendered separately by ChatPanel);
 * 2. collapse duplicate resource blocks to one card per resource;
 * 3. normalize assistant video shapes, then drop repeated video sources;
 * 4. drop wizard-only question cards, empty text, and (optionally) tool rows;
 * 5. keep only the last tool_use per id (the skeleton is superseded by the
 *    block carrying the real input).
 */
export function prepareMessageBlocks(
  content: readonly ContentBlock[],
  options: PrepareMessageBlocksOptions,
): ContentBlock[] {
  const { role, workspaceId, isStreaming, hideToolCalls = false } = options;
  const withoutPrompts = parseSuggestedPromptsFromContentBlocks(content, {
    isStreaming,
  }).contentBlocks;
  const kept = dedupeAgentVideoContentBlocks(
    normalizeAgentVideoContentBlocks(dedupeResourceBlocks(withoutPrompts), role, workspaceId),
  ).filter((block) => {
    if (isQuestionResourceBlock(block)) return false;
    if (hideToolCalls && (block.type === 'tool_use' || block.type === 'tool_result')) {
      return false;
    }
    if (block.type === 'text') return hasVisibleText(block);
    return true;
  });

  const lastToolUseIndex = new Map<string, number>();
  kept.forEach((block, index) => {
    if (block.type === 'tool_use' && block.id) lastToolUseIndex.set(block.id, index);
  });
  if (lastToolUseIndex.size === 0) return kept;
  return kept.filter(
    (block, index) =>
      block.type !== 'tool_use' || !block.id || lastToolUseIndex.get(block.id) === index,
  );
}
