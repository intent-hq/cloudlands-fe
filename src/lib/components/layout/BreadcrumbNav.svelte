<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import { workspaceClient } from '$features/workspace/workspace.client';
  import {
    GroupedCombobox,
    type OptionGroup,
    type GroupedOption,
  } from '$lib/components/ui/grouped-combobox';
  import { Breadcrumb, BreadcrumbList, BreadcrumbItem } from '$lib/components/ui/breadcrumb';
  import { faFolder, faPlus, faHistory } from '@fortawesome/free-solid-svg-icons';
  import { faGitRepo } from '$lib/icons/faGitRepo';
  import { notesStateManager } from '$features/notes/notes.store.svelte';
  import { notesClient } from '$features/notes/notes.client';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import type { Workspace } from '$shared/types';
  import { WorkspaceStatusEnum as WorkspaceStatus } from '$shared/types';
  import Fa from 'svelte-fa';
  import LineChangesBadge from '$lib/components/shared/LineChangesBadge.svelte';
  import { invoke } from '$lib/electron-bridge';
  import { IPC_CHANNELS } from '$shared/ipc-registry';
  import { Kbd } from '$lib/components/ui/kbd';
  import { createLogger } from '$lib/utils/client-logger';
  import { untrack } from 'svelte';

  const logger = createLogger('BreadcrumbNav');

  interface Props {
    class?: string;
    onCreateWorkspace?: (event?: MouseEvent) => void;
    onCreateWorkspaceForRepo?: (repoName: string, lastWorkspace: Workspace) => void;
  }

  let { class: className = '', onCreateWorkspace, onCreateWorkspaceForRepo }: Props = $props();

  // Get current workspace from URL
  const currentWorkspaceId = $derived.by(() => {
    const pageStore = $page;
    return pageStore.params.id && pageStore.params.id !== 'new' ? pageStore.params.id : null;
  });

  // Get all active workspaces for the dropdown (filter out archived)
  const allWorkspaces = $derived(
    (workspaceStore.items || []).filter((w) => w.status !== WorkspaceStatus.Archived),
  );

  // Get the last opened workspace (excluding the current one)
  const lastOpenedWorkspace = $derived.by(() => {
    if (!allWorkspaces.length) return null;

    // Sort all workspaces by last activity (most recent first)
    const sorted = [...allWorkspaces].sort((a, b) => {
      const dateA = new Date(a.lastActivity || a.updatedAt || 0).getTime();
      const dateB = new Date(b.lastActivity || b.updatedAt || 0).getTime();
      return dateB - dateA;
    });

    // Return the first workspace that isn't the current one
    return sorted.find((w) => w.id !== currentWorkspaceId) || null;
  });

  // Create grouped options for the combobox - groups workspaces by repository
  const workspaceGroups = $derived.by((): OptionGroup[] => {
    // Group workspaces by repository
    const grouped = new Map<string, typeof allWorkspaces>();
    for (const workspace of allWorkspaces) {
      const repoKey =
        workspace.repositoryOwner && workspace.repositoryName
          ? `${workspace.repositoryOwner}/${workspace.repositoryName}`
          : workspace.repositoryPath || 'Unknown';

      if (!grouped.has(repoKey)) {
        grouped.set(repoKey, []);
      }
      grouped.get(repoKey)!.push(workspace);
    }

    // Build option groups
    const groups: OptionGroup[] = [];
    for (const [repoKey, workspaces] of grouped) {
      const firstWorkspace = workspaces[0];
      const isGithub = !!(firstWorkspace.repositoryOwner && firstWorkspace.repositoryName);

      // Sort workspaces by last updated (most recent first)
      const sortedWorkspaces = [...workspaces].sort((a, b) => {
        const dateA = new Date(a.lastActivity || a.updatedAt || 0).getTime();
        const dateB = new Date(b.lastActivity || b.updatedAt || 0).getTime();
        return dateB - dateA;
      });

      const options: GroupedOption[] = sortedWorkspaces.map((workspace) => {
        const notesCount = notesCountCache.get(workspace.id) || 0;
        let additions = 0;
        let deletions = 0;

        if (workspace.diffSummary) {
          additions = workspace.diffSummary.totalAdditions || 0;
          deletions = workspace.diffSummary.totalDeletions || 0;
        }

        return {
          value: workspace.id,
          label: workspace.title || 'Untitled',
          description: workspace.branch || undefined,
          data: {
            workspace,
            notesCount,
            additions,
            deletions,
            lastUpdated: formatRelativeTime(workspace.lastActivity || workspace.updatedAt),
          },
        };
      });

      groups.push({
        key: repoKey,
        label: isGithub ? repoKey : repoKey.split('/').pop() || repoKey,
        icon: isGithub ? faGitRepo : faFolder,
        options,
        data: { isGithub, workspaceCount: workspaces.length },
      });
    }

    return groups;
  });

  // Cache for notes count per workspace
  let notesCountCache = $state<Map<string, number>>(new Map());

  // Helper function to format relative time
  function formatRelativeTime(dateString: string | undefined): string {
    if (!dateString) return '';

    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 30) {
      const diffMonths = Math.floor(diffDays / 30);
      return `${diffMonths} month${diffMonths !== 1 ? 's' : ''} ago`;
    } else if (diffDays > 0) {
      return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
    } else if (diffHours > 0) {
      return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    } else if (diffMins > 0) {
      return `${diffMins} min${diffMins !== 1 ? 's' : ''} ago`;
    } else {
      return 'just now';
    }
  }

  // Fetch notes count for a workspace
  async function fetchNotesCount(workspaceId: string): Promise<number> {
    // Check if it's the current workspace
    if (notesStateManager.workspaceId === workspaceId) {
      return Array.from(notesStateManager.notes.values()).filter((n) => !n.isArchived).length;
    }

    // Check cache first
    if (notesCountCache.has(workspaceId)) {
      return notesCountCache.get(workspaceId) || 0;
    }

    // Fetch from API
    try {
      const result = await notesClient.list(WorkspaceId(workspaceId));
      if (result.ok) {
        const count = result.data.filter((n) => !n.isArchived).length;
        notesCountCache.set(workspaceId, count);
        return count;
      }
    } catch (error) {
      logger.error(`Failed to fetch notes for workspace ${workspaceId}:`, error);
    }

    return 0;
  }

  // Effect to fetch notes counts when workspaces change
  $effect(() => {
    // Read reactive values first
    const currentWorkspace = notesStateManager.workspaceId;
    const notes = notesStateManager.notes;
    const workspaces = allWorkspaces;

    // Use untrack to prevent infinite loop when updating the cache
    untrack(() => {
      // Update cache for current workspace
      if (currentWorkspace) {
        const currentNotesCount = Array.from(notes.values()).filter((n) => !n.isArchived).length;
        notesCountCache.set(currentWorkspace, currentNotesCount);
      }

      // Fetch notes count for each workspace
      workspaces.forEach((workspace) => {
        if (!notesCountCache.has(workspace.id) && workspace.id !== currentWorkspace) {
          fetchNotesCount(workspace.id);
        }
      });
    });
  });

  // Trigger diff check for workspaces when dropdown opens
  async function onWorkspaceDropdownOpen() {
    // Trigger check for each workspace to ensure diff summaries are up to date
    const promises = allWorkspaces.map(async (workspace) => {
      if (!workspace.diffSummary && !workspace.diffs) {
        await workspaceClient.triggerCheck(workspace.id, 'breadcrumb-dropdown-open');
      }
    });

    // Wait for all checks to complete
    await Promise.all(promises);

    // Reload workspace data to get updated diffs
    setTimeout(() => {
      workspaceStore.load();
    }, 500);
  }

  // Handle workspace selection from grouped combobox
  async function handleWorkspaceSelect(value: string, _option?: GroupedOption, event?: MouseEvent) {
    // Check if cmd/ctrl key is pressed for opening in new window
    if (event?.metaKey || event?.ctrlKey) {
      try {
        await invoke(IPC_CHANNELS.WINDOW.OPEN_NEW, { route: `/workspace/${value}` });
      } catch (error) {
        logger.error('Failed to open new window:', error);
        await goto(`/workspace/${value}`);
      }
    } else {
      await goto(`/workspace/${value}`);
    }
  }

  // Search function for grouped workspaces
  function searchWorkspaceGroups(query: string): OptionGroup[] {
    const q = query.toLowerCase();
    return workspaceGroups
      .map((group) => ({
        ...group,
        options: group.options.filter(
          (opt) =>
            opt.label.toLowerCase().includes(q) ||
            opt.description?.toLowerCase().includes(q) ||
            group.label.toLowerCase().includes(q),
        ),
      }))
      .filter((group) => group.options.length > 0 || group.label.toLowerCase().includes(q));
  }

  // Handle creating workspace for a specific repo
  function handleCreateForRepo(group: OptionGroup, event: MouseEvent) {
    event.stopPropagation();
    if (!onCreateWorkspaceForRepo) return;

    // Get the most recent workspace from this group to use as a template
    const lastWorkspace = group.options[0]?.data?.workspace;
    if (lastWorkspace) {
      onCreateWorkspaceForRepo(group.label, lastWorkspace);
    }
  }

  // Handle selecting the last opened workspace
  async function handleSelectLastOpened(event: MouseEvent) {
    if (!lastOpenedWorkspace) return;
    await handleWorkspaceSelect(lastOpenedWorkspace.id, undefined, event);
  }
</script>

{#snippet workspaceHeaderAction()}
  {#if onCreateWorkspace}
    <div class="w-full p-1 pb-0 flex flex-col gap-0.5">
      <button
        type="button"
        onclick={(e) => onCreateWorkspace?.(e)}
        class="flex-1 flex items-center gap-2 px-2 py-1 cursor-pointer text-sm text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/50 rounded-md transition-colors"
      >
        <Fa icon={faPlus} class="w-3 h-3 opacity-50" />
        <span>New Workspace</span>
      </button>
      {#if lastOpenedWorkspace}
        <button
          type="button"
          onclick={handleSelectLastOpened}
          class="flex-1 flex items-center gap-2 px-2 py-1 cursor-pointer text-sm text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/50 rounded-md transition-colors"
        >
          <Fa icon={faHistory} class="w-3 h-3 opacity-50" />
          <span class="truncate">Last opened: {lastOpenedWorkspace.title || 'Untitled'}</span>
        </button>
      {/if}
    </div>
  {/if}
{/snippet}

{#snippet workspaceGroupAction(group: OptionGroup)}
  {#if onCreateWorkspaceForRepo}
    <button
      type="button"
      onclick={(e) => handleCreateForRepo(group, e)}
      class="px-1.5 py-1 text-muted-foreground/50 hover:text-foreground hover:bg-muted/50 rounded transition-colors cursor-pointer"
      title="New space for {group.label}"
    >
      <Fa icon={faPlus} class="w-2.5 h-2.5" />
    </button>
  {/if}
{/snippet}

{#snippet workspaceFooter()}
  <div class="flex items-center gap-2 text-xs text-muted-foreground">
    <div class="flex items-center gap-0.5">
      <Kbd size="xs">⌘</Kbd>
      <Kbd size="xs">Click</Kbd>
    </div>
    <span>to open in new window</span>
  </div>
{/snippet}

{#snippet workspaceOptionDescription(option: GroupedOption)}
  <div class="flex items-center justify-between gap-3 text-xs text-muted-foreground mt-0.5">
    <div class="flex items-center gap-3">
      <!-- {#if option.data?.notesCount !== undefined}
        <span class="flex items-center gap-1 text-muted-foreground">
          <Fa icon={faStickyNote} class="w-3 h-3 opacity-50" />
          <span>{option.data.notesCount}</span>
        </span>
      {/if} -->
      {#if (option.data?.additions || 0) > 0 || (option.data?.deletions || 0) > 0}
        <LineChangesBadge
          additions={option.data.additions || 0}
          deletions={option.data.deletions || 0}
          size="xxs"
          showZero={false}
        />
      {/if}
    </div>
    {#if option.data?.lastUpdated}
      <span class="text-muted-foreground/70 ml-auto font-normal">{option.data.lastUpdated}</span>
    {/if}
  </div>
{/snippet}

<Breadcrumb class={className}>
  <BreadcrumbList>
    <BreadcrumbItem>
      <div class="min-w-[120px] max-w-[400px]">
        <GroupedCombobox
          value={currentWorkspaceId || undefined}
          groups={workspaceGroups}
          placeholder="Select space..."
          onSearch={searchWorkspaceGroups}
          onChange={handleWorkspaceSelect}
          onOpen={onWorkspaceDropdownOpen}
          class="breadcrumb-combobox w-full"
          dropdownClass="min-w-92 z-[100]"
          header={onCreateWorkspace ? '' : 'Spaces'}
          headerAction={workspaceHeaderAction}
          optionDescription={workspaceOptionDescription}
          groupAction={workspaceGroupAction}
          footer={workspaceFooter}
          defaultCollapsed={false}
        />
      </div>
    </BreadcrumbItem>
  </BreadcrumbList>
</Breadcrumb>

<style>
  :global(.breadcrumb-combobox) {
    /* Ensure the combobox integrates well with breadcrumb styling */
    display: inline-flex;
    align-items: center;
    -webkit-app-region: no-drag !important;
  }

  :global(.breadcrumb-combobox button) {
    -webkit-app-region: no-drag !important;
  }

  :global(.breadcrumb-combobox input) {
    -webkit-app-region: no-drag !important;
  }

  :global(.breadcrumb-combobox div) {
    -webkit-app-region: no-drag !important;
  }
</style>
