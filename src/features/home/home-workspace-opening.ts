import { isCmdClickModifier } from '$shared/utils/link-helpers';

function isNestedControl(event: MouseEvent | KeyboardEvent): boolean {
  const control =
    event.target instanceof Element
      ? event.target.closest(
          'button, a, input, select, textarea, [role="button"], [role="menuitem"]',
        )
      : null;
  return Boolean(control && control !== event.currentTarget);
}

export function openHomeWorkspaceFromEvent(
  event: MouseEvent | KeyboardEvent,
  id: string,
  onopen: (id: string) => void,
): boolean {
  if (!isCmdClickModifier({ event })) return false;
  if (event instanceof MouseEvent && event.button !== 0) return false;
  if (event instanceof KeyboardEvent && event.key !== 'Enter' && event.key !== ' ') return false;
  if (isNestedControl(event)) return false;
  event.preventDefault();
  event.stopPropagation();
  onopen(id);
  return true;
}

/** How far (px) the second press may land from the first and still count as a double-click. */
const DOUBLE_CLICK_SLOP_PX = 16;
/**
 * Pointer events carry no click count, so a `pointerdown` counts as the repeat press
 * when it lands this soon after the armed click (the following mouse events still
 * check the browser's count, which applies the OS double-click speed).
 */
const DOUBLE_CLICK_POINTER_MS = 800;
const DOUBLE_CLICK_EVENTS = ['pointerdown', 'mousedown', 'click', 'dblclick', 'dragstart'] as const;

export interface HomeDoubleClickOpener {
  /**
   * Call from a row's click handler before acting on it. A plain primary click on the
   * row body arms opening; a Cmd/Ctrl/Shift/Alt click arms swallow-only, because its
   * own handler already acted. Clicks on nested controls disarm.
   */
  arm: (event: MouseEvent, id: string) => void;
  /** Attachment for the Home root that contains both the list and its preview. */
  listen: (element: HTMLElement) => () => void;
}

/**
 * Opens a Home row on double-click. The repeat press of a double-click (browser
 * `detail >= 2` near the armed first click) is caught in the capture phase on the Home
 * root, so it works even when the first click swapped the list for the preview in a
 * narrow layout. That press does not reach the element under the cursor: it does not
 * toggle the row's selection, select text, or press a control in the preview.
 */
export function createHomeDoubleClickOpener(onopen: (id: string) => void): HomeDoubleClickOpener {
  let armed: { id: string; x: number; y: number; at: number; open: boolean } | null = null;
  function capture(event: Event) {
    if (event.type === 'dragstart') {
      armed = null;
      return;
    }
    if (!armed || !(event instanceof MouseEvent) || event.button !== 0) return;
    const near =
      Math.hypot(event.clientX - armed.x, event.clientY - armed.y) <= DOUBLE_CLICK_SLOP_PX;
    if (event.type === 'pointerdown') {
      if (near && event.timeStamp - armed.at <= DOUBLE_CLICK_POINTER_MS) event.stopPropagation();
      return;
    }
    if (!near || event.detail < 2) {
      if (event.type === 'mousedown') armed = null;
      return;
    }
    const startsCardDrag =
      event.type === 'mousedown' &&
      event.target instanceof Element &&
      Boolean(event.target.closest('[data-home-workspace][draggable="true"]'));
    if (!startsCardDrag) event.preventDefault();
    event.stopPropagation();
    if (event.type === 'click' && armed.open) {
      armed.open = false;
      onopen(armed.id);
    }
  }
  return {
    arm(event, id) {
      const eligible = event.button === 0 && event.detail === 1 && !isNestedControl(event);
      const modified = event.shiftKey || event.altKey || isCmdClickModifier({ event });
      armed = eligible
        ? { id, x: event.clientX, y: event.clientY, at: event.timeStamp, open: !modified }
        : null;
    },
    listen(element) {
      for (const type of DOUBLE_CLICK_EVENTS) element.addEventListener(type, capture, true);
      return () => {
        for (const type of DOUBLE_CLICK_EVENTS) element.removeEventListener(type, capture, true);
      };
    },
  };
}
