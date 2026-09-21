import { extractAllContent, type AgentMessage } from '$shared/types';
import { getAgentMessageAttribution } from '$lib/utils/agent-message-attribution';
import { getAutomatedWakePresentation } from './automated-wake-presentation';
import { parseSuggestedPromptsFromContentBlocks } from '$lib/utils/messageParser';
import {
  isQuestionOnlyContent,
  resolveFinishReasonNotice,
  shouldShowStoppedIndicator,
} from './message-display-utils';

export type SubscriptionCardSeam = 'cards' | 'content';

/** Spacing only: retain every message/anchor, but do not space an empty or wizard-only body. */
export function hasVisibleTurnBody({
  assistantMessages,
  hasVisibleNotice = false,
  hasPendingStatus = false,
  suppressCoordinationStoppedIndicator = false,
}: {
  assistantMessages: readonly AgentMessage[];
  hasVisibleNotice?: boolean;
  hasPendingStatus?: boolean;
  suppressCoordinationStoppedIndicator?: boolean;
}): boolean {
  if (hasVisibleNotice || hasPendingStatus) return true;
  return assistantMessages.some((message) => {
    if (
      shouldShowStoppedIndicator({
        message,
        isStreaming: false,
        suppressCoordinationStoppedIndicator,
      }) ||
      resolveFinishReasonNotice(message)
    ) {
      return true;
    }
    const blocks = message.contentBlocks ?? [];
    if (isQuestionOnlyContent(blocks)) return false;
    return parseSuggestedPromptsFromContentBlocks(blocks).contentBlocks.some(
      (block) => block.type !== 'text' || Boolean((block.text || block.content || '').trim()),
    );
  });
}

/** Human and queued messages have the same filled boundary as notification cards. */
export function isChatCardMessage(message: AgentMessage | null | undefined): boolean {
  return message?.role === 'user';
}

/** Match the card presentations, not every automated user-role message. */
export function isSubscriptionCardMessage(message: AgentMessage | null | undefined): boolean {
  if (!message || message.role !== 'user') return false;
  return Boolean(
    getAgentMessageAttribution(message.metadata) ||
    getAutomatedWakePresentation(message) ||
    message.metadata?.type === 'event_notification' ||
    extractAllContent(message).trim().startsWith('[WORKSPACE EVENTS]'),
  );
}

/** The parent owns the whole seam; card children must suppress their top margins. */
export function getSubscriptionCardSeam(
  previousIsCard: boolean,
  currentIsCard: boolean,
): SubscriptionCardSeam | undefined {
  if (previousIsCard && currentIsCard) return 'cards';
  if (previousIsCard || currentIsCard) return 'content';
  return undefined;
}
