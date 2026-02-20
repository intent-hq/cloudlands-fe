<script lang="ts">
  import type { Snippet } from 'svelte';
  interface Props {
    anchor: string;
    position?: 'right' | 'bottom' | 'bottom-right' | 'bottom-left' | 'top';
    /** Use absolute positioning instead of fixed (needed inside transformed containers) */
    absolute?: boolean;
    class?: string;
    children?: Snippet;
  }
  let { anchor, position = 'right', absolute = false, class: className = '', children }: Props = $props();

  // Compute positioning styles based on position prop
  // - 'right': appears to the left of the anchor, aligned to top
  // - 'bottom': appears to the left of the anchor, aligned to bottom
  // - 'bottom-right': appears below the anchor, aligned to left edge, flows right
  // - 'bottom-left': appears below the anchor, aligned to left edge (same as bottom-right)
  // - 'top': appears above the anchor, horizontally centered
  const isBottom = $derived(position === 'bottom-right' || position === 'bottom-left');
  const isTop = $derived(position === 'top');
  const positionClass = $derived(absolute ? 'absolute' : 'fixed');
</script>

<div
  class={positionClass + ' z-50 w-64 flex flex-col bg-popover border border-border shadow pointer-events-none transition duration-150 ease-out ' +
    className}
  style:position-anchor={anchor}
  style:right={isBottom || isTop ? undefined : 'anchor(left)'}
  style:left={isBottom ? 'anchor(left)' : isTop ? 'anchor(center)' : undefined}
  style:top={position === 'right' ? 'anchor(top)' : isBottom ? 'anchor(bottom)' : undefined}
  style:bottom={position === 'bottom' ? 'anchor(bottom)' : isTop ? 'anchor(top)' : undefined}
  style:margin-right={isBottom || isTop ? undefined : '8px'}
  style:margin-top={isBottom ? '4px' : undefined}
  style:margin-bottom={isTop ? '4px' : undefined}
  style:translate={isTop ? '-50% 0' : undefined}
  role="tooltip"
>
  {@render children?.()}
</div>
