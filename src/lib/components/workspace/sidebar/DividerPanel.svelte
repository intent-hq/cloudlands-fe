<script lang="ts">
  /**
   * DividerPanel - An expandable panel that appears below a DividerButton
   * Connects visually to the button above with matching border styling
   */
  import { slide } from '$lib/motion';
  import type { Snippet } from 'svelte';

  interface Props {
    open?: boolean;
    children?: Snippet;
  }

  let { open = false, children }: Props = $props();

  let panelRef: HTMLDivElement | undefined = $state();
  // Opening autofocus must not override a control the user has already chosen.
  $effect(() => {
    if (!open || !panelRef) return;
    const panel = panelRef;
    const initialFocus = document.activeElement;
    // Wait for the slide transition to complete (150ms).
    const timeout = setTimeout(() => {
      if (
        !panel.isConnected ||
        document.activeElement !== initialFocus ||
        panel.contains(document.activeElement)
      )
        return;
      panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      const firstInput = panel.querySelector<HTMLElement>(
        'input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled])',
      );
      firstInput?.focus();
    }, 180);
    return () => clearTimeout(timeout);
  });
</script>

{#if open}
  <div
    bind:this={panelRef}
    class="relative z-10 basis-full w-[calc(100%_+_2.44rem)] min-w-[calc(100%_+_2.4rem)] px-5 pl-6.5 transform translate-y-[-1.44rem] pt-7 pb-6 ml-[-20px] bg-background border-y border-x border-border space-y-2 origin-top"
    transition:slide={{ tier: 'moderate' }}
  >
    {#if children}
      {@render children()}
    {/if}
  </div>
{/if}
