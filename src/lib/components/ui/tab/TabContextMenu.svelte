<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  interface Props {
    x: number;
    y: number;
    tabId: string;
    isPinned: boolean;
    onClose?: () => void;
    onCloseOthers?: () => void;
    onTogglePin?: () => void;
    onDuplicate?: () => void;
    onClickOutside?: () => void;
  }

  let {
    x,
    y,
    tabId,
    isPinned,
    onClose,
    onCloseOthers,
    onTogglePin,
    onDuplicate,
    onClickOutside,
  }: Props = $props();

  let menuElement: HTMLElement | null = $state(null);

  function handleClickOutside(event: MouseEvent) {
    if (menuElement && !menuElement.contains(event.target as Node)) {
      onClickOutside?.();
    }
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      onClickOutside?.();
    }
  }

  onMount(() => {
    document.addEventListener('click', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  });
</script>

<div
  bind:this={menuElement}
  class="fixed z-50 bg-popover border border-border rounded-lg shadow-lg py-1 min-w-48"
  style="left: {x}px; top: {y}px;"
  role="menu"
>
  <button
    type="button"
    class="w-full px-3 py-2 text-sm text-foreground hover:bg-accent text-left transition-colors"
    onclick={() => {
      onClose?.();
      onClickOutside?.();
    }}
    role="menuitem"
  >
    Close
  </button>

  <button
    type="button"
    class="w-full px-3 py-2 text-sm text-foreground hover:bg-accent text-left transition-colors"
    onclick={() => {
      onCloseOthers?.();
      onClickOutside?.();
    }}
    role="menuitem"
  >
    Close Others
  </button>

  <div class="h-px bg-border my-1"></div>

  <button
    type="button"
    class="w-full px-3 py-2 text-sm text-foreground hover:bg-accent text-left transition-colors"
    onclick={() => {
      onTogglePin?.();
      onClickOutside?.();
    }}
    role="menuitem"
  >
    {isPinned ? 'Unpin' : 'Pin'}
  </button>

  <button
    type="button"
    class="w-full px-3 py-2 text-sm text-foreground hover:bg-accent text-left transition-colors"
    onclick={() => {
      onDuplicate?.();
      onClickOutside?.();
    }}
    role="menuitem"
  >
    Duplicate
  </button>
</div>
