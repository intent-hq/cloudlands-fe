<script lang="ts">
  /**
   * DividerPanel - An expandable panel that appears below a DividerButton
   * Connects visually to the button above with matching border styling
   */
  import { slide } from 'svelte/transition';
  import type { Snippet } from 'svelte';

  interface Props {
    open?: boolean;
    children?: Snippet;
  }

  let { open = false, children }: Props = $props();

  let panelRef: HTMLDivElement | undefined = $state();
  let hasScrolled = $state(false);

  // Reset scroll tracking when panel closes
  $effect(() => {
    if (!open) {
      hasScrolled = false;
    }
  });

  // Scroll panel into view and focus first input when it becomes available after opening
  $effect(() => {
    if (open && panelRef && !hasScrolled) {
      hasScrolled = true;
      // Wait for the slide transition to complete (150ms) before scrolling and focusing
      setTimeout(() => {
        panelRef?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        // Focus the first focusable form input in the panel
        const firstInput = panelRef?.querySelector<HTMLElement>(
          'input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled])',
        );
        firstInput?.focus();
      }, 180);
    }
  });
</script>

{#if open}
  <div
    bind:this={panelRef}
    class="relative z-10 basis-full w-[calc(100%_+_2.44rem)] min-w-[calc(100%_+_2.4rem)] px-5 pl-6.5 transform translate-y-[-1.44rem] pt-7 pb-6 ml-[-20px] bg-background border-y border-x border-border space-y-2 origin-top"
    transition:slide={{ duration: 150 }}
  >
    {#if children}
      {@render children()}
    {/if}
  </div>
{/if}
