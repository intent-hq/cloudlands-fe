<script lang="ts">
  import type { SubscriptionCardSeam } from './subscription-card-spacing';

  interface Props {
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

  let {
    currentIsEventNotification,
    currentHasAssistantMessages,
    nextIsEventNotification,
    nextHasUserMessage = false,
    compactOperationalSeam = false,
    zeroToolSeam = false,
    batchedDeliverySeam = false,
    attentionQuestionAnswerSeam = false,
    subscriptionCardSeam,
  }: Props = $props();

  // The structured attention-to-answer seam is intentionally wider than a
  // generic batch seam. Otherwise batchedDeliverySeam wins over the event branches on both
  // sides: rows sharing a queueInfo.batchId (one batch flush) read as one
  // delivery, whether they are plain user messages or wake cards.
  const gapClass = $derived(
    attentionQuestionAnswerSeam
      ? 'h-6'
      : batchedDeliverySeam
        ? 'h-2'
        : subscriptionCardSeam
          ? subscriptionCardSeam === 'cards'
            ? 'h-2'
            : 'h-6'
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
                    : 'h-8',
  );
</script>

<div
  class={gapClass}
  data-testid="conversation-turn-gap"
  data-subscription-card-seam={subscriptionCardSeam}
  data-gap-before-wake={nextIsEventNotification && !batchedDeliverySeam ? '' : undefined}
  data-operational-seam={compactOperationalSeam ? 'true' : undefined}
  data-tool-seam={zeroToolSeam ? 'true' : undefined}
  data-batched-seam={batchedDeliverySeam ? 'true' : undefined}
  data-attention-answer-seam={attentionQuestionAnswerSeam ? 'true' : undefined}
  aria-hidden="true"
></div>
