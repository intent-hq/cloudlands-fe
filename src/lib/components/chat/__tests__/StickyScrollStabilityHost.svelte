<script lang="ts">
  import type { AgentMessage } from '$shared/types';
  import {
    attachPinnedPromptMessage,
    trackPinnedPrompt,
    type PinnedPromptState,
  } from '../pinned-prompt';
  import { USER_MESSAGE_SURFACE_CLASS } from '../user-message-surface';
  import PinnedTurnPrompt from '../PinnedTurnPrompt.svelte';
  import EventWakeupBanner from '../EventWakeupBanner.svelte';
  import ChatMessage from '../ChatMessage.svelte';
  import { isEventWakeMessage } from '../event-wake-summary';
  import type { ComponentProps } from 'svelte';

  interface Props {
    theme?: 'light' | 'dark';
    width?: number;
    zoom?: number;
    promptHeights?: number[];
    responseHeight?: number;
    streamGrowth?: number;
    tailHeight?: number;
    turnMessages?: AgentMessage[];
  }

  let {
    theme = 'light',
    width = 720,
    zoom = 1,
    promptHeights = [44, 116, 68],
    responseHeight = 300,
    streamGrowth = 0,
    tailHeight = 320,
    turnMessages,
  }: Props = $props();
  let pinned = $state<PinnedPromptState | null>(null);
  const messages = $derived(
    turnMessages ??
      promptHeights.map(
        (_, index) =>
          ({
            id: `prompt-${index}`,
            role: 'user',
            contentBlocks: [{ type: 'text', text: `Prompt ${index}` }],
          }) as AgentMessage,
      ),
  );
  let scrollContainer: HTMLDivElement;
  function returnToSource() {
    if (!pinned) return;
    const source = scrollContainer.querySelector<HTMLElement>(
      `[data-pinned-prompt-id="${CSS.escape(pinned.id)}"]`,
    );
    if (source)
      scrollContainer.scrollTop +=
        source.getBoundingClientRect().top - scrollContainer.getBoundingClientRect().top;
    pinned = null;
  }
</script>

<section
  class="group/panel relative bg-background text-foreground"
  class:dark={theme === 'dark'}
  style:width="{width}px"
  style:zoom
  data-testid="sticky-stability-host"
>
  <div class="relative h-[280px]">
    <div class="pointer-events-none absolute inset-x-0 top-0 z-40 px-4">
      {#if pinned}
        {#if turnMessages}
          <PinnedTurnPrompt message={pinned.message} onActivate={returnToSource} />
        {:else}
          <div data-testid="pinned-user-prompt" class="rounded-md bg-card px-3 py-2 shadow-sm">
            Pinned {pinned.id}
          </div>
        {/if}
      {/if}
    </div>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (keyboard-scroll test target) -->
    <div
      bind:this={scrollContainer}
      data-testid="sticky-scroll"
      class="h-full overflow-y-auto px-4"
      style="scrollbar-gutter: stable; overflow-anchor: none;"
      role="region"
      aria-label="Sticky scroll test fixture"
      tabindex="0"
      use:trackPinnedPrompt={{ enabled: true, onChange: (next) => (pinned = next) }}
    >
      <div class="h-20" data-testid="leading-space"></div>
      {#each messages as message, index (message.id)}
        <div data-conversation-turn data-testid={`turn-${index}`} class="conversation-turn">
          <div
            data-pinned-prompt-id={message.id}
            data-testid={`source-${index}`}
            class="message-nav-target relative z-20 mb-8"
            style:height={turnMessages ? undefined : `${promptHeights[index]}px`}
            use:attachPinnedPromptMessage={message}
          >
            {#if turnMessages}
              {#if isEventWakeMessage(message)}
                <EventWakeupBanner
                  metadata={message.metadata as ComponentProps<
                    typeof EventWakeupBanner
                  >['metadata']}
                  asDivider={true}
                  suppressTopGap={true}
                  showAgentCards={false}
                />
              {:else}
                <ChatMessage {message} readOnly={true} suppressAutomatedWakeTopSpacing={true} />
              {/if}
            {:else}
              <div class="h-full overflow-hidden {USER_MESSAGE_SURFACE_CLASS}">
                Prompt {index}
              </div>
            {/if}
          </div>
          <div
            data-testid={`anchor-${index}`}
            class="bg-muted/20"
            style:height="{responseHeight + (index === 0 ? streamGrowth : 0)}px"
          >
            {#if turnMessages}
              <div class="px-3 py-3">
                <p class="mb-6 text-muted-foreground">Reasoning</p>
                <p class="mb-6">I’m checking the latest result and continuing the review.</p>
                <p class="mb-6 text-muted-foreground">
                  Inspect the chat layout and response context
                </p>
                <p>The trigger stays visible while this response continues below it.</p>
              </div>
            {:else}
              Anchor {index}
            {/if}
          </div>
        </div>
      {/each}
      <div data-testid="tail" style:height="{tailHeight}px"></div>
    </div>
  </div>
</section>
