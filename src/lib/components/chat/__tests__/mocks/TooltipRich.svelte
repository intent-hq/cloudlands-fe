<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title?: string;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    content?: Snippet;
    children?: Snippet;
  }

  let { title, open = false, onOpenChange, content, children }: Props = $props();
  let internalOpen = $state(false);

  const isOpen = $derived(open || internalOpen);

  function handleMouseEnter() {
    internalOpen = true;
    setTimeout(() => {
      if (typeof onOpenChange === 'function') onOpenChange(true);
    }, 0);
  }

  function handleMouseLeave() {
    internalOpen = false;
    if (typeof onOpenChange === 'function') onOpenChange(false);
  }
</script>

<div
  role="presentation"
  data-testid="mock-tooltip-rich"
  data-title={title}
  data-open={isOpen}
  onmouseenter={handleMouseEnter}
  onmouseleave={handleMouseLeave}
>
  <div data-testid="mock-tooltip-trigger">
    {@render children?.()}
  </div>
  {#if isOpen && content}
    <div data-testid="mock-tooltip-content">
      {@render content()}
    </div>
  {/if}
</div>
