<script lang="ts">
  import type { Workspace } from '$shared/types';
  import { WorkspaceStatusEnum } from '$shared/types';
  import WorkspaceCard from './WorkspaceCard.svelte';
  import Fa from 'svelte-fa';
  import { faFolder, faPlus } from '@fortawesome/free-solid-svg-icons';
  import { faGithub } from '@fortawesome/free-brands-svg-icons';
  import { flip } from 'svelte/animate';
  import { cubicOut } from 'svelte/easing';

  interface Props {
    workspaces: Workspace[];
    showArchived: boolean;
    groupByRepo: boolean;
    searchQuery: string;
    onOpen: (workspace: Workspace) => void;
    onDelete: (workspace: Workspace) => void;
    onArchive: (workspace: Workspace) => void;
    onUnarchive: (workspace: Workspace) => void;
  }

  let {
    workspaces,
    showArchived,
    groupByRepo,
    searchQuery,
    onOpen,
    onDelete,
    onArchive,
    onUnarchive,
  }: Props = $props();

  // Filter workspaces
  let filteredWorkspaces = $derived.by(() => {
    return workspaces.filter((ws) => {
      // Always skip deleted
      if (ws.status === WorkspaceStatusEnum.Deleted) return false;
      // Skip archived unless showing
      if (ws.status === WorkspaceStatusEnum.Archived && !showArchived) return false;
      // Search filter
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const title = ws.title?.toLowerCase() || '';
        const repo = ws.repositoryName?.toLowerCase() || '';
        const owner = ws.repositoryOwner?.toLowerCase() || '';
        if (!title.includes(q) && !repo.includes(q) && !owner.includes(q)) return false;
      }
      return true;
    });
  });

  // Item type for unified rendering - can be a header or a card
  type GridItem =
    | {
        type: 'header';
        id: string;
        groupLabel: string;
        isGithub: boolean;
        groupCount: number;
        repoPath: string;
      }
    | {
        type: 'card';
        id: string;
        workspace: Workspace;
      };

  // Helper to get group key for a workspace
  function getGroupKey(ws: Workspace): { key: string; label: string; isGithub: boolean } {
    if (ws.repositoryOwner && ws.repositoryName) {
      return {
        key: `${ws.repositoryOwner}/${ws.repositoryName}`,
        label: `${ws.repositoryOwner}/${ws.repositoryName}`,
        isGithub: true,
      };
    } else if (ws.repositoryPath) {
      return {
        key: ws.repositoryPath,
        label: ws.repositoryPath.split('/').pop() || ws.repositoryPath,
        isGithub: false,
      };
    } else {
      return { key: 'unknown', label: 'Unknown Repository', isGithub: false };
    }
  }

  // Stable group ordering - uses closure to track previous state without Svelte reactivity
  // This prevents groups from jumping around when workspaces are deleted
  let stableGroupOrder: string[] = [];
  let lastGroupByRepo: boolean | null = null;

  // Unified list for both grouped and flat views
  let allItems = $derived.by((): GridItem[] => {
    // Sort all workspaces by activity (within groups, most recent first)
    const sorted = [...filteredWorkspaces].sort((a, b) => {
      const dateA = new Date(a.lastActivity || a.createdAt || 0).getTime();
      const dateB = new Date(b.lastActivity || b.createdAt || 0).getTime();
      return dateB - dateA;
    });

    if (!groupByRepo) {
      // Flat list - just cards, no headers
      // Reset stable order when switching to flat view
      lastGroupByRepo = false;
      return sorted.map((ws) => ({
        type: 'card' as const,
        id: ws.id,
        workspace: ws,
      }));
    }

    // Build groups
    const groups: Record<
      string,
      { workspaces: Workspace[]; label: string; isGithub: boolean; repoPath: string }
    > = {};

    sorted.forEach((ws) => {
      const { key, label, isGithub } = getGroupKey(ws);
      if (!groups[key]) {
        groups[key] = { workspaces: [], label, isGithub, repoPath: ws.repositoryPath || '' };
      }
      groups[key].workspaces.push(ws);
    });

    const currentKeys = Object.keys(groups);

    // Determine if we need to recalculate order
    const groupByRepoChanged = lastGroupByRepo !== groupByRepo;
    const hasNewGroups = currentKeys.some((key) => !stableGroupOrder.includes(key));
    const needsRecalculation = groupByRepoChanged || stableGroupOrder.length === 0 || hasNewGroups;

    let orderedKeys: string[];

    if (needsRecalculation) {
      // Sort groups by most recent workspace in each group
      orderedKeys = currentKeys.sort((a, b) => {
        const mostRecentA = groups[a].workspaces[0];
        const mostRecentB = groups[b].workspaces[0];
        const dateA = new Date(mostRecentA?.lastActivity || mostRecentA?.createdAt || 0).getTime();
        const dateB = new Date(mostRecentB?.lastActivity || mostRecentB?.createdAt || 0).getTime();
        return dateB - dateA;
      });
      // Update stable order (closure state, not reactive)
      stableGroupOrder = orderedKeys;
      lastGroupByRepo = groupByRepo;
    } else {
      // Use stable order, filtering out groups that no longer exist
      orderedKeys = stableGroupOrder.filter((key) => groups[key]);
    }

    // Build unified list with headers and cards
    const items: GridItem[] = [];
    orderedKeys.forEach((key) => {
      const group = groups[key];
      // Add header
      items.push({
        type: 'header',
        id: `header-${key}`,
        groupLabel: group.label,
        isGithub: group.isGithub,
        groupCount: group.workspaces.length,
        repoPath: group.repoPath,
      });
      // Add cards
      group.workspaces.forEach((ws) => {
        items.push({
          type: 'card',
          id: ws.id,
          workspace: ws,
        });
      });
    });

    return items;
  });

  function handleNewInRepo(repoPath: string) {
    window.dispatchEvent(
      new CustomEvent('app:open-new-space-modal', {
        detail: { initialRepo: { repoPath } },
      }),
    );
  }
</script>

<!-- Unified grid -->
<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 items-start">
  {#each allItems as item, index (item.id)}
    <div
      class={item.type === 'header' ? 'col-span-full' : ''}
      animate:flip={{ duration: 300, easing: cubicOut }}
    >
      {#if item.type === 'header'}
        <!-- Group Header -->
        <div class="flex items-center justify-between py-2 {index === 0 ? '' : 'mt-12'}">
          <div class="flex items-center gap-2">
            <Fa
              icon={item.isGithub ? faGithub : faFolder}
              class="text-muted-foreground"
              size="sm"
            />
            <h3 class="text-sm font-medium text-foreground">{item.groupLabel}</h3>
            <span class="text-xs text-muted-foreground">({item.groupCount})</span>
          </div>
          <button
            onclick={() => handleNewInRepo(item.repoPath)}
            class="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer"
            title="New space in {item.groupLabel}"
          >
            <Fa icon={faPlus} size="sm" />
          </button>
        </div>
      {:else}
        <!-- Workspace Card -->
        <WorkspaceCard
          showRepo={!groupByRepo}
          workspace={item.workspace}
          onClick={() => onOpen(item.workspace)}
          onDelete={() => onDelete(item.workspace)}
          onArchive={() => onArchive(item.workspace)}
          onUnarchive={() => onUnarchive(item.workspace)}
        />
      {/if}
    </div>
  {/each}
</div>

{#if filteredWorkspaces.length === 0}
  <div class="text-center py-16 text-muted-foreground">
    {#if searchQuery}
      <p>No spaces match "{searchQuery}"</p>
    {:else if showArchived}
      <p>No archived spaces</p>
    {:else}
      <p>No spaces yet. Create one above!</p>
    {/if}
  </div>
{/if}
