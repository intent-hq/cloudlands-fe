<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  interface Props {
    monospace?: boolean;
    agentName?: string;
    conversationWidth?: number;
    chiefWorkspace?: boolean;
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
      conversation: { props: { conversationWidth: 560 } },
      'conversation-narrow': { props: { conversationWidth: 320 } },
      'conversation-wide': { props: { conversationWidth: 720 } },
      'conversation-chief': { props: { conversationWidth: 560, chiefWorkspace: true } },
    },
  });
</script>

<script lang="ts">
  import type { AgentMessage } from '$shared/types';
  import ChatMessage from './ChatMessage.svelte';
  import EventWakeupBanner from './EventWakeupBanner.svelte';
  import ChatPanelOperationalGeometryHost from './__tests__/ChatPanelOperationalGeometryHost.svelte';

  let {
    monospace = false,
    agentName = 'Builder',
    conversationWidth,
    chiefWorkspace = false,
  }: Props = $props();
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
  const conversationMessages: AgentMessage[] = [
    {
      id: 'alignment-human',
      role: 'user',
      timestamp,
      contentBlocks: [{ type: 'text', text: 'Keep the chat cards lined up.' }],
    },
    {
      id: 'alignment-agent',
      role: 'user',
      timestamp,
      contentBlocks: [{ type: 'text', text: 'The layout review is ready.' }],
      metadata: {
        type: 'agent_message',
        fromAgentId: 'alignment-reviewer',
        fromAgentName: 'Review chat alignment and narrow columns',
      },
    },
    {
      id: 'alignment-hook',
      role: 'user',
      timestamp,
      contentBlocks: [{ type: 'text', text: 'The build has completed. Review the result.' }],
      metadata: {
        type: 'hook_wake',
        hookId: 'alignment-build',
        hookName: 'Wait for build',
        reason: 'dispatched',
      },
    },
    {
      id: 'alignment-pr',
      role: 'user',
      timestamp,
      contentBlocks: [{ type: 'text', text: 'All required checks passed.' }],
      metadata: { type: 'pr_monitor_wake', repo: 'intent-hq/intent', prNumber: 42 },
    },
    ...[1, 6].map((eventCount): AgentMessage => ({
      id: `alignment-events-${eventCount}`,
      role: 'user',
      timestamp,
      contentBlocks: [{ type: 'text', text: '[WORKSPACE EVENTS]' }],
      metadata: {
        type: 'event_notification',
        eventCount,
        eventTypes: ['agent:idle'],
        events: Array.from({ length: eventCount }, (_, index) => ({
          type: 'agent:idle',
          timestamp,
          data: {
            agentId: `alignment-worker-${index}`,
            agentName: index === 0 ? 'Builder' : `Reviewer ${index}`,
            completionReport: 'The chat layout review is complete and ready to inspect.',
          },
        })),
      },
    })),
    {
      id: 'alignment-human-followup',
      role: 'user',
      timestamp,
      contentBlocks: [{ type: 'text', text: 'Thanks, show me the result.' }],
    },
  ];
</script>

{#if conversationWidth}
  <ChatPanelOperationalGeometryHost
    width={conversationWidth}
    height={700}
    cardSeamMessages={conversationMessages}
    {chiefWorkspace}
  />
{:else}
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
{/if}
