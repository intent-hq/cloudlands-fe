<script lang="ts">
  import * as Menu from '$lib/components/ui/menu';
  import { cn } from '$lib/utils.js';
  import type { Snippet } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';

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

  let containerElement: HTMLDivElement | null = $state(null);
  let triggerElement: HTMLButtonElement | null = $state(null);

  function setOpen(open: boolean) {
    isOpen = open;
    onOpenChange?.(open);
  }

  function close() {
    setOpen(false);
    queueMicrotask(() => triggerElement?.focus());
  }

  $effect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (!containerElement?.contains(event.target as Node)) close();
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  });
</script>

<Menu.Root bind:open={isOpen} onOpenChange={setOpen}>
  <div bind:this={containerElement} class={cn('relative', className)}>
    <Menu.Trigger
      bind:ref={triggerElement}
      class="flex-shrink-0 flex items-center justify-center w-6 h-full hover:bg-sidebar/50 transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-ink focus-visible:ring-offset-2"
      aria-label={m.ui_tabOverflow_showMore_ariaLabel()}
      title={m.ui_tabOverflow_more_tooltip()}
    >
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
        />
      </svg>
    </Menu.Trigger>

    <Menu.Content
      portal={false}
      align="end"
      onEscapeKeydown={close}
      class="bg-sidebar min-w-48 max-h-96"
      aria-label={m.ui_tabOverflow_showMore_ariaLabel()}
    >
      {@render children?.({ close })}
    </Menu.Content>
  </div>
</Menu.Root>

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
    background-color: hsl(var(--sidebar-accent) / 0.7);
  }

  :global(.tab-overflow-menu-item.active) {
    background-color: hsl(var(--sidebar-accent));
    font-weight: 500;
  }

  :global(.tab-overflow-menu-item:focus-visible) {
    outline: 2px solid hsl(var(--primary-ink));
    outline-offset: -2px;
  }

  /* Respect prefers-reduced-motion */
  @media (prefers-reduced-motion: reduce) {
    :global(.tab-overflow-menu-item) {
      transition: none;
    }
  }
</style>
