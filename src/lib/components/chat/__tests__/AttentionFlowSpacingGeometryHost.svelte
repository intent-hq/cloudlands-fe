<script lang="ts">
  import type { AgentMessage } from '$shared/types';
  import { isBatchedDeliverySeam } from '$lib/utils/queue-info';
  import ConversationTurnGap from '../ConversationTurnGap.svelte';
  import {
    eventCardAssistantMarginClass,
    isAttentionQuestionAnswerSeam,
  } from '../attention-flow-spacing';

  interface Props {
    theme?: 'light' | 'dark';
    width?: number;
    zoom?: number;
    scenario?: 'attention-answer' | 'ordinary-batch' | 'malformed-answer';
  }

  let { theme = 'light', width = 720, zoom = 1, scenario = 'attention-answer' }: Props = $props();

  const batch = { batchId: 'attention-batch' };
  const currentMessage = $derived({
    id: 'current',
    role: 'user',
    timestamp: '2026-08-25T00:00:00.000Z',
    contentBlocks: [],
    metadata: {
      type: 'event_notification',
      events: [
        scenario === 'ordinary-batch'
          ? { type: 'agent:idle', data: { agentId: 'agent-1' } }
          : {
              type: 'agent:attention-requested',
              data: { agentId: 'agent-1', kind: 'discussion', reason: 'Choose an option' },
            },
      ],
      queueInfo: batch,
    },
  } as AgentMessage);
  const nextMessage = $derived({
    id: 'next',
    role: 'user',
    timestamp: '2026-08-25T00:00:01.000Z',
    contentBlocks: [],
    metadata: {
      type: 'question_answers',
      answeredQuestionsMessageId: scenario === 'malformed-answer' ? '' : 'questions-1',
      queueInfo: batch,
    },
  } as AgentMessage);
  const currentTurn = $derived({ userMessage: currentMessage, assistantMessages: [] });
  const nextTurn = $derived({ userMessage: nextMessage, assistantMessages: [] });
  const attentionAnswerSeam = $derived(isAttentionQuestionAnswerSeam(currentTurn, nextTurn));
  const batchSeam = $derived(!attentionAnswerSeam && isBatchedDeliverySeam(currentTurn, nextTurn));
</script>

<section class:dark={theme === 'dark'} style:width="{width}px" style:zoom>
  <div class="bg-background p-6 text-foreground" data-scenario={scenario}>
    <div data-testid="within-turn-lane">
      <div class={eventCardAssistantMarginClass(currentMessage, true)}>
        <div class="h-9 rounded-lg border border-border bg-card" data-testid="attention-card"></div>
      </div>
      <div class="h-7" data-testid="finished-operational-row">Finished</div>
    </div>

    <div class="mt-8" data-testid="turn-seam-lane">
      <div class="h-7" data-testid="seam-finished-row">Finished</div>
      <ConversationTurnGap
        currentIsEventNotification
        currentHasAssistantMessages={false}
        nextIsEventNotification={false}
        nextHasUserMessage
        batchedDeliverySeam={batchSeam}
        attentionQuestionAnswerSeam={attentionAnswerSeam}
      />
      <div class="h-9 rounded-lg bg-sidebar" data-testid="question-answer-card">Answers</div>
    </div>
  </div>
</section>
