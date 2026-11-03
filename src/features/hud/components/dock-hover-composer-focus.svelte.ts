import { onDestroy, untrack } from 'svelte';

/** A genuine notch hover grants one focus attempt after its expansion settles. */
export function useDockHoverComposerFocus(
  state: () => {
    notch: boolean;
    workspaceId: string | null;
    expanded: boolean;
    settled: boolean;
    blocked: boolean;
    popup: boolean;
    root: HTMLElement | undefined;
  },
  focusWindow: () => void,
) {
  let inside = false;
  let pending = $state<{ workspaceId: string } | null>(null);
  function cancel() {
    pending = null;
  }
  function enter() {
    if (inside) return;
    inside = true;
    const current = state();
    if (
      current.notch &&
      current.workspaceId &&
      !current.blocked &&
      !current.popup &&
      (!current.expanded || !current.settled)
    )
      pending = { workspaceId: current.workspaceId };
  }
  function leave() {
    inside = false;
    cancel();
  }
  $effect(() => {
    const ticket = pending;
    const current = state();
    if (!ticket) return;
    if (
      !inside ||
      !current.notch ||
      current.workspaceId !== ticket.workspaceId ||
      current.blocked ||
      current.popup
    ) {
      untrack(cancel);
      return;
    }
    if (!current.expanded || !current.settled) return;
    untrack(() => {
      cancel();
      const composer = [
        ...(current.root?.querySelectorAll<HTMLElement>('[data-dock-conversation-composer]') ?? []),
      ].find(
        (element) =>
          element.isConnected &&
          !element.matches(':disabled, [aria-disabled="true"], [contenteditable="false"]') &&
          !element.closest('[inert], [hidden], [aria-disabled="true"]') &&
          element.getBoundingClientRect().height > 0 &&
          getComputedStyle(element).visibility !== 'hidden',
      );
      if (!composer) return;
      const target = composer.matches('input, textarea, [contenteditable="true"]')
        ? composer
        : composer.querySelector<HTMLElement>(
            '[contenteditable="true"], textarea:not(:disabled), input:not(:disabled)',
          );
      if (!target || !target.isConnected || target.getBoundingClientRect().height === 0) return;
      const selection = document.getSelection();
      const range =
        selection?.rangeCount && target.contains(selection.anchorNode)
          ? selection.getRangeAt(0).cloneRange()
          : null;
      focusWindow();
      target.focus({ preventScroll: true });
      if (
        range?.commonAncestorContainer.isConnected &&
        target.contains(range.commonAncestorContainer)
      ) {
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    });
  });
  onDestroy(leave);
  return { enter, leave, cancel };
}
