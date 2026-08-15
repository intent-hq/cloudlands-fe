<script lang="ts">
  import ScrollToBottomButton from '../ScrollToBottomButton.svelte';
  import MessageActions from '../MessageActions.svelte';
  import { followBottom, followToBottom } from '$lib/utils/smartScroll';

  interface Props {
    theme?: 'light' | 'dark';
    width?: number;
    zoom?: number;
  }

  let { theme = 'light', width = 720, zoom = 1 }: Props = $props();
  let clicked = $state(0);
  let follow = $state(false);
  let scrollContainer = $state<HTMLElement>();
  let subscriptionMounted = $state(false);
  let subscriptionHeight = $state(48);

  function handleBottomClick() {
    clicked += 1;
    follow = true;
    if (scrollContainer) followToBottom(scrollContainer);
  }

  function mountSubscriptionLater() {
    setTimeout(() => (subscriptionMounted = true), 40);
  }

  function noop() {}
</script>

<section
  class="relative h-[280px] bg-background text-foreground"
  class:dark={theme === 'dark'}
  style:width="{width}px"
  style:zoom
  data-testid="scroll-arrow-host"
>
  <button type="button" data-testid="focus-before" class="absolute left-2 top-2">Before</button>
  <div
    class="absolute bottom-2 h-9"
    style:left="{width < 640 ? 16 : 24}px"
    style:right="{width < 640 ? 16 : 24}px"
    data-testid="assistant-message-row"
  >
    <MessageActions
      role="assistant"
      onRegenerate={noop}
      onFork={noop}
      onVote={noop}
      onCopy={noop}
      timestamp="2026-08-15T12:00:00.000Z"
      showOnHover={false}
      class="absolute bottom-0 right-0 z-10"
    />
  </div>
  <div
    bind:this={scrollContainer}
    use:followBottom={{ follow, onFollowChange: (next) => (follow = next) }}
    data-testid="bottom-follow-scroll"
    class="h-[220px] overflow-y-auto"
    role="region"
    aria-label="Bottom follow test fixture"
    tabindex="-1"
  >
    <div class="h-[360px]" data-testid="transcript-content"></div>
    <div data-testid="transcript-utility-stack">
      {#if subscriptionMounted}
        <div
          data-testid="delayed-subscription"
          class="bg-muted"
          style:height="{subscriptionHeight}px"
        ></div>
      {/if}
    </div>
    <div data-testid="final-spacer" class="h-6"></div>
  </div>
  <button
    type="button"
    data-testid="mount-subscription"
    tabindex="-1"
    onclick={mountSubscriptionLater}>Mount</button
  >
  <button
    type="button"
    data-testid="expand-subscription"
    tabindex="-1"
    onclick={() => (subscriptionHeight = subscriptionHeight === 180 ? 260 : 180)}>Expand</button
  >
  <output data-testid="follow-state" class="sr-only">{follow}</output>
  <ScrollToBottomButton onclick={handleBottomClick} />
  <output data-testid="arrow-click-count" class="sr-only">{clicked}</output>
</section>
