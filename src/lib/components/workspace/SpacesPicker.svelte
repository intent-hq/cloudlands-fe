<script lang="ts">
  /**
   * SpacesPicker - Sleek workspace switcher with Vercel-inspired design
   *
   * A polished dropdown for switching between workspaces with a clean,
   * minimal aesthetic. Includes quick actions for home and creating new workspaces.
   */

  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import Dropdown from '$lib/components/ui/dropdown/Dropdown.svelte';
  import { invoke } from '$lib/electron-bridge';
  import { WorkspaceStatusEnum as WorkspaceStatus } from '$shared/types';
  import type { Workspace } from '$shared/types';
  import LineChangesBadge from '$lib/components/shared/LineChangesBadge.svelte';
  import { cn } from '$lib/utils';
  import { faBars, faHome, faPlus } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import type { DropdownItemProps } from '$lib/components/ui/dropdown/types';
  import { IPC_CHANNELS } from '$shared/ipc-registry';

  interface Props {
    workspaceId?: string;
    class?: string;
  }

  let { workspaceId, class: className }: Props = $props();

  let dropdownOpen = $state(false);

  // Get all active workspaces
  const allWorkspaces = $derived(
    (workspaceStore.items || []).filter((w) => w.status !== WorkspaceStatus.Archived),
  );

  // Build options for the dropdown with Home at the top
  // Use a Set to ensure unique workspace IDs (prevents duplicate key errors)
  const workspaceOptions = $derived.by(() => {
    const seenIds = new Set<string>();
    const uniqueWorkspaces = allWorkspaces
      .sort((a, b) => {
        const dateA = new Date(a.lastActivity || a.updatedAt || 0).getTime();
        const dateB = new Date(b.lastActivity || b.updatedAt || 0).getTime();
        return dateB - dateA;
      })
      .filter((w) => {
        if (!w.id || seenIds.has(w.id)) return false;
        seenIds.add(w.id);
        return true;
      });

    return uniqueWorkspaces.map((workspace) => ({
      value: workspace.id,
      label: workspace.title || 'Untitled',
      description: getRepoName(workspace),
      data: workspace as unknown as Record<string, unknown>,
    }));
  });

  // Helper to get workspace from option data
  function getWorkspaceFromOption(data: Record<string, unknown> | undefined): Workspace | null {
    return (data as unknown as Workspace) ?? null;
  }

  // Get display name for repo
  function getRepoName(workspace: Workspace): string {
    if (workspace.repositoryOwner && workspace.repositoryName) {
      return `${workspace.repositoryOwner}/${workspace.repositoryName}`;
    }
    if (workspace.repositoryPath) {
      return workspace.repositoryPath.split('/').pop() || '';
    }
    return '';
  }

  // Get line changes for a workspace
  function getLineChanges(workspace: Workspace): { additions: number; deletions: number } {
    if (workspace.diffSummary) {
      return {
        additions: workspace.diffSummary.totalAdditions || 0,
        deletions: workspace.diffSummary.totalDeletions || 0,
      };
    }
    return { additions: 0, deletions: 0 };
  }

  // Handle workspace selection
  async function handleChange(value: string | string[], event?: MouseEvent) {
    const selected = Array.isArray(value) ? value[0] : value;
    if (!selected) return;

    // Handle home option
    if (selected === '__home__') {
      goto('/');
      return;
    }

    // Check if cmd/ctrl+click to open in new window
    const openInNewWindow = event?.metaKey || event?.ctrlKey;
    const route = `/workspace/${selected}`;

    if (openInNewWindow) {
      // Open in a new Electron window
      try {
        await invoke(IPC_CHANNELS.WINDOW.OPEN_NEW, { route });
      } catch (error) {
        // Fallback to regular navigation if IPC fails
        console.warn('Failed to open new window, navigating instead:', error);
        goto(route);
      }
      return;
    }

    // Navigate to workspace if different from current
    if (selected !== workspaceId) {
      goto(route);
    }
  }

  // Open the new space modal
  function createNewWorkspace() {
    dropdownOpen = false;
    window.dispatchEvent(new CustomEvent('app:open-new-space-modal', { detail: {} }));
  }
</script>

<div class={cn('spaces-picker flex items-center gap-1', className)}>
  <!-- Home button -->
  <button
    onclick={() => goto('/')}
    class={cn(
      'flex items-center justify-center w-7 h-7 rounded-md cursor-pointer',
      'transition-all duration-150',
      page.url.pathname === '/'
        ? 'bg-muted/80 text-foreground'
        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
    )}
    aria-label="Go to home"
  >
    <Fa icon={faHome} class="w-3.5 h-3.5" />
  </button>

  <!-- Workspace Switcher Dropdown -->
  <Dropdown
    bind:open={dropdownOpen}
    value={workspaceId}
    options={workspaceOptions}
    placeholder="Search spaces..."
    onchange={handleChange}
    searchable
    contentClass="min-w-[260px]"
    triggerClass="p-0! h-auto! flex"
    variant="ghost"
    portal
    size="sm"
  >
    {#snippet header()}
      <div class="flex items-center justify-between px-3 py-2">
        <span class="text-ui font-medium text-muted-foreground uppercase tracking-wider">
          Spaces
        </span>
        <button
          onclick={createNewWorkspace}
          class={cn(
            'flex items-center justify-center w-5 h-5 rounded cursor-pointer',
            'text-muted-foreground hover:text-foreground hover:bg-muted/50',
            'transition-colors duration-150',
          )}
          aria-label="New space"
        >
          <Fa icon={faPlus} class="w-3 h-3" />
        </button>
      </div>
    {/snippet}

    {#snippet trigger({ open })}
      <button
        class={cn(
          'flex items-center justify-center w-6 h-6 rounded-md cursor-pointer',
          'transition-all duration-150',
          open
            ? 'bg-muted/80 text-foreground'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
        )}
        aria-label="Switch space"
      >
        <Fa icon={faBars} class="w-3.5 h-3.5" />
      </button>
    {/snippet}

    {#snippet item({ option, selected }: DropdownItemProps)}
      {@const isHome = option.value === '__home__'}
      {@const workspace = isHome ? null : getWorkspaceFromOption(option.data)}
      {@const changes = workspace ? getLineChanges(workspace) : { additions: 0, deletions: 0 }}
      <div class="flex items-center gap-2.5 w-full py-0.5">
        <!-- Content -->
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1.5">
            <span
              class={cn(
                'truncate text-[13px]',
                selected ? 'font-medium text-foreground' : 'text-foreground/80',
              )}
            >
              {option.label}
            </span>
            {#if !isHome && (changes.additions > 0 || changes.deletions > 0)}
              <LineChangesBadge
                additions={changes.additions}
                deletions={changes.deletions}
                size="xxs"
              />
            {/if}
          </div>
          {#if !isHome && workspace?.branch}
            <div class="flex items-center gap-1 text-ui text-subtle">
              <!-- <Fa icon={faCodeBranch} class="w-2 h-2" /> -->
              <span class="truncate">{workspace.repositoryOwner}/{workspace.repositoryName}</span>
            </div>
          {/if}
        </div>

        <!-- Selected indicator -->
        {#if selected}
          <span class="w-1.5 h-1.5 rounded-full bg-primary shrink-0"></span>
        {/if}
      </div>
    {/snippet}

    {#snippet footer()}
      <div class="px-3 py-1 text-ui text-subtle bg-sidebar">
        <span class="font-medium">⌘+click</span> to open in new window
      </div>
    {/snippet}
  </Dropdown>
</div>
