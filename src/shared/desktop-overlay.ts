/** Narrow bridge for the isolated, unprivileged desktop indicator renderer. */
export interface DesktopOverlayBridge {
  ready(): void;
  stop(): void;
  openAgent(): void;
  setInteractive(interactive: boolean): void;
  onPulse(callback: () => void): () => void;
}

export const DESKTOP_OVERLAY_ROUTE = '/desktop-overlay';
export function isDesktopOverlayRoute(pathname: string): boolean {
  return pathname === DESKTOP_OVERLAY_ROUTE || pathname.startsWith(`${DESKTOP_OVERLAY_ROUTE}/`);
}
