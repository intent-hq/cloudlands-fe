<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  interface Props {
    monospace?: boolean;
    agentName?: string;
  }

  export const preview = definePreview<Props>({
    id: 'chat-activity-typography',
    title: 'Chat activity typography',
    defaultState: 'system',
    states: {
      system: { props: { monospace: false } },
      monospace: { props: { monospace: true } },
      'long-name': {
        props: { agentName: 'Onboarding provider cards and workspace configuration' },
      },
    },
  });
</script>

<script lang="ts">
  import type { AgentMessage } from '$shared/types';
  import ChatMessage from './ChatMessage.svelte';
  import EventWakeupBanner from './EventWakeupBanner.svelte';

  let { monospace = false, agentName = 'Builder' }: Props = $props();
  const timestamp = '2026-09-16T12:00:00.000Z';
  const message: AgentMessage = $derived({
    id: 'activity-typography-message',
    role: 'user',
    timestamp,
    contentBlocks: [
      { type: 'text', text: 'Review the activity rows and keep the message readable.' },
    ],
    metadata: {
      type: 'agent_message',
      fromAgentId: 'activity-typography-sender',
      fromAgentName: agentName,
    },
  });
  const eventTypes = ['agent:idle', 'agent:reportToParent', 'agent:attention-requested'];
</script>

<section
  class="w-full min-w-0 bg-background p-4 text-foreground"
  class:agent-font-monospace={monospace}
  data-testid="chat-activity-typography-preview"
>
  <ChatMessage {message} />
  <div class="mt-3 flex min-w-0 flex-col gap-3">
    {#each eventTypes as type}
      <div data-activity-type={type}>
        <EventWakeupBanner
          metadata={{
            type: 'event_notification',
            eventCount: 1,
            eventTypes: [type],
            events: [
              {
                type,
                timestamp,
                data: { agentName: 'Builder', completionReport: 'The activity review is ready.' },
              },
            ],
          }}
          asDivider
          suppressTopGap
          showAgentCards={false}
        />
      </div>
    {/each}
  </div>
</section>
