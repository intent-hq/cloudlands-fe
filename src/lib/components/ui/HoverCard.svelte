<script lang="ts">
  import {
  onMount,
  tick,
} from 'svelte';
  import type { Snippet } from 'svelte';
  import Portal from './Portal.svelte';
  interface Props {
    anchor: string;
    position?: 'right' | 'bottom' | 'bottom-right' | 'bottom-left' | 'top';
    /** Use absolute positioning instead of fixed (needed inside transformed containers) */
    absolute?: boolean;
    /** Optional trigger element used for viewport-aware fixed positioning. */
    anchorElement?: HTMLElement | null;
    class?: string;
    children?: Snippet;
  }
  let {
    anchor,
    position = 'right',
    absolute = false,
    anchorElement = null,
    class: className = '',
    children,
  }: Props = $props();

  const COLLISION_PADDING = 8;
  const SIDE_OFFSET = 4;

  let cardEl: HTMLDivElement | null = $state(null);
  let measuredStyle = $state('');
  let maxHeight = $state<string | undefined>();

  // Compute positioning styles based on position prop
  // - 'right': appears beside the anchor, preferring the right side and flipping left on collision
  // - 'bottom': appears to the left of the anchor, aligned to bottom
  // - 'bottom-right': appears below the anchor, aligned to left edge, flows right
  // - 'bottom-left': appears below the anchor, aligned to left edge (same as bottom-right)
  // - 'top': appears above the anchor, horizontally centered
  const isBottom = $derived(position === 'bottom-right' || position === 'bottom-left');
  const isTop = $derived(position === 'top');
  const positionClass = $derived(absolute ? 'absolute' : 'fixed');

  function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
  }

  function findAnchorElement() {
    if (anchorElement) return anchorElement;
    return Array.from(document.querySelectorAll<HTMLElement>('[style*="anchor-name"]')).find((el) => {
      const inlineAnchor = el.style.getPropertyValue('anchor-name');
      const computedAnchor = getComputedStyle(el).getPropertyValue('anchor-name');
      return inlineAnchor.includes(anchor) || computedAnchor.includes(anchor);
    });
  }

  function updateMeasuredPosition() {
    if (absolute || !cardEl) return;

    const trigger = findAnchorElement();
    if (!trigger) return;

    const triggerRect = trigger.getBoundingClientRect();
    const cardRect = cardEl.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const cardWidth = cardRect.width || cardEl.offsetWidth;
    const cardHeight = cardRect.height || cardEl.offsetHeight;
    const spaceAbove = Math.max(0, triggerRect.top - SIDE_OFFSET - COLLISION_PADDING);
    const spaceBelow = Math.max(
      0,
      viewportHeight - triggerRect.bottom - SIDE_OFFSET - COLLISION_PADDING,
    );
    const placeAbove = isTop
      ? !(spaceAbove < cardHeight && spaceBelow > spaceAbove)
      : isBottom && spaceBelow < cardHeight && spaceAbove > spaceBelow;

    let left = triggerRect.left;
    let top = triggerRect.bottom + SIDE_OFFSET;
    let availableHeight = placeAbove ? spaceAbove : spaceBelow;

    if (position === 'right') {
      const spaceLeft = triggerRect.left - SIDE_OFFSET - COLLISION_PADDING;
      const spaceRight = viewportWidth - triggerRect.right - SIDE_OFFSET - COLLISION_PADDING;
      const placeRight = spaceRight >= cardWidth || spaceRight >= spaceLeft;
      left = placeRight ? triggerRect.right + SIDE_OFFSET : triggerRect.left - cardWidth - SIDE_OFFSET;
      top = triggerRect.top;
      availableHeight = Math.max(0, viewportHeight - COLLISION_PADDING * 2);
    } else if (position === 'bottom') {
      left = triggerRect.left - cardWidth - SIDE_OFFSET;
      top = triggerRect.bottom - cardHeight;
    } else if (isTop || isBottom) {
      if (position === 'bottom-left') {
        left = triggerRect.right - cardWidth;
      } else if (isTop) {
        left = triggerRect.left + triggerRect.width / 2 - cardWidth / 2;
      }
      top = placeAbove
        ? triggerRect.top - Math.min(cardHeight, availableHeight) - SIDE_OFFSET
        : triggerRect.bottom + SIDE_OFFSET;
    }

    left = clamp(
      left,
      COLLISION_PADDING,
      Math.max(COLLISION_PADDING, viewportWidth - cardWidth - COLLISION_PADDING),
    );
    top = clamp(
      top,
      COLLISION_PADDING,
      Math.max(
        COLLISION_PADDING,
        viewportHeight - Math.min(cardHeight, availableHeight) - COLLISION_PADDING,
      ),
    );
    maxHeight = `${availableHeight}px`;
    measuredStyle = `left: ${left}px; top: ${top}px;`;
  }

  async function schedulePositionUpdate() {
    await tick();
    updateMeasuredPosition();
  }

  onMount(() => {
    let resizeObserver: ResizeObserver | null = null;
    void schedulePositionUpdate().then(() => {
      if (!absolute && typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(updateMeasuredPosition);
        if (cardEl) resizeObserver.observe(cardEl);
        const trigger = findAnchorElement();
        if (trigger) resizeObserver.observe(trigger);
      }
    });
    window.addEventListener('resize', updateMeasuredPosition);
    window.addEventListener('scroll', updateMeasuredPosition, true);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateMeasuredPosition);
      window.removeEventListener('scroll', updateMeasuredPosition, true);
    };
  });
</script>

{#if absolute}
  <div
    bind:this={cardEl}
    class={positionClass + ' z-50 w-64 flex flex-col bg-popover border border-border shadow pointer-events-none transition duration-150 ease-out ' +
      className}
    style:position-anchor={anchor}
    style:right={position === 'bottom' ? 'anchor(left)' : undefined}
    style:left={position === 'right' ? 'anchor(right)' : isBottom ? 'anchor(left)' : isTop ? 'anchor(center)' : undefined}
    style:top={position === 'right' ? 'anchor(top)' : isBottom ? 'anchor(bottom)' : undefined}
    style:bottom={position === 'bottom' ? 'anchor(bottom)' : isTop ? 'anchor(top)' : undefined}
    style:margin-right={position === 'bottom' ? '8px' : undefined}
    style:margin-left={position === 'right' ? '8px' : undefined}
    style:margin-top={isBottom ? '4px' : undefined}
    style:margin-bottom={isTop ? '4px' : undefined}
    style:translate={isTop ? '-50% 0' : undefined}
    role="tooltip"
  >
    {@render children?.()}
  </div>
{:else}
  <Portal zIndex={50}>
    <div
      bind:this={cardEl}
      class={positionClass + ' z-50 w-64 flex flex-col overflow-y-auto bg-popover border border-border shadow pointer-events-auto transition duration-150 ease-out ' +
        className}
      style={measuredStyle}
      style:max-height={maxHeight}
      role="tooltip"
    >
      {@render children?.()}
    </div>
  </Portal>
{/if}
