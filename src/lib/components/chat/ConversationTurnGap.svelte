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

  // Filled cards use one rhythm regardless of author or delivery source.
  // Structured attention-to-answer flows keep their distinct 24px seam;
  // batching and operational fallbacks only apply outside card boundaries.
  const gapClass = $derived(
    attentionQuestionAnswerSeam
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
