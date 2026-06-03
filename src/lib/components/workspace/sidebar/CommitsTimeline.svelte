<script lang="ts">
  /**
   * CommitsTimeline - Commits section of the sidebar changes panel
   * Shows commit list, expand/collapse, inline edit, push/undo, context menu, older commits, base commit.
   */
  import { AcceptChangesClient } from '$features/accept-changes/accept-changes.client';
  import type { UndoCommitMetadata } from '$features/accept-changes/types';
  import { gitCache } from '$features/git/git-cache';
  import { handleLink } from '$features/navigation/link-handler';
  import { getPanelLayoutManager } from '$features/layout/panel-layout-adapter';
  import {
  ChangeStage,
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
  loadGitStatus,
  setGitOperationFlag,
} from '$store/renderer/slices/git/git-slice';
  import {
  selectPostMergeState,
  selectGitOperationFlags,
} from '$store/renderer/slices/git/git-selectors';

  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
  import { workspaceClient } from '$store/renderer/slices/workspace/utils/workspace.client';
  import {
  addTerminal,
  openTerminalOverlay,
} from '$store/renderer/slices/terminals/terminals-slice';


  import FileRow from '$lib/components/file-tracking/accept-changes/FileRow.svelte';
  import type { UIFileChange } from '$lib/components/file-tracking/accept-changes/types';
  import LineChangesBadge from '$lib/components/shared/LineChangesBadge.svelte';
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';
  import { Button } from '$lib/components/ui/button';
  import SidebarContextMenu from '$lib/components/ui/sidebar-context-menu/SidebarContextMenu.svelte';
  import type { SidebarMenuEntry } from '$lib/components/ui/sidebar-context-menu/types';
  import { toast } from '$lib/components/ui/toast';
  import { invoke } from '$lib/electron-bridge';
  import {
  track,
  trackGitOp,
  getFileExtension,
} from '$lib/services/analytics';
  import { logger } from '$lib/utils/client-logger';
  import { SYSTEM_CHANNELS } from '$shared/ipc/channels';
  import type { WorkspaceId } from '$shared/types/branded-ids';
  import {
  faArrowUpFromBracket,
  faArrowUpRightFromSquare,
  faChevronDown,
  faCloud,
  faCodeCommit,
  faFlag,
  faRotateLeft,
  faSpinner,
} from '@fortawesome/free-solid-svg-icons';
  import { tick } from 'svelte';
  import { writable } from 'svelte/store';
  import Fa from 'svelte-fa';
  import { slide } from 'svelte/transition';
  import TimelineSection from './TimelineSection.svelte';
  import {
  openWorkspaceCommitChangeset,
  openWorkspaceDiff,
} from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
  import {
  getCommitsToPushCount,
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
  let commitEdit = $state<{ hash: string | null; value: string; inputRef: HTMLInputElement | null }>({ hash: null, value: '', inputRef: null });
  let undoState = $state<{ commitHash: string | null; undoing: boolean; undoingCommit: boolean }>({ commitHash: null, undoing: false, undoingCommit: false });
  let commitContextMenu: { x: number; y: number; commitHash: string } | null = $state(null);

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
    track('Opened File', {
      workspace_id: workspaceId,
      file_extension: getFileExtension(relativePath),
      source: 'sidebar',
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
        label: isCurrentBase ? 'Base commit (current)' : 'Set as base commit',
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
          label: 'Reset to default base',
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
    if (!$workspace) return;
    try {
      const result = await persistWorkspaceChanges({ baseCommitSha: commitHash });
      if (result.ok) {
        appStore.dispatch(ftClearOlderCommits(workspaceId));
        appStore.dispatch(refreshRequested(workspaceId));
        toast.success('Base commit updated — only newer commits will be shown');
      } else {
        toast.error('Failed to update base commit');
      }
    } catch (error) {
      logger.error('Failed to set base commit', error as Error);
      toast.error('Failed to update base commit');
    }
  }

  async function handleClearBaseCommit() {
    if (!$workspace) return;
    try {
      const result = await persistWorkspaceChanges({ baseCommitSha: '' });
      if (result.ok) {
        appStore.dispatch(ftClearOlderCommits(workspaceId));
        appStore.dispatch(refreshRequested(workspaceId));
        toast.success('Base commit reset to default');
      } else {
        toast.error('Failed to reset base commit');
      }
    } catch (error) {
      logger.error('Failed to clear base commit', error as Error);
      toast.error('Failed to reset base commit');
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

  async function saveCommitEdit() {
    const gitPath = $workspace?.worktreePath || $workspace?.repositoryPath;
    if (commitEdit.hash && commitEdit.value.trim() && workspaceId && gitPath) {
      const trimmed = commitEdit.value.trim();
      const commit = allCommits.find((c) => c.hash === commitEdit.hash);
      if (commit && trimmed !== commit.message) {
        try {
          const wasPushed = commit.isPushed;
          const escapedMessage = trimmed.replace(/"/g, '\\"').replace(/\$/g, '\\$');
          const result = (await invoke(SYSTEM_CHANNELS.EXECUTE_COMMAND, {
            command: `git commit --amend -m "${escapedMessage}"`,
            cwd: gitPath,
          })) as { success: boolean; error?: string };

          if (!result.success) {
            throw new Error(result.error || 'Failed to amend commit');
          }

          if (wasPushed) {
            let pushResult = (await invoke(SYSTEM_CHANNELS.EXECUTE_COMMAND, {
              command: 'git push --force-with-lease',
              cwd: gitPath,
            })) as { success: boolean; error?: string; data?: { stderr?: string } };

            if (
              !pushResult.success &&
              pushResult.data?.stderr?.includes('has no upstream branch')
            ) {
              const branchResult = (await invoke(SYSTEM_CHANNELS.EXECUTE_COMMAND, {
                command: 'git rev-parse --abbrev-ref HEAD',
                cwd: gitPath,
              })) as { success: boolean; data?: { stdout?: string } };

              if (branchResult.success && branchResult.data?.stdout) {
                const branchName = branchResult.data.stdout.trim();
                pushResult = (await invoke(SYSTEM_CHANNELS.EXECUTE_COMMAND, {
                  command: `git push --force-with-lease --set-upstream origin ${branchName}`,
                  cwd: gitPath,
                })) as { success: boolean; error?: string; data?: { stderr?: string } };
              }
            }

            if (!pushResult.success) {
              throw new Error(pushResult.error || 'Failed to push amended commit');
            }
          }

          gitCache.invalidate(`git-status-${workspaceId}`);
          await Promise.all([
            Promise.resolve(appStore.dispatch(loadGitStatus(workspaceId, true))),
            appStore.dispatch(refreshRequested(workspaceId)),
          ]);
          toast.success(wasPushed ? 'Commit message updated and pushed' : 'Commit message updated');
        } catch (error) {
          logger.error('[saveCommitEdit] Failed to amend commit message', { error });
          toast.error('Failed to update commit message');
        }
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

  function toggleCommitExpanded(hash: string) {
    const newSet = new Set(expandedCommits);
    if (newSet.has(hash)) {
      newSet.delete(hash);
    } else {
      newSet.add(hash);
    }
    expandedCommits = newSet;
  }

  async function handleCommitFileClick(filePath: string, commitHash: string) {
    logger.info('[handleCommitFileClick] File clicked in commit', { filePath, commitHash });
    const commit = allCommits.find((c) => c.hash === commitHash);
    if (commit && workspaceId) {
      const file = commit.files?.find((f) => f.path === filePath);
      if (file) {
        try {
          logger.info('[handleCommitFileClick] Fetching content from commit', { filePath, commitHash });
          const newContentResult = (await invoke('git:show-file', {
            workspaceId, filePath, ref: commitHash,
          })) as { success: boolean; data?: string; error?: string };
          const oldContentResult = (await invoke('git:show-file', {
            workspaceId, filePath, ref: `${commitHash}^`,
          })) as { success: boolean; data?: string; error?: string };

          const newContent = newContentResult?.success ? newContentResult.data || '' : '';
          const oldContent = oldContentResult?.success ? oldContentResult.data || '' : '';

          logger.info('[handleCommitFileClick] Content fetched', {
            filePath, commitHash,
            newContentLength: newContent.length,
            oldContentLength: oldContent.length,
          });

          const change: TrackedChange = {
            id: `commit-${commitHash}-${filePath}`,
            file: filePath,
            relativePath: filePath,
            status: 'modified' as const,
            stage: ChangeStage.Committed,
            commitHash,
            stats: { additions: file.additions || 0, deletions: file.deletions || 0 },
            content: { oldContent, newContent, diff: '' },
            attribution: { timestamp: Date.now() },
          };

          logger.info('[handleCommitFileClick] Dispatching workspace:open-diff event', {
            changeId: change.id, stage: change.stage, commitHash: change.commitHash,
          });

          appStore.dispatch(
            openWorkspaceDiff(workspaceId, change, {
              changeId: change.id,
              filePath,
            }),
          );
        } catch (error) {
          logger.error('Failed to load commit diff', { filePath, commitHash, error });
        }
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
  function getCommitsToPushCount_(commitIndex: number): number {
    return getCommitsToPushCount(allCommits, commitIndex);
  }
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

  async function openPullTerminal() {
    if (!workspaceId) return;
    const worktreePath = $workspace?.worktreePath || $workspace?.repositoryPath;
    if (!worktreePath) { toast.error('Cannot find space path'); return; }
    try {
      const remoteBranch = $workspace?.branch || 'HEAD';
      const pullCommand = `git pull --rebase origin ${remoteBranch}`;
      const result = await window.electronAPI.invoke('terminal:createWithCommand', {
        workspaceId, command: pullCommand, cwd: worktreePath,
        title: `Pull from origin/${remoteBranch}`,
      });
      if (result.ok && result.terminalId) {
        appStore.dispatch(addTerminal(workspaceId, result.terminalId, `Pull from origin/${remoteBranch}`));
        appStore.dispatch(openTerminalOverlay(workspaceId, result.terminalId));
        toast.success('Pull started in terminal', {
          description: 'After pull completes, click Refresh then retry push.',
          action: {
            label: 'Refresh',
            onClick: async () => {
              gitCache.invalidate(`git-status-${workspaceId}`);
              await Promise.all([
                Promise.resolve(appStore.dispatch(loadGitStatus(workspaceId, true))),
                appStore.dispatch(refreshRequested(workspaceId)),
              ]);
              toast.success('Git status refreshed');
            },
          },
          duration: 30000,
        });
      } else {
        toast.error(result.error || 'Failed to open terminal');
      }
    } catch (error) {
      logger.error('Failed to open pull terminal', error as Error);
      toast.error('Failed to open terminal');
    }
  }

  async function handlePushCommits(commitIndex: number) {
    if (!workspaceId) return;
    const commit = allCommits[commitIndex];
    undoState.commitHash = commit.hash;
    appStore.dispatch(setGitOperationFlag(workspaceId, 'isPushing', true));
    try {
      const result = await AcceptChangesClient.execute(workspaceId as WorkspaceId, 'push', {
        targetBranch: $workspace?.branch,
        upToCommitHash: commit.hash,
      });
      const commitCount = getCommitsToPushCount_(commitIndex);
      trackGitOp('push', {
        workspaceId, success: result.success, trigger: 'manual',
        commitCount, hasPr: pullRequestCount > 0,
      });
      if (result.success) {
        gitCache.invalidate(`git-status-${workspaceId}`);
        try {
          await Promise.all([
            Promise.resolve(appStore.dispatch(loadGitStatus(workspaceId, true))),
            appStore.dispatch(refreshRequested(workspaceId)),
          ]);
        } catch { /* Refresh failed but push succeeded */ }
      } else {
        const errorMsg = result.error || 'Failed to push';
        if (errorMsg.includes('Pull the latest changes') || errorMsg.includes('behind')) {
          toast.error('Remote has new commits', {
            description: 'Pull the latest changes before pushing.',
            action: { label: 'Pull in Terminal', onClick: () => openPullTerminal() },
            duration: 10000,
          });
        } else {
          toast.error(errorMsg);
        }
      }
    } catch {
      trackGitOp('push', { workspaceId, success: false, trigger: 'manual' });
      toast.error('Failed to push commits');
    } finally {
      appStore.dispatch(setGitOperationFlag(workspaceId, 'isPushing', false));
      undoState.commitHash = null;
    }
  }

  async function handleUndoPush(commitIndex: number) {
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
        toast.error('Cannot undo - no base commit reference available');
        return;
      }
    }
    undoState.commitHash = commit.hash;
    undoState.undoing = true;
    try {
      const result = await AcceptChangesClient.execute(workspaceId as WorkspaceId, 'undo-push', {
        upToCommitHash: resetToHash,
      });
      trackGitOp('undo-push', { workspaceId, success: result.success, trigger: 'manual' });
      if (result.success) {
        const commitWord = commitCount === 1 ? 'commit' : 'commits';
        toast.warning(`${commitCount} ${commitWord} removed from remote`);
        gitCache.invalidate(`git-status-${workspaceId}`);
        Promise.all([
          Promise.resolve(appStore.dispatch(loadGitStatus(workspaceId, true))),
          appStore.dispatch(refreshRequested(workspaceId)),
        ]);
      } else {
        toast.error(result.error || 'Failed to undo push');
      }
    } catch {
      trackGitOp('undo-push', { workspaceId, success: false, trigger: 'manual' });
      toast.error('Failed to undo push');
    } finally {
      undoState.undoing = false;
      undoState.commitHash = null;
    }
  }

  async function handleUndoCommit(commitIndex: number) {
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
        toast.error('Cannot undo - no base commit reference available');
        return;
      }
    }
    const undoCommitsMetadata: UndoCommitMetadata[] = [];
    for (let i = 0; i <= commitIndex; i++) {
      const c = allCommits[i];
      if (!c.isPushed) {
        undoCommitsMetadata.push({
          hash: c.hash,
          agentId: c.agentId,
          linkedNoteId: c.linkedNoteId,
          files: c.files?.map((f) => f.path),
        });
      }
    }
    undoState.commitHash = commit.hash;
    undoState.undoingCommit = true;
    try {
      const result = await AcceptChangesClient.execute(workspaceId as WorkspaceId, 'undo-commit', {
        upToCommitHash: resetToHash,
        undoCommitsMetadata,
      });
      trackGitOp('undo-commit', {
        workspaceId, success: result.success, trigger: 'manual',
        commitCountUndone: commitCount,
      });
      if (result.success) {
        const commitWord = commitCount === 1 ? 'commit' : 'commits';
        toast.warning(`${commitCount} ${commitWord} undone - changes moved to staging`);
        gitCache.invalidate(`git-status-${workspaceId}`);
        Promise.all([
          Promise.resolve(appStore.dispatch(loadGitStatus(workspaceId, true))),
          appStore.dispatch(refreshRequested(workspaceId)),
        ]);
      } else {
        toast.error(result.error || 'Failed to undo commit');
      }
    } catch {
      trackGitOp('undo-commit', { workspaceId, success: false, trigger: 'manual' });
      toast.error('Failed to undo commit');
    } finally {
      undoState.undoingCommit = false;
      undoState.commitHash = null;
    }
  }
</script>

<!-- COMMITS SECTION -->
<TimelineSection title="Commits" active={allCommits.length > 0} activeColor="bg-blue-500">
  {#if allCommits.length > 0}
    <div class="space-y-0.5">
      {#each allCommits as commit, index (commit.hash)}
        <!-- Divider between local and pushed commits (only when remote exists) -->
        {#if hasRemote && commit.isPushed && index > 0 && !allCommits[index - 1].isPushed && commits.length > 0}
          <div class="flex items-center gap-2 px-1 py-1.5">
            <div class="flex-1 h-px bg-border"></div>
            <span class="text-xs text-subtle">Pushed to remote</span>
            <div class="flex-1 h-px bg-border"></div>
          </div>
        {/if}
        {@const isOperatingOnThis = undoState.commitHash === commit.hash}
        {@const isExpanded = expandedCommits.has(commit.hash)}
        {@const files = (commit.files ?? []).map((f) => ({
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
            {#if commit.files && commit.files.length > 0}
              <Button
                variant="ghost-light"
                size="icon-xs"
                class="absolute left-0.75 bg-sidebar {commit.agentId
                  ? 'opacity-0 group-hover:opacity-100'
                  : 'opacity-0 group-hover:opacity-100'} hover:text-foreground! -ml-1"
                onclick={(e: MouseEvent) => {
                  e.stopPropagation();
                  toggleCommitExpanded(commit.hash);
                }}
                title="Toggle file list"
              >
                <Fa
                  icon={faChevronDown}
                  size={12}
                  class="text-subtle shrink-0 transition-transform {isExpanded
                    ? 'rotate-0'
                    : '-rotate-90'}"
                />
                <LineChangesBadge
                  additions={commit.files.reduce((sum, f) => sum + (f.additions || 0), 0)}
                  deletions={commit.files.reduce((sum, f) => sum + (f.deletions || 0), 0)}
                  size="xs"
                />
              </Button>
            {/if}

            <!-- Show auggie avatar instead of commit icon when made by an agent - hides on hover to show chevron -->
            {#if commit.agentId}
              <span
                class="shrink-0 group-hover:opacity-0 transition-opacity pointer-events-none"
              >
                <AuggieAvatar
                  agentId={commit.agentId}
                  size={14}
                  class="mr-[-2px]"
                />
              </span>
            {:else}
              <Fa icon={faCodeCommit} size="xs" class="text-ghost shrink-0" />
            {/if}
            {#if commitEdit.hash === commit.hash}
              <!-- Inline edit mode for commit message -->
              <input
                bind:this={commitEdit.inputRef}
                type="text"
                bind:value={commitEdit.value}
                onblur={saveCommitEdit}
                onkeydown={handleCommitEditKeydown}
                class="flex-1 text-ui text-subtle bg-transparent border-none outline-none! ring-0! focus:ring-0! focus:outline-none! focus-visible:ring-0! focus-visible:outline-none! min-w-0"
                onclick={(e) => e.stopPropagation()}
              />
            {:else}
              <button
                type="button"
                class="flex items-center gap-2 flex-1 min-w-0 text-left cursor-pointer {commit.isPushed &&
                !commit.agentId
                  ? 'pr-5'
                  : ''}"
                onclick={() => handleOpenCommitChangeset(commit.hash, commit.message)}
                ondblclick={(e) => handleCommitMessageDoubleClick(e, commit, index)}
              >
                <span
                  class="text-ui text-subtle truncate flex-1 {canAmendCommit(index)
                    ? ''
                    : ''}"
                  title={commit.message}
                >
                  {commit.message}
                </span>
              </button>
            {/if}

            <!-- Right side: Cloud icon for pushed commits (fades on hover, only when remote exists) -->
            {#if hasRemote && commit.isPushed && !commit.agentId}
              <span
                class="absolute right-0 shrink-0 group-hover:opacity-0 transition-opacity"
              >
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
                  tooltip="Open in browser"
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
                      <Fa icon={faSpinner} size="xs" class="animate-spin text-subtle" />
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
                    <Fa icon={faSpinner} size="xs" class="animate-spin text-subtle" />
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
                      <Fa icon={faSpinner} size="xs" class="animate-spin text-subtle" />
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
              transition:slide={{ duration: 150 }}
            >
              <!-- Files list -->
              {#each files as file (file.path)}
                <FileRow
                  {file}
                  muted={true}
                  active={activeFilePath === file.path && activeFileStaged === null}
                  onFileClick={(filePath) => {
                    handleCommitFileClick(filePath, commit.hash).catch((error) => {
                      logger.error('Error in handleCommitFileClick', { error });
                    });
                  }}
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
    <button
      class="group/boundary relative w-full cursor-pointer {allCommits.length > 0
        ? 'mt-2'
        : ''}"
      disabled={$ftLoadingOlderCommits$}
      onclick={() => {
        if (olderCommits.length > 0) {
          appStore.dispatch(ftClearOlderCommits(workspaceId));
        } else {
          appStore.dispatch(loadOlderCommitsRequested(workspaceId, $ftBoundarySha$));
        }
      }}
    >
      <div
        class="relative flex items-center gap-2 px-1 pr-3 w-fit bg-sidebar mr-auto py-2 z-10 group-hover/boundary:opacity-100 {olderCommits.length >
        0
          ? 'opacity-100'
          : 'opacity-0'}"
      >
        <span
          class="flex items-center gap-1.5 text-ui text-subtle bg-sidebar select-none"
        >
          Workspace start
          {#if $ftLoadingOlderCommits$}
            <Fa icon={faSpinner} class="opacity-50 animate-spin" size="xs" />
          {:else}
            <Fa
              icon={faChevronDown}
              size="xs"
              class="opacity-50 transition-transform {olderCommits.length > 0
                ? 'rotate-180'
                : ''}"
            />
          {/if}
        </span>
      </div>
      <div class="absolute top-4.5 left-0 right-0 flex-1 border-t border-border/50"></div>
    </button>
  {/if}

  <!-- Older commits (dimmed, below boundary) -->
  {#if olderCommits.length > 0}
    <div class="space-y-0.5 opacity-60 hover:opacity-100 transition-opacity">
      {#each olderCommits as commit (commit.hash)}
        {@const isExpanded = expandedCommits.has(commit.hash)}
        {@const files = (commit.files ?? []).map((f) => ({
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
            {#if commit.files && commit.files.length > 0}
              <Button
                variant="ghost-light"
                size="icon-xs"
                class="absolute left-0.75 bg-sidebar opacity-0 group-hover:opacity-100 hover:text-foreground! -ml-1"
                onclick={(e: MouseEvent) => {
                  e.stopPropagation();
                  toggleCommitExpanded(commit.hash);
                }}
                title="Toggle file list"
              >
                <Fa
                  icon={faChevronDown}
                  size={12}
                  class="text-subtle shrink-0 transition-transform {isExpanded
                    ? 'rotate-0'
                    : '-rotate-90'}"
                />
                <LineChangesBadge
                  additions={commit.files.reduce((sum, f) => sum + (f.additions || 0), 0)}
                  deletions={commit.files.reduce((sum, f) => sum + (f.deletions || 0), 0)}
                  size="xs"
                />
              </Button>
            {/if}

            <Fa icon={faCodeCommit} size="xs" class="text-ghost shrink-0" />
            <button
              type="button"
              class="flex items-center gap-2 flex-1 min-w-0 text-left cursor-pointer"
              onclick={() => handleOpenCommitChangeset(commit.hash, commit.message)}
            >
              <span class="text-ui text-subtle truncate flex-1" title={commit.message}>
                {commit.message}
              </span>
            </button>
          </div>

          {#if isExpanded}
            <div
              class="pl-5 pr-1.5 pb-0.5 pt-0.5 space-y-px"
              transition:slide={{ duration: 150 }}
            >
              {#each files as file (file.path)}
                <FileRow
                  {file}
                  muted={true}
                  active={activeFilePath === file.path && activeFileStaged === null}
                  onFileClick={(filePath) => {
                    handleCommitFileClick(filePath, commit.hash).catch((error) => {
                      logger.error('Error in handleCommitFileClick', { error });
                    });
                  }}
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
    <button
      class="w-full text-ui text-ghost hover:text-muted-foreground py-1 transition-colors cursor-pointer"
      disabled={$ftLoadingOlderCommits$}
      onclick={() => {
        const lastOlder = olderCommits[olderCommits.length - 1];
        if (lastOlder)
          appStore.dispatch(
            loadOlderCommitsRequested(workspaceId, lastOlder.hash),
          );
      }}
    >
      {#if $ftLoadingOlderCommits$}
        <Fa icon={faSpinner} class="animate-spin mr-1" size="xs" />
      {/if}
      Show more previous commits
    </button>
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
