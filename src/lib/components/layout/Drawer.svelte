<script lang="ts">
  import { fly, fade } from 'svelte/transition';
  import Fa from 'svelte-fa';
  import { faXmark } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import type { Snippet } from 'svelte';

  interface Props {
    isOpen?: boolean;
    title?: string;
    position?: 'left' | 'right';
    onclose?: () => void;
    icon?: Snippet;
    headerExtra?: Snippet;
    actions?: Snippet;
    children?: Snippet;
    footer?: Snippet;
  }

  let {
    isOpen = $bindable(false),
    title = '',
    position = 'right',
    onclose,
    icon,
    headerExtra,
    actions,
    children,
    footer,
  }: Props = $props();

  const drawerWidth = 600; // Fixed width

  function close() {
    isOpen = false;
    onclose?.();
  }

  function handleBackdropClick(e: MouseEvent | KeyboardEvent) {
    // Close when clicking on the backdrop or pressing Enter
    close();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && isOpen) {
      close();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if isOpen}
  <!-- Modal Backdrop (always visible when drawer is open) -->
  <div
    class="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
    transition:fade={{ duration: 200 }}
    onclick={handleBackdropClick}
    onkeydown={(e) => e.key === 'Enter' && handleBackdropClick(e)}
    role="button"
    tabindex="-1"
    aria-label="Close drawer"
  ></div>

  <!-- Drawer Panel -->
  <div
    class="fixed top-0 {position === 'right'
      ? 'right-0'
      : 'left-0'} h-full bg-background {position === 'right'
      ? 'border-l'
      : 'border-r'} border-border shadow-2xl z-50 flex flex-col"
    style="width: {drawerWidth}px"
    transition:fly={{
      x: position === 'right' ? drawerWidth : -drawerWidth,
      duration: 300,
    }}
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.key === 'Escape' && close()}
    role="dialog"
    tabindex="-1"
    aria-modal="true"
  >
    <!-- Header -->
    <div class="px-6 py-2 border-b-[1px] flex-none border-border flex justify-between items-center">
      <div class="flex items-center flex-1 gap-2">
        {@render icon?.()}
        <h2 class="text-sm font-medium text-foreground m-0">
          {title}
        </h2>
        {@render headerExtra?.()}
      </div>

      <div class="flex gap-4 items-center">
        {@render actions?.()}
        <Button variant="ghost" size="icon-sm" onclick={close}>
          <Fa icon={faXmark} size="sm" />
        </Button>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-hidden relative">
      {@render children?.()}
      <!-- Gradient fade-outs -->
      <div class="fade-edge-t-subtle" aria-hidden="true"></div>
      <div class="fade-edge-b-subtle" aria-hidden="true"></div>
    </div>

    <!-- Footer (optional) -->
    {#if footer}
      <div class="border-t border-border px-6 py-4">
        {@render footer?.()}
      </div>
    {/if}
  </div>
{/if}
