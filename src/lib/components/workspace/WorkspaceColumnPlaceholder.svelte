<script lang="ts">
  /**
   * WorkspaceColumnPlaceholder - Cheap stand-in for an unmounted WorkspaceSurface
   *
   * Rendered in place of off-screen workspace columns so the horizontal scroller
   * keeps its layout without paying for a full surface (no PanelLayout, no chat,
   * no per-workspace event subscriptions). It mirrors the real column's title
   * region markup so column drag affordances and drop targets keep working, and
   * subscribes to Redux only for the workspace title.
   */
  import { writable } from 'svelte/store';
  import Fa from 'svelte-fa';
  import { faXmark } from '@fortawesome/free-solid-svg-icons';
  import Button from '$lib/components/ui/button/button.svelte';
  import SidebarSkeleton from './SidebarSkeleton.svelte';
  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    workspaceId: string;
    draggableTitleRegion?: boolean;
    onCloseWorkspace?: (event: MouseEvent) => void;
  }

  let { workspaceId, draggableTitleRegion = true, onCloseWorkspace }: Props = $props();

  // svelte-ignore state_referenced_locally - intentional initial capture; the $effect below syncs later changes
  const workspaceIdStore = writable(workspaceId);
  $effect(() => workspaceIdStore.set(workspaceId));
  const workspace = selectWorkspaceById(workspaceIdStore);
</script>

<div
  class="flex h-full w-full flex-col overflow-hidden bg-transparent"
  data-workspace-column-placeholder={workspaceId}
>
  <!-- Title region matching MultiSelectTabbedSidebar's so column drags still start here -->
  <div
    class="group shrink-0 px-6 pb-2 pt-5"
    data-workspace-title-region
    draggable={draggableTitleRegion}
  >
    <div class="flex w-full min-w-0 items-start justify-between gap-2">
      <span
        class="min-w-0 truncate py-0.5 text-xl font-semibold leading-normal text-foreground"
        class:opacity-50={!$workspace?.title}
        data-workspace-placeholder-title
      >
        {$workspace?.title || m.workspace_links_untitled_label()}
      </span>
      {#if onCloseWorkspace}
        <div class="-mr-2 -mt-0.5 flex shrink-0 items-center">
          <Button
            variant="ghost-light"
            size="icon-sm"
            aria-label={m.workspace_progressCard_closeWorkspace_ariaLabel({ id: workspaceId })}
            data-workspace-close
            class="opacity-50 group-hover:opacity-70 hover:opacity-100! transition-opacity duration-150 hover:bg-transparent hover:border-none"
            onpointerdown={(event) => event.stopPropagation()}
            onclick={onCloseWorkspace}
          >
            <Fa icon={faXmark} size={16} class="size-4" />
          </Button>
        </div>
      {/if}
    </div>
  </div>
  <div class="min-h-0 flex-1 overflow-hidden">
    <SidebarSkeleton />
  </div>
</div>
