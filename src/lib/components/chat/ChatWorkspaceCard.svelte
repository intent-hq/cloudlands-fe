<script lang="ts">
  import { goto } from '$app/navigation';
  import { onDestroy, untrack } from 'svelte';
  import {
    faArrowUpRightFromSquare,
    faBoxArchive,
    faTrash,
  } from '@fortawesome/free-solid-svg-icons';
  import WorkspaceCard from '$lib/components/workspace/WorkspaceCard.svelte';
  import SidebarContextMenu from '$lib/components/ui/sidebar-context-menu/SidebarContextMenu.svelte';
  import type { SidebarMenuEntry } from '$lib/components/ui/sidebar-context-menu/types';
  import { store as appStore } from "$store/renderer/store";
  import {
    decrementContextMenuOpen,
    incrementContextMenuOpen,
  } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import {
    requestOpenWorkspace,
    requestArchiveWorkspace,
    requestDeleteWorkspace,
  } from '$store/renderer/slices/workspace-operations/workspace-operations-slice';
  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
  import type { Workspace } from '$shared/types';

  interface Props {
    workspaceIds: string[];
  }

  let { workspaceIds }: Props = $props();
  let workspacesById = $state<Record<string, Workspace | undefined>>({});
  let overflowMenu: { workspaceId: string; x: number; y: number } | null = $state(null);
  let hadOverflowMenu = false;

  function blockContextMenuCapture(node: HTMLElement) {
    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    node.addEventListener('contextmenu', handleContextMenu, { capture: true });

    return {
      destroy() {
        node.removeEventListener('contextmenu', handleContextMenu, { capture: true });
      },
    };
  }

  $effect(() => {
    const ids = workspaceIds;
    const initialState = appStore.state;
    workspacesById = Object.fromEntries(
      ids.map((workspaceId) => [
        workspaceId,
        selectWorkspaceById.select(initialState, workspaceId),
      ]),
    );

    const unsubscribers = ids.map((workspaceId) => {
      const workspaceStore = selectWorkspaceById.withStore(appStore)(workspaceId);
      return workspaceStore.subscribe((workspace) => {
        workspacesById = { ...untrack(() => workspacesById), [workspaceId]: workspace };
      });
    });

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  });

  function handleWorkspaceOpenInNewWindow(workspaceId: string) {
    appStore.dispatch(requestOpenWorkspace({ workspaceId, openInNewWindow: true }));
  }

  async function handleWorkspaceClick(workspaceId: string, event?: MouseEvent | KeyboardEvent) {
    if (event?.metaKey || event?.ctrlKey) {
      handleWorkspaceOpenInNewWindow(workspaceId);
      return;
    }

    try {
      await goto(`/workspace/${workspaceId}`);
    } catch (error) {
      console.warn('Failed to navigate to workspace:', error);
    }
  }

  function openOverflowMenu(event: MouseEvent, workspaceId: string) {
    event.preventDefault();
    event.stopPropagation();

    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    overflowMenu = {
      workspaceId,
      x: rect.left,
      y: rect.bottom + 4,
    };
  }

  function closeOverflowMenu() {
    overflowMenu = null;
  }

  $effect(() => {
    const isOpen = overflowMenu !== null;

    if (isOpen && !hadOverflowMenu) {
      appStore.dispatch(incrementContextMenuOpen());
    } else if (!isOpen && hadOverflowMenu) {
      appStore.dispatch(decrementContextMenuOpen());
    }

    hadOverflowMenu = isOpen;
  });

  onDestroy(() => {
    if (hadOverflowMenu) appStore.dispatch(decrementContextMenuOpen());
  });

  function getOverflowMenuItems(workspaceId: string): SidebarMenuEntry[] {
    return [
      {
        id: 'open',
        label: 'Open',
        onClick: () => {
          closeOverflowMenu();
          void handleWorkspaceClick(workspaceId);
        },
      },
      {
        id: 'open-new-window',
        label: 'Open in New Window',
        icon: faArrowUpRightFromSquare,
        onClick: () => {
          closeOverflowMenu();
          void handleWorkspaceOpenInNewWindow(workspaceId);
        },
      },
      { type: 'separator' },
      {
        id: 'archive',
        label: 'Archive',
        icon: faBoxArchive,
        onClick: () => {
          appStore.dispatch(requestArchiveWorkspace(workspaceId));
          closeOverflowMenu();
        },
      },
      {
        id: 'delete',
        label: 'Delete Space…',
        icon: faTrash,
        destructive: true,
        onClick: () => {
          appStore.dispatch(requestDeleteWorkspace(workspaceId));
          closeOverflowMenu();
        },
      },
    ];
  }
</script>

{#if workspaceIds.length > 0}
  <div class="my-2 flex w-full flex-col gap-1.5" use:blockContextMenuCapture>
    {#each workspaceIds as workspaceId (workspaceId)}
      {@const workspace = workspacesById[workspaceId]}
      {#if workspace}
        <WorkspaceCard
          {workspace}
          variant="compact"
          class="rounded-md border border-border/40 bg-background/40"
          onClick={(event) => handleWorkspaceClick(workspaceId, event)}
        >
          {#snippet actions()}
            <button
              type="button"
              class="flex h-5 w-5 -my-1 cursor-pointer items-center justify-center rounded text-ghost transition-all hover:bg-muted/50 hover:text-foreground focus-visible:bg-muted/50 focus-visible:text-foreground focus-visible:outline-none"
              aria-label="Workspace actions for {workspace.title || workspace.id}"
              aria-haspopup="menu"
              aria-expanded={overflowMenu?.workspaceId === workspaceId}
              title="Workspace actions"
              onclick={(event) => openOverflowMenu(event, workspaceId)}
            >
              ⋯
            </button>
          {/snippet}
        </WorkspaceCard>
      {:else}
        <div class="rounded-md border border-border/50 bg-muted/10 px-3 py-2 text-left">
          <div class="truncate font-mono text-xs text-foreground">{workspaceId}</div>
          <div class="mt-0.5 text-xs text-subtle">Workspace not found</div>
        </div>
      {/if}
    {/each}
  </div>

  {#if overflowMenu}
    <SidebarContextMenu
      x={overflowMenu.x}
      y={overflowMenu.y}
      items={getOverflowMenuItems(overflowMenu.workspaceId)}
      onClickOutside={closeOverflowMenu}
    />
  {/if}
{/if}
