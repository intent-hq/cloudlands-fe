<!--
  StreamingTypingIndicator.svelte

  A polished, animated typing indicator for streaming messages.
  Uses the shared Intent mark loader in the operational leading slot.
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { m } from '$shared/paraglide/messages.js';
  import {
    IntentMarkLoader,
    intentMarkMotionTiming,
    type IntentMarkVariant,
  } from '$lib/components/ui/indicators';
  import {
    CHAT_OPERATIONAL_LEADING_CLASS,
    CHAT_OPERATIONAL_ROW_CLASS,
    CHAT_OPERATIONAL_SUMMARY_CLASS,
  } from './operational-disclosure-row';

  interface Props {
    visible?: boolean;
    message?: string;
    lifecycleMessage?: string | null;
    elapsed?: string | null;
    variant?: IntentMarkVariant;
    class?: string;
    /** Compact mode - shows only spinner without message */
    compact?: boolean;
    /** Seed for spinner colors (e.g., agent ID) */
    seed?: string;
  }

  let {
    visible = false,
    message = m.chat_streamingStatus_thinking_label(),
    lifecycleMessage = null,
    elapsed = null,
    variant = 'bloom',
    class: className = '',
    compact = false,
    seed: _seed = 'default',
  }: Props = $props();

  const hideMs = 150;
  const settlementHoldMs = intentMarkMotionTiming.settleMs + 20;
  let rendered = $state(false);
  let hideTimer: number | undefined;

  $effect.pre(() => {
    if (visible) {
      if (hideTimer !== undefined) window.clearTimeout(hideTimer);
      hideTimer = undefined;
      rendered = true;
    } else if (rendered && hideTimer === undefined) {
      hideTimer = window.setTimeout(() => {
        hideTimer = undefined;
        if (!visible) rendered = false;
      });
    }
  });

  onDestroy(() => {
    if (hideTimer !== undefined) window.clearTimeout(hideTimer);
  });

  function settleAndFade(node: Element) {
    return fade(node, {
      duration: settlementHoldMs,
      easing: (progress) => cubicOut(Math.min(1, (progress * settlementHoldMs) / hideMs)),
    });
  }
</script>

{#if rendered}
  <div
    class="{CHAT_OPERATIONAL_ROW_CLASS} group font-family-child font-normal text-muted-foreground {className}"
    data-streaming-typing-row
    aria-hidden={!visible}
    in:fade={{ duration: 200, easing: cubicOut }}
    out:settleAndFade
  >
    <div class={CHAT_OPERATIONAL_LEADING_CLASS} data-operational-leading>
      <IntentMarkLoader {variant} size={16} playing={visible} />
    </div>

    <!-- Message text -->
    {#if !compact && message}
      <span
        class={CHAT_OPERATIONAL_SUMMARY_CLASS}
        data-operational-summary
        data-testid="streaming-status-thinking"
      >
        <span
          class="inline-flex min-w-0 max-w-full items-baseline gap-[0.5ch]"
          data-testid="streaming-status-copy"
          ><span
            class="shrink-0 font-normal text-foreground"
            data-testid="streaming-status-thinking-label">{message}</span
          >{#if lifecycleMessage}<span
              class="min-w-0 truncate font-normal text-muted-foreground"
              data-testid="streaming-status-phase">{lifecycleMessage}</span
            >{/if}</span
        >
      </span>
    {/if}

    {#if elapsed}
      <span
        class="type-caption pointer-events-none opacity-0 transition-opacity duration-[var(--motion-fast)] group-hover:opacity-100 motion-reduce:transition-none"
        aria-live="off"
        data-testid="streaming-status-elapsed">{elapsed}</span
      >
    {/if}
  </div>
{/if}
