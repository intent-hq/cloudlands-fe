<!--
  StreamingTypingIndicator.svelte

  A polished, animated typing indicator for streaming messages.
  Uses the shared Intent mark loader in the operational leading slot.
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { fade } from '$lib/motion';
  import { m } from '$shared/paraglide/messages.js';
  import { IntentMarkLoader, type IntentMarkVariant } from '$lib/components/ui/indicators';
  import {
    CHAT_OPERATIONAL_LEADING_CLASS,
    CHAT_OPERATIONAL_ROW_CLASS,
    CHAT_OPERATIONAL_SUMMARY_CLASS,
  } from './operational-disclosure-row';

  interface Props {
    visible?: boolean;
    message?: string;
    /** Keep the generic status available to assistive technology without repeating it visually. */
    showMessage?: boolean;
    lifecycleMessage?: string | null;
    elapsed?: string | null;
    /**
     * Called with `true` while the pointer is over the row and `false` when it
     * leaves or the row hides, so the owner can refresh the hover-only elapsed
     * text only while it can be seen.
     */
    onHoverChange?: (hovered: boolean) => void;
    variant?: IntentMarkVariant;
    class?: string;
    /** Compact mode - shows only the loading mark without message */
    compact?: boolean;
  }

  let {
    visible = false,
    message = m.chat_streamingStatus_thinking_label(),
    showMessage = true,
    lifecycleMessage = null,
    elapsed = null,
    onHoverChange,
    variant = 'bloom',
    class: className = '',
    compact = false,
  }: Props = $props();

  let rendered = $state(false);
  let hideTimer: number | undefined;
  let hovered = false;

  function setHovered(next: boolean) {
    if (hovered === next) return;
    hovered = next;
    onHoverChange?.(next);
  }

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

  $effect(() => {
    if (!rendered) setHovered(false);
  });

  onDestroy(() => {
    if (hideTimer !== undefined) window.clearTimeout(hideTimer);
    setHovered(false);
  });
</script>

{#if rendered}
  <div
    class="{CHAT_OPERATIONAL_ROW_CLASS} group font-family-child font-normal text-muted-foreground {className}"
    data-streaming-typing-row
    aria-hidden={!visible}
    onpointerenter={() => setHovered(true)}
    onpointerleave={() => setHovered(false)}
    in:fade={{ tier: 'moderate' }}
    out:fade={{ tier: 'moderate' }}
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
            class={showMessage ? 'shrink-0 font-normal text-foreground' : 'sr-only'}
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
