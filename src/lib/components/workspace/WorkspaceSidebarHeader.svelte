<script lang="ts">
  import { logger } from '$lib/utils/client-logger';

  import { Button } from '$lib/components/ui/button';
  import { faEllipsisV, faTrash, faTableColumns } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { tick } from 'svelte';
  import DropdownMenu from '$lib/components/ui/dropdown-menu.svelte';
  import WorkspaceActionsMenu, { type MenuAction } from '$lib/components/ui/WorkspaceActionsMenu.svelte';
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import type { Workspace } from '$shared/types';
  import GitBranchIcon from '$lib/components/icons/GitBranchIcon.svelte';
  import { WORKSPACE_CHANNELS } from '$shared/ipc/channels';
  import DeleteWarningDialog from '$lib/components/modals/DeleteWarningDialog.svelte';
  import { hasRunningAgents, getRunningAgentNames } from '$lib/utils/delete-warning-utils';
  import { layoutSettings } from '$features/layout/layout-settings.svelte';
  import { navigateAfterWorkspaceRemoval } from '$lib/utils/workspace-navigation';

  interface Props {
    workspace: Workspace | null;
    workspaceId: string;
  }

  let { workspace, workspaceId }: Props = $props();

  let isDeleting = $state(false);
  let isEditingTitle = $state(false);
  let editedTitle = $state('');
  let titleInputRef: HTMLInputElement | null = $state(null);
  let dropdownOpen = $state(false);

  // Delete warning dialog state
  let showDeleteWarning = $state(false);
  let pendingDeleteWorkspace = $state<Workspace | null>(null);
  let runningAgentNamesForDelete = $state<string[]>([]);

  // Branch rename state
  let isEditingBranch = $state(false);
  let editedBranch = $state('');
  let branchInputRef: HTMLInputElement | null = $state(null);
  let isSavingBranch = $state(false);

  async function handleDelete() {
    if (isDeleting || !workspace) return;

    // Check if workspace has running agents
    if (hasRunningAgents(workspace.id)) {
      // Show warning dialog instead of deleting immediately
      pendingDeleteWorkspace = workspace;
      runningAgentNamesForDelete = getRunningAgentNames(workspace.id);
      showDeleteWarning = true;
      return;
    }

    // No running agents, proceed with deletion
    await performDelete();
  }

  async function performDelete() {
    if (isDeleting || !workspace) return;

    const workspaceIdToDelete = workspace.id;

    try {
      isDeleting = true;
      // Fire-and-forget navigation (matches original goto('/') behavior)
      navigateAfterWorkspaceRemoval(workspaceIdToDelete).catch((err) => {
        logger.error('[WorkspaceSidebarHeader] Failed to navigate after workspace removal:', err);
      });

      await workspaceStore.deleteWithUndo(workspaceIdToDelete, workspace.title);
    } catch (error) {
      logger.error('Failed to delete workspace:', error);
    } finally {
      isDeleting = false;
    }
  }

  function startEditingTitle() {
    if (!workspace) return;
    isEditingTitle = true;
    editedTitle = workspace.title || 'Untitled';
    tick().then(() => {
      if (titleInputRef) {
        titleInputRef.focus();
        titleInputRef.select();
      }
    });
  }

  async function saveTitle() {
    if (!workspace || !editedTitle.trim()) {
      isEditingTitle = false;
      return;
    }

    const newTitle = editedTitle.trim();
    if (newTitle !== workspace.title) {
      await workspaceStore.update(workspace.id, { title: newTitle });
    }
    isEditingTitle = false;
  }

  function handleTitleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveTitle();
    } else if (e.key === 'Escape') {
      isEditingTitle = false;
      editedTitle = workspace?.title || 'Untitled';
    }
  }

  function startEditingBranch() {
    if (!workspace) return;
    isEditingBranch = true;
    editedBranch = workspace.branch || '';
    tick().then(() => {
      if (branchInputRef) {
        branchInputRef.focus();
        branchInputRef.select();
      }
    });
  }

  async function saveBranch() {
    // Guard against double-calls (blur + keydown/clickOutside can fire together)
    if (isSavingBranch) {
      return;
    }

    const { toast } = await import('svelte-sonner');

    if (!workspace || !editedBranch.trim()) {
      isEditingBranch = false;
      return;
    }

    const newBranch = editedBranch.trim();
    if (newBranch === workspace.branch) {
      isEditingBranch = false;
      return;
    }

    // Validate branch name format
    const validationError = getBranchNameValidationError(newBranch);
    if (validationError) {
      logger.error('Invalid branch name format', { branchName: newBranch, error: validationError });
      toast.error(validationError);
      editedBranch = workspace.branch || '';
      isEditingBranch = false;
      return;
    }

    isSavingBranch = true;
    try {
      const result = await window.electronAPI.invoke(WORKSPACE_CHANNELS.RENAME_BRANCH, {
        id: workspace.id,
        newBranchName: newBranch,
      });

      if (result.success) {
        // Update workspace store with new branch
        await workspaceStore.update(workspace.id, { branch: newBranch });
      } else {
        logger.error('Failed to rename branch', { error: result.error });
        toast.error(result.error || 'Failed to rename branch');
        editedBranch = workspace.branch || '';
      }
    } catch (error) {
      logger.error('Error renaming branch:', error);
      toast.error('Failed to rename branch');
      editedBranch = workspace.branch || '';
    } finally {
      isEditingBranch = false;
      isSavingBranch = false;
    }
  }

  function handleBranchKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveBranch();
    } else if (e.key === 'Escape') {
      isEditingBranch = false;
      editedBranch = workspace?.branch || '';
    }
  }

  /**
   * Validate a git branch name according to git-check-ref-format rules.
   * Returns an error message if invalid, undefined if valid.
   */
  function getBranchNameValidationError(name: string): string | undefined {
    if (!name || name.trim().length === 0) {
      return 'Branch name cannot be empty';
    }

    if (name.includes(' ')) {
      return 'Branch name cannot contain spaces';
    }

    if (/[~^:\\?*\[@{]/.test(name)) {
      return 'Branch name contains invalid characters';
    }

    if (name.startsWith('.')) {
      return "Branch name cannot start with '.'";
    }

    if (name.endsWith('.lock')) {
      return "Branch name cannot end with '.lock'";
    }

    if (name.includes('..')) {
      return "Branch name cannot contain '..'";
    }

    if (name.startsWith('/') || name.endsWith('/')) {
      return 'Branch name cannot start or end with /';
    }

    if (name.includes('//')) {
      return 'Branch name cannot contain consecutive slashes';
    }

    if (name.startsWith('-')) {
      return "Branch name cannot start with '-'";
    }

    if (name.length > 250) {
      return 'Branch name is too long (max 250 characters)';
    }

    return undefined;
  }

  const sidebarSideAction: MenuAction = $derived({
    label: layoutSettings.sidebarSide === 'left' ? 'Move sidebar to right' : 'Move sidebar to left',
    icon: faTableColumns,
    dividerBefore: true,
    onClick: () => {
      layoutSettings.toggleSidebarSide();
    },
  });

  function handleClose() {
    dropdownOpen = false;
  }

  // Handle click outside to cancel editing
  function handleClickOutside(e: MouseEvent) {
    if (isEditingTitle && titleInputRef && !titleInputRef.contains(e.target as Node)) {
      saveTitle();
    }
    if (isEditingBranch && branchInputRef && !branchInputRef.contains(e.target as Node)) {
      saveBranch();
    }
  }

  // Add/remove click listener when editing state changes
  $effect(() => {
    if (isEditingTitle || isEditingBranch) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  });
</script>

<div class="flex items-center justify-between group h-full">
  <div class="flex-1 flex flex-col min-w-0">
    {#if isEditingTitle}
      <input
        bind:this={titleInputRef}
        type="text"
        bind:value={editedTitle}
        onblur={saveTitle}
        onkeydown={handleTitleKeydown}
        oninput={(e) => {
          const target = e.currentTarget;
          // Auto-resize input based on content
          target.style.width = `${Math.max(80, Math.min(200, target.value.length * 8 + 20))}px`;
        }}
        class="text-sm font-medium text-foreground bg-none
               px-1.5 py-0.5 rounded
               outline-none min-w-[80px] max-w-[200px] leading-normal
               focus:ring-none! focus:outline-none!
               transition-all duration-150"
        placeholder="Untitled"
        style="width: {Math.max(80, Math.min(200, (editedTitle || '').length * 8 + 20))}px"
      />
    {:else}
      <button
        class="text-sm font-medium text-foreground bg-transparent
               border-none px-1.5 py-0.5 rounded cursor-pointer text-left
               max-w-full overflow-hidden text-ellipsis whitespace-nowrap
               transition-all duration-150 leading-normal line-clamp-3
              focus-visible:outline focus-visible:outline-1
               focus-visible:outline-primary/50 focus-visible:outline-offset-[-1px]
               disabled:cursor-default disabled:opacity-50"
        class:opacity-50={!workspace?.title}
        onclick={startEditingTitle}
        title="Click to edit space title"
        disabled={!workspace}
      >
        {#if workspace}
          {workspace.title || 'Untitled'}
        {/if}
      </button>
    {/if}

    <!-- repo -->
    <div class="text-muted-foreground text-xs truncate pl-1.5 -mt-1">
      {#if workspace?.repositoryOwner && workspace?.repositoryName}
        {workspace.repositoryOwner}/{workspace.repositoryName}
      {:else if workspace?.repositoryPath}
        {workspace.repositoryPath.split('/').pop()}
      {/if}
    </div>

    <!-- branch -->
    <div class="flex items-center gap-1.5 text-muted-foreground text-xs pl-1.5 -mt-1">
      <GitBranchIcon size={12} class="flex-shrink-0" />
      {#if isEditingBranch}
        <input
          bind:this={branchInputRef}
          type="text"
          bind:value={editedBranch}
          onblur={saveBranch}
          onkeydown={handleBranchKeydown}
          disabled={isSavingBranch}
          class="text-xs text-foreground bg-none
                 px-1 py-0.5 rounded
                 outline-none min-w-[60px] max-w-[150px] leading-normal
                 focus:ring-none! focus:outline-none!
                 transition-all duration-150 disabled:opacity-50"
          placeholder="branch name"
          style="width: {Math.max(60, Math.min(150, (editedBranch || '').length * 6 + 20))}px"
        />
      {:else}
        <button
          class="text-xs text-muted-foreground bg-transparent
                 border-none px-1 py-0.5 rounded cursor-pointer text-left
                 max-w-full overflow-hidden text-ellipsis whitespace-nowrap
                 transition-all duration-150 leading-normal
                 hover:text-foreground hover:opacity-80
                 focus-visible:outline focus-visible:outline-1
                 focus-visible:outline-primary/50 focus-visible:outline-offset-[-1px]
                 disabled:cursor-default disabled:opacity-50"
          onclick={startEditingBranch}
          title="Click to edit branch name"
          disabled={!workspace || isSavingBranch}
        >
          {#if workspace}
            {workspace.branch || 'no branch'}
          {/if}
        </button>
      {/if}
    </div>
  </div>

  <DropdownMenu bind:open={dropdownOpen} align="end">
    {#snippet trigger({ toggle }: { toggle: () => void })}
      <Button
        variant="ghost-light"
        size="icon-sm"
        class="opacity-50 group-hover:opacity-70 hover:!opacity-100 transition-opacity duration-150"
        onclick={toggle}
        disabled={isDeleting}
      >
        {#if isDeleting}
          <div
            class="animate-spin h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full"
          ></div>
        {:else}
          <Fa icon={faEllipsisV} size="sm" />
        {/if}
      </Button>
    {/snippet}

    {#snippet content({ close }: { close: () => void })}
      <div class="w-48">
        <WorkspaceActionsMenu
          filePath={workspace?.worktreePath || workspace?.repositoryPath || workspace?.path || ''}
          workspaceId={workspace?.id || workspaceId}
          isDirectory={true}
          isWorkspaceRoot={true}
          onDelete={handleDelete}
          onClose={handleClose}
          showDeleteOption={true}
          showFileNameCopy={false}
          additionalActions={[sidebarSideAction]}
        />
      </div>
    {/snippet}
  </DropdownMenu>
</div>

<!-- Delete Warning Dialog -->
<DeleteWarningDialog
  bind:open={showDeleteWarning}
  agentNames={runningAgentNamesForDelete}
  onDeleteAnyway={async () => {
    if (pendingDeleteWorkspace) {
      await performDelete();
      pendingDeleteWorkspace = null;
    }
  }}
  onCancel={() => {
    pendingDeleteWorkspace = null;
  }}
/>
