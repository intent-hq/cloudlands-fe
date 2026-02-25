<script lang="ts">
  import { goto } from '$app/navigation';
  import { agentService } from '$features/agent/agent.service';
  import { sessionStore } from '$features/agent/browser';
  import { contextStore } from '$features/context/context.store.svelte';
  import { fileTrackingStore } from '$features/file-tracking/file-tracking.store.svelte';
  import { getPanelLayoutManager } from '$features/layout/panel-layout-manager.svelte';
  import { getAvatarState } from '$lib/components/ui/auggie-avatar/avatar-state';
  import { Button } from '$lib/components/ui/button';
  import OpenComboButton from '$lib/components/ui/OpenComboButton.svelte';
  import { TooltipRich } from '$lib/components/ui/tooltip';
  import { faNote } from '$lib/icons/faNote';
  import { getFileExtension, track } from '$lib/services/analytics';
  import { noteReadTrackingStore } from '$lib/stores/note-read-tracking.store.svelte';
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import { cn } from '$lib/utils';
  import { useAllAgentsSubscription } from '$lib/utils/agent-subscription.svelte';
  import type { Note, Workspace } from '$shared/types';
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
  import Fa from 'svelte-fa';
  import { fly, slide } from 'svelte/transition';
  import AnimatedNumber from '../ui/AnimatedNumber.svelte';
  import Input from '../ui/input/input.svelte';
  import CreateAgentSection from './CreateAgentSection.svelte';
  import OverviewTimelinePanel from './OverviewTimelinePanel.svelte';
  import { FilesPanel, SidebarChangesPanel, isSpecNote } from './sidebar';
  import AddContextSection from './sidebar/AddContextSection.svelte';
  import ContextPanel from './sidebar/ContextPanel.svelte';
  import WorkspaceProgressCard from './sidebar/WorkspaceProgressCard.svelte';
  import {
    deriveWorkspacePhase,
    deriveWorkspaceStats,
    type WorkspacePhase,
  } from './workspace-phase';
  import WorkspaceAgentsList from './WorkspaceAgentsList.svelte';

  interface Terminal {
    id: string;
    type: 'terminal' | 'chat';
    title?: string;
    name?: string;
    createdAt: number | string;
    workspaceId?: string;
  }

  interface Props {
    workspace: Workspace;
    workspaceId: string;
    workspacePath?: string;
    notes?: Note[];
    notesLoading?: boolean;
    selectedNoteId?: string | null;
    onOpenNote?: (noteId: string) => void;
    onOpenAgent?: (agentId: string) => void;
    onReorderNotes?: (noteIds: string[]) => void;
    onCreateNote?: () => void;
    selectedFile?: string | null;
    onOpenFile?: (filePath: string) => void;
    onCreateFile?: (folderPath: string, fileName?: string) => void | Promise<void>;
    onFileRenamed?: (oldPath: string, newPath: string) => void;
    activeFilePath?: string | null;
    activeFileStaged?: boolean | null;
    isAllChangesViewActive?: boolean;
    isNewWorkspaceSession?: boolean;
    onCreateAgent?: () => void;
    onCreateAgentWithSpecialist?: (specialistId: string | null) => void;
    onCreateAgentWithPrompt?: (prompt: string, name: string) => void;
    onShowAgent?: (agentId: string) => void;
    terminals?: Terminal[];
    onOpenTerminal?: (terminalId: string) => void;
    onCreateTerminal?: () => void;
    onOpenAcceptChanges?: () => void;
    onAcceptChanges?: () => void;
    class?: string;
    [key: string]: unknown;
  }

  let {
    workspace,
    workspaceId,
    workspacePath = '',
    notes = [],
    notesLoading = false,
    selectedNoteId = null,
    onReorderNotes,
    onCreateNote,
    selectedFile = null,
    onCreateFile,
    onFileRenamed,
    isNewWorkspaceSession = false,
    onCreateAgent,
    onCreateAgentWithSpecialist,
    terminals = [],
    onCreateTerminal,
    onOpenAcceptChanges,
    onAcceptChanges,
    class: className,
    ...restProps
  }: Props = $props();

  void restProps;

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
      description: 'Files changed by agents working in this space.',
    },
    {
      id: 'files',
      label: 'Files',
      icon: faFolderTree,
      description: 'The agents in this space are working off a copy of your files.',
    },
  ];

  type TabId = (typeof TAB_DEFINITIONS)[number]['id'];

  // Multi-select tab state
  function getStorageKey(wsId: string): string {
    return `multiselect-sidebar-${wsId}`;
  }

  function getOrderStorageKey(): string {
    return 'multiselect-sidebar-tab-order';
  }

  function loadSelectedTabs(wsId: string): Set<TabId> {
    if (typeof window === 'undefined') return new Set(['overview']);
    try {
      const stored = localStorage.getItem(getStorageKey(wsId));
      if (stored) {
        const parsed = JSON.parse(stored);
        return new Set(parsed as TabId[]);
      }
    } catch {
      // Ignore parsing errors
    }
    return new Set(['overview']);
  }

  function loadTabOrder(): TabId[] {
    if (typeof window === 'undefined') return TAB_DEFINITIONS.map((t) => t.id);
    try {
      const stored = localStorage.getItem(getOrderStorageKey());
      if (stored) {
        const parsed = JSON.parse(stored) as TabId[];
        // Validate that all tabs are present
        const allTabIds = TAB_DEFINITIONS.map((t) => t.id);
        if (parsed.length === allTabIds.length && allTabIds.every((id) => parsed.includes(id))) {
          return parsed;
        }
      }
    } catch {
      // Ignore parsing errors
    }
    return TAB_DEFINITIONS.map((t) => t.id);
  }

  function saveTabOrder(order: TabId[]) {
    if (typeof window === 'undefined') return;
    localStorage.setItem(getOrderStorageKey(), JSON.stringify(order));
  }

  let selectedTabs = $state<Set<TabId>>(new Set(['agents', 'context']));
  let tabOrder = $state<TabId[]>(TAB_DEFINITIONS.map((t) => t.id));
  let previousWorkspaceId = $state<string | null>(null);

  // Drag state for tab reordering
  let draggedTabId = $state<TabId | null>(null);
  let dropIndicator = $state<{ tabId: TabId; position: 'before' | 'after' } | null>(null);

  // Load tab order on mount
  onMount(() => {
    tabOrder = loadTabOrder();
  });

  // Get ordered tab definitions based on current order
  const orderedTabDefinitions = $derived(
    tabOrder.map((id) => TAB_DEFINITIONS.find((t) => t.id === id)!).filter(Boolean),
  );

  // Construct the correct PR URL from repository info and PR number
  // This is more reliable than using the stored URL which may be incorrect or empty
  const constructPrUrl = (prNumber: number, fallbackUrl?: string): string => {
    if (workspace?.repositoryOwner && workspace?.repositoryName) {
      return `https://github.com/${workspace.repositoryOwner}/${workspace.repositoryName}/pull/${prNumber}`;
    }
    // Fallback to stored URL if we do not have repo info
    return fallbackUrl || '';
  };

  // Dynamic tab description overrides for coordinator mode
  function getTabDescription(tabId: string, defaultDescription: string): string {
    if (tabId === 'agents' && isCoordinator)
      return 'A coordinator agent writes a spec and manages the work of different agents.';
    return defaultDescription;
  }

  // Controlled tooltip state - managed via pointer events for instant switching
  let openTooltipTabId = $state<string | null>(null);
  let tooltipPinned = $state(false); // Keep tooltip open after click

  // Track previous single tab for fly direction
  let previousSingleTabId = $state<TabId | null>(null);
  let flyDirection = $state<number>(0); // -1 = left, 1 = right, 0 = no fly
  // Track if we're doing a multi-panel transition (either before or after has multiple panels)
  let useSlideTransition = $state(false);

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

      tabOrder = newOrder;
      saveTabOrder(newOrder);
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
      selectedTabs = new Set(['agents', 'context']);
      previousWorkspaceId = null;
      // Reset fly/slide state to prevent overlapping panels
      flyDirection = 0;
      useSlideTransition = false;
      previousSingleTabId = null;
      return;
    }
    if (currentWorkspaceId !== previousWorkspaceId) {
      previousWorkspaceId = currentWorkspaceId;
      selectedTabs = loadSelectedTabs(currentWorkspaceId);
      // Reset fly/slide state to prevent overlapping panels after workspace switch
      flyDirection = 0;
      useSlideTransition = false;
      previousSingleTabId = null;
    }
  });

  function saveSelectedTabs() {
    if (typeof window === 'undefined') return;
    const currentWorkspaceId = workspaceId;
    if (!currentWorkspaceId) return;
    localStorage.setItem(getStorageKey(currentWorkspaceId), JSON.stringify([...selectedTabs]));
  }

  function handleTabClick(tabId: TabId, event: MouseEvent) {
    const wasMultiPanel = selectedTabs.size > 1;
    const wasSingleTab = selectedTabs.size === 1;
    const previousTabId = wasSingleTab ? [...selectedTabs][0] : null;

    if (event.shiftKey) {
      // Shift+click: toggle this tab in/out of selection
      if (selectedTabs.has(tabId)) {
        // Don't allow deselecting the last tab
        if (selectedTabs.size > 1) {
          selectedTabs.delete(tabId);
        }
      } else {
        selectedTabs.add(tabId);
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
      previousSingleTabId = tabId;
      selectedTabs = new Set([tabId]);
    }

    // Determine if this is a multi-panel transition
    // Use slide if EITHER before or after has multiple panels
    const isMultiPanel = selectedTabs.size > 1;
    useSlideTransition = wasMultiPanel || isMultiPanel;

    selectedTabs = new Set(selectedTabs); // Trigger reactivity
    saveSelectedTabs();
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
    previousSingleTabId = id;
    selectedTabs = new Set([id]);
    saveSelectedTabs();
  }

  // Workspace phase derivation for Overview tab
  const workspacePhaseInfo = $derived.by(() => {
    if (!workspace)
      return {
        phase: 'planning' as WorkspacePhase,
        label: 'Planning',
        subtitle: 'Describe what you want to build',
        isActive: false,
      };
    const hasActiveAgents = workspaceAgents.some(
      (a) => a.isStreaming || a.isProcessing || a.isResponding,
    );
    return deriveWorkspacePhase(workspace, { hasActiveAgents });
  });
  const workspacePhaseStats = $derived.by(() => {
    if (!workspace)
      return {
        tasks: { total: 0, completed: 0, inProgress: 0, notStarted: 0 },
        files: { changed: 0, additions: 0, deletions: 0 },
        commits: { total: 0, unpushed: 0 },
        pr: { hasOpen: false, hasMerged: false },
      };
    return deriveWorkspaceStats(workspace);
  });

  // Core state and handlers (same as StackedSidebar)
  const handleOpenAcceptChanges = $derived(onOpenAcceptChanges || onAcceptChanges);
  const storeHasCorrectWorkspace = $derived(fileTrackingStore.currentWorkspaceId === workspaceId);
  const panelLayoutManager = $derived(getPanelLayoutManager(workspaceId));
  const focusedContent = $derived(panelLayoutManager.focusedContent);

  const effectiveSelectedNoteId = $derived(
    focusedContent.type === 'note' ? focusedContent.noteId : null,
  );
  const effectiveSelectedAgentId = $derived(
    focusedContent.type === 'agent' ? focusedContent.agentId : null,
  );
  const effectiveSelectedFile = $derived(
    focusedContent.type === 'file' ? focusedContent.filePath : null,
  );
  const effectiveActiveFilePath = $derived.by(() => {
    if (focusedContent.type === 'diff' && focusedContent.diffPath) {
      return focusedContent.diffPath;
    }
    return null;
  });
  const effectiveActiveFileStaged = $derived.by(() => {
    if (focusedContent.type === 'diff' && focusedContent.diffPath) {
      const diffPath = focusedContent.diffPath;
      const isInStaged = workingChanges.staged.some(
        (c) => c.file === diffPath || c.relativePath === diffPath,
      );
      if (isInStaged) return true;
      const isInUnstaged = workingChanges.unstaged.some(
        (c) => c.file === diffPath || c.relativePath === diffPath,
      );
      if (isInUnstaged) return false;
      return null;
    }
    return null;
  });
  const effectiveIsAllChangesViewActive = $derived(focusedContent.type === 'local-changes');

  // Panel open handlers
  function handleOpenAgentInPanel(agentId: string) {
    const agent = workspaceAgents.find((a) => a.id === agentId);
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
    const note = notes.find((n) => n.id === noteId);
    const title = note?.title || 'Note';
    panelLayoutManager.openTab({
      type: 'note',
      title,
      closable: true,
      noteId,
      workspaceId,
    });

    // Mark note as read when opened to clear unread indicator
    noteReadTrackingStore.markNoteRead(workspaceId, noteId);
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

  // Working changes for badges
  const workingChanges = $derived(
    storeHasCorrectWorkspace
      ? (fileTrackingStore.workingChanges ?? { unstaged: [], staged: [] })
      : { unstaged: [], staged: [] },
  );
  const allCommits = $derived(storeHasCorrectWorkspace ? (fileTrackingStore.commits ?? []) : []);

  // Agent subscription
  let agentStateTick = $state(0);
  const agentSubscription = useAllAgentsSubscription(() => workspaceId);
  const workspaceAgents = $derived.by(() => {
    const all = agentSubscription.all;
    if (!workspaceId) return all;
    return all.filter((s) => s.workspaceId === workspaceId);
  });
  const agentsLoading = $derived(agentSubscription.loading);

  const activeAgents = $derived.by(() => {
    return workspaceAgents
      .map((agent) => {
        const state = getAvatarState(
          {
            isStreaming: agent.isStreaming,
            isProcessing: agent.isProcessing,
            isResponding: agent.isResponding,
            status: agent.status,
          },
          {},
        );
        return { agent, state };
      })
      .filter(({ state }) => state === 'running' || state === 'responding' || state === 'unread');
  });

  // Agent badge state - green if running, blue if unread
  const hasRunningAgents = $derived(
    activeAgents.some(({ state }) => state === 'running' || state === 'responding'),
  );
  const hasUnreadAgents = $derived(activeAgents.some(({ state }) => state === 'unread'));

  // Status card context: spec, coordinator agent, digest
  const hasSpec = $derived(
    notes.some((n) => isSpecNote(n.id as string) && n.content && n.content.trim().length > 0),
  );
  const coordinatorAgent = $derived(
    workspaceAgents.find(
      (a) => a.metadata?.isInitialAgent === true || a.metadata?.isInitialWorkspaceAgent === true,
    ) || (workspaceAgents.length === 1 ? workspaceAgents[0] : null),
  );
  const isCoordinatorRunning = $derived(
    coordinatorAgent
      ? coordinatorAgent.isStreaming ||
          coordinatorAgent.isProcessing ||
          coordinatorAgent.isResponding
      : false,
  );
  const coordinatorDigest = $derived(coordinatorAgent?.digest || undefined);
  const isCoordinator = $derived(coordinatorAgent?.metadata?.specialist === 'spec-writer');

  function handleStatusCardAction(action: string) {
    switch (action) {
      case 'show-coordinator':
        if (coordinatorAgent) {
          handleOpenAgentInPanel(coordinatorAgent.id);
        } else if (workspaceAgents.length > 0) {
          handleOpenAgentInPanel(workspaceAgents[0].id);
        }
        break;
      case 'view-spec': {
        const spec = notes.find((n) => isSpecNote(n.id as string));
        if (spec) handleOpenNoteInPanel(spec.id as string);
        break;
      }
      case 'approve':
        window.dispatchEvent(
          new CustomEvent('workspace:approve-spec', { detail: { workspaceId } }),
        );
        break;
      case 'pause':
        // TODO: implement pause functionality
        break;
      case 'show-changes':
        switchToTab('changes');
        break;
      case 'create-pr':
        window.dispatchEvent(new CustomEvent('workspace:create-pr', { detail: { workspaceId } }));
        break;
      case 'archive':
        handleArchiveWorkspace();
        break;
    }
  }

  async function handleArchiveWorkspace() {
    if (!workspace) return;
    const { toast } = await import('svelte-sonner');
    const workspaceTitle = workspace.title || 'space';

    const result = await workspaceStore.archive(workspace.id);
    if (result.ok) {
      toast.warning(`Archived space ${workspaceTitle}`, {
        duration: 15000,
        action: {
          label: 'Undo',
          onClick: async () => {
            await workspaceStore.unarchive(workspace.id);
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
    workingChanges.unstaged.length +
      workingChanges.staged.length +
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

  // Agent state tracking
  let previousStreamingState = new Map<string, boolean>();
  let previousAgentCount = 0;

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
    const unsubscribeAgent = sessionStore.getStore().subscribe(() => {
      const allSessions = agentService.getAllSessions();
      const workspaceSessions = agentService.getSessionsForWorkspace(workspaceId);
      let hasRelevantChange = false;

      if (workspaceSessions.length !== previousAgentCount) {
        hasRelevantChange = true;
        previousAgentCount = workspaceSessions.length;
      }

      for (const session of allSessions) {
        const isRunning = session.isStreaming || session.isResponding || session.isProcessing;
        const wasRunning = previousStreamingState.get(session.id) ?? false;
        if (isRunning !== wasRunning) {
          hasRelevantChange = true;
          previousStreamingState.set(session.id, !!isRunning);
        }
      }

      if (hasRelevantChange) {
        agentStateTick++;
      }
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey && e.shiftKey && e.key === 'c') {
        e.preventDefault();
        if (workspacePath) {
          navigator.clipboard.writeText(workspacePath);
          import('$lib/components/ui/toast').then(({ toast }) => {
            toast.success('Path copied to clipboard');
          });
        }
      }
    };

    // Handle "Reveal in Sidebar" events from panel tab context menus
    const handleLocateItem = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      const { sidebarTabId, type, noteId, filePath, agentId } = detail;

      // Switch to the appropriate sidebar tab
      const targetTab = mapSidebarTabId(sidebarTabId);
      if (targetTab) {
        selectedTabs = new Set([targetTab]);
        saveSelectedTabs();
      }

      // Scroll to the item after a short delay to allow tab switch to render
      setTimeout(() => {
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
      }, 150);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('sidebar:locate-item', handleLocateItem);

    return () => {
      unsubscribeAgent();
      previousStreamingState.clear();
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('sidebar:locate-item', handleLocateItem);
    };
  });

  // Refresh unread notes
  $effect(() => {
    if (workspaceId && notes.length > 0) {
      const trackableNotes = notes.filter((n) => !isSpecNote(n.id as string));
      const notesWithTimestamps = trackableNotes.map((n) => ({
        id: n.id as string,
        updatedAt: n.updatedAt || n.updated_at || n.createdAt || n.created_at || '',
        createdAt: n.createdAt || n.created_at,
      }));
      noteReadTrackingStore.refreshUnreadNotes(workspaceId, notesWithTimestamps);
    }
  });

  // Count of selected tabs for layout calculation
  const selectedTabCount = $derived(selectedTabs.size);
  const orderedSelectedTabs = $derived(tabOrder.filter((id) => selectedTabs.has(id)));
</script>

<div bind:this={sidebarElement} class={cn('flex flex-col h-full bg-sidebar', className)}>
  <!-- Fixed Top Section: Progress Card -->
  <div class="shrink-0 px-4 pb-3 pt-3">
    <WorkspaceProgressCard {notes} {workspace} {workspaceId} onOpenNote={handleOpenNoteInPanel} />
  </div>

  {#if !isNewWorkspaceSession}
    <!-- Multi-Select Tab Bar -->
    <div class="shrink-0 flex items-center px-4">
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="tab-bar-container flex items-center gap-px p-0.5 bg-muted/50 flex-1"
        onpointerleave={() => {
          if (!tooltipPinned) {
            openTooltipTabId = null;
          }
        }}
      >
        {#each orderedTabDefinitions as tab, tabIndex (tab.id)}
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
          <TooltipRich
            title={tab.label}
            description={getTabDescription(tab.id, tab.description)}
            icon={tab.icon}
            side="top"
            align="center"
            sideOffset={0}
            delayDuration={0}
            open={openTooltipTabId === tab.id && !draggedTabId}
            descriptionClass="text-muted-foreground text-sm"
            iconClass="text-muted-foreground/50 order-2 ml-auto size-3"
            contentClass="shadow-xs mx-2 max-w-[calc(100vw-2rem)] rounded-none px-1.25"
            footerClass="border-t-0 bg-transparent! !pt-1 !px-3 rounded-none"
            class={tab.hideLabel ? 'shrink-0' : 'flex-1 shrink-0'}
          >
            {#snippet footer()}
              <div class="flex items-center gap-1.5 text-xs -ml-1 -mt-1 text-muted-foreground/70">
                Hold Shift to select multiple
              </div>
            {/snippet}
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
                'w-full',
              )}
              onpointerenter={() => (openTooltipTabId = tab.id)}
              onclick={(e) => {
                tooltipPinned = true;
                handleTabClick(tab.id, e);
              }}
              ondragstart={(e) => handleDragStart(tab.id, e)}
              ondragover={(e) => handleDragOver(tab.id, e)}
              ondragleave={(e) => handleDragLeave(e)}
              ondrop={(e) => handleDrop(e)}
              ondragend={handleDragEnd}
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
                  class="tab-badge min-w-4 h-4 px-1 rounded-full bg-background text-muted-foreground text-[9px] font-semibold flex items-center justify-center z-10 shrink-0"
                >
                  <AnimatedNumber value={changedFilesCount} />
                </div>
              {/if}
            </button>
          </TooltipRich>
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
      onclick={() => {
        tooltipPinned = false;
        openTooltipTabId = null;
      }}
    >
      {#each orderedSelectedTabs as tabId, index (tabId)}
        {@const tab = TAB_DEFINITIONS.find((t) => t.id === tabId)}
        {@const isLast = index === selectedTabCount - 1}
        {@const useFly = !useSlideTransition && flyDirection !== 0}
        <!-- Outer wrapper for fly transition (single panel switches) -->
        <div
          class={cn('w-full min-w-0 flex flex-col', !isLast && 'border-b border-border')}
          in:fly={{ x: useFly ? flyDirection * 30 : 0, duration: useFly ? 200 : 0 }}
          out:fly={{ x: useFly ? -flyDirection * 30 : 0, duration: useFly ? 200 : 0 }}
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
                          const contextItem = contextStore.addItem({
                            type: 'browser-url',
                            provider: 'browser',
                            title: 'Browser',
                            url: defaultUrl,
                          } as Omit<
                            import('$features/context/types').BrowserUrlContextItem,
                            'id' | 'createdAt' | 'updatedAt'
                          >);
                          const layoutManager = getPanelLayoutManager(workspaceId);
                          layoutManager.openBrowserPanel(defaultUrl, contextItem.id);
                        }}
                        compact
                      />
                    </span>
                  {/if}
                </h6>
                <p
                  class="text-[11px] text-muted-foreground/60 mt-0.5 leading-snug transition-all duration-200"
                >
                  {#if tabId === 'context' && workspace?.path}
                    {getTabDescription(tab.id, tab.description)} Your notes live in
                    <span class="inline-flex items-baseline gap-1">
                      <OpenComboButton
                        filePath={workspace.path + '/.workspace'}
                        isDirectory={true}
                        variant="sidebar"
                        compact
                        class="inline-flex"
                      >
                        <span
                          class="text-inherit underline underline-offset-2 decoration-muted-foreground/20"
                          >/{workspace.path.split(/[/\\]/).slice(-1)[0]}/.workspace</span
                        >
                      </OpenComboButton></span
                    >.
                  {:else if tabId === 'files' && workspacePath}
                    {workspace?.skipWorktree
                      ? 'Working directly in'
                      : 'The agents in this space are working off a copy of your files in'}
                    <span class="inline-flex items-baseline gap-1">
                      <OpenComboButton
                        filePath={workspacePath}
                        isDirectory={true}
                        variant="sidebar"
                        compact
                        class="inline-flex"
                      >
                        <span
                          class="text-inherit underline underline-offset-2 decoration-muted-foreground/20"
                          >/{workspacePath.split(/[/\\]/).slice(-2).join('/')}</span
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
            <div class="h-full pt-2 pb-6">
              {#if tabId === 'overview'}
                {@const overviewAgents = workspaceAgents.map((agent) => {
                  const state = getAvatarState(
                    {
                      isStreaming: agent.isStreaming,
                      isProcessing: agent.isProcessing,
                      isResponding: agent.isResponding,
                      status: agent.status,
                    },
                    {},
                  );
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
                  ...workingChanges.unstaged.map((c) => ({
                    path: c.relativePath || c.file,
                    additions: c.stats?.additions ?? 0,
                    deletions: c.stats?.deletions ?? 0,
                    status: c.status,
                    staged: false,
                  })),
                  ...workingChanges.staged
                    .filter(
                      (s) =>
                        !workingChanges.unstaged.some(
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
                  {workspace}
                  phase={workspacePhaseInfo}
                  stats={workspacePhaseStats}
                  {notes}
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
                  {agentsLoading}
                  {notesLoading}
                  changesLoading={!storeHasCorrectWorkspace}
                  onSwitchTab={switchToTab}
                  onOpenNote={(noteId) => handleOpenNoteInPanel(noteId)}
                  onOpenAgent={(agentId) => handleOpenAgentInPanel(agentId)}
                  onOpenFile={(filePath) => {
                    window.dispatchEvent(
                      new CustomEvent('workspace:open-diff', {
                        detail: { filePath },
                      }),
                    );
                  }}
                  onOpenFileInPanel={handleOpenFileInPanel}
                />
              {:else if tabId === 'agents'}
                <div class="px-3 transition-all duration-200">
                  <WorkspaceAgentsList
                    agents={workspaceAgents}
                    loading={agentsLoading}
                    selectedAgentId={effectiveSelectedAgentId}
                    onSelect={({ agentId }) => handleOpenAgentInPanel(agentId)}
                  />
                </div>
              {:else if tabId === 'context'}
                <div class="px-3 transition-all duration-200">
                  <ContextPanel
                    {notes}
                    {workspaceId}
                    selectedNoteId={effectiveSelectedNoteId}
                    onOpenNote={handleOpenNoteInPanel}
                    onOpenAgent={handleOpenAgentInPanel}
                    {onReorderNotes}
                    {onCreateNote}
                    loading={notesLoading}
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
                        window.dispatchEvent(
                          new CustomEvent('workspace:open-diff', {
                            detail: {
                              change,
                              filePath: change.relativePath || change.file,
                              changeId: change.id,
                              staged: change.stage === 'staged',
                            },
                          }),
                        );
                      }}
                      onOpenFullPanel={handleOpenAcceptChanges}
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
                        class="absolute left-2.5 top-1/2 -translate-y-1/2 w-2.5 h-2.5 text-muted-foreground/40"
                      />
                      <Input
                        bind:this={fileSearchInputRef}
                        bind:value={fileSearchQuery}
                        type="text"
                        placeholder="Search files..."
                        class="h-7 pl-7 pr-6 text-xs bg-transparent! border-0 placeholder:text-muted-foreground/50!"
                      />
                      {#if fileSearchQuery}
                        <button
                          type="button"
                          class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground cursor-pointer"
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
                      class="shrink-0 text-muted-foreground/50"
                      tooltip="New file"
                      onclick={() => filesPanelRef?.startCreatingFile()}
                    >
                      <Fa icon={faPlus} class="w-3 h-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      class="shrink-0 {showOnlyChangedFiles
                        ? 'text-primary'
                        : 'text-muted-foreground/50'}"
                      tooltip={showOnlyChangedFiles ? 'Show all files' : 'Show only changed files'}
                      onclick={() => (showOnlyChangedFiles = !showOnlyChangedFiles)}
                    >
                      <Fa icon={faPencil} class="w-3 h-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      class="shrink-0 text-muted-foreground/50"
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
                    {workspacePath}
                    {workspaceId}
                    environmentConfig={workspace?.environmentConfig}
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
  @container (min-width: 235px) and (max-width: 310px) {
    .tab-icon {
      display: none;
    }
  }

  /* Very narrow (under 200px): show only icons, hide labels */
  @container (max-width: 235px) {
    .tab-icon {
      display: flex;
      opacity: 1;
    }
    .tab-label {
      display: none;
    }
  }

  /* Highlight effect for sidebar:locate-item */
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
