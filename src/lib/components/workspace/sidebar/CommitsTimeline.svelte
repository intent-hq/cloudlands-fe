<script lang="ts">
  /**
   * CommitsTimeline - Commits section of the sidebar changes panel
   * Shows commit list, expand/collapse, inline edit, push/undo, context menu, older commits, base commit.
   */
  import type { UndoCommitMetadata } from '$features/accept-changes/types';
  import { handleLink } from '$features/navigation/link-handler';
  import { getPanelLayoutManager } from '$features/layout/panel-layout-adapter';
  import {
    ChangeStage,
    type CommitFile,
    type CommitInfo,
    type TrackedChange,
  } from '$features/file-tracking/types';
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
    loadCommitDetails,
    amendCommitMessageRequested,
    executeAcceptChangesRequested,
    readGitFileRequested,
  } from '$store/renderer/slices/git/git-slice';
  import {
    selectCommitDetailsEntries,
    selectGitFileRead,
    selectGitMutationRequest,
    selectPostMergeState,
    selectGitOperationFlags,
  } from '$store/renderer/slices/git/git-selectors';

  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
  import { updateWorkspaceRequested } from '$store/renderer/slices/workspace/workspace-slice';
  import { createTerminalWithCommandRequested } from '$store/renderer/slices/terminals/terminals-slice';

  import FileRow from '$lib/components/file-tracking/accept-changes/FileRow.svelte';
  import type { UIFileChange } from '$lib/components/file-tracking/accept-changes/types';
  import LineChangesBadge from '$lib/components/shared/LineChangesBadge.svelte';
  import AgentAvatar from '$features/agent/components/agent-avatar/AgentAvatar.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import SidebarContextMenu from '$lib/components/ui/sidebar-context-menu/SidebarContextMenu.svelte';
  import type { SidebarMenuEntry } from '$lib/components/ui/sidebar-context-menu/types';
  import { toast } from '$lib/components/ui/toast';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
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
  import { tick } from 'svelte';
  import { readable, writable } from 'svelte/store';
  import Fa from 'svelte-fa';
  import { slide } from '$lib/motion';
  import TimelineSection from './TimelineSection.svelte';
  import {
    openWorkspaceCommitChangeset,
    openWorkspaceDiff,
  } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
  import {
    getCommitsToUndoCount,
    getLocalCommitsToUndoCount,
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
  }

  let {
    workspaceId,
    activeFilePath = null,
    activeFileStaged = null,
    pullRequestCount = 0,
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
  const commitDetailsEntries$ = selectCommitDetailsEntries(workspaceIdStore);
  const commitFilePathStore = writable('');
  const commitNewRefStore = writable('');
  const commitOldRefStore = writable('');
  const commitNewFileRead$ = selectGitFileRead(
    workspaceIdStore,
    commitFilePathStore,
    commitNewRefStore,
  );
  const commitOldFileRead$ = selectGitFileRead(
    workspaceIdStore,
    commitFilePathStore,
    commitOldRefStore,
  );
  const amendRequest$ = selectGitMutationRequest(workspaceIdStore, readable('amend-commit'));
  const undoCommitRequest$ = selectGitMutationRequest(
    workspaceIdStore,
    readable('accept-changes'),
    readable('undo-commit'),
  );
  const pushRequest$ = selectGitMutationRequest(
    workspaceIdStore,
    readable('accept-changes'),
    readable('push'),
  );
  const undoPushRequest$ = selectGitMutationRequest(
    workspaceIdStore,
    readable('accept-changes'),
    readable('undo-push'),
  );

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
  // The commit list is metadata-only (PROTOCOL §5.19); the saga-owned
  // commit-detail collection supplies lazily fetched per-file data.
  // svelte-ignore state_referenced_locally - intentional initial capture; the $effect below tracks later changes
  let cacheWorkspaceId = workspaceId;
  $effect(() => {
    if (workspaceId !== cacheWorkspaceId) {
      cacheWorkspaceId = workspaceId;
      expandedCommits = new Set();
    }
  });

  function getCommitFiles(commit: CommitInfo): CommitFile[] {
    return (
      commit.files ??
      $commitDetailsEntries$.find((entry) => entry.commitHash === commit.hash)?.data?.files ??
      []
    );
  }

  function fetchCommitFilesIfNeeded(commit: CommitInfo) {
    const entry = $commitDetailsEntries$.find((candidate) => candidate.commitHash === commit.hash);
    if (commit.files || entry?.loading || entry?.data || !workspaceId) return;
    appStore.dispatch(loadCommitDetails(workspaceId, commit.hash));
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
  let pendingAmendVersion = 0;
  let pendingAmendWasPushed = false;
  let pendingUndoCommitVersion = 0;
  let pendingUndoCommitCount = 0;
  let pendingPushVersion = 0;
  let pendingUndoPushVersion = 0;
  let pendingUndoPushCount = 0;
  let pendingCommitFile: { filePath: string; commitHash: string; file: CommitFile } | null =
    $state(null);
  let pendingUndoCommit: {
    commitsToUndo: CommitInfo[];
    resetToHash: string;
    commitCount: number;
  } | null = $state(null);
  let commitContextMenu: { x: number; y: number; commitHash: string } | null = $state(null);

  $effect(() => {
    const request = $amendRequest$;
    if (!request || request.loading || request.version !== pendingAmendVersion) return;
    pendingAmendVersion = 0;
    if (request.error || !request.data || !('success' in request.data) || !request.data.success) {
      toast.error(m.workspace_commitsTimeline_messageUpdateFailed_error());
      return;
    }
    toast.success(
      pendingAmendWasPushed
        ? m.workspace_commitsTimeline_messageUpdatedPushed_label()
        : m.workspace_commitsTimeline_messageUpdated_label(),
    );
  });

  $effect(() => {
    const pending = pendingCommitFile;
    const newRead = $commitNewFileRead$;
    const oldRead = $commitOldFileRead$;
    if (!pending || !newRead || !oldRead || newRead.loading || oldRead.loading) return;
    if (newRead.error || oldRead.error || newRead.data === null || oldRead.data === null) {
      logger.error('Failed to load commit diff', {
        filePath: pending.filePath,
        commitHash: pending.commitHash,
        error: newRead.error ?? oldRead.error,
      });
      pendingCommitFile = null;
      return;
    }
    const change: TrackedChange = {
      id: `commit-${pending.commitHash}-${pending.filePath}`,
      file: pending.filePath,
      relativePath: pending.filePath,
      status: 'modified',
      stage: ChangeStage.Committed,
      commitHash: pending.commitHash,
      stats: {
        additions: pending.file.additions || 0,
        deletions: pending.file.deletions || 0,
      },
      content: { oldContent: oldRead.data, newContent: newRead.data, diff: '' },
      attribution: { timestamp: Date.now() },
    };
    pendingCommitFile = null;
    appStore.dispatch(
      openWorkspaceDiff(workspaceId, change, {
        changeId: change.id,
        filePath: change.file,
      }),
    );
  });

  $effect(() => {
    const pending = pendingUndoCommit;
    if (!pending) return;
    const entries = pending.commitsToUndo.map((commit) => ({
      commit,
      entry: commit.files
        ? undefined
        : $commitDetailsEntries$.find((candidate) => candidate.commitHash === commit.hash),
    }));
    if (entries.some(({ entry }) => entry?.loading || (!entry?.data && !entry?.error))) return;
    const undoCommitsMetadata: UndoCommitMetadata[] = entries.map(({ commit, entry }) => ({
      hash: commit.hash,
      agentId: commit.agentId,
      linkedNoteId: commit.linkedNoteId,
      files: (commit.files ?? entry?.data?.files ?? []).map((file) => file.path),
    }));
    pendingUndoCommitVersion =
      (selectGitMutationRequest.select(appStore.state, workspaceId, 'accept-changes', 'undo-commit')
        ?.version ?? 0) + 1;
    pendingUndoCommitCount = pending.commitCount;
    pendingUndoCommit = null;
    appStore.dispatch(
      executeAcceptChangesRequested(workspaceId, 'undo-commit', {
        upToCommitHash: pending.resetToHash,
        undoCommitsMetadata,
      }),
    );
  });

  $effect(() => {
    const request = $undoCommitRequest$;
    if (!request || request.loading || request.version !== pendingUndoCommitVersion) return;
    pendingUndoCommitVersion = 0;
    undoState.undoingCommit = false;
    undoState.commitHash = null;
    if (request.error || !request.data || !('success' in request.data) || !request.data.success) {
      toast.error(m.workspace_commitsTimeline_undoCommitFailed_error());
      return;
    }
    toast.warning(
      pendingUndoCommitCount === 1
        ? m.workspace_commitsTimeline_commitsUndone_one()
        : m.workspace_commitsTimeline_commitsUndone_many({
            count: formatInteger(pendingUndoCommitCount),
          }),
    );
  });

  $effect(() => {
    const request = $pushRequest$;
    if (!request || request.loading || request.version !== pendingPushVersion) return;
    pendingPushVersion = 0;
    undoState.commitHash = null;
    if (!request.error && request.data && 'success' in request.data && request.data.success) return;
    const error =
      request.error ||
      (request.data && 'error' in request.data ? request.data.error : undefined) ||
      m.workspace_prSection_pushFailed_error();
    // i18n-ignore (matching backend error strings)
    if (error.includes('Pull the latest changes') || error.includes('behind')) {
      toast.error(m.workspace_commitsTimeline_remoteHasNewCommits_error(), {
        description: m.workspace_commitsTimeline_pullBeforePush_description(),
        action: {
          label: m.workspace_commitsTimeline_pullInTerminal_label(),
          onClick: openPullTerminal,
        },
        duration: 10000,
      });
    } else {
      toast.error(error);
    }
  });

  $effect(() => {
    const request = $undoPushRequest$;
    if (!request || request.loading || request.version !== pendingUndoPushVersion) return;
    pendingUndoPushVersion = 0;
    undoState.undoing = false;
    undoState.commitHash = null;
    if (request.error || !request.data || !('success' in request.data) || !request.data.success) {
      toast.error(
        request.error ||
          (request.data && 'error' in request.data ? request.data.error : undefined) ||
          m.workspace_commitsTimeline_undoPushFailed_error(),
      );
      return;
    }
    toast.warning(
      pendingUndoPushCount === 1
        ? m.workspace_commitsTimeline_removedFromRemote_one()
        : m.workspace_commitsTimeline_removedFromRemote_many({
            count: formatInteger(pendingUndoPushCount),
          }),
    );
  });

  // Utility to persist workspace changes
  function persistWorkspaceChanges(changes: Record<string, unknown>) {
    appStore.dispatch(updateWorkspaceRequested(workspaceId, changes));
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
  function handleCommitContextMenu(e: MouseEvent, commitHash: string) {
    e.preventDefault();
    e.stopPropagation();
    commitContextMenu = { x: e.clientX, y: e.clientY, commitHash };
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

  function handleSetBaseCommit(commitHash: string) {
    if (!$workspace) return;
    persistWorkspaceChanges({ baseCommitSha: commitHash });
    appStore.dispatch(ftClearOlderCommits(workspaceId));
    appStore.dispatch(refreshRequested(workspaceId));
    toast.success(m.workspace_commitsTimeline_baseUpdated_label());
  }

  function handleClearBaseCommit() {
    if (!$workspace) return;
    persistWorkspaceChanges({ baseCommitSha: '' });
    appStore.dispatch(ftClearOlderCommits(workspaceId));
    appStore.dispatch(refreshRequested(workspaceId));
    toast.success(m.workspace_commitsTimeline_baseReset_label());
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
    if (commitEdit.hash && commitEdit.value.trim() && workspaceId && gitPath) {
      const trimmed = commitEdit.value.trim();
      const commit = allCommits.find((c) => c.hash === commitEdit.hash);
      if (commit && trimmed !== commit.message) {
        const wasPushed = Boolean(commit.isPushed);
        pendingAmendVersion =
          (selectGitMutationRequest.select(appStore.state, workspaceId, 'amend-commit')?.version ??
            0) + 1;
        pendingAmendWasPushed = wasPushed;
        appStore.dispatch(amendCommitMessageRequested(workspaceId, gitPath, trimmed, wasPushed));
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
    if (canAmendCommit(index)) {
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
        pendingCommitFile = { filePath, commitHash, file };
        commitFilePathStore.set(filePath);
        commitNewRefStore.set(commitHash);
        commitOldRefStore.set(`${commitHash}^`);
        appStore.dispatch(readGitFileRequested(workspaceId, filePath, commitHash));
        appStore.dispatch(readGitFileRequested(workspaceId, filePath, `${commitHash}^`));
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
  function getCommitsToUndoCount_(commitIndex: number): number {
    return getCommitsToUndoCount(allCommits, commitIndex);
  }
  function getPushTooltip(commitIndex: number): string {
    return getPushTooltipUtil(allCommits, commitIndex, pullRequestCount > 0, $workspace?.branch);
  }
  function getUndoTooltip(commitIndex: number): string {
    return getUndoTooltipUtil(allCommits, commitIndex, $workspace?.branch);
  }
  function getLocalCommitsToUndoCount_(commitIndex: number): number {
    return getLocalCommitsToUndoCount(allCommits, commitIndex);
  }
  function getUndoCommitTooltip(commitIndex: number): string {
    return getUndoCommitTooltipUtil(allCommits, commitIndex);
  }

  function openPullTerminal() {
    if (!workspaceId) return;
    const worktreePath = $workspace?.worktreePath || $workspace?.repositoryPath;
    if (!worktreePath) {
      toast.error(m.workspace_commitsTimeline_noSpacePath_error());
      return;
    }
    const remoteBranch = $workspace?.branch || 'HEAD';
    const pullCommand = `git pull --rebase origin ${remoteBranch}`;
    const terminalTitle = m.workspace_commitsTimeline_pullFromOrigin_label({
      branch: remoteBranch,
    });
    appStore.dispatch(
      createTerminalWithCommandRequested(workspaceId, pullCommand, worktreePath, terminalTitle),
    );
    toast.success(m.workspace_commitsTimeline_pullStarted_label(), {
      description: m.workspace_commitsTimeline_pullStarted_description(),
      action: {
        label: m.workspace_commitsTimeline_refresh_label(),
        onClick: async () => {
          appStore.dispatch(refreshRequested(workspaceId, true));
          toast.success(m.workspace_commitsTimeline_statusRefreshed_label());
        },
      },
      duration: 30000,
    });
  }

  function handlePushCommits(commitIndex: number) {
    if (!workspaceId) return;
    const commit = allCommits[commitIndex];
    undoState.commitHash = commit.hash;
    pendingPushVersion =
      (selectGitMutationRequest.select(appStore.state, workspaceId, 'accept-changes', 'push')
        ?.version ?? 0) + 1;
    appStore.dispatch(
      executeAcceptChangesRequested(workspaceId, 'push', {
        targetBranch: $workspace?.branch,
        upToCommitHash: commit.hash,
      }),
    );
  }

  function handleUndoPush(commitIndex: number) {
    if (!workspaceId) return;
    const commit = allCommits[commitIndex];
    const commitCount = getCommitsToUndoCount_(commitIndex);
    const nextCommitIndex = commitIndex + 1;
    let resetToHash: string;
    if (nextCommitIndex < allCommits.length) {
      resetToHash = allCommits[nextCommitIndex].hash;
    } else {
      if ($workspace?.baseCommitSha) {
        resetToHash = $workspace.baseCommitSha;
      } else {
        toast.error(m.workspace_commitsTimeline_cannotUndo_error());
        return;
      }
    }
    undoState.commitHash = commit.hash;
    undoState.undoing = true;
    pendingUndoPushVersion =
      (selectGitMutationRequest.select(appStore.state, workspaceId, 'accept-changes', 'undo-push')
        ?.version ?? 0) + 1;
    pendingUndoPushCount = commitCount;
    appStore.dispatch(
      executeAcceptChangesRequested(workspaceId, 'undo-push', { upToCommitHash: resetToHash }),
    );
  }

  function handleUndoCommit(commitIndex: number) {
    if (!workspaceId) return;
    const commit = allCommits[commitIndex];
    const commitCount = getLocalCommitsToUndoCount_(commitIndex);
    const nextCommitIndex = commitIndex + 1;
    let resetToHash: string;
    if (nextCommitIndex < allCommits.length) {
      resetToHash = allCommits[nextCommitIndex].hash;
    } else {
      if ($workspace?.baseCommitSha) {
        resetToHash = $workspace.baseCommitSha;
      } else {
        toast.error(m.workspace_commitsTimeline_cannotUndo_error());
        return;
      }
    }
    undoState.commitHash = commit.hash;
    undoState.undoingCommit = true;
    // The commit list is metadata-only, so resolve the touched file paths
    // (attribution restore inputs) via git.commitDetails at undo time — a
    // bounded fetch over just the commits being undone.
    const commitsToUndo = allCommits.slice(0, commitIndex + 1).filter((c) => !c.isPushed);
    for (const commitToUndo of commitsToUndo) fetchCommitFilesIfNeeded(commitToUndo);
    pendingUndoCommit = { commitsToUndo, resetToHash, commitCount };
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
        {@const isOperatingOnThis = undoState.commitHash === commit.hash}
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
            class="relative flex items-center gap-2 py-0.5 group w-full rounded px-1 -mx-1"
            oncontextmenu={(e) => handleCommitContextMenu(e, commit.hash)}
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
                  class="inline-edit-input relative z-10 min-w-0 flex-1 border-none bg-transparent text-ui text-subtle outline-none! ring-0! focus:outline-none! focus:ring-0! focus-visible:outline-none! focus-visible:ring-0!"
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
                    title={commit.message}
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
                <!-- Undo push button - absolutely positioned to overlap cloud icon -->
                <div
                  class="{!isOperatingOnThis &&
                    'opacity-0'} group-hover:opacity-100 transition-opacity"
                >
                  <Button
                    variant="ghost-light"
                    size="icon-xs"
                    onclick={() => handleUndoPush(index)}
                    disabled={isPushing || undoState.undoing}
                    tooltip={getUndoTooltip(index)}
                    tooltipSide="top"
                  >
                    {#if isOperatingOnThis && undoState.undoing}
                      <IntentMarkLoader size={12} class="text-subtle" />
                    {:else}
                      <Fa icon={faRotateLeft} size="xs" class="text-ghost" />
                    {/if}
                  </Button>
                </div>
              {:else}
                <!-- Undo commit button for unpushed commits -->
                <Button
                  variant="ghost-light"
                  size="icon-xs"
                  class="{!isOperatingOnThis &&
                    'opacity-0!'} group-hover:opacity-100! transition-opacity shrink-0"
                  onclick={() => handleUndoCommit(index)}
                  disabled={isPushing || undoState.undoing || undoState.undoingCommit}
                  tooltip={getUndoCommitTooltip(index)}
                  tooltipSide="top"
                >
                  {#if isOperatingOnThis && undoState.undoingCommit}
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
                    onclick={() => handlePushCommits(index)}
                    disabled={isPushing || undoState.undoing || undoState.undoingCommit}
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
    <div class="space-y-0.5 opacity-60 hover:opacity-100 transition-opacity">
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
            class="relative flex items-center gap-2 py-0.5 group w-full rounded px-1 -mx-1"
            oncontextmenu={(e) => handleCommitContextMenu(e, commit.hash)}
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
              <span class="text-ui text-subtle truncate flex-1" title={commit.message}>
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
      variant="plain"
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
    x={commitContextMenu.x}
    y={commitContextMenu.y}
    items={getCommitContextMenuItems(commitContextMenu.commitHash)}
    onClickOutside={closeCommitContextMenu}
  />
{/if}

<style>
  input.inline-edit-input::selection {
    background: hsl(var(--ring) / 0.3);
  }
</style>
