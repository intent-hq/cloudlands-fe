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
  // Opening focus must yield to the user's choice while the panel animates.
  $effect(() => {
    if (!open || !panelRef) return;
    const panel = panelRef;
    const initialFocus = document.activeElement;
    let focusMoved = panel.contains(document.activeElement);
    const preserveFocus = () => {
      focusMoved = true;
    };
    document.addEventListener('focusin', preserveFocus);
    const timer = setTimeout(() => {
      document.removeEventListener('focusin', preserveFocus);
      if (
        focusMoved ||
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
    return () => {
      clearTimeout(timer);
      document.removeEventListener('focusin', preserveFocus);
    };
  });
</script>

{#if open}
  <div
    bind:this={panelRef}
    class="relative basis-full w-full min-w-0 space-y-3 px-2 py-2 type-caption font-normal origin-top"
    transition:slide={{ tier: 'moderate' }}
  >
    {#if children}
      {@render children()}
    {/if}
  </div>
{/if}
