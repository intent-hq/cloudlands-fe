<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { ActionMenu, defineActions } from '$lib/components/patterns/action-menu';
  import { faArrowUpRightFromSquare, faPen, faXmark } from '$lib/icons/phosphor-icons';
  import type { DockPlacementTarget } from '$shared/dock-placement';
  import { m } from '$shared/paraglide/messages.js';

  let {
    open = $bindable(false),
    ref = $bindable(null),
    anchor,
    title,
    isAssistant = false,
    onOpenWorkspace,
    onAnnotate,
    onPlacement,
    onDismiss,
    side = 'left',
  }: {
    open?: boolean;
    ref?: HTMLDivElement | null;
    anchor: HTMLButtonElement;
    title: string;
    isAssistant?: boolean;
    onOpenWorkspace: () => void;
    onAnnotate: () => void;
    onPlacement?: (target: DockPlacementTarget) => void;
    onDismiss?: () => void;
    side?: 'left' | 'right' | 'bottom';
  } = $props();

  const actions = $derived(
    defineActions([
      {
        id: 'open',
        label: isAssistant ? m.dock_openAssistant_label() : m.dock_openWorkspace_label(),
        icon: faArrowUpRightFromSquare,
      },
      { id: 'feedback', label: m.dock_feedback_label(), icon: faPen },
      ...(onPlacement
        ? [
            { id: 'notch', label: m.dock_moveNotch_label() },
            { id: 'left', label: m.dock_moveLeft_label() },
            { id: 'right', label: m.dock_moveRight_label() },
            { id: 'floating', label: m.dock_moveFloating_label() },
          ]
        : []),
      ...(onDismiss ? [{ id: 'dismiss', label: m.dock_dismiss_label(), icon: faXmark }] : []),
    ]),
  );
  const contextMenu = $derived.by(() => {
    if (!open) return undefined;
    const rect = anchor.getBoundingClientRect();
    return { x: rect.left, y: rect.top, returnFocus: anchor };
  });

  // ActionMenu portals its accessible content. Expose only that content's native
  // hit region; the rest of the transparent desktop window remains click-through.
  onMount(() => {
    const capture = () => {
      const content = document.querySelector<HTMLDivElement>(
        '.dock-action-menu-content[role="menu"]',
      );
      if (ref === content) return;
      ref = content;
      if (!content) return;
      // One entry focus per newly mounted menu. Later layout mutations must not
      // reset the first ArrowDown or a selection made while reopening the menu.
      void tick().then(() => {
        if (!open || ref !== content || !content.isConnected) return;
        const active = document.activeElement;
        if (active !== content && content.contains(active)) return;
        content
          .querySelector<HTMLElement>(
            '[role="menuitem"]:not([data-disabled]):not([aria-disabled="true"])',
          )
          ?.focus({ preventScroll: true });
      });
    };
    const observer = new MutationObserver(capture);
    observer.observe(document.body, { childList: true, subtree: true });
    capture();
    return () => {
      observer.disconnect();
      ref = null;
    };
  });
</script>

{#if open}
  <ActionMenu
    bind:open
    {actions}
    {contextMenu}
    ariaLabel={title}
    {side}
    align="start"
    class="dock-action-menu-content max-w-64 animate-none! transition-none!"
    onAction={(id) => {
      if (id === 'dismiss') onDismiss?.();
      else if (id === 'feedback') onAnnotate();
      else if (id === 'open') onOpenWorkspace();
      else if (id === 'notch' || id === 'left' || id === 'right' || id === 'floating')
        onPlacement?.(id);
    }}
  />
{/if}
