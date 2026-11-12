import { onMount, untrack } from 'svelte';
import { spring } from '$lib/motion';

/** A still pointer beyond the edge keeps disclosure for this many graces. Native
 * may stop forwarding once the pointer leaves the window, so the hold is bounded. */
const RESIZE_APPROACH_GRACES = 6;

/** Passive disclosure never changes the caller's selected conversation or draft. */
export function useDockConversationPresence(
  workspaceId: () => string | null,
  root: () => HTMLElement | undefined,
  blocked: () => boolean,
  engaged: () => boolean = () => false,
  /** False where only an explicit open (a click) discloses the conversation. */
  autoOpen: () => boolean = () => true,
  hoverDelayMs: () => number = () => 0,
) {
  let open = $state(false);
  let pointerInside = false;
  /** Last forwarded outside point; re-measured against live handles when a close is due. */
  let approach: { x: number; y: number; at: number } | null = null;
  let keyboard = $state(false);
  let focusEngaged = false;
  let dismissed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let hoverTimer: ReturnType<typeof setTimeout> | undefined;

  function portal(node: Node | null): boolean {
    return (
      node instanceof Element &&
      node.closest<HTMLElement>('[data-dock-conversation-portals]')?.dataset.workspaceId ===
        workspaceId()
    );
  }
  function owns(node: Node | null): boolean {
    return node instanceof Node && (!!root()?.contains(node) || portal(node));
  }
  /** Native forwards moves outside its input regions; a short overshoot past a
   * resize handle is an approach, not a dismissal. No hit region is claimed. */
  function nearResize(point: { x: number; y: number; at: number } | null): boolean {
    const scope = root();
    if (!point || !open || blocked() || !scope || !workspaceId()) return false;
    if (performance.now() - point.at >= spring.moderate.settleMs * RESIZE_APPROACH_GRACES)
      return false;
    for (const handle of scope.querySelectorAll<HTMLElement>('[data-dock-resize]')) {
      const rect = handle.getBoundingClientRect();
      const depth = Math.min(rect.width, rect.height);
      if (
        depth > 0 &&
        point.x >= rect.left - depth &&
        point.x <= rect.right + depth &&
        point.y >= rect.top - depth &&
        point.y <= rect.bottom + depth
      )
        return true;
    }
    return false;
  }
  function hasFocus(): boolean {
    const target = document.activeElement;
    if (!document.hasFocus() || !(target instanceof HTMLElement) || !owns(target)) return false;
    return (
      portal(target) ||
      ((focusEngaged || keyboard) &&
        (target.matches('input, textarea, select, [contenteditable="true"]') ||
          !!target.closest('[contenteditable="true"]') ||
          target.matches(':focus-visible')))
    );
  }
  function show(fromKeyboard = false): void {
    cancel();
    if (fromKeyboard) {
      keyboard = true;
      dismissed = false;
    }
    if (dismissed) return;
    if (!blocked()) open = true;
  }
  function hide(suppressHover = false): void {
    cancel();
    dismissed = suppressHover;
    keyboard = false;
    focusEngaged = false;
    approach = null;
    open = false;
  }
  function leave(): void {
    dismissed = false;
    pointerInside = false;
    settle();
  }
  function cancel(): void {
    clearTimeout(timer);
    timer = undefined;
    clearTimeout(hoverTimer);
    hoverTimer = undefined;
  }
  function hover(): void {
    if (dismissed || blocked() || !workspaceId() || (!open && !autoOpen())) return;
    if (open || hoverDelayMs() === 0) {
      show();
      return;
    }
    clearTimeout(timer);
    timer = undefined;
    if (hoverTimer !== undefined) return;
    hoverTimer = setTimeout(() => {
      hoverTimer = undefined;
      if (pointerInside && !blocked() && workspaceId() && autoOpen()) show();
    }, hoverDelayMs());
  }
  function settle(): void {
    cancel();
    timer = setTimeout(() => {
      timer = undefined;
      if (engaged() || pointerInside || hasFocus()) return;
      // Re-measure live handles each grace while the pointer rests in the band, so
      // a moved, resized or replaced edge never keeps a stale approach open.
      if (nearResize(approach)) {
        settle();
        return;
      }
      approach = null;
      keyboard = false;
      open = false;
    }, spring.moderate.settleMs);
  }
  $effect(() => {
    const id = workspaceId();
    untrack(() => {
      cancel();
      approach = null;
      dismissed = false;
      focusEngaged = false;
      open = !!id && !blocked() && (autoOpen() || open);
    });
  });
  $effect(() => {
    root();
    untrack(() => {
      approach = null;
    });
  });
  $effect(() => {
    if (blocked())
      untrack(() => {
        cancel();
        approach = null;
        pointerInside = false;
        open = false;
      });
  });
  $effect(() => {
    if (engaged()) untrack(() => show());
    else untrack(settle);
  });
  onMount(() => {
    const point = (event: PointerEvent) => ({
      x: event.clientX,
      y: event.clientY,
      at: performance.now(),
    });
    const over = (event: PointerEvent) => {
      pointerInside = owns(event.target as Node);
      approach = pointerInside ? null : point(event);
      if (!pointerInside) settle();
      else hover();
    };
    const out = (event: PointerEvent) => {
      pointerInside = owns(event.relatedTarget as Node | null);
      approach = pointerInside ? null : point(event);
      if (!pointerInside) settle();
    };
    const move = (event: PointerEvent) => {
      if (pointerInside) return;
      approach = point(event);
      if (open && timer === undefined) settle();
    };
    const focus = (event: FocusEvent) => {
      if (workspaceId() && owns(event.target as Node)) show();
    };
    const pointer = (event: PointerEvent) => {
      keyboard = false;
      focusEngaged = owns(event.target as Node);
      if (focusEngaged) dismissed = false;
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' && owns(document.activeElement)) keyboard = true;
    };
    const blur = () => {
      pointerInside = false;
      approach = null;
      focusEngaged = false;
      keyboard = false;
      dismissed = false;
      settle();
    };
    document.addEventListener('pointerover', over, true);
    document.addEventListener('pointerout', out, true);
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerdown', pointer, true);
    document.addEventListener('keydown', key, true);
    document.addEventListener('focusin', focus, true);
    document.addEventListener('focusout', settle, true);
    window.addEventListener('blur', blur);
    return () => {
      cancel();
      document.removeEventListener('pointerover', over, true);
      document.removeEventListener('pointerout', out, true);
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerdown', pointer, true);
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('focusin', focus, true);
      document.removeEventListener('focusout', settle, true);
      window.removeEventListener('blur', blur);
    };
  });
  return {
    get open() {
      return open;
    },
    get keyboardOpen() {
      return keyboard && open;
    },
    show,
    hide,
    leave,
  };
}
