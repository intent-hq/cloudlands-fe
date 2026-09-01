export const WINDOW_TITLEBAR_HEIGHT_PX = 35;
export const TITLEBAR_LEFT_DRAG_SURFACE_CLASS =
  'titlebar-left-drag-surface flex min-w-0 self-stretch items-center gap-1 overflow-visible';

export function getCounterScaledTitlebarHeight(zoomFactor: number): number {
  return WINDOW_TITLEBAR_HEIGHT_PX / zoomFactor;
}
