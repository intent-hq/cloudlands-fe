/**
 * Overlay tracker for main-owned browser pages (Labs).
 *
 * A main-owned page is a native view that draws above the app's DOM, so a
 * menu, popover, dialog, tooltip or toast over a browser box would be hidden
 * behind the page (design §2.3.4). Each BrowserViewSlot registers here; while
 * an overlay intersects its box (or a tab drag or panel resize runs), the slot
 * shows a snapshot of the page and main hides the view (design §2.3.5).
 *
 * One tracker serves all slots: a MutationObserver marks the overlay set
 * dirty, and one animation frame recomputes which slots are covered.
 */

/** App overlays that can open over a browser box. */
export const BROWSER_VIEW_OVERLAY_SELECTOR = [
  '[data-bits-floating-content-wrapper]',
  '[role="menu"]',
  '[role="listbox"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="tooltip"]',
  '[data-dialog-overlay]',
  '[data-alert-dialog-overlay]',
  '[data-sonner-toast]',
  // Opt-in for any other floating UI.
  '[data-browser-view-overlay]',
].join(',');

/** Body classes that mean "pointer work over the app": the page must not catch the pointer. */
const POINTER_BUSY_BODY_CLASSES = ['panel-resizing'];

export interface BrowserViewSlotRegistration {
  /** The slot's element (its box is the page's box). */
  element: HTMLElement;
  /** Called when the slot becomes covered or uncovered. */
  onCoveredChange(covered: boolean): void;
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function intersects(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/**
 * Whether an element floats over the layout: in a floating wrapper, or in a
 * fixed-position box. In-flow elements with an overlay role (an inline
 * listbox, say) sit beside a browser box, not over it.
 */
function isFloating(element: Element): boolean {
  if (element.closest('[data-bits-floating-content-wrapper]')) return true;
  for (let node: Element | null = element; node && node !== document.body;) {
    if (getComputedStyle(node).position === 'fixed') return true;
    node = node.parentElement;
  }
  return false;
}

/** Whether an overlay element is open and drawn (not hidden, not zero size). */
function isDrawn(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const html = element as HTMLElement;
  if (typeof html.checkVisibility === 'function') {
    return html.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  }
  for (let node: Element | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}

/**
 * Which registered slots an open overlay covers.
 * @internal Exported for unit tests.
 */
export function coveredSlots(
  slots: readonly HTMLElement[],
  overlays: readonly Element[],
  pointerBusy: boolean,
): Set<HTMLElement> {
  const covered = new Set<HTMLElement>();
  if (slots.length === 0) return covered;
  if (pointerBusy) return new Set(slots);
  const overlayBoxes: Box[] = [];
  for (const overlay of overlays) {
    // A slot's own snapshot or content is not an overlay.
    if (slots.some((slot) => slot.contains(overlay))) continue;
    if (!isDrawn(overlay) || !isFloating(overlay)) continue;
    overlayBoxes.push(overlay.getBoundingClientRect());
  }
  if (overlayBoxes.length === 0) return covered;
  for (const slot of slots) {
    const box = slot.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) continue;
    if (overlayBoxes.some((overlay) => intersects(box, overlay))) covered.add(slot);
  }
  return covered;
}

class OverlayTracker {
  private readonly slots = new Map<HTMLElement, BrowserViewSlotRegistration>();
  private readonly covered = new Set<HTMLElement>();
  private observer: MutationObserver | null = null;
  private frame: number | null = null;
  private dragging = false;

  register(registration: BrowserViewSlotRegistration): () => void {
    this.slots.set(registration.element, registration);
    this.start();
    this.schedule();
    return () => {
      this.slots.delete(registration.element);
      this.covered.delete(registration.element);
      if (this.slots.size === 0) this.stop();
    };
  }

  /** A tab drag started or ended (panel layout drag state). */
  setDragging(dragging: boolean): void {
    if (this.dragging === dragging) return;
    this.dragging = dragging;
    this.schedule();
  }

  /** Recompute on the next frame (slots moved, an overlay may have opened). */
  schedule(): void {
    if (this.frame !== null || this.slots.size === 0) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.recompute();
    });
  }

  private start(): void {
    if (this.observer || typeof MutationObserver === 'undefined') return;
    this.observer = new MutationObserver(() => this.schedule());
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-state', 'open', 'hidden', 'class', 'style'],
    });
  }

  private stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  private recompute(): void {
    const slots = [...this.slots.keys()];
    const overlays = Array.from(document.querySelectorAll(BROWSER_VIEW_OVERLAY_SELECTOR));
    const pointerBusy =
      this.dragging ||
      POINTER_BUSY_BODY_CLASSES.some((name) => document.body.classList.contains(name));
    const next = coveredSlots(slots, overlays, pointerBusy);
    for (const slot of slots) {
      const was = this.covered.has(slot);
      const now = next.has(slot);
      if (was === now) continue;
      if (now) this.covered.add(slot);
      else this.covered.delete(slot);
      this.slots.get(slot)?.onCoveredChange(now);
    }
  }
}

const tracker = new OverlayTracker();

/** Register a slot. Returns the unregister function. */
export function trackBrowserViewSlot(registration: BrowserViewSlotRegistration): () => void {
  return tracker.register(registration);
}

/** The slot moved or resized: check overlays against its new box. */
export function browserViewSlotMoved(): void {
  tracker.schedule();
}

/** A tab drag started or ended. */
export function setBrowserViewTabDragging(dragging: boolean): void {
  tracker.setDragging(dragging);
}
