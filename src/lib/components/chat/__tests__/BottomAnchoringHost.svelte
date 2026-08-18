<script lang="ts">
  import { onMount } from 'svelte';
  import {
    beforeFollowBottomMutation,
    followBottom,
    followToBottom,
    type FollowBottomState,
  } from '$lib/utils/smartScroll';
  import { createHeightLedger } from '../lazy-turn-scroll-ledger';

  interface Props {
    theme?: 'light' | 'dark';
    width?: number;
    zoom?: number;
    messageCount?: number;
    streamHeight?: number;
    subscriptionVisible?: boolean;
    subscriptionExpanded?: boolean;
    queueCount?: number;
    queueExpanded?: boolean;
    queueEditing?: boolean;
    composerHeight?: number;
    disclosureExpanded?: boolean;
    virtualHeight?: number;
    streamingActive?: boolean;
    reflowingContent?: boolean;
  }

  let {
    theme = 'light',
    width = 720,
    zoom = 1,
    messageCount = 2,
    streamHeight = 48,
    subscriptionVisible = true,
    subscriptionExpanded = true,
    queueCount = 2,
    queueExpanded = true,
    queueEditing = false,
    composerHeight = 72,
    disclosureExpanded = false,
    virtualHeight = 180,
    streamingActive = false,
    reflowingContent = false,
  }: Props = $props();
  let scrollRoot = $state<HTMLDivElement>();
  let virtualTurn = $state<HTMLDivElement>();
  let stream = $state<HTMLDivElement>();
  let follow = $state(true);
  let distance = $state(0);
  const ledger = createHeightLedger(
    () => scrollRoot,
    () => virtualTurn,
  );

  function report(state: FollowBottomState) {
    distance = state.distanceFromBottom;
  }

  function relock() {
    if (scrollRoot) followToBottom(scrollRoot);
  }

  $effect(() => {
    if (!streamingActive || !stream) return;
    const mutation = beforeFollowBottomMutation(stream);
    return () => mutation.settle();
  });

  onMount(() => {
    if (!virtualTurn) return;
    ledger.account();
    const observer = new ResizeObserver(() => ledger.account());
    observer.observe(virtualTurn);
    return () => observer.disconnect();
  });
</script>

<section
  class="flex h-[520px] flex-col overflow-hidden bg-background text-foreground"
  class:dark={theme === 'dark'}
  style:width="{width}px"
  style:zoom
  data-testid="bottom-anchor-host"
>
  <header class="h-10 shrink-0 border-b border-border px-3 py-2">
    <span data-testid="bottom-state">{follow ? 'locked' : 'unlocked'}:{distance}</span>
    <button data-testid="relock" onclick={relock}>Follow bottom</button>
  </header>
  <div
    bind:this={scrollRoot}
    use:followBottom={{
      follow,
      threshold: 100,
      onFollowChange: (next) => (follow = next),
      onScrollStateChange: report,
    }}
    class="min-h-0 flex-1 overflow-y-auto"
    data-testid="transcript"
    tabindex="0"
  >
    <div bind:this={virtualTurn} data-testid="virtual-turn" style:height="{virtualHeight}px"></div>
    {#each Array(6) as _, index}
      <div
        class="border-b border-border/30 px-4 py-3"
        class:h-36={!reflowingContent}
        data-testid={`fixed-${index}`}
      >
        Historical turn {index}{reflowingContent
          ? ' contains enough transcript text to wrap across several lines when an adjacent panel opens and narrows the active chat column. The visible reading position must remain stable during that reflow.'
          : ''}
      </div>
    {/each}
    <div data-testid="visible-anchor" class="h-20 px-4 py-3">Visible anchor</div>
    {#each Array(messageCount) as _, index}
      <div class="h-16 px-4 py-3" data-testid={`sent-${index}`}>Sent message {index}</div>
    {/each}
    <div
      bind:this={stream}
      class="overflow-hidden bg-muted/20 transition-[height] duration-200"
      data-testid="stream"
      style:height="{streamHeight}px"
    ></div>
    <div
      class="overflow-hidden transition-[height] duration-200"
      data-testid="response-disclosure"
      style:height="{disclosureExpanded ? 180 : 40}px"
    ></div>
    <div
      class="overflow-hidden transition-[height] duration-200"
      data-testid="subscription"
      style:height="{subscriptionVisible ? (subscriptionExpanded ? 150 : 36) : 0}px"
    ></div>
    <div
      class="overflow-hidden transition-[height] duration-200"
      data-testid="queue"
      style:height="{queueCount === 0
        ? 0
        : queueExpanded
          ? 34 + queueCount * 42 + (queueEditing ? 72 : 0)
          : 34}px"
    ></div>
  </div>
  <div
    class="shrink-0 border-t border-border transition-[height] duration-200"
    data-testid="composer"
    style:height="{composerHeight}px"
  ></div>
</section>
