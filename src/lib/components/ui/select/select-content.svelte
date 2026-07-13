<script lang="ts">
  import { getContext } from 'svelte';
  import { fly } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import type { Snippet } from 'svelte';
  import { portal as portalAction } from '$lib/actions/portal';

  let { class: className = '', wrapperClass = '', dropUp = false, portal = false, children }: { class?: string; wrapperClass?: string; dropUp?: boolean; portal?: boolean; children?: Snippet } = $props();

  const selectContext = getContext<{
    value: string;
    isOpen: boolean;
    triggerEl?: HTMLElement;
  }>('select');

  let contentEl: HTMLDivElement | undefined = $state();
  let triggerRect: DOMRect | null = $state<DOMRect | null>(null);
  let shouldFlipUp = $state(false);
  let contentHeight = $state(0);

  // Use portal behavior for dropUp or when portal prop is true
  const usePortal = $derived(dropUp || portal);

  function updatePosition() {
    // For portal mode, get trigger position from context or find it
    const trigger = selectContext.triggerEl;
    if (trigger) {
      triggerRect = trigger.getBoundingClientRect();

      // Check if we need to flip up
      if (contentEl && !dropUp) {
        const rect = contentEl.getBoundingClientRect();
        contentHeight = rect.height;
        const spaceBelow = window.innerHeight - triggerRect.bottom - 8;
        const spaceAbove = triggerRect.top - 8;

        // Flip up if not enough space below and more space above
        shouldFlipUp = spaceBelow < contentHeight && spaceAbove > spaceBelow;
      }
    }
  }

  // Handle click outside to close dropdown - use mousedown and reactive $effect
  // to ensure contentEl is properly bound before registering the listener
  $effect(() => {
    if (selectContext.isOpen && contentEl) {
      // Capture contentEl in a local const to ensure TypeScript knows it's defined in the closure
      const el = contentEl;
      const handler = (event: MouseEvent) => {
        if (!el.contains(event.target as Node)) {
          const trigger = selectContext.triggerEl;
          if (trigger && trigger.contains(event.target as Node)) {
            return; // Let the trigger handle this click
          }
          selectContext.isOpen = false;
        }
      };
      document.addEventListener('mousedown', handler);
      return () => document.removeEventListener('mousedown', handler);
    }
  });

  // Update position when open changes
  $effect(() => {
    if (selectContext.isOpen && usePortal) {
      // Need to wait for next frame to get accurate measurements
      requestAnimationFrame(() => {
        updatePosition();
        // Update again after content renders to get accurate height
        requestAnimationFrame(() => {
          updatePosition();
        });
      });
    }
  });

  // Compute position styles for portal mode
  const positionStyle = $derived(() => {
    if (!triggerRect) return '';

    const viewportHeight = window.innerHeight;
    const padding = 8;

    if (dropUp || shouldFlipUp) {
      // Position above the trigger
      const bottom = viewportHeight - triggerRect.top + 4;
      const maxHeight = triggerRect.top - padding;
      return `top: auto; bottom: ${bottom}px; left: ${triggerRect.left}px; max-height: ${maxHeight}px;`;
    }

    // Position below the trigger
    const top = triggerRect.bottom + 4;
    const maxHeight = viewportHeight - triggerRect.bottom - padding;
    return `top: ${top}px; left: ${triggerRect.left}px; max-height: ${maxHeight}px;`;
  });
</script>

{#if selectContext.isOpen}
  {#if usePortal}
    <!-- Portal mode (for dropUp or portal prop) to avoid clipping -->
    <div
      bind:this={contentEl}
      use:portalAction={'body'}
      class="fixed z-[9999] min-w-[8rem] bg-popover border border-border rounded-md shadow-lg flex flex-col transition duration-150 ease-out {className}"
      style={positionStyle()}
      role="listbox"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => {
        if (e.key === 'Escape') {
          selectContext.isOpen = false;
        }
      }}
      transition:fly={{ y: (dropUp || shouldFlipUp) ? 8 : -8, duration: 150, easing: quintOut }}
    >
      <div class="py-1 overflow-y-auto flex-1 min-h-0 {wrapperClass}">
        {@render children?.()}
      </div>
    </div>
  {:else}
    <div
      bind:this={contentEl}
      class="absolute z-50 min-w-[8rem] mt-1 bg-popover border border-border rounded-md shadow-lg max-h-60 flex flex-col transition duration-150 ease-out {className}"
      role="listbox"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => {
        if (e.key === 'Escape') {
          selectContext.isOpen = false;
        }
      }}
      transition:fly={{ y: -8, duration: 150, easing: quintOut }}
    >
      <div class="py-1 overflow-y-auto flex-1 min-h-0">
        {@render children?.()}
      </div>
    </div>
  {/if}
{/if}
