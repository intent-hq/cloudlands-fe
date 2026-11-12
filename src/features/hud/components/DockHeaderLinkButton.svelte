<script lang="ts">
  import LinkSimpleIcon from 'phosphor-svelte/lib/LinkSimpleIcon';
  import { m } from '$shared/paraglide/messages.js';
  import { Button } from '$lib/components/ui/button';
  import { store as appStore } from '$store/renderer/store';
  import { selectDockLinkedContext } from '$store/renderer/slices/dock-conversation/dock-conversation-selectors';
  import {
    dockContextLinkRequested,
    dockContextUnlinkRequested,
  } from '$store/renderer/slices/dock-conversation/dock-conversation-slice';

  /**
   * Link the current tab or app (the admitted linked context) to the open workspace, from its
   * conversation header. A toggle: pressed while a saved link sends this context here, where a
   * press unlinks it. Otherwise a press links (relinks from another workspace, or saves an
   * inferred owner) when the context can be saved. Unknown or unsavable contexts show nothing.
   * Link and unlink go through the canonical versioned actions; the pressed state follows only
   * the confirmed snapshot.
   */
  let { workspaceId, title }: { workspaceId: string; title: string } = $props();
  const context$ = selectDockLinkedContext();
  const context = $derived($context$);
  const ready = $derived(!!context && context.phase === 'ready');
  const saved = $derived(
    ready &&
      context!.linkedWorkspaceId === workspaceId &&
      !!context!.linkKey &&
      context!.linkRevision > 0,
  );
  const shown = $derived(ready && (saved || context!.linkable));
  const contextName = $derived(context?.label || '');
  // The name says what a press does: unlink the saved link here, else link this context here.
  const operation = $derived(
    saved
      ? m.dock_linkedTab_unlink_ariaLabel({ context: contextName, workspace: title })
      : m.dock_linkedTab_link_ariaLabel({ context: contextName, workspace: title }),
  );
  /**
   * A held gesture acts on what was on screen when it started. Pointer down or an Enter /
   * Space key down captures the rendered {version, workspace, operation}; if the context or
   * the button's role changes before the click, the gesture is cancelled and the click does
   * nothing (no fallback to the new context). A click without a held gesture (assistive
   * technology) acts on what is rendered at that moment.
   */
  type Tuple = { version: string; workspaceId: string; operation: 'link' | 'unlink' };
  let held: Tuple | 'cancelled' | null = null;
  const rendered = (button: HTMLElement): Tuple | null => {
    const version = button.dataset.contextVersion;
    const operation = button.dataset.dockLinkAction;
    return version && (operation === 'link' || operation === 'unlink')
      ? { version, workspaceId, operation }
      : null;
  };
  const current = $derived(
    shown && context?.contextVersion
      ? `${context.contextVersion}\u0000${workspaceId}\u0000${saved ? 'unlink' : 'link'}`
      : null,
  );
  $effect(() => {
    void current;
    // Anything the held gesture captured changed: it may not complete.
    if (held && held !== 'cancelled') held = 'cancelled';
  });
  function hold(event: PointerEvent | KeyboardEvent): void {
    if (event instanceof KeyboardEvent) {
      if (event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    } else if (event.button !== 0) return;
    held = rendered(event.currentTarget as HTMLElement);
  }
  function release(): void {
    held = null;
  }
  function act(event: MouseEvent): void {
    const gesture = held;
    held = null;
    if (gesture === 'cancelled') return;
    const now = rendered(event.currentTarget as HTMLElement);
    if (!now) return;
    if (
      gesture &&
      (gesture.version !== now.version ||
        gesture.workspaceId !== now.workspaceId ||
        gesture.operation !== now.operation)
    )
      return;
    if (now.operation === 'unlink') appStore.dispatch(dockContextUnlinkRequested(now.version));
    else appStore.dispatch(dockContextLinkRequested(now.version, now.workspaceId));
  }
</script>

{#if shown}
  <Button
    variant="ghost"
    size="icon-sm"
    class="dock-header-link"
    data-dock-header-link
    data-dock-link-action={saved ? 'unlink' : 'link'}
    data-context-version={context?.contextVersion}
    aria-pressed={saved}
    aria-label={operation}
    tooltipContentClass="dock-chrome-tooltip max-w-64 whitespace-normal"
    tooltipSide="bottom"
    tooltipAlign="end"
    tooltip={operation}
    onpointerdown={hold}
    onpointercancel={release}
    onblur={release}
    onkeydown={hold}
    onclick={act}><LinkSimpleIcon size={15} weight={saved ? 'bold' : 'regular'} /></Button
  >
{/if}

<style>
  /* Pressed: this tab or app is linked here; the same quiet accent as other dock state. */
  :global(.dock-header-link[aria-pressed='true']) {
    color: hsl(var(--dock-accent, var(--foreground)));
    background-color: hsl(var(--dock-hover, var(--muted)));
  }
</style>
