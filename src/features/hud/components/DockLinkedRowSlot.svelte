<script lang="ts">
  import LinkSimpleIcon from 'phosphor-svelte/lib/LinkSimpleIcon';
  import LinkBreakIcon from 'phosphor-svelte/lib/LinkBreakIcon';
  import { m } from '$shared/paraglide/messages.js';
  import { Button } from '$lib/components/ui/button';
  import { store as appStore } from '$store/renderer/store';
  import { selectDockLinkedContext } from '$store/renderer/slices/dock-conversation/dock-conversation-selectors';
  import {
    dockContextLinkRequested,
    dockContextUnlinkRequested,
  } from '$store/renderer/slices/dock-conversation/dock-conversation-slice';

  /**
   * A workspace row's time slot on the dock index (linked tabs spec): the row's time, or
   * "This tab" (link icon) on the row the current tab/app is linked to. Hovering or focusing
   * the row offers "Link" on other rows and "Unlink" on the tagged row, with full accessible
   * names. The action is its own button beside the row's open button and lives inside the
   * slot's fixed width (the row grid reserves it), so nothing reflows or overlaps the title.
   * Only the admitted linked context is shown; link and unlink go through the canonical
   * versioned actions, and the tag follows only what was saved.
   */
  let {
    workspaceId,
    title,
    time,
    timeTitle,
    disabled = false,
  }: {
    workspaceId: string;
    title: string;
    time: string;
    timeTitle?: string;
    disabled?: boolean;
  } = $props();
  const context$ = selectDockLinkedContext();
  const context = $derived($context$);
  const app = $derived(context?.identityKind === 'app');
  const ready = $derived(!!context && context.phase === 'ready');
  const linked = $derived(ready && context!.linkedWorkspaceId === workspaceId);
  // Only a saved link can be removed. An inferred (embedded tab / service owner) target has
  // no saved record: it shows the tag, and Link saves it when the context can be saved.
  const canUnlink = $derived(linked && !!context!.linkKey && context!.linkRevision > 0);
  const canLink = $derived(ready && !canUnlink && context!.linkable);
  const contextName = $derived(context?.label || '');
  /**
   * A held gesture acts on what was on screen when it started. Pointer down or an Enter /
   * Space key down captures the rendered {version, workspace, operation}; if the context
   * or the button's role changes before the click, the gesture is cancelled and the click
   * does nothing (no fallback to the new context). A click without a held gesture (assistive
   * technology) acts on what is rendered at that moment.
   */
  type Tuple = { version: string; workspaceId: string; operation: 'link' | 'unlink' };
  let held: Tuple | 'cancelled' | null = null;
  const rendered = (button: HTMLElement): Tuple | null => {
    const version = button.dataset.contextVersion;
    const operation = button.dataset.dockRowAction;
    return version && (operation === 'link' || operation === 'unlink')
      ? { version, workspaceId, operation }
      : null;
  };
  const current = $derived(
    context?.contextVersion && (canLink || canUnlink)
      ? `${context.contextVersion}\u0000${workspaceId}\u0000${canUnlink ? 'unlink' : 'link'}`
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

<span
  class="row-slot type-caption"
  class:has-action={canLink || canUnlink}
  data-linked={linked}
  data-dock-row-slot={workspaceId}
>
  <span class="slot-rest">
    {#if linked}
      <span class="row-tag" data-dock-linked-tag
        ><LinkSimpleIcon size={11} weight="bold" aria-hidden="true" /><span class="truncate"
          >{app ? m.dock_linkedTab_thisApp_label() : m.dock_linkedTab_thisTab_label()}</span
        ></span
      >
    {:else}
      <span class="row-when truncate" title={timeTitle}>{time}</span>
    {/if}
  </span>
  {#if canLink || canUnlink}
    <!-- One button for both roles, so keyboard focus survives a link or unlink. -->
    <Button
      variant="plain"
      class="row-action"
      data-dock-row-action={canUnlink ? 'unlink' : 'link'}
      {disabled}
      aria-label={canUnlink
        ? m.dock_linkedTab_unlink_ariaLabel({ context: contextName, workspace: title })
        : m.dock_linkedTab_link_ariaLabel({ context: contextName, workspace: title })}
      data-context-version={context?.contextVersion}
      onpointerdown={hold}
      onpointercancel={release}
      onblur={release}
      onkeydown={hold}
      onclick={act}
    >
      {#snippet leadingIcon()}
        {#if canUnlink}
          <LinkBreakIcon size={11} weight="bold" aria-hidden="true" />
        {:else}
          <LinkSimpleIcon size={11} weight="bold" aria-hidden="true" />
        {/if}
      {/snippet}
      {canUnlink ? m.dock_linkedTab_unlink_label() : m.dock_linkedTab_link_label()}
    </Button>
  {/if}
</span>

<style>
  /* The slot fills the row grid's fixed column; the rest state and the action share it. */
  .row-slot {
    position: relative;
    display: grid;
    align-items: center;
    justify-items: end;
    min-width: 0;
    height: 100%;
    color: hsl(var(--muted-foreground));
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .slot-rest,
  .row-slot :global(.row-action) {
    grid-area: 1 / 1;
    max-width: 100%;
    min-width: 0;
  }
  .slot-rest {
    display: flex;
    justify-content: flex-end;
    transition: opacity var(--spring-fast) var(--spring-fast-ease);
  }
  .row-tag {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    min-width: 0;
    color: hsl(var(--dock-accent, var(--foreground)));
  }
  .row-slot :global(.row-action) {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    height: 22px;
    padding: 0 4px;
    border-radius: 999px;
    background: hsl(var(--dock-hover, var(--muted)));
    color: hsl(var(--foreground));
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--spring-fast) var(--spring-fast-ease);
  }
  /* Revealed by the row's hover or keyboard focus; the rest state fades in its place. */
  :global(.overview-row:hover) .row-slot :global(.row-action),
  :global(.overview-row:focus-within) .row-slot :global(.row-action),
  .row-slot :global(.row-action:focus-visible) {
    opacity: 1;
    pointer-events: auto;
  }
  :global(.overview-row:hover) .has-action .slot-rest,
  :global(.overview-row:focus-within) .has-action .slot-rest {
    opacity: 0;
  }
  @media (hover: none) {
    .row-slot :global(.row-action) {
      opacity: 1;
      pointer-events: auto;
    }
    .has-action .slot-rest {
      opacity: 0;
    }
  }
  .row-slot :global(.row-action:focus-visible) {
    outline: 1px solid hsl(var(--dock-border, var(--border)));
    outline-offset: 0;
  }
  .row-slot :global(.row-action:disabled) {
    opacity: 0;
    pointer-events: none;
  }
  @container style(--motion-reduced: 1) {
    .slot-rest,
    .row-slot :global(.row-action) {
      transition: none;
    }
  }
</style>
