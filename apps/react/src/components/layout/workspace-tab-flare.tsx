import {
  WORKSPACE_TAB_BORDER_WIDTH_PX,
  WORKSPACE_TAB_FLARE_BOTTOM_PX,
  WORKSPACE_TAB_FLARE_INNER_PX,
  WORKSPACE_TAB_FLARE_OFFSET_PX,
  WORKSPACE_TAB_FLARE_OUTER_PX,
  WORKSPACE_TAB_FLARE_RADIUS_PX,
  WORKSPACE_TAB_FLARE_SIZE_PX,
  WORKSPACE_TAB_MOTION_EASING,
} from '$lib/components/layout/titlebar-geometry';

interface WorkspaceTabFlareProps {
  side: 'leading' | 'trailing';
  visible: boolean;
  durationMs: number;
}

const leadingFillPath = `M 0 ${WORKSPACE_TAB_FLARE_SIZE_PX} H ${WORKSPACE_TAB_FLARE_SIZE_PX} V ${WORKSPACE_TAB_FLARE_INNER_PX} H ${WORKSPACE_TAB_FLARE_OUTER_PX} A ${WORKSPACE_TAB_FLARE_RADIUS_PX} ${WORKSPACE_TAB_FLARE_RADIUS_PX} 0 0 1 ${WORKSPACE_TAB_FLARE_INNER_PX} ${WORKSPACE_TAB_FLARE_OUTER_PX} Z`;
const leadingStrokePath = `M ${WORKSPACE_TAB_FLARE_OUTER_PX} ${WORKSPACE_TAB_FLARE_INNER_PX} A ${WORKSPACE_TAB_FLARE_RADIUS_PX} ${WORKSPACE_TAB_FLARE_RADIUS_PX} 0 0 1 ${WORKSPACE_TAB_FLARE_INNER_PX} ${WORKSPACE_TAB_FLARE_OUTER_PX}`;
const trailingFillPath = `M ${WORKSPACE_TAB_FLARE_SIZE_PX} ${WORKSPACE_TAB_FLARE_SIZE_PX} H 0 V ${WORKSPACE_TAB_FLARE_INNER_PX} H ${WORKSPACE_TAB_FLARE_INNER_PX} A ${WORKSPACE_TAB_FLARE_RADIUS_PX} ${WORKSPACE_TAB_FLARE_RADIUS_PX} 0 0 0 ${WORKSPACE_TAB_FLARE_OUTER_PX} ${WORKSPACE_TAB_FLARE_OUTER_PX} Z`;
const trailingStrokePath = `M ${WORKSPACE_TAB_FLARE_INNER_PX} ${WORKSPACE_TAB_FLARE_INNER_PX} A ${WORKSPACE_TAB_FLARE_RADIUS_PX} ${WORKSPACE_TAB_FLARE_RADIUS_PX} 0 0 0 ${WORKSPACE_TAB_FLARE_OUTER_PX} ${WORKSPACE_TAB_FLARE_OUTER_PX}`;

export function WorkspaceTabFlare({ side, visible, durationMs }: WorkspaceTabFlareProps) {
  return (
    <svg
      className="pointer-events-none absolute overflow-visible text-sidebar transition-opacity motion-reduce:transition-none"
      style={{
        left: side === 'leading' ? `${-WORKSPACE_TAB_FLARE_OFFSET_PX}px` : undefined,
        right: side === 'trailing' ? `${-WORKSPACE_TAB_FLARE_OFFSET_PX}px` : undefined,
        bottom: `${WORKSPACE_TAB_FLARE_BOTTOM_PX}px`,
        width: `${WORKSPACE_TAB_FLARE_SIZE_PX}px`,
        height: `${WORKSPACE_TAB_FLARE_SIZE_PX}px`,
        opacity: visible ? 1 : 0,
        transitionDuration: `${durationMs}ms`,
        transitionTimingFunction: WORKSPACE_TAB_MOTION_EASING,
      }}
      viewBox={`0 0 ${WORKSPACE_TAB_FLARE_SIZE_PX} ${WORKSPACE_TAB_FLARE_SIZE_PX}`}
      aria-hidden="true"
      data-workspace-tab-leading-flare={side === 'leading' || undefined}
      data-workspace-tab-trailing-flare={side === 'trailing' || undefined}
    >
      <path d={side === 'leading' ? leadingFillPath : trailingFillPath} fill="currentColor" />
      <path
        className="stroke-border"
        d={side === 'leading' ? leadingStrokePath : trailingStrokePath}
        fill="none"
        strokeWidth={WORKSPACE_TAB_BORDER_WIDTH_PX}
      />
    </svg>
  );
}
