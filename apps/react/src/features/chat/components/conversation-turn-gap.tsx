// Source: src/lib/components/chat/ConversationTurnGap.svelte.
import type { SubscriptionCardSeam } from '$lib/components/chat/subscription-card-spacing-types';

export interface ConversationTurnGapProps {
  currentIsEventNotification: boolean;
  currentHasAssistantMessages: boolean;
  nextIsEventNotification: boolean;
  nextHasUserMessage?: boolean;
  compactOperationalSeam?: boolean;
  zeroToolSeam?: boolean;
  batchedDeliverySeam?: boolean;
  attentionQuestionAnswerSeam?: boolean;
  subscriptionCardSeam?: SubscriptionCardSeam;
}

export function ConversationTurnGap({
  currentIsEventNotification,
  currentHasAssistantMessages,
  nextIsEventNotification,
  nextHasUserMessage = false,
  compactOperationalSeam = false,
  zeroToolSeam = false,
  batchedDeliverySeam = false,
  attentionQuestionAnswerSeam = false,
  subscriptionCardSeam,
}: ConversationTurnGapProps) {
  // Filled cards own the seam; attention-to-answer flows retain their distinct spacing.
  const gapClass = attentionQuestionAnswerSeam
    ? 'h-6'
    : subscriptionCardSeam
      ? subscriptionCardSeam === 'cards'
        ? 'h-4'
        : 'h-6'
      : batchedDeliverySeam
        ? 'h-2'
        : zeroToolSeam
          ? 'h-0'
          : compactOperationalSeam
            ? 'h-2'
            : nextIsEventNotification
              ? 'h-0'
              : nextHasUserMessage
                ? 'h-10'
                : currentIsEventNotification && !currentHasAssistantMessages
                  ? 'h-8'
                  : 'h-8';

  return (
    <div
      className={gapClass}
      data-testid="conversation-turn-gap"
      data-subscription-card-seam={subscriptionCardSeam}
      data-gap-before-wake={nextIsEventNotification && !batchedDeliverySeam ? '' : undefined}
      data-operational-seam={compactOperationalSeam ? 'true' : undefined}
      data-tool-seam={zeroToolSeam ? 'true' : undefined}
      data-batched-seam={batchedDeliverySeam ? 'true' : undefined}
      data-attention-answer-seam={attentionQuestionAnswerSeam ? 'true' : undefined}
      aria-hidden="true"
    />
  );
}

export default ConversationTurnGap;
