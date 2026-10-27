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
}) {
  const popups = new Map<HTMLElement, PopupRegistration>();
  let disposed = false;
  let closing = false;
  let frame: number | undefined;
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
    frame = undefined;
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
    if (disposed) return;
    if (!options.active()) {
      close();
      cancelFrame();
      publish([]);
      return;
    }
    const regions: DockPointerRect[] = [];
    const root = options.surface();
    const surfaceRect = root && visiblePopupRect(root, window.innerWidth, window.innerHeight);
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
        if (surfaceRect) {
          const x = Math.max(rect.x, surfaceRect.x);
          const y = Math.max(rect.y, surfaceRect.y);
          const right = Math.min(rect.x + rect.width, surfaceRect.x + surfaceRect.width);
          const bottom = Math.min(rect.y + rect.height, surfaceRect.y + surfaceRect.height);
          if (right > x && bottom > y) regions.push({ x, y, width: right - x, height: bottom - y });
        }
      } else if (rect) regions.push(rect);
    }
    setOpen(open);
    publish(regions);
    // ResizeObserver does not report CSS transforms during popup entry/exit.
    // Sample only while explicit popup registrations exist; native IPC deduplicates.
    if (popups.size) schedule();
  }

  function schedule(): void {
    if (!disposed && frame === undefined) frame = requestAnimationFrame(measure);
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
