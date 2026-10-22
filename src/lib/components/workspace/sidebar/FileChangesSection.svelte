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
  import { selectAllWorkspaceAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
  import { selectLockedAgentIds } from '$store/renderer/slices/agent-lock/agent-lock-selectors';
  import {
    selectStagedWorkingChanges as selectFtStagedChanges,
    selectUnstagedWorkingChanges as selectFtUnstagedChanges,
  } from '$store/renderer/slices/changes/changes-selectors';
  import type { TrackedChange } from '$features/file-tracking/types';
  import {
    gitWriteRequested,
    cancelQueuedGitWrite,
  } from '$store/renderer/slices/git/git-write-slice';
  import {
    selectGitWritePending,
    selectGitGroupCommits,
  } from '$store/renderer/slices/git/git-write-selectors';
  import { selectAutoCommitEnabled } from '$store/renderer/slices/workspace-settings/workspace-settings-selectors';
  import { setAutoCommitEnabled } from '$store/renderer/slices/workspace-settings/workspace-settings-slice';
  import { getPanelLayoutManager } from '$features/layout/panel-layout-adapter';

  import FileRow from '$lib/components/file-tracking/accept-changes/FileRow.svelte';
  import {
    type AgentChangeGroup,
    groupFilesByAgent,
  } from '$lib/components/file-tracking/accept-changes/types';
  import AgentAvatar from '$features/agent/components/agent-avatar/AgentAvatar.svelte';
  import { Button } from '$lib/components/ui/button';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import { Switch } from '$lib/components/ui/switch';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import { confirm } from '$lib/components/patterns/confirm';
  import { m } from '$shared/paraglide/messages.js';
  import { faNote } from '$lib/icons/faNote';
  import { logger } from '$lib/utils/client-logger';
  import { faCodeCommit, faLock, faMinus, faPlus, faUser } from '@fortawesome/free-solid-svg-icons';
  import { onDestroy } from 'svelte';
  import { writable } from 'svelte/store';
  import Fa from 'svelte-fa';
  import { flip } from 'svelte/animate';
  import {
    prefersReducedMotion,
    slide,
    spring,
    type ImmediateMotionConfig as TransitionConfig,
  } from '$lib/motion';
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
  import { store as appStore } from '$store/renderer/store';
  import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';
  import { getPanelTabOpenState } from '$store/renderer/slices/panel-layout/panel-layout-selectors';

  interface Props {
    workspaceId: string;
    activeFilePath?: string | null;
    activeFileStaged?: boolean | null;
    /** Focused file from keyboard navigation in parent */
    focusedFile?: { path: string; staged: boolean } | null;
    isWorkspaceSwitching?: boolean;
    onOpenChange?: (change: TrackedChange, event?: MouseEvent | KeyboardEvent) => void;
    onOpenNote?: (noteId: string) => void;
    /** Callback when a file is clicked (for parent keyboard nav tracking) */
    onFileClicked?: (path: string, staged: boolean) => void;
    openPanelTabs?: PanelTab[];
    activePanelTab?: PanelTab | null;
    /** Every mutating control (auto-commit toggle, per-group commit via
     * `accept-changes.execute`, stage / unstage / revert via `git.stage` /
     * `git.unstage` / `git.discard`) renders only when true; a collaborator
     * gets the read-only change list. */
    isOwner?: boolean;
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
    openPanelTabs = [],
    activePanelTab,
    isOwner = true,
  }: Props = $props();

  // Transition functions matching parent's animation coordination
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function send(node: Element, params: { key: any }): TransitionConfig {
    if (isWorkspaceSwitching) return { duration: 0 };
    const rect = node.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return { duration: 0, css: () => '' };
    }
    return slide(node, { axis: 'y', tier: 'moderate' }, { direction: 'out' }) as TransitionConfig;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function receive(node: Element, params: { key: any }): TransitionConfig {
    if (isWorkspaceSwitching) return { duration: 0 };
    const rect = node.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return { duration: 0, css: () => '' };
    }
    return slide(node, { axis: 'y', tier: 'moderate' }, { direction: 'in' }) as TransitionConfig;
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
  const writePending$ = selectGitWritePending(workspaceIdStore);
  const groupCommits$ = selectGitGroupCommits(workspaceIdStore);

  // Derived change lists
  const unstagedChanges = $derived($ftUnstagedChanges$ ?? []);
  const stagedChanges = $derived($ftStagedChanges$ ?? []);
  const hasUnstaged = $derived(unstagedChanges.length > 0);
  const hasStaged = $derived(stagedChanges.length > 0);

  // Get panel layout manager for opening file tabs
  const panelLayoutManager = $derived(getPanelLayoutManager(workspaceId));

  function getFilePanelState(diffPath: string) {
    return getPanelTabOpenState(openPanelTabs, activePanelTab, workspaceId, {
      type: 'diff',
      diffPath,
      workspaceId,
    });
  }

  // Agent grouping
  const unstagedByAgent = $derived<AgentChangeGroup[]>(
    groupFilesByAgent(unstagedChanges.map((c) => toUIFileChange(c, false))),
  );

  const stagedByAgent = $derived<AgentChangeGroup[]>(
    groupFilesByAgent(stagedChanges.map((c) => toUIFileChange(c, true))),
  );

  const hasAnyAgentAttribution = $derived(
    unstagedChanges.some((c) => c.attribution?.agent) ||
      stagedChanges.some((c) => c.attribution?.agent),
  );

  // Loading state
  const isStaging = $derived($writePending$);

  let unstagedExpanded = $state(true);
  let stagedExpanded = $state(true);

  // Collapsed state for agent groups
  let collapsedAgentGroups = $state(new Set<string>());

  // Multi-select state
  let selectedFiles = $state(new Set<string>());
  let lastClickedFile = $state<{ path: string; staged: boolean } | null>(null);

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
    const entry = $groupCommits$.find(
      (entry) => entry.operation.kind === 'partialCommit' && entry.operation.groupKey === key,
    );
    if (entry?.status === 'running') return 'active';
    if (entry?.status === 'queued') return 'queued';
    return 'idle';
  }

  function getGroupQueuePosition(group: AgentChangeGroup, section: 'unstaged' | 'staged'): number {
    const key = getGroupKey(group, section);
    const idx = $groupCommits$
      .filter((entry) => entry.status === 'queued')
      .findIndex(
        (entry) => entry.operation.kind === 'partialCommit' && entry.operation.groupKey === key,
      );
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

  function handleFileClick(
    path: string,
    _commitHash?: string,
    staged?: boolean,
    event?: MouseEvent | KeyboardEvent,
  ) {
    const change = findChange(path, staged ?? false);
    if (change) onOpenChange?.(change, event);
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
  function handleStageAll() {
    const paths = unstagedChanges
      .filter((change) => !isFileLockedByAgent(change.relativePath, false))
      .map((change) => change.relativePath);
    if (paths.length)
      appStore.dispatch(
        gitWriteRequested(workspaceId, crypto.randomUUID(), {
          kind: 'stage',
          paths,
          source: 'sidebar',
        }),
      );
  }

  function handleUnstageAll() {
    const paths = stagedChanges
      .filter((change) => !isFileLockedByAgent(change.relativePath, true))
      .map((change) => change.relativePath);
    if (paths.length)
      appStore.dispatch(
        gitWriteRequested(workspaceId, crypto.randomUUID(), {
          kind: 'unstage',
          paths,
          source: 'sidebar',
        }),
      );
  }

  function handleStageFile(path: string) {
    const filesToStage =
      isFileSelected(path, false) && selectedUnstagedFiles.length > 0
        ? selectedUnstagedFiles.filter((p) => !isFileLockedByAgent(p, false))
        : [path];
    if (filesToStage.length === 1 && isFileLockedByAgent(path, false)) {
      logger.warn('Cannot stage file from locked agent', { path });
      return;
    }
    appStore.dispatch(
      gitWriteRequested(workspaceId, crypto.randomUUID(), {
        kind: 'stage',
        paths: filesToStage,
        openDiff: true,
        source: 'sidebar',
      }),
    );
    clearSelection();
  }

  function handleUnstageFile(path: string) {
    const filesToUnstage =
      isFileSelected(path, true) && selectedStagedFiles.length > 0
        ? selectedStagedFiles.filter((p) => !isFileLockedByAgent(p, true))
        : [path];
    if (filesToUnstage.length === 1 && isFileLockedByAgent(path, true)) {
      logger.warn('Cannot unstage file from locked agent', { path });
      return;
    }
    appStore.dispatch(
      gitWriteRequested(workspaceId, crypto.randomUUID(), {
        kind: 'unstage',
        paths: filesToUnstage,
        openDiff: true,
        source: 'sidebar',
      }),
    );
    clearSelection();
  }

  let confirmingRevert = false;
  let disposed = false;
  onDestroy(() => {
    disposed = true;
  });

  async function handleRevertFile(path: string) {
    if (confirmingRevert || !isOwner) return;
    const targetWorkspaceId = workspaceId;
    const filesToRevert =
      isFileSelected(path, false) && selectedUnstagedFiles.length > 0
        ? selectedUnstagedFiles.filter((p) => !isFileLockedByAgent(p, false))
        : [path];
    if (filesToRevert.length === 1 && isFileLockedByAgent(path, false)) {
      logger.warn('Cannot revert file from locked agent', { path });
      return;
    }
    if (!filesToRevert.length) return;
    confirmingRevert = true;
    try {
      const accepted = await confirm({
        title: m.fileTracking_changes_discardChanges_tooltip(),
        description: filesToRevert.join('\n'),
        confirmLabel: m.fileTracking_changes_discard_label(),
        destructive: true,
      });
      if (!accepted || disposed || workspaceId !== targetWorkspaceId || !isOwner) return;
      // Never widen or retarget the confirmed set after a refresh or workspace switch.
      const currentChanges = selectFtUnstagedChanges.select(appStore.state, targetWorkspaceId);
      const currentLocks = selectLockedAgentIds.select(appStore.state, targetWorkspaceId);
      if (
        filesToRevert.some((filePath) => {
          const change = currentChanges.find(
            (change) => (change.relativePath || change.file) === filePath,
          );
          const agentId = change?.attribution?.agent?.agentId;
          return !change || (agentId && agentId in currentLocks);
        })
      )
        return;
      appStore.dispatch(
        gitWriteRequested(targetWorkspaceId, crypto.randomUUID(), {
          kind: 'discard',
          paths: filesToRevert,
          source: 'sidebar',
        }),
      );
      if (!disposed && workspaceId === targetWorkspaceId) clearSelection();
    } finally {
      confirmingRevert = false;
    }
  }

  function handleStageGroup(group: AgentChangeGroup) {
    if (group.agentId && group.agentId in $lockedAgentIds$) {
      logger.warn('Cannot stage locked agent group', { agentId: group.agentId });
      return;
    }
    const paths = group.files.map((f) => f.path);
    appStore.dispatch(
      gitWriteRequested(workspaceId, crypto.randomUUID(), {
        kind: 'stage',
        paths,
        source: 'sidebar',
      }),
    );
  }

  function handleUnstageGroup(group: AgentChangeGroup) {
    if (group.agentId && group.agentId in $lockedAgentIds$) {
      logger.warn('Cannot unstage locked agent group', { agentId: group.agentId });
      return;
    }
    const paths = group.files.map((f) => f.path);
    appStore.dispatch(
      gitWriteRequested(workspaceId, crypto.randomUUID(), {
        kind: 'unstage',
        paths,
        source: 'sidebar',
      }),
    );
  }

  // --- Group commit queue ---
  function enqueueGroupCommit(group: AgentChangeGroup, section: 'unstaged' | 'staged') {
    const key = getGroupKey(group, section);
    if (getGroupCommitState(group, section) !== 'idle') return;
    if (group.agentId && group.agentId in $lockedAgentIds$) return;
    appStore.dispatch(
      gitWriteRequested(workspaceId, crypto.randomUUID(), {
        kind: 'partialCommit',
        paths: group.files.map((file) => file.path),
        section,
        message: group.agentId
          ? getAgentDisplayName(group) ||
            group.agentName ||
            m.workspace_fileChanges_agentChanges_label()
          : m.workspace_fileChanges_manualChanges_label(),
        groupKey: key,
        agentId: group.agentId,
        source: 'sidebar',
      }),
    );
  }

  function cancelGroupCommit(group: AgentChangeGroup, section: 'unstaged' | 'staged') {
    const key = getGroupKey(group, section);
    const entry = $groupCommits$.find(
      (entry) =>
        entry.status === 'queued' &&
        entry.operation.kind === 'partialCommit' &&
        entry.operation.groupKey === key,
    );
    if (entry) appStore.dispatch(cancelQueuedGitWrite(workspaceId, entry.id));
  }
</script>

<!-- UNSTAGED SECTION -->
<div>
  <TimelineSection
    title={m.workspace_fileChanges_unstaged_label()}
    collapsible
    expanded={unstagedExpanded}
    onToggle={() => (unstagedExpanded = !unstagedExpanded)}
    active={hasUnstaged}
    activeColor="bg-warning"
  >
    {#snippet action()}
      <!-- Auto-commit toggle (workspace.setAutoCommit is owner-only) -->
      {#if isOwner}
        <div
          class="-my-0.5 ml-auto flex min-w-0 items-center justify-end gap-2"
          data-testid="auto-commit-toggle"
        >
          <Tooltip
            content={$autoCommitEnabled
              ? m.workspace_fileChanges_autoCommitOn_tooltip()
              : m.workspace_fileChanges_autoCommitOff_tooltip()}
            side="right"
            contentClass="w-[12rem]"
            class="min-w-0 items-center justify-end gap-2"
            disableHoverableContent={false}
            disableCloseOnTriggerClick={true}
          >
            <span class="text-ui min-w-0 truncate text-subtle">
              {m.workspace_commitDrawer_autoCommit_label()}
            </span>
            <Switch
              size="xs"
              checked={$autoCommitEnabled}
              class="shrink-0"
              ariaLabel={m.workspace_commitDrawer_autoCommit_label()}
              onCheckedChange={() => {
                if (workspaceId) {
                  appStore.dispatch(
                    setAutoCommitEnabled(workspaceId as string, !$autoCommitEnabled),
                  );
                }
              }}
            />
          </Tooltip>
        </div>
      {/if}
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
              <div class="relative group/agent-header flex h-7 items-center gap-1.5 px-2">
                <Button
                  variant="ghost"
                  type="button"
                  size="compact"
                  wrapContent={false}
                  class="group/row flex h-7 items-center gap-1.5 flex-1 min-w-0 text-left cursor-pointer rounded px-2 -mx-2"
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
                    class="text-ui flex-1 truncate text-muted-foreground {isLocked
                      ? 'opacity-40'
                      : ''}"
                  >
                    {getAgentDisplayName(group)}
                  </span>
                  {#if group.agentId}
                    {@const hasAnyActions = !isLocked || getLinkedNoteId(group.agentId)}
                    <AgentAvatar
                      class="-mt-0.5 {hasAnyActions ? 'group-hover/agent-header:opacity-0' : ''}"
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
                </Button>
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
                  <!-- Group stage / commit mutate the worktree (owner-only) -->
                  {#if isOwner && !isLocked}
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
                          <IntentMarkLoader size={10} class="text-primary-ink" />
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
                        <span class="text-ui font-semibold text-primary-ink leading-none"
                          >{queuePos}</span
                        >
                      </Button>
                    {:else}
                      <Button
                        variant="ghost-light"
                        size="icon-xs"
                        class="h-5 w-5"
                        data-testid="group-commit-button"
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
                <div class="pl-1" transition:slide={{ tier: 'moderate' }}>
                  {#each group.files as file (file.path)}
                    {@const panelState = getFilePanelState(file.path)}
                    <div
                      data-file-key="unstaged:{file.path}"
                      in:receive|global={{ key: file.path }}
                      out:send|global={{ key: file.path }}
                    >
                      <FileRow
                        contextKey={workspaceId}
                        compact
                        {file}
                        showStageAction={isOwner && !isLocked}
                        showRevertAction={isOwner && !isLocked}
                        locked={isLocked}
                        active={isFileActive(file.path, false)}
                        selected={isFileSelected(file.path, false)}
                        focused={isFileFocused(file.path, false)}
                        activeInPanel={panelState.isActive}
                        onFileClick={(path, commitHash, _staged, event) => {
                          trackLastClicked(path, false);
                          handleFileClick(path, commitHash, false, event);
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
            {@const panelState = getFilePanelState(change.relativePath)}
            <div
              data-file-key="unstaged:{change.relativePath}"
              in:receive|global={{ key: change.relativePath }}
              out:send|global={{ key: change.relativePath }}
              animate:flip={{
                duration: isWorkspaceSwitching || prefersReducedMotion() ? 0 : spring.fast.settleMs,
              }}
            >
              <FileRow
                contextKey={workspaceId}
                compact
                file={toUIFileChange(change, false)}
                showStageAction={isOwner}
                showRevertAction={isOwner}
                active={isFileActive(change.relativePath, false)}
                selected={isFileSelected(change.relativePath, false)}
                focused={isFileFocused(change.relativePath, false)}
                activeInPanel={panelState.isActive}
                onFileClick={(path, commitHash, _staged, event) => {
                  trackLastClicked(path, false);
                  handleFileClick(path, commitHash, false, event);
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

<!-- Divider with Stage all / Unstage all buttons (git.stage / git.unstage are owner-only in this tab) -->
<div>
  <TimelineDivider>
    {#if isOwner && hasUnstaged}
      <DividerButton
        onclick={handleStageAll}
        disabled={isStaging}
        loading={isStaging}
        data-testid="stage-all-button"
      >
        {m.workspace_fileChanges_stageAll_label()}
      </DividerButton>
    {/if}
    {#if isOwner && hasStaged}
      <DividerButton
        onclick={handleUnstageAll}
        disabled={isStaging}
        loading={isStaging}
        arrowUp
        data-testid="unstage-all-button"
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
    collapsible
    expanded={stagedExpanded}
    onToggle={() => (stagedExpanded = !stagedExpanded)}
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
              <div class="relative group/agent-header flex h-7 items-center gap-1.5 px-2">
                <Button
                  variant="ghost"
                  type="button"
                  size="compact"
                  wrapContent={false}
                  class="group/row flex h-7 items-center gap-1.5 flex-1 min-w-0 text-left cursor-pointer rounded px-2 -mx-2"
                  onclick={() => toggleAgentGroup(group.agentId)}
                >
                  <span class="text-ui flex-1 truncate text-muted-foreground">
                    {getAgentDisplayName(group)}
                  </span>

                  {#if group.agentId}
                    {@const hasAnyActions = !isLocked || getLinkedNoteId(group.agentId)}
                    <AgentAvatar
                      class="-mt-0.5 {hasAnyActions ? 'group-hover/agent-header:opacity-0' : ''}"
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
                </Button>
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
                  <!-- Group unstage / commit mutate the worktree (owner-only) -->
                  {#if isOwner && !isLocked}
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
                          <IntentMarkLoader size={10} class="text-primary-ink" />
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
                        <span class="text-ui font-semibold text-primary-ink leading-none"
                          >{queuePos}</span
                        >
                      </Button>
                    {:else}
                      <Button
                        variant="ghost-light"
                        size="icon-xs"
                        class="h-5 w-5"
                        data-testid="group-commit-button"
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
                <div class="pl-1" transition:slide={{ tier: 'moderate' }}>
                  {#each group.files as file (file.path)}
                    {@const panelState = getFilePanelState(file.path)}
                    <div
                      data-file-key="staged:{file.path}"
                      in:receive|global={{ key: file.path }}
                      out:send|global={{ key: file.path }}
                    >
                      <FileRow
                        contextKey={workspaceId}
                        compact
                        {file}
                        showStageAction={isOwner && !isLocked}
                        locked={isLocked}
                        active={isFileActive(file.path, true)}
                        selected={isFileSelected(file.path, true)}
                        focused={isFileFocused(file.path, true)}
                        activeInPanel={panelState.isActive}
                        onFileClick={(path, commitHash, _staged, event) => {
                          trackLastClicked(path, true);
                          handleFileClick(path, commitHash, true, event);
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
            {@const panelState = getFilePanelState(change.relativePath)}
            <div
              data-file-key="staged:{change.relativePath}"
              in:receive|global={{ key: change.relativePath }}
              out:send|global={{ key: change.relativePath }}
            >
              <FileRow
                contextKey={workspaceId}
                compact
                file={toUIFileChange(change, true)}
                showStageAction={isOwner}
                active={isFileActive(change.relativePath, true)}
                selected={isFileSelected(change.relativePath, true)}
                focused={isFileFocused(change.relativePath, true)}
                activeInPanel={panelState.isActive}
                onFileClick={(path, commitHash, _staged, event) => {
                  trackLastClicked(path, true);
                  handleFileClick(path, commitHash, true, event);
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
