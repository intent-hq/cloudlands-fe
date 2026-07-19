<script lang="ts">
/* eslint-disable max-lines */
  import { goto } from '$app/navigation';
  import { addContextItem } from '$store/renderer/slices/context/context-slice';
  import { v4 as uuidv4 } from 'uuid';
  import {
  selectCurrentWorkspaceId,
  selectCurrentStagedWorkingChanges,
  selectCurrentUnstagedWorkingChanges,
  selectCurrentCommits,
} from '$store/renderer/slices/changes/changes-selectors';
  import { getPanelLayoutManager } from '$features/layout/panel-layout-adapter';
  import { selectActiveTab } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import {
  type AvatarState,
  getAvatarState,
} from '$lib/components/ui/auggie-avatar/avatar-state';
  import { Button } from '$lib/components/ui/button';
  import OpenComboButton from '$lib/components/ui/OpenComboButton.svelte';
  import { faNote } from '$lib/icons/faNote';
  import {
  getFileExtension,
  track,
} from '$lib/services/analytics';

  import {
  markNoteRead,
  refreshUnreadNotes,
} from '$store/renderer/slices/note-read-tracking/note-read-tracking-slice';
  import { initializeNotes } from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
  import {
  selectAllWorkspaceAgents,
  selectForegroundWorkspaceAgents,
  selectIsLoadingAgents,
} from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
  import { workspaceClient } from '$store/renderer/slices/workspace/utils/workspace.client';
  import { cn } from '$lib/utils';

  import {
  selectAgentIsResponding,
  selectAgentIsWaiting,
} from '$store/renderer/slices/agent-session/agent-session-selectors';
  import { loadWorkspacesRequested } from '$store/renderer/slices/workspace/workspace-slice';
  import { locateItemInSidebarConsumed } from '$store/renderer/slices/app-layout/app-layout-slice';
  import { selectPendingLocateInSidebar } from '$store/renderer/slices/app-layout/app-layout-selectors';
  import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
  import {
  faAsterisk,
  faCompressAlt,
  faExpandAlt,
  faFolderTree,
  faPencil,
  faPlus,
  faRobot,
  faSearch,
  faTimes,
} from '@fortawesome/free-solid-svg-icons';

  import { onMount } from 'svelte';
  import { writable } from 'svelte/store';
  import Fa from 'svelte-fa';
  import {
  fly,
  slide,
} from 'svelte/transition';
  import AnimatedNumber from '../ui/AnimatedNumber.svelte';
  import Input from '../ui/input/input.svelte';
  import CreateAgentSection from './CreateAgentSection.svelte';
  import OverviewTimelinePanel from './OverviewTimelinePanel.svelte';
  import {
  FilesPanel,
  SidebarChangesPanel,
  isSpecNote,
} from './sidebar';
  import AddContextSection from './sidebar/AddContextSection.svelte';
  import ContextPanel from './sidebar/ContextPanel.svelte';
  import WorkspaceProgressCard from './sidebar/WorkspaceProgressCard.svelte';
  import {
  deriveWorkspacePhase,
  deriveWorkspaceStats,
  type WorkspacePhaseInfo,
  type WorkspacePhaseStats,
} from './workspace-phase';
  import WorkspaceAgentsList from './WorkspaceAgentsList.svelte';
  import { selectEffectiveFileExplorerWorkspacePath } from '$store/renderer/slices/file-explorer/file-explorer-selectors';
  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
  import {
  selectAllNotes,
  selectNotesLoading,
} from '$store/renderer/slices/workspace-notes/workspace-notes-selectors';
  import {
  openWorkspaceCommitChangeset,
  openWorkspaceDiff,
  openWorkspaceLocalChanges,
} from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
  import {
  setMultiSelectSidebarSelectedTabs,
  setMultiSelectSidebarTabOrder,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import {
  selectMultiSelectSidebarSelectedTabIds,
  selectMultiSelectSidebarTabOrder,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';
  import { store as appStore } from '$store/renderer/store';
  import { selectWorkspaceTaskProgress } from '$store/renderer/slices/workspace-tasks/workspace-tasks-selectors';
  import { ensureWorkspaceTasksLoaded } from '$store/renderer/slices/workspace-tasks/workspace-tasks-slice';

  interface Props {
    workspaceId: string;
    onCreateNote?: () => void;
    onCreateFile?: (folderPath: string, fileName?: string) => void | Promise<void>;
    onFileRenamed?: (oldPath: string, newPath: string) => void;
    isNewWorkspaceSession?: boolean;
    onCreateAgent?: () => void;
    onCreateAgentWithSpecialist?: (specialistId: string | null) => void;
    onAcceptChanges?: () => void;
    class?: string;
  }

  let {
    workspaceId,
    onCreateNote,
    onCreateFile,
    onFileRenamed,
    isNewWorkspaceSession = false,
    onCreateAgent,
    onCreateAgentWithSpecialist,
    onAcceptChanges,
    class: className,
  }: Props = $props();


  // Reactive writable store that mirrors workspaceId so Redux selectors
  // re-evaluate whenever the prop changes (called at component init time).
  const workspaceIdStore = writable(workspaceId);
  $effect(() => {
    workspaceIdStore.set(workspaceId);
  });
  const fileExplorerWorkspacePath = selectEffectiveFileExplorerWorkspacePath(workspaceIdStore);

  // Transient signal: panel tab "Reveal in Sidebar" → scroll & highlight.
  const pendingLocateInSidebar$ = selectPendingLocateInSidebar();

  // Tab definitions with metadata for tooltips
  interface TabDefinition {
    id: string;
    label: string;
    icon: IconDefinition;
    description: string;
    hideLabel?: boolean; // Hide label even at wide widths
    hideHeader?: boolean; // Show header even when only one tab is selected
  }

  const TAB_DEFINITIONS: TabDefinition[] = [
    {
      id: 'overview',
      label: 'Overview',
      icon: faAsterisk,
      description: 'Workspace status, progress, and key metrics at a glance.',
      hideLabel: true,
      hideHeader: true,
    },
    {
      id: 'agents',
      label: 'Agents',
      icon: faRobot,
      description: 'Agents working on your task in this space.',
    },
    {
      id: 'context',
      label: 'Context',
      icon: faNote,
      description: 'Notes about the task, shared with all agents in this space.',
    },
    {
      id: 'changes',
      label: 'Changes',
      icon: faPencil,
      description: 'Files changed manually or by agents working in this space.',
    },
    {
      id: 'files',
      label: 'Files',
      icon: faFolderTree,
      description: 'The agents in this space are working off a copy of your files.',
    },
  ];

  type TabId = (typeof TAB_DEFINITIONS)[number]['id'];

  const defaultTabOrder = TAB_DEFINITIONS.map((t) => t.id as TabId);

  function isValidTabId(value: string): value is TabId {
    return TAB_DEFINITIONS.some((tab) => tab.id === value);
  }

  function normalizeTabOrder(order: string[]): TabId[] {
    if (order.length === defaultTabOrder.length && defaultTabOrder.every((id) => order.includes(id))) {
      return order.filter(isValidTabId);
    }
    return defaultTabOrder;
  }

  function normalizeSelectedTabs(tabIds: string[]): Set<TabId> {
    const normalized = tabIds.filter(isValidTabId);
    return new Set(normalized.length > 0 ? normalized : ['overview']);
  }

  // Redux selectors called at init time with a Readable store arg —
  // auto-subscribe in templates/derivations via $workspace, $notes, etc.
  const workspace = selectWorkspaceById(workspaceIdStore);
  const notes = selectAllNotes(workspaceIdStore);
  const notesLoading$ = selectNotesLoading(workspaceIdStore);
  const allWorkspaceAgents = selectAllWorkspaceAgents(workspaceIdStore);
  const foregroundWorkspaceAgents = selectForegroundWorkspaceAgents(workspaceIdStore);
  const agentsLoading = selectIsLoadingAgents(workspaceIdStore);
  const selectedTabIds = selectMultiSelectSidebarSelectedTabIds(workspaceIdStore);
  const persistedTabOrder = selectMultiSelectSidebarTabOrder();
  const selectedTabs = $derived(normalizeSelectedTabs($selectedTabIds));
  const tabOrder = $derived(normalizeTabOrder($persistedTabOrder));
  let previousWorkspaceId = $state<string | null>(null);

  function isAgentCurrentlyRunning(agentId: string): boolean {
    const state = appStore.state;
    const isWaiting = selectAgentIsWaiting.select(state, agentId);
    return selectAgentIsResponding.select(state, agentId) && !isWaiting;
  }

  function getLiveAgentAvatarState(agent: { id: string; status?: string }): AvatarState {
    const state = appStore.state;
    const isWaiting = selectAgentIsWaiting.select(state, agent.id);
    const isResponding = selectAgentIsResponding.select(state, agent.id);
    return getAvatarState({
      isStreaming: isResponding && !isWaiting,
      status: isWaiting ? 'waiting' : agent.status,
    });
  }
  // Drag state for tab reordering
  let draggedTabId = $state<TabId | null>(null);
  let dropIndicator = $state<{ tabId: TabId; position: 'before' | 'after' } | null>(null);

  // Get ordered tab definitions based on current order
  const orderedTabDefinitions = $derived(
    tabOrder.map((id) => TAB_DEFINITIONS.find((t) => t.id === id)!).filter(Boolean),
  );

  // Dynamic tab description overrides for coordinator mode
  function getTabDescription(tabId: string, defaultDescription: string): string {
    if (tabId === 'agents' && isCoordinator)
      return 'A coordinator agent writes a spec and manages the work of different agents.';
    return defaultDescription;
  }

  // Track previous single tab for fly direction
  let flyDirection = $state<number>(0); // -1 = left, 1 = right, 0 = no fly
  // Track if we're doing a multi-panel transition (either before or after has multiple panels)
  let useSlideTransition = $state(false);

  // Compute fly transition params from plain $state reads. Transition param expressions
  // are evaluated at element teardown, outside reactive context, so they must not read
  // deriveds (e.g. {@const}) or Svelte warns with derived_inert.
  function flyParams(sign: 1 | -1) {
    const useFly = !useSlideTransition && flyDirection !== 0;
    return { x: useFly ? sign * flyDirection * 30 : 0, duration: useFly ? 200 : 0 };
  }

  // Helper to get tab index for direction calculation (uses dynamic order)
  function getTabIndex(tabId: TabId): number {
    return tabOrder.indexOf(tabId);
  }

  // Drag handlers for tab reordering
  function handleDragStart(tabId: TabId, event: DragEvent) {
    draggedTabId = tabId;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', tabId);
    }
  }

  function handleDragOver(tabId: TabId, event: DragEvent) {
    event.preventDefault();
    if (!draggedTabId || draggedTabId === tabId) {
      dropIndicator = null;
      return;
    }

    // Determine if dropping before or after based on mouse position
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const midpoint = rect.left + rect.width / 2;
    const position = event.clientX < midpoint ? 'before' : 'after';

    dropIndicator = { tabId, position };
  }

  function handleDragLeave(event: DragEvent) {
    // Only clear if leaving the tab bar entirely
    const relatedTarget = event.relatedTarget as HTMLElement | null;
    if (!relatedTarget?.closest('.tab-bar-container')) {
      dropIndicator = null;
    }
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    if (!draggedTabId || !dropIndicator) {
      draggedTabId = null;
      dropIndicator = null;
      return;
    }

    const { tabId: targetTabId, position } = dropIndicator;

    // Reorder tabs
    const newOrder = [...tabOrder];
    const draggedIndex = newOrder.indexOf(draggedTabId);
    let targetIndex = newOrder.indexOf(targetTabId);

    if (draggedIndex !== -1 && targetIndex !== -1) {
      // Remove dragged item first
      newOrder.splice(draggedIndex, 1);

      // Recalculate target index after removal
      targetIndex = newOrder.indexOf(targetTabId);

      // Insert at the correct position
      const insertIndex = position === 'after' ? targetIndex + 1 : targetIndex;
      newOrder.splice(insertIndex, 0, draggedTabId);

      appStore.dispatch(setMultiSelectSidebarTabOrder(newOrder));
    }

    draggedTabId = null;
    dropIndicator = null;
  }

  function handleDragEnd() {
    draggedTabId = null;
    dropIndicator = null;
  }

  // Reload selected tabs when workspace changes
  $effect(() => {
    const currentWorkspaceId = workspaceId;
    if (!currentWorkspaceId) {
      previousWorkspaceId = null;
      // Reset fly/slide state to prevent overlapping panels
      flyDirection = 0;
      useSlideTransition = false;
      return;
    }
    if (currentWorkspaceId !== previousWorkspaceId) {
      previousWorkspaceId = currentWorkspaceId;
      // Reset fly/slide state to prevent overlapping panels after workspace switch
      flyDirection = 0;
      useSlideTransition = false;
    }
  });

  function persistSelectedTabs(nextSelectedTabs: Set<TabId>) {
    if (!workspaceId) return;
    appStore.dispatch(setMultiSelectSidebarSelectedTabs(workspaceId, [...nextSelectedTabs]));
  }

  function handleTabClick(tabId: TabId, event: MouseEvent) {
    const wasMultiPanel = selectedTabs.size > 1;
    const wasSingleTab = selectedTabs.size === 1;
    const previousTabId = wasSingleTab ? [...selectedTabs][0] : null;
    let nextSelectedTabs: Set<TabId>;

    if (event.shiftKey) {
      nextSelectedTabs = new Set(selectedTabs);
      // Shift+click: toggle this tab in/out of selection
      if (nextSelectedTabs.has(tabId)) {
        // Don't allow deselecting the last tab
        if (nextSelectedTabs.size > 1) {
          nextSelectedTabs.delete(tabId);
        }
      } else {
        nextSelectedTabs.add(tabId);
      }
      // No fly animation for multi-select operations
      flyDirection = 0;
    } else {
      // Regular click: select only this tab
      // Calculate fly direction based on tab order
      if (wasSingleTab && previousTabId && previousTabId !== tabId) {
        const prevIndex = getTabIndex(previousTabId);
        const newIndex = getTabIndex(tabId);
        flyDirection = newIndex > prevIndex ? 1 : -1;
      } else {
        flyDirection = 0;
      }
      nextSelectedTabs = new Set([tabId]);
    }

    // Determine if this is a multi-panel transition
    // Use slide if EITHER before or after has multiple panels
    const isMultiPanel = nextSelectedTabs.size > 1;
    useSlideTransition = wasMultiPanel || isMultiPanel;
    persistSelectedTabs(nextSelectedTabs);
  }

  function isTabSelected(tabId: TabId): boolean {
    return selectedTabs.has(tabId);
  }

  function switchToTab(tabId: string) {
    const id = tabId as TabId;
    if (!TAB_DEFINITIONS.find((t) => t.id === id)) return;
    const wasSingleTab = selectedTabs.size === 1;
    const previousTabId = wasSingleTab ? [...selectedTabs][0] : null;
    if (wasSingleTab && previousTabId && previousTabId !== id) {
      const prevIndex = getTabIndex(previousTabId);
      const newIndex = getTabIndex(id);
      flyDirection = newIndex > prevIndex ? 1 : -1;
    } else {
      flyDirection = 0;
    }
    useSlideTransition = selectedTabs.size > 1;
    persistSelectedTabs(new Set([id]));
  }

  // Core state and handlers (same as StackedSidebar)
  const ftCurrentWsId$ = selectCurrentWorkspaceId();
  const ftStagedChanges$ = selectCurrentStagedWorkingChanges();
  const ftUnstagedChanges$ = selectCurrentUnstagedWorkingChanges();
  const ftCommits$ = selectCurrentCommits();
  const storeHasCorrectWorkspace = $derived($ftCurrentWsId$ === workspaceId);

  // Canonical task progress for phase/stats derivation.
  const workspaceTaskProgress$ = selectWorkspaceTaskProgress(workspaceIdStore);
  $effect(() => {
    if (!workspaceId) return;
    appStore.dispatch(ensureWorkspaceTasksLoaded(String(workspaceId)));
  });

  // Workspace phase derivation for Overview tab
  // Memoize to avoid creating new object references on every evaluation
  const defaultPhaseInfo: WorkspacePhaseInfo = {
    phase: 'planning',
    label: 'Planning',
    subtitle: 'Describe what you want to build',
    isActive: false,
  };
  const defaultPhaseStats: WorkspacePhaseStats = {
    tasks: { total: 0, completed: 0, inProgress: 0, notStarted: 0 },
    files: { changed: 0, additions: 0, deletions: 0 },
    commits: { total: 0, unpushed: 0 },
    pr: { hasOpen: false, hasMerged: false, hasClosed: false },
  };
  let cachedPhaseInfo: WorkspacePhaseInfo = defaultPhaseInfo;
  let cachedPhaseStats: WorkspacePhaseStats = defaultPhaseStats;
  // Working changes/commits from the canonical changes slice (current-workspace scoped).
  const phaseChangedFiles = $derived(
    storeHasCorrectWorkspace ? [...$ftStagedChanges$, ...$ftUnstagedChanges$] : undefined,
  );
  const phaseCommits = $derived(storeHasCorrectWorkspace ? $ftCommits$ : undefined);
  const workspacePhaseInfo = $derived.by(() => {
    if (!$workspace) return defaultPhaseInfo;
    const hasActiveAgents = $allWorkspaceAgents.some((a) => isAgentCurrentlyRunning(a.id));
    const next = deriveWorkspacePhase($workspace, {
      hasActiveAgents,
      taskProgress: $workspaceTaskProgress$,
      hasChangedFiles: phaseChangedFiles ? phaseChangedFiles.length > 0 : undefined,
    });
    if (
      next.phase !== cachedPhaseInfo.phase ||
      next.label !== cachedPhaseInfo.label ||
      next.subtitle !== cachedPhaseInfo.subtitle ||
      next.isActive !== cachedPhaseInfo.isActive
    ) {
      cachedPhaseInfo = next;
    }
    return cachedPhaseInfo;
  });
  const workspacePhaseStats = $derived.by(() => {
    if (!$workspace) return defaultPhaseStats;
    const next = deriveWorkspaceStats($workspace, {
      taskProgress: $workspaceTaskProgress$,
      files: phaseChangedFiles
        ? {
            changed: phaseChangedFiles.length,
            additions: phaseChangedFiles.reduce((sum, c) => sum + (c.stats?.additions ?? 0), 0),
            deletions: phaseChangedFiles.reduce((sum, c) => sum + (c.stats?.deletions ?? 0), 0),
          }
        : undefined,
      commits: phaseCommits
        ? {
            total: phaseCommits.length,
            unpushed: phaseCommits.filter((c) => !(c.isPushed ?? (c.stage !== 'local'))).length,
          }
        : undefined,
    });
    if (JSON.stringify(next) !== JSON.stringify(cachedPhaseStats)) {
      cachedPhaseStats = next;
    }
    return cachedPhaseStats;
  });
  const panelLayoutManager = $derived(getPanelLayoutManager(workspaceId));
  // Use reactive selector subscription for focused tab state
  const activeTab$ = selectActiveTab(workspaceIdStore);
  // Derive individual fields from the reactive activeTab selector
  const focusedContentType = $derived($activeTab$?.type ?? null);
  const focusedContentNoteId = $derived($activeTab$?.noteId ?? null);
  const focusedContentAgentId = $derived($activeTab$?.agentId ?? null);
  const focusedContentFilePath = $derived($activeTab$?.filePath ?? null);
  const focusedContentDiffPath = $derived($activeTab$?.diffPath ?? null);
  let lastInitializedNotesWorkspaceId: string | null = null;

  $effect(() => {
    if (!workspaceId || lastInitializedNotesWorkspaceId === workspaceId) return;
    lastInitializedNotesWorkspaceId = workspaceId;
    const initialSelectedNoteId = focusedContentType === 'note' ? focusedContentNoteId : undefined;
    appStore.dispatch(initializeNotes(workspaceId, initialSelectedNoteId ?? undefined));
  });

  const effectiveSelectedNoteId = $derived(
    focusedContentType === 'note' ? focusedContentNoteId : null,
  );
  const effectiveSelectedAgentId = $derived(
    focusedContentType === 'agent' ? focusedContentAgentId : null,
  );
  const effectiveSelectedFile = $derived(
    focusedContentType === 'file' ? focusedContentFilePath : null,
  );
  const effectiveActiveFilePath = $derived.by(() => {
    if (focusedContentType === 'diff' && focusedContentDiffPath) {
      return focusedContentDiffPath;
    }
    return null;
  });
  const effectiveActiveFileStaged = $derived.by(() => {
    if (focusedContentType === 'diff' && focusedContentDiffPath) {
      const diffPath = focusedContentDiffPath;
      const isInStaged = stagedChanges.some(
        (c) => c.file === diffPath || c.relativePath === diffPath,
      );
      if (isInStaged) return true;
      const isInUnstaged = unstagedChanges.some(
        (c) => c.file === diffPath || c.relativePath === diffPath,
      );
      if (isInUnstaged) return false;
      return null;
    }
    return null;
  });
  const effectiveIsAllChangesViewActive = $derived(focusedContentType === 'local-changes');
  const effectiveActiveCommitHash = $derived.by(() => {
    const tab = $activeTab$;
    if (tab?.type === 'changes' && tab.data?.commitHash) {
      return tab.data.commitHash as string;
    }
    return null;
  });

  // Panel open handlers
  function handleOpenAgentInPanel(agentId: string) {
    const agent = $allWorkspaceAgents.find((a) => a.id === agentId);
    if (!agent) return;
    panelLayoutManager.openTab({
      type: 'agent',
      title: agent.name || `Agent ${agentId.substring(0, 8)}`,
      closable: true,
      agentId,
      workspaceId,
    });
  }

  function handleOpenNoteInPanel(noteId: string) {
    const note = $notes.find((n) => n.id === noteId);
    const title = note?.title || 'Note';
    panelLayoutManager.openTab({
      type: 'note',
      title,
      closable: true,
      noteId,
      workspaceId,
    });

    // Mark note as read when opened to clear unread indicator
    appStore.dispatch(markNoteRead(workspaceId, noteId));
  }

  function handleOpenFileInPanel(filePath: string) {
    const fileName = filePath.split('/').pop() || filePath;
    panelLayoutManager.openTab({
      type: 'file',
      title: fileName,
      closable: true,
      filePath,
      workspaceId,
    });

    track('Opened File', {
      workspace_id: workspaceId,
      file_extension: getFileExtension(filePath),
      source: 'sidebar',
    });
  }

  function handleOpenCodeReviewInPanel() {
    panelLayoutManager.openTab({
      type: 'code-review',
      title: 'Code Review',
      closable: true,
      workspaceId,
    });
  }

  function handleOpenAgentOverview() {
    panelLayoutManager.openTab({
      type: 'agent-overview',
      title: 'Agent Overview',
      closable: true,
      workspaceId,
    });
  }

  // Working changes for badges
  const stagedChanges = $derived(storeHasCorrectWorkspace ? ($ftStagedChanges$ ?? []) : []);
  const unstagedChanges = $derived(storeHasCorrectWorkspace ? ($ftUnstagedChanges$ ?? []) : []);
  const allCommits = $derived(storeHasCorrectWorkspace ? ($ftCommits$ ?? []) : []);

  // Memoize activeAgents to avoid creating new array references when contents haven't changed
  let cachedActiveAgents: Array<{ agent: (typeof $allWorkspaceAgents)[number]; state: string }> =
    [];
  const activeAgents = $derived.by(() => {
    const newResult = $allWorkspaceAgents
      .map((agent) => {
        const state = getLiveAgentAvatarState(agent);
        return { agent, state };
      })
      .filter(({ state }) => state === 'running' || state === 'responding' || state === 'unread');
    // Only update reference if contents changed
    if (
      newResult.length !== cachedActiveAgents.length ||
      newResult.some(
        (item, i) =>
          item.agent.id !== cachedActiveAgents[i]?.agent.id ||
          item.state !== cachedActiveAgents[i]?.state,
      )
    ) {
      cachedActiveAgents = newResult;
    }
    return cachedActiveAgents;
  });

  // Agent badge state - green if running, blue if unread
  const hasRunningAgents = $derived(
    activeAgents.some(({ state }) => state === 'running' || state === 'responding'),
  );
  const hasUnreadAgents = $derived(activeAgents.some(({ state }) => state === 'unread'));
  const coordinatorAgent = $derived(
    $foregroundWorkspaceAgents.find(
      (a) => a.metadata?.isInitialAgent === true || a.metadata?.isInitialWorkspaceAgent === true,
    ) || ($foregroundWorkspaceAgents.length === 1 ? $foregroundWorkspaceAgents[0] : null),
  );
  const isCoordinator = $derived(coordinatorAgent?.metadata?.specialist === 'spec-writer');

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async function handleArchiveWorkspace() {
    if (!$workspace) return;
    const { toast } = await import('svelte-sonner');
    const workspaceTitle = $workspace.title || 'space';

    const result = await workspaceClient.archive($workspace.id);
    if (result.ok) {
      appStore.dispatch(loadWorkspacesRequested());
      toast.warning(`Archived space ${workspaceTitle}`, {
        duration: 15000,
        action: {
          label: 'Undo',
          onClick: async () => {
            const undoResult = await workspaceClient.unarchive($workspace.id);
            if (undoResult.ok) {
              appStore.dispatch(loadWorkspacesRequested());
            }
          },
        },
      });
      goto('/');
    } else {
      toast.error('Failed to archive space');
    }
  }

  // Changed files count
  const changedFilesCount = $derived(
    unstagedChanges.length +
      stagedChanges.length +
      allCommits.reduce((sum, c) => sum + (c.files?.length || 0), 0),
  );

  // File panel state
  let showOnlyChangedFiles = $state(false);
  let fileSearchQuery = $state('');
  let fileSearchInputRef: Input | null = $state(null);
  let filesPanelRef: FilesPanel | null = $state(null);
  let filesExpandedTick = $state(0);

  const hasExpandedDirectories = $derived.by(() => {
    void filesExpandedTick;
    return filesPanelRef?.getHasExpandedDirectories() ?? false;
  });

  // Sidebar element ref
  let sidebarElement: HTMLDivElement | null = $state(null);

  // Map registry sidebar tab IDs to MultiSelectTabbedSidebar tab IDs
  function mapSidebarTabId(registryTabId: string): TabId | null {
    const mapping: Record<string, TabId> = {
      notes: 'context',
      agents: 'agents',
      files: 'files',
      terminals: 'agents', // terminals don't have their own tab, fall back to agents
      changes: 'changes',
      browser: 'agents',
    };
    return mapping[registryTabId] ?? null;
  }

  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey && e.shiftKey && e.key === 'c') {
        e.preventDefault();
        const workspacePath = selectEffectiveFileExplorerWorkspacePath.select(appStore.state, workspaceId);
        if (workspacePath) {
          navigator.clipboard.writeText(workspacePath);
          import('$lib/components/ui/toast').then(({ toast }) => {
            toast.success('Path copied to clipboard');
          });
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  });

  // Handle "Reveal in Sidebar" requests dispatched from panel tab context menus.
  $effect(() => {
    const pending = $pendingLocateInSidebar$;
    if (!pending) return;
    if (pending.workspaceId !== workspaceId) return;

    const { sidebarTabId, type, noteId, filePath, agentId } = pending.target;

    // Switch to the appropriate sidebar tab
    const targetTab = mapSidebarTabId(sidebarTabId);
    if (targetTab) {
      persistSelectedTabs(new Set([targetTab]));
    }

    // Scroll to the item after a short delay to allow tab switch to render
    const timeoutId = setTimeout(() => {
      let selector: string | null = null;

      switch (type) {
        case 'note':
          if (noteId) selector = `[data-note-id="${noteId}"]`;
          break;
        case 'file':
        case 'diff':
          if (filePath) selector = `[data-file-path="${CSS.escape(filePath)}"]`;
          break;
        case 'agent':
          if (agentId) selector = `[data-agent-id="${agentId}"]`;
          break;
      }

      if (selector && sidebarElement) {
        const element = sidebarElement.querySelector(selector);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // Add a brief highlight effect
          element.classList.add('sidebar-locate-highlight');
          setTimeout(() => {
            element.classList.remove('sidebar-locate-highlight');
          }, 1500);
        }
      }
      appStore.dispatch(locateItemInSidebarConsumed(workspaceId));
    }, 150);

    return () => {
      clearTimeout(timeoutId);
    };
  });
  // Refresh unread notes — only dispatch when note data actually changes
  let lastRefreshKey: string | undefined;
  $effect(() => {
    if (workspaceId && $notes.length > 0) {
      const trackableNotes = $notes.filter((n) => !isSpecNote(n.id as string));
      const notesWithTimestamps = trackableNotes.map((n) => ({
        id: n.id as string,
        updatedAt: n.updatedAt || n.updated_at || n.createdAt || n.created_at || '',
        createdAt: n.createdAt || n.created_at,
      }));
      const refreshKey =
        workspaceId + ':' + notesWithTimestamps.map((n) => n.id + ':' + n.updatedAt).join(',');
      if (refreshKey !== lastRefreshKey) {
        lastRefreshKey = refreshKey;
        appStore.dispatch(refreshUnreadNotes(workspaceId, notesWithTimestamps));
      }
    }
  });

  // Count of selected tabs for layout calculation
  const selectedTabCount = $derived(selectedTabs.size);
  const orderedSelectedTabs = $derived(tabOrder.filter((id) => selectedTabs.has(id)));
</script>

<div bind:this={sidebarElement} class={cn('flex flex-col h-full bg-sidebar', className)}>
  <!-- Fixed Top Section: Progress Card -->
  <div class="shrink-0 px-4 pb-3 pt-3">
    <WorkspaceProgressCard {workspaceId} onOpenNote={handleOpenNoteInPanel} />
  </div>

  {#if !isNewWorkspaceSession}
    <!-- Multi-Select Tab Bar -->
    <div class="shrink-0 flex items-center px-4">
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="tab-bar-container flex items-center gap-px p-0.5 bg-muted/50 flex-1">
        {#each orderedTabDefinitions as tab (tab.id)}
          {@const isSelected = isTabSelected(tab.id)}
          {@const isDragging = draggedTabId === tab.id}
          {@const showDropBefore =
            dropIndicator?.tabId === tab.id && dropIndicator?.position === 'before'}
          {@const showDropAfter =
            dropIndicator?.tabId === tab.id && dropIndicator?.position === 'after'}
          <!-- Drop indicator before this tab -->
          {#if showDropBefore}
            <div class="drop-indicator"></div>
          {/if}
          <button
            type="button"
            draggable="true"
            class={cn(
              'relative flex items-center justify-center gap-1.5 py-1.5 h-7.5 rounded-mdx text-xs font-medium transition-all duration-150 cursor-pointer focus:ring-0 active:ring-0',
              'focus-visible:outline-none focus-visible:ring-0',
              tab.hideLabel ? 'px-2' : 'px-3',
              isSelected
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-background/50',
              isDragging && 'opacity-50 cursor-grabbing',
              tab.hideLabel ? 'shrink-0' : 'flex-1 shrink-0',
            )}
            onclick={(e) => {
              handleTabClick(tab.id, e);
            }}
            ondragstart={(e) => handleDragStart(tab.id, e)}
            ondragover={(e) => handleDragOver(tab.id, e)}
            ondragleave={(e) => handleDragLeave(e)}
            ondrop={(e) => handleDrop(e)}
            ondragend={handleDragEnd}
            data-testid={tab.id === 'agents' ? 'agent-panel-toggle' : undefined}
          >
            <div class={cn('shrink-0 opacity-50', tab.hideLabel ? '' : 'tab-icon')}>
              <Fa icon={tab.icon} class="size-3.5" />
            </div>
            {#if !tab.hideLabel}
              <!-- Responsive labels - hidden at narrow widths via container query -->
              <span class="tab-label truncate">{tab.label}</span>
            {/if}
            <!-- Badges for specific tabs - inline when wide, absolute when narrow -->
            {#if tab.id === 'agents' && (hasRunningAgents || hasUnreadAgents)}
              <div
                class={cn(
                  'tab-badge tab-badge--agents size-1.5 rounded-full z-10 shrink-0',
                  hasRunningAgents ? 'bg-emerald-500' : 'bg-blue-500',
                )}
              ></div>
            {/if}
            {#if tab.id === 'changes' && changedFilesCount > 0}
              <div
                class="tab-badge min-w-4 h-4 px-1 rounded-full bg-background text-subtle text-[0.65rem] font-semibold flex items-center justify-center z-10 shrink-0"
              >
                <AnimatedNumber value={changedFilesCount} />
              </div>
            {/if}
          </button>

          <!-- Drop indicator after this tab -->
          {#if showDropAfter}
            <div class="drop-indicator"></div>
          {/if}
        {/each}
      </div>
    </div>

    <!-- Stacked Panels (scrollable container) -->
    <!-- Use grid with overlapping cells when flying so panels don't stack -->
    {@html '<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->'}
    <div
      role="presentation"
      class={cn(
        'w-full min-w-0 flex-1 flex flex-col overflow-y-auto overflow-x-hidden',
        !useSlideTransition && flyDirection !== 0 && 'grid *:col-start-1 *:row-start-1',
      )}
    >
      {#each orderedSelectedTabs as tabId, index (tabId)}
        {@const tab = TAB_DEFINITIONS.find((t) => t.id === tabId)}
        {@const isLast = index === selectedTabCount - 1}
        <!-- Outer wrapper for fly transition (single panel switches) -->
        <div
          class={cn('w-full min-w-0 flex flex-col px-2', !isLast && 'border-b border-border')}
          in:fly={flyParams(1)}
          out:fly={flyParams(-1)}
        >
          <!-- Inner wrapper for slide transition (multi-panel add/remove) -->
          <div
            class="flex-1 flex flex-col h-full"
            transition:slide={{ axis: 'y', duration: useSlideTransition ? 200 : 0 }}
          >
            <!-- Panel header/description -->
            {#if tab && !tab.hideHeader}
              <div class="px-5 pt-3 pb-1">
                <h6
                  class="text-sm font-semibold text-foreground flex items-center gap-2 mb-0.5 mt-2"
                >
                  {#if tabId === 'agents' && isCoordinator}
                    Agent orchestration
                  {:else}
                    {tab.label}
                  {/if}
                  {#if tabId === 'agents' && (onCreateAgent || onCreateAgentWithSpecialist)}
                    <span class="ml-auto">
                      <CreateAgentSection
                        onCreate={onCreateAgent}
                        onCreateWithSpecialist={onCreateAgentWithSpecialist}
                        compact
                      />
                    </span>
                  {:else if tabId === 'context'}
                    <span class="ml-auto">
                      <AddContextSection
                        onAddNote={onCreateNote}
                        onOpenBrowser={() => {
                          const defaultUrl = 'about:blank';
                          const now = new Date().toISOString();
                          const newItem = {
                            type: 'browser-url' as const,
                            provider: 'browser' as const,
                            title: 'Browser',
                            url: defaultUrl,
                            id: uuidv4(),
                            createdAt: now,
                            updatedAt: now,
                          };
                          appStore.dispatch(addContextItem(workspaceId, newItem));
                          const layoutManager = getPanelLayoutManager(workspaceId);
                          layoutManager.openBrowserPanel(defaultUrl, newItem.id);
                        }}
                        compact
                      />
                    </span>
                  {/if}
                </h6>
                <p class="text-ui text-subtle mt-0.5 leading-snug transition-all duration-200">
                  {#if tabId === 'context' && $workspace?.isRemote}
                    {getTabDescription(tab.id, tab.description)} Your notes live on
                    <span class="font-mono text-subtle"
                      >{$workspace.environmentConfig?.ssh?.host
                        ? `${$workspace.environmentConfig.ssh.host}:`
                        : ''}{$workspace.id}/.workspace</span
                    >.
                  {:else if tabId === 'context' && $workspace?.path}
                    {getTabDescription(tab.id, tab.description)} Your notes live in
                    <span class="inline-flex items-baseline gap-1">
                      <OpenComboButton
                        filePath={$workspace.path + '/.workspace'}
                        isDirectory={true}
                        variant="sidebar"
                        compact
                        class="inline-flex"
                      >
                        <span
                          class="text-inherit underline underline-offset-2 decoration-muted-foreground/20"
                          >/{$workspace.path.split(/[/\\]/).slice(-1)[0]}/.workspace</span
                        >
                      </OpenComboButton></span
                    >.
                  {:else if tabId === 'files' && $fileExplorerWorkspacePath}
                    {$workspace?.skipWorktree
                      ? 'Working directly in'
                      : 'The workspace contains a copy of your repo that lives in'}
                    <span class="inline-flex items-baseline gap-1">
                      <OpenComboButton
                        filePath={$fileExplorerWorkspacePath}
                        isDirectory={true}
                        variant="sidebar"
                        compact
                        class="inline-flex"
                      >
                        <span
                          class="text-inherit underline underline-offset-2 decoration-muted-foreground/20"
                          >/{$fileExplorerWorkspacePath.split(/[/\\]/).slice(-2).join('/')}</span
                        >
                      </OpenComboButton></span
                    >.
                  {:else}
                    {getTabDescription(tab.id, tab.description)}
                  {/if}
                </p>
              </div>
            {/if}
            <!-- Panel content -->
            <!-- {#key workspaceId} forces remount of agent-related panels on workspace switch,
                 ensuring onMount stream listeners and subscriptions rebind correctly -->
            {#key workspaceId}
              <div class="h-full pt-2 pb-6">
                {#if tabId === 'overview'}
                  {@const overviewAgents = $allWorkspaceAgents.map((agent) => {
                    const state = getLiveAgentAvatarState(agent);
                    const specialist = (agent.metadata?.specialist as string) || null;
                    const validSpecialist =
                      specialist === 'spec-writer' ||
                      specialist === 'implementor' ||
                      specialist === 'verifier' ||
                      specialist === 'ui-designer'
                        ? (specialist as 'spec-writer' | 'implementor' | 'verifier' | 'ui-designer')
                        : null;
                    return {
                      id: agent.id,
                      name: agent.name,
                      specialist: validSpecialist,
                      state,
                      isActive: state === 'running' || state === 'responding',
                      isInitialAgent:
                        agent.metadata?.isInitialAgent === true ||
                        agent.metadata?.isInitialWorkspaceAgent === true,
                      isBackground: agent.metadata?.isBackground === true,
                      parentAgentId: (agent.metadata?.createdByAgentId as string) || null,
                      hasUnread: agent.hasUnread === true,
                      digest: agent.digest || undefined,
                      statusLabel:
                        state === 'waiting'
                          ? 'waiting'
                          : state === 'running' || state === 'responding'
                            ? 'running'
                            : 'idle',
                      waitingForCount: agent.metadata?.delegatedAgentIds
                        ? (agent.metadata.delegatedAgentIds as string[]).length
                        : 0,
                    };
                  })}
                  {@const overviewChangedFiles = [
                    ...unstagedChanges.map((c) => ({
                      path: c.relativePath || c.file,
                      additions: c.stats?.additions ?? 0,
                      deletions: c.stats?.deletions ?? 0,
                      status: c.status,
                      staged: false,
                    })),
                    ...stagedChanges
                      .filter(
                        (s) =>
                          !unstagedChanges.some(
                            (u) => u.file === s.file || u.relativePath === s.relativePath,
                          ),
                      )
                      .map((c) => ({
                        path: c.relativePath || c.file,
                        additions: c.stats?.additions ?? 0,
                        deletions: c.stats?.deletions ?? 0,
                        status: c.status,
                        staged: true,
                      })),
                  ]}
                  <OverviewTimelinePanel
                    workspace={$workspace}
                    phase={workspacePhaseInfo}
                    stats={workspacePhaseStats}
                    notes={$notes}
                    agents={overviewAgents}
                    changedFiles={overviewChangedFiles}
                    commits={allCommits.map((c) => ({
                      hash: c.hash || '',
                      message: c.message || '',
                    }))}
                    selectedNoteId={effectiveSelectedNoteId}
                    selectedAgentId={effectiveSelectedAgentId}
                    selectedFilePath={effectiveSelectedFile}
                    activeFilePath={effectiveActiveFilePath}
                    activeCommitHash={effectiveActiveCommitHash}
                    agentsLoading={$agentsLoading}
                    notesLoading={$notesLoading$}
                    changesLoading={!storeHasCorrectWorkspace}
                    onSwitchTab={switchToTab}
                    onOpenNote={(noteId) => handleOpenNoteInPanel(noteId)}
                    onOpenAgent={(agentId) => handleOpenAgentInPanel(agentId)}
                    onOpenFile={(filePath) => {
                      appStore.dispatch(
                        openWorkspaceDiff(workspaceId, { file: filePath } as never, { filePath }),
                      );
                    }}
                    onOpenAllChanges={() =>
                      appStore.dispatch(openWorkspaceLocalChanges(workspaceId))}
                    onOpenCommit={(hash) => {
                      appStore.dispatch(openWorkspaceCommitChangeset(workspaceId, hash));
                    }}
                    onOpenFileInPanel={handleOpenFileInPanel}
                    onOpenAgentOverview={handleOpenAgentOverview}
                  />
                {:else if tabId === 'agents'}
                  <div class="px-3 transition-all duration-200" data-testid="agent-panel">
                    <WorkspaceAgentsList
                      agents={$allWorkspaceAgents}
                      loading={$agentsLoading}
                      selectedAgentId={effectiveSelectedAgentId}
                      onSelect={({ agentId }) => handleOpenAgentInPanel(agentId)}
                      onOpenAgentOverview={handleOpenAgentOverview}
                    />
                  </div>
                {:else if tabId === 'context'}
                  <div class="px-3 transition-all duration-200">
                    <ContextPanel
                      notes={$notes}
                      {workspaceId}
                      selectedNoteId={effectiveSelectedNoteId}
                      onOpenNote={handleOpenNoteInPanel}
                      onOpenAgent={handleOpenAgentInPanel}
                      {onCreateNote}
                      loading={$notesLoading$}
                      showAddSection={false}
                    />
                  </div>
                {:else if tabId === 'changes'}
                  <div class="px-2.5 flex-1 h-full flex flex-col transition-all duration-200">
                    <div class="w-full flex-1">
                      <SidebarChangesPanel
                        {workspaceId}
                        activeFilePath={effectiveActiveFilePath}
                        activeFileStaged={effectiveActiveFileStaged}
                        isAllChangesViewActive={effectiveIsAllChangesViewActive}
                        onOpenChange={(change) => {
                          appStore.dispatch(
                            openWorkspaceDiff(workspaceId, change as never, {
                              filePath: change.relativePath || change.file,
                              changeId: change.id,
                            }),
                          );
                        }}
                        onOpenFullPanel={onAcceptChanges}
                        onOpenNote={handleOpenNoteInPanel}
                        onOpenCodeReview={handleOpenCodeReviewInPanel}
                      />
                    </div>
                  </div>
                {:else if tabId === 'files'}
                  <div class="px-3 transition-all duration-200">
                    <!-- File filter controls -->
                    <div class="pb-2 flex items-center gap-2">
                      <div class="flex-1 relative">
                        <Fa
                          icon={faSearch}
                          class="absolute left-2.5 top-1/2 -translate-y-1/2 w-2.5 h-2.5 text-ghost"
                        />
                        <Input
                          bind:this={fileSearchInputRef}
                          bind:value={fileSearchQuery}
                          type="text"
                          placeholder="Search files..."
                          class="h-7 pl-7 pr-6 text-xs bg-transparent! border-0 placeholder:text-muted-foreground/50!"
                          noFocusStyle
                          onkeydown={(e: KeyboardEvent) => filesPanelRef?.handleSearchKeyDown(e)}
                        />
                        {#if fileSearchQuery}
                          <button
                            type="button"
                            class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-muted-foreground cursor-pointer"
                            onclick={() => {
                              fileSearchQuery = '';
                              fileSearchInputRef?.focus();
                            }}
                          >
                            <Fa icon={faTimes} class="w-2.5 h-2.5" />
                          </button>
                        {/if}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        class="shrink-0 text-subtle"
                        tooltip="New file"
                        onclick={() => filesPanelRef?.startCreatingFile()}
                      >
                        <Fa icon={faPlus} class="w-3 h-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        class="shrink-0 {showOnlyChangedFiles ? 'text-primary' : 'text-subtle'}"
                        tooltip={showOnlyChangedFiles
                          ? 'Show all files'
                          : 'Show only changed files'}
                        onclick={() => (showOnlyChangedFiles = !showOnlyChangedFiles)}
                      >
                        <Fa icon={faPencil} class="w-3 h-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        class="shrink-0 text-subtle"
                        tooltip={hasExpandedDirectories ? 'Collapse all' : 'Expand all'}
                        onclick={async () => {
                          if (hasExpandedDirectories) {
                            filesPanelRef?.collapseAll();
                          } else {
                            await filesPanelRef?.expandAll();
                          }
                          filesExpandedTick++;
                        }}
                      >
                        <Fa
                          icon={hasExpandedDirectories ? faCompressAlt : faExpandAlt}
                          class="w-3 h-3"
                        />
                      </Button>
                    </div>
                    <FilesPanel
                      bind:this={filesPanelRef}
                      {workspaceId}
                      selectedFile={effectiveSelectedFile}
                      onOpenFile={handleOpenFileInPanel}
                      {onCreateFile}
                      {onFileRenamed}
                      onSelectAgent={handleOpenAgentInPanel}
                      showOnlyChanged={showOnlyChangedFiles}
                      searchQuery={fileSearchQuery}
                    />
                  </div>
                {/if}
              </div>
            {/key}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  /* Container query for responsive tab labels */
  .tab-bar-container {
    container-type: inline-size;
  }

  /* Drop indicator for tab reordering */
  .drop-indicator {
    width: 2px;
    height: 1.5rem;
    background-color: hsl(var(--primary));
    border-radius: 1px;
    flex-shrink: 0;
    margin: 0 -1px;
    z-index: 10;
  }

  /* Default: badges are inline (flow with content) */
  .tab-badge {
    position: relative;
  }

  /* Wide (over 300px): show icons, labels, and inline badges */
  /* This is the default state - no changes needed */

  /* Medium (250px-300px): hide badges inline, show them absolute */
  @container (max-width: 350px) {
    .tab-badge {
      position: absolute;
      top: -0.125rem;
      right: -0.375rem;
    }
    .tab-badge--agents {
      top: 0.2rem;
      right: 0.2rem;
    }
  }

  /* Narrow (200px-250px): hide icons, show only labels */
  @container (min-width: 255px) and (max-width: 330px) {
    .tab-icon {
      display: none;
    }
  }

  /* Very narrow (under 200px): show only icons, hide labels */
  @container (max-width: 255px) {
    .tab-icon {
      display: flex;
      opacity: 1;
    }
    .tab-label {
      display: none;
    }
  }

  /* Highlight effect for "Reveal in Sidebar" */
  :global(.sidebar-locate-highlight) {
    animation: sidebar-locate-pulse 1.5s ease-out;
  }

  @keyframes sidebar-locate-pulse {
    0% {
      background-color: hsl(var(--primary) / 0.3);
    }
    100% {
      background-color: transparent;
    }
  }
</style>
