<script lang="ts">
  import { logger } from '$lib/utils/client-logger';
  import { invoke } from '$shared/generated/ipc-client';

  import { Button } from '$lib/components/ui/button';
  import { TooltipRich } from '$lib/components/ui/tooltip';
  import {
    faBars,
    faEllipsisV,
    faKeyboard,
    faRightLeft,
    faTableColumns,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { tick } from 'svelte';
  import { writable } from 'svelte/store';
  import DropdownMenu from '$lib/components/ui/dropdown-menu.svelte';
  import WorkspaceActionsMenu, {
    type MenuAction,
  } from '$features/workspace/components/WorkspaceActionsMenu.svelte';
  import { workspaceClient } from '$store/renderer/slices/workspace/utils/workspace.client';
  import { WORKSPACE_STATUS_MESSAGE_MAX_LENGTH, type Workspace } from '$shared/types';
  import { WORKSPACE_CHANNELS } from '$shared/ipc/channels';
  import { selectSidebarSide } from '$store/renderer/slices/ui-layout/ui-layout-selectors';
  import {
    toggleSidebar,
    toggleSidebarSide,
  } from '$store/renderer/slices/ui-layout/ui-layout-slice';

  import { requestDeleteWorkspace } from '$store/renderer/slices/workspace-operations/workspace-operations-slice';
  import { openTransferModal } from '$store/renderer/slices/workspace-transfer/workspace-transfer-slice';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
  import {
    markKeySlotUnassigned,
    pinWorkspaceToKey,
  } from '$store/renderer/slices/hardware-console/hardware-console-slice';
  import {
    selectWorkspacePinnedKeySlot,
    selectWorkspaceResolvedKeySlot,
  } from '$store/renderer/slices/hardware-console/hardware-console-selectors';
  import { AGENT_KEY_COUNT } from '$features/hardware-console/assignment/key-assignment';
  import { microConnectedReadable } from '$features/hardware-console/device/connection-status';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
  import { renameWorkspaceTitle } from '$features/workspace/rename-workspace-title';

  interface Props {
    workspace: Workspace | null;
    workspaceId: string;
  }

  let { workspace, workspaceId }: Props = $props();

  const sidebarSide$ = selectSidebarSide();

  let isDeleting = $state(false);
  let isEditingTitle = $state(false);
  let isSavingTitle = false;
  let editedTitle = $state('');
  let titleInputRef: HTMLInputElement | null = $state(null);
  let isEditingStatusMessage = $state(false);
  let editedStatusMessage = $state('');
  let statusInputRef: HTMLTextAreaElement | null = $state(null);
  let isSavingStatusMessage = $state(false);
  let skipNextStatusBlurSave = $state(false);
  let dropdownOpen = $state(false);

  // Branch rename state
  let isEditingBranch = $state(false);
  let editedBranch = $state('');
  let branchInputRef: HTMLInputElement | null = $state(null);
  let isSavingBranch = $state(false);

  const currentStatusMessage = $derived(workspace?.statusMessage?.trim() ?? '');
  const repositoryLabel = $derived(
    workspace?.repositoryOwner && workspace?.repositoryName
      ? `${workspace.repositoryOwner}/${workspace.repositoryName}`
      : (workspace?.repositoryPath?.split('/').pop() ?? ''),
  );

  async function handleDelete() {
    if (isDeleting || !workspace) return;

    try {
      isDeleting = true;
      appStore.dispatch(requestDeleteWorkspace(workspace.id));
    } catch (error) {
      logger.error('Failed to delete workspace:', error);
    } finally {
      isDeleting = false;
    }
  }

  function startEditingTitle() {
    if (!workspace) return;
    isEditingTitle = true;
    editedTitle = workspace.title || m.workspace_links_untitled_label();
    tick().then(() => {
      if (titleInputRef) {
        titleInputRef.focus();
        titleInputRef.select();
      }
    });
  }

  async function saveTitle() {
    if (isSavingTitle || !workspace || !editedTitle.trim()) {
      isEditingTitle = false;
      return;
    }

    const newTitle = editedTitle.trim();
    if (newTitle !== workspace.title) {
      isSavingTitle = true;
      isEditingTitle = false;
      try {
        await renameWorkspaceTitle(workspace, newTitle);
      } finally {
        isSavingTitle = false;
      }
    }
    isEditingTitle = false;
  }

  function handleTitleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveTitle();
    } else if (e.key === 'Escape') {
      isEditingTitle = false;
      editedTitle = workspace?.title || m.workspace_links_untitled_label();
    }
  }

  function startEditingStatusMessage() {
    if (!workspace) return;
    skipNextStatusBlurSave = false;
    isEditingStatusMessage = true;
    editedStatusMessage = workspace.statusMessage || '';
    tick().then(() => {
      if (statusInputRef) {
        statusInputRef.focus();
        statusInputRef.select();
      }
    });
  }

  async function saveStatusMessage() {
    if (skipNextStatusBlurSave) {
      skipNextStatusBlurSave = false;
      return;
    }

    if (isSavingStatusMessage) {
      return;
    }

    if (!workspace) {
      isEditingStatusMessage = false;
      return;
    }

    const newStatusMessage = editedStatusMessage.trim();
    if (newStatusMessage === currentStatusMessage) {
      isEditingStatusMessage = false;
      return;
    }

    isSavingStatusMessage = true;
    try {
      const result = await workspaceClient.update({
        id: workspace.id,
        statusMessage: newStatusMessage,
      });
      if (result.ok) {
        appStore.dispatch(setWorkspaceEntity(result.data));
      } else {
        logger.error('Failed to update workspace status', { error: result.error });
        editedStatusMessage = workspace.statusMessage || '';
      }
    } catch (error) {
      logger.error('Failed to update workspace status:', error);
      editedStatusMessage = workspace.statusMessage || '';
    } finally {
      isEditingStatusMessage = false;
      isSavingStatusMessage = false;
    }
  }

  function handleStatusMessageKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      saveStatusMessage();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      skipNextStatusBlurSave = true;
      isEditingStatusMessage = false;
      editedStatusMessage = workspace?.statusMessage || '';
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

  async function handleBranchClick(event: MouseEvent) {
    if (!workspace) return;
    if (!event.shiftKey || !workspace.branch) {
      startEditingBranch();
      return;
    }

    const { toast } = await import('svelte-sonner');
    try {
      await navigator.clipboard.writeText(workspace.branch);
      toast.success(m.workspace_sidebarHeader_branchCopied_toast());
    } catch (error) {
      logger.error('Failed to copy branch name:', error);
      toast.error(m.workspace_sidebarHeader_branchCopyFailed_error());
    }
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
      const result = await invoke<any>(WORKSPACE_CHANNELS.RENAME_BRANCH, {
        id: workspace.id,
        newBranchName: newBranch,
      });

      if (result.success) {
        // Update workspace store with new branch
        const updateResult = await workspaceClient.update({ id: workspace.id, branch: newBranch });
        if (updateResult.ok) {
          appStore.dispatch(setWorkspaceEntity(updateResult.data));
        }
      } else {
        logger.error('Failed to rename branch', { error: result.error });
        toast.error(result.error || m.workspace_sidebarHeader_renameBranchFailed_error());
        editedBranch = workspace.branch || '';
      }
    } catch (error) {
      logger.error('Error renaming branch:', error);
      toast.error(m.workspace_sidebarHeader_renameBranchFailed_error());
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
      return m.workspace_sidebarHeader_branchEmpty_error();
    }

    if (name.includes(' ')) {
      return m.workspace_sidebarHeader_branchSpaces_error();
    }

    if (/[~^:\\?*\[@{]/.test(name)) {
      return m.workspace_sidebarHeader_branchInvalidChars_error();
    }

    if (name.startsWith('.')) {
      return m.workspace_sidebarHeader_branchStartsDot_error();
    }

    if (name.endsWith('.lock')) {
      return m.workspace_sidebarHeader_branchEndsLock_error();
    }

    if (name.includes('..')) {
      return m.workspace_sidebarHeader_branchDoubleDot_error();
    }

    if (name.startsWith('/') || name.endsWith('/')) {
      return m.workspace_sidebarHeader_branchSlashEnds_error();
    }

    if (name.includes('//')) {
      return m.workspace_sidebarHeader_branchDoubleSlash_error();
    }

    if (name.startsWith('-')) {
      return m.workspace_sidebarHeader_branchStartsDash_error();
    }

    if (name.length > 250) {
      return m.workspace_sidebarHeader_branchTooLong_error();
    }

    return undefined;
  }

  const sidebarToggleAction: MenuAction = {
    label: m.ui_sidebar_toggle_label(),
    icon: faBars,
    dividerBefore: true,
    shortcut: 'mod+b',
    onClick: () => {
      appStore.dispatch(toggleSidebar());
    },
  };

  const sidebarSideAction: MenuAction = $derived({
    label:
      $sidebarSide$ === 'left'
        ? m.workspace_sidebarHeader_moveSidebarRight_label()
        : m.workspace_sidebarHeader_moveSidebarLeft_label(),
    icon: faTableColumns,
    onClick: () => {
      appStore.dispatch(toggleSidebarSide());
    },
  });

  // Micro-key assignment submenu: only while a micro is connected (manager
  // status connected — not mere presence).
  const microConnected$ = microConnectedReadable();
  const workspaceIdStore = writable('');
  $effect(() => {
    workspaceIdStore.set(workspaceId || workspace?.id || '');
  });
  const pinnedKeySlot$ = selectWorkspacePinnedKeySlot(workspaceIdStore);
  const resolvedKeySlot$ = selectWorkspaceResolvedKeySlot(workspaceIdStore);

  const microKeyAction: MenuAction | null = $derived.by(() => {
    const targetWorkspaceId = workspaceId || workspace?.id || '';
    if (!$microConnected$ || !targetWorkspaceId) return null;
    const submenu: MenuAction[] = [];
    for (let slot = 0; slot < AGENT_KEY_COUNT; slot += 1) {
      submenu.push({
        label: m.workspace_card_assignMicroKeyNumber_label({ number: formatInteger(slot + 1) }),
        checked: $pinnedKeySlot$ === slot,
        onClick: () => {
          appStore.dispatch(pinWorkspaceToKey(slot, targetWorkspaceId));
        },
      });
    }
    const resolvedSlot = $resolvedKeySlot$;
    if (resolvedSlot !== null) {
      submenu.push({
        label: m.workspace_card_unassignMicroKey_label(),
        onClick: () => {
          appStore.dispatch(markKeySlotUnassigned(resolvedSlot));
        },
      });
    }
    return {
      label: m.workspace_card_assignMicroKey_label(),
      icon: faKeyboard,
      dividerBefore: true,
      onClick: () => {},
      submenu,
    };
  });

  const transferAction: MenuAction | null = $derived(
    workspace
      ? {
          label: m.workspace_card_transfer_label(),
          icon: faRightLeft,
          onClick: () => {
            appStore.dispatch(
              openTransferModal({ workspaceId: workspace.id, workspaceTitle: workspace.title }),
            );
          },
        }
      : null,
  );

  const additionalActions: MenuAction[] = $derived([
    sidebarToggleAction,
    ...(microKeyAction ? [microKeyAction] : []),
    ...(transferAction ? [transferAction] : []),
    sidebarSideAction,
  ]);

  function handleClose() {
    dropdownOpen = false;
  }

  // Handle click outside to cancel editing
  function handleClickOutside(e: MouseEvent) {
    if (isEditingTitle && titleInputRef && !titleInputRef.contains(e.target as Node)) {
      saveTitle();
    }
    if (isEditingStatusMessage && statusInputRef && !statusInputRef.contains(e.target as Node)) {
      saveStatusMessage();
    }
    if (isEditingBranch && branchInputRef && !branchInputRef.contains(e.target as Node)) {
      saveBranch();
    }
  }

  // Add/remove click listener when editing state changes
  $effect(() => {
    if (isEditingTitle || isEditingStatusMessage || isEditingBranch) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  });
</script>

<div class="group flex h-full items-start justify-between gap-2">
  <div class="flex min-w-0 flex-1 flex-col gap-1">
    <div class="relative flex w-full min-w-0 items-center">
      <span
        aria-hidden="true"
        class="pointer-events-none absolute z-0 rounded-(--radius-small) border transition-[inset,border-color,background-color] duration-(--motion-standard) ease-(--ease-standard) motion-reduce:transition-none {isEditingTitle
          ? '-inset-x-2 -inset-y-1.5 border-ring/60 bg-muted/50'
          : 'inset-0 border-transparent bg-transparent'}"
      ></span>
      {#if isEditingTitle}
        <input
          bind:this={titleInputRef}
          type="text"
          bind:value={editedTitle}
          onblur={saveTitle}
          onkeydown={handleTitleKeydown}
          class="edit-input type-title relative z-10 w-full rounded border-none bg-transparent py-0.5 text-foreground
                 outline-none leading-normal
                 focus:ring-none! focus:outline-none!
                 transition-all duration-150"
          placeholder={m.ui_editableName_placeholder()}
        />
      {:else}
        <button
          class="type-title relative z-10 cursor-text rounded border-none bg-transparent py-0.5 pr-1 text-left text-foreground
                 max-w-full overflow-hidden text-ellipsis whitespace-nowrap
                 transition-all duration-150 leading-normal line-clamp-3
                focus-visible:outline focus-visible:outline-1
                 focus-visible:outline-ring focus-visible:outline-offset-[-1px]
                 disabled:cursor-default disabled:opacity-50"
          class:opacity-50={!workspace?.title}
          onclick={startEditingTitle}
          title={m.workspace_sidebarHeader_editTitle_tooltip()}
          disabled={!workspace}
        >
          {#if workspace}
            {workspace.title || m.workspace_links_untitled_label()}
          {/if}
        </button>
      {/if}
    </div>

    <!-- status message -->
    {#if isEditingStatusMessage}
      <textarea
        bind:this={statusInputRef}
        bind:value={editedStatusMessage}
        onblur={saveStatusMessage}
        onkeydown={handleStatusMessageKeydown}
        disabled={isSavingStatusMessage}
        maxlength={WORKSPACE_STATUS_MESSAGE_MAX_LENGTH}
        aria-label={m.workspace_sidebarHeader_status_ariaLabel()}
        rows={1}
        class="type-body max-h-32 w-full resize-none overflow-hidden whitespace-pre-wrap break-words rounded bg-none py-0.5 text-foreground
               outline-none leading-snug
               focus:ring-none! focus:outline-none!
               transition-all duration-150 disabled:opacity-50"
        style="field-sizing: content;"
        placeholder={m.workspace_sidebarHeader_addStatus_placeholder()}></textarea>
    {:else if workspace}
      <button
        class="type-body cursor-text rounded border-none bg-transparent py-0.5 text-left text-muted-foreground
               max-w-full overflow-hidden line-clamp-2 break-words whitespace-normal
               transition-all duration-150 leading-snug
               hover:text-foreground hover:opacity-80
               focus-visible:outline focus-visible:outline-1
               focus-visible:outline-ring focus-visible:outline-offset-[-1px]
               disabled:cursor-default disabled:opacity-50"
        class:italic={!currentStatusMessage}
        class:text-ghost={!currentStatusMessage}
        onclick={startEditingStatusMessage}
        title={currentStatusMessage
          ? m.workspace_sidebarHeader_editStatus_tooltip()
          : m.workspace_sidebarHeader_addStatus_tooltip()}
        aria-label={currentStatusMessage
          ? m.workspace_sidebarHeader_editStatus_ariaLabel()
          : m.workspace_sidebarHeader_addStatus_ariaLabel()}
        disabled={!workspace}
      >
        {currentStatusMessage || m.workspace_sidebarHeader_addStatus_label()}
      </button>
    {/if}

    <!-- repository and branch metadata -->
    <div
      class="type-caption flex h-5 w-full min-w-0 items-center gap-1.5 overflow-hidden leading-5 text-muted-foreground"
      data-sidebar-workspace-metadata
    >
      {#if repositoryLabel}
        <span
          class="flex h-5 min-w-0 max-w-[45%] shrink items-center truncate leading-5"
          title={repositoryLabel}
          data-sidebar-repository
        >
          {repositoryLabel}
        </span>
        <span class="flex h-5 shrink-0 items-center leading-5" aria-hidden="true">·</span>
      {/if}
      {#if workspace}
        <div class="flex h-5 min-w-0 flex-1 items-center leading-5" data-sidebar-branch-metadata>
          {#if isEditingBranch}
            <input
              bind:this={branchInputRef}
              type="text"
              bind:value={editedBranch}
              onblur={saveBranch}
              onkeydown={handleBranchKeydown}
              disabled={isSavingBranch}
              class="type-caption h-5 w-0 min-w-0 flex-1 rounded-sm bg-none px-1 py-0 leading-5 text-foreground
                     outline-none focus:ring-none! focus:outline-none!
                     transition-all duration-150 disabled:opacity-50"
              placeholder={m.workspace_sidebarHeader_branchName_placeholder()}
            />
          {:else}
            <TooltipRich
              side="bottom"
              align="start"
              sideOffset={6}
              delayDuration={300}
              maxWidth="16rem"
              contentClass="border-0!"
              contentContainerClass="p-0! space-y-0!"
              showArrow={false}
              class="type-caption flex h-5 w-0 min-w-0 flex-1 cursor-text items-center overflow-hidden text-ellipsis whitespace-nowrap rounded-sm border-none bg-transparent p-0 text-left leading-5 text-muted-foreground
                     transition-all duration-150 hover:text-foreground
                     focus-visible:outline focus-visible:outline-1
                     focus-visible:outline-ring focus-visible:outline-offset-[-1px]
                     disabled:cursor-default disabled:opacity-50"
              onclick={handleBranchClick}
              disabled={isSavingBranch}
            >
              {#snippet trigger()}
                <span class="min-w-0 flex-1 truncate">
                  {workspace.branch || m.workspace_sidebarHeader_noBranch_label()}
                </span>
              {/snippet}
              {#snippet content()}
                <div class="w-56 p-2.5" data-sidebar-branch-hover-card>
                  <p
                    class="truncate text-sm font-medium text-popover-foreground"
                    title={workspace.branch || m.workspace_sidebarHeader_noBranch_label()}
                  >
                    {workspace.branch || m.workspace_sidebarHeader_noBranch_label()}
                  </p>
                  {#if workspace.baseRef}
                    <p class="mt-1 min-w-0 truncate text-xs text-muted-foreground">
                      {m.workspace_sidebarHeader_base_label({ ref: workspace.baseRef })}
                    </p>
                  {/if}
                </div>
              {/snippet}
            </TooltipRich>
          {/if}
        </div>
      {/if}
    </div>
  </div>

  <div class="flex shrink-0 items-start gap-1" data-sidebar-header-controls>
    <DropdownMenu bind:open={dropdownOpen} align="end">
      {#snippet trigger({ props })}
        <Button
          {...props}
          variant="ghost-light"
          size="icon-sm"
          aria-label={m.workspace_sidebarHeader_actions_ariaLabel()}
          class="opacity-50 group-hover:opacity-70 hover:!opacity-100 transition-opacity duration-150"
          disabled={isDeleting}
          data-workspace-actions-trigger
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

      {#snippet content()}
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
            {additionalActions}
          />
        </div>
      {/snippet}
    </DropdownMenu>
  </div>
</div>

<style>
  input.edit-input::selection {
    background: hsl(var(--ring) / 0.3);
  }
</style>
