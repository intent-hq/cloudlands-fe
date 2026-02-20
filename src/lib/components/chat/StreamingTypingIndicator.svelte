<!--
  StreamingTypingIndicator.svelte

  A polished, animated typing indicator for streaming messages.
  Features animated squares using the AuggieAvatar color scheme.
-->
<script lang="ts">
  import { fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { Spinner } from '$lib/components/ui/indicators';

  interface Props {
    visible?: boolean;
    message?: string;
    class?: string;
    /** Compact mode - shows only spinner without message */
    compact?: boolean;
    /** Seed for spinner colors (e.g., agent ID) */
    seed?: string;
  }

  let {
    visible = false,
    message = 'Thinking',
    class: className = '',
    compact = false,
    seed = 'default',
  }: Props = $props();
</script>

{#if visible}
  <div
    class="flex items-center gap-2 text-muted-foreground py-1 pl-2 {className}"
    in:fade={{ duration: 200, easing: cubicOut }}
    out:fade={{ duration: 150, easing: cubicOut }}
  >
    <Spinner {seed} size={5} />

    <!-- Message text -->
    {#if !compact && message}
      <span class="text-xs text-muted-foreground/80 font-medium">{message}</span>
    {/if}
  </div>
{/if}
