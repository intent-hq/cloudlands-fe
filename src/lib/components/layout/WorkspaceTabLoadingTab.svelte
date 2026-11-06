<script lang="ts">
  import { faXmark } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import type { Action } from 'svelte/action';
  import { Button } from '$lib/components/ui/button';
  import { cn } from '$lib/utils';
  import { m } from '$shared/paraglide/messages.js';
  import WorkspaceTabFlare from './WorkspaceTabFlare.svelte';
  import {
    WORKSPACE_TAB_CORNER_RADIUS_PX,
    WORKSPACE_TAB_MOTION_DURATION_MS,
    WORKSPACE_TAB_MOTION_EASING,
  } from './titlebar-geometry';

  interface Props {
    workspaceId: string;
    isCurrent: boolean;
    ref?: HTMLButtonElement | null;
    reportActiveTabBounds: Action<HTMLElement, boolean>;
    registerTabSurface: Action<HTMLElement, string>;
    onOpen: (restoreFocus: boolean) => void;
    onClose: (event: Event) => void;
    onKeydown: (event: KeyboardEvent) => void;
    onContextMenu: (event: MouseEvent) => void;
  }

  let {
    workspaceId,
    isCurrent,
    ref = $bindable(),
    reportActiveTabBounds,
    registerTabSurface,
    onOpen,
    onClose,
    onKeydown,
    onContextMenu,
  }: Props = $props();
</script>

<!-- A tab whose workspace has not loaded yet. -->
<div
  class={cn(
    'group/workspace-tab relative flex h-(--control-height-medium) w-full min-w-0 shrink-0 items-center border transition-[background-color,border-color,opacity,transform] motion-reduce:transition-none',
    isCurrent
      ? 'rounded-t-md border-border border-b-0 bg-sidebar text-foreground shadow-none'
      : 'rounded-md border-transparent text-muted-foreground',
  )}
  data-workspace-tab={workspaceId}
  data-workspace-tab-visual={workspaceId}
  data-workspace-tab-loading="true"
  data-active={isCurrent}
  style:border-radius={isCurrent
    ? `${WORKSPACE_TAB_CORNER_RADIUS_PX}px ${WORKSPACE_TAB_CORNER_RADIUS_PX}px 0 0`
    : `${WORKSPACE_TAB_CORNER_RADIUS_PX}px`}
  style:transition-duration={`${WORKSPACE_TAB_MOTION_DURATION_MS}ms`}
  style:transition-timing-function={WORKSPACE_TAB_MOTION_EASING}
  use:reportActiveTabBounds={isCurrent}
  use:registerTabSurface={workspaceId}
  role="presentation"
  oncontextmenu={onContextMenu}
>
  <WorkspaceTabFlare
    side="leading"
    visible={isCurrent}
    durationMs={WORKSPACE_TAB_MOTION_DURATION_MS}
  />
  <WorkspaceTabFlare
    side="trailing"
    visible={isCurrent}
    durationMs={WORKSPACE_TAB_MOTION_DURATION_MS}
  />
  <Button
    variant="plain"
    type="button"
    class="absolute -inset-x-px inset-y-0 flex h-auto w-auto min-w-0 cursor-pointer items-center rounded-[inherit] border-0 px-3 pr-10 !px-3 !pr-10 text-left forced-colors:focus-visible:text-[HighlightText]"
    onclick={(event) => onOpen(event.detail === 0)}
    onkeydown={onKeydown}
    role="tab"
    aria-label={m.layout_workspaceTabStrip_loading_ariaLabel({ workspaceId })}
    aria-selected={isCurrent}
    aria-current={isCurrent ? 'page' : undefined}
    tabindex={isCurrent ? 0 : -1}
    bind:ref
    id={`workspace-tab-${workspaceId}`}
    data-workspace-tab-loading-target
  >
    <span
      class="h-2.5 w-24 animate-pulse rounded-full bg-sidebar-foreground/10 motion-reduce:animate-none"
      aria-hidden="true"
      data-workspace-tab-loading-indicator
    ></span>
  </Button>
  <Button
    variant="plain"
    size="icon-compact"
    iconOnly
    type="button"
    class="absolute right-1 z-10 flex size-(--control-height-compact) shrink-0 cursor-pointer items-center justify-center rounded text-subtle opacity-70 outline-none! hover:bg-muted hover:text-foreground focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:text-foreground forced-colors:focus-visible:text-[HighlightText]"
    onclick={onClose}
    aria-label={m.layout_workspaceTabStrip_close_ariaLabel({ name: workspaceId })}
    data-workspace-tab-close
  >
    <Fa icon={faXmark} class="size-3.5!" />
  </Button>
</div>

<style>
  :global(
    button[data-workspace-tab-loading-target]:focus-visible [data-workspace-tab-loading-indicator]
  ) {
    background-color: currentColor;
    opacity: 0.45;
  }
</style>
