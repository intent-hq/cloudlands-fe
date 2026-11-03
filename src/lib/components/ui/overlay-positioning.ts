/** Minimum default breathing room between floating surfaces and the viewport. */
export const OVERLAY_VIEWPORT_GUTTER = 8;

/** Whether a menu can fit on either horizontal side of its anchor. */
export function canPlaceBeside(
  anchor: HTMLElement | null | undefined,
  width: number,
  gap = 24,
): boolean {
  if (!anchor) return true;
  const bounds = anchor.getBoundingClientRect();
  const required = width + gap + OVERLAY_VIEWPORT_GUTTER;
  return (
    bounds.left >= required ||
    anchor.ownerDocument.documentElement.clientWidth - bounds.right >= required
  );
}
