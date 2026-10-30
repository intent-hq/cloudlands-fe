import type { DockPointerRect } from '$shared/dock-layout';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('DockConversationPopups');

/** A content rectangle, clipped to this native window's viewport. */
export function visiblePopupRect(
  element: HTMLElement,
  viewportWidth: number,
  viewportHeight: number,
): DockPointerRect | null {
  if (!element.isConnected || element.getClientRects().length === 0) return null;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    if (node.matches('[hidden], [inert], [aria-hidden="true"], [data-state="closed"]')) return null;
    const style = getComputedStyle(node);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse' ||
      (style.opacity !== '' && Number(style.opacity) === 0)
    )
      return null;
  }
  const rect = element.getBoundingClientRect();
  const x = Math.max(0, rect.left);
  const y = Math.max(0, rect.top);
  const right = Math.min(viewportWidth, rect.right);
  const bottom = Math.min(viewportHeight, rect.bottom);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

function intersectRects(a: DockPointerRect, b: DockPointerRect): DockPointerRect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

interface PopupRegistration {
  close?: () => void;
  pointerEvents: string;
  popup: boolean;
}

export function createDockConversationPopupOwner(options: {
  surface: () => HTMLElement | undefined;
  target: HTMLElement;
  active: () => boolean;
  onRegionsChange: (regions: DockPointerRect[]) => void;
  onPopupStateChange: (open: boolean) => void;
  /** Visible host ink in viewport CSS pixels. Inline content never claims beyond it;
   * body-level popups are independent. Omitted: the surface itself is the bound. */
  clip?: () => DockPointerRect | null;
}) {
  const popups = new Map<HTMLElement, PopupRegistration>();
  let disposed = false;
  let closing = false;
  let frame: number | undefined;
  let measureTask: ReturnType<typeof setTimeout> | undefined;
  let lastRegions = '';
  let popupOpen = false;
  const resize = new ResizeObserver(schedule);
  const mutations = new MutationObserver(schedule);
  const surface = options.surface();
  if (surface) resize.observe(surface);
  mutations.observe(options.target, { childList: true, subtree: true, attributes: true });
  if (surface) mutations.observe(surface, { childList: true, subtree: true, attributes: true });
  window.addEventListener('resize', schedule);
  document.addEventListener('scroll', schedule, true);

  function owns(element: HTMLElement): boolean {
    return options.target.contains(element) || !!options.surface()?.contains(element);
  }

  function setOpen(open: boolean): void {
    if (popupOpen === open) return;
    popupOpen = open;
    options.onPopupStateChange(open);
  }

  function publish(regions: DockPointerRect[]): void {
    const key = JSON.stringify(regions);
    if (key === lastRegions) return;
    lastRegions = key;
    options.onRegionsChange(regions);
  }

  function cancelFrame(): void {
    if (frame !== undefined) cancelAnimationFrame(frame);
    clearTimeout(measureTask);
    frame = undefined;
    measureTask = undefined;
  }

  function unregister(element: HTMLElement, registration: PopupRegistration): void {
    if (popups.get(element) !== registration) return;
    popups.delete(element);
    resize.unobserve(element);
    element.style.pointerEvents = registration.pointerEvents;
    schedule();
  }

  function close(): void {
    if (closing) return;
    closing = true;
    const current = [...popups];
    const callbacks = new Set<() => void>();
    for (const [element, registration] of current) {
      unregister(element, registration);
      if (registration.close) callbacks.add(registration.close);
    }
    for (const callback of callbacks) {
      try {
        callback();
      } catch (error) {
        logger.warn('Failed to close an owned conversation popup', { error });
      }
    }
    setOpen(false);
    closing = false;
  }

  function measure(): void {
    frame = undefined;
    measureTask = undefined;
    if (disposed) return;
    if (!options.active()) {
      close();
      cancelFrame();
      publish([]);
      return;
    }
    const regions: DockPointerRect[] = [];
    const root = options.surface();
    const clip = options.clip?.() ?? null;
    const rootRect = root && visiblePopupRect(root, window.innerWidth, window.innerHeight);
    const surfaceRect = rootRect && clip ? intersectRects(rootRect, clip) : rootRect;
    if (surfaceRect) regions.push(surfaceRect);
    let open = false;
    for (const [element, registration] of popups) {
      if (!element.isConnected || !owns(element)) {
        unregister(element, registration);
        continue;
      }
      if (
        registration.popup &&
        !element.closest('[hidden], [inert], [aria-hidden="true"], [data-state="closed"]')
      )
        open = true;
      const rect = visiblePopupRect(element, window.innerWidth, window.innerHeight);
      if (rect && root?.contains(element)) {
        // Inline lists and toast actions are clipped by the conversation panel.
        // Their overflow must not claim transparent space beyond that panel.
        const inline = surfaceRect && intersectRects(rect, surfaceRect);
        if (inline) regions.push(inline);
      } else if (rect) regions.push(rect);
    }
    setOpen(open);
    publish(regions);
    // ResizeObserver does not report CSS transforms during popup entry/exit.
    // Sample only while explicit popup registrations exist; native IPC deduplicates.
    if (popups.size) schedule();
  }

  function schedule(): void {
    // Measure after the frame has laid out (a task queued from the frame): reading popup
    // bounds inside the frame forced a reflow every frame while the dock animated.
    if (!disposed && frame === undefined)
      frame = requestAnimationFrame(() => {
        measureTask = setTimeout(measure, 0);
      });
  }

  function refresh(): void {
    if (disposed) return;
    if (!options.active()) {
      close();
      cancelFrame();
      publish([]);
    } else schedule();
  }

  function register(element: HTMLElement, closePopup?: () => void, popup = true): () => void {
    if (closing) return () => {};
    if (disposed || !options.active()) {
      closePopup?.();
      return () => {};
    }
    if (
      element === options.target ||
      element === options.surface() ||
      !owns(element) ||
      element.matches('[data-slot="dialog-overlay"], [data-slot="dialog-portal"]')
    )
      return () => {};
    const previous = popups.get(element);
    if (previous) unregister(element, previous);
    const registration = { close: closePopup, pointerEvents: element.style.pointerEvents, popup };
    popups.set(element, registration);
    element.style.pointerEvents = 'auto';
    resize.observe(element);
    if (popup) setOpen(true);
    schedule();
    return () => unregister(element, registration);
  }

  refresh();
  return {
    register,
    registerNotification: (element: HTMLElement) => register(element, undefined, false),
    refresh,
    close,
    destroy(): void {
      if (disposed) return;
      disposed = true;
      close();
      cancelFrame();
      resize.disconnect();
      mutations.disconnect();
      window.removeEventListener('resize', schedule);
      document.removeEventListener('scroll', schedule, true);
      publish([]);
    },
  };
}
