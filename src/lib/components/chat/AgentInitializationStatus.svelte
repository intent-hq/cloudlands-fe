<script lang="ts">
  import { onMount } from 'svelte';

  interface Props {
    step?: string;
    message?: string;
    visible?: boolean;
  }

  let { step = '', message = '', visible = false }: Props = $props();

  let displayedMessage = $state('');
  let showAnimation = $state(false);
  let delayTimer: ReturnType<typeof setTimeout> | null = null;

  onMount(() => {
    return () => {
      if (delayTimer) clearTimeout(delayTimer);
    };
  });

  $effect(() => {
    if (visible && message) {
      // Clear any existing timer
      if (delayTimer) clearTimeout(delayTimer);

      // Add a small delay before showing to avoid flashing
      delayTimer = setTimeout(() => {
        displayedMessage = message;
        showAnimation = true;
        delayTimer = null;
      }, 500);
    } else {
      if (delayTimer) clearTimeout(delayTimer);
      delayTimer = null;
      showAnimation = false;
      displayedMessage = '';
    }
  });
</script>

{#if showAnimation && displayedMessage}
  <div class="relative overflow-hidden">
    <p class="text-xs text-subtle animate-fade-in">
      {displayedMessage}
    </p>
    {#if step !== 'complete' && step !== 'error'}
      <div class="absolute inset-0 pointer-events-none animate-shimmer shimmer-gradient"></div>
    {/if}
  </div>
{/if}

<style>
  /* Shimmer gradient - uses CSS color-mix that can't be done in Tailwind */
  .shimmer-gradient {
    background: linear-gradient(
      90deg,
      transparent,
      color-mix(in srgb, var(--color-sidebar) 60%, transparent),
      transparent
    );
  }
</style>
