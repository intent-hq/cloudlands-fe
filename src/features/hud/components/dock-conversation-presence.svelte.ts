import { onMount, untrack } from 'svelte';
import { spring } from '$lib/motion';

/** Passive disclosure never changes the caller's selected conversation or draft. */
export function useDockConversationPresence(
  workspaceId: () => string | null,
  root: () => HTMLElement | undefined,
  blocked: () => boolean,
  engaged: () => boolean = () => false,
) {
  let open = $state(false);
  let pointerInside = false;
  let keyboard = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

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
  function hasFocus(): boolean {
    const target = document.activeElement;
    if (!document.hasFocus() || !(target instanceof HTMLElement) || !owns(target)) return false;
    return (
      portal(target) ||
      target.matches('input, textarea, select, [contenteditable="true"]') ||
      !!target.closest('[contenteditable="true"]') ||
      (keyboard && target.matches(':focus-visible'))
    );
  }
  function show(fromKeyboard = false): void {
    clearTimeout(timer);
    if (fromKeyboard) keyboard = true;
    if (!blocked()) open = true;
  }
  function settle(): void {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!engaged() && !pointerInside && !hasFocus()) {
        keyboard = false;
        open = false;
      }
    }, spring.moderate.settleMs);
  }
  $effect(() => {
    const id = workspaceId();
    untrack(() => {
      clearTimeout(timer);
      open = !!id && !blocked();
    });
  });
  $effect(() => {
    if (blocked())
      untrack(() => {
        clearTimeout(timer);
        pointerInside = false;
        open = false;
      });
  });
  $effect(() => {
    if (engaged()) untrack(() => show());
    else untrack(settle);
  });
  onMount(() => {
    const over = (event: PointerEvent) => {
      pointerInside = owns(event.target as Node);
      if (workspaceId() && pointerInside) show();
      else settle();
    };
    const out = (event: PointerEvent) => {
      pointerInside = owns(event.relatedTarget as Node | null);
      if (!pointerInside) settle();
    };
    const focus = (event: FocusEvent) => {
      if (workspaceId() && owns(event.target as Node)) show();
    };
    const pointer = () => {
      keyboard = false;
    };
    const key = () => {
      keyboard = true;
    };
    const blur = () => {
      pointerInside = false;
      settle();
    };
    document.addEventListener('pointerover', over, true);
    document.addEventListener('pointerout', out, true);
    document.addEventListener('pointerdown', pointer, true);
    document.addEventListener('keydown', key, true);
    document.addEventListener('focusin', focus, true);
    document.addEventListener('focusout', settle, true);
    window.addEventListener('blur', blur);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerover', over, true);
      document.removeEventListener('pointerout', out, true);
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
  };
}
