<script lang="ts">
  /**
   * Modal - Reusable modal component for compact confirmation-style dialogs.
   * Provides backdrop blur, fly transitions, header with title/close, and content area.
   */
  import { faXmark } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import {
  fade,
  fly,
} from 'svelte/transition';
  import Button from '$lib/components/ui/button/button.svelte';
  import Portal from '$lib/components/ui/Portal.svelte';
  import { pushEscapeLayer } from '$lib/utils/escapeLayers';
  import type { Snippet } from 'svelte';

  interface Props {
    open?: boolean;
    title?: string;
    contentClass?: string;
    onClose?: () => void;
    children?: Snippet;
  }

  let { open = $bindable(false), title = '', contentClass = 'px-12 py-8', onClose, children }: Props = $props();

  function close() {
    open = false;
    onClose?.();
  }

  // Escape layer: only the topmost overlay handles Escape (stacked overlays
  // dismiss one at a time in LIFO order)
  $effect(() => {
    if (!open) return;
    return pushEscapeLayer((e) => {
      // Don't close modal if user is editing an input — let the input handle Escape first
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return false;
      close();
    });
  });
</script>

{#if open}
  <Portal target="body" zIndex={100}>
    <div
      class="fixed inset-0 bg-background/50 backdrop-blur cursor-pointer z-50"
      onclick={close}
      transition:fade={{ duration: 150 }}
    />
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div
      class="fixed inset-0 z-60 flex items-center justify-center overflow-y-auto pointer-events-none"
      role="presentation"
      transition:fly={{ y: 20, duration: 200 }}
    >
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="relative w-full max-w-6xl mx-auto flex flex-col px-8 my-auto max-h-[90vh] z-20 pointer-events-auto"
        onclick={(e) => e.stopPropagation()}
        role="dialog"
        tabindex="-1"
        transition:fly={{ y: -8, duration: 180 }}
      >
        <!-- Header -->
        <div class="px-1 pb-4 flex items-center justify-between shrink-0">
          <h2 class="text-lg font-medium tracking-[-0.02em] text-foreground">{title}</h2>
          <Button
            variant="ghost-light"
            size="icon-xs"
            class="text-muted-foreground hover:text-foreground"
            onclick={close}
          >
            <Fa icon={faXmark} />
          </Button>
        </div>

        <!-- Content -->
        <div class="bg-sidebar border border-border shadow-xs {contentClass} overflow-hidden flex flex-col min-h-0">
          {#if children}
            {@render children()}
          {/if}
        </div>
      </div>
    </div>
  </Portal>
{/if}
