<script lang="ts">
  import { logger } from '$lib/utils/client-logger';
  import { invoke } from '$shared/generated/ipc-client';

  import { Button } from '$lib/components/ui/button';
  import {
  faEllipsisV,
  faKeyboard,
  faTableColumns,
} from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { tick } from 'svelte';
  import { writable } from 'svelte/store';
  import DropdownMenu from '$lib/components/ui/dropdown-menu.svelte';
  import WorkspaceActionsMenu, {
    type MenuAction,
  } from '$lib/components/ui/WorkspaceActionsMenu.svelte';
  import { workspaceClient } from '$store/renderer/slices/workspace/utils/workspace.client';
  import {
  WORKSPACE_STATUS_MESSAGE_MAX_LENGTH,
  type Workspace,
} from '$shared/types';
  import GitBranchIcon from '$lib/components/icons/GitBranchIcon.svelte';
  import { WORKSPACE_CHANNELS } from '$shared/ipc/channels';
  import { selectSidebarSide } from '$store/renderer/slices/ui-layout/ui-layout-selectors';
  import { toggleSidebarSide } from '$store/renderer/slices/ui-layout/ui-layout-slice';

  import { requestDeleteWorkspace } from '$store/renderer/slices/workspace-operations/workspace-operations-slice';
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


  interface Props {
    workspace: Workspace | null;
    workspaceId: string;
  }

  let { workspace, workspaceId }: Props = $props();

  const sidebarSide$ = selectSidebarSide();

  let isDeleting = $state(false);
  let isEditingTitle = $state(false);
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
    if (!workspace || !editedTitle.trim()) {
      isEditingTitle = false;
      return;
    }

    const newTitle = editedTitle.trim();
    if (newTitle !== workspace.title) {
      const result = await workspaceClient.update({ id: workspace.id, title: newTitle });
      if (result.ok) {
        appStore.dispatch(setWorkspaceEntity(result.data));
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

  // Grow the status textarea to fit its wrapped content so no scrollbar appears.
  function autoResizeStatusInput() {
    if (!statusInputRef) return;
    statusInputRef.style.height = 'auto';
    statusInputRef.style.height = `${statusInputRef.scrollHeight}px`;
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
        autoResizeStatusInput();
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

  const sidebarSideAction: MenuAction = $derived({
    label:
      $sidebarSide$ === 'left'
        ? m.workspace_sidebarHeader_moveSidebarRight_label()
        : m.workspace_sidebarHeader_moveSidebarLeft_label(),
    icon: faTableColumns,
    dividerBefore: true,
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
        placeholder={m.ui_editableName_placeholder()}
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
        title={m.workspace_sidebarHeader_editTitle_tooltip()}
        disabled={!workspace}
      >
        {#if workspace}
          {workspace.title || m.workspace_links_untitled_label()}
        {/if}
      </button>
    {/if}

    <!-- status message -->
    {#if isEditingStatusMessage}
      <textarea
        bind:this={statusInputRef}
        rows="1"
        bind:value={editedStatusMessage}
        oninput={autoResizeStatusInput}
        onblur={saveStatusMessage}
        onkeydown={handleStatusMessageKeydown}
        disabled={isSavingStatusMessage}
        maxlength={WORKSPACE_STATUS_MESSAGE_MAX_LENGTH}
        aria-label={m.workspace_sidebarHeader_status_ariaLabel()}
        class="text-xs text-foreground bg-none
               px-1.5 py-0.5 rounded
               outline-none w-full max-w-[240px] leading-normal
               resize-none overflow-hidden break-words whitespace-pre-wrap
               focus:ring-none! focus:outline-none!
               transition-all duration-150 disabled:opacity-50"
        placeholder={m.workspace_sidebarHeader_addStatus_placeholder()}
      ></textarea>
    {:else if workspace}
      <button
        class="text-xs text-subtle bg-transparent
               border-none px-1.5 py-0.5 rounded cursor-pointer text-left
               max-w-full overflow-hidden line-clamp-2 break-words whitespace-normal
               transition-all duration-150 leading-snug
               hover:text-foreground hover:opacity-80
               focus-visible:outline focus-visible:outline-1
               focus-visible:outline-primary/50 focus-visible:outline-offset-[-1px]
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

    <!-- repo -->
    <div class="text-subtle text-xs truncate pl-1.5 -mt-1">
      {#if workspace?.repositoryOwner && workspace?.repositoryName}
        {workspace.repositoryOwner}/{workspace.repositoryName}
      {:else if workspace?.repositoryPath}
        {workspace.repositoryPath.split('/').pop()}
      {/if}
    </div>

    <!-- branch -->
    <div class="flex items-center gap-1.5 text-subtle text-xs pl-1.5 -mt-1">
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
          placeholder={m.workspace_sidebarHeader_branchName_placeholder()}
          style="width: {Math.max(60, Math.min(150, (editedBranch || '').length * 6 + 20))}px"
        />
      {:else}
        <button
          class="text-xs text-subtle bg-transparent
                 border-none px-1 py-0.5 rounded cursor-pointer text-left
                 max-w-full overflow-hidden text-ellipsis whitespace-nowrap
                 transition-all duration-150 leading-normal
                 hover:text-foreground hover:opacity-80
                 focus-visible:outline focus-visible:outline-1
                 focus-visible:outline-primary/50 focus-visible:outline-offset-[-1px]
                 disabled:cursor-default disabled:opacity-50"
          onclick={startEditingBranch}
          title={m.workspace_sidebarHeader_editBranch_tooltip()}
          disabled={!workspace || isSavingBranch}
        >
          {#if workspace}
            {workspace.branch || m.workspace_sidebarHeader_noBranch_label()}
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
          additionalActions={microKeyAction ? [microKeyAction, sidebarSideAction] : [sidebarSideAction]}
        />
      </div>
    {/snippet}
  </DropdownMenu>
</div>
