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
  // The repeat click of a Cmd/Ctrl double-click: the first click already opened it.
  if (!(event instanceof MouseEvent && event.detail > 1)) onopen(id);
  return true;
}

/** How far (px) the second press may land from the first and still count as a double-click. */
const DOUBLE_CLICK_SLOP_PX = 6;
const DOUBLE_CLICK_EVENTS = ['mousedown', 'mouseup', 'click', 'dblclick'] as const;

export interface HomeDoubleClickOpener {
  /** Call from a row's click handler; only a plain primary click on the row body arms. */
  arm: (event: MouseEvent, id: string) => void;
  /** Attachment for the Home root that contains both the list and its preview. */
  listen: (element: HTMLElement) => () => void;
}

/**
 * Opens a Home row on double-click. The repeat press of a double-click (browser
 * `detail >= 2`, which applies the OS double-click speed, near the armed first
 * click) is caught in the capture phase on the
 * Home root, so it works even when the first click swapped the list for the preview
 * in a narrow layout. That press never reaches the element under the cursor: it does
 * not toggle the row's selection, select text, or press a control in the preview.
 */
export function createHomeDoubleClickOpener(onopen: (id: string) => void): HomeDoubleClickOpener {
  let armed: { id: string; x: number; y: number; opened: boolean } | null = null;
  function capture(event: Event) {
    if (!armed || !(event instanceof MouseEvent)) return;
    const repeat =
      event.button === 0 &&
      event.detail >= 2 &&
      Math.hypot(event.clientX - armed.x, event.clientY - armed.y) <= DOUBLE_CLICK_SLOP_PX;
    if (!repeat) {
      if (event.type === 'mousedown') armed = null;
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.type === 'click' && !armed.opened) {
      armed.opened = true;
      onopen(armed.id);
    }
  }
  return {
    arm(event, id) {
      const plain =
        event.button === 0 &&
        event.detail === 1 &&
        !event.shiftKey &&
        !event.altKey &&
        !isCmdClickModifier({ event }) &&
        !isNestedControl(event);
      armed = plain ? { id, x: event.clientX, y: event.clientY, opened: false } : null;
    },
    listen(element) {
      for (const type of DOUBLE_CLICK_EVENTS) element.addEventListener(type, capture, true);
      return () => {
        for (const type of DOUBLE_CLICK_EVENTS) element.removeEventListener(type, capture, true);
      };
    },
  };
}
