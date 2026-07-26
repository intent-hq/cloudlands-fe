import type { AgentMessage, ContentBlock } from '$shared/types';
import { isQuestionResourceBlock } from '$shared/types/question-resource';
import { parseSuggestedPrompts } from '$lib/utils/messageParser';

const stoppedStopReasons = new Set([
  'cancelled',
  'interrupted',
  'provider_stopped',
  'workspace_deleted',
  'process_died',
  'process_null',
]);

const coordinationStopReasons = new Set(['cancelled', 'interrupted']);

function getStopReason(message: AgentMessage): string | undefined {
  const stopReason = message.metadata?.stopReason;
  return typeof stopReason === 'string' ? stopReason : undefined;
}

export function shouldShowStoppedIndicator({
  message,
  isStreaming,
  suppressCoordinationStoppedIndicator = false,
}: {
  message?: AgentMessage;
  isStreaming: boolean;
  suppressCoordinationStoppedIndicator?: boolean;
}): boolean {
  if (!message?.metadata?.interrupted || isStreaming) return false;

  const stopReason = getStopReason(message);
  const isStoppedReason = stopReason ? stoppedStopReasons.has(stopReason) : true;
  if (!isStoppedReason) return false;

  if (suppressCoordinationStoppedIndicator && (!stopReason || coordinationStopReasons.has(stopReason))) {
    return false;
  }

  return true;
}

/**
 * Agent Q&A wizard-only rendering: true when the blocks contain at least one
 * question resource block and NOTHING else that would render in the
 * transcript (text blocks that are empty or suggested-prompts-only count as
 * nothing). ChatMessage suppresses the whole assistant bubble for such turns
 * — the composer-slot QuestionWizard is the sole rendering surface.
 */
export function isQuestionOnlyContent(blocks: readonly ContentBlock[]): boolean {
  if (blocks.length === 0) return false;
  let hasQuestion = false;
  for (const block of blocks) {
    if (isQuestionResourceBlock(block)) {
      hasQuestion = true;
      continue;
    }
    if (block.type === 'text') {
      const text = block.text || (block as { content?: string }).content || '';
      if (!parseSuggestedPrompts(text).cleanedContent.trim()) continue;
    }
    return false;
  }
  return hasQuestion;
}
