<script lang="ts">
  import { cn } from '$lib/utils.js';
  import {
  fade,
  scale,
} from 'svelte/transition';
  import type { Snippet } from 'svelte';

  interface TabOverflowMenuSlotProps {
    close: () => void;
  }

  interface Props {
    isOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
    children?: Snippet<[TabOverflowMenuSlotProps]>;
    class?: string;
  }

  let {
    isOpen = $bindable(false),
    onOpenChange,
    children,
    class: className = '',
  }: Props = $props();

  let menuElement: HTMLElement | null = $state(null);
  let triggerElement: HTMLElement | null = $state(null);

  function toggle() {
    isOpen = !isOpen;
    onOpenChange?.(isOpen);
  }

  function close() {
    isOpen = false;
    onOpenChange?.(false);
  }

  function handleClickOutside(e: MouseEvent) {
    if (
      menuElement &&
      triggerElement &&
      !menuElement.contains(e.target as Node) &&
      !triggerElement.contains(e.target as Node)
    ) {
      close();
    }
  }

  // Combined transition function for scale + fade
  function scaleAndFade(node: Element, { duration = 150 } = {}) {
    const scaleTransition = scale(node, { duration, start: 0.95 });
    const fadeTransition = fade(node, { duration });

    return {
      duration,
      css: (t: number, u: number) => {
        const scaleCss = scaleTransition.css?.(t, u) ?? '';
        const fadeCss = fadeTransition.css?.(t, u) ?? '';
        return `${scaleCss}${fadeCss}`;
      },
    };
  }

  $effect(() => {
    if (isOpen) {
      document.addEventListener('click', handleClickOutside);
      return () => {
        document.removeEventListener('click', handleClickOutside);
      };
    }
  });
</script>

<div class={cn('relative', className)}>
  <!-- Trigger button (visible on all screens when there are hidden tabs) -->
  <button
    bind:this={triggerElement}
    type="button"
    onclick={toggle}
    class="flex-shrink-0 flex items-center justify-center w-6 h-full hover:bg-sidebar/50 transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
    aria-label="Show more tabs"
    aria-expanded={isOpen}
    aria-haspopup="menu"
    title="More tabs"
  >
    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
      />
    </svg>
  </button>

  <!-- Dropdown menu -->
  {#if isOpen}
    <div
      bind:this={menuElement}
      class="absolute right-0 top-full mt-1 bg-sidebar border border-border rounded-lg shadow-lg z-50 min-w-48 max-h-96 overflow-y-auto"
      role="menu"
      transition:scaleAndFade={{ duration: 150 }}
    >
      {@render children?.({ close })}
    </div>
  {/if}
</div>

<style>
  :global(.tab-overflow-menu-item) {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    width: 100%;
    text-align: left;
    font-size: 0.875rem;
    cursor: pointer;
    transition: background-color 0.15s cubic-bezier(0.4, 0, 0.2, 1);
    border: none;
    background: none;
    color: inherit;
  }

  :global(.tab-overflow-menu-item:hover) {
    background-color: var(--color-sidebar-hover, rgba(255, 255, 255, 0.1));
  }

  :global(.tab-overflow-menu-item.active) {
    background-color: var(--color-sidebar-active, rgba(255, 255, 255, 0.2));
    font-weight: 500;
  }

  :global(.tab-overflow-menu-item:focus-visible) {
    outline: 2px solid hsl(var(--primary));
    outline-offset: -2px;
  }

  /* Respect prefers-reduced-motion */
  @media (prefers-reduced-motion: reduce) {
    :global(.tab-overflow-menu-item) {
      transition: none;
    }
  }
</style>
