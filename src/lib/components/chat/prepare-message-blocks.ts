import type { AgentSession, ContentBlock, MessageRole, SuggestedPrompt } from '$shared/types';
import { dedupeAgentVideoContentBlocks, normalizeAgentVideoContentBlocks } from '$shared/types';
import { isQuestionResourceBlock } from '$shared/types/question-resource';
import { dedupeResourceBlocks } from '$shared/types/resource-block-identity';
import { providerRefBaseId } from '$shared/provider-profiles';
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
  /** Render non-empty thinking blocks as prose (see {@link rendersReasoningAsText}). */
  reasoningAsText?: boolean;
}

/**
 * Claude Code omits the model's own reasoning and returns only short progress
 * updates in thinking blocks, often in place of the prose the model meant to
 * show. Its agents' thinking therefore renders as prose, not as a reasoning
 * disclosure. The provider is fixed once a conversation starts.
 */
export function rendersReasoningAsText(
  session: Pick<AgentSession, 'provider'> | null | undefined,
): boolean {
  return providerRefBaseId(session?.provider ?? '') === 'claude-code';
}

/** The text a chat renderer shows for a text block (legacy `content` as fallback). */
export function renderedBlockText(block: Pick<ContentBlock, 'text' | 'content'>): string {
  return block.text || block.content || '';
}

function reasoningToText(content: readonly ContentBlock[]): readonly ContentBlock[] {
  if (!content.some((block) => block.type === 'thinking')) return content;
  return content.map((block): ContentBlock => {
    if (block.type !== 'thinking') return block;
    const text = renderedBlockText(block);
    return text.trim() ? { ...block, type: 'text', text } : block;
  });
}

/**
 * The suggested prompts a message offers, read from the same blocks the
 * renderer shows as text. With `reasoningAsText`, a prompts block inside a
 * thinking block is stripped from the rendered prose, so its chips must come
 * from the converted blocks too.
 */
export function suggestedPromptsFromBlocks(
  content: readonly ContentBlock[],
  reasoningAsText: boolean,
): SuggestedPrompt[] {
  return parseSuggestedPromptsFromContentBlocks(
    reasoningAsText ? reasoningToText(content) : content,
  ).prompts;
}

function hasVisibleText(block: ContentBlock): boolean {
  return parseSuggestedPrompts(renderedBlockText(block)).cleanedContent.trim().length > 0;
}

/**
 * The single preparation step between a message's content blocks and the
 * chat renderers' `groupMessageBlocks` call. Chat search runs the same step,
 * so its `b:<index>` block paths always address the rendered rows.
 *
 * Order matters and mirrors what the transcript shows:
 * 0. optionally render thinking as prose, before any step that treats text;
 * 1. strip suggested prompts (rendered separately by ChatPanel);
 * 2. collapse duplicate resource blocks to one card per resource;
 * 3. normalize assistant video shapes;
 * 4. drop wizard-only question cards, empty text, and (optionally) tool rows;
 * 5. drop repeated video sources among what is left, so a hidden block never
 *    claims a source and suppresses a visible copy;
 * 6. keep only the last tool_use per id (the skeleton is superseded by the
 *    block carrying the real input).
 */
export function prepareMessageBlocks(
  content: readonly ContentBlock[],
  options: PrepareMessageBlocksOptions,
): ContentBlock[] {
  const {
    role,
    workspaceId,
    isStreaming,
    hideToolCalls = false,
    reasoningAsText = false,
  } = options;
  const withoutPrompts = parseSuggestedPromptsFromContentBlocks(
    reasoningAsText ? reasoningToText(content) : content,
    { isStreaming },
  ).contentBlocks;
  const visible = normalizeAgentVideoContentBlocks(
    dedupeResourceBlocks(withoutPrompts),
    role,
    workspaceId,
  ).filter((block) => {
    if (isQuestionResourceBlock(block)) return false;
    if (hideToolCalls && (block.type === 'tool_use' || block.type === 'tool_result')) {
      return false;
    }
    if (block.type === 'text') return hasVisibleText(block);
    return true;
  });
  const kept = dedupeAgentVideoContentBlocks(visible);

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
