import type { AgentMessage, ContentBlock } from '$shared/types';
import { isQuestionResourceBlock } from '$shared/types/question-resource';
import { parseSuggestedPromptsFromContentBlocks } from '$lib/utils/messageParser';

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

  if (
    suppressCoordinationStoppedIndicator &&
    (!stopReason || coordinationStopReasons.has(stopReason))
  ) {
    return false;
  }

  return true;
}

/**
 * Reason-specific Stopped-indicator label resolution. Interrupted assistant
 * rows carry an optional `interruptReason` (plus `interruptedBy` for
 * preemptions) in their metadata (PROTOCOL §7 interrupted-row metadata);
 * legacy rows without a reason — and unknown future reasons — resolve to the
 * generic `stopped` label. The resolver returns a label descriptor rather
 * than localized text so ChatMessage owns the Paraglide message calls.
 */
export type StoppedIndicatorLabel =
  | { kind: 'stopped' }
  | { kind: 'preempted-by-message' }
  | { kind: 'preempted-by-agent'; name: string }
  | { kind: 'daemon-shutdown' }
  | { kind: 'agent-stopped' }
  | { kind: 'system-suspend' };

export function resolveStoppedIndicatorLabel(message?: AgentMessage): StoppedIndicatorLabel {
  const reason = message?.metadata?.interruptReason;
  switch (reason) {
    case 'preempted_by_message': {
      const interruptedBy = message?.metadata?.interruptedBy;
      if (
        interruptedBy?.kind === 'agent' &&
        typeof interruptedBy.name === 'string' &&
        interruptedBy.name.length > 0
      ) {
        return { kind: 'preempted-by-agent', name: interruptedBy.name };
      }
      return { kind: 'preempted-by-message' };
    }
    case 'daemon_shutdown':
      return { kind: 'daemon-shutdown' };
    case 'agent_stopped':
      return { kind: 'agent-stopped' };
    case 'system_suspend':
      return { kind: 'system-suspend' };
    case 'user_stop':
    default:
      return { kind: 'stopped' };
  }
}

/**
 * Abnormal-finish notice resolution (PROTOCOL §7.3): assistant rows whose turn
 * ended with a non-`end_turn` ACP stop reason carry `metadata.finishReason`
 * (`refusal` | `max_tokens` | `max_turn_requests` today — open union). The
 * resolver returns a descriptor rather than localized text so ChatMessage owns
 * the Paraglide message calls; unknown future reasons render no notice.
 * `max_turn_requests` (per-turn request cap) shares the limit-reached wording.
 */
export type FinishReasonNotice = { kind: 'refusal' } | { kind: 'max-tokens' };

export function resolveFinishReasonNotice(message?: AgentMessage): FinishReasonNotice | undefined {
  switch (message?.metadata?.finishReason) {
    case 'refusal':
      return { kind: 'refusal' };
    case 'max_tokens':
    case 'max_turn_requests':
      return { kind: 'max-tokens' };
    default:
      return undefined;
  }
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
  const parsedBlocks = parseSuggestedPromptsFromContentBlocks(blocks).contentBlocks;
  let hasQuestion = false;
  for (const block of parsedBlocks) {
    if (isQuestionResourceBlock(block)) {
      hasQuestion = true;
      continue;
    }
    if (block.type === 'text') {
      const text = block.text || (block as { content?: string }).content || '';
      if (!text.trim()) continue;
    }
    return false;
  }
  return hasQuestion;
}
