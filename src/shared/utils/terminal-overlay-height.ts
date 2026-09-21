const MIN_TERMINAL_OVERLAY_HEIGHT = 10;
const MAX_TERMINAL_OVERLAY_HEIGHT = 90;
export const DEFAULT_TERMINAL_OVERLAY_HEIGHT = 50;

export function isValidTerminalOverlayHeight(height: number): boolean {
  return (
    Number.isFinite(height) &&
    height >= MIN_TERMINAL_OVERLAY_HEIGHT &&
    height <= MAX_TERMINAL_OVERLAY_HEIGHT
  );
}

export function clampTerminalOverlayHeight(height: number): number {
  return Math.max(MIN_TERMINAL_OVERLAY_HEIGHT, Math.min(MAX_TERMINAL_OVERLAY_HEIGHT, height));
}

export function terminalOverlayHeightFromPointer(clientY: number, viewportHeight: number): number {
  return clampTerminalOverlayHeight(((viewportHeight - clientY) / viewportHeight) * 100);
}
