<script lang="ts">
  /**
   * PanelMinimap - SVG visualization of the current panel layout
   *
   * Renders a mini version of the panel structure showing:
   * - Panel positions and relative sizes
   * - Split directions (horizontal/vertical)
   * - Visual representation of the layout tree
   */

  import { m } from '$shared/paraglide/messages.js';
  import type { PanelLayoutNode } from '$store/renderer/slices/panel-layout/panel-layout-types';
  import { cn } from '$lib/utils';

  interface Props {
    /** The root node of the panel layout tree */
    layoutRoot: PanelLayoutNode | null;
    /** Optional CSS class */
    class?: string;
    /** Size of the minimap in pixels */
    size?: number;
    /** Click handler */
    onclick?: () => void;
  }

  let {
    layoutRoot,
    class: className,
    size = 12,
    onclick,
  }: Props = $props();

  // Calculate panel rectangles from layout tree
  interface PanelRect {
    x: number;
    y: number;
    width: number;
    height: number;
    id: string;
  }

  function layoutToRects(
    node: PanelLayoutNode | null,
    x: number = 0,
    y: number = 0,
    width: number = 100,
    height: number = 100,
    path: string = '0',
  ): PanelRect[] {
    if (!node) {
      return [{ x, y, width, height, id: path }];
    }

    if (node.type === 'panel') {
      return [{ x, y, width, height, id: path }];
    }

    // Split node
    const rects: PanelRect[] = [];
    const { direction, children, sizes } = node;

    let offset = 0;
    for (let i = 0; i < children.length; i++) {
      const childSize = sizes[i] ?? (100 / children.length);

      let childX = x;
      let childY = y;
      let childWidth = width;
      let childHeight = height;

      if (direction === 'horizontal') {
        childX = x + (offset / 100) * width;
        childWidth = (childSize / 100) * width;
      } else {
        childY = y + (offset / 100) * height;
        childHeight = (childSize / 100) * height;
      }

      rects.push(...layoutToRects(children[i], childX, childY, childWidth, childHeight, `${path}-${i}`));
      offset += childSize;
    }

    return rects;
  }

  const panelRects = $derived(layoutToRects(layoutRoot));

  // Gap between panels in the minimap
  const gap = 0;
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class={cn(
    'panel-minimap relative pr-0.75 cursor-pointer rounded transition-all duration-150 text-subtle opacity-50 z-10',
    className,
  )}
  role="button"
  tabindex="0"
  aria-label={m.layout_panelMinimap_ariaLabel({ count: panelRects.length })}
  title={panelRects.length === 1
    ? m.layout_panelMinimap_tooltip_one({ count: panelRects.length })
    : m.layout_panelMinimap_tooltip_many({ count: panelRects.length })}
  {onclick}
  onkeydown={(e) => e.key === 'Enter' && onclick?.()}
>
  <svg
    width={size}
    height={size}
    viewBox="0 0 100 100"
    class="block overflow-visible"
  >
  <defs>
    <!-- clip path for rounded corners on edges -->
     <clipPath id="inner-content">
      <rect x="0" y="0" width="100" height="100" rx="5" />
    </clipPath>
  </defs>
    <!-- Panel rectangles with CSS transitions -->
     <g clip-path="url(#inner-content)">
    {#each panelRects as rect (rect.id)}
      {@const x = rect.x + gap}
      {@const y = rect.y + gap}
      {@const w = Math.max(0, rect.width - gap * 2)}
      {@const h = Math.max(0, rect.height - gap * 2)}
      {@const clampedX = Math.min(x, 100 - gap)}
      {@const clampedY = Math.min(y, 100 - gap)}
      {@const clampedW = Math.min(w, 100 - clampedX - gap)}
      {@const clampedH = Math.min(h, 100 - clampedY - gap)}
      <rect
        class="minimap-rect"
        x={clampedX}
        y={clampedY}
        width={Math.max(0, clampedW)}
        height={Math.max(0, clampedH)}
        stroke="currentColor"
        stroke-width="0.9"
        vector-effect="non-scaling-stroke"
        fill="none"
      />
    {/each}
    </g>
  <rect
      width="100%"
      height="100%"
      rx="10"
      fill="transparent"
      stroke="currentColor"
      stroke-width="1.6"
      vector-effect="non-scaling-stroke"
    />
  </svg>
</div>

<style>
</style>
