<script lang="ts" module>
  // Context for dropdown state
  const dropdownContext = Symbol('dropdown');

  export interface DropdownContext {
    open: boolean;
    toggle: () => void;
    close: () => void;
  }
</script>

<script lang="ts">
  import { setContext, onMount, onDestroy } from 'svelte';
  import { scale } from 'svelte/transition';
  import Portal from './Portal.svelte';

  // Props (runes mode)
  let {
    open = $bindable(false),
    align = 'start',
    side = 'bottom',
    portal = true,
    trigger = undefined,
    content = undefined,
    contentClass = '',
    class: className = '',
  }: {
    open?: boolean;
    align?: 'start' | 'center' | 'end';
    side?: 'top' | 'bottom' | 'left' | 'right';
    portal?: boolean;
    trigger?: any; // snippet: ({ toggle, open }) => markup
    content?: any; // snippet: ({ close }) => markup
    contentClass?: string;
    class?: string;
  } = $props();

  let triggerEl: HTMLElement | undefined = $state(undefined);
  let contentEl: HTMLElement | undefined = $state(undefined);
  let portalStyle = $state('');

  function toggle() {
    open = !open;
  }

  function close() {
    open = false;
  }

  function handleClickOutside(event: MouseEvent) {
    if (open && triggerEl && contentEl) {
      const target = event.target as Node;
      if (!triggerEl.contains(target) && !contentEl.contains(target)) {
        close();
      }
    }
  }

  function handleEscape(event: KeyboardEvent) {
    if (open && event.key === 'Escape') {
      close();
    }
  }

  function updatePortalPosition() {
    if (!portal || !open || !triggerEl || !contentEl) return;
    const t = triggerEl.getBoundingClientRect();
    const c = contentEl.getBoundingClientRect();
    let left = 0;
    let top = 0;

    if (side === 'bottom') {
      top = t.bottom + 6;
      if (align === 'start') left = t.left;
      else if (align === 'center') left = t.left + t.width / 2 - c.width / 2;
      else left = t.right - c.width;
    } else if (side === 'top') {
      top = t.top - c.height - 6;
      if (align === 'start') left = t.left;
      else if (align === 'center') left = t.left + t.width / 2 - c.width / 2;
      else left = t.right - c.width;
    } else if (side === 'left') {
      left = t.left - c.width - 6;
      if (align === 'start') top = t.top;
      else if (align === 'center') top = t.top + t.height / 2 - c.height / 2;
      else top = t.bottom - c.height;
    } else if (side === 'right') {
      left = t.right + 6;
      if (align === 'start') top = t.top;
      else if (align === 'center') top = t.top + t.height / 2 - c.height / 2;
      else top = t.bottom - c.height;
    }

    // Constrain to viewport with small margin
    const margin = 6;
    left = Math.max(margin, Math.min(window.innerWidth - c.width - margin, left));
    top = Math.max(margin, Math.min(window.innerHeight - c.height - margin, top));

    portalStyle = `left:${left}px;top:${top}px;`;
  }

  setContext(dropdownContext, {
    get open() {
      return open;
    },
    toggle,
    close,
  });

  onMount(() => {
    document.addEventListener('click', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    window.addEventListener('resize', updatePortalPosition);
    window.addEventListener('scroll', updatePortalPosition, true);
  });

  onDestroy(() => {
    document.removeEventListener('click', handleClickOutside);
    document.removeEventListener('keydown', handleEscape);
    window.removeEventListener('resize', updatePortalPosition);
    window.removeEventListener('scroll', updatePortalPosition, true);
  });

  $effect(() => {
    if (open) {
      // next frame to measure content dimensions
      requestAnimationFrame(() => updatePortalPosition());
    }
  });

  // Calculate position classes for non-portal mode
  let positionClasses = $derived(
    (
      {
        'top-start': 'bottom-full left-0 mb-1',
        'top-center': 'bottom-full left-1/2 -translate-x-1/2 mb-1',
        'top-end': 'bottom-full right-0 mb-1',
        'bottom-start': 'top-full left-0 mt-1',
        'bottom-center': 'top-full left-1/2 -translate-x-1/2 mt-1',
        'bottom-end': 'top-full right-0 mt-1',
        'left-start': 'right-full top-0 mr-1',
        'left-center': 'right-full top-1/2 -translate-y-1/2 mr-1',
        'left-end': 'right-full bottom-0 mr-1',
        'right-start': 'left-full top-0 ml-1',
        'right-center': 'left-full top-1/2 -translate-y-1/2 ml-1',
        'right-end': 'left-full bottom-0 ml-1',
      } as Record<string, string>
    )[`${side}-${align}`] || 'top-full left-0 mt-1',
  );
</script>

<div class="relative inline-block {className}">
  <div bind:this={triggerEl}>
    {@render trigger?.({ toggle, open })}
  </div>

  {#if open}
    {#if portal}
      <Portal zIndex={10000}>
        <div
          bind:this={contentEl}
          class="fixed z-[10000] min-w-32"
          style={portalStyle}
          transition:scale={{ duration: 150, start: 0.95 }}
        >
          <div
            class="border border-border bg-popover p-1 shadow-md {contentClass}"
            role="menu"
            aria-label="Menu"
          >
            {@render content?.({ close })}
          </div>
        </div>
      </Portal>
    {:else}
      <div
        bind:this={contentEl}
        class={`absolute z-[10000] min-w-32 ${positionClasses}`}
        transition:scale={{ duration: 150, start: 0.95 }}
      >
        <div
          class="border border-border bg-popover p-1 shadow-md {contentClass}"
          role="menu"
          aria-label="Menu"
        >
          {@render content?.({ close })}
        </div>
      </div>
    {/if}
  {/if}
</div>
