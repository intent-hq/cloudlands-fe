<script lang="ts">
  import { extractAllContent, type AgentMessage } from '$shared/types';
  import PinnedUserPrompt from '$lib/components/chat/PinnedUserPrompt.svelte';
  import EventWakeupBanner from '$lib/components/chat/EventWakeupBanner.svelte';
  import ConversationTurnGap from '$lib/components/chat/ConversationTurnGap.svelte';
  import {
    attachPinnedPromptMessage,
    trackPinnedPrompt,
    type PinnedPromptState,
  } from '$lib/components/chat/pinned-prompt';
  import {
    USER_MESSAGE_SURFACE_CLASS,
    USER_MESSAGE_TEXT_CLASS,
  } from '$lib/components/chat/user-message-surface';

  interface Props {
    panelId: string;
    theme?: 'light' | 'dark';
    width?: number;
    zoom?: number;
    streamText?: string;
    paginationHeight?: number;
    finishedVariant?: 'agent:idle' | 'agent:reportToParent';
    labelLength?: 'short' | 'long';
  }

  let {
    panelId,
    theme = 'light',
    width = 720,
    zoom = 1,
    streamText = 'Pinned prompt',
    paginationHeight = 0,
    finishedVariant = 'agent:idle',
    labelLength = 'short',
  }: Props = $props();
  let pinned = $state<PinnedPromptState | null>(null);
  let message = $derived({
    id: `${panelId}-prompt`,
    role: 'user',
    contentBlocks: [{ type: 'text', text: streamText }],
  } as AgentMessage);
  const finishedAgentName = $derived(
    labelLength === 'long'
      ? 'A finished agent with an intentionally long transcript disclosure label'
      : 'Builder',
  );
  const finishedMetadata = $derived({
    type: 'event_notification' as const,
    eventCount: 1,
    eventTypes: [finishedVariant],
    events: [
      {
        type: finishedVariant,
        data: {
          agentName: finishedAgentName,
          completionReport:
            labelLength === 'long'
              ? 'A long completion report that wraps across multiple lines in narrow transcript columns.'
              : 'Done',
        },
        timestamp: '2026-08-15T12:00:00.000Z',
      },
    ],
  });
</script>

<section class:dark={theme === 'dark'} style:width="{width}px" style:zoom data-panel={panelId}>
  <div class="grid grid-cols-2 gap-4 bg-background p-4 text-foreground">
    <div data-testid="sent-card" class={USER_MESSAGE_SURFACE_CLASS}>
      <span data-testid="ordinary-user-text" class={USER_MESSAGE_TEXT_CLASS}>
        Sent message <a data-testid="ordinary-user-link" href="#message">link</a>
        <code data-testid="ordinary-user-code">code</code>
      </span>
    </div>
    <div>
      <EventWakeupBanner
        metadata={finishedMetadata}
        asDivider
        showAgentCards={false}
        workspace={null}
      />
      <ConversationTurnGap
        currentIsEventNotification
        currentHasAssistantMessages={false}
        nextIsEventNotification={false}
      />
      <div data-testid="following-transcript-row">Following transcript content</div>
    </div>
  </div>
  <div class="relative">
    <div class="pointer-events-none absolute inset-x-0 top-0 z-40 px-4 sm:px-6">
      {#if pinned}
        <PinnedUserPrompt text={extractAllContent(pinned.message)} onActivate={() => {}} />
      {/if}
    </div>
    <div
      data-testid="sticky-scroll"
      class="h-[420px] overflow-y-auto"
      use:trackPinnedPrompt={{ enabled: true, onChange: (next) => (pinned = next) }}
    >
      <div style:height="{paginationHeight}px"></div>
      <div data-conversation-turn class="h-[900px] pt-[260px]">
        <div
          data-pinnable-user-prompt
          data-pinned-prompt-id={message.id}
          use:attachPinnedPromptMessage={message}
          class="h-12"
        >
          {streamText}
        </div>
      </div>
    </div>
  </div>
</section>
