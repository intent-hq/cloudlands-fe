<script lang="ts">
  import {
    WORKSPACE_TAB_BORDER_WIDTH_PX,
    WORKSPACE_TAB_FLARE_BOTTOM_PX,
    WORKSPACE_TAB_FLARE_INNER_PX,
    WORKSPACE_TAB_FLARE_OFFSET_PX,
    WORKSPACE_TAB_FLARE_OUTER_PX,
    WORKSPACE_TAB_FLARE_RADIUS_PX,
    WORKSPACE_TAB_FLARE_SIZE_PX,
    WORKSPACE_TAB_MOTION_EASING,
  } from './titlebar-geometry';

  interface Props {
    side: 'leading' | 'trailing';
    visible: boolean;
    durationMs: number;
  }

  let { side, visible, durationMs }: Props = $props();
  const leadingFillPath = `M 0 ${WORKSPACE_TAB_FLARE_SIZE_PX} H ${WORKSPACE_TAB_FLARE_SIZE_PX} V ${WORKSPACE_TAB_FLARE_INNER_PX} H ${WORKSPACE_TAB_FLARE_OUTER_PX} A ${WORKSPACE_TAB_FLARE_RADIUS_PX} ${WORKSPACE_TAB_FLARE_RADIUS_PX} 0 0 1 ${WORKSPACE_TAB_FLARE_INNER_PX} ${WORKSPACE_TAB_FLARE_OUTER_PX} Z`;
  const leadingStrokePath = `M ${WORKSPACE_TAB_FLARE_OUTER_PX} ${WORKSPACE_TAB_FLARE_INNER_PX} A ${WORKSPACE_TAB_FLARE_RADIUS_PX} ${WORKSPACE_TAB_FLARE_RADIUS_PX} 0 0 1 ${WORKSPACE_TAB_FLARE_INNER_PX} ${WORKSPACE_TAB_FLARE_OUTER_PX}`;
  const trailingFillPath = `M ${WORKSPACE_TAB_FLARE_SIZE_PX} ${WORKSPACE_TAB_FLARE_SIZE_PX} H 0 V ${WORKSPACE_TAB_FLARE_INNER_PX} H ${WORKSPACE_TAB_FLARE_INNER_PX} A ${WORKSPACE_TAB_FLARE_RADIUS_PX} ${WORKSPACE_TAB_FLARE_RADIUS_PX} 0 0 0 ${WORKSPACE_TAB_FLARE_OUTER_PX} ${WORKSPACE_TAB_FLARE_OUTER_PX} Z`;
  const trailingStrokePath = `M ${WORKSPACE_TAB_FLARE_INNER_PX} ${WORKSPACE_TAB_FLARE_INNER_PX} A ${WORKSPACE_TAB_FLARE_RADIUS_PX} ${WORKSPACE_TAB_FLARE_RADIUS_PX} 0 0 0 ${WORKSPACE_TAB_FLARE_OUTER_PX} ${WORKSPACE_TAB_FLARE_OUTER_PX}`;
  const fillPath = $derived(side === 'leading' ? leadingFillPath : trailingFillPath);
  const strokePath = $derived(side === 'leading' ? leadingStrokePath : trailingStrokePath);
</script>

<svg
  class="pointer-events-none absolute overflow-visible text-sidebar transition-opacity motion-reduce:transition-none"
  style:left={side === 'leading' ? `${-WORKSPACE_TAB_FLARE_OFFSET_PX}px` : undefined}
  style:right={side === 'trailing' ? `${-WORKSPACE_TAB_FLARE_OFFSET_PX}px` : undefined}
  style:bottom={`${WORKSPACE_TAB_FLARE_BOTTOM_PX}px`}
  style:width={`${WORKSPACE_TAB_FLARE_SIZE_PX}px`}
  style:height={`${WORKSPACE_TAB_FLARE_SIZE_PX}px`}
  style:opacity={visible ? 1 : 0}
  style:transition-duration={`${durationMs}ms`}
  style:transition-timing-function={WORKSPACE_TAB_MOTION_EASING}
  viewBox={`0 0 ${WORKSPACE_TAB_FLARE_SIZE_PX} ${WORKSPACE_TAB_FLARE_SIZE_PX}`}
  aria-hidden="true"
  data-workspace-tab-leading-flare={side === 'leading' || undefined}
  data-workspace-tab-trailing-flare={side === 'trailing' || undefined}
>
  <path d={fillPath} fill="currentColor" />
  <path
    class="stroke-border"
    d={strokePath}
    fill="none"
    stroke-width={WORKSPACE_TAB_BORDER_WIDTH_PX}
  />
</svg>
