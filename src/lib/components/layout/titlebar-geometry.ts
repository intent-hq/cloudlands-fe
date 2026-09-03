export const WINDOW_TITLEBAR_HEIGHT_PX = 35;
export const TITLEBAR_LEFT_DRAG_SURFACE_CLASS =
  'titlebar-left-drag-surface flex min-w-0 self-stretch items-center gap-1 overflow-visible';

export const WORKSPACE_TAB_FLARE_RADIUS_PX = 12;
export const WORKSPACE_TAB_BORDER_WIDTH_PX = 1;
export const WORKSPACE_TAB_FLARE_DROP_PX = 2;
export const WORKSPACE_TAB_FLARE_SIZE_PX =
  WORKSPACE_TAB_FLARE_RADIUS_PX + WORKSPACE_TAB_BORDER_WIDTH_PX;
export const WORKSPACE_TAB_FLARE_OFFSET_PX = WORKSPACE_TAB_FLARE_RADIUS_PX;
export const WORKSPACE_TAB_FLARE_BOTTOM_PX = -(
  WORKSPACE_TAB_FLARE_DROP_PX - WORKSPACE_TAB_BORDER_WIDTH_PX
);
export const WORKSPACE_TAB_FLARE_INNER_PX = WORKSPACE_TAB_BORDER_WIDTH_PX / 2;
export const WORKSPACE_TAB_FLARE_OUTER_PX =
  WORKSPACE_TAB_FLARE_RADIUS_PX + WORKSPACE_TAB_FLARE_INNER_PX;

export const WORKSPACE_TAB_MOTION_DURATION_MS = 200;
export const WORKSPACE_TAB_MOTION_EASING = 'cubic-bezier(0.215, 0.61, 0.355, 1)';

export function getWorkspaceTabLeadingInsetPx(sidebarPanelOpen: boolean): number {
  const flareGap = sidebarPanelOpen ? 16 : 4 - WORKSPACE_TAB_BORDER_WIDTH_PX;
  return WORKSPACE_TAB_FLARE_RADIUS_PX + flareGap;
}

function cubicCoordinate(progress: number, first: number, second: number): number {
  const inverse = 1 - progress;
  return (
    3 * inverse * inverse * progress * first +
    3 * inverse * progress * progress * second +
    progress ** 3
  );
}

export function workspaceTabMotionEasing(progress: number): number {
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 14; iteration += 1) {
    const midpoint = (low + high) / 2;
    if (cubicCoordinate(midpoint, 0.215, 0.355) < progress) low = midpoint;
    else high = midpoint;
  }
  return cubicCoordinate((low + high) / 2, 0.61, 1);
}

export function getCounterScaledTitlebarHeight(zoomFactor: number): number {
  return WINDOW_TITLEBAR_HEIGHT_PX / zoomFactor;
}
