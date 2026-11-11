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
  // An inferred (service-owned) target has no saved link to remove.
  const canUnlink = $derived(linked && !!context!.linkKey);
  const canLink = $derived(ready && !linked && context!.linkable);
  const contextName = $derived(context?.label || '');
  function link(): void {
    const version = context?.contextVersion;
    if (version) appStore.dispatch(dockContextLinkRequested(version, workspaceId));
  }
  function unlink(): void {
    const version = context?.contextVersion;
    if (version) appStore.dispatch(dockContextUnlinkRequested(version));
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
      onclick={canUnlink ? unlink : link}
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
    transition: opacity 120ms ease;
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
    gap: 3px;
    height: 22px;
    padding: 0 6px;
    border-radius: 999px;
    background: hsl(var(--dock-hover, var(--muted)));
    color: hsl(var(--foreground));
    opacity: 0;
    pointer-events: none;
    transition: opacity 120ms ease;
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
