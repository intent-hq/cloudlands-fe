export const MIN_TERMINAL_OVERLAY_HEIGHT = 20;
export const MAX_TERMINAL_OVERLAY_HEIGHT = 90;

export function clampTerminalOverlayHeight(height: number): number {
  return Math.max(MIN_TERMINAL_OVERLAY_HEIGHT, Math.min(MAX_TERMINAL_OVERLAY_HEIGHT, height));
}

export function terminalOverlayHeightFromPointer(clientY: number, viewportHeight: number): number {
  return clampTerminalOverlayHeight(((viewportHeight - clientY) / viewportHeight) * 100);
}
