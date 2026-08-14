export const WINDOW_TITLEBAR_HEIGHT_PX = 35;

export function getCounterScaledTitlebarHeight(zoomFactor: number): number {
  return WINDOW_TITLEBAR_HEIGHT_PX / zoomFactor;
}
