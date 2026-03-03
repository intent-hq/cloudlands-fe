<script lang="ts">
  /**
   * Workspace Detail Page - Unified State Version
   *
   * Complete rewrite using the new unified state management system.
   * No URL state, no backward compatibility, clean implementation.
   */

  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { onMount, onDestroy, untrack } from 'svelte';

  import type { AgentSession } from '$shared/types';
  import { AgentId, WorkspaceId, NoteId } from '$shared/types/branded-ids';
  import { createAgentTypeId, parseAgentTypeId } from '$shared/types/agent.types';
  import { AgentStatus } from '$shared/types';
  import { toast } from 'svelte-sonner';

  // Local Terminal type for UI representation
  interface Terminal {
    id: string;
    type: 'terminal';
    title: string;
    workspaceId: string;
    createdAt: string;
    isConnected?: boolean;
    isExecuting?: boolean;
  }

  // New unified state management
  import { createUnifiedWorkspaceState } from '$features/workspace/workspace-unified-state.svelte';
  import {
    useCloseHandlers,
    useDockNavigation,
    usePanelActions,
    usePanelShortcuts,
    useSidebarState,
    useTaskDelegationHandlers,
    useTabManagement,
    useWorkspaceLoader,
  } from './composables';

  // Performance optimization
  import { CleanupManager } from '$features/optimization/memory-manager';

  // Stores
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import { workspaceClient } from '$features/workspace/workspace.client';
  import { agentService } from '$features/agent/agent.service'; // Keep for backward compat
  import { agentFactory } from '$features/agent/services/agent-factory';
  import { sessionStore } from '$features/agent/browser';
  import { terminalManager } from '$features/terminal/terminal-manager.svelte';
  import { gitStore } from '$features/git/git.store.svelte';
  import { fileTrackingStore } from '$features/file-tracking/file-tracking.store.svelte';
  import { PanelVisibilityManager } from '$features/workspace/panel-visibility-manager.svelte';
  import { queryEvents } from '$features/events/events.client';
  import { modelStore } from '$lib/stores/model.store.svelte';
  import { notesStateManager } from '$features/notes/notes.store.svelte';
  import { notesClient } from '$features/notes/notes.client';
  import { workspaceStorageManager } from '$features/workspace/workspace-storage-manager';
  import { buildTaskNoteContent } from '$features/notes/utils/task-agent-message-builder';
  import { unifiedIdService } from '$shared/services/unified-id.service';
  import { stripMarkdownFormatting } from '$shared/utils-client';
  import { noteReadTrackingStore } from '$lib/stores/note-read-tracking.store.svelte';
  import { unreadTrackingService } from '$features/agent/services/unread-tracking.service';
  import { getTransientUIStore } from '$features/workspace/transient-ui-state.store.svelte';
  import { track, setAnalyticsContextProvider, getFileExtension } from '$lib/services/analytics';
  import { layoutSettings } from '$features/layout/layout-settings.svelte';
  import { terminalOverlayStore } from '$lib/stores/terminal-overlay.store.svelte';

  // Components
  import WorkspaceLayout from '$lib/components/workspace/WorkspaceLayout.svelte';
  import VSCodeResizablePanels from '$lib/components/workspace/VSCodeResizablePanels.svelte';
  import WorkspaceModals from '$lib/components/workspace/WorkspaceModals.svelte';
  import SidebarSkeleton from '$lib/components/workspace/SidebarSkeleton.svelte';
  import ContentSkeleton from '$lib/components/workspace/ContentSkeleton.svelte';
  import InputDialog from '$lib/components/modals/InputDialog.svelte';
  import QuakeTerminalOverlay from '$lib/components/terminal/QuakeTerminalOverlay.svelte';
  import { PanelLayout } from '$lib/components/layout/panel-system';
  import { getPanelLayoutManager } from '$features/layout/panel-layout-manager.svelte';
  import { unifiedStateStore } from '$features/agent/services/unified-state-store';

  // Utils
  import { createLogger } from '$lib/utils/client-logger';
  import { transitionMCPWorkspace } from '$lib/api/mcp-client';
  import { SPEC_NOTE_ID } from '$shared/constants/notes';
  import { taskNoteUrl } from '$shared/constants/intent-links';
  import { listenSync, extractEventData } from '$lib/electron-bridge';
  import { generateSpecialistAgentName } from '$lib/utils/agent-name-generator';
  import { acquireAgentLoadLock, releaseAgentLoadLock } from '$lib/utils/agent-subscription.svelte';
  import { specialistsStore } from '$lib/stores/specialists.store.svelte';
  import { activeProviderStore } from '$lib/stores/active-provider.store.svelte';
  import MultiSelectTabbedSidebar from '$lib/components/workspace/MultiSelectTabbedSidebar.svelte';

  const logger = createLogger('workspace-page');

  // ============================================================================
  // Core State
  // ============================================================================

  // Create unified state for this workspace
  // @ts-expect-error - Svelte 5 rune scoping issue
  let workspaceState = $state(null);
  // @ts-expect-error - Svelte 5 rune scoping issue
  let stateDisposing = $state(false);
  // @ts-expect-error - Svelte 5 rune scoping issue
  let previousWorkspaceId = $state(null);
  // @ts-expect-error - Svelte 5 rune scoping issue
  let isWaitingForFirstMessage = $state(false); // Track if we're waiting for the first message to be sent

  // Draft prompt to pre-fill in agent input without sending
  // @ts-expect-error - Svelte 5 rune scoping issue
  let draftPrompt = $state<string | null>(null);

  // Create file dialog state
  // @ts-expect-error - Svelte 5 rune scoping issue
  let createFileDialogOpen = $state(false);
  // @ts-expect-error - Svelte 5 rune scoping issue
  let createFileFolderPath = $state('');

  /**
   * Initialize a new workspace state for the given ID, pre-populating data from the store
   * to avoid a flash of empty/skeleton UI. Used by both the initial load and transition paths.
   *
   * Sets workspaceData on the state AND safeWorkspace directly. The workspace loader's
   * effect will still call workspaceClient.open() because its condition does not gate on
   * hasWorkspaceData — open() must always be called to start backend change detection.
   */
  function initializeWorkspaceState(wsId: string): ReturnType<typeof createUnifiedWorkspaceState> {
    const newState = createUnifiedWorkspaceState(wsId);

    // Pre-populate workspace data from the store to avoid blank state.
    // This is a synchronous Map lookup — cheap and eliminates the skeleton flash
    // when the workspace is already cached (the common case from home page navigation).
    const cachedWorkspace = workspaceStore.findById(WorkspaceId(wsId));
    if (cachedWorkspace) {
      newState.updateState({
        workspaceData: cachedWorkspace,
        workspace: { id: wsId, status: 'ready' },
      });
    }

    // Check if this is a newly created workspace by looking for initial agent config
    const pendingAgentKey = `workspace:${wsId}:initial-agent-pending`;
    const hasInitialAgent = !!sessionStorage.getItem(pendingAgentKey);
    if (hasInitialAgent) {
      logger.info('Detected newly created workspace', { workspaceId: wsId });
      newState.updateState({ isNewlyCreatedWorkspace: true });
    }

    // Batch state updates with untrack to prevent effect cascades
    untrack(() => {
      workspaceState = newState;
      previousWorkspaceId = wsId;
      // Set safeWorkspace directly to avoid blank state during effect propagation.
      // We must also set lastSafeWorkspaceId so the safeWorkspace effect (which runs
      // after this) takes the silent Object.assign path instead of resetting safeWorkspace.
      if (cachedWorkspace) {
        lastSafeWorkspaceId = wsId;
        safeWorkspace = cachedWorkspace;
      }
    });

    return newState;
  }

  // Get workspace ID from route with defensive null check
  // page.params might be undefined during route transitions
  let workspaceId = $derived((page.params?.id as string) ?? '');

  // Track if we're in the process of creating a workspace (including optimistic phase)
  let isCreatingWorkspace = $derived(
    workspaceId === 'new' || workspaceId?.startsWith('optimistic-'),
  );

  // Load workspace store on mount
  onMount(() => {
    // Load workspace store if needed
    if (workspaceStore.isEmpty) {
      logger.debug('Loading workspace store on mount');
      workspaceStore.load();
    }
  });

  // Create cleanup manager for this component
  const cleanupManager = new CleanupManager();

  // Properly manage state lifecycle with improved error handling
  $effect(() => {
    // Only track these specific values to avoid unnecessary re-runs
    const currentWorkspaceId = workspaceId;

    // Skip if we're already disposing or workspace hasn't changed
    if (stateDisposing || currentWorkspaceId === previousWorkspaceId) {
      return;
    }

    // Handle initial load - if previousWorkspaceId is null and we have a workspace ID,
    // this is the first load, not a workspace change
    if (previousWorkspaceId === null && currentWorkspaceId) {
      // Use untrack to prevent this state mutation from triggering effect re-runs
      untrack(() => {
        previousWorkspaceId = currentWorkspaceId;
      });
      // Don't return here - we still need to create the initial workspace state
    }

    // Validate workspace ID - skip if empty, undefined, or 'undefined' string
    // Empty string can happen during route transitions when page.params is not yet populated
    if (!currentWorkspaceId || currentWorkspaceId === 'undefined' || currentWorkspaceId === '') {
      if (currentWorkspaceId !== '') {
        // Only log error for truly invalid IDs, not for empty strings during transitions
        logger.error('Invalid workspace ID detected', { workspaceId: currentWorkspaceId });
      }
      return;
    }

    // Check if this is a transition from optimistic to real workspace
    const isOptimisticTransition =
      previousWorkspaceId?.startsWith('optimistic-') &&
      !currentWorkspaceId.startsWith('optimistic-');

    if (isOptimisticTransition && workspaceState) {
      // For optimistic transitions, update the workspace ID in the state
      logger.debug('Transitioning workspace state from optimistic to real', {
        from: previousWorkspaceId,
        to: currentWorkspaceId,
      });

      // Update the workspace ID in the existing state
      // Don't set status to "loading" to avoid showing loading states
      workspaceState.updateState({
        workspace: { id: currentWorkspaceId, status: 'ready' },
      });

      // Use untrack to prevent this state mutation from triggering effect re-runs
      untrack(() => {
        previousWorkspaceId = currentWorkspaceId;
      });

      // Clear loading state to trigger fresh load
      workspaceLoader.clearLoadingState();

      // The workspace state still has the old workspace ID internally,
      // but we need to recreate it to get the correct isOptimistic value.
      // To avoid UI flashing, preserve the current state data
      const currentStateData = workspaceState.state;
      const preservedData = {
        workspaceData: currentStateData.workspaceData,
        agentsList: currentStateData.agentsList,
        terminalsList: currentStateData.terminalsList,
        drawer: currentStateData.drawer,
        mainPanel: currentStateData.mainPanel,
      };

      // Dispose the old state
      const oldState = workspaceState;

      try {
        // Create new state with the real workspace ID
        workspaceState = createUnifiedWorkspaceState(currentWorkspaceId);

        // Immediately restore the preserved data to avoid UI flash
        workspaceState.updateState(preservedData);

        // Check if this is a newly created workspace by looking for initial agent config
        const pendingAgentKey = `workspace:${currentWorkspaceId}:initial-agent-pending`;
        const hasInitialAgent = !!sessionStorage.getItem(pendingAgentKey);

        if (hasInitialAgent) {
          logger.info('Detected newly created workspace during transition', {
            workspaceId: currentWorkspaceId,
          });
          workspaceState?.updateState({ isNewlyCreatedWorkspace: true });
        }

        logger.info('Transitioned to real workspace state', {
          workspaceId: currentWorkspaceId,
          preservedDrawer: preservedData.drawer,
          preservedMainPanel: preservedData.mainPanel,
          isNewlyCreated: hasInitialAgent,
        });

        // Dispose the old state asynchronously
        oldState.dispose().catch((error: unknown) => {
          logger.error('Failed to dispose old optimistic state', { error });
        });
      } catch (error) {
        logger.error('Failed to create workspace state for real workspace', {
          workspaceId: currentWorkspaceId,
          error,
        });
        // Restore the old state on error
        workspaceState = oldState;
      }

      return; // Don't continue with normal disposal flow
    }

    // Handle workspace transitions (non-optimistic)
    // Key insight: Create new state BEFORE disposing old one to avoid blank state during transition
    const previousState = workspaceState;
    if (previousState && !stateDisposing) {
      // Clear any in-flight load from the previous workspace so the loader's
      // deduplication guards don't block the new workspace from loading.
      // (The optimistic transition path already does this at line 238.)
      workspaceLoader.clearLoadingState();

      // Create the new workspace state immediately to avoid UI gaps
      if (currentWorkspaceId) {
        try {
          initializeWorkspaceState(currentWorkspaceId);
          logger.info('Created new workspace state before disposal (smooth transition)', {
            workspaceId: currentWorkspaceId,
            previousWorkspaceId,
          });
        } catch (error) {
          logger.error('Failed to create workspace state during transition', {
            workspaceId: currentWorkspaceId,
            error,
          });
          // Keep the old state if we can't create a new one
        }
      }

      // Now dispose the old state asynchronously (doesn't block UI)
      logger.debug('Disposing previous workspace state asynchronously', { previousWorkspaceId });
      Promise.race([
        previousState.dispose(),
        new Promise<void>((resolve) => setTimeout(resolve, 1000)),
      ]).catch((error) => {
        logger.error('Failed to dispose previous workspace state', { error });
        // This is non-critical since we already have the new state
      });
    } else if (!previousState) {
      // No previous state to dispose, create new state immediately
      if (currentWorkspaceId && !stateDisposing) {
        try {
          initializeWorkspaceState(currentWorkspaceId);
          logger.debug('Created new workspace state', {
            workspaceId: currentWorkspaceId,
          });
        } catch (error) {
          logger.error('Failed to create workspace state', {
            workspaceId: currentWorkspaceId,
            error,
          });
          untrack(() => {
            workspaceState = null;
          });
        }
      }
    }

    // Cleanup function for effect
    return () => {
      // State disposal will be handled when workspace changes or component unmounts
    };
  });

  // Convenient state access
  let state: any = $derived(workspaceState?.state);
  let workspace = $derived(state?.workspaceData);

  // Track workspace ID separately to prevent cascading effects on property changes (like title)
  // Only update safeWorkspace when workspace ID actually changes
  let safeWorkspace: any = $state(null);
  // NOTE: This is NOT $state to avoid creating a reactive dependency in the effect below
  // Using $state here would cause an infinite loop because the effect reads and writes it
  let lastSafeWorkspaceId: string | null = null;

  $effect(() => {
    const currentId = workspace?.id || null;
    // Only update safeWorkspace reference if the ID changed
    // Note: lastSafeWorkspaceId is NOT reactive, so reading it doesn't create a dependency
    if (currentId !== lastSafeWorkspaceId) {
      lastSafeWorkspaceId = currentId;
      safeWorkspace = workspace?.id ? workspace : null;
    } else if (workspace?.id && safeWorkspace) {
      // ID is the same, but we may need to update other properties silently
      // Use untrack to prevent this update from triggering other effects
      // that depend on safeWorkspace, which could cause infinite loops
      untrack(() => {
        Object.assign(safeWorkspace, workspace);
      });
    }
  });

  // Setup workspace state effects when state is created
  $effect(() => {
    if (workspaceState) {
      // Call setupEffects to enable workspace store synchronization
      // This needs to be done from component context to avoid orphaned effects
      workspaceState.setupEffects();

      // Restore scroll position after initial load
      // Use a delay to ensure content is rendered
      // Capture reference to avoid stale closure if workspaceState becomes null
      const currentState = workspaceState;
      setTimeout(() => {
        // Check if the state is still valid before calling
        if (currentState) {
          currentState.restoreInitialScrollPosition();
        }
      }, 200);
    }
  });

  // Debug workspace state changes
  $effect(() => {
    if (workspace === undefined && state?.workspaceData === undefined && workspaceState) {
      logger.warn('[WorkspacePage] Workspace became undefined', {
        hasState: !!state,
        hasWorkspaceState: !!workspaceState,
        workspaceId,
      });
    }
  });

  // Panel visibility manager
  const panelVisibilityManager = new PanelVisibilityManager();

  // Initialize panel visibility manager when workspace is loaded
  $effect(() => {
    if (workspaceId) {
      panelVisibilityManager.initialize(workspaceId);

      // Cleanup when workspace changes or component unmounts
      return () => {
        panelVisibilityManager.destroy?.();
      };
    }
  });

  // Register analytics context provider for dynamic UI context on all events
  $effect(() => {
    if (workspaceId && workspaceState) {
      const transientStore = getTransientUIStore(workspaceId);

      setAnalyticsContextProvider(() => ({
        routeName: 'workspace',
        mainPanelType: workspaceState?.state?.mainPanel?.type ?? null,
        sidebarActiveTab: transientStore?.sidebarActiveTab ?? null,
        workspaceTitle: safeWorkspace?.title ?? null,
      }));

      // Clear the context provider when workspace changes or component unmounts
      return () => {
        setAnalyticsContextProvider(null);
      };
    }
  });

  // ============================================================================
  // Sidebar State (composable)
  // ============================================================================

  const sidebarState = useSidebarState({
    get workspace() {
      return safeWorkspace;
    },
    get workspaceState() {
      return workspaceState;
    },
    get state() {
      return state;
    },
  });

  // ============================================================================
  // Tab Management
  // ============================================================================
  const tabManagement = useTabManagement({
    get workspaceId() {
      return workspaceId;
    },
    get workspaceState() {
      return workspaceState;
    },
    get previousWorkspaceId() {
      return previousWorkspaceId;
    },
    onResolved: async (optimisticId, realId) => {
      // Ensure main-side MCP servers/tool calls can resolve optimistic IDs.
      try {
        await transitionMCPWorkspace(optimisticId, realId);
      } catch (error) {
        logger.warn('Failed to transition MCP workspace (continuing anyway)', {
          optimisticId,
          realId,
          error,
        });
      }

      // Avoid double-navigation if something else already navigated.
      if (workspaceId === realId) return;
      void goto(`/workspace/${realId}`);
    },
    onFailed: (optimisticId, error) => {
      logger.error('Optimistic workspace creation failed', { optimisticId, error: error.message });
      void goto('/');
    },
  });

  // ============================================================================
  // Workspace Updates Listener
  // ============================================================================

  // Listen for workspace updates from agents or other sources
  // Use listenSync for synchronous cleanup - no race conditions on unmount
  $effect(() => {
    if (!workspaceId) return;

    // Listen for workspace:updated events (from API updates)
    const unsubUpdated = listenSync('workspace:updated', (event: any) => {
      const { workspaceId: eventWorkspaceId, changes } = event.payload || event;

      if (eventWorkspaceId === workspaceId && changes && typeof changes === 'object') {
        logger.info('[WorkspacePage] Workspace updated via API', {
          workspaceId,
          hasTitle: changes && 'title' in changes,
          newTitle: changes?.title,
        });

        if (workspaceState) {
          // Merge the event's changes directly into the current workspace data.
          // We cannot rely solely on workspaceStore.findById() here because
          // the layout's workspace:updated handler (which calls updateLocalWorkspace)
          // may not have run yet — the page's $effect listener fires before the
          // layout's onMount listener due to Svelte lifecycle ordering.
          const storeWorkspace = workspaceStore.findById(WorkspaceId(workspaceId));
          const currentData = workspaceState.state.workspaceData;
          const base = storeWorkspace || currentData;

          if (base) {
            const updated = { ...base, ...changes, id: base.id };
            workspaceState.updateState({
              workspaceData: updated,
              workspace: { id: base.id, status: 'ready' },
            });
          }
        }
      }
    });

    // One-time catch-up fetch: re-read workspace data from the backend to pick up
    // any title (or other field) updates that arrived while the page was navigating
    // and the listener was not yet active.  This closes the race window described in
    // the root-cause analysis — the fetch is lightweight (single GET) and only
    // updates the store/state if the backend data actually differs.
    const catchUpId = workspaceId; // capture for closure
    workspaceClient.get(WorkspaceId(catchUpId)).then((result) => {
      // Guard: effect may have been cleaned up (workspace changed) by now
      if (catchUpId !== workspaceId) return;
      if (!result.ok) return;

      const backend = result.data;
      const local = workspaceStore.findById(WorkspaceId(catchUpId));

      // Only push an update when the backend has something newer
      if (local && backend.title !== local.title) {
        logger.info('[WorkspacePage] Catch-up: backend title differs, updating', {
          workspaceId: catchUpId,
          localTitle: local.title,
          backendTitle: backend.title,
        });
        workspaceStore.updateLocalWorkspace(WorkspaceId(catchUpId), { title: backend.title });

        // Also update the page-level workspaceState so the header re-renders
        if (workspaceState) {
          const currentData = workspaceState.state.workspaceData;
          if (currentData) {
            workspaceState.updateState({
              workspaceData: { ...currentData, title: backend.title },
            });
          }
        }
      }
    });

    return () => {
      unsubUpdated();
    };
  });

  // ============================================================================
  // Workspace Loading (composable)
  // ============================================================================

  const workspaceLoader = useWorkspaceLoader({
    get workspaceId() {
      return workspaceId;
    },
    get workspaceState() {
      return workspaceState;
    },
    get state() {
      return state;
    },
    get previousWorkspaceId() {
      return previousWorkspaceId;
    },
  });

  // ============================================================================
  // Agents & Terminals
  // ============================================================================

  let agents: AgentSession[] = $state([]);
  let terminals: Terminal[] = $state([]);
  let agentsLoaded = $state(false);
  let terminalsLoaded = $state(false);



  // Loading locks for preventing race conditions
  const loadingLocks = new Map<string, Promise<void>>();

  // Track the pre-generated initial agent ID
  let initialAgentId: string | undefined = $state(undefined);

  // Check if the initial agent is currently working (streaming/processing)
  let isInitialAgentWorking = $derived.by(() => {
    if (!initialAgentId) return false;
    const session = sessionStore.getSession(initialAgentId);
    if (!session) return false;
    return session.isStreaming || session.isProcessing || session.isResponding || false;
  });

  // Track agent loading promise to prevent duplicate loads
  let agentLoadingPromise: Promise<void> | null = $state(null);

  // Track if we're in a transition to prevent skeleton loaders
  let isInTransition = $derived(tabManagement.isInTransition);

  /**
   * Helper to open an agent as a tab in the panel layout
   * @param agentId - The agent ID to open
   * @param agentName - The agent name for the tab title
   * @param wsId - Optional workspace ID (defaults to current workspace)
   * @param options - Optional configuration
   * @param options.focusIfExists - If true, focus the tab if it already exists. Default: true.
   *                                Set to false when restoring drawer state to preserve panel layout's persisted active tab.
   */
  function openAgentInLayout(
    agentId: string,
    agentName: string,
    wsId?: string,
    options?: { focusIfExists?: boolean },
  ) {
    const targetWorkspaceId = wsId ?? safeWorkspace?.id;
    if (!targetWorkspaceId) return;

    const focusIfExists = options?.focusIfExists ?? true;

    const layoutManager = getPanelLayoutManager(targetWorkspaceId);

    // Check if the agent already exists in ANY panel (not just the target panel)
    // This prevents duplicate agent tabs when restoring state on refresh
    for (const [panelId, panel] of Object.entries(layoutManager.layout.panels)) {
      const existingAgentTab = panel.tabs.find((t) => t.type === 'agent' && t.agentId === agentId);
      if (existingAgentTab) {
        if (focusIfExists) {
          // Agent already open in a panel - focus it instead of creating a duplicate
          logger.info('[WorkspacePage] Agent already open in panel layout, focusing existing tab', {
            agentId,
            existingTabId: existingAgentTab.id,
            panelId,
            workspaceId: targetWorkspaceId,
          });
          // Focus the panel containing the tab
          layoutManager.focusPanel(panelId);
          // Set the tab as active in that panel
          layoutManager.setActiveTab(existingAgentTab.id, panelId);
        } else {
          // Agent already open - skip focusing to preserve panel layout's persisted active tab state
          logger.info(
            '[WorkspacePage] Agent already open in panel layout, skipping focus to preserve active tab state',
            {
              agentId,
              existingTabId: existingAgentTab.id,
              panelId,
              workspaceId: targetWorkspaceId,
            },
          );
        }
        return;
      }
    }

    layoutManager.openTab({
      type: 'agent',
      title: agentName || 'Agent',
      agentId: agentId,
      closable: true,
    });
    logger.info('[WorkspacePage] Opened agent in panel layout', {
      agentId,
      workspaceId: targetWorkspaceId,
    });
  }

  /**
   * Helper to open a note as a tab in the panel layout
   */
  function openNoteInLayout(noteId: string, noteTitle: string, wsId?: string) {
    const targetWorkspaceId = wsId ?? safeWorkspace?.id;
    if (!targetWorkspaceId) return;

    const layoutManager = getPanelLayoutManager(targetWorkspaceId);
    layoutManager.openTab({
      type: 'note',
      title: noteTitle || 'Note',
      noteId: noteId,
      closable: true,
    });
    logger.info('[WorkspacePage] Opened note in panel layout', {
      noteId,
      workspaceId: targetWorkspaceId,
    });
  }

  /**
   * Check whether the spec panel should be deferred for this workspace.
   * Returns true when an initial spec-writer agent exists — the spec panel
   * will slide in reactively once spec generation actually starts.
   */
  // Track workspaces where the spec slide-in has already completed.
  // Once the spec has been opened (animated or not), we must NOT defer again
  // on subsequent navigations back to this workspace within the same session.
  const specSlideInCompleted = new Set<string>();

  function shouldDeferSpecPanel(wsId: string): boolean {
    // If the spec slide-in already completed for this workspace, never defer again.
    // This prevents setDeferSpecTab(true) from stripping the spec tab when the
    // user navigates away and back.
    if (specSlideInCompleted.has(wsId)) {
      logger.info('[shouldDeferSpecPanel] NOT deferring — slide-in already completed for this workspace', { wsId });
      return false;
    }

    const brandedId = WorkspaceId(wsId);
    // Check if the initial spec write is already in progress
    if (unifiedStateStore.getInitialSpecWriteInProgress(brandedId)) {
      logger.info('[shouldDeferSpecPanel] Deferring: isInitialSpecWriteInProgress=true', { wsId });
      return true;
    }
    // Check if there's a pending initial agent config that is a spec-writer
    const agentConfigData = sessionStorage.getItem(`workspace:${wsId}:agent-config`);
    if (agentConfigData) {
      try {
        const config = JSON.parse(agentConfigData);
        const isSpecWriter =
          config.specialist === 'spec-writer' || config.metadata?.specialist === 'spec-writer';
        if (isSpecWriter && (config.isInitialAgent || config.isFirstWorkspaceAgent)) {
          logger.info('[shouldDeferSpecPanel] Deferring: found spec-writer agent config in sessionStorage', { wsId });
          return true;
        }
      } catch {
        // ignore parse errors
      }
    }
    // Check if we have a pending initial agent marker (even if agent-config was cleaned up)
    const pendingAgentData = sessionStorage.getItem(`workspace:${wsId}:initial-agent-pending`);
    if (pendingAgentData) {
      try {
        const parsed = JSON.parse(pendingAgentData);
        const isSpecWriter =
          parsed.config?.specialist === 'spec-writer' ||
          parsed.config?.metadata?.specialist === 'spec-writer';
        if (isSpecWriter) {
          logger.info('[shouldDeferSpecPanel] Deferring: found spec-writer in initial-agent-pending', { wsId });
          return true;
        }
      } catch {
        // ignore parse errors
      }
    }
    // NOTE: We intentionally do NOT check the unified state store for initial
    // spec-writer agents here. The agent's isInitialAgent metadata persists
    // forever (it's a property of the agent session saved to disk), so that
    // check would trigger deferral on every fresh page load for any workspace
    // that was ever created with a spec-writer — causing a 3-second delay
    // before the spec panel appears. The sessionStorage checks above are
    // sufficient: they only exist during the browser session in which the
    // workspace was created, and the getInitialSpecWriteInProgress check
    // above handles the case where the agent is actively streaming right now.
    logger.info('[shouldDeferSpecPanel] NOT deferring — no spec-writer signals found', { wsId });
    return false;
  }

  // ── Universal spec-tab deferral ──
  // As soon as a workspace ID is available, set the deferSpecTab flag on its
  // layout manager.  This runs BEFORE any restoration/fallback logic that might
  // try to open a spec tab, ensuring the guard catches every code path.
  //
  // IMPORTANT: The entire body (except the wsId read) is wrapped in `untrack`
  // because `setDeferSpecTab(true)` mutates reactive panel state (stripping
  // existing spec tabs) and `persistState` reads it.  Without `untrack` this
  // creates a read→write→read loop that hits `effect_update_depth_exceeded`.
  $effect(() => {
    const wsId = safeWorkspace?.id;
    if (!wsId) return;

    // Everything below must be untracked to avoid reactive loops.
    untrack(() => {
      const shouldDefer = shouldDeferSpecPanel(wsId);
      if (shouldDefer) {
        const layoutManager = getPanelLayoutManager(wsId);
        layoutManager.setDeferSpecTab(true);
      }
    });

    // Clean up: ensure the flag is cleared when the workspace changes or unmounts
    // so it doesn't stick around for workspaces that don't need it.
    return () => {
      untrack(() => {
        const layoutManager = getPanelLayoutManager(wsId);
        layoutManager.setDeferSpecTab(false);
      });
    };
  });

  // Check for optimistic initial agent on mount and transitions
  $effect(() => {
    // Capture workspace ID and workspace reference at the start to avoid race conditions
    // during async execution where safeWorkspace could become null or change
    const capturedWorkspaceId = safeWorkspace?.id;
    const capturedWorkspace = safeWorkspace;

    // Read initialAgentConfigProcessed with untrack to avoid creating a reactive dependency
    // that would cause the effect to re-run when we set it to true
    const alreadyProcessed = untrack(() => initialAgentConfigProcessed);

    if (capturedWorkspaceId && !alreadyProcessed) {
      // Mark as processed to prevent duplicate processing
      // Use untrack to avoid triggering effect re-run
      untrack(() => {
        initialAgentConfigProcessed = true;
      });

      // First check if there was a creation error
      const errorKey = `workspace:${capturedWorkspaceId}:creation-error`;
      const errorData = sessionStorage.getItem(errorKey);

      if (errorData) {
        try {
          const { error, timestamp } = JSON.parse(errorData);
          // Show error if it's recent (within 30 seconds)
          if (Date.now() - timestamp < 30000) {
            logger.error('[WorkspacePage] Workspace creation failed', { error });
            // Show error toast to user
            toast.error(`Failed to create workspace: ${error}`, {
              duration: 10000,
              description: 'Please try again or contact support if the issue persists.',
            });
          }
          sessionStorage.removeItem(errorKey);
        } catch (e) {
          logger.error('[WorkspacePage] Failed to parse error data', e);
          sessionStorage.removeItem(errorKey);
        }
      }

      // Check if we have a pending initial agent from workspace creation
      const pendingAgentKey = `workspace:${capturedWorkspaceId}:initial-agent-pending`;
      const pendingAgentData = sessionStorage.getItem(pendingAgentKey);

      // Also check for regular agent config (in case of page reload after migration)
      const agentConfigKey = `workspace:${capturedWorkspaceId}:agent-config`;
      const agentConfigData = sessionStorage.getItem(agentConfigKey);

      if (pendingAgentData || agentConfigData) {
        try {
          let agentId: string | undefined, config: any, timestamp: number | undefined;

          if (pendingAgentData) {
            const parsed = JSON.parse(pendingAgentData);
            agentId = parsed.agentId;
            config = parsed.config;
            timestamp = parsed.timestamp;
          } else if (agentConfigData) {
            // Handle case where we only have agent-config (after migration/reload)
            config = JSON.parse(agentConfigData) as any;
            agentId =
              config.agentId ||
              `agent-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
            // Use the config's timestamp if available, otherwise check if this is a stale config
            // by looking at the persisted drawer state - if the drawer was open with a different
            // agent, this is likely a stale config from a previous session
            timestamp = config.timestamp;
          }

          // Use if it's recent (within 30 seconds to handle slow systems and transitions)
          if (!timestamp || Date.now() - timestamp < 30000) {
            logger.info('[WorkspacePage] Found pending initial agent', {
              workspaceId: capturedWorkspaceId,
              agentId,
              hasPrompt: !!config.prompt,
              isOptimistic: capturedWorkspaceId.startsWith('optimistic-'),
              isInitialAgent: config.isInitialAgent,
              isFirstWorkspaceAgent: config.isFirstWorkspaceAgent,
              fromPending: !!pendingAgentData,
              fromConfig: !!agentConfigData,
            });

            initialAgentId = agentId;

            // Mark this agent as recently created so the drawer doesn't close
            if (agentId) markAgentRecentlyCreated(agentId);

            // Store the config for AuggieChatPanel - it's already set by WorkspaceInitializer migration
            // but ensure it's there in case of race conditions
            if (!sessionStorage.getItem(`workspace:${capturedWorkspaceId}:agent-config`)) {
              sessionStorage.setItem(
                `workspace:${capturedWorkspaceId}:agent-config`,
                JSON.stringify({
                  ...config,
                  initialAgentId: agentId,
                }),
              );
            }

            // For non-optimistic workspaces, create or resume the real agent now
            if (!capturedWorkspaceId.startsWith('optimistic-')) {
              logger.info('[WorkspacePage] Checking if agent exists for non-optimistic workspace', {
                workspaceId: capturedWorkspaceId,
                agentId,
              });

              // First check if the agent already exists
              const existingSessions = agentService.getSessionsForWorkspace(capturedWorkspaceId);
              const existingSession = existingSessions.find((s) => s.id === agentId);

              if (existingSession) {
                logger.info('[WorkspacePage] Agent already exists, using existing session', {
                  agentId: existingSession.id,
                  workspaceId: capturedWorkspaceId,
                });

                // Mark the session with the initial agent flags BEFORE adding to agents list
                // This ensures the flags are present when the content IIFE re-evaluates
                if (config.isInitialAgent) {
                  (existingSession as any).isInitialAgent = true;
                }
                if (config.isFirstWorkspaceAgent) {
                  (existingSession as any).isFirstWorkspaceAgent = true;
                }

                // Add to agents list if not already there
                if (!agents.find((a: AgentSession) => a?.id === agentId)) {
                  agents = [...agents, existingSession];
                }
              } else if (agentId && capturedWorkspace) {
                // For initial agents from workspace creation, restore the existing pending agent
                // instead of creating a new one
                logger.info('[WorkspacePage] Restoring pending initial agent', {
                  workspaceId: capturedWorkspaceId,
                  agentId,
                  isInitialAgent: config.isInitialAgent,
                });

                agentService
                  .activateInitialAgent(
                    agentId as string,
                    capturedWorkspace,
                    () => agentService.restoreSession(agentId as string, capturedWorkspace),
                  )
                  .then((session) => {
                    if (session) {
                      logger.info('[WorkspacePage] Initial agent restored successfully', {
                        agentId: session.id,
                        workspaceId: capturedWorkspaceId,
                        status: session.status,
                      });

                      // Mark the session with the initial agent flags
                      if (config.isInitialAgent) {
                        (session as any).isInitialAgent = true;
                      }
                      if (config.isFirstWorkspaceAgent) {
                        (session as any).isFirstWorkspaceAgent = true;
                      }

                      // Add to agents list if not already there
                      if (!agents.find((a: AgentSession) => a?.id === agentId)) {
                        agents = [...agents, session];
                      }
                    } else {
                      // If restore fails, DON'T create a new agent immediately.
                      // The agent loader will handle this properly after loading from disk.
                      // Creating a new session here would overwrite existing messages on disk.
                      // See: https://github.com/augmentcode/augment/issues/XXXX
                      logger.info(
                        '[WorkspacePage] Restore returned null, deferring to agent loader',
                        {
                          agentId,
                          workspaceId: capturedWorkspaceId,
                        },
                      );
                      // The loadAgentsFromDisk effect will handle restoring this agent
                      // with its messages intact once the disk read completes.
                    }
                  })
                  .catch((error) => {
                    logger.error('[WorkspacePage] Failed to restore agent', { error });
                  });
              }
            }

            // Only open the drawer if it's not already open with different content
            // This prevents overwriting the persisted drawer state on page refresh
            // IMPORTANT: Check the persisted drawer state from localStorage, not from workspaceState
            // because workspaceState might not be created yet during workspace transitions
            const persistedState = workspaceStorageManager.loadState(capturedWorkspaceId);
            const persistedDrawerState = persistedState?.drawer;
            const currentDrawerState = workspaceState?.state?.drawer ?? persistedDrawerState;
            const drawerAlreadyOpen =
              currentDrawerState?.open &&
              currentDrawerState?.itemId &&
              currentDrawerState?.itemId !== agentId;

            if (drawerAlreadyOpen) {
              logger.info(
                '[WorkspacePage] Drawer already open with different content, not overwriting',
                {
                  currentType: currentDrawerState?.type,
                  currentItemId: currentDrawerState?.itemId,
                  initialAgentId: agentId,
                  fromPersisted: !workspaceState?.state?.drawer,
                },
              );
              // Clean up the stale agent-config since we're not using it
              sessionStorage.removeItem(agentConfigKey);
            } else if (agentId) {
              // Open the agent in panel layout
              openAgentInLayout(agentId, config.name || 'Agent', capturedWorkspaceId);

              // For spec-writer agents in new workspaces, the spec panel will be
              // opened dynamically (with a slide-in animation) once spec generation
              // begins. See the specPanelSlideIn effect below.
            }

            // Cleanup pending marker once handled (non-optimistic only)
            if (!capturedWorkspaceId.startsWith('optimistic-')) {
              sessionStorage.removeItem(pendingAgentKey);
            }
          } else {
            // Only clean up if it's too old
            sessionStorage.removeItem(pendingAgentKey);
          }
        } catch (e) {
          logger.error('[WorkspacePage] Failed to parse pending agent data', e);
          sessionStorage.removeItem(pendingAgentKey);
        }
      }
    }
  });

  // Load terminals from localStorage AND backend when workspace is ready
  async function loadTerminalsFromStorage() {
    // Capture workspace ID at the start to avoid race conditions during async execution
    const capturedWorkspaceId = safeWorkspace?.id;

    if (!capturedWorkspaceId || terminalsLoaded) return;

    try {
      logger.debug('[WorkspacePage] Loading terminals from storage and backend', {
        workspaceId: capturedWorkspaceId,
      });

      // Load terminal metadata from localStorage
      const terminalMetadata = terminalManager.loadTerminalMetadata(capturedWorkspaceId);

      // Also query backend for active terminals (e.g., setup script terminals)
      let backendTerminals: Array<{ id: string; workspaceId: string; cwd: string }> = [];
      try {
        const result = await window.electronAPI?.invoke('terminal:professional:list', {
          workspaceId: capturedWorkspaceId,
        });
        if (result?.success && result.terminals) {
          backendTerminals = result.terminals;
          logger.debug('[WorkspacePage] Got backend terminals', {
            count: backendTerminals.length,
            ids: backendTerminals.map((t: { id: string }) => t.id),
          });
        }
      } catch (error) {
        logger.warn('[WorkspacePage] Failed to query backend terminals', { error });
      }

      // Merge localStorage terminals with backend terminals
      const terminalMap = new Map<string, Terminal>();

      // Add localStorage terminals first
      if (terminalMetadata && terminalMetadata.length > 0) {
        for (const meta of terminalMetadata) {
          if (meta.terminalId.startsWith('agent-')) {
            logger.warn('[WorkspacePage] Skipping agent ID in terminal metadata', {
              terminalId: meta.terminalId,
            });
            continue;
          }
          terminalMap.set(meta.terminalId, {
            id: meta.terminalId,
            type: 'terminal' as const,
            title: meta.title || 'Terminal',
            workspaceId: meta.workspaceId,
            createdAt: meta.createdAt,
          });
        }
      }

      // Add backend terminals (these may include setup script terminals not yet in localStorage)
      for (const backendTerminal of backendTerminals) {
        if (backendTerminal.id.startsWith('agent-')) {
          continue;
        }
        if (!terminalMap.has(backendTerminal.id)) {
          // Terminal from backend not in localStorage - add it and persist
          const newTerminal: Terminal = {
            id: backendTerminal.id,
            type: 'terminal' as const,
            title: 'Setup', // Backend-created terminals are usually setup scripts
            workspaceId: backendTerminal.workspaceId,
            createdAt: new Date().toISOString(),
          };
          terminalMap.set(backendTerminal.id, newTerminal);

          // Save to localStorage for future loads
          terminalManager.saveTerminalMetadata(
            backendTerminal.id,
            backendTerminal.workspaceId,
            'Setup',
          );

          // Add to overlay store so it appears in the terminal tab bar
          // This handles the case where the terminal:created event was missed
          // (e.g., setup script terminal created before the workspace page mounted)
          terminalOverlayStore.addTerminal(backendTerminal.id, 'Setup');

          logger.info('[WorkspacePage] Added backend terminal to list and overlay', {
            terminalId: backendTerminal.id,
          });
        }
      }

      const restoredTerminals = Array.from(terminalMap.values());
      // Use untrack for state updates to avoid effect loops
      untrack(() => {
        terminals = restoredTerminals;
        workspaceState?.updateState({ terminalsList: restoredTerminals });
      });

      logger.debug('[WorkspacePage] Terminals loaded', {
        count: restoredTerminals.length,
        ids: restoredTerminals.map((t) => t.id),
        fromLocalStorage: terminalMetadata?.length || 0,
        fromBackend: backendTerminals.length,
      });

      terminalsLoaded = true;
    } catch (error) {
      logger.error('[WorkspacePage] Failed to load terminals from storage', error);
      untrack(() => {
        terminals = [];
      });
      terminalsLoaded = true;
    }
  }

  // Load agents from disk when workspace is ready
  async function loadAgentsFromDisk() {
    // Capture workspace ID and workspace reference at the start to avoid race conditions
    // during async execution where safeWorkspace could become null
    const capturedWorkspaceId = safeWorkspace?.id;
    const capturedWorkspace = safeWorkspace;

    if (!capturedWorkspaceId || agentsLoaded) return;

    const lockKey = `load-agents-${capturedWorkspaceId}`;

    // Check if already loading
    if (loadingLocks.has(lockKey)) {
      return loadingLocks.get(lockKey);
    }

    // Create and store the loading promise
    const loadPromise = (async () => {
      // Acquire lock to prevent AgentSubscription from running a redundant parallel load
      acquireAgentLoadLock(capturedWorkspaceId);
      try {
        logger.debug('[WorkspacePage] Loading agents from disk', {
          workspaceId: capturedWorkspaceId,
        });

        // First check what agents are already in memory
        const existingAgents = agentService.getSessionsForWorkspace(capturedWorkspaceId);
        const existingAgentIds = new Set(existingAgents.filter((a) => a).map((a) => a.id));

        logger.debug('[WorkspacePage] Existing agents in memory', {
          count: existingAgents.length,
          ids: Array.from(existingAgentIds),
        });

        const { getStoredAgentsFromDisk } = await import('$lib/utils/agent-loader');

        // Abort if workspace changed during async import
        // Use workspaceId (route param) instead of safeWorkspace?.id because safeWorkspace
        // can be transiently null during workspace transitions, causing false aborts
        if (workspaceId !== capturedWorkspaceId) {
          logger.info('[WorkspacePage] Aborting agent load - workspace changed during import', {
            capturedWorkspaceId,
            currentWorkspaceId: workspaceId,
          });
          return;
        }

        const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

        // When expecting an initial agent, retry a few times to avoid racing the disk write
        const diskAgents = await (async () => {
          let attempt = 0;
          let agents = await getStoredAgentsFromDisk(capturedWorkspaceId);

          while (
            initialAgentId &&
            !capturedWorkspaceId.startsWith('optimistic-') &&
            !agents.some((a) => a.id === AgentId(initialAgentId as string)) &&
            attempt < 3
          ) {
            attempt++;
            await pause(150);
            agents = await getStoredAgentsFromDisk(capturedWorkspaceId);
          }

          return agents;
        })();

        // Abort if workspace changed during disk agent loading
        // Use workspaceId (route param) instead of safeWorkspace?.id because safeWorkspace
        // can be transiently null during workspace transitions, causing false aborts
        if (workspaceId !== capturedWorkspaceId) {
          logger.info('[WorkspacePage] Aborting agent load - workspace changed during disk read', {
            capturedWorkspaceId,
            currentWorkspaceId: workspaceId,
          });
          return;
        }

        logger.debug('[WorkspacePage] Found agents on disk', {
          count: diskAgents.length,
          agents: diskAgents.map((a) => ({ id: a.id, name: a.name })),
        });

        // Check if we have an initial agent that needs to be loaded first
        if (initialAgentId && !existingAgentIds.has(AgentId(initialAgentId as string))) {
          const initialAgentOnDisk = diskAgents.find(
            (a) => a.id === AgentId(initialAgentId as string),
          );
          if (initialAgentOnDisk) {
            // Check if the agent is already being activated or has been activated
            const existingSession = agentService.getSession(initialAgentId);
            const isAlreadyActive = existingSession && !(existingSession as any).isPending;

            // Check if agent is already in the agent state
            const hasAgentInState = agentService.hasAgent(initialAgentId);

            if (!isAlreadyActive && !hasAgentInState) {
              const capturedAgentId = initialAgentId;
              logger.info('[WorkspacePage] Found initial agent on disk, restoring with priority', {
                agentId: initialAgentId,
                name: initialAgentOnDisk.name,
              });

              try {
                // Use activateInitialAgent lock to prevent duplicate activation
                // when multiple code paths race during workspace creation
                const restored = await agentService.activateInitialAgent(
                  initialAgentId,
                  capturedWorkspace,
                  () => agentService.resumeSession(capturedAgentId, capturedWorkspace),
                );
                if (restored) {
                  // Add to recently created agents to prevent drawer from closing
                  markAgentRecentlyCreated(initialAgentId);

                  logger.info('[WorkspacePage] Initial agent restored successfully with backend', {
                    agentId: initialAgentId,
                  });
                }
              } catch (error) {
                logger.error('[WorkspacePage] Failed to restore initial agent', {
                  agentId: initialAgentId,
                  error,
                });
              }
            } else {
              logger.info(
                '[WorkspacePage] Initial agent already active or in store, skipping restore',
                {
                  agentId: initialAgentId,
                  isActive: isAlreadyActive,
                  hasAgentInState,
                },
              );

              // Still add to recently created agents to prevent drawer from closing
              markAgentRecentlyCreated(initialAgentId);
            }
          } else {
            // Agent not found on disk - this is a truly new agent, create it
            // This handles the case where restoreSession returned null because the agent
            // doesn't exist yet (not because of a race condition with persistence loading)
            logger.info('[WorkspacePage] Initial agent not found on disk, creating new one', {
              agentId: initialAgentId,
              workspaceId: capturedWorkspaceId,
            });

            // Get the config from sessionStorage
            const agentConfigData = sessionStorage.getItem(
              `workspace:${capturedWorkspaceId}:agent-config`,
            );
            const config = agentConfigData ? JSON.parse(agentConfigData) : {};

            try {
              // Use activateInitialAgent lock to prevent duplicate creation
              const newSession = await agentService.activateInitialAgent(
                initialAgentId,
                capturedWorkspace,
                () => agentService.createSession(capturedWorkspace, {
                  agentId: initialAgentId,
                  name: config.name || 'Agent',
                  model: config.model,
                  provider: config.provider, // Pass provider from CompactWorkspaceInitializer
                  agentType: config.agentType,
                  initialMessage: config.prompt, // Pass the initial prompt from CompactWorkspaceInitializer
                  contextReferences: config.contextReferences, // Pass file/issue context references for stdinContext
                  behaviorPrompt: config.behaviorPrompt, // Pass specialist behavior instructions
                  metadata: {
                    ...config.metadata, // Preserve all metadata including specialist
                    isInitialAgent: config.isInitialAgent,
                    isFirstWorkspaceAgent: config.isFirstWorkspaceAgent,
                    specialist: config.specialist || config.metadata?.specialist, // Ensure specialist is included
                  },
                  isPending: false,
                }),
              );

              if (newSession) {
                markAgentRecentlyCreated(initialAgentId);

                logger.info('[WorkspacePage] Created new initial agent', {
                  agentId: newSession.id,
                  workspaceId: capturedWorkspaceId,
                });
              }
            } catch (error) {
              logger.error('[WorkspacePage] Failed to create initial agent', {
                agentId: initialAgentId,
                error,
              });
            }
          }
        }

        // Abort if workspace changed during initial agent restore
        // Use workspaceId (route param) instead of safeWorkspace?.id because safeWorkspace
        // can be transiently null during workspace transitions, causing false aborts
        if (workspaceId !== capturedWorkspaceId) {
          logger.info(
            '[WorkspacePage] Aborting agent load - workspace changed after initial agent',
            {
              capturedWorkspaceId,
              currentWorkspaceId: workspaceId,
            },
          );
          return;
        }

        // Restore ALL agents from disk that aren't already in memory
        // If an agent file exists on disk, it should be shown
        // If it was deleted, the file shouldn't exist
        const agentsToRestore = diskAgents.filter(
          (agent) =>
            !existingAgentIds.has(agent.id as any) &&
            (!initialAgentId || agent.id !== initialAgentId), // Skip initial agent as it's already restored
        );

        logger.debug('[WorkspacePage] Will restore all agents from disk', {
          diskAgentsCount: diskAgents.length,
          alreadyInMemory: existingAgentIds.size,
          willRestoreCount: agentsToRestore.length,
          agents: agentsToRestore.map((a) => ({ id: a.id, name: a.name })),
        });

        // Restore all agent sessions in PARALLEL for faster loading
        const restorePromises = agentsToRestore.map(async (agent) => {
          try {
            // Use resumeSession to ensure backend registration
            const restored = await agentService.resumeSession(agent.id, capturedWorkspace);
            if (restored) {
              logger.debug('[WorkspacePage] Restored agent session with backend', {
                agentId: agent.id,
                name: agent.name,
              });
              return { agentId: agent.id, success: true };
            } else {
              // CRITICAL FIX: Only count as success if session was actually restored
              logger.warn('[WorkspacePage] resumeSession returned null for agent', {
                agentId: agent.id,
              });
              return { agentId: agent.id, success: false, error: 'resumeSession returned null' };
            }
          } catch (error) {
            logger.warn('[WorkspacePage] Failed to restore agent', {
              agentId: agent.id,
              error,
            });
            return { agentId: agent.id, success: false, error };
          }
        });

        // Wait for all restorations to complete
        const results = await Promise.all(restorePromises);
        const successCount = results.filter((r) => r.success).length;
        logger.info('[WorkspacePage] Parallel agent restoration complete', {
          total: agentsToRestore.length,
          succeeded: successCount,
          failed: agentsToRestore.length - successCount,
        });

        // Abort check before updating state
        // Use workspaceId (route param) instead of safeWorkspace?.id because safeWorkspace
        // can be transiently null during workspace transitions, causing false aborts
        if (workspaceId !== capturedWorkspaceId) {
          logger.info(
            '[WorkspacePage] Aborting agent load - workspace changed before state update',
            {
              capturedWorkspaceId,
              currentWorkspaceId: workspaceId,
            },
          );
          return;
        }

        // After restoring selected agents, get the updated list from the service
        const restoredAgents = agentService.getSessionsForWorkspace(capturedWorkspaceId);

        logger.info('[WorkspacePage] Getting sessions from agentService', {
          workspaceId: capturedWorkspaceId,
          restoredCount: restoredAgents.length,
          restoredAgentIds: restoredAgents.filter((a) => a).map((a) => a.id),
          restoredAgentWorkspaceIds: restoredAgents
            .filter((a) => a)
            .map((a) => ({
              id: a.id,
              workspaceId: a.workspaceId,
            })),
        });

        // Filter out any terminal IDs that might have gotten into the agents list
        const filteredAgents = restoredAgents.filter(
          (a) => a && !String(a.id).startsWith('terminal-'),
        );
        // Use untrack for state updates to avoid effect loops
        untrack(() => {
          agents = filteredAgents;
        });

        // Debug: Log what messages are in the restored agents
        logger.info('[WorkspacePage] Restored agents with messages', {
          agentsWithMessages: restoredAgents
            .filter((a) => a)
            .map((a) => ({
              id: a.id,
              name: a.name,
              messageCount: a.messages?.length || 0,
              hasMessages: !!(a.messages && a.messages.length > 0),
              firstMessage: a.messages?.[0]
                ? {
                    role: a.messages[0].role,
                    contentType: typeof (a.messages[0] as any).content,
                    hasContentBlocks: !!a.messages[0].contentBlocks,
                  }
                : null,
            })),
        });

        // Check if this is a newly created workspace (no agents yet)
        const isNewlyCreated = restoredAgents.length === 0;

        // Use untrack for state updates to avoid effect loops
        untrack(() => {
          workspaceState?.updateState({
            agentsList: restoredAgents,
            isNewlyCreatedWorkspace: isNewlyCreated,
          });
        });

        agentsLoaded = true;
        logger.info('[WorkspacePage] Agents loaded successfully', {
          count: restoredAgents.length,
          isNewlyCreated,
        });

        // NOTE: Stale agent-config cleanup is deferred until AFTER the restoration
        // logic below, because shouldDeferSpecPanel() reads from sessionStorage to
        // decide whether to show the spec panel immediately or defer it for the
        // slide-in animation. Cleaning up too early would remove the signal.

        // After loading agents, verify streaming states with the backend
        // This clears stale isStreaming flags for agents whose backend streams have completed
        // and returns the list of agent IDs that have active streams
        let hasOpenedStreamingAgent = false;
        try {
          const activeStreamAgentIds = await agentService.reconnectToBackendStreams();

          // If there are active streams, check if any belong to this workspace
          // and prioritize opening the drawer to show the streaming agent
          if (activeStreamAgentIds.length > 0 && capturedWorkspaceId) {
            // Find the first streaming agent that belongs to this workspace
            // Convert to strings for comparison since AgentSession.id is a branded type
            const workspaceAgentIds = new Set(
              restoredAgents.map((a: AgentSession) => String(a.id)),
            );
            const streamingAgentInWorkspace = activeStreamAgentIds.find((id) =>
              workspaceAgentIds.has(id),
            );

            if (streamingAgentInWorkspace) {
              logger.info('[WorkspacePage] Found streaming agent in workspace, opening', {
                workspaceId: capturedWorkspaceId,
                streamingAgentId: streamingAgentInWorkspace,
                activeStreamCount: activeStreamAgentIds.length,
              });
              // Open the streaming agent - this overrides the persisted state to prioritize the active stream
              openAgentInLayout(streamingAgentInWorkspace, 'Agent', capturedWorkspaceId);
              hasOpenedStreamingAgent = true;
            }
          }
        } catch (error) {
          logger.warn('[WorkspacePage] Failed to reconnect to backend streams', { error });
        }

        // If we didn't open a streaming agent, restore the persisted drawer state
        // This prevents the flash where we show the persisted agent briefly before switching to streaming
        //
        // IMPORTANT: Skip restoring persisted drawer state when we already have an initial
        // agent open (newly created workspace). The persisted state may contain a stale agent
        // ID from a previous workspace with the same ID, which would cause a spurious second
        // agent to be created when the ChatPanel mounts for the non-existent agent.
        const hasInitialAgentOpen = !!initialAgentId;
        if (hasInitialAgentOpen) {
          logger.info(
            '[WorkspacePage] Skipping persisted drawer restore - initial agent already open',
            {
              workspaceId: capturedWorkspaceId,
              initialAgentId,
            },
          );
        }
        if (!hasOpenedStreamingAgent && !hasInitialAgentOpen) {
          const persistedState = workspaceState?.getPersistedState();
          if (persistedState?.drawer?.open && persistedState?.drawer?.itemId) {
            // Validate that the persisted agent actually exists in the restored agents list
            // to prevent opening stale agent IDs from previous workspaces
            const persistedAgentExists =
              persistedState.drawer.type !== 'agent' ||
              restoredAgents.some(
                (a: AgentSession) => String(a.id) === String(persistedState.drawer?.itemId),
              );

            if (!persistedAgentExists) {
              logger.info(
                '[WorkspacePage] Skipping persisted drawer state - agent not found in restored agents',
                {
                  workspaceId: capturedWorkspaceId,
                  persistedAgentId: persistedState.drawer.itemId,
                  restoredAgentIds: restoredAgents.map((a: AgentSession) => a.id),
                },
              );
            } else {
              logger.info('[WorkspacePage] Restoring persisted drawer state after agent load', {
                workspaceId: capturedWorkspaceId,
                drawer: persistedState.drawer,
              });
              // Also open in panel layout for the new panel-based UI
              // The drawer system is the old UI, but we need to support both during transition
              if (persistedState.drawer.type === 'agent') {
                // Find the agent to get its name
                const agent = restoredAgents.find(
                  (a: AgentSession) => a.id === persistedState.drawer?.itemId,
                );
                // Use focusIfExists: false to preserve panel layout's persisted active tab state
                // The panel layout already stores which tab was active, so we shouldn't override it
                openAgentInLayout(
                  persistedState.drawer.itemId,
                  agent?.name || 'Agent',
                  capturedWorkspaceId,
                  { focusIfExists: false },
                );
              }
              workspaceState?.openDrawer(persistedState.drawer.type, persistedState.drawer.itemId);
            }
          } else if (restoredAgents.length > 0) {
            // No persisted drawer state, but we have agents
            // Check if the panel layout already has tabs - if not, open the most recent agent
            const layoutManager = getPanelLayoutManager(capturedWorkspaceId);
            const allTabs = Object.values(layoutManager.layout.panels).flatMap((p) => p.tabs);
            const hasAgentTabs = allTabs.some((t) => t.type === 'agent');

            if (!hasAgentTabs) {
              // Sort by createdAt descending to get the most recent agent
              const sortedAgents = [...restoredAgents].sort((a, b) => {
                const aTime = new Date(a.createdAt || 0).getTime();
                const bTime = new Date(b.createdAt || 0).getTime();
                return bTime - aTime;
              });
              const mostRecentAgent = sortedAgents[0];
              if (mostRecentAgent) {
                logger.info('[WorkspacePage] No persisted state, opening most recent agent', {
                  workspaceId: capturedWorkspaceId,
                  agentId: mostRecentAgent.id,
                  agentName: mostRecentAgent.name,
                });
                openAgentInLayout(
                  mostRecentAgent.id,
                  mostRecentAgent.name || 'Agent',
                  capturedWorkspaceId,
                );

                // If the layout has no tabs at all (fresh default layout), also open the spec
                // note in an adjacent panel (creating a split if needed).
                // Skip if a spec-writer agent is pending — the spec panel will slide in reactively.
                if (allTabs.length === 0 && !shouldDeferSpecPanel(capturedWorkspaceId)) {
                  layoutManager.openTabInAdjacentOrSplit({
                    type: 'note',
                    title: 'Spec',
                    noteId: SPEC_NOTE_ID,
                    closable: true,
                  });
                  logger.info(
                    '[WorkspacePage] Opened spec note in adjacent panel (empty default layout)',
                    {
                      workspaceId: capturedWorkspaceId,
                    },
                  );
                }
              }
            }
          }
        }

        // Ensure panels have content - fallback to agent | spec layout
        // This runs after all other restoration logic to fill any empty panels
        const layoutManager = getPanelLayoutManager(capturedWorkspaceId);
        const allTabs = Object.values(layoutManager.layout.panels).flatMap((p) => p.tabs);
        const hasAnyTabs = allTabs.length > 0;

        if (!hasAnyTabs) {
          // Layout is completely empty - open agent + spec
          logger.info('[WorkspacePage] No tabs in layout, applying fallback content', {
            workspaceId: capturedWorkspaceId,
          });

          // Try restoredAgents first, but fall back to diskAgents if store is empty
          const agentsToUse =
            restoredAgents.length > 0
              ? restoredAgents
              : diskAgents.map((a) => ({ ...a, createdAt: a.createdAt || new Date(0) }));

          // Open the most recent agent in the left panel
          if (agentsToUse.length > 0) {
            const sortedAgents = [...agentsToUse].sort((a, b) => {
              const aTime = new Date(a.createdAt || 0).getTime();
              const bTime = new Date(b.createdAt || 0).getTime();
              return bTime - aTime;
            });
            const mostRecentAgent = sortedAgents[0];
            if (mostRecentAgent) {
              logger.info('[WorkspacePage] Fallback: opening most recent agent', {
                workspaceId: capturedWorkspaceId,
                agentId: mostRecentAgent.id,
                source: restoredAgents.length > 0 ? 'store' : 'disk',
              });
              openAgentInLayout(
                mostRecentAgent.id,
                (mostRecentAgent as any).name || 'Agent',
                capturedWorkspaceId,
              );
            }
          }

          // Open the spec note in an adjacent panel (creating a split if needed).
          // Skip if a spec-writer agent is pending — the spec panel will slide in reactively.
          if (!shouldDeferSpecPanel(capturedWorkspaceId)) {
            logger.info('[WorkspacePage] Fallback: opening spec note in adjacent panel', {
              workspaceId: capturedWorkspaceId,
            });
            layoutManager.openTabInAdjacentOrSplit({
              type: 'note',
              title: 'Spec',
              noteId: SPEC_NOTE_ID,
              closable: true,
            });
          }
        } else {
          // Layout has some tabs, but check if any panel in a multi-panel layout
          // is empty - if so, open the spec note there to avoid an empty right panel
          const panels = Object.entries(layoutManager.layout.panels);
          const emptyPanel = panels.find(([, panel]) => panel.tabs.length === 0);
          const hasSpecAnywhere = allTabs.some(
            (t) => t.type === 'note' && t.noteId === SPEC_NOTE_ID,
          );

          if (emptyPanel && panels.length >= 2 && !hasSpecAnywhere && !shouldDeferSpecPanel(capturedWorkspaceId)) {
            logger.info(
              '[WorkspacePage] Found empty panel in multi-panel layout, opening spec note',
              {
                workspaceId: capturedWorkspaceId,
                emptyPanelId: emptyPanel[0],
                tabCount: allTabs.length,
              },
            );
            layoutManager.openTab(
              {
                type: 'note',
                title: 'Spec',
                noteId: SPEC_NOTE_ID,
                closable: true,
              },
              emptyPanel[0],
            );
          } else {
            logger.info('[WorkspacePage] Layout has existing tabs, skipping fallback content', {
              workspaceId: capturedWorkspaceId,
              tabCount: allTabs.length,
            });
          }
        }

        // NOW clean up stale agent-config (deferred from above so shouldDeferSpecPanel
        // could still read it during the restoration logic).
        if (!isNewlyCreated) {
          const agentConfigKey = `workspace:${capturedWorkspaceId}:agent-config`;
          const pendingAgentKey = `workspace:${capturedWorkspaceId}:initial-agent-pending`;
          if (sessionStorage.getItem(agentConfigKey)) {
            logger.debug('[WorkspacePage] Cleaning up stale agent-config for existing workspace', {
              workspaceId: capturedWorkspaceId,
            });
            sessionStorage.removeItem(agentConfigKey);
          }
          if (sessionStorage.getItem(pendingAgentKey)) {
            sessionStorage.removeItem(pendingAgentKey);
          }
        }
      } catch (error) {
        logger.error('[WorkspacePage] Failed to load agents from disk', error);
        agents = [];
        workspaceState?.updateState({
          agentsList: [],
          isNewlyCreatedWorkspace: true, // No agents means newly created
        });
        // Still mark as loaded to prevent retries
        agentsLoaded = true;
      } finally {
        releaseAgentLoadLock(capturedWorkspaceId);
        loadingLocks.delete(lockKey);
      }
    })();

    // Store the promise in the locks map
    loadingLocks.set(lockKey, loadPromise);

    // Return the promise
    return loadPromise;
  }

  // Load agents when workspace is ready
  let isLoadingAgents = $state(false);
  let initialAgentConfigProcessed = $state(false); // Track if we've already processed the initial agent config
  let skipNextAgentLoad = $state(false); // Skip loading agents if we're transitioning

  $effect(() => {
    // Capture workspace ID before entering untrack to avoid race conditions
    const capturedWorkspaceId = safeWorkspace?.id;

    if (capturedWorkspaceId && !agentsLoaded && !isLoadingAgents) {
      // Use untrack to prevent reactive dependencies
      untrack(() => {
        // If we're transitioning from optimistic to real and have an initial agent being activated,
        // skip loading from disk to prevent duplicates
        if (skipNextAgentLoad) {
          logger.info('[WorkspacePage] Skipping agent load from disk during transition', {
            workspaceId: capturedWorkspaceId,
            initialAgentId,
          });
          skipNextAgentLoad = false;
          agentsLoaded = true; // Mark as loaded to prevent future attempts
          return;
        }

        isLoadingAgents = true;

        void (async () => {
          try {
            await loadAgentsFromDisk();
          } finally {
            isLoadingAgents = false;
          }
        })();
      });
    }
  });

  // Load terminals when workspace is ready
  let isLoadingTerminals = $state(false);

  $effect(() => {
    // Capture workspace ID before entering untrack to avoid race conditions
    const capturedWorkspaceId = safeWorkspace?.id;

    if (capturedWorkspaceId && !terminalsLoaded && !isLoadingTerminals) {
      untrack(() => {
        isLoadingTerminals = true;
        loadTerminalsFromStorage().finally(() => {
          isLoadingTerminals = false;
        });
      });
    }
  });

  // Listen for terminals created from the backend (e.g., setup scripts)
  // Use listenSync for synchronous cleanup - no race conditions on unmount
  $effect(() => {
    if (!workspaceId) return;

    const unsubscribe = listenSync('terminal:created', (event: any) => {
      const payload = event.payload || event;
      const { terminalId, workspaceId: eventWorkspaceId, title, createdAt } = payload;

      // Only handle terminals for this workspace
      if (eventWorkspaceId !== workspaceId) return;

      // Check if terminal already exists - use untrack to avoid effect loops
      const existingTerminal = untrack(() => terminals.find((t: Terminal) => t.id === terminalId));
      if (existingTerminal) {
        logger.debug('[WorkspacePage] Terminal already exists, skipping', { terminalId });
        return;
      }

      logger.info('[WorkspacePage] Terminal created from backend', {
        terminalId,
        workspaceId: eventWorkspaceId,
        title,
      });

      // Validate terminal ID before adding
      if (terminalId.startsWith('agent-')) {
        logger.error('[WorkspacePage] Received terminal:created event with agent ID - ignoring', {
          terminalId,
          eventWorkspaceId,
          title,
        });
        return;
      }

      // Add the new terminal to the list
      const newTerminal: Terminal = {
        id: terminalId,
        type: 'terminal',
        title: title || 'Terminal',
        workspaceId: eventWorkspaceId,
        createdAt: createdAt || new Date().toISOString(),
        isConnected: false,
        isExecuting: false,
      };

      // Use untrack for state updates to avoid effect loops
      untrack(() => {
        terminals = [...terminals, newTerminal];
        workspaceState?.updateState({ terminalsList: terminals });
      });

      // Save terminal metadata for persistence
      terminalManager.saveTerminalMetadata(terminalId, eventWorkspaceId, title);

      // Add the terminal to the overlay store so it appears in the QuakeTerminalOverlay tab bar
      terminalOverlayStore.addTerminal(terminalId, title || 'Setup');

      // Don't open the terminal drawer if there's a pending initial agent
      // This prevents the terminal from taking over the drawer during workspace creation
      const drawerState = workspaceState?.state?.drawer;
      const isShowingInitialAgent =
        initialAgentId &&
        drawerState?.open &&
        drawerState?.type === 'agent' &&
        drawerState?.itemId === initialAgentId;

      // Also check if this is a newly created workspace with a pending initial agent
      // This handles the race condition where terminal:created fires before initialAgentId is set
      const isNewlyCreatedWithPendingAgent =
        workspaceState?.state?.isNewlyCreatedWorkspace &&
        drawerState?.open &&
        drawerState?.type === 'agent' &&
        drawerState?.itemId?.startsWith('agent-');

      // Additionally check sessionStorage for pending initial agent as a fallback
      const pendingAgentKey = `workspace:${eventWorkspaceId}:initial-agent-pending`;
      const hasPendingAgentInStorage = !!sessionStorage.getItem(pendingAgentKey);

      if (isShowingInitialAgent || isNewlyCreatedWithPendingAgent || hasPendingAgentInStorage) {
        logger.info(
          '[WorkspacePage] Terminal created but not opening drawer - initial agent is displayed or pending',
          {
            terminalId,
            initialAgentId,
            isShowingInitialAgent,
            isNewlyCreatedWithPendingAgent,
            hasPendingAgentInStorage,
          },
        );
      } else {
        // Open the terminal drawer
        openTerminal(terminalId);
      }
    });

    return unsubscribe;
  });

  // Reset agents and terminals loaded flag when workspace changes
  // NOTE: This is NOT $state to avoid creating a reactive dependency in the effect below
  // Using $state here would cause an infinite loop because the effect reads and writes it
  let previousWorkspaceIdForAgents: string | undefined = undefined;
  $effect(() => {
    // Track workspaceId changes
    if (workspaceId && workspaceId !== previousWorkspaceIdForAgents) {
      // Skip the initial load - this is not a workspace change
      if (previousWorkspaceIdForAgents === undefined) {
        previousWorkspaceIdForAgents = workspaceId;
        return;
      }

      // Check if this is a transition from optimistic to real workspace
      const isOptimisticTransition =
        previousWorkspaceIdForAgents?.startsWith('optimistic-') &&
        !workspaceId.startsWith('optimistic-');

      if (isOptimisticTransition) {
        // This is a transition from optimistic to real - don't reset everything
        logger.info('[WorkspacePage] Transitioning from optimistic to real workspace', {
          from: previousWorkspaceIdForAgents,
          to: workspaceId,
        });

        // Store the current drawer state before transition
        const currentDrawerState = workspaceState?.state?.drawer;

        previousWorkspaceIdForAgents = workspaceId;
        // Don't reset agents, terminals, or initialAgentId

        // If we have an initial agent that's being activated in AuggieChatPanel,
        // skip loading agents from disk to prevent duplicates
        if (initialAgentId) {
          skipNextAgentLoad = true;
          logger.info('[WorkspacePage] Will skip agent load during transition', {
            initialAgentId,
          });
        } else {
          // Just mark that we need to reload agents from disk
          agentsLoaded = false;
        }

        terminalsLoaded = false;
        // Reset the config processed flag so we check for migrated config
        initialAgentConfigProcessed = false;

        // Restore drawer state after transition if it was open
        if (currentDrawerState?.open) {
          setTimeout(() => {
            workspaceState?.openDrawer(currentDrawerState.type, currentDrawerState.itemId);
          }, 100);
        }
      } else {
        // This is a real workspace change - reset everything
        logger.info('[WorkspacePage] Workspace ID changed, resetting agents and terminals', {
          from: previousWorkspaceIdForAgents,
          to: workspaceId,
        });

        // PERF: Trigger proactive memory cleanup on the main process immediately
        // instead of waiting for the 30s memory monitor interval to detect pressure
        window.electronAPI.invoke('app:trigger-memory-cleanup').catch(() => {});

        // NOTE: We intentionally do NOT clean up stream handlers when switching workspaces.
        // Stream handlers for agents in other workspaces should continue receiving and
        // accumulating content from the backend. The handler stores the workspace ID and
        // can properly route chunks to the right session even when not viewing that workspace.
        // Cleaning up handlers here would cause chunks to be lost during workspace switches.

        previousWorkspaceIdForAgents = workspaceId;
        agentsLoaded = false;
        terminalsLoaded = false;
        // Also reset loading flags - if the old workspace was still loading,
        // we need to allow the new workspace to start loading. The old loading
        // operation will abort via the capturedWorkspaceId check.
        isLoadingAgents = false;
        isLoadingTerminals = false;
        agents = [];
        terminals = [];
        initialAgentId = undefined;
        initialAgentConfigProcessed = false; // Reset the flag when workspace changes
      }
    }
  });

  // Check for initial agent config from workspace creation
  // This allows rules to be passed properly when the agent is actually needed
  $effect(() => {
    // Capture workspace ID at the start to avoid race conditions during async execution
    const capturedWorkspaceId = safeWorkspace?.id;

    // Read initialAgentConfigProcessed with untrack to avoid creating a reactive dependency
    const alreadyProcessed = untrack(() => initialAgentConfigProcessed);

    if (capturedWorkspaceId && agentsLoaded && !alreadyProcessed && agents.length === 0) {
      // Mark as processed to prevent running again
      untrack(() => {
        initialAgentConfigProcessed = true;
      });

      // Try to load initial agent config from workspace
      (async () => {
        try {
          // First try to load from the saved agent config file
          // This is more reliable than querying events which might not be persisted yet
          if (typeof window !== 'undefined' && window.electronAPI) {
            const configResult = await window.electronAPI.invoke('agent:load-initial-config', {
              workspaceId: capturedWorkspaceId,
            });

            if (configResult?.success && configResult?.data) {
              const agentConfig = configResult.data;

              logger.info('Found initial agent config from file', {
                workspaceId: capturedWorkspaceId,
                agentId: agentConfig.agentId,
                hasPrompt: !!agentConfig.prompt,
                hasRules: !!agentConfig.rules,
              });

              initialAgentId = agentConfig.agentId;

              // Store in sessionStorage for AuggieChatPanel to pick up
              sessionStorage.setItem(
                `workspace:${capturedWorkspaceId}:agent-config`,
                JSON.stringify(agentConfig),
              );

              // Only open if it's not already open with different content
              // Check persisted drawer state from localStorage as workspaceState might not be ready
              if (agentConfig.agentId) {
                const persistedState = workspaceStorageManager.loadState(capturedWorkspaceId);
                const persistedDrawerState = persistedState?.drawer;
                const currentDrawerState = workspaceState?.state?.drawer ?? persistedDrawerState;
                const drawerAlreadyOpen =
                  currentDrawerState?.open &&
                  currentDrawerState?.itemId &&
                  currentDrawerState?.itemId !== agentConfig.agentId;

                if (!drawerAlreadyOpen) {
                  openAgentInLayout(
                    agentConfig.agentId,
                    agentConfig.name || 'Agent',
                    capturedWorkspaceId,
                  );
                }
              }

              return; // Exit early if we found the config
            }
          }

          // Fallback: Check if we have initial agent config from workspace event
          const events = await queryEvents(
            capturedWorkspaceId,
            [{ field: 'type', operator: 'equals', value: 'workspace:created' }],
            1,
          );
          const workspaceCreatedEvent = events[0];
          if (
            workspaceCreatedEvent?.data?.initialAgent &&
            workspaceCreatedEvent.workspaceId === capturedWorkspaceId
          ) {
            const agentConfig = workspaceCreatedEvent.data.initialAgent;

            logger.info('Found initial agent config from workspace creation event', {
              workspaceId: capturedWorkspaceId,
              agentId: agentConfig.agentId,
              hasPrompt: !!agentConfig.prompt,
              hasRules: !!agentConfig.rules,
            });

            initialAgentId = agentConfig.agentId;

            // Store in sessionStorage for AuggieChatPanel to pick up
            // This is temporary until we refactor AuggieChatPanel
            sessionStorage.setItem(
              `workspace:${capturedWorkspaceId}:agent-config`,
              JSON.stringify(agentConfig),
            );

            // Only open if it's not already open with different content
            // Check persisted drawer state from localStorage as workspaceState might not be ready
            if (agentConfig.agentId) {
              const persistedState = workspaceStorageManager.loadState(capturedWorkspaceId);
              const persistedDrawerState = persistedState?.drawer;
              const currentDrawerState = workspaceState?.state?.drawer ?? persistedDrawerState;
              const drawerAlreadyOpen =
                currentDrawerState?.open &&
                currentDrawerState?.itemId &&
                currentDrawerState?.itemId !== agentConfig.agentId;

              if (!drawerAlreadyOpen) {
                openAgentInLayout(
                  agentConfig.agentId,
                  agentConfig.name || 'Agent',
                  capturedWorkspaceId,
                );
              }
            }
          }
        } catch (e) {
          logger.debug('No initial agent config found', { error: e });
        }
      })();
    }
  });

  // Check for pending initial agent config after workspace transitions
  // This handles the case where we transition from optimistic to real workspace
  $effect(() => {
    // Read initialAgentConfigProcessed with untrack to avoid creating a reactive dependency
    const alreadyProcessed = untrack(() => initialAgentConfigProcessed);

    if (safeWorkspace?.id && !alreadyProcessed) {
      // Check if we have a pending initial agent from workspace creation
      const pendingAgentKey = `workspace:${safeWorkspace.id}:initial-agent-pending`;
      const pendingAgentData = sessionStorage.getItem(pendingAgentKey);

      if (pendingAgentData) {
        // Mark as processed to prevent running again
        untrack(() => {
          initialAgentConfigProcessed = true;
        });

        try {
          const { agentId, config, timestamp } = JSON.parse(pendingAgentData);

          // Only use if it's recent (within 30 seconds to account for slower systems)
          if (Date.now() - timestamp < 30000) {
            logger.info('[WorkspacePage] Found pending initial agent after transition', {
              workspaceId: safeWorkspace.id,
              agentId,
              hasPrompt: !!config.prompt,
            });

            initialAgentId = agentId;

            // Mark this agent as recently created so the drawer doesn't close
            if (agentId) markAgentRecentlyCreated(agentId);

            // Store the config for AuggieChatPanel with isInitialAgent flag
            const agentConfigWithFlag = {
              ...config,
              initialAgentId: agentId,
              isInitialAgent: true,
            };
            sessionStorage.setItem(
              `workspace:${safeWorkspace.id}:agent-config`,
              JSON.stringify(agentConfigWithFlag),
            );

            // Only open the drawer if it's not already open with different content
            // Check persisted drawer state from localStorage as workspaceState might not be ready
            const persistedState = workspaceStorageManager.loadState(safeWorkspace.id);
            const persistedDrawerState = persistedState?.drawer;
            const currentDrawerState = workspaceState?.state?.drawer ?? persistedDrawerState;
            const drawerAlreadyOpen =
              currentDrawerState?.open &&
              currentDrawerState?.itemId &&
              currentDrawerState?.itemId !== agentId;

            if (drawerAlreadyOpen) {
              logger.info(
                '[WorkspacePage] Already open with different content after transition, not overwriting',
                {
                  currentType: currentDrawerState?.type,
                  currentItemId: currentDrawerState?.itemId,
                  initialAgentId: agentId,
                },
              );
              // Clean up stale entries since we're not using them
              sessionStorage.removeItem(pendingAgentKey);
              sessionStorage.removeItem(`workspace:${safeWorkspace.id}:agent-config`);
            } else if (agentId) {
              openAgentInLayout(agentId, config.name || 'Agent', safeWorkspace.id);
              // Don't remove the pending key yet - let AuggieChatPanel do it after successful creation
              // This prevents losing the config if agent creation fails
            }
          } else {
            // Only clean up if it's too old
            sessionStorage.removeItem(pendingAgentKey);
          }
        } catch (error) {
          logger.error('[WorkspacePage] Failed to parse pending agent data', error);
          sessionStorage.removeItem(pendingAgentKey);
        }
      }
    }
  });

  // Open the spec panel when the spec note is populated with content.
  //
  // This effect handles TWO scenarios:
  //
  // 1. **New workspace (isDeferring=true):** The layout starts as a single panel
  //    (agent only). When the spec-writer agent writes content, we split the panel
  //    and open the spec note with a slide-in animation. An 8-second fallback timer
  //    (must exceed the backend's 5s NOTE_UPDATE_DEBOUNCE_MS) handles the case where
  //    the spec already has content (stale sessionStorage).
  //
  // 2. **Existing workspace (isDeferring=false):** The spec tab may not be in the
  //    saved layout (user closed it, or it was never persisted). When the agent
  //    writes to the spec, we open it normally without animation.
  //
  // In both cases, the trigger is a `note:updated` IPC event from the agent's
  // set_note_content tool call.
  $effect(() => {
    const capturedWorkspaceId = safeWorkspace?.id;
    if (!capturedWorkspaceId) return;

    const layoutManager = untrack(() => getPanelLayoutManager(capturedWorkspaceId));
    const isDeferring = untrack(() => layoutManager.isDeferringSpecTab);

    logger.info('[WorkspacePage] Spec panel watcher active', {
      workspaceId: capturedWorkspaceId,
      isDeferring,
    });

    let hasOpened = false;

    // Helper: clean up sessionStorage keys and mark slide-in as completed
    // so subsequent visits don't defer again
    function cleanupDeferralKeys() {
      sessionStorage.removeItem(`workspace:${capturedWorkspaceId}:agent-config`);
      sessionStorage.removeItem(`workspace:${capturedWorkspaceId}:initial-agent-pending`);
      specSlideInCompleted.add(capturedWorkspaceId);
    }

    // Helper: open the spec panel with a slide-in animation (only for fresh agent writes)
    function slideInSpecPanel() {
      if (hasOpened) return;
      hasOpened = true;

      // Check if the spec note is already open somewhere
      const allTabs = Object.values(layoutManager.layout.panels).flatMap((p) => p.tabs);
      const hasSpec = allTabs.some((t) => t.type === 'note' && t.noteId === SPEC_NOTE_ID);
      if (hasSpec) {
        logger.info('[WorkspacePage] Spec already open, skipping slide-in', {
          workspaceId: capturedWorkspaceId,
        });
        cleanupDeferralKeys();
        return;
      }

      logger.info('[WorkspacePage] Spec note populated — sliding in spec panel', {
        workspaceId: capturedWorkspaceId,
      });

      // Clear the deferSpecTab guard so the openTab call below goes through.
      layoutManager.setDeferSpecTab(false);

      // openTabInAdjacentOrSplit will create a horizontal split if only one panel exists,
      // then open the spec note in the new panel. The animated option makes it slide in.
      layoutManager.openTabInAdjacentOrSplit(
        {
          type: 'note',
          title: 'Spec',
          noteId: SPEC_NOTE_ID,
          closable: true,
        },
        undefined,
        { animated: true },
      );
      cleanupDeferralKeys();
    }

    // Helper: open the spec panel normally WITHOUT animation.
    // Used in two scenarios:
    //   1. Returning visit with stale sessionStorage keys (fallback timer)
    //   2. Agent writes to spec on an existing workspace where spec tab isn't open
    function openSpecNormally() {
      if (hasOpened) return;
      hasOpened = true;

      const allTabs = Object.values(layoutManager.layout.panels).flatMap((p) => p.tabs);
      const hasSpec = allTabs.some((t) => t.type === 'note' && t.noteId === SPEC_NOTE_ID);
      if (hasSpec) {
        if (isDeferring) layoutManager.setDeferSpecTab(false);
        cleanupDeferralKeys();
        return;
      }

      logger.info('[WorkspacePage] Opening spec panel (no animation)', {
        workspaceId: capturedWorkspaceId,
        isDeferring,
      });

      if (isDeferring) layoutManager.setDeferSpecTab(false);
      layoutManager.openTabInAdjacentOrSplit(
        {
          type: 'note',
          title: 'Spec',
          noteId: SPEC_NOTE_ID,
          closable: true,
        },
        undefined,
        // No { animated: true } — opens instantly
      );
      cleanupDeferralKeys();
    }

    // Listen for note:updated events on the spec note.
    // The agent writes to the spec via set_note_content which emits this event.
    // - When deferring (new workspace): triggers animated slide-in
    // - When not deferring (existing workspace): opens spec panel normally
    //
    // NOTE: The event payload varies depending on the emission path:
    //   - Domain events (flat): { noteId, workspaceId, content, changes: {...} }
    //   - WorkspaceEvents (wrapped): { type, workspaceId, data: { noteId, ... } }
    // We extract noteId/workspaceId from both formats, but content is NOT reliably
    // present in the event (WorkspaceEvents omit it). Always fall back to
    // notesStateManager.spec for content checks.
    const unsubNoteUpdated = listenSync('note:updated', (event: any) => {
      if (hasOpened) return;
      const payload = event.payload || {};
      const noteId = payload.noteId || payload.data?.noteId;
      const eventWorkspaceId = payload.workspaceId;

      // Only care about spec note updates for this workspace
      if (noteId !== 'spec' || eventWorkspaceId !== capturedWorkspaceId) return;

      // Check if the spec actually has content now.
      // Prefer event payload content (available from domain events), but always
      // fall back to the notes store (the canonical source of truth).
      const eventContent =
        payload.content ||
        payload.data?.content ||
        payload.changes?.content ||
        payload.metadata?.changes?.content;
      const specNote = notesStateManager.spec;
      const specContent = eventContent || specNote?.content || '';

      if (specContent.trim().length > 0) {
        logger.info('[WorkspacePage] Spec note:updated — opening spec panel', {
          workspaceId: capturedWorkspaceId,
          contentLength: specContent.trim().length,
          isDeferring,
        });
        if (isDeferring) {
          slideInSpecPanel();
        } else {
          openSpecNormally();
        }
      }
    });

    // Delayed fallback: if after N seconds the spec hasn't been opened via
    // note:updated (i.e. the agent isn't actively writing), check if the spec
    // already has content and open it.
    //
    // When deferring (new workspace): 8s delay to exceed the backend's
    // NOTE_UPDATE_DEBOUNCE_MS (5s). Handles returning visits with stale
    // sessionStorage keys.
    //
    // When NOT deferring (existing workspace): 2s delay. Handles the case
    // where a coordinator/background agent wrote the spec while the user was
    // away (on a different workspace or with the app closed). The spec has
    // content but the spec tab was never persisted in the layout.
    // To avoid reopening the spec when the user deliberately closed it, we
    // only trigger this when a background agent exists in the workspace
    // (indicating an automated process wrote the spec).
    const FALLBACK_TIMER_MS = isDeferring ? 8000 : 2000;
    const fallbackTimer = setTimeout(() => {
        if (hasOpened) return;
        const specNote = notesStateManager.spec;
        if (!specNote?.content || specNote.content.trim().length === 0) return;

        if (!isDeferring) {
          // Only auto-open if a background agent (coordinator/PR reviewer) exists
          // in this workspace — this indicates the spec was written by an automated
          // process, not manually by the user. Without this guard, we'd reopen the
          // spec on every visit even if the user deliberately closed the tab.
          const workspaceAgents = unifiedStateStore.getAgentsForWorkspace(
            WorkspaceId(capturedWorkspaceId),
          );
          const hasBackgroundAgent = workspaceAgents.some(
            (a: AgentSession) => a.isBackground || a.metadata?.isBackground,
          );
          if (!hasBackgroundAgent) {
            logger.info('[WorkspacePage] Fallback: spec has content but no background agents — skipping auto-open', {
              workspaceId: capturedWorkspaceId,
              agentCount: workspaceAgents.length,
            });
            return;
          }
        }

        logger.info('[WorkspacePage] Fallback: spec has content but no spec tab open — opening normally', {
          workspaceId: capturedWorkspaceId,
          contentLength: specNote.content.trim().length,
          isDeferring,
        });
        openSpecNormally();
      }, FALLBACK_TIMER_MS);

    // Agent idle fallback: when the spec-writer agent finishes streaming
    // without ever writing to the spec note, the note:updated event never
    // fires and deferSpecTab stays true forever — blocking all future
    // attempts to open the spec tab. Listen for agent:idle to clear the
    // deferral and open the spec if it has content.
    const unsubAgentIdle = isDeferring
      ? listenSync('agent:idle', (event: any) => {
          if (hasOpened) return;
          const payload = event.payload || event.data || {};
          const eventWorkspaceId = payload.workspaceId;
          if (eventWorkspaceId !== capturedWorkspaceId) return;

          // The spec-writer agent finished — check if spec has content
          const specNote = notesStateManager.spec;
          const specContent = specNote?.content?.trim() || '';

          if (specContent.length > 0) {
            logger.info('[WorkspacePage] Agent idle with spec content — sliding in spec panel', {
              workspaceId: capturedWorkspaceId,
              contentLength: specContent.length,
            });
            slideInSpecPanel();
          } else {
            // Agent finished without writing spec content.
            // Clear the deferral so the spec tab can be opened later
            // (e.g. manually or by a subsequent agent).
            logger.info('[WorkspacePage] Agent idle with no spec content — clearing deferral', {
              workspaceId: capturedWorkspaceId,
            });
            layoutManager.setDeferSpecTab(false);
            cleanupDeferralKeys();
            hasOpened = true;
          }
        })
      : null;

    // Safety-net fallback: if after 90 seconds neither note:updated nor
    // agent:idle has cleared the deferral, force-clear it to prevent the
    // spec tab from being permanently blocked.
    const safetyTimer = isDeferring
      ? setTimeout(() => {
          if (hasOpened) return;
          logger.info('[WorkspacePage] Safety fallback: clearing stuck deferSpecTab after timeout', {
            workspaceId: capturedWorkspaceId,
          });
          openSpecNormally();
        }, 90_000)
      : null;

    return () => {
      unsubNoteUpdated();
      if (unsubAgentIdle) unsubAgentIdle();
      if (fallbackTimer) clearTimeout(fallbackTimer);
      if (safetyTimer) clearTimeout(safetyTimer);
    };
  });

  // Subscribe to agent updates for this workspace
  // Use throttling to prevent UI flooding during streaming while still allowing updates
  // NOTE: We only depend on safeWorkspace?.id - all other reads use untrack() to avoid loops
  $effect(() => {
    // Capture workspace ID at the start to avoid race conditions in callbacks
    const capturedWorkspaceId = safeWorkspace?.id;

    logger.debug('[WorkspacePage] Setting up agent service subscription', {
      workspaceId: capturedWorkspaceId,
    });

    // Early return if no workspace ID
    if (!capturedWorkspaceId) return;

    let lastAgentIds: string[] = [];
    let lastUpdateTime = 0;
    let pendingUpdate = false;
    let rafId: number | null = null;

    const processUpdate = () => {
      pendingUpdate = false;

      // Use the captured workspace ID for consistency
      let newAgents = agentService.getSessionsForWorkspace(capturedWorkspaceId);

      // Filter out terminal IDs - they should not appear in the agents list
      newAgents = newAgents.filter((a) => a && !String(a.id).startsWith('terminal-'));

      // Quick check: only compare agent IDs first (much cheaper than full JSON.stringify)
      const newAgentIds = newAgents.map((a) => a.id).sort();
      const agentIdsChanged =
        newAgentIds.length !== lastAgentIds.length ||
        newAgentIds.some((id, i) => id !== lastAgentIds[i]);

      // Also check for property changes (like model) by comparing key properties
      // This is lighter than full JSON.stringify but catches important changes
      const getAgentSignature = (a: AgentSession) =>
        `${a.id}:${a.model}:${a.name}:${a.status}:${a.isStreaming}`;
      const newSignatures = newAgents.map(getAgentSignature).sort().join('|');
      const oldSignatures = untrack(() => agents.map(getAgentSignature).sort().join('|'));
      const propertiesChanged = newSignatures !== oldSignatures;

      // Update if agent IDs changed OR if agent properties changed
      if (agentIdsChanged || propertiesChanged) {
        logger.debug('[WorkspacePage] Updating agents from subscription', {
          oldCount: lastAgentIds.length,
          newCount: newAgents.length,
          agentIdsChanged,
          propertiesChanged,
        });
        lastAgentIds = newAgentIds;
        // Use untrack when mutating agents to avoid re-triggering this effect
        untrack(() => {
          agents = newAgents;
          workspaceState?.updateState({ agentsList: agents });
        });
      }
    };

    const unsubscribe = sessionStore.getStore().subscribe(() => {
      // Throttle updates to at most once per 100ms during streaming
      const now = Date.now();
      const timeSinceLastUpdate = now - lastUpdateTime;

      if (timeSinceLastUpdate >= 100) {
        // Enough time has passed, update immediately
        lastUpdateTime = now;
        processUpdate();
      } else if (!pendingUpdate) {
        // Schedule an update for later using requestAnimationFrame
        pendingUpdate = true;
        rafId = requestAnimationFrame(() => {
          lastUpdateTime = Date.now();
          processUpdate();
        });
      }
      // If pendingUpdate is true, we already have an update scheduled
    });

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      unsubscribe();
    };
  });

  // NOTE: agent:created IPC events are handled by agent.service.ts which adds
  // agents to sessionStore. The subscription above (lines 2003-2021) automatically
  // updates the local agents list when sessionStore changes. No duplicate handling needed.

  // Track recently created agents from sessionStore changes to prevent drawer closing
  $effect(() => {
    const capturedWorkspaceId = safeWorkspace?.id;
    if (!capturedWorkspaceId) return;

    // Track which agent IDs we've seen to detect new additions
    // Use untrack() to avoid creating a reactive dependency on agents - we only need the initial set
    const knownAgentIds = untrack(() => new Set<string>(agents.map((a) => a?.id).filter(Boolean)));

    const unsubscribe = sessionStore.getStore().subscribe(() => {
      const currentAgents = agentService.getSessionsForWorkspace(capturedWorkspaceId);
      for (const agent of currentAgents) {
        if (agent && !knownAgentIds.has(agent.id)) {
          // New agent detected - mark as recently created
          knownAgentIds.add(agent.id);
          markAgentRecentlyCreated(agent.id);
          logger.debug('[WorkspacePage] New agent detected in sessionStore', {
            agentId: agent.id,
            totalKnown: knownAgentIds.size,
          });
        }
      }
    });

    return unsubscribe;
  });

  // Listen for show-agent events from activity log
  $effect(() => {
    const handleShowAgent = (event: Event) => {
      const customEvent = event as CustomEvent<{ agentId: string }>;
      const agentId = customEvent.detail?.agentId;
      if (agentId) {
        logger.info('[WorkspacePage] Show agent event received', { agentId });
        openAgent(agentId);
      }
    };

    window.addEventListener('workspace:show-agent', handleShowAgent);

    return () => {
      window.removeEventListener('workspace:show-agent', handleShowAgent);
    };
  });

  // Listen for command palette events (new agent, terminal, note)
  $effect(() => {
    const handleNewAgent = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      const agentType = detail?.agentType;
      logger.info('[WorkspacePage] app:new-agent event received', { agentType });
      handleCreateAgent(agentType);
    };

    const handleNewTerminal = () => {
      logger.info('[WorkspacePage] app:new-terminal event received');
      handleCreateTerminal();
    };

    const handleNewNote = () => {
      logger.info('[WorkspacePage] app:new-note event received');
      handleCreateNote();
    };

    // Mod+T "New Tab" shortcut - creates a new agent (primary content type)
    const handleNewTab = () => {
      logger.info('[WorkspacePage] workspace:new-tab event received');
      handleCreateAgent();
    };

    window.addEventListener('app:new-agent', handleNewAgent);
    window.addEventListener('app:new-terminal', handleNewTerminal);
    window.addEventListener('app:new-note', handleNewNote);
    window.addEventListener('workspace:new-tab', handleNewTab);

    return () => {
      window.removeEventListener('app:new-agent', handleNewAgent);
      window.removeEventListener('app:new-terminal', handleNewTerminal);
      window.removeEventListener('app:new-note', handleNewNote);
      window.removeEventListener('workspace:new-tab', handleNewTab);
    };
  });

  // Panel layout event interceptors
  // Intercept file/diff open events and route to panel system
  $effect(() => {
    const wsId = safeWorkspace?.id;
    if (!wsId) return;

    logger.info('[WorkspacePage] Setting up panel layout event interceptors', { wsId });

    const handleOpenFile = (event: Event) => {
      const detail = (event as CustomEvent)?.detail;
      const filePath = detail?.path || detail?.filePath;
      const openInAdjacentPanel = detail?.openInAdjacentPanel ?? false;
      const sourcePanelId = detail?.sourcePanelId;
      if (filePath) {
        event.stopImmediatePropagation();
        const layoutManager = getPanelLayoutManager(wsId);
        const tab = {
          type: 'file' as const,
          title: filePath.split('/').pop() || 'File',
          filePath,
          closable: true,
        };
        if (openInAdjacentPanel) {
          layoutManager.openTabInAdjacentOrSplit(tab, sourcePanelId);
          // Request focus on the new panel
          if (layoutManager.focusedPanelId) {
            window.dispatchEvent(
              new CustomEvent('panel:request-focus', {
                detail: { panelId: layoutManager.focusedPanelId },
              }),
            );
          }
        } else {
          layoutManager.openTab(tab, sourcePanelId ?? undefined);
        }
        logger.debug('[WorkspacePage] Routed workspace:open-file to panel layout', {
          filePath,
          openInAdjacentPanel,
          sourcePanelId,
        });

        // Track file opened - extract extension only (no path for privacy)
        track('Opened File', {
          workspace_id: wsId,
          file_extension: getFileExtension(filePath),
        });
      }
    };

    const handleOpenDiff = (event: Event) => {
      const detail = (event as CustomEvent)?.detail;
      const change = detail?.change;
      const filePath = detail?.filePath || change?.file || change?.relativePath;
      const openInAdjacentPanel = detail?.openInAdjacentPanel ?? false;
      const sourcePanelId = detail?.sourcePanelId;
      if (filePath) {
        event.stopImmediatePropagation();
        const layoutManager = getPanelLayoutManager(wsId);
        const tab = {
          type: 'diff' as const,
          title: filePath.split('/').pop() || 'Diff',
          diffPath: filePath,
          closable: true,
          data: { change },
        };
        if (openInAdjacentPanel) {
          layoutManager.openTabInAdjacentOrSplit(tab, sourcePanelId);
          // Request focus on the new panel
          if (layoutManager.focusedPanelId) {
            window.dispatchEvent(
              new CustomEvent('panel:request-focus', {
                detail: { panelId: layoutManager.focusedPanelId },
              }),
            );
          }
        } else {
          layoutManager.openTab(tab, sourcePanelId ?? undefined);
        }
        logger.debug('[WorkspacePage] Routed workspace:open-diff to panel layout', {
          filePath,
          openInAdjacentPanel,
          sourcePanelId,
        });
      }
    };

    const handleOpenCommitChangeset = (event: Event) => {
      const detail = (event as CustomEvent)?.detail;
      const { commitHash, commitMessage } = detail || {};
      const openInAdjacentPanel = detail?.openInAdjacentPanel ?? false;
      const sourcePanelId = detail?.sourcePanelId;
      if (commitHash) {
        event.stopImmediatePropagation();
        const layoutManager = getPanelLayoutManager(wsId);
        const shortHash = commitHash.substring(0, 7);
        const title = commitMessage
          ? `${shortHash}: ${commitMessage.substring(0, 20)}${commitMessage.length > 20 ? '...' : ''}`
          : `Commit ${shortHash}`;
        const tab = {
          type: 'changes' as const,
          title,
          closable: true,
          data: { commitHash, commitMessage },
        };
        if (openInAdjacentPanel) {
          layoutManager.openTabInAdjacentOrSplit(tab, sourcePanelId);
          // Request focus on the new panel
          if (layoutManager.focusedPanelId) {
            window.dispatchEvent(
              new CustomEvent('panel:request-focus', {
                detail: { panelId: layoutManager.focusedPanelId },
              }),
            );
          }
        } else {
          layoutManager.openTab(tab, sourcePanelId ?? undefined);
        }
        logger.debug('[WorkspacePage] Routed workspace:open-commit-changeset to panel layout', {
          commitHash,
          openInAdjacentPanel,
          sourcePanelId,
        });
      }
    };

    const handleOpenNote = (event: Event) => {
      const detail = (event as CustomEvent)?.detail;
      const noteId = detail?.noteId;
      let openInAdjacentPanel = detail?.openInAdjacentPanel ?? false;
      const sourcePanelId = detail?.sourcePanelId;
      if (noteId) {
        event.stopImmediatePropagation();
        const layoutManager = getPanelLayoutManager(wsId);

        // If the source panel has an active agent tab, always open the note in an
        // adjacent panel so the agent view is not covered by the new tab.
        if (!openInAdjacentPanel && sourcePanelId) {
          const sourcePanel = layoutManager.getPanel(sourcePanelId);
          if (sourcePanel) {
            const activeTab = sourcePanel.tabs.find((t) => t.id === sourcePanel.activeTabId);
            if (activeTab?.type === 'agent') {
              openInAdjacentPanel = true;
            }
          }
        }

        // Try to get the note title from the workspace
        const note = safeWorkspace?.notes?.find((n: { id: string }) => n.id === noteId);
        const title = note?.title || noteId;
        const tab = {
          type: 'note' as const,
          title,
          noteId,
          closable: true,
        };
        if (openInAdjacentPanel) {
          layoutManager.openTabInAdjacentOrSplit(tab, sourcePanelId);
          // Request focus on the new panel
          if (layoutManager.focusedPanelId) {
            window.dispatchEvent(
              new CustomEvent('panel:request-focus', {
                detail: { panelId: layoutManager.focusedPanelId },
              }),
            );
          }
        } else {
          // If we have a source panel ID, open in the same panel
          layoutManager.openTab(tab, sourcePanelId ?? undefined);
        }
        logger.debug('[WorkspacePage] Routed workspace:open-note to panel layout', {
          noteId,
          openInAdjacentPanel,
          sourcePanelId,
        });
      }
    };

    const handleOpenAgent = (event: Event) => {
      const detail = (event as CustomEvent)?.detail;
      const agentId = detail?.agentId;
      const openInAdjacentPanel = detail?.openInAdjacentPanel ?? false;
      const sourcePanelId = detail?.sourcePanelId;
      if (agentId) {
        event.stopImmediatePropagation();
        const layoutManager = getPanelLayoutManager(wsId);
        // Try to get the agent title from the workspace
        const agent = safeWorkspace?.agents?.find((a: { id: string }) => a.id === agentId);
        const title = agent?.title || 'Agent';
        const tab = {
          type: 'agent' as const,
          title,
          agentId,
          closable: true,
        };
        if (openInAdjacentPanel) {
          layoutManager.openTabInAdjacentOrSplit(tab, sourcePanelId);
          // Request focus on the new panel
          if (layoutManager.focusedPanelId) {
            window.dispatchEvent(
              new CustomEvent('panel:request-focus', {
                detail: { panelId: layoutManager.focusedPanelId },
              }),
            );
          }
        } else {
          layoutManager.openTab(tab, sourcePanelId ?? undefined);
        }
        logger.debug('[WorkspacePage] Routed workspace:open-agent to panel layout', {
          agentId,
          openInAdjacentPanel,
          sourcePanelId,
        });
      }
    };

    const handleOpenTerminal = (event: Event) => {
      const detail = (event as CustomEvent)?.detail;
      const terminalId = detail?.terminalId;
      if (terminalId) {
        event.stopImmediatePropagation();
        const layoutManager = getPanelLayoutManager(wsId);
        layoutManager.openTab({
          type: 'terminal',
          title: 'Terminal',
          terminalId,
          closable: true,
        });
        logger.debug('[WorkspacePage] Routed workspace:open-terminal to panel layout', {
          terminalId,
        });
      }
    };

    // Use capture phase to intercept before the legacy handlers
    window.addEventListener('workspace:open-file', handleOpenFile, true);
    window.addEventListener('workspace:open-diff', handleOpenDiff, true);
    window.addEventListener('workspace:open-commit-changeset', handleOpenCommitChangeset, true);
    window.addEventListener('workspace:open-note', handleOpenNote, true);
    window.addEventListener('workspace:open-agent', handleOpenAgent, true);
    window.addEventListener('workspace:open-terminal', handleOpenTerminal, true);

    return () => {
      window.removeEventListener('workspace:open-file', handleOpenFile, true);
      window.removeEventListener('workspace:open-diff', handleOpenDiff, true);
      window.removeEventListener(
        'workspace:open-commit-changeset',
        handleOpenCommitChangeset,
        true,
      );
      window.removeEventListener('workspace:open-note', handleOpenNote, true);
      window.removeEventListener('workspace:open-agent', handleOpenAgent, true);
      window.removeEventListener('workspace:open-terminal', handleOpenTerminal, true);
    };
  });

  // Track recently created agents to avoid race conditions
  let recentlyCreatedAgents = $state(new Set<string>());

  // Track recently created terminals to avoid race conditions
  let recentlyCreatedTerminals = $state(new Set<string>());

  function markAgentRecentlyCreated(agentId: string) {
    if (!agentId) return;
    recentlyCreatedAgents.add(agentId);
    recentlyCreatedAgents = new Set(recentlyCreatedAgents);
    // Auto-remove after 10 seconds — by then the agent should be in the agents list.
    // This prevents the set from growing unboundedly during long sessions.
    setTimeout(() => {
      recentlyCreatedAgents.delete(agentId);
      recentlyCreatedAgents = new Set(recentlyCreatedAgents);
    }, 10_000);
  }

  function markTerminalRecentlyCreated(terminalId: string) {
    if (!terminalId) return;
    recentlyCreatedTerminals.add(terminalId);
    recentlyCreatedTerminals = new Set(recentlyCreatedTerminals);
    // Auto-remove after 10 seconds — by then the terminal should be in the terminals list.
    setTimeout(() => {
      recentlyCreatedTerminals.delete(terminalId);
      recentlyCreatedTerminals = new Set(recentlyCreatedTerminals);
    }, 10_000);
  }

  // Track last checked drawer state to prevent infinite loops
  let lastCheckedDrawerState = { itemId: '', workspaceId: '' };

  // Close drawer if the selected agent/terminal doesn't exist in the current workspace
  // NOTE: We use untrack() for agents/terminals reads to avoid looping when they update.
  // This effect should only react to drawer state changes and workspace ID changes.
  $effect(() => {
    if (state && state.drawer?.open && state.drawer?.itemId && safeWorkspace?.id) {
      if (state?.drawer?.type === 'agent') {
        const drawerItemId = String(state?.drawer?.itemId || '');
        const currentWorkspaceId = String(safeWorkspace?.id || '');

        // Skip if we already checked this exact state (prevent duplicate checks)
        if (
          lastCheckedDrawerState.itemId === drawerItemId &&
          lastCheckedDrawerState.workspaceId === currentWorkspaceId
        ) {
          return;
        }
        lastCheckedDrawerState = {
          itemId: drawerItemId,
          workspaceId: currentWorkspaceId,
        };

        // Use untrack to read agents without creating a reactive dependency
        const currentAgents = untrack(() => agents);
        const currentAgentsLoaded = untrack(() => agentsLoaded);
        const currentInitialAgentId = untrack(() => initialAgentId);
        const currentRecentlyCreated = untrack(() => recentlyCreatedAgents);

        // Don't close if it's the pending initial agent
        if (currentInitialAgentId && drawerItemId === currentInitialAgentId) {
          // Check if this is still a pending agent (not in the agents list yet)
          const agentExists = currentAgents.find(
            (a: AgentSession) => a && String(a.id) === currentInitialAgentId,
          );
          if (!agentExists) {
            // Keep the drawer open - it's still being created
            return;
          }
        }

        // Skip check if this agent was just created (give it time to appear in the list)
        if (currentRecentlyCreated.has(drawerItemId)) {
          return;
        }

        // Skip if we're still loading agents
        if (!currentAgentsLoaded) {
          return;
        }

        // Check both regular agents list and all sessions (to include background agents)
        let agent = currentAgents.find((a: AgentSession) => a && String(a.id) === drawerItemId);

        // If not found in regular agents, check all sessions (includes background agents)
        if (!agent) {
          const allSessions = agentService.getAllSessions();
          agent = allSessions.find((s: AgentSession) => String(s.id) === drawerItemId);
        }

        // Close drawer if agent doesn't exist or belongs to a different workspace
        // Convert both to strings for comparison to handle branded types
        const agentWorkspaceStr = agent?.workspaceId ? String(agent.workspaceId) : undefined;
        const currentWorkspaceStr = safeWorkspace?.id ? String(safeWorkspace.id) : undefined;

        if (!agent || agentWorkspaceStr !== currentWorkspaceStr) {
          logger.info('Closing drawer - agent not found or belongs to different workspace', {
            agentId: drawerItemId,
            currentWorkspace: currentWorkspaceStr,
            currentWorkspaceType: typeof safeWorkspace?.id,
            agentWorkspace: agentWorkspaceStr,
            agentWorkspaceType: typeof agent?.workspaceId,
            isInitialAgent: drawerItemId === currentInitialAgentId,
            inRecentlyCreated: currentRecentlyCreated.has(drawerItemId),
            checkedAllSessions: true,
            agentFound: !!agent,
            agentKeys: agent ? Object.keys(agent) : [],
          });
          closeDrawer();
        }
      } else if (state?.drawer?.type === 'terminal') {
        // Use untrack to read terminals without creating a reactive dependency
        const currentTerminalsLoaded = untrack(() => terminalsLoaded);
        const currentTerminals = untrack(() => terminals);
        const currentRecentlyCreatedTerminals = untrack(() => recentlyCreatedTerminals);

        // Skip if we're still loading terminals
        if (!currentTerminalsLoaded) {
          return;
        }

        const drawerItemId = String(state?.drawer?.itemId || '');

        // Skip check if this terminal was just created (give it time to appear in the list)
        if (currentRecentlyCreatedTerminals.has(drawerItemId)) {
          return;
        }

        const terminal = currentTerminals.find((t: Terminal) => t.id === drawerItemId);
        if (!terminal) {
          logger.info('Closing drawer - terminal not found', {
            terminalId: drawerItemId,
          });
          closeDrawer();
        }
      }
    }
  });

  // Listen for agent deletion events to ensure UI stays in sync
  $effect(() => {
    if (typeof window !== 'undefined' && window.electronAPI && workspaceId) {
      const handleAgentDeleted = (agentId: string) => {
        logger.info('[WorkspacePage] Agent deleted event received', { agentId, workspaceId });

        // If the deleted agent was selected, clear the selection
        if (state?.drawer?.itemId === agentId) {
          closeDrawer();
        }

        // Close any panel tabs for this agent to unmount ChatPanel
        // Without this, the ChatPanel stays mounted and may try to re-create the session
        try {
          const layoutManager = getPanelLayoutManager(workspaceId);
          layoutManager.closeTabsMatching((tab) => tab.type === 'agent' && tab.agentId === agentId);
        } catch {
          // Layout manager may not exist yet during early initialization
        }

        // Clear initialAgentId if we're deleting the initial agent
        if (initialAgentId === agentId) {
          logger.info('[WorkspacePage] Clearing initialAgentId from deletion event', { agentId });
          initialAgentId = undefined;
        }

        // Remove from agents list if it exists
        agents = agents.filter((a: AgentSession) => a?.id !== agentId);

        // Also remove from session store to ensure sidebar and other components are updated
        // This handles the race condition where the IPC event arrives before deleteSession completes
        sessionStore.removeSession(agentId);
      };

      const unsubscribe = listenSync('agent:deleted', (event: any) => {
        // Use extractEventData to handle both WorkspaceEvent and flat IPC formats
        const agentId = extractEventData<string>(event, 'agentId');
        if (typeof agentId === 'string') {
          handleAgentDeleted(agentId);
        } else {
          logger.warn('[WorkspacePage] Received agent:deleted event with invalid agentId', {
            event,
            agentId,
          });
        }
      });

      return unsubscribe;
    }
  });

  // Listen for agent rename events to update UI
  $effect(() => {
    if (typeof window !== 'undefined' && window.electronAPI && workspaceId) {
      const handleAgentRenamed = (data: { agentId: string; workspaceId: string; name: string }) => {
        logger.info('[WorkspacePage] Agent renamed event received', data);

        // Only process if it's for our workspace
        if (data.workspaceId !== workspaceId) return;

        // Update the agent in the agents list
        const previousNames = agents.map((a: AgentSession) => ({ id: a?.id, name: a?.name }));
        agents = agents.map((a: AgentSession) => {
          if (a?.id === data.agentId) {
            return { ...a, name: data.name };
          }
          return a;
        });
        const updatedNames = agents.map((a: AgentSession) => ({ id: a?.id, name: a?.name }));
        logger.info('[WorkspacePage] Agent renamed - agents array updated', {
          previousNames,
          updatedNames,
          targetAgentId: data.agentId,
          newName: data.name,
        });

        // Update session store
        sessionStore.updateSession(data.agentId, { name: data.name });
      };

      const unsubscribe = listenSync('agent:renamed', (event: any) => {
        // agent:renamed is sent via direct IPC (flat data), use extractEventData for consistency
        const data = extractEventData<{ agentId: string; workspaceId: string; name: string }>(
          event,
        );
        if (data && typeof data.agentId === 'string') {
          handleAgentRenamed(data);
        } else {
          logger.warn('[WorkspacePage] Received agent:renamed event with invalid data', { event });
        }
      });

      return unsubscribe;
    }
  });

  // Terminal management is handled through agent sessions
  // Terminals are created and managed as part of agent interactions

  // Initialize file tracking for workspace
  // Track the last workspace ID to prevent unnecessary re-initialization
  let lastFileTrackingWorkspaceId: string | null = null;
  let fileTrackingInitTimer: NodeJS.Timeout | null = null;

  $effect(() => {
    // Use workspaceId from route params directly - this is more reliable than safeWorkspace
    // because safeWorkspace depends on a long chain of async state that might not be ready
    // Skip if creating a new workspace or if the ID is invalid
    const currentWorkspaceId = workspaceId;
    const isValidId =
      currentWorkspaceId &&
      currentWorkspaceId !== 'new' &&
      !currentWorkspaceId.startsWith('optimistic-') &&
      currentWorkspaceId !== 'undefined';

    // Debug: Always log the current state for troubleshooting skeleton loader issue
    logger.debug('[WorkspacePage] File tracking effect running', {
      currentWorkspaceId,
      lastFileTrackingWorkspaceId,
      isValidId,
      hasSafeWorkspace: !!safeWorkspace,
      storeCurrentWorkspaceId: fileTrackingStore.currentWorkspaceId,
      storeLoading: fileTrackingStore.loading,
    });

    // Exit early if no valid workspace ID or same as last tracked
    if (!isValidId || currentWorkspaceId === lastFileTrackingWorkspaceId) {
      return;
    }

    logger.info('[WorkspacePage] Initializing file tracking store', {
      currentWorkspaceId,
      lastFileTrackingWorkspaceId,
    });

    // Update tracking immediately
    lastFileTrackingWorkspaceId = currentWorkspaceId;

    // Clear any pending initialization
    if (fileTrackingInitTimer) {
      clearTimeout(fileTrackingInitTimer);
    }

    // IMMEDIATELY notify the store we're switching - this triggers loading state
    // so the UI shows skeleton instead of stale data from previous workspace.
    // This is synchronous and safe - the store handles the transition internally.
    fileTrackingStore.setWorkspace(currentWorkspaceId);

    // Delay git status loading slightly to let other components settle
    // This prevents the effect depth exceeded error
    fileTrackingInitTimer = setTimeout(() => {
      // Perform async git status initialization (file tracking already started above)
      gitStore.loadStatus(WorkspaceId(currentWorkspaceId)).catch((error) => {
        logger.error('[WorkspacePage] Failed to load git status', error);
      });

      // Initialize central git:status-changed listener at workspace level
      // This ensures cache invalidation happens regardless of which sidebar panel is active
      gitStore.initEventListener(WorkspaceId(currentWorkspaceId));
    }, 50); // Small delay to break the synchronous effect chain

    // Note: fileTrackingStore handles its own cleanup internally when switching workspaces
  });

  // Monitor file tracking store's main panel view for commit and diff navigation
  $effect(() => {
    const mainPanelView = fileTrackingStore.mainPanelView;
    if (mainPanelView?.type === 'commit' && mainPanelView.commit && workspaceState) {
      logger.info('[WorkspacePage] Navigating to commit view', {
        commit: mainPanelView.commit,
      });

      // Update the workspace state to show the commit in the main panel
      workspaceState.setMainPanel('commit', {
        selectedCommit: mainPanelView.commit,
        selectedFile: undefined,
        selectedNoteId: undefined,
      });

      // Clear the main panel view to prevent infinite loop
      fileTrackingStore.clearMainPanelView();
    } else if (mainPanelView?.type === 'diff' && mainPanelView.change && workspaceState) {
      logger.info('[WorkspacePage] Navigating to diff view from file tracking store', {
        change: mainPanelView.change,
      });

      // Use openDiff to properly add to navigation history
      workspaceState.openDiff(mainPanelView.change);
    }
  });

  // Setup event listeners for workspace state
  $effect(() => {
    if (workspaceState && state?.isComponentMounted) {
      const cleanup = workspaceState.setupEventListeners();
      return () => {
        if (cleanup) cleanup();
      };
    }
  });

  // Listen for first message events
  $effect(() => {
    function handleFirstMessageEvent(event: CustomEvent) {
      const { workspaceId: eventWorkspaceId, isWaiting } = event.detail;
      if (eventWorkspaceId === workspaceId) {
        isWaitingForFirstMessage = isWaiting;
        logger.info('[WorkspacePage] First message waiting state changed', {
          workspaceId,
          isWaiting,
        });
      }
    }

    window.addEventListener(
      'workspace:waiting-for-first-message',
      handleFirstMessageEvent as EventListener,
    );

    return () => {
      window.removeEventListener(
        'workspace:waiting-for-first-message',
        handleFirstMessageEvent as EventListener,
      );
    };
  });

  // Track current context for MCP tools
  $effect(() => {
    // Track the main panel state to update context when it changes
    // These reads create reactive dependencies that trigger the effect
    // when any of these values change
    const mainPanelType = state?.mainPanel?.type;
    const workspaceReady = safeWorkspace?.id;
    // Read these to create dependencies (void to suppress unused warnings)
    void state?.mainPanel?.selectedNoteId;
    void state?.mainPanel?.selectedFile;

    // Only update context if workspace is ready and we have valid state
    if (workspaceReady && workspaceState && mainPanelType) {
      // Use untrack to avoid creating dependencies on the update call itself
      untrack(() => {
        workspaceState.updateCurrentContext();
      });
    }
  });

  // Track which note is currently being viewed for unread status
  // This prevents notes from being marked as "unread" when updated while being viewed
  $effect(() => {
    const mainPanelType = state?.mainPanel?.type;
    const selectedNoteId = state?.mainPanel?.selectedNoteId;

    if (mainPanelType === 'notes' && selectedNoteId) {
      // Mark this note as currently being viewed
      noteReadTrackingStore.markAsViewed(selectedNoteId);
    } else {
      // No note is being viewed in the main panel
      noteReadTrackingStore.clearCurrentlyViewed();
    }
  });

  // Clear unread status for agents in this workspace when the user navigates to it.
  // This handles direct URL navigation (e.g., browser back/forward, bookmark, link).
  // Sidebar navigation components already call clearUnreadForWorkspace on click,
  // but direct URL access bypasses those components entirely.
  $effect(() => {
    if (workspaceId && workspaceId !== 'new' && !workspaceId.startsWith('optimistic-')) {
      unreadTrackingService.clearUnreadForWorkspace(workspaceId);
    }
  });

  function handleFileSelect(filePath: string) {
    if (workspaceState) {
      logger.debug('[WorkspacePage] handleFileSelect called', { filePath });
      workspaceState.openFile(filePath);

      track('Opened File', {
        workspace_id: safeWorkspace?.id || workspaceId,
        file_extension: getFileExtension(filePath),
      });
    }
  }

  function handleCreateFile(folderPath: string, fileName?: string) {
    if (!safeWorkspace?.id) return;
    createFileFolderPath = folderPath;
    if (fileName) {
      // Inline creation from the file tree — skip the dialog
      handleCreateFileConfirm(fileName);
      return;
    }
    // Open the dialog for manual entry
    createFileDialogOpen = true;
  }

  async function handleCreateFileConfirm(fileName: string) {
    if (!safeWorkspace?.id || !createFileFolderPath) return;

    const newFilePath = `${createFileFolderPath}/${fileName}`;
    logger.debug('[WorkspacePage] handleCreateFile called', {
      folderPath: createFileFolderPath,
      fileName,
      newFilePath,
    });

    try {
      // Create the file with empty content via IPC
      const { invoke } = await import('$lib/electron-bridge');
      const result = await invoke<{ success: boolean; error?: string }>('file:write', {
        path: newFilePath,
        content: '',
        workspaceId: safeWorkspace.id,
      });

      if (result?.success) {
        toast.success(`Created ${fileName}`);
        // Notify the file tree to refresh so the new file appears
        window.dispatchEvent(
          new CustomEvent('file:changed', {
            detail: {
              workspaceId: safeWorkspace.id,
              type: 'create',
              filePath: newFilePath,
            },
          }),
        );
        // Open the newly created file
        handleFileSelect(newFilePath);
        track('Created File', {
          workspace_id: safeWorkspace.id,
          file_extension: getFileExtension(fileName),
        });
      } else {
        toast.error(`Failed to create file: ${result?.error || 'Unknown error'}`);
      }
    } catch (err) {
      logger.error('[WorkspacePage] Error creating file', err);
      toast.error('Failed to create file');
    }
  }

  async function handleOpenNote(noteId: string) {
    if (workspaceState) {
      logger.debug('[WorkspacePage] handleOpenNote called', { noteId });
      await workspaceState.openNote(noteId);

      // Mark note as read when opened (await to ensure persistence before refresh)
      if (safeWorkspace?.id) {
        await noteReadTrackingStore.markNoteRead(safeWorkspace.id, noteId);
      }
    }
  }

  async function handleCreateNote() {
    if (!safeWorkspace?.id) return;

    const result = await notesClient.create({
      workspaceId: WorkspaceId(safeWorkspace.id),
      title: 'New Note',
      content: '',
      tags: [],
    });

    if (result.ok && result.data) {
      // Mark note as read BEFORE reloading notes to prevent race condition
      // where computeUnreadNotes runs before the read record is persisted
      await noteReadTrackingStore.markNoteRead(safeWorkspace.id, result.data.id);

      // Now reload notes - the read record is already persisted
      await notesStateManager.reloadNotes();

      // Open the new note - use openNoteInLayout to support panel layout
      openNoteInLayout(result.data.id, result.data.title || 'New Note');

      // Track note created
      track('Created Note', { note_type: 'regular', source: 'tab-bar' });
    }
  }

  function handleOpenUrl(url: string) {
    if (workspaceState) {
      logger.debug('[WorkspacePage] handleOpenUrl called', { url });
      workspaceState.openBrowser(url);
    }
  }

  function handleOpenBrowser() {
    // Open browser with a default search page
    const defaultUrl = 'about:blank';
    if (workspaceState) {
      logger.debug('[WorkspacePage] handleOpenBrowser called');
      workspaceState.openBrowserUrl(defaultUrl);
    }
  }

  async function handleDelegateTask(taskText: string): Promise<string | null> {
    if (!safeWorkspace) {
      logger.error('Cannot delegate task: workspace not loaded');
      return null;
    }

    const workspacePath =
      safeWorkspace.worktreePath || safeWorkspace.repositoryPath || safeWorkspace.path;
    if (!workspacePath) {
      logger.error('Cannot delegate task: no workspace path');
      return null;
    }

    logger.info('[WorkspacePage] Delegating task from dashboard to new agent', { taskText });

    // Use the same graduation flow as TaskItemNodeView → NoteWithComments:
    // 1. Generate IDs for optimistic updates
    // 2. Add optimistic note to store immediately
    // 3. Create Task Note with agent via createPrerequisiteNote
    // 4. Replace optimistic note with real note
    // 5. Add agent session to stores
    // 6. Open agent drawer

    // Step 1: Generate IDs immediately for optimistic UI
    const optimisticAgentId = unifiedIdService.generateAgentId();
    const optimisticNoteId = unifiedIdService.generateNoteId();

    // Step 2: Build content and add optimistic note
    const parentNoteId = SPEC_NOTE_ID;
    const parentNote = notesStateManager.findById(NoteId(parentNoteId));
    const parentNoteTitle = parentNote?.title || 'Workspace Spec';
    const taskNoteContent = buildTaskNoteContent(taskText, parentNoteId, parentNoteTitle);

    // Add optimistic note to store immediately (shows in sidebar)
    const now = new Date().toISOString();
    const sanitizedTitle = stripMarkdownFormatting(taskText);
    const optimisticNote = {
      id: optimisticNoteId,
      workspaceId: safeWorkspace.id,
      title: sanitizedTitle,
      content: taskNoteContent,
      tags: [],
      contentType: 'task' as const,
      visibility: 'private' as const,
      taskStatus: 'in_progress' as const,
      createdAt: now,
      updatedAt: now,
      created_at: now,
      updated_at: now,
      is_pinned: false,
      is_archived: false,
    };
    notesStateManager.addOptimisticNote(optimisticNote as any);

    logger.info('[WorkspacePage] Added optimistic Task Note', {
      noteId: optimisticNoteId,
      title: sanitizedTitle,
    });

    try {
      logger.info('[WorkspacePage] Creating Task Note for delegated task', {
        taskText,
        parentNoteId,
        parentNoteTitle,
        optimisticAgentId,
        optimisticNoteId,
      });

      // Step 3: Create the Task Note with agent via createPrerequisiteNote
      // Set status to 'in_progress' since we're creating an agent to work on it
      const result = await notesClient.createPrerequisiteNote(
        WorkspaceId(safeWorkspace.id),
        NoteId(parentNoteId),
        {
          title: sanitizedTitle,
          content: taskNoteContent,
          // Note: Task orchestration now uses parentId (sidebar hierarchy) as the dependency graph.
          // No separate dependencyType tracking is needed.
          taskStatus: 'in_progress',
          agentConfig: {
            instruction: taskText,
            model: modelStore.getWorkspaceDefaultModel(safeWorkspace.id),
            autoStart: true,
            agentId: optimisticAgentId,
          },
        },
      );

      if (!result.ok) {
        // Rollback: remove optimistic note
        notesStateManager.removeOptimisticNote(optimisticNoteId);
        throw new Error(result.error || 'Failed to create Task Note');
      }

      const { note: taskNote, agent: agentData } = result.data;

      // Step 4: Replace optimistic note with real note from server
      notesStateManager.removeOptimisticNote(optimisticNoteId);
      notesStateManager.addOptimisticNote(taskNote);

      logger.info('[WorkspacePage] Task Note created successfully', {
        taskNoteId: taskNote.id,
        agentId: agentData?.id,
      });

      // Step 3: Add agent session to stores if agent was created
      if (agentData) {
        // Check if agent is already in the list (may have been added by event)
        if (!agents.find((a: AgentSession) => a?.id === agentData.id)) {
          const session: AgentSession = {
            id: agentData.id,
            workspaceId: safeWorkspace.id,
            name: agentData.name || taskText.slice(0, 40),
            model: agentData.model || modelStore.getWorkspaceDefaultModel(safeWorkspace.id),
            createdAt: agentData.createdAt || new Date().toISOString(),
            backendSessionId: agentData.backendSessionId,
            status: AgentStatus.Active,
            messages: [],
            updatedAt: new Date().toISOString(),
          };

          agentService.addSession(session);
          agents = [...agents, session];
          workspaceState?.updateState({ agentsList: agents });
        }

        // Mark as recently created
        markAgentRecentlyCreated(agentData.id);

        // NOTE: Don't auto-open the agent drawer for task delegation from dashboard
        // This matches the behavior in NoteWithComments which uses autoOpenDrawer: false
        // Task agents run in the background - users can click to view if they want
      }

      // Step 5: Convert the checklist item in spec to a linked task
      // This updates the markdown from "- [ ] Task text" to "- [ ] [Task text](intent://local/task/noteId)"
      const specContent = notesStateManager.spec?.content || '';
      if (specContent && taskNote.id) {
        // Escape special regex characters in task text
        const escapedTaskText = taskText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Match the task line: "- [ ] task text" or "- [x] task text" etc.
        const taskRegex = new RegExp(
          `^(\\s*[-*]\\s*\\[[ xX\\/]\\]\\s*)${escapedTaskText}(\\s*)$`,
          'gm',
        );
        // Escape markdown special characters in task text for the link text
        // This prevents issues with backticks, brackets, etc.
        const escapedLinkText = taskText
          .replace(/\\/g, '\\\\') // Escape backslashes first
          .replace(/`/g, '\\`') // Escape backticks
          .replace(/\[/g, '\\[') // Escape opening brackets
          .replace(/\]/g, '\\]'); // Escape closing brackets
        // Use shared constant for URL construction
        const linkedTaskText = `$1[${escapedLinkText}](${taskNoteUrl(taskNote.id)})$2`;
        const updatedSpecContent = specContent.replace(taskRegex, linkedTaskText);

        if (updatedSpecContent !== specContent) {
          logger.info('[WorkspacePage] Converting task to linked task in spec', {
            taskNoteId: taskNote.id,
            taskText,
          });
          await notesStateManager.updateNoteContent(
            NoteId(SPEC_NOTE_ID),
            updatedSpecContent,
            true, // skip save debounce
          );
        }
      }

      // Reload notes to ensure everything is in sync
      await notesStateManager.reloadNotes();

      // Return the created agent ID
      return agentData?.id || null;
    } catch (error) {
      logger.error('[WorkspacePage] Failed to delegate task from dashboard:', error);
      toast.error('Failed to create agent for task');
      return null;
    }
  }

  // ============================================================================
  // Close handlers + workspace-level event wiring
  // ============================================================================

  useCloseHandlers({
    get workspaceState() {
      return workspaceState;
    },
    onOpenTerminal: openTerminal,
  });

  useTaskDelegationHandlers({
    workspace: () => safeWorkspace,
    delegateTask: handleDelegateTask,
    onOpenAgent: openAgent,
  });

  // ============================================================================
  // Panel Actions with State Persistence
  // ============================================================================

  const panelActions = usePanelActions({
    workspace: () => safeWorkspace,
    workspaceState: () => workspaceState,
    state: () => state,
    agents: () => agents,
    terminals: () => terminals,
    markAgentRecentlyCreated,
    onDraftPromptSet: (prompt) => {
      draftPrompt = prompt;
    },
  });

  async function openFile(filePath: string) {
    await panelActions.openFile(filePath);
  }

  async function openNote(noteId: string) {
    await panelActions.openNote(noteId);
  }

  function openAgent(agentId: string) {
    panelActions.openAgent(agentId);
  }

  function openTerminal(terminalId: string) {
    panelActions.openTerminal(terminalId);
  }

  function closeDrawer() {
    panelActions.closeDrawer();
  }

  /**
   * Create an agent and pre-fill the input with a prompt (without sending)
   * Used for contextual actions like "Generate tasks from spec" and "Delegate tasks"
   */
  async function handleCreateAgentWithPrompt(prompt: string, name: string) {
    await panelActions.handleCreateAgentWithPrompt(prompt, name);
  }

  /**
   * Create a new agent (used by keyboard shortcuts and UI buttons)
   */
  async function handleCreateAgent(agentType?: string) {
    if (!safeWorkspace) {
      logger.error('Cannot create agent: workspace not loaded');
      return;
    }

    const workspacePath =
      safeWorkspace.worktreePath || safeWorkspace.repositoryPath || safeWorkspace.path;
    if (!workspacePath) {
      logger.error('Cannot create agent: workspace missing path');
      return;
    }

    const existingNames = agents.map((a: AgentSession) => a.name).filter(Boolean) as string[];
    const agentName = generateSpecialistAgentName('Agent', existingNames);

    const result = await agentFactory.createAgent(safeWorkspace, {
      name: agentName,
      workspaceId: WorkspaceId(safeWorkspace.id),
      model: modelStore.getWorkspaceDefaultModel(safeWorkspace.id),
      provider: activeProviderStore.activeProviderId,
      agentType: (agentType && parseAgentTypeId(agentType)) || createAgentTypeId('chat'),
      source: 'keyboard-shortcut',
    });

    if (!result.success || !result.agent) {
      logger.error('[WorkspacePage] Failed to create agent via shortcut', result.error);
      return;
    }

    const session = result.agent;

    // Add to agents list if not already present
    if (!agents.some((a: AgentSession) => a.id === session.id)) {
      agents = [...agents, session];
      workspaceState?.updateState({ agentsList: agents });
    }

    markAgentRecentlyCreated(session.id);

    // Open the new agent with delay - use openAgentInLayout to support panel layout
    setTimeout(() => openAgentInLayout(session.id, session.name || agentName), 100);
  }

  /**
   * Create a new agent with a specific specialist configuration
   * @param specialistId - The ID of the specialist to use, or null for default agent
   */
  async function handleCreateAgentWithSpecialist(specialistId: string | null) {
    if (!safeWorkspace) {
      logger.error('Cannot create agent: workspace not loaded');
      return;
    }

    const workspacePath =
      safeWorkspace.worktreePath || safeWorkspace.repositoryPath || safeWorkspace.path;
    if (!workspacePath) {
      logger.error('Cannot create agent: workspace missing path');
      return;
    }

    // Get specialist configuration if provided
    const existingNames = agents.map((a: AgentSession) => a.name).filter(Boolean) as string[];
    let model = modelStore.getWorkspaceDefaultModel(safeWorkspace.id);
    let behaviorPrompt: string | undefined;
    let specialistBaseName = 'Agent';

    if (specialistId) {
      const specialist = specialistsStore.specialists.find((s) => s.id === specialistId);
      if (specialist) {
        specialistBaseName = specialist.name;
        model = specialistsStore.getEffectiveModel(specialistId);
        behaviorPrompt = specialistsStore.getEffectiveBehaviorPrompt(specialistId);
        logger.info('[WorkspacePage] Creating agent with specialist config', {
          specialistId,
          specialistBaseName,
          model,
          behaviorPromptLength: behaviorPrompt?.length || 0,
          behaviorPromptPreview: behaviorPrompt?.substring(0, 100),
        });
      }
    }

    const agentName = generateSpecialistAgentName(specialistBaseName, existingNames);

    const result = await agentFactory.createAgent(safeWorkspace, {
      name: agentName,
      workspaceId: WorkspaceId(safeWorkspace.id),
      model,
      provider: activeProviderStore.activeProviderId,
      agentType: createAgentTypeId('chat'),
      behaviorPrompt,
      source: 'specialist-picker',
      metadata: specialistId ? { specialist: specialistId } : undefined,
    });

    if (!result.success || !result.agent) {
      logger.error('[WorkspacePage] Failed to create agent with specialist', result.error);
      return;
    }

    const session = result.agent;

    // Add to agents list if not already present
    if (!agents.some((a: AgentSession) => a.id === session.id)) {
      agents = [...agents, session];
      workspaceState?.updateState({ agentsList: agents });
    }

    markAgentRecentlyCreated(session.id);

    // Open the new agent with delay - use openAgentInLayout to support panel layout
    setTimeout(() => openAgentInLayout(session.id, session.name || agentName), 100);
  }

  /**
   * Create a new terminal (used by keyboard shortcuts and UI buttons)
   */
  async function handleCreateTerminal() {
    if (!safeWorkspace) {
      logger.error('Cannot create terminal: workspace not loaded');
      return;
    }

    const terminalId = `terminal-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

    const newTerminal: Terminal = {
      id: terminalId,
      type: 'terminal',
      title: 'Terminal',
      workspaceId: safeWorkspace.id,
      createdAt: new Date().toISOString(),
      isConnected: false,
      isExecuting: false,
    };

    terminals = [...terminals, newTerminal];
    workspaceState?.updateState({ terminalsList: terminals });

    terminalManager.saveTerminalMetadata(terminalId, safeWorkspace.id, 'Terminal');
    markTerminalRecentlyCreated(terminalId);
    openTerminal(terminalId);

    // Track terminal opened
    track('Opened Terminal', {
      workspace_id: safeWorkspace.id,
      source: 'keyboard-shortcut',
    });
  }

  // ============================================================================
  // Dock Navigation (Keyboard Shortcuts)
  // ============================================================================

  useDockNavigation({
    get agents() {
      return agents;
    },
    get terminals() {
      return terminals;
    },
    get state() {
      return state;
    },
    get stateManager() {
      return workspaceState;
    },
    get workspaceId() {
      return safeWorkspace?.id || workspaceId;
    },
    onOpenAgent: openAgent,
    onOpenTerminal: openTerminal,
    onCloseDrawer: closeDrawer,
    onCreateAgent: handleCreateAgent,
    onCreateTerminal: handleCreateTerminal,
    isCurrentAgentStreaming: () => {
      // Check if the currently open agent is streaming
      const currentAgentId = state?.drawer?.type === 'agent' ? state?.drawer?.itemId : null;
      if (!currentAgentId) return false;
      const currentAgent = agents.find((a) => a.id === currentAgentId);
      return currentAgent?.isStreaming ?? false;
    },
  });

  // ============================================================================
  // Panel Shortcuts (Keyboard Navigation)
  // ============================================================================

  // Helper to find and focus the first focusable element in a container
  function focusFirstInContainer(selector: string) {
    const container = document.querySelector(selector);
    if (!container) return;
    const focusable = container.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    focusable?.focus();
  }

  usePanelShortcuts({
    panelVisibilityManager,
    // Note: Cmd+B sidebar toggle is now handled directly by sidebarWidthStore.toggle()
    // in use-panel-shortcuts.svelte.ts
    onOpenAgentOverview: () => {
      // Open the Agent Overview panel tab
      const layoutManager = getPanelLayoutManager(workspaceId);
      layoutManager.openTab({
        type: 'agent-overview',
        title: 'Agent Overview',
        closable: true,
        workspaceId,
      });
    },
    onFocusSidebar: () => {
      // Focus the first focusable element in the sidebar
      focusFirstInContainer('[data-panel="sidebar"]');
    },
    onFocusMainContent: () => {
      // Focus the main content area
      focusFirstInContainer('[data-panel="main-content"]');
    },
    onFocusDrawer: () => {
      // Open drawer if not open, then focus it
      if (!state?.drawer?.open) {
        workspaceState?.openDrawer('overview', 'overview');
      }
      // Focus will happen after drawer opens
      setTimeout(() => {
        focusFirstInContainer('[data-panel="drawer"]');
      }, 100);
    },
    onFocusDock: () => {
      // Focus the first item in the dock
      focusFirstInContainer('[data-panel="dock"]');
    },
    onFocusExplorer: () => {
      // Switch to files tab in TabbedSidebar
      const transientUIStore = getTransientUIStore(workspaceId);
      transientUIStore.setSidebarActiveTab('files');
    },
    onFocusGit: () => {
      // Switch to changes tab in TabbedSidebar
      const transientUIStore = getTransientUIStore(workspaceId);
      transientUIStore.setSidebarActiveTab('changes');
    },
    onFocusNotes: () => {
      // Switch to notes tab in TabbedSidebar
      const transientUIStore = getTransientUIStore(workspaceId);
      transientUIStore.setSidebarActiveTab('notes');
    },
    onFocusActivity: () => {
      // Switch to agents tab in TabbedSidebar (Activity tab was removed)
      const transientUIStore = getTransientUIStore(workspaceId);
      transientUIStore.setSidebarActiveTab('agents');
    },
    onMaximizePanel: () => {
      // Toggle maximize: hide sidebar and dock for focus mode
      const isMaximized =
        !panelVisibilityManager.showNavigationRail && !panelVisibilityManager.showWorkspaceDock;
      if (isMaximized) {
        // Restore
        panelVisibilityManager.setNavigationRailVisibility(true);
        panelVisibilityManager.setWorkspaceDockVisibility(true);
      } else {
        // Maximize
        panelVisibilityManager.setNavigationRailVisibility(false);
        panelVisibilityManager.setWorkspaceDockVisibility(false);
      }
    },
    onLayoutFocus: () => {
      // Focus mode: hide sidebar and dock, maximize main content
      panelVisibilityManager.setNavigationRailVisibility(false);
      panelVisibilityManager.setWorkspaceDockVisibility(false);
    },
    onLayoutSplit: () => {
      // Split view: show sidebar and main content, no dock
      panelVisibilityManager.setNavigationRailVisibility(true);
      panelVisibilityManager.setWorkspaceDockVisibility(false);
    },
    onLayoutFull: () => {
      // Full layout: show everything
      panelVisibilityManager.setNavigationRailVisibility(true);
      panelVisibilityManager.setWorkspaceDockVisibility(true);
    },
  });

  // ============================================================================
  // Workspace Creation
  // ============================================================================

  // ============================================================================
  // Cleanup
  // ============================================================================

  onDestroy(async () => {
    logger.debug('Starting workspace page cleanup', { workspaceId });

    // Clear currently viewed note state to prevent stale tracking
    noteReadTrackingStore.clearCurrentlyViewed();

    // Cancel any pending loads
    workspaceLoader.clearLoadingState();
    agentLoadingPromise = null;

    // Clear file tracking initialization timer
    if (fileTrackingInitTimer) {
      clearTimeout(fileTrackingInitTimer);
      fileTrackingInitTimer = null;
    }

    // Clean up git store event listener
    gitStore.disposeEventListener();

    // Flush any pending undo-able agent deletions (permanently delete them now)
    await agentService.flushPendingDeletions(workspaceId);

    // Clean up workspace state with timeout
    // Note: dispose() has internal 500ms timeout for save queue, so we only need 1s here
    if (workspaceState && !stateDisposing) {
      stateDisposing = true;
      try {
        await Promise.race([
          workspaceState.dispose(),
          new Promise<void>((resolve) => setTimeout(resolve, 1000)),
        ]);
      } catch (error) {
        // Silently ignore - cleanup timeout is expected during fast navigation
        logger.debug('Workspace state cleanup timed out', { error });
      } finally {
        workspaceState = null;
        stateDisposing = false;
      }
    }

    // Clear all local state
    agents = [];
    terminals = [];
    agentsLoaded = false;

    // Dispose all managed resources (timers, intervals, etc.)
    cleanupManager.dispose();

    // Note: fileTrackingStore handles its own cleanup internally

    logger.debug('Workspace page cleaned up', { workspaceId });
  });
</script>

<!-- ============================================================================
     Template - Using WorkspaceLayout with snippets
     ============================================================================ -->

<!-- Sidebar Snippet -->
{#snippet sidebarContent()}
  {#if isCreatingWorkspace}
    <!-- fake header to match the layout -->
    <div class="flex items-center flex-none w-full"></div>
  {:else if !safeWorkspace || isCreatingWorkspace}
    {#if isCreatingWorkspace || isInTransition}
      <!-- Blank panel while creating new workspace or during transition -->
      <div class="w-full h-full"></div>
    {:else}
      <!-- Show skeleton for normal loading -->
      <SidebarSkeleton />
    {/if}
  {:else if sidebarState.useSleekSidebar}
    <MultiSelectTabbedSidebar
      workspace={safeWorkspace}
      workspaceId={safeWorkspace?.id || workspaceId}
      workspacePath={safeWorkspace?.worktreePath ||
        safeWorkspace?.repositoryPath ||
        safeWorkspace?.path ||
        ''}
      notes={sidebarState.sidebarNotes}
      notesLoading={sidebarState.sidebarNotesLoading}
      selectedNoteId={state?.mainPanel?.type === 'notes'
        ? state?.mainPanel?.selectedNoteId || SPEC_NOTE_ID
        : null}
      onOpenNote={handleOpenNote}
      onOpenAgent={openAgent}
      onCreateNote={handleCreateNote}
      selectedFile={state?.mainPanel?.type === 'file' ? state?.mainPanel?.selectedFile || '' : ''}
      onOpenFile={handleFileSelect}
      onCreateFile={handleCreateFile}
      onFileRenamed={(oldPath, newPath) => {
        logger.info('onFileRenamed callback received in +page.svelte', {
          oldPath,
          newPath,
          hasWorkspaceState: !!workspaceState,
          hasHandleFileRenamed: typeof workspaceState?.handleFileRenamed === 'function',
        });
        try {
          workspaceState?.handleFileRenamed(oldPath, newPath);
          try {
            const oldExt = getFileExtension(oldPath);
            const newExt = getFileExtension(newPath);
            track('Renamed File', {
              workspace_id: safeWorkspace?.id || workspaceId,
              old_extension: oldExt,
              new_extension: newExt,
              extension_changed: oldExt !== newExt,
            });
          } catch {
            // Analytics should not break file renaming
          }
        } catch (error) {
          logger.error('Error calling handleFileRenamed', error as Error);
        }
      }}
      unstagedChanges={sidebarState.sidebarUnstagedChanges}
      stagedChanges={sidebarState.sidebarStagedChanges}
      selectedChangeId={state?.mainPanel?.selectedChangeId}
      activeFilePath={state?.mainPanel?.type === 'file-tracking-diff'
        ? state?.mainPanel?.selectedTrackedChange?.relativePath ||
          state?.mainPanel?.selectedFile ||
          null
        : null}
      activeFileStaged={state?.mainPanel?.type === 'file-tracking-diff'
        ? state?.mainPanel?.selectedTrackedChange?.stage === 'committed'
          ? null // Don't highlight any file in sidebar for committed changes
          : state?.mainPanel?.selectedTrackedChange?.stage === 'staged'
        : null}
      isAllChangesViewActive={state?.mainPanel?.type === 'local-changes'}
      onOpenChange={sidebarState.handleOpenChange}
      onStageChange={sidebarState.handleStageChange}
      onUnstageChange={sidebarState.handleUnstageChange}
      onRevertChange={sidebarState.handleRevertChange}
      onAcceptChanges={sidebarState.handleAcceptChanges}
      isAcceptChangesOpen={state?.mainPanel?.type === 'accept-changes'}
      onOpenPR={sidebarState.handleOpenPR}
      currentBranch={gitStore.branch || ''}
      unpushedCount={gitStore.ahead}
      isNewWorkspaceSession={workspaceState?.state?.isNewlyCreatedWorkspace &&
        state?.mainPanel?.selectedNoteId === 'spec' &&
        !fileTrackingStore.workingChanges.staged.length &&
        !fileTrackingStore.workingChanges.unstaged.length &&
        !gitStore.commits.length &&
        !gitStore.status?.files.length}
      pullRequests={safeWorkspace?.activePullRequest
        ? [
            {
              number: safeWorkspace.activePullRequest.number,
              title:
                safeWorkspace.activePullRequest.title ||
                `PR #${safeWorkspace.activePullRequest.number}`,
              url: safeWorkspace.activePullRequest.url || safeWorkspace.prUrl || '',
              htmlUrl: safeWorkspace.activePullRequest.url || safeWorkspace.prUrl || '',
              status: (safeWorkspace.activePullRequest.status ||
                safeWorkspace.prStatus ||
                'open') as 'open' | 'merged' | 'closed' | 'draft',
            },
          ]
        : []}
      commits={gitStore.commits.slice(0, gitStore.ahead).map((c) => ({
        hash: c.hash,
        message: c.message,
        author: c.author || '',
        date: c.date || '',
        filesChanged: c.files?.length || 0,
        isPushed: false,
        files: c.files?.map((f: string) => ({ path: f, additions: 0, deletions: 0 })) || [],
      }))}
      recentActivity={sidebarState.recentActivityEvents}
      onViewAllActivity={sidebarState.handleViewAllActivity}
      onOpenActivityEvent={sidebarState.handleOpenActivityEvent}
      onOpenDashboard={() => {
        workspaceState?.setMainPanel('dashboard');
      }}
      onCreateAgentWithPrompt={handleCreateAgentWithPrompt}
      onOpenUrl={handleOpenUrl}
      isChangesLoading={!fileTrackingStore.isInitialized || fileTrackingStore.loading}
      {agents}
      {terminals}
      activeItemId={state?.drawer?.itemId}
      showOverview={state?.drawer?.type === 'overview'}
      drawerOpen={state?.drawer?.open}
      drawerType={state?.drawer?.type}
      onSelectAgent={openAgent}
      onShowAgent={openAgent}
      onOpenTerminal={openTerminal}
      onCreateTerminal={handleCreateTerminal}
      onToggleOverview={() => {
        workspaceState?.openDrawer('overview', 'overview');
      }}
      onCreateAgent={handleCreateAgent}
      onCreateAgentWithSpecialist={handleCreateAgentWithSpecialist}
    />
  {:else}
    <VSCodeResizablePanels
      workspace={safeWorkspace}
      workspaceId={safeWorkspace?.id || workspaceId}
      selectedNoteId={state?.mainPanel?.type === 'notes'
        ? state?.mainPanel?.selectedNoteId || SPEC_NOTE_ID
        : null}
      selectedFile={state?.mainPanel?.type === 'file' ? state?.mainPanel?.selectedFile || '' : ''}
      selectedChangeId={state?.mainPanel?.selectedChangeId}
      hasCodeChanges={workspaceState?.hasCodeChanges || false}
      hasActivityEvents={workspaceState?.hasActivityEvents || false}
      loading={false}
      {panelVisibilityManager}
      {handleFileSelect}
      onOpenNote={handleOpenNote}
      onSelectAgent={openAgent}
    />
  {/if}
{/snippet}

<!-- Main Content Snippet -->
{#snippet mainContent()}
  {#if !safeWorkspace || isCreatingWorkspace}
    <ContentSkeleton />
  {:else}
    <!-- Panel-based layout when using TabbedSidebar -->
    <PanelLayout
      workspaceId={safeWorkspace?.id || workspaceId}
      onCreateAgent={handleCreateAgent}
      onCreateNote={handleCreateNote}
      onOpenBrowser={handleOpenBrowser}
    />
  {/if}
{/snippet}

<!-- Terminal Overlay Snippet -->
{#snippet terminalOverlayContent()}
  <QuakeTerminalOverlay workspaceId={safeWorkspace?.id || workspaceId} />
{/snippet}

<!-- Modals Snippet -->
{#snippet modalsContent()}
  <WorkspaceModals workspace={safeWorkspace} showAugieSetupWizard={false} showPRCreator={false} />
  <InputDialog
    bind:open={createFileDialogOpen}
    title="Create new file"
    description="Enter a name for the new file"
    placeholder="filename.ts"
    confirmLabel="Create"
    onConfirm={handleCreateFileConfirm}
  />
{/snippet}

<!-- Render the WorkspaceLayout component with snippets -->
<WorkspaceLayout
  sidebar={sidebarContent}
  content={mainContent}
  terminalOverlay={terminalOverlayContent}
  modals={modalsContent}
  sidebarSide={layoutSettings.sidebarSide}
/>
