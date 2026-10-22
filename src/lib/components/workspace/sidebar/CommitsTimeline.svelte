<script lang="ts">
  import { truncatedTitle } from '$lib/actions/observe-overflow';
  import { Input } from '$lib/components/ui/input';
  /**
   * CommitsTimeline - Commits section of the sidebar changes panel
   * Shows commit list, expand/collapse, inline edit, push/undo, context menu, older commits, base commit.
   */
  import { handleLink } from '$features/navigation/link-handler';
  import { getPanelLayoutManager } from '$features/layout/panel-layout-adapter';
  import { type CommitFile, type CommitInfo } from '$features/file-tracking/types';
  import {
    selectFileTrackingCommits as selectFtCommits,
    selectFileTrackingBoundarySha as selectFtBoundarySha,
    selectFileTrackingOlderCommits as selectFtOlderCommits,
    selectFileTrackingLoadingOlderCommits as selectFtLoadingOlderCommits,
  } from '$store/renderer/slices/changes/changes-selectors';
  import {
    clearOlderCommits as ftClearOlderCommits,
    refreshRequested,
    loadOlderCommitsRequested,
  } from '$store/renderer/slices/changes/changes-slice';
  import {
    gitReadRequested,
    releaseGitRead,
    openGitCommitFileRequested,
  } from '$store/renderer/slices/git/git-slice';
  import { gitWriteRequested } from '$store/renderer/slices/git/git-write-slice';
  import { prWorkflowRequested } from '$store/renderer/slices/pr-workflow/pr-workflow-slice';
  import { undoAcceptRequested } from '$store/renderer/slices/accept-workflow/accept-workflow-slice';
  import { selectAcceptOperationPending } from '$store/renderer/slices/accept-workflow/accept-workflow-selectors';
  import {
    selectPostMergeState,
    selectGitOperationFlags,
    selectGitCommitDetailsFiles,
  } from '$store/renderer/slices/git/git-selectors';

  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
  import { workspaceClient } from '$store/renderer/slices/workspace/utils/workspace.client';

  import FileRow from '$lib/components/file-tracking/accept-changes/FileRow.svelte';
  import type { UIFileChange } from '$lib/components/file-tracking/accept-changes/types';
  import LineChangesBadge from '$lib/components/shared/LineChangesBadge.svelte';
  import AgentAvatar from '$features/agent/components/agent-avatar/AgentAvatar.svelte';
  import { Button } from '$lib/components/ui/button';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import SidebarContextMenu from '$lib/components/ui/sidebar-context-menu/SidebarContextMenu.svelte';
  import {
    getSidebarContextPosition,
    type SidebarContextPosition,
    type SidebarMenuEntry,
  } from '$lib/components/ui/sidebar-context-menu/types';
  import { notify } from '$lib/components/patterns/notify';
  import { m } from '$shared/paraglide/messages.js';
  import { logger } from '$lib/utils/client-logger';
  import type { WorkspaceId } from '$shared/types/branded-ids';
  import {
    faArrowUpFromBracket,
    faArrowUpRightFromSquare,
    faChevronDown,
    faCloud,
    faCodeCommit,
    faFlag,
    faRotateLeft,
  } from '@fortawesome/free-solid-svg-icons';
  import { tick, onDestroy } from 'svelte';
  import { writable } from 'svelte/store';
  import Fa from 'svelte-fa';
  import { slide } from '$lib/motion';
  import TimelineSection from './TimelineSection.svelte';
  import { openWorkspaceCommitChangeset } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
  import {
    getPushTooltip as getPushTooltipUtil,
    getUndoTooltip as getUndoTooltipUtil,
    getUndoCommitTooltip as getUndoCommitTooltipUtil,
    canAmendCommit as canAmendCommitUtil,
  } from './sidebar-changes-utils';
  import { store as appStore } from '$store/renderer/store';

  interface Props {
    workspaceId: string;
    activeFilePath?: string | null;
    activeFileStaged?: boolean | null;
    pullRequestCount?: number;
    /** Owner-only controls (push / undo via `accept-changes.execute`, amend
     * via `system.executeCommand`) render only when true. */
    isOwner?: boolean;
    /** Independent scoped workspace.update gate for base fields only. */
    canUpdateBaseCommit?: boolean;
  }

  let {
    workspaceId,
    activeFilePath = null,
    activeFileStaged = null,
    pullRequestCount = 0,
    isOwner = true,
    canUpdateBaseCommit = isOwner,
  }: Props = $props();

  // Redux selectors at component init
  const workspaceIdStore = writable('');
  $effect(() => {
    workspaceIdStore.set(workspaceId);
  });

  const workspace = selectWorkspaceById(workspaceIdStore);
  const ftCommits$ = selectFtCommits(workspaceIdStore);
  const ftBoundarySha$ = selectFtBoundarySha(workspaceIdStore);
  const ftOlderCommits$ = selectFtOlderCommits(workspaceIdStore);
  const ftLoadingOlderCommits$ = selectFtLoadingOlderCommits(workspaceIdStore);
  const postMergeState$ = selectPostMergeState(workspaceIdStore);
  const gitOps$ = selectGitOperationFlags(workspaceIdStore);
  const commitFiles$ = selectGitCommitDetailsFiles(workspaceIdStore);
  const undoPending$ = selectAcceptOperationPending(workspaceIdStore, 'undo');

  // Derived state from Redux
  const allCommits = $derived($ftCommits$ ?? []);
  const commits = $derived((allCommits ?? []).filter((c) => !c.isPushed));
  const olderCommits = $derived($ftOlderCommits$ ?? []);
  const hasRemote = $derived($postMergeState$.hasRemote);
  const isPushing = $derived($gitOps$.isPushing);

  // Panel layout manager for opening files
  const panelLayoutManager = $derived(getPanelLayoutManager(workspaceId));

  // Local component state
  let expandedCommits = $state<Set<string>>(new Set());
  const readConsumerPrefix = `timeline:${crypto.randomUUID()}`;
  const readRequests = new Map<string, { workspaceId: string; requestId: string }>();
  function releaseCommitReads() {
    for (const [hash, request] of readRequests)
      appStore.dispatch(
        releaseGitRead(request.workspaceId, `${readConsumerPrefix}:${hash}`, request.requestId),
      );
    readRequests.clear();
  }
  onDestroy(releaseCommitReads);
  // svelte-ignore state_referenced_locally - intentional initial capture; the $effect below tracks later changes
  let cacheWorkspaceId = workspaceId;
  $effect(() => {
    if (workspaceId !== cacheWorkspaceId) {
      cacheWorkspaceId = workspaceId;
      releaseCommitReads();
      expandedCommits = new Set();
    }
  });

  function getCommitFiles(commit: CommitInfo): CommitFile[] {
    return commit.files ?? $commitFiles$[commit.hash] ?? [];
  }

  function fetchCommitFilesIfNeeded(commit: CommitInfo) {
    if (commit.files || $commitFiles$[commit.hash] !== undefined || !workspaceId) return;
    const previous = readRequests.get(commit.hash);
    if (previous)
      appStore.dispatch(
        releaseGitRead(
          previous.workspaceId,
          `${readConsumerPrefix}:${commit.hash}`,
          previous.requestId,
        ),
      );
    const requestId = crypto.randomUUID();
    readRequests.set(commit.hash, { workspaceId, requestId });
    appStore.dispatch(
      gitReadRequested(workspaceId, `${readConsumerPrefix}:${commit.hash}`, requestId, {
        kind: 'commitDetails',
        commitHash: commit.hash,
      }),
    );
  }
  let commitEdit = $state<{
    hash: string | null;
    value: string;
    inputRef: HTMLInputElement | null;
  }>({ hash: null, value: '', inputRef: null });
  let undoState = $state<{ commitHash: string | null; undoing: boolean; undoingCommit: boolean }>({
    commitHash: null,
    undoing: false,
    undoingCommit: false,
  });
  let commitContextMenu:
    (SidebarContextPosition & { commitHash: string; workspaceId: string }) | null = $state(null);

  $effect(() => {
    if (
      commitContextMenu &&
      (!canUpdateBaseCommit ||
        commitContextMenu.workspaceId !== workspaceId ||
        ![...allCommits, ...olderCommits].some(
          (commit) => commit.hash === commitContextMenu?.commitHash,
        ))
    ) {
      commitContextMenu = null;
    }
  });

  // Utility to persist workspace changes
  async function persistWorkspaceChanges(changes: Record<string, unknown>) {
    const result = await workspaceClient.update({ id: workspaceId as WorkspaceId, ...changes });
    if (result.ok) {
      appStore.dispatch(setWorkspaceEntity(result.data));
    }
    return result;
  }

  // Open a file in the panel
  function handleOpenFile(relativePath: string) {
    const fileName = relativePath.split('/').pop() || relativePath;
    panelLayoutManager.openTab({
      type: 'file',
      title: fileName,
      closable: true,
      filePath: relativePath,
      workspaceId,
    });
  }

  // Context menu handlers
  function handleCommitContextMenu(e: MouseEvent | KeyboardEvent, commitHash: string) {
    if (!canUpdateBaseCommit) return;
    const position = getSidebarContextPosition(e);
    if (!position) return;
    const row = e.currentTarget as HTMLElement;
    commitContextMenu = {
      ...position,
      returnFocus:
        e.target instanceof HTMLElement
          ? (e.target.closest('button') ?? row.querySelector('button'))
          : null,
      commitHash,
      workspaceId,
    };
  }

  function closeCommitContextMenu() {
    commitContextMenu = null;
  }

  function getCommitContextMenuItems(commitHash: string): SidebarMenuEntry[] {
    const isCurrentBase = $workspace?.baseCommitSha === commitHash;
    const items: SidebarMenuEntry[] = [
      {
        id: 'set-base-commit',
        label: isCurrentBase
          ? m.workspace_commitsTimeline_baseCommitCurrent_label()
          : m.workspace_commitsTimeline_setBaseCommit_label(),
        icon: faFlag,
        disabled: isCurrentBase,
        disabledReason: isCurrentBase
          ? m.workspace_commitsTimeline_baseCommitCurrent_label()
          : undefined,
        onClick: () => {
          handleSetBaseCommit(commitHash);
          closeCommitContextMenu();
        },
      },
    ];
    if ($workspace?.baseCommitSha) {
      items.push(
        { type: 'separator' as const },
        {
          id: 'clear-base-commit',
          label: m.workspace_commitsTimeline_resetBase_label(),
          icon: faRotateLeft,
          onClick: () => {
            handleClearBaseCommit();
            closeCommitContextMenu();
          },
        },
      );
    }
    return items;
  }

  async function handleSetBaseCommit(commitHash: string) {
    if (!canUpdateBaseCommit || !$workspace) return;
    try {
      const result = await persistWorkspaceChanges({ baseCommitSha: commitHash });
      if (result.ok) {
        appStore.dispatch(ftClearOlderCommits(workspaceId));
        appStore.dispatch(refreshRequested(workspaceId));
        notify.success(m.workspace_commitsTimeline_baseUpdated_label());
      } else {
        notify.error(m.workspace_commitsTimeline_baseUpdateFailed_error());
      }
    } catch (error) {
      logger.error('Failed to set base commit', error as Error);
      notify.error(m.workspace_commitsTimeline_baseUpdateFailed_error());
    }
  }

  async function handleClearBaseCommit() {
    if (!canUpdateBaseCommit || !$workspace) return;
    try {
      const result = await persistWorkspaceChanges({ baseCommitSha: '' });
      if (result.ok) {
        appStore.dispatch(ftClearOlderCommits(workspaceId));
        appStore.dispatch(refreshRequested(workspaceId));
        notify.success(m.workspace_commitsTimeline_baseReset_label());
      } else {
        notify.error(m.workspace_commitsTimeline_baseResetFailed_error());
      }
    } catch (error) {
      logger.error('Failed to clear base commit', error as Error);
      notify.error(m.workspace_commitsTimeline_baseResetFailed_error());
    }
  }

  // Commit editing handlers
  function canAmendCommit(index: number): boolean {
    return canAmendCommitUtil(allCommits, index);
  }

  async function startEditingCommit(commit: { hash: string; message: string }) {
    commitEdit.hash = commit.hash;
    commitEdit.value = commit.message;
    await tick();
    commitEdit.inputRef?.focus();
    commitEdit.inputRef?.select();
  }

  function saveCommitEdit() {
    const gitPath = $workspace?.worktreePath || $workspace?.repositoryPath;
    if (isOwner && commitEdit.hash && commitEdit.value.trim() && workspaceId && gitPath) {
      const trimmed = commitEdit.value.trim();
      const commit = allCommits.find((c) => c.hash === commitEdit.hash);
      if (commit && trimmed !== commit.message) {
        appStore.dispatch(
          gitWriteRequested(workspaceId, crypto.randomUUID(), {
            kind: 'amend',
            message: trimmed,
            cwd: gitPath,
            wasPushed: commit.isPushed,
            source: 'timeline',
          }),
        );
      }
    }
    cancelCommitEdit();
  }

  function cancelCommitEdit() {
    commitEdit.hash = null;
    commitEdit.value = '';
  }

  function handleCommitEditKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveCommitEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelCommitEdit();
    }
  }

  function handleCommitMessageDoubleClick(
    e: MouseEvent,
    commit: { hash: string; message: string },
    index: number,
  ) {
    if (isOwner && canAmendCommit(index)) {
      e.stopPropagation();
      e.preventDefault();
      startEditingCommit(commit);
    }
  }

  function toggleCommitExpanded(commit: CommitInfo) {
    const newSet = new Set(expandedCommits);
    if (newSet.has(commit.hash)) {
      newSet.delete(commit.hash);
    } else {
      newSet.add(commit.hash);
      fetchCommitFilesIfNeeded(commit);
    }
    expandedCommits = newSet;
  }

  function handleCommitFileClick(filePath: string, commitHash: string) {
    logger.info('[handleCommitFileClick] File clicked in commit', { filePath, commitHash });
    const commit =
      allCommits.find((c) => c.hash === commitHash) ??
      olderCommits.find((c) => c.hash === commitHash);
    if (commit && workspaceId) {
      const file = getCommitFiles(commit).find((f) => f.path === filePath);
      if (file) {
        appStore.dispatch(
          openGitCommitFileRequested(
            workspaceId,
            commitHash,
            filePath,
            file.additions,
            file.deletions,
          ),
        );
      }
    }
  }

  function handleOpenCommitChangeset(commitHash: string, commitMessage: string) {
    appStore.dispatch(openWorkspaceCommitChangeset(workspaceId, commitHash, commitMessage));
  }

  function openCommitInBrowser(hash: string, event?: MouseEvent) {
    const repoOwner = $workspace?.repositoryOwner;
    const repoName = $workspace?.repositoryName;
    let commitUrl: string | null = null;
    if (repoOwner && repoName) {
      commitUrl = `https://github.com/${repoOwner}/${repoName}/commit/${hash}`;
    }
    if (commitUrl) {
      handleLink(commitUrl, { workspaceId: workspaceId as WorkspaceId, event });
    }
  }

  // Push/undo tooltip helpers
  function getPushTooltip(commitIndex: number): string {
    return getPushTooltipUtil(allCommits, commitIndex, pullRequestCount > 0, $workspace?.branch);
  }
  function getUndoTooltip(commitIndex: number): string {
    return getUndoTooltipUtil(allCommits, commitIndex, $workspace?.branch);
  }
  function getUndoCommitTooltip(commitIndex: number): string {
    return getUndoCommitTooltipUtil(allCommits, commitIndex);
  }

  function handlePushCommits(commitIndex: number) {
    if (!workspaceId || !isOwner) return;
    const commit = allCommits[commitIndex];
    undoState.commitHash = commit.hash;
    appStore.dispatch(
      prWorkflowRequested(workspaceId, {
        kind: 'push',
        targetBranch: $workspace?.branch,
        upToCommitHash: commit.hash,
      }),
    );
  }

  function handleUndoPush(commitIndex: number) {
    if (!workspaceId || !isOwner) return;
    undoState.commitHash = allCommits[commitIndex].hash;
    appStore.dispatch(
      undoAcceptRequested(workspaceId, {
        action: 'undo-push',
        commitHash: allCommits[commitIndex].hash,
      }),
    );
  }

  function handleUndoCommit(commitIndex: number) {
    if (!workspaceId || !isOwner) return;
    undoState.commitHash = allCommits[commitIndex].hash;
    appStore.dispatch(
      undoAcceptRequested(workspaceId, {
        action: 'undo-commit',
        commitHash: allCommits[commitIndex].hash,
      }),
    );
  }
</script>

<!-- COMMITS SECTION -->
<TimelineSection
  title={m.workspace_commitsTimeline_commits_label()}
  active={allCommits.length > 0}
  activeColor="bg-blue-500"
>
  {#if allCommits.length > 0}
    <div class="space-y-0.5">
      {#each allCommits as commit, index (commit.hash)}
        <!-- Divider between local and pushed commits (only when remote exists) -->
        {#if hasRemote && commit.isPushed && index > 0 && !allCommits[index - 1].isPushed && commits.length > 0}
          <div class="flex items-center gap-2 px-1 py-1.5">
            <div class="flex-1 h-px bg-border"></div>
            <span class="text-xs text-subtle"
              >{m.workspace_commitsTimeline_pushedToRemote_label()}</span
            >
            <div class="flex-1 h-px bg-border"></div>
          </div>
        {/if}
        {@const isOperatingOnThis =
          undoState.commitHash === commit.hash && (isPushing || $undoPending$)}
        {@const isExpanded = expandedCommits.has(commit.hash)}
        {@const commitFiles = getCommitFiles(commit)}
        {@const files = commitFiles.map((f) => ({
          path: f.path,
          additions: f.additions,
          deletions: f.deletions,
          staged: false,
        })) as UIFileChange[]}
        <div>
          <!-- Commit header -->
          <div
            role="group"
            class="relative flex items-center gap-2 py-0.5 group w-full rounded px-1 -mx-1"
            oncontextmenu={(e) => handleCommitContextMenu(e, commit.hash)}
            onkeydown={(e) => handleCommitContextMenu(e, commit.hash)}
          >
            <Button
              variant="ghost-light"
              size="icon-xs"
              class="absolute left-0.75 bg-sidebar {commit.agentId
                ? 'opacity-0 group-hover:opacity-100'
                : 'opacity-0 group-hover:opacity-100'} hover:text-foreground! -ml-1"
              onclick={(e: MouseEvent) => {
                e.stopPropagation();
                toggleCommitExpanded(commit);
              }}
              title={m.workspace_prSection_toggleFileList_tooltip()}
            >
              <Fa
                icon={faChevronDown}
                size={12}
                class="text-subtle shrink-0 transition-transform {isExpanded
                  ? 'rotate-0'
                  : 'rotate-90'}"
              />
              {#if commitFiles.length > 0}
                <LineChangesBadge
                  additions={commitFiles.reduce((sum, f) => sum + (f.additions || 0), 0)}
                  deletions={commitFiles.reduce((sum, f) => sum + (f.deletions || 0), 0)}
                  size="xs"
                />
              {/if}
            </Button>

            <!-- Show auggie avatar instead of commit icon when made by an agent - hides on hover to show chevron -->
            {#if commit.agentId}
              <span class="shrink-0 group-hover:opacity-0 transition-opacity pointer-events-none">
                <AgentAvatar agentId={commit.agentId} size={14} class="mr-[-2px]" />
              </span>
            {:else}
              <Fa icon={faCodeCommit} size="xs" class="text-ghost shrink-0" />
            {/if}
            <div class="relative flex min-w-0 flex-1 items-center">
              {#if commitEdit.hash === commit.hash}
                <!-- Inline edit mode for commit message -->
                <Input
                  bind:ref={commitEdit.inputRef}
                  type="text"
                  bind:value={commitEdit.value}
                  onblur={saveCommitEdit}
                  onkeydown={handleCommitEditKeydown}
                  noFocusStyle
                  class="inline-edit-input relative z-10 min-w-0 flex-1 border-none bg-transparent hover:bg-transparent text-ui text-subtle outline-none! ring-0! focus:outline-none! focus:ring-0! focus-visible:outline-none! focus-visible:ring-0!"
                  onclick={(e) => e.stopPropagation()}
                />
              {:else}
                <Button
                  variant="ghost"
                  type="button"
                  class="relative z-10 flex min-w-0 flex-1 cursor-text items-center gap-2 text-left {commit.isPushed &&
                  !commit.agentId
                    ? 'pr-5'
                    : ''}"
                  onclick={() => handleOpenCommitChangeset(commit.hash, commit.message)}
                  ondblclick={(e) => handleCommitMessageDoubleClick(e, commit, index)}
                >
                  <span
                    class="flex-1 truncate text-ui text-subtle {canAmendCommit(index) ? '' : ''}"
                    use:truncatedTitle={commit.message}
                  >
                    {commit.message}
                  </span>
                </Button>
              {/if}
              <span
                aria-hidden="true"
                class="pointer-events-none absolute z-0 rounded-(--radius-small) border transition-[inset,border-color,background-color] duration-(--motion-standard) ease-(--ease-standard) motion-reduce:transition-none {commitEdit.hash ===
                commit.hash
                  ? '-inset-x-2 -inset-y-1.5 border-ring/60 bg-sidebar'
                  : '-inset-x-1 -inset-y-0.5 border-transparent bg-transparent'}"
              ></span>
            </div>

            <!-- Right side: Cloud icon for pushed commits (fades on hover, only when remote exists) -->
            {#if hasRemote && commit.isPushed && !commit.agentId}
              <span class="absolute right-0 shrink-0 group-hover:opacity-0 transition-opacity">
                <Fa icon={faCloud} class="text-ghost p-0.5" size={15} />
              </span>
            {/if}

            <div
              class="absolute -right-1 pl-1 bg-sidebar flex items-center {isOperatingOnThis
                ? ''
                : 'opacity-0 group-hover:opacity-100'} transition-opacity"
            >
              {#if hasRemote && commit.isPushed}
                <!-- External link button to open commit in browser (only for pushed commits) -->
                <Button
                  variant="ghost-light"
                  size="icon-xs"
                  class="{!isOperatingOnThis &&
                    'opacity-0!'} group-hover:opacity-100! transition-opacity shrink-0"
                  onclick={(e: MouseEvent) => openCommitInBrowser(commit.hash, e)}
                  tooltip={m.workspace_sidebar_openInBrowser_tooltip()}
                  tooltipSide="top"
                >
                  <Fa icon={faArrowUpRightFromSquare} size="xs" class="text-subtle" />
                </Button>
                <!-- Undo push button - absolutely positioned to overlap cloud icon
                     (accept-changes.execute, owner-only) -->
                {#if isOwner}
                  <div
                    class="{!isOperatingOnThis &&
                      'opacity-0'} group-hover:opacity-100 transition-opacity"
                  >
                    <Button
                      variant="ghost-light"
                      size="icon-xs"
                      data-testid="commit-undo-push-button"
                      onclick={() => handleUndoPush(index)}
                      disabled={isPushing || $undoPending$}
                      tooltip={getUndoTooltip(index)}
                      tooltipSide="top"
                    >
                      {#if isOperatingOnThis && $undoPending$}
                        <IntentMarkLoader size={12} class="text-subtle" />
                      {:else}
                        <Fa icon={faRotateLeft} size="xs" class="text-ghost" />
                      {/if}
                    </Button>
                  </div>
                {/if}
              {:else if isOwner}
                <!-- Undo commit button for unpushed commits (accept-changes.execute, owner-only) -->
                <Button
                  variant="ghost-light"
                  size="icon-xs"
                  class="{!isOperatingOnThis &&
                    'opacity-0!'} group-hover:opacity-100! transition-opacity shrink-0"
                  data-testid="commit-undo-button"
                  onclick={() => handleUndoCommit(index)}
                  disabled={isPushing || $undoPending$}
                  tooltip={getUndoCommitTooltip(index)}
                  tooltipSide="top"
                >
                  {#if isOperatingOnThis && $undoPending$}
                    <IntentMarkLoader size={12} class="text-subtle" />
                  {:else}
                    <Fa icon={faRotateLeft} size="xs" class="text-ghost" />
                  {/if}
                </Button>
                <!-- Push button for unpushed commits (only when remote exists) -->
                {#if hasRemote}
                  <Button
                    variant="ghost-light"
                    size="icon-xs"
                    class="{!isOperatingOnThis &&
                      'opacity-0!'} group-hover:opacity-100! transition-opacity shrink-0"
                    data-testid="commit-push-button"
                    onclick={() => handlePushCommits(index)}
                    disabled={isPushing || $undoPending$}
                    tooltip={getPushTooltip(index)}
                    tooltipSide="top"
                  >
                    {#if isOperatingOnThis && isPushing}
                      <IntentMarkLoader size={12} class="text-subtle" />
                    {:else}
                      <Fa icon={faArrowUpFromBracket} size="xs" class="text-subtle" />
                    {/if}
                  </Button>
                {/if}
              {/if}
            </div>
          </div>

          <!-- Expanded panel content -->
          {#if isExpanded}
            <div
              class="pl-5 pr-1.5 pb-0.5 pt-0.5 space-y-px"
              transition:slide={{ tier: 'moderate' }}
            >
              <!-- Files list -->
              {#each files as file (file.path)}
                <FileRow
                  contextKey={`${workspaceId}:${commit.hash}`}
                  {file}
                  muted={true}
                  active={activeFilePath === file.path && activeFileStaged === null}
                  onFileClick={(filePath) => handleCommitFileClick(filePath, commit.hash)}
                  onOpenFile={handleOpenFile}
                />
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  <!-- Workspace start boundary marker + show previous toggle -->
  {#if $ftBoundarySha$}
    <Button
      variant="ghost"
      size="compact"
      wrapContent={false}
      class="group/boundary relative h-auto min-h-8 w-full justify-start gap-2 px-1 py-2 {allCommits.length >
      0
        ? 'mt-2'
        : ''}"
      disabled={$ftLoadingOlderCommits$}
      aria-expanded={olderCommits.length > 0}
      aria-busy={$ftLoadingOlderCommits$}
      onclick={() => {
        if (olderCommits.length > 0) {
          appStore.dispatch(ftClearOlderCommits(workspaceId));
        } else {
          appStore.dispatch(loadOlderCommitsRequested(workspaceId, $ftBoundarySha$));
        }
      }}
    >
      <span
        class="relative flex shrink-0 items-center gap-1.5 text-ui text-subtle select-none"
        data-commit-boundary-label
      >
        {m.workspace_commitsTimeline_workspaceStart_label()}
        {#if $ftLoadingOlderCommits$}
          <IntentMarkLoader size={12} class="opacity-50" />
        {:else}
          <Fa
            icon={faChevronDown}
            size="xs"
            class="opacity-50 transition-transform {olderCommits.length > 0 ? '' : 'rotate-90'}"
          />
        {/if}
      </span>
      <span
        class="relative h-px min-w-0 flex-1 bg-border"
        aria-hidden="true"
        data-commit-boundary-divider
      ></span>
    </Button>
  {/if}

  <!-- Older commits (dimmed, below boundary) -->
  {#if olderCommits.length > 0}
    <div class="space-y-0.5 text-muted-foreground">
      {#each olderCommits as commit (commit.hash)}
        {@const isExpanded = expandedCommits.has(commit.hash)}
        {@const commitFiles = getCommitFiles(commit)}
        {@const files = commitFiles.map((f) => ({
          path: f.path,
          additions: f.additions,
          deletions: f.deletions,
          staged: false,
        })) as UIFileChange[]}
        <div>
          <div
            role="group"
            class="relative flex items-center gap-2 py-0.5 group w-full rounded px-1 -mx-1"
            oncontextmenu={(e) => handleCommitContextMenu(e, commit.hash)}
            onkeydown={(e) => handleCommitContextMenu(e, commit.hash)}
          >
            <Button
              variant="ghost-light"
              size="icon-xs"
              class="absolute left-0.75 bg-sidebar opacity-0 group-hover:opacity-100 hover:text-foreground! -ml-1"
              onclick={(e: MouseEvent) => {
                e.stopPropagation();
                toggleCommitExpanded(commit);
              }}
              title={m.workspace_prSection_toggleFileList_tooltip()}
            >
              <Fa
                icon={faChevronDown}
                size={12}
                class="text-subtle shrink-0 transition-transform {isExpanded
                  ? 'rotate-0'
                  : 'rotate-90'}"
              />
              {#if commitFiles.length > 0}
                <LineChangesBadge
                  additions={commitFiles.reduce((sum, f) => sum + (f.additions || 0), 0)}
                  deletions={commitFiles.reduce((sum, f) => sum + (f.deletions || 0), 0)}
                  size="xs"
                />
              {/if}
            </Button>

            <Fa icon={faCodeCommit} size="xs" class="text-ghost shrink-0" />
            <Button
              variant="ghost"
              type="button"
              class="flex items-center gap-2 flex-1 min-w-0 text-left cursor-pointer"
              onclick={() => handleOpenCommitChangeset(commit.hash, commit.message)}
            >
              <span class="text-ui text-subtle truncate flex-1" use:truncatedTitle={commit.message}>
                {commit.message}
              </span>
            </Button>
          </div>

          {#if isExpanded}
            <div
              class="pl-5 pr-1.5 pb-0.5 pt-0.5 space-y-px"
              transition:slide={{ tier: 'moderate' }}
            >
              {#each files as file (file.path)}
                <FileRow
                  contextKey={`${workspaceId}:${commit.hash}`}
                  {file}
                  muted={true}
                  active={activeFilePath === file.path && activeFileStaged === null}
                  onFileClick={(filePath) => handleCommitFileClick(filePath, commit.hash)}
                  onOpenFile={handleOpenFile}
                />
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  <!-- Load more previous commits -->
  {#if olderCommits.length > 0}
    <Button
      variant="ghost"
      class="w-full text-ui text-ghost hover:text-muted-foreground py-1 transition-colors cursor-pointer"
      disabled={$ftLoadingOlderCommits$}
      onclick={() => {
        const lastOlder = olderCommits[olderCommits.length - 1];
        if (lastOlder) appStore.dispatch(loadOlderCommitsRequested(workspaceId, lastOlder.hash));
      }}
    >
      {#if $ftLoadingOlderCommits$}
        <IntentMarkLoader size={12} class="mr-1" />
      {/if}
      {m.workspace_commitsTimeline_showMorePrevious_label()}
    </Button>
  {/if}
</TimelineSection>

{#if commitContextMenu}
  <SidebarContextMenu
    x={commitContextMenu?.x ?? 0}
    y={commitContextMenu?.y ?? 0}
    returnFocus={commitContextMenu?.returnFocus}
    ariaLabel={commitContextMenu?.commitHash.slice(0, 7)}
    items={commitContextMenu ? getCommitContextMenuItems(commitContextMenu.commitHash) : []}
    onClickOutside={closeCommitContextMenu}
  />
{/if}

<style>
  input.inline-edit-input::selection {
    background: hsl(var(--ring) / 0.3);
  }
</style>
