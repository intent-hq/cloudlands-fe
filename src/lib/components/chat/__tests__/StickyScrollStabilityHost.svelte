<script lang="ts">
  import type { AgentMessage } from '$shared/types';
  import {
    attachPinnedPromptMessage,
    trackPinnedPrompt,
    type PinnedPromptState,
  } from '../pinned-prompt';
  import { USER_MESSAGE_SURFACE_CLASS } from '../user-message-surface';

  interface Props {
    theme?: 'light' | 'dark';
    width?: number;
    zoom?: number;
    promptHeights?: number[];
    responseHeight?: number;
    streamGrowth?: number;
    tailHeight?: number;
  }

  let {
    theme = 'light',
    width = 720,
    zoom = 1,
    promptHeights = [44, 116, 68],
    responseHeight = 300,
    streamGrowth = 0,
    tailHeight = 320,
  }: Props = $props();
  let pinned = $state<PinnedPromptState | null>(null);
  const messages = $derived(
    promptHeights.map(
      (_, index) =>
        ({
          id: `prompt-${index}`,
          role: 'user',
          contentBlocks: [{ type: 'text', text: `Prompt ${index}` }],
        }) as AgentMessage,
    ),
  );
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
        <div data-testid="pinned-user-prompt" class="rounded-md bg-card px-3 py-2 shadow-sm">
          Pinned {pinned.id}
        </div>
      {/if}
    </div>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (keyboard-scroll test target) -->
    <div
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
            data-pinnable-user-prompt
            data-pinned-prompt-id={message.id}
            data-testid={`source-${index}`}
            class="message-nav-target relative z-20 mb-8"
            style:height="{promptHeights[index]}px"
            use:attachPinnedPromptMessage={message}
          >
            <div class="h-full overflow-hidden {USER_MESSAGE_SURFACE_CLASS}">
              Prompt {index}
            </div>
          </div>
          <div
            data-testid={`anchor-${index}`}
            class="bg-muted/20"
            style:height="{responseHeight + (index === 0 ? streamGrowth : 0)}px"
          >
            Anchor {index}
          </div>
        </div>
      {/each}
      <div data-testid="tail" style:height="{tailHeight}px"></div>
    </div>
  </div>
</section>
