import type { DockPointerRect } from '$shared/dock-layout';

/** Offscreen portions of a scrolling entry must not intercept desktop input. */
export function intersectDockRect(
  rect: DockPointerRect,
  viewport: DockPointerRect,
): DockPointerRect | null {
  const x = Math.max(rect.x, viewport.x);
  const y = Math.max(rect.y, viewport.y);
  const right = Math.min(rect.x + rect.width, viewport.x + viewport.width);
  const bottom = Math.min(rect.y + rect.height, viewport.y + viewport.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

/** Reveal only within the list, without scrolling the transparent native window. */
export function revealDockItem(element: HTMLElement): void {
  const viewport = element.closest<HTMLElement>('[data-dock-scroll]');
  if (!viewport) return;
  const item = element.closest<HTMLElement>('[data-dock-scroll-item]') ?? element;
  const bounds = item.getBoundingClientRect();
  const clip = viewport.getBoundingClientRect();
  if (bounds.top < clip.top) viewport.scrollTop -= clip.top - bounds.top;
  else if (bounds.bottom > clip.bottom) viewport.scrollTop += bounds.bottom - clip.bottom;
}

/** Native resizing can finish after Back has restored focus into the overview. */
export function keepDockFocusVisible(viewport: HTMLElement): { destroy: () => void } {
  const observer = new ResizeObserver(() => {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && viewport.contains(focused)) revealDockItem(focused);
  });
  observer.observe(viewport);
  return { destroy: () => observer.disconnect() };
}
