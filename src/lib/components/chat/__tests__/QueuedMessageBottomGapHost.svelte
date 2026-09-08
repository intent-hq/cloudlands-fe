<script lang="ts">
  import QueuedMessageList from '../QueuedMessageList.svelte';
  import { followBottom, type FollowBottomState } from '$lib/utils/smartScroll';
  import type { QueuedMessage } from '$shared/types';
  import {
    CHAT_SCROLL_END_MARKER_CLASS,
    CHAT_TRANSCRIPT_OVERFLOW_CLASS,
    chatTranscriptBottomInsetClass,
  } from '../chat-queue-edge-layout';

  interface Props {
    theme?: 'light' | 'dark';
    width?: number;
    zoom?: number;
    queueCount?: number;
    reverse?: boolean;
    saveDelayMs?: number;
  }

  let {
    theme = 'light',
    width = 720,
    zoom = 1,
    queueCount = 0,
    reverse = false,
    saveDelayMs = 0,
  }: Props = $props();
  let removedIds = $state<string[]>([]);
  let following = $state(true);
  let distance = $state(0);
  const compact = $derived(width <= 320);
  const messages = $derived.by((): QueuedMessage[] => {
    const next = Array.from({ length: queueCount }, (_, position) => ({
      id: `queue-${position}`,
      content: `Queued message ${position + 1}`,
      queuedAt: `2026-08-17T00:00:0${position}.000Z`,
      position,
    }));
    return (reverse ? next.reverse() : next).filter(({ id }) => !removedIds.includes(id));
  });
  const bottomInsetClass = $derived(
    chatTranscriptBottomInsetClass({
      isChiefWorkspace: false,
      isCompactMode: compact,
      showQueue: messages.length > 0,
    }),
  );

  function reportBottom(state: FollowBottomState) {
    distance = state.distanceFromBottom;
  }

  async function editMessage(_id: string, _content: string, editing?: boolean) {
    if (!editing && saveDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, saveDelayMs));
    }
    return { success: true };
  }
</script>

<section
  class="flex h-[480px] flex-col overflow-hidden bg-background text-foreground"
  class:dark={theme === 'dark'}
  style:width="{width}px"
  style:zoom
  data-testid="queued-bottom-gap-host"
>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (keyboard-scroll regression target) -->
  <div
    use:followBottom={{
      follow: following,
      threshold: 100,
      layoutNeutralBottomAnchor: true,
      onFollowChange: (next) => (following = next),
      onScrollStateChange: reportBottom,
    }}
    class="min-h-0 flex-1 {CHAT_TRANSCRIPT_OVERFLOW_CLASS}"
    style="overflow-anchor: none;"
    data-testid="queued-gap-transcript"
    role="region"
    aria-label="Queued message geometry transcript"
    tabindex="0"
  >
    <div
      class="conversation-column flex min-h-full w-full flex-col px-4 pt-2 sm:px-6 {bottomInsetClass}"
      data-testid="queued-gap-column"
    >
      <div class="h-[520px] shrink-0" data-testid="queued-gap-history"></div>
      <div class="mt-auto" data-testid="transcript-utility-stack">
        {#if messages.length > 0}
          <div class="relative z-20 mt-6 w-full" data-testid="queued-message-utility-area">
            <QueuedMessageList
              {messages}
              onedit={editMessage}
              onremove={(id) => (removedIds = [...removedIds, id])}
            />
          </div>
        {/if}
      </div>
      <div class={CHAT_SCROLL_END_MARKER_CLASS} data-testid="chat-scroll-end-marker"></div>
    </div>
  </div>
  <div class="h-16 shrink-0 border-t border-border" data-testid="queued-gap-composer"></div>
  <output hidden data-testid="queued-gap-bottom-state"
    >{following ? 'locked' : 'unlocked'}:{distance}</output
  >
</section>
