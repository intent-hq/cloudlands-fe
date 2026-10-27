import { onDestroy, onMount, tick, untrack } from 'svelte';
import { revealDockItem } from '$features/hud/utils/dock-scroll';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';

interface DockConversationFocus {
  readonly workspaceId: string | null;
  readonly request: number;
  readonly contentVisible: boolean;
  readonly keyboardOpen: boolean;
  readonly expanded: boolean;
  readonly hidden: boolean;
  readonly root: HTMLElement | undefined;
  readonly surface: HTMLElement | undefined;
  readonly grip: HTMLElement | null;
  openKeyboard: (returning?: boolean) => void;
  pointerOutside: (event: PointerEvent) => void;
}

/** Keep selection in the caller; only coordinate disclosure and DOM focus here. */
export function useDockConversationFocus(state: DockConversationFocus) {
  let disposed = false;
  let returning = $state(false);
  let previousWorkspace: string | null = null;
  let lastRequest = 0;
  $effect(() => {
    if (state.request) untrack(state.openKeyboard);
  });
  $effect(() => {
    const request = state.request;
    if (state.workspaceId) {
      // The mounted conversation surface handles this request, not the overview.
      lastRequest = request;
      return;
    }
    if (!request || !state.contentVisible || !state.keyboardOpen) return;
    untrack(() => {
      if (request === lastRequest) return;
      lastRequest = request;
      void tick().then(() => {
        if (!disposed && state.keyboardOpen && state.expanded && !state.workspaceId)
          state.surface
            ?.querySelector<HTMLElement>('[data-dock-row]')
            ?.focus({ preventScroll: true });
      });
    });
  });
  $effect(() => {
    const id = state.workspaceId;
    untrack(() => {
      const previous = previousWorkspace;
      previousWorkspace = id;
      if (id || state.hidden) returning = false;
      if (!previous || id || state.hidden) return;
      returning = true;
      state.openKeyboard(true);
      void tick().then(() => {
        if (disposed || state.workspaceId || state.hidden) return;
        const targetId = previous === CHIEF_WORKSPACE_ID ? 'dock:assistant' : previous;
        const targets = state.root?.querySelectorAll<HTMLElement>(
          '[data-dock-entry], [data-dock-row]',
        );
        const target = Array.from(targets ?? []).find(
          (node) => (node.dataset.dockEntry ?? node.dataset.workspaceId) === targetId,
        );
        (target ?? state.grip)?.focus({ preventScroll: true });
        if (target) revealDockItem(target);
      });
    });
  });
  function pointerLeave(): void {
    returning = false;
  }
  onMount(() => {
    let lastPointer: { x: number; y: number } | undefined;
    const rememberPointer = (event: PointerEvent) => {
      lastPointer = { x: event.clientX, y: event.clientY };
    };
    const move = (event: PointerEvent) => {
      const moved =
        !lastPointer || lastPointer.x !== event.clientX || lastPointer.y !== event.clientY;
      rememberPointer(event);
      if (!moved || !returning || state.workspaceId || state.hidden) return;
      const bounds = state.surface?.getBoundingClientRect();
      if (
        !bounds ||
        (event.clientX >= bounds.left &&
          event.clientX < bounds.right &&
          event.clientY >= bounds.top &&
          event.clientY < bounds.bottom)
      )
        return;
      // Back can move the surface away before the return hold is established.
      // Release on actual pointer movement, even if no further section leave fires.
      pointerLeave();
      state.pointerOutside(event);
    };
    window.addEventListener('pointerdown', rememberPointer, true);
    window.addEventListener('pointermove', move, true);
    window.addEventListener('blur', pointerLeave);
    return () => {
      window.removeEventListener('pointerdown', rememberPointer, true);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('blur', pointerLeave);
    };
  });
  onDestroy(() => {
    disposed = true;
  });
  return {
    get returning() {
      return returning;
    },
    pointerLeave,
    keepsOverviewOpen(pointerInside: boolean, keyboardOpen: boolean): boolean {
      if (pointerInside || returning) return true;
      const focused = document.activeElement;
      return !!(
        document.hasFocus() &&
        state.surface?.contains(focused) &&
        focused?.matches(':focus-visible') &&
        keyboardOpen
      );
    },
  };
}
