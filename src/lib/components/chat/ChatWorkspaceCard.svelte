<script lang="ts">
  import { goto } from '$app/navigation';
  import { untrack } from 'svelte';
  import {
    faArrowUpRightFromSquare,
    faBoxArchive,
    faTrash,
  } from '@fortawesome/free-solid-svg-icons';
  import WorkspaceCard from '$lib/components/workspace/WorkspaceCard.svelte';
  import SidebarOverflowMenu from '$lib/components/ui/sidebar-context-menu/SidebarOverflowMenu.svelte';
  import type { SidebarMenuEntry } from '$lib/components/ui/sidebar-context-menu/types';
  import { store as appStore } from '$store/renderer/store';
  import {
    requestArchiveWorkspace,
    requestDeleteWorkspace,
  } from '$store/renderer/slices/workspace-operations/workspace-operations-slice';
  import { openWorkspaceInNewWindow } from '$lib/components/layout/sidebar-nav/utils/openWorkspaceInNewWindow';
  import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
  import {
    selectActiveAgentId,
    selectWorkspaceForegroundAgentIds,
  } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
  import { openWorkspaceTab } from '$store/renderer/slices/tab-state/tab-state-slice';
  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
  import type { Workspace } from '$shared/types';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    workspaceIds: string[];
  }

  let { workspaceIds }: Props = $props();
  let workspacesById = $state<Record<string, Workspace | undefined>>({});

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
    // eslint-disable-next-line intent/no-component-async-data-fetch -- fire-and-forget window-open IPC command, not domain data; no dispatchable saga exists (requestOpenWorkspace is unhandled).
    openWorkspaceInNewWindow(workspaceId);
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
      return;
    }

    appStore.dispatch(openWorkspaceTab(workspaceId));
    const foregroundAgentIds = selectWorkspaceForegroundAgentIds
      .select(appStore.state, workspaceId)
      .map(String);
    const activeAgentId = selectActiveAgentId.select(appStore.state, workspaceId);
    const targetAgentId =
      activeAgentId && foregroundAgentIds.includes(activeAgentId)
        ? activeAgentId
        : foregroundAgentIds[0];
    if (targetAgentId) {
      appStore.dispatch(openAgentTabRequested(workspaceId, { agentId: targetAgentId }));
    }
  }

  function getOverflowMenuItems(workspaceId: string): SidebarMenuEntry[] {
    return [
      {
        id: 'open',
        label: m.chat_chatWorkspaceCard_menu_open_label(),
        onClick: () => {
          void handleWorkspaceClick(workspaceId);
        },
      },
      {
        id: 'open-new-window',
        label: m.chat_chatWorkspaceCard_menu_openNewWindow_label(),
        icon: faArrowUpRightFromSquare,
        onClick: () => {
          void handleWorkspaceOpenInNewWindow(workspaceId);
        },
      },
      { type: 'separator' },
      {
        id: 'archive',
        label: m.chat_chatWorkspaceCard_menu_archive_label(),
        icon: faBoxArchive,
        onClick: () => {
          appStore.dispatch(requestArchiveWorkspace(workspaceId));
        },
      },
      {
        id: 'delete',
        label: m.chat_chatWorkspaceCard_menu_deleteSpace_label(),
        icon: faTrash,
        destructive: true,
        onClick: () => {
          appStore.dispatch(requestDeleteWorkspace(workspaceId));
        },
      },
    ];
  }
</script>

{#if workspaceIds.length > 0}
  <div class="my-3 flex w-full flex-col gap-2" use:blockContextMenuCapture>
    {#each workspaceIds as workspaceId (workspaceId)}
      {@const workspace = workspacesById[workspaceId]}
      {#if workspace}
        <WorkspaceCard
          {workspace}
          variant="compact"
          isolateHoverReveal
          class="mx-0 rounded-md border border-border bg-background/40"
          onClick={(event) => handleWorkspaceClick(workspaceId, event)}
        >
          {#snippet actions()}
            <SidebarOverflowMenu
              items={getOverflowMenuItems(workspaceId)}
              orientation="vertical"
              class="flex h-5 w-5 -my-1 cursor-pointer items-center justify-center rounded text-ghost transition-all hover:bg-muted/50 hover:text-foreground focus-visible:bg-muted/50 focus-visible:text-foreground focus-visible:outline-none"
              ariaLabel={m.chat_chatWorkspaceCard_actionsFor_ariaLabel({
                name: workspace.title || m.workspace_links_untitled_label(),
              })}
            />
          {/snippet}
        </WorkspaceCard>
      {:else}
        <div class="rounded-md border border-border bg-muted/10 px-3 py-2 text-left">
          <div class="text-xs text-subtle">
            {m.chat_chatWorkspaceCard_notFound_label()}
          </div>
        </div>
      {/if}
    {/each}
  </div>
{/if}
