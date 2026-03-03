<script lang="ts">
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import { createLogger } from '$lib/utils/client-logger';
  import type { Workspace } from '$shared/types';
  import { WorkspaceStatusEnum } from '$shared/types';
  import { navigateAfterWorkspaceRemoval } from '$lib/utils/workspace-navigation';
  import { toNativePath } from '$lib/utils/path-utils';
  import {
    faChevronDown,
    faCodeBranch,
    faCopy,
    faEllipsisVertical,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import Button from './button/button.svelte';
  import DropdownMenu from './dropdown-menu.svelte';
  import WorkspaceActionsMenu from './WorkspaceActionsMenu.svelte';
  import PanelVisibilityDebugControls from './PanelVisibilityDebugControls.svelte';

  const logger = createLogger('WorkspaceDropdown');

  interface Props {
    workspace: Workspace;
    variant?: 'default' | 'ghost' | 'outline';
    size?: 'xs' | 'sm' | 'lg';
    label?: string;
    isCompact?: boolean;
    onDelete?: () => void;
    showAdditionalActions?: boolean;
    showArchiveOption?: boolean;
  }

  let {
    workspace,
    variant = 'ghost',
    size = 'sm',
    label = 'Actions',
    isCompact = false,
    onDelete = undefined,
    showAdditionalActions = true,
    showArchiveOption = true,
  }: Props = $props();

  let dropdownOpen = $state(false);

  // Get the workspace path
  let workspacePath = $derived(workspace.worktreePath || workspace.repositoryPath || '');

  // Check if workspace is archived
  let isArchived = $derived(workspace.status === WorkspaceStatusEnum.Archived);

  // Button size classes
  const sizeClasses = {
    xs: 'px-2 py-1 text-xs',
    sm: 'px-3 py-1.5 text-xs',
    lg: 'px-6 py-3 text-base',
  };

  // Button variant classes
  const variantClasses = {
    default: 'bg-primary text-primary-foreground hover:bg-primary/90',
    ghost: 'hover:bg-accent/10 hover:text-accent',
    outline: 'border border-input bg-background hover:bg-accent/10 hover:text-accent',
  };

  function handleClose() {
    dropdownOpen = false;
  }

  // Archive workspace with undo support
  async function handleArchive() {
    const { toast } = await import('svelte-sonner');
    const workspaceTitle = workspace.title || 'space';

    try {
      const result = await workspaceStore.archive(workspace.id);
      if (result.ok) {
        logger.info('Workspace archived successfully');
        toast.warning(`Archived space ${workspaceTitle}`, {
          duration: 15000,
          action: {
            label: 'Undo',
            onClick: async () => {
              await workspaceStore.unarchive(workspace.id);
            },
          },
        });
      } else {
        toast.error('Failed to archive space');
        logger.error('Failed to archive workspace:', result.error);
        handleClose();
        return;
      }
    } catch (error) {
      logger.error('Failed to archive workspace:', error as Error);
      toast.error('Failed to archive space');
      handleClose();
      return;
    }

    // Navigate after successful archive (separate from archive error handling)
    try {
      await navigateAfterWorkspaceRemoval(workspace.id);
    } catch (navError) {
      logger.error('Failed to navigate after archive:', navError);
    }
    handleClose();
  }

  // Unarchive workspace
  async function handleUnarchive() {
    const { toast } = await import('svelte-sonner');
    const workspaceTitle = workspace.title || 'space';

    try {
      const result = await workspaceStore.unarchive(workspace.id);
      if (result.ok) {
        logger.info('Workspace unarchived successfully');
        toast.success(`Unarchived space ${workspaceTitle}`);
      } else {
        toast.error('Failed to unarchive space');
        logger.error('Failed to unarchive workspace:', result.error);
      }
    } catch (error) {
      logger.error('Failed to unarchive workspace:', error as Error);
      toast.error('Failed to unarchive space');
    }
    handleClose();
  }

  async function duplicateWorkspace() {
    try {
      const result = await workspaceStore.duplicate(workspace.id);

      if (result.ok) {
        logger.info('Workspace duplicated successfully');
        handleClose();
        // Optionally navigate to the new workspace or show a notification
      } else {
        logger.error('Failed to duplicate workspace:', result.error);
      }
    } catch (error) {
      logger.error('Error duplicating workspace:', error as Error);
    }
  }

  // Build additional actions array for WorkspaceActionsMenu
  let workspaceAdditionalActions = $derived(
    showAdditionalActions
      ? [
          {
            label: 'Duplicate Space',
            icon: faCodeBranch,
            onClick: duplicateWorkspace,
          },
          {
            label: 'Copy Space Path',
            icon: faCopy,
            onClick: () => {
              const pathToCopy =
                workspace.worktreePath || workspace.repositoryPath || workspace.path || '';
              navigator.clipboard.writeText(toNativePath(pathToCopy));
              handleClose();
            },
          },
        ]
      : [],
  );
</script>

<DropdownMenu bind:open={dropdownOpen} align="end">
  {#snippet trigger({ toggle }: { toggle: () => void })}
    <Button
      variant={variant === 'ghost' ? 'ghost-light' : variant}
      onclick={toggle}
      size={isCompact ? `icon-${size}` : size}
      class="{sizeClasses[size]} {variantClasses[variant]}"
      title={isCompact ? label : undefined}
      aria-label={label}
    >
      {#if isCompact}
        <Fa icon={faEllipsisVertical} {size} />
      {:else}
        <span>{label}</span>
        <Fa icon={faChevronDown} {size} />
      {/if}
    </Button>
  {/snippet}

  {#snippet content({ close: _close }: { close: () => void })}
    <div class="w-auto min-w-56 max-w-72">
      <WorkspaceActionsMenu
        filePath={workspacePath}
        workspaceId={workspace.id}
        isDirectory={true}
        isWorkspaceRoot={true}
        {onDelete}
        onArchive={handleArchive}
        onUnarchive={handleUnarchive}
        {isArchived}
        onClose={handleClose}
        showDeleteOption={!!onDelete}
        {showArchiveOption}
        showFileNameCopy={false}
        additionalActions={workspaceAdditionalActions}
      />

      {#if showAdditionalActions}
        <!-- Debug Panel Visibility Controls -->
        <div class="px-1">
          <PanelVisibilityDebugControls onClose={handleClose} />
        </div>
      {/if}
    </div>
  {/snippet}
</DropdownMenu>
