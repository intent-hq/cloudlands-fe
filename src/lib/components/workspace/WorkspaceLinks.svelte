<script lang="ts">
  import { logger } from '$lib/utils/client-logger';

  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { invoke } from '$lib/electron-bridge';
  import { IPC_CHANNELS } from '$shared/ipc-registry';
  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import { faCodeBranch, faFile, faServer, faPlus } from '@fortawesome/free-solid-svg-icons';
  import type { Workspace } from '$shared/types';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { formatRelative } from 'date-fns';
  interface Props {
    workspaces: Workspace[];
    collapsed?: boolean;
    onCreateWorkspaceForRepo?: (repoName: string, lastWorkspace: Workspace) => void;
  }

  let { workspaces, collapsed = false, onCreateWorkspaceForRepo }: Props = $props();

  // Get current path for active state
  // Store subscriptions are already reactive with $ prefix
  let currentPath = $derived($page.url.pathname);

  // Group workspaces by repository
  let workspacesByRepo = $derived.by(() => {
    if (!workspaces || workspaces.length === 0) {
      return {};
    }

    const grouped = workspaces.reduce(
      (acc, workspace) => {
        const key =
          workspace.repositoryOwner && workspace.repositoryName
            ? `${workspace.repositoryOwner}/${workspace.repositoryName}`
            : 'No Repository';
        if (!acc[key]) {
          acc[key] = [];
        }
        acc[key].push(workspace);
        return acc;
      },
      {} as Record<string, Workspace[]>,
    );

    // Sort workspaces within each repository by last activity (newest first)
    Object.keys(grouped).forEach((key) => {
      grouped[key].sort((a, b) => {
        const dateA = a.lastActivity
          ? new Date(a.lastActivity).getTime()
          : a.createdAt
            ? new Date(a.createdAt).getTime()
            : 0;
        const dateB = b.lastActivity
          ? new Date(b.lastActivity).getTime()
          : b.createdAt
            ? new Date(b.createdAt).getTime()
            : 0;
        return dateB - dateA; // Sort descending (newest first)
      });
    });

    // Sort repository groups by the most recent workspace activity
    const sortedEntries = Object.entries(grouped).sort((a, b) => {
      const mostRecentA = a[1][0]; // First workspace is the most recent after sorting
      const mostRecentB = b[1][0];

      const dateA = mostRecentA.lastActivity
        ? new Date(mostRecentA.lastActivity).getTime()
        : mostRecentA.createdAt
          ? new Date(mostRecentA.createdAt).getTime()
          : 0;
      const dateB = mostRecentB.lastActivity
        ? new Date(mostRecentB.lastActivity).getTime()
        : mostRecentB.createdAt
          ? new Date(mostRecentB.createdAt).getTime()
          : 0;

      return dateB - dateA; // Sort descending (newest first)
    });

    // Rebuild the object in sorted order
    const sortedGrouped: Record<string, Workspace[]> = {};
    sortedEntries.forEach(([key, value]) => {
      sortedGrouped[key] = value;
    });

    return sortedGrouped;
  });

  function getWorkspaceStats(workspace: Workspace): {
    additions: number;
    deletions: number;
  } {
    // Don't subscribe to the entire diff store, just return 0 for now
    // This avoids performance issues from frequent re-renders
    return { additions: 0, deletions: 0 };
  }

  function isRemoteWorkspace(workspace: Workspace): boolean {
    return workspace.environmentConfig?.type === 'remote';
  }

  async function handleWorkspaceClick(event: MouseEvent, workspaceId: string) {
    // Check if cmd/ctrl key is pressed for opening in new window
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault();
      try {
        await invoke(IPC_CHANNELS.WINDOW.OPEN_NEW, { route: `/workspace/${workspaceId}` });
      } catch (error) {
        logger.error('Failed to open workspace in new window:', error);
      }
      return;
    }

    // Otherwise, use programmatic navigation in current window.
    // The route (/workspace/:id) is the single source of truth for the active workspace.
    event.preventDefault();
    await goto(`/workspace/${workspaceId}`);
  }

  function isWorkspaceActive(workspaceId: string): boolean {
    // The URL is the authoritative signal for which workspace is active.
    return currentPath === `/workspace/${workspaceId}`;
  }

  function handleCreateWorkspaceForRepo(repoName: string, repoWorkspaces: Workspace[]) {
    // Get the most recent workspace for this repo to copy its settings
    const lastWorkspace = repoWorkspaces[repoWorkspaces.length - 1];
    if (onCreateWorkspaceForRepo) {
      onCreateWorkspaceForRepo(repoName, lastWorkspace);
    }
  }

  function formatDate(dateInput: string | Date | undefined): string {
    if (!dateInput) return 'Never';

    const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      const hours = Math.floor(diff / (1000 * 60 * 60));
      if (hours === 0) {
        const minutes = Math.floor(diff / (1000 * 60));
        return minutes === 0 ? 'Just now' : `${minutes}m ago`;
      }
      return `${hours}h ago`;
    } else if (days === 1) {
      return 'Yesterday';
    } else if (days < 7) {
      return `${days} days ago`;
    } else {
      return date.toLocaleDateString();
    }
  }
</script>

{#if !collapsed && workspacesByRepo}
  {#each Object.entries(workspacesByRepo) as [repoName, repoWorkspaces] (repoName)}
    {#if repoName !== 'No Repository'}
      <div class="space-y-px">
        <div class="pl-5 py-1 mt-2 flex items-center gap-1.5 group">
          <Fa icon={faCodeBranch} size="xs" class="text-ghost flex-none" />
          <span class="text-xs font-medium text-subtle whitespace-nowrap truncate flex-1">
            {repoName}
          </span>
          <Button
            variant="ghost-light"
            size="icon-xs"
            class="opacity-0 group-hover:opacity-100 transition-opacity"
            onclick={() => handleCreateWorkspaceForRepo(repoName, repoWorkspaces)}
            aria-label="Create new space for {repoName}"
            title="Create new space for {repoName}"
          >
            <Fa icon={faPlus} size="xs" />
          </Button>
        </div>
        {#each repoWorkspaces as workspace (workspace.id)}
          {@const isActive = isWorkspaceActive(workspace.id)}
          {@const stats = getWorkspaceStats(workspace)}
          <div class="pl-7 ml-1">
            <Button
              variant="ghost"
              class="w-full flex-col h-auto gap-0.5 text-left py-1 px-2 {isActive
                ? 'bg-background'
                : 'hover:bg-muted/50'}"
              onclick={(e) => handleWorkspaceClick(e, workspace.id)}
            >
              <div class="flex justify-start w-full">
                <span class="truncate flex-1 flex items-center gap-1.5">
                  {#if isRemoteWorkspace(workspace)}
                    <div aria-label="Remote space" title="Remote space">
                      <Fa icon={faServer} size="xs" class="text-primary flex-shrink-0" />
                    </div>
                  {/if}
                  {#if workspace.title}
                    <span class="truncate">
                      {workspace.title}
                    </span>
                  {:else}
                    <span class="truncate text-subtle"> Untitled </span>
                  {/if}
                </span>
                {#if stats.additions > 0 || stats.deletions > 0}
                  <span class="flex items-center gap-1.5 text-xs font-mono ml-2 flex-shrink-0">
                    {#if stats.additions > 0}
                      <span class="text-green-600 dark:text-green-400">
                        +{stats.additions.toLocaleString()}
                      </span>
                    {/if}
                    {#if stats.deletions > 0}
                      <span class="text-red-600 dark:text-red-400">
                        -{stats.deletions.toLocaleString()}
                      </span>
                    {/if}
                  </span>
                {/if}
              </div>
              <div
                class="text-subtle font-normal text-xs text-left flex justify-start items-start w-full"
              >
                {formatDate(workspace.lastActivity || workspace.updatedAt)}
              </div>
            </Button>
          </div>
        {/each}
      </div>
    {/if}
  {/each}

  <!-- Workspaces without repository -->
  {#if workspacesByRepo['No Repository']}
    <div class="space-y-px">
      <div class="px-5 py-1 mt-2">
        <span class="text-xs font-medium text-subtle">Other</span>
      </div>
      {#each workspacesByRepo['No Repository'] as workspace (workspace.id)}
        {@const isActive = isWorkspaceActive(workspace.id)}
        {@const stats = getWorkspaceStats(workspace)}
        <div class="px-3 pl-7">
          <Button
            variant={isActive ? 'secondary' : 'ghost'}
            size="sm"
            class="w-full justify-start text-left px-2"
            onclick={(e) => handleWorkspaceClick(e, workspace.id)}
          >
            <span class="truncate flex-1 flex items-center gap-1.5">
              {#if isRemoteWorkspace(workspace)}
                <div aria-label="Remote space" title="Remote space">
                  <Fa icon={faServer} size="xs" class="text-primary flex-shrink-0" />
                </div>
              {/if}
              {#if workspace.title}
                <span class="truncate">
                  {workspace.title}
                </span>
              {:else}
                <span class="truncate text-subtle"> Untitled </span>
              {/if}
            </span>
            {#if stats.additions > 0 || stats.deletions > 0}
              <span class="flex items-center gap-1.5 text-xs font-mono ml-2 flex-shrink-0">
                {#if stats.additions > 0}
                  <span class="text-green-600 dark:text-green-400">
                    +{stats.additions}
                  </span>
                {/if}
                {#if stats.deletions > 0}
                  <span class="text-red-600 dark:text-red-400">
                    -{stats.deletions}
                  </span>
                {/if}
              </span>
            {/if}
          </Button>
        </div>
      {/each}
    </div>
  {/if}
{:else}
  <!-- Collapsed view - show workspace icons -->
  {#each workspaces.slice(0, 5) as workspace (workspace.id)}
    {@const isActive = isWorkspaceActive(workspace.id)}
    <div class="px-2 py-1">
      <a
        href="/workspace/{workspace.id}"
        onclick={(e) => handleWorkspaceClick(e, workspace.id)}
        class="block"
      >
        <Button
          class="w-full h-8 flex items-center justify-center rounded-md transition-colors {isActive
            ? 'bg-secondary text-secondary-foreground'
            : 'hover:bg-accent'}"
          title={workspace.title || 'Untitled'}
        >
          <Fa icon={faFile} size="lg" class="text-subtle" />
        </Button>
      </a>
    </div>
  {/each}
{/if}
