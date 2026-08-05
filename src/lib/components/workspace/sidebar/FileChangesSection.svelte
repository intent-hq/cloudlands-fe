<script lang="ts">
import { selectAgentSession } from '$store/renderer/slices/agent-session/agent-session-selectors';
  /**
   * FileChangesSection - Unstaged/Staged file changes with agent grouping
   * Handles file staging,
  unstaging,
  reverting,
  selection,
  and group commits.
   */
  import { AcceptChangesClient } from '$features/accept-changes/accept-changes.client';
  import { selectAllWorkspaceAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
  import { selectLockedAgentIds } from '$store/renderer/slices/agent-lock/agent-lock-selectors';
  import {
  selectStagedWorkingChanges as selectFtStagedChanges,
  selectUnstagedWorkingChanges as selectFtUnstagedChanges,
} from '$store/renderer/slices/changes/changes-selectors';
  import { refreshRequested } from '$store/renderer/slices/changes/changes-slice';
  import type { TrackedChange } from '$features/file-tracking/types';
  import {
  discardFiles as discardFilesViaSeam,
  stageFiles as stageFilesViaSeam,
  unstageFiles as unstageFilesViaSeam,
} from '$features/git/git-write-service';
  import { loadGitStatus } from '$store/renderer/slices/git/git-slice';
  import { selectAutoCommitEnabled } from '$store/renderer/slices/workspace-settings/workspace-settings-selectors';
  import { setAutoCommitEnabled } from '$store/renderer/slices/workspace-settings/workspace-settings-slice';
  import { getPanelLayoutManager } from '$features/layout/panel-layout-adapter';


  import FileRow from '$lib/components/file-tracking/accept-changes/FileRow.svelte';
  import {
  type AgentChangeGroup,
  groupFilesByAgent,
} from '$lib/components/file-tracking/accept-changes/types';
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import Toggle from '$lib/components/ui/toggle/toggle.svelte';
  import { toast } from '$lib/components/ui/toast';
  import { m } from '$shared/paraglide/messages.js';
  import { faNote } from '$lib/icons/faNote';
  import { logger } from '$lib/utils/client-logger';
  import type { WorkspaceId } from '$shared/types/branded-ids';
  import {
  faCodeCommit,
  faLock,
  faMinus,
  faPlus,
  faSpinner,
  faUser,
} from '@fortawesome/free-solid-svg-icons';
  import { tick } from 'svelte';
  import { writable } from 'svelte/store';
  import Fa from 'svelte-fa';
  import { flip } from 'svelte/animate';
  import { quintOut } from 'svelte/easing';
  import { slide } from 'svelte/transition';
  import DividerButton from './DividerButton.svelte';
  import {
  getGroupKey,
  isFileActive as isFileActiveUtil,
  isFileSelected as isFileSelectedUtil,
  isFileFocused as isFileFocusedUtil,
  isAgentGroupCollapsed as isAgentGroupCollapsedUtil,
  toUIFileChange,
} from './sidebar-changes-utils';
  import TimelineDivider from './TimelineDivider.svelte';
  import TimelineSection from './TimelineSection.svelte';
  import { openWorkspaceDiff } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
  import { store as appStore } from '$store/renderer/store';


  interface Props {
    workspaceId: string;
    activeFilePath?: string | null;
    activeFileStaged?: boolean | null;
    /** Focused file from keyboard navigation in parent */
    focusedFile?: { path: string; staged: boolean } | null;
    isWorkspaceSwitching?: boolean;
    onOpenChange?: (change: TrackedChange) => void;
    onOpenNote?: (noteId: string) => void;
    /** Callback when a file is clicked (for parent keyboard nav tracking) */
    onFileClicked?: (path: string, staged: boolean) => void;
  }

  let {
    workspaceId,
    activeFilePath = null,
    activeFileStaged = null,
    focusedFile = null,
    isWorkspaceSwitching = false,
    onOpenChange,
    onOpenNote,
    onFileClicked,
  }: Props = $props();

  // Transition functions matching parent's animation coordination
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function send(node: Element, params: { key: any }) {
    if (isWorkspaceSwitching) return { duration: 0 };
    const rect = node.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return { duration: 0, css: () => '' };
    }
    return slide(node, { duration: 200, easing: quintOut, delay: 0, axis: 'y' });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function receive(node: Element, params: { key: any }) {
    if (isWorkspaceSwitching) return { duration: 0 };
    const rect = node.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return { duration: 0, css: () => '' };
    }
    return slide(node, { duration: 200, easing: quintOut, delay: 0, axis: 'y' });
  }

  // Redux selectors
  const workspaceIdStore = writable('');
  $effect(() => {
    workspaceIdStore.set(workspaceId);
  });

  const ftStagedChanges$ = selectFtStagedChanges(workspaceIdStore);
  const ftUnstagedChanges$ = selectFtUnstagedChanges(workspaceIdStore);
  const autoCommitEnabled = selectAutoCommitEnabled(workspaceIdStore);
  const lockedAgentIds$ = selectLockedAgentIds(workspaceIdStore);

  // Derived change lists
  const unstagedChanges = $derived($ftUnstagedChanges$ ?? []);
  const stagedChanges = $derived($ftStagedChanges$ ?? []);
  const hasUnstaged = $derived(unstagedChanges.length > 0);
  const hasStaged = $derived(stagedChanges.length > 0);

  // Get panel layout manager for opening file tabs
  const panelLayoutManager = $derived(getPanelLayoutManager(workspaceId));

  // Agent grouping
  const unstagedByAgent = $derived<AgentChangeGroup[]>(
    groupFilesByAgent(unstagedChanges.map((c) => toUIFileChange(c, false))),
  );

  const unstagedFilePaths = $derived(new Set(unstagedChanges.map((c) => c.relativePath)));

  const stagedByAgent = $derived<AgentChangeGroup[]>(
    groupFilesByAgent(
      stagedChanges
        .filter((c) => !unstagedFilePaths.has(c.relativePath))
        .map((c) => toUIFileChange(c, true)),
    ),
  );

  const hasAnyAgentAttribution = $derived(
    unstagedChanges.some((c) => c.attribution?.agent) ||
      stagedChanges.some((c) => c.attribution?.agent),
  );

  // Loading state
  let isStaging = $state(false);

  // Collapsed state for agent groups
  let collapsedAgentGroups = $state(new Set<string>());

  // Multi-select state
  let selectedFiles = $state(new Set<string>());
  let lastClickedFile = $state<{ path: string; staged: boolean } | null>(null);

  // Group commit queue
  type GroupCommitQueueEntry = {
    groupKey: string;
    section: 'unstaged' | 'staged';
    group: AgentChangeGroup;
  };
  let groupCommit = $state<{ queue: GroupCommitQueueEntry[]; active: string | null }>({ queue: [], active: null });

  // Clear selection on workspace switch
  $effect(() => {
    void workspaceId;
    selectedFiles = new Set();
  });

  // Get selected unstaged/staged files
  const selectedUnstagedFiles = $derived(
    Array.from(selectedFiles)
      .filter((key) => key.startsWith('unstaged:'))
      .map((key) => key.slice('unstaged:'.length)),
  );
  const selectedStagedFiles = $derived(
    Array.from(selectedFiles)
      .filter((key) => key.startsWith('staged:'))
      .map((key) => key.slice('staged:'.length)),
  );

  // --- Helper functions ---
  function isFileActive(filePath: string, isStaged: boolean): boolean {
    return isFileActiveUtil(filePath, isStaged, activeFilePath, activeFileStaged);
  }

  function isFileSelected(path: string, staged: boolean): boolean {
    return isFileSelectedUtil(path, staged, selectedFiles);
  }

  function isFileFocused(path: string, staged: boolean): boolean {
    return isFileFocusedUtil(path, staged, focusedFile);
  }

  function clearSelection() {
    selectedFiles = new Set();
  }

  function getLinkedNoteId(agentId: string | null): string | undefined {
    if (!agentId) return undefined;
    const session = selectAgentSession.select(appStore.state, agentId);
    return session?.metadata?.taskNoteId as string | undefined;
  }

  function isAgentGroupLocked(agentId: string | null): boolean {
    if (!agentId) return false;
    return agentId in $lockedAgentIds$;
  }

  function toggleAgentGroup(agentId: string | null) {
    const key = agentId ?? 'manual';
    const newSet = new Set(collapsedAgentGroups);
    if (newSet.has(key)) {
      newSet.delete(key);
    } else {
      newSet.add(key);
    }
    collapsedAgentGroups = newSet;
  }

  function isAgentGroupCollapsed(agentId: string | null): boolean {
    return isAgentGroupCollapsedUtil(agentId, collapsedAgentGroups);
  }

  function getAgentDisplayName(group: AgentChangeGroup): string {
    if (!group.agentId) return m.workspace_fileChanges_manualChangesTitle_label();
    const sessions = selectAllWorkspaceAgents.select(appStore.state, workspaceId);
    const session = sessions.find((s) => {
      const id = typeof s.id === 'object' ? (s.id as any).id || String(s.id) : String(s.id);
      return id === group.agentId;
    });
    // i18n-ignore (default agent name sentinel from backend)
    if (session?.name && session.name !== 'New Workspace Agent') {
      return session.name;
    }
    return m.workspace_fileChanges_agent_label();
  }

  function getGroupCommitState(
    group: AgentChangeGroup,
    section: 'unstaged' | 'staged',
  ): 'idle' | 'active' | 'queued' {
    const key = getGroupKey(group, section);
    if (groupCommit.active === key) return 'active';
    if (groupCommit.queue.some((e) => e.groupKey === key)) return 'queued';
    return 'idle';
  }

  function getGroupQueuePosition(group: AgentChangeGroup, section: 'unstaged' | 'staged'): number {
    const key = getGroupKey(group, section);
    const idx = groupCommit.queue.findIndex((e) => e.groupKey === key);
    return idx + 1;
  }

  function findChange(path: string, staged: boolean): TrackedChange | undefined {
    const list = staged ? stagedChanges : unstagedChanges;
    return list.find((c) => c.relativePath === path);
  }

  function isFileLockedByAgent(filePath: string, staged: boolean): boolean {
    const changes = staged ? stagedChanges : unstagedChanges;
    const change = changes.find((c) => c.relativePath === filePath || c.file === filePath);
    if (!change) return false;
    const agentId = change.attribution?.agent?.agentId;
    return agentId ? agentId in $lockedAgentIds$ : false;
  }

  function trackLastClicked(path: string, staged: boolean) {
    if (selectedFiles.size > 0) {
      clearSelection();
    }
    lastClickedFile = { path, staged };
    onFileClicked?.(path, staged);
  }

  function handleSelectClick(path: string, staged: boolean, event: MouseEvent) {
    if (!event.shiftKey) return;
    const key = `${staged ? 'staged' : 'unstaged'}:${path}`;
    const changes = staged ? stagedChanges : unstagedChanges;
    const allKeys = changes.map((c) => `${staged ? 'staged' : 'unstaged'}:${c.relativePath}`);
    const newSelection = new Set(selectedFiles);
    if (lastClickedFile && lastClickedFile.staged === staged) {
      const lastKey = `${staged ? 'staged' : 'unstaged'}:${lastClickedFile.path}`;
      const lastIndex = allKeys.indexOf(lastKey);
      const currentIndex = allKeys.indexOf(key);
      if (lastIndex !== -1 && currentIndex !== -1) {
        const start = Math.min(lastIndex, currentIndex);
        const end = Math.max(lastIndex, currentIndex);
        for (let i = start; i <= end; i++) {
          newSelection.add(allKeys[i]);
        }
      }
    } else {
      newSelection.add(key);
    }
    selectedFiles = newSelection;
    lastClickedFile = { path, staged };
  }

  function handleFileClick(path: string, _commitHash?: string, staged?: boolean) {
    const change = findChange(path, staged ?? false);
    if (change) onOpenChange?.(change);
  }

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

  // --- Stage/Unstage/Revert handlers ---
  async function handleStageAll() {
    isStaging = true;
    try {
      const unlockedChanges = unstagedChanges.filter((c) => {
        const agentId = c.attribution?.agent?.agentId;
        return !agentId || !(agentId in $lockedAgentIds$);
      });
      const paths = unlockedChanges.map((c) => c.relativePath);
      if (paths.length > 0) {
        // Staging routes through the AppClient seam (git.stage). TODO: the
        // file-tracking-rendered list converges only once file-tracking moves
        // off legacy IPC (out of scope for this wave).
        const result = await stageFilesViaSeam(workspaceId, paths);
        if (!result.success) {
          toast.error(m.workspace_fileChanges_stageFailed_error(), {
            description: result.error || m.workspace_prSection_unknownError_label(),
          });
        }
      }
    } finally {
      isStaging = false;
    }
  }

  async function handleUnstageAll() {
    isStaging = true;
    try {
      const unlockedChanges = stagedChanges.filter((c) => {
        const agentId = c.attribution?.agent?.agentId;
        return !agentId || !(agentId in $lockedAgentIds$);
      });
      const paths = unlockedChanges.map((c) => c.relativePath);
      if (paths.length > 0) {
        // Unstage through the AppClient seam (git.unstage).
        const result = await unstageFilesViaSeam(workspaceId, paths);
        if (!result.success) {
          toast.error(m.workspace_fileChanges_unstageFailed_error(), {
            description: result.error || m.workspace_prSection_unknownError_label(),
          });
        }
      }
    } finally {
      isStaging = false;
    }
  }

  async function handleStageFile(path: string) {
    const filesToStage =
      isFileSelected(path, false) && selectedUnstagedFiles.length > 0
        ? selectedUnstagedFiles.filter((p) => !isFileLockedByAgent(p, false))
        : [path];
    if (filesToStage.length === 1 && isFileLockedByAgent(path, false)) {
      logger.warn('Cannot stage file from locked agent', { path });
      return;
    }
    // Stage through the AppClient seam (git.stage).
    const stageResult = await stageFilesViaSeam(workspaceId, filesToStage);
    if (!stageResult.success) {
      toast.error(m.workspace_fileChanges_stageFailed_error(), {
        description: stageResult.error || m.workspace_prSection_unknownError_label(),
      });
    }
    clearSelection();
    await tick();
    if (filesToStage.length === 1) {
      const stagedChange = $ftStagedChanges$.find(
        (c) => c.relativePath === path || c.file === path,
      );
      if (stagedChange) {
        logger.info('[handleStageFile] Updating selection to staged version', { path });
        appStore.dispatch(
          openWorkspaceDiff(workspaceId, stagedChange, {
            changeId: stagedChange.id,
            filePath: stagedChange.relativePath || stagedChange.file,
            forceUpdate: true,
          }),
        );
      }
    }
  }

  async function handleUnstageFile(path: string) {
    const filesToUnstage =
      isFileSelected(path, true) && selectedStagedFiles.length > 0
        ? selectedStagedFiles.filter((p) => !isFileLockedByAgent(p, true))
        : [path];
    if (filesToUnstage.length === 1 && isFileLockedByAgent(path, true)) {
      logger.warn('Cannot unstage file from locked agent', { path });
      return;
    }
    // Unstage through the AppClient seam (git.unstage).
    const unstageResult = await unstageFilesViaSeam(workspaceId, filesToUnstage);
    if (!unstageResult.success) {
      toast.error(m.workspace_fileChanges_unstageFailed_error(), {
        description: unstageResult.error || m.workspace_prSection_unknownError_label(),
      });
    }
    clearSelection();
    await tick();
    if (filesToUnstage.length === 1) {
      const unstagedChange = $ftUnstagedChanges$.find(
        (c) => c.relativePath === path || c.file === path,
      );
      if (unstagedChange) {
        logger.info('[handleUnstageFile] Updating selection to unstaged version', { path });
        appStore.dispatch(
          openWorkspaceDiff(workspaceId, unstagedChange, {
            changeId: unstagedChange.id,
            filePath: unstagedChange.relativePath || unstagedChange.file,
            forceUpdate: true,
          }),
        );
      }
    }
  }

  async function handleRevertFile(path: string) {
    const filesToRevert =
      isFileSelected(path, false) && selectedUnstagedFiles.length > 0
        ? selectedUnstagedFiles.filter((p) => !isFileLockedByAgent(p, false))
        : [path];
    if (filesToRevert.length === 1 && isFileLockedByAgent(path, false)) {
      logger.warn('Cannot revert file from locked agent', { path });
      return;
    }
    // Revert through the AppClient seam (git.discard; DESTRUCTIVE).
    const revertResult = await discardFilesViaSeam(workspaceId, filesToRevert);
    if (!revertResult.success) {
      toast.error(m.workspace_fileChanges_revertFailed_error(), {
        description: revertResult.error || m.workspace_prSection_unknownError_label(),
      });
    }
    clearSelection();
  }

  async function handleStageGroup(group: AgentChangeGroup) {
    if (group.agentId && group.agentId in $lockedAgentIds$) {
      logger.warn('Cannot stage locked agent group', { agentId: group.agentId });
      return;
    }
    const paths = group.files.map((f) => f.path);
    // Stage through the AppClient seam (git.stage).
    const result = await stageFilesViaSeam(workspaceId, paths);
    if (!result.success) {
      toast.error(m.workspace_fileChanges_stageFailed_error(), {
        description: result.error || m.workspace_prSection_unknownError_label(),
      });
    }
  }

  async function handleUnstageGroup(group: AgentChangeGroup) {
    if (group.agentId && group.agentId in $lockedAgentIds$) {
      logger.warn('Cannot unstage locked agent group', { agentId: group.agentId });
      return;
    }
    const paths = group.files.map((f) => f.path);
    // Unstage through the AppClient seam (git.unstage).
    const result = await unstageFilesViaSeam(workspaceId, paths);
    if (!result.success) {
      toast.error(m.workspace_fileChanges_unstageFailed_error(), {
        description: result.error || m.workspace_prSection_unknownError_label(),
      });
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async function handleCommitGroup(group: AgentChangeGroup) {
    if (group.agentId && group.agentId in $lockedAgentIds$) {
      logger.warn('Cannot commit locked agent group', { agentId: group.agentId });
      return;
    }
    const paths = group.files.map((f) => f.path);
    const commitMessage = group.agentName || m.workspace_fileChanges_agentChanges_label();
    try {
      const stageResult = await stageFilesViaSeam(workspaceId, paths);
      if (!stageResult.success) {
        throw new Error(stageResult.error || 'Stage failed');
      }
      const result = await AcceptChangesClient.execute(workspaceId as WorkspaceId, 'commit', {
        commitMessage,
      });
      if (result.success) {
        try {
          await Promise.all([
            Promise.resolve(appStore.dispatch(loadGitStatus(workspaceId, true))),
            appStore.dispatch(refreshRequested(workspaceId, true)),
          ]);
        } catch (e) {
          console.warn('Failed to refresh stores after group commit:', e);
        }
      } else {
        toast.error(m.workspace_fileChanges_commitFailed_error(), {
          description: result.error || m.workspace_prSection_unknownError_label(),
        });
      }
    } catch (error) {
      logger.error('Failed to commit agent group', error as Error);
      toast.error(m.workspace_fileChanges_commitFailed_error(), {
        description:
          error instanceof Error ? error.message : m.workspace_prSection_unknownError_label(),
      });
    }
  }

  // --- Group commit queue ---
  function enqueueGroupCommit(group: AgentChangeGroup, section: 'unstaged' | 'staged') {
    const key = getGroupKey(group, section);
    if (groupCommit.active === key || groupCommit.queue.some((e) => e.groupKey === key)) return;
    if (group.agentId && group.agentId in $lockedAgentIds$) return;
    groupCommit.queue = [...groupCommit.queue, { groupKey: key, section, group }];
    if (!groupCommit.active) {
      processGroupCommitQueue();
    }
  }

  function cancelGroupCommit(group: AgentChangeGroup, section: 'unstaged' | 'staged') {
    const key = getGroupKey(group, section);
    if (groupCommit.active === key) return;
    groupCommit.queue = groupCommit.queue.filter((e) => e.groupKey !== key);
  }

  async function processGroupCommitQueue() {
    while (groupCommit.queue.length > 0) {
      const next = groupCommit.queue[0];
      groupCommit.active = next.groupKey;
      groupCommit.queue = groupCommit.queue.slice(1);
      try {
        await commitSingleGroup(next.group, next.section);
      } catch (error) {
        logger.error('Group commit failed', error as Error);
        toast.error(m.workspace_fileChanges_commitFailed_error(), {
          description:
            error instanceof Error ? error.message : m.workspace_prSection_unknownError_label(),
        });
      }
    }
    groupCommit.active = null;
  }

  // Per-group commit executes the commit itself over the legacy
  // IPC/AcceptChangesClient path; the temporary unstage/re-stage around it
  // routes through the git-write-service seam (git.unstage / git.stage).
  async function commitSingleGroup(group: AgentChangeGroup, section: 'unstaged' | 'staged') {
    const paths = group.files.map((f) => f.path);
    const pathSet = new Set(paths);
    const message = group.agentId
      ? getAgentDisplayName(group) || group.agentName || m.workspace_fileChanges_agentChanges_label()
      : m.workspace_fileChanges_manualChanges_label();
    const otherStagedPaths = stagedChanges
      .filter((c) => !pathSet.has(c.relativePath))
      .map((c) => c.relativePath);
    try {
      if (otherStagedPaths.length > 0) {
        const unstageResult = await unstageFilesViaSeam(workspaceId, otherStagedPaths);
        if (!unstageResult.success) {
          throw new Error(unstageResult.error || 'Unstage failed');
        }
      }
      if (section === 'unstaged') {
        const stageResult = await stageFilesViaSeam(workspaceId, paths);
        if (!stageResult.success) {
          throw new Error(stageResult.error || 'Stage failed');
        }
      }
      const result = await AcceptChangesClient.execute(workspaceId as WorkspaceId, 'commit', {
        commitMessage: message,
      });
      if (!result.success) {
        throw new Error(result.error || 'Commit failed');
      }
    } finally {
      if (otherStagedPaths.length > 0) {
        const restageResult = await stageFilesViaSeam(workspaceId, otherStagedPaths);
        if (!restageResult.success) {
          logger.error('Failed to re-stage files after group commit', restageResult.error);
        }
      }
      await Promise.all([
        Promise.resolve(appStore.dispatch(loadGitStatus(workspaceId, true))),
        appStore.dispatch(refreshRequested(workspaceId, true)),
      ]).catch(() => {});
    }
  }
</script>

<!-- UNSTAGED SECTION -->
<div>
  <TimelineSection
    title={m.workspace_fileChanges_unstaged_label()}
    subtitle={m.workspace_fileChanges_new_label()}
    active={hasUnstaged}
    activeColor="bg-amber-500"
  >
    {#snippet action()}
      <!-- Auto-commit toggle -->
      <div class="flex items-center justify-between gap-2 -my-0.5">
        <Tooltip
          content={$autoCommitEnabled
            ? m.workspace_fileChanges_autoCommitOn_tooltip()
            : m.workspace_fileChanges_autoCommitOff_tooltip()}
          side="right"
          contentClass="w-[12rem]"
          disableHoverableContent={false}
          disableCloseOnTriggerClick={true}
        >
          <Toggle
            variant="switch"
            size="xs"
            onLabel="Auto-commit"
            offLabel="Auto-commit"
            pressed={$autoCommitEnabled}
            class="font-normal text-subtle flex-row-reverse -mr-1 whitespace-nowrap"
            onclick={() => {
              if (workspaceId) {
                appStore.dispatch(
                  setAutoCommitEnabled(workspaceId as string, !$autoCommitEnabled),
                );
              }
            }}
          />
        </Tooltip>
      </div>
    {/snippet}

    {#if hasUnstaged}
      {#if hasAnyAgentAttribution}
        <!-- Grouped view with agent headers -->
        <div class="space-y-1">
          {#each unstagedByAgent as group (group.agentId ?? 'manual')}
            {@const isCollapsed = isAgentGroupCollapsed(group.agentId)}
            {@const isLocked = isAgentGroupLocked(group.agentId)}
            {@const commitState = getGroupCommitState(group, 'unstaged')}
            {@const queuePos = getGroupQueuePosition(group, 'unstaged')}
            <div class="space-y-px">
              <!-- Agent header -->
              <div
                class="relative group/agent-header flex items-center gap-1.5 py-0.5 -ml-1 px-1"
              >
                <button
                  type="button"
                  class="group/row flex items-center gap-1.5 flex-1 min-w-0 text-left cursor-pointer rounded px-1 -mx-1"
                  onclick={() => toggleAgentGroup(group.agentId)}
                >
                  {#if isLocked}
                    <Tooltip
                      content="These changes will auto-commit when agent completes"
                      align="start"
                    >
                      <Fa icon={faLock} class="text-subtle shrink-0" size={10} />
                    </Tooltip>
                  {/if}
                  <span
                    class="text-ui opacity-50 truncate flex-1 {isLocked
                      ? 'opacity-40'
                      : ''}"
                  >
                    {getAgentDisplayName(group)}
                  </span>
                  {#if group.agentId}
                    {@const hasAnyActions = !isLocked || getLinkedNoteId(group.agentId)}
                    <AuggieAvatar
                      class="-mt-0.5 {hasAnyActions
                        ? 'group-hover/agent-header:opacity-0'
                        : ''}"
                      agentId={group.agentId}
                      size={15}
                    />
                  {:else}
                    <Fa
                      icon={faUser}
                      class="h-2.5 w-2.5 text-ghost {!isLocked
                        ? 'group-hover/agent-header:opacity-0'
                        : ''}"
                    />
                  {/if}
                </button>
                <!-- Action buttons -->
                <div
                  class="bg-sidebar absolute top-1/2 right-1 transform translate-x-1 transition-transform {commitState !==
                  'idle'
                    ? 'translate-x-0 opacity-100'
                    : 'group-hover/agent-header:translate-x-0'} -translate-y-1/2 {commitState !==
                  'idle'
                    ? ''
                    : 'opacity-0 group-hover/agent-header:opacity-100'} flex items-center pl-0.25"
                >
                  {#if group.agentId && getLinkedNoteId(group.agentId)}
                    <Button
                      variant="ghost-light"
                      size="icon-xs"
                      class="h-5 w-5"
                      tooltip={m.workspace_fileChanges_openLinkedNote_tooltip()}
                      onclick={(e: MouseEvent) => {
                        e.stopPropagation();
                        const noteId = getLinkedNoteId(group.agentId);
                        if (noteId) onOpenNote?.(noteId);
                      }}
                    >
                      <Fa icon={faNote} class="h-2.5! w-2.5!" />
                    </Button>
                  {/if}
                  {#if !isLocked}
                    <Button
                      variant="ghost-light"
                      size="icon-xs"
                      class="h-5 w-5"
                      tooltip={m.workspace_fileChanges_approveAll_tooltip()}
                      onclick={(e: MouseEvent) => {
                        e.stopPropagation();
                        handleStageGroup(group);
                      }}
                    >
                      <Fa icon={faPlus} class="h-2.5! w-2.5!" />
                    </Button>
                    {#if commitState === 'active'}
                      <Tooltip content="Committing..." side="top">
                        <span class="h-5 w-5 flex items-center justify-center">
                          <Fa
                            icon={faSpinner}
                            class="h-2.5! w-2.5! animate-spin text-primary"
                          />
                        </span>
                      </Tooltip>
                    {:else if commitState === 'queued'}
                      <Button
                        variant="ghost-light"
                        size="icon-xs"
                        class="h-5 w-5 relative"
                        tooltip={m.workspace_fileChanges_queuedClickToCancel_tooltip()}
                        onclick={(e: MouseEvent) => {
                          e.stopPropagation();
                          cancelGroupCommit(group, 'unstaged');
                        }}
                      >
                        <span class="text-ui font-semibold text-primary leading-none"
                          >{queuePos}</span
                        >
                      </Button>
                    {:else}
                      <Button
                        variant="ghost-light"
                        size="icon-xs"
                        class="h-5 w-5"
                        tooltip={m.workspace_fileChanges_stageAndCommit_tooltip()}
                        onclick={(e: MouseEvent) => {
                          e.stopPropagation();
                          enqueueGroupCommit(group, 'unstaged');
                        }}
                      >
                        <Fa icon={faCodeCommit} class="h-2.5! w-2.5!" />
                      </Button>
                    {/if}
                  {/if}
                </div>
              </div>
              <!-- Files in group -->
              {#if !isCollapsed}
                <div class="pl-1" transition:slide={{ duration: 150 }}>
                  {#each group.files as file (file.path)}
                    <div
                      data-file-key="unstaged:{file.path}"
                      in:receive|global={{ key: file.path }}
                      out:send|global={{ key: file.path }}
                    >
                      <FileRow
                        {file}
                        showStageAction={!isLocked}
                        showRevertAction={!isLocked}
                        locked={isLocked}
                        active={isFileActive(file.path, false)}
                        selected={isFileSelected(file.path, false)}
                        focused={isFileFocused(file.path, false)}
                        onFileClick={(path, commitHash) => {
                          trackLastClicked(path, false);
                          handleFileClick(path, commitHash, false);
                        }}
                        onSelectClick={(path, e) => handleSelectClick(path, false, e)}
                        onStage={handleStageFile}
                        onRevert={handleRevertFile}
                        onOpenFile={handleOpenFile}
                      />
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {:else}
        <!-- Flat view when no agent attribution -->
        <div class="space-y-px">
          {#each unstagedChanges as change (change.id)}
            <div
              data-file-key="unstaged:{change.relativePath}"
              in:receive|global={{ key: change.relativePath }}
              out:send|global={{ key: change.relativePath }}
              animate:flip={{ duration: isWorkspaceSwitching ? 0 : 100 }}
            >
              <FileRow
                file={toUIFileChange(change, false)}
                showStageAction
                showRevertAction
                active={isFileActive(change.relativePath, false)}
                selected={isFileSelected(change.relativePath, false)}
                focused={isFileFocused(change.relativePath, false)}
                onFileClick={(path, commitHash) => {
                  trackLastClicked(path, false);
                  handleFileClick(path, commitHash, false);
                }}
                onSelectClick={(path, e) => handleSelectClick(path, false, e)}
                onStage={handleStageFile}
                onRevert={handleRevertFile}
                onOpenFile={handleOpenFile}
              />
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  </TimelineSection>
</div>

<!-- Divider with Stage all / Unstage all buttons -->
<div>
  <TimelineDivider>
    {#if hasUnstaged}
      <DividerButton
        onclick={handleStageAll}
        disabled={isStaging}
        loading={isStaging}
        data-testid="stage-all-button"
      >
        {m.workspace_fileChanges_stageAll_label()}
      </DividerButton>
    {/if}
    {#if hasStaged}
      <DividerButton
        onclick={handleUnstageAll}
        disabled={isStaging}
        loading={isStaging}
        arrowUp
      >
        {m.workspace_fileChanges_unstageAll_label()}
      </DividerButton>
    {/if}
  </TimelineDivider>
</div>

<!-- STAGED SECTION -->
<div>
  <TimelineSection
    title={m.workspace_fileChanges_staged_label()}
    subtitle={m.workspace_fileChanges_approved_label()}
    active={hasStaged}
    activeColor="bg-emerald-500"
  >
    {#if hasStaged}
      {#if hasAnyAgentAttribution}
        <!-- Grouped view with agent headers -->
        <div class="space-y-1">
          {#each stagedByAgent as group (group.agentId ?? 'manual')}
            {@const isCollapsed = isAgentGroupCollapsed(group.agentId)}
            {@const isLocked = isAgentGroupLocked(group.agentId)}
            {@const commitState = getGroupCommitState(group, 'staged')}
            {@const queuePos = getGroupQueuePosition(group, 'staged')}
            <div class="space-y-px">
              <!-- Agent header -->
              <div
                class="relative group/agent-header flex items-center gap-1.5 py-0.5 -ml-1 px-1"
              >
                <button
                  type="button"
                  class="group/row flex items-center gap-1.5 flex-1 min-w-0 text-left cursor-pointer rounded px-1 -mx-1"
                  onclick={() => toggleAgentGroup(group.agentId)}
                >
                  <span class="text-ui opacity-50 truncate flex-1">
                    {getAgentDisplayName(group)}
                  </span>

                  {#if group.agentId}
                    {@const hasAnyActions = !isLocked || getLinkedNoteId(group.agentId)}
                    <AuggieAvatar
                      class="-mt-0.5 {hasAnyActions
                        ? 'group-hover/agent-header:opacity-0'
                        : ''}"
                      agentId={group.agentId}
                      size={15}
                    />
                  {:else}
                    <Fa
                      icon={faUser}
                      class="h-2.5 w-2.5 ml-1 mr-1 text-ghost {!isLocked
                        ? 'group-hover/agent-header:opacity-0'
                        : ''}"
                    />
                  {/if}
                </button>
                <!-- Action buttons -->
                <div
                  class="bg-sidebar absolute top-1/2 right-1 transform translate-x-1 transition-transform {commitState !==
                  'idle'
                    ? 'translate-x-0 opacity-100'
                    : 'group-hover/agent-header:translate-x-0'} -translate-y-1/2 {commitState !==
                  'idle'
                    ? ''
                    : 'opacity-0 group-hover/agent-header:opacity-100'} flex items-center gap-0.5"
                >
                  {#if group.agentId && getLinkedNoteId(group.agentId)}
                    <Button
                      variant="ghost-light"
                      size="icon-xs"
                      class="h-5 w-5"
                      tooltip={m.workspace_fileChanges_openLinkedNote_tooltip()}
                      onclick={(e: MouseEvent) => {
                        e.stopPropagation();
                        const noteId = getLinkedNoteId(group.agentId);
                        if (noteId) onOpenNote?.(noteId);
                      }}
                    >
                      <Fa icon={faNote} class="h-2.5! w-2.5!" />
                    </Button>
                  {/if}
                  {#if !isLocked}
                    <Button
                      variant="ghost-light"
                      size="icon-xs"
                      class="h-5 w-5"
                      tooltip={m.workspace_fileChanges_unapproveAll_tooltip()}
                      onclick={(e: MouseEvent) => {
                        e.stopPropagation();
                        handleUnstageGroup(group);
                      }}
                    >
                      <Fa icon={faMinus} class="h-2.5! w-2.5!" />
                    </Button>
                    {#if commitState === 'active'}
                      <Tooltip content="Committing..." side="top">
                        <span class="h-5 w-5 flex items-center justify-center">
                          <Fa
                            icon={faSpinner}
                            class="h-2.5! w-2.5! animate-spin text-primary"
                          />
                        </span>
                      </Tooltip>
                    {:else if commitState === 'queued'}
                      <Button
                        variant="ghost-light"
                        size="icon-xs"
                        class="h-5 w-5 relative"
                        tooltip={m.workspace_fileChanges_queuedClickToCancel_tooltip()}
                        onclick={(e: MouseEvent) => {
                          e.stopPropagation();
                          cancelGroupCommit(group, 'staged');
                        }}
                      >
                        <span class="text-ui font-semibold text-primary leading-none"
                          >{queuePos}</span
                        >
                      </Button>
                    {:else}
                      <Button
                        variant="ghost-light"
                        size="icon-xs"
                        class="h-5 w-5"
                        tooltip={m.workspace_commitDrawer_commit_label()}
                        onclick={(e: MouseEvent) => {
                          e.stopPropagation();
                          enqueueGroupCommit(group, 'staged');
                        }}
                      >
                        <Fa icon={faCodeCommit} class="h-2.5! w-2.5!" />
                      </Button>
                    {/if}
                  {/if}
                </div>
              </div>
              <!-- Files in group -->
              {#if !isCollapsed}
                <div class="pl-1" transition:slide={{ duration: 150 }}>
                  {#each group.files as file (file.path)}
                    <div
                      data-file-key="staged:{file.path}"
                      in:receive|global={{ key: file.path }}
                      out:send|global={{ key: file.path }}
                    >
                      <FileRow
                        {file}
                        showStageAction={!isLocked}
                        locked={isLocked}
                        active={isFileActive(file.path, true)}
                        selected={isFileSelected(file.path, true)}
                        focused={isFileFocused(file.path, true)}
                        onFileClick={(path, commitHash) => {
                          trackLastClicked(path, true);
                          handleFileClick(path, commitHash, true);
                        }}
                        onSelectClick={(path, e) => handleSelectClick(path, true, e)}
                        onUnstage={handleUnstageFile}
                        onOpenFile={handleOpenFile}
                      />
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {:else}
        <!-- Flat view when no agent attribution -->
        <div class="space-y-px">
          {#each stagedChanges as change (change.id)}
            <div
              data-file-key="staged:{change.relativePath}"
              in:receive|global={{ key: change.relativePath }}
              out:send|global={{ key: change.relativePath }}
            >
              <FileRow
                file={toUIFileChange(change, true)}
                showStageAction
                active={isFileActive(change.relativePath, true)}
                selected={isFileSelected(change.relativePath, true)}
                focused={isFileFocused(change.relativePath, true)}
                onFileClick={(path, commitHash) => {
                  trackLastClicked(path, true);
                  handleFileClick(path, commitHash, true);
                }}
                onSelectClick={(path, e) => handleSelectClick(path, true, e)}
                onUnstage={handleUnstageFile}
                onOpenFile={handleOpenFile}
              />
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  </TimelineSection>
</div>
