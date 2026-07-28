<script lang="ts">
  /**
   * Workspace Detail Page - Unified State Version
   *
   * Complete rewrite using the new unified state management system.
   * No URL state, no backward compatibility, clean implementation.
   */

  import { page } from '$app/state';

  import { onMount, onDestroy, untrack } from 'svelte';
  import { writable } from 'svelte/store';

  import { WorkspaceId } from '$shared/types/branded-ids';
  import { toast } from 'svelte-sonner';

  import { createWorkspacePageState } from './composables/workspace-page-state.svelte';
  import {
    useCloseHandlers,
    usePanelShortcuts,
    useTabManagement,
    useWorkspaceLoader,
  } from './composables';
  import {
    dispatchCreateFileRequest,
    handleCommandPaletteCreateFile,
  } from './composables/create-file-command';
  import { dispatchWindowEvent } from '$lib/utils/window-events';
  import { commandPaletteActionConsumed } from '$store/renderer/slices/app-layout/app-layout-slice';
  import { selectPendingCommandPaletteAction } from '$store/renderer/slices/app-layout/app-layout-selectors';

  // Performance optimization
  import { CleanupManager } from '$features/optimization/memory-manager';

  import { selectMainPanelView } from '$store/renderer/slices/changes/changes-selectors';
  import { clearMainPanelView as ftClearMainPanelView } from '$store/renderer/slices/changes/changes-slice';
  import {
    selectActiveWorkspaceId,
    selectWorkspaceById,
    selectWorkspaceIsEmpty,
    selectIsNewWorkspaceSession,
  } from '$store/renderer/slices/workspace/workspace-selectors';
  import {
    selectPanelVisibilityFlag,
    selectSidebarSide,
  } from '$store/renderer/slices/ui-layout/ui-layout-selectors';
  import {
    clearActiveWorkspace,
    loadWorkspacesRequested,
    setActiveWorkspaceId,
    setWorkspaceEntity,
  } from '$store/renderer/slices/workspace/workspace-slice';
  import {
    setPanelVisibility,
    type PanelVisibilityState,
  } from '$store/renderer/slices/ui-layout/ui-layout-slice';

  import { createNoteRequested } from '$store/renderer/slices/note-read-tracking/note-read-tracking-slice';
  import { workspaceUnmounted } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';

  import { setOnboardingActive } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';

  // Components
  import WorkspaceLayout from '$lib/components/workspace/WorkspaceLayout.svelte';
  import WorkspaceModals from '$lib/components/workspace/WorkspaceModals.svelte';
  import SidebarSkeleton from '$lib/components/workspace/SidebarSkeleton.svelte';
  import ContentSkeleton from '$lib/components/workspace/ContentSkeleton.svelte';
  import ResourceNotFound from '$lib/components/common/ResourceNotFound.svelte';
  import InputDialog from '$lib/components/modals/InputDialog.svelte';
  import QuakeTerminalOverlay from '$lib/components/terminal/QuakeTerminalOverlay.svelte';
  import { PanelLayout } from '$lib/components/layout/panel-system';
  import { getPanelLayoutManager } from '$features/layout/panel-layout-adapter';

  // Onboarding
  import OnboardingPage from '$features/onboarding/OnboardingPage.svelte';

  // Utils
  import { createLogger } from '$lib/utils/client-logger';
  import { navigateToRoute } from '$lib/utils/navigation.client';

  import { setSidebarActiveTab } from '$store/renderer/slices/transient-ui/transient-ui-slice';
  import {
    createAgentRequested,
    createAgentWithSpecialistRequested,
    setAgents,
    setAgentsLoaded,
    flushPendingAgentDeletionsRequested,
  } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import MultiSelectTabbedSidebar from '$lib/components/workspace/MultiSelectTabbedSidebar.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';

  const logger = createLogger('workspace-page');

  // ============================================================================
  // Core State
  // ============================================================================

  const sidebarSide$ = selectSidebarSide();

  // Create unified state for this workspace
  // @ts-expect-error - Svelte 5 rune scoping issue
  let workspaceState = $state(null);
  // @ts-expect-error - Svelte 5 rune scoping issue
  let stateDisposing = $state(false);
  // @ts-expect-error - Svelte 5 rune scoping issue
  let previousWorkspaceId = $state(null);
  // Fade-in transition for fresh workspace creation (crossfade with onboarding page)
  // @ts-expect-error - Svelte 5 rune scoping issue
  let isFreshCreation = $state(false);

  // Crossfade transition state: onboardingHoldActive keeps onboarding visible
  // during the fade-out after workspaceId changes from 'new' to a real ID.
  // showOnboarding is derived after workspaceId is defined (see below).
  // @ts-expect-error - Svelte 5 rune scoping issue
  let onboardingHoldActive = $state(false);
  // @ts-expect-error - Svelte 5 rune scoping issue
  let onboardingFadingOut = $state(false);
  // Create file dialog state
  // @ts-expect-error - Svelte 5 rune scoping issue
  let createFileDialogOpen = $state(false);
  let createFileFolderPath = '';

  /**
   * Initialize a new workspace state for the given ID, pre-populating data from the store
   * to avoid a flash of empty/skeleton UI. Used by both the initial load and transition paths.
   *
   * Sets workspaceData on the state AND hydrates Redux so the selector-backed
   * $workspace has data on the first render frame. The workspace loader's
   * effect will still call workspaceClient.open() because its condition does not gate on
   * hasWorkspaceData — open() must always be called to start backend change detection.
   */
  function initializeWorkspaceState(wsId: string): ReturnType<typeof createWorkspacePageState> {
    const newState = createWorkspacePageState(wsId);

    // Pre-populate workspace data from the store to avoid blank state.
    // This is a synchronous Map lookup — cheap and eliminates the skeleton flash
    // when the workspace is already cached (the common case from home page navigation).
    const cachedWorkspace = selectWorkspaceById.select(appStore.state, wsId);
    if (cachedWorkspace) {
      newState.updateState({
        workspaceData: cachedWorkspace,
        workspace: { id: wsId, status: 'ready' },
      });
    }

    // Hydrate Redux immediately so the selector-backed $workspace has
    // data on the very first render frame (before the workspace loader runs).
    if (cachedWorkspace) {
      appStore.dispatch(setWorkspaceEntity(cachedWorkspace));
    }

    // Batch state updates with untrack to prevent effect cascades
    untrack(() => {
      workspaceState = newState;
      previousWorkspaceId = wsId;
    });

    return newState;
  }

  // Get workspace ID from route with defensive null check
  // page.params might be undefined during route transitions
  let workspaceId = $derived((page.params?.id as string) ?? '');

  // Show the full-page workspace onboarding whenever the route is /workspace/new
  // or while the crossfade hold is active after workspace creation.

  const showOnboarding = $derived(workspaceId === 'new' || onboardingHoldActive);

  // Reactive writable store that mirrors workspaceId so the Redux selector
  // re-evaluates whenever the route param changes.
  const workspaceIdStore = writable(workspaceId);
  $effect(() => {
    workspaceIdStore.set(workspaceId);
  });

  // Redux-backed workspace entity selector.  Called at component init time
  // (top-level script) with a Readable<string> so it stays reactive to both
  // workspaceId changes AND Redux state updates.
  const workspace = selectWorkspaceById(workspaceIdStore);

  // Transient signal: command palette → create-file dialog
  const pendingCommandPaletteAction$ = selectPendingCommandPaletteAction();

  // File tracking state from Redux
  const ftMainPanelView$ = selectMainPanelView();

  // Track if we're in the process of creating a workspace (including optimistic phase)
  let isCreatingWorkspace = $derived(
    workspaceId === 'new' || workspaceId?.startsWith('optimistic-'),
  );

  // ============================================================================
  // Onboarding Derived State (needs workspaceId to be defined)
  // ============================================================================
  const isOnboarding = $derived(workspaceId === 'new');

  // When workspaceId changes from 'new' to a real ID, start crossfade transition
  $effect(() => {
    if (workspaceId !== 'new' && onboardingHoldActive) {
      // Start fade-out animation on the onboarding content
      onboardingFadingOut = true;
      // After the collapse/fade animation completes, remove onboarding from DOM
      setTimeout(() => {
        onboardingHoldActive = false;
        onboardingFadingOut = false;
      }, 500);
    }
  });

  // NOTE: No auto-advance past welcome step. Users should always see step 1
  // and explicitly click to proceed, so they can review agent setup.

  // Track previous showOnboarding state to detect onboarding→workspace transition
  // @ts-expect-error - Svelte 5 rune scoping issue
  let prevShowOnboarding = $state(true);

  // Expand the sidebar when transitioning from onboarding to workspace.
  // The sidebar starts collapsed (width 0) during onboarding via initiallyCollapsed.
  // ResizablePanel only reads initiallyCollapsed at init time, so we dispatch
  // the toggle event to animate it open after workspace creation.
  $effect(() => {
    if (prevShowOnboarding && !showOnboarding) {
      // Onboarding just ended — expand sidebar with animation
      dispatchWindowEvent('workspace:toggle-left-sidebar', {
        collapsed: false,
        restoreWidth: 350,
      });
    }
    prevShowOnboarding = showOnboarding;
  });

  // Hide the left nav bar and top bar workspace controls during onboarding
  $effect(() => {
    appStore.dispatch(setOnboardingActive(showOnboarding));
    return () => appStore.dispatch(setOnboardingActive(false));
  });

  $effect(() => {
    if (workspaceId === 'new') {
      appStore.dispatch(clearActiveWorkspace());
    } else if (workspaceId) {
      // Guard: only dispatch when the active workspace ID differs to prevent
      // redundant dispatches that cascade through Redux middleware/sagas and
      // trigger Svelte's effect_update_depth_exceeded error.
      untrack(() => {
        if (selectActiveWorkspaceId.select(appStore.state) !== workspaceId) {
          appStore.dispatch(setActiveWorkspaceId(workspaceId));
        }
      });
    }
  });

  // Load workspace store on mount
  onMount(() => {
    // Load workspace store if needed
    if (selectWorkspaceIsEmpty.select(appStore.state)) {
      logger.debug('Loading workspace store on mount');
      appStore.dispatch(loadWorkspacesRequested());
    }

    // The `initial-agent-pending` sessionStorage marker is no longer stashed
    // by the daemon-owned create flow, so the fresh-creation fade-in transition
    // no longer keys off it. Any equivalent signal should come from workspace
    // creation events / navigation state going forward.
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
        drawer: currentStateData.drawer,
        mainPanel: currentStateData.mainPanel,
      };

      const oldState = workspaceState;

      try {
        // Create new state with the real workspace ID
        workspaceState = createWorkspacePageState(currentWorkspaceId);

        // Immediately restore the preserved data to avoid UI flash
        workspaceState.updateState(preservedData);

        // Hydrate Redux so the selector-backed $workspace picks up the
        // workspace entity immediately during the optimistic→real transition.
        {
          const cachedWorkspace = selectWorkspaceById.select(appStore.state, currentWorkspaceId);
          if (cachedWorkspace) {
            appStore.dispatch(setWorkspaceEntity(cachedWorkspace));
          }
        }

        logger.info('Transitioned to real workspace state', {
          workspaceId: currentWorkspaceId,
          preservedDrawer: preservedData.drawer,
          preservedMainPanel: preservedData.mainPanel,
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
      // Dispatch workspaceUnmounted for the old workspace so sagas can clean up
      // (cancel agent loading, terminal loading, IPC listeners, etc.).
      // SvelteKit reuses the same component instance for same-route navigation
      // (/workspace/A → /workspace/B), so onDestroy does NOT fire — we must
      // dispatch the unmount action here during the workspace switch.
      if (previousWorkspaceId && previousWorkspaceId !== currentWorkspaceId) {
        appStore.dispatch(workspaceUnmounted(previousWorkspaceId));
      }

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

  // Mirror selectedNoteId into a writable store so the isNewWorkspaceSession selector
  // can subscribe to it reactively alongside Redux state.
  const selectedNoteIdStore = writable<string | null>(null);
  $effect(() => {
    selectedNoteIdStore.set(state?.mainPanel?.selectedNoteId ?? null);
  });
  const isNewWorkspaceSession$ = selectIsNewWorkspaceSession(workspaceIdStore, selectedNoteIdStore);

  // Restore scroll position after workspace state is created
  $effect(() => {
    if (workspaceState) {
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

  // Panel visibility — write via Redux actions, read via selector.select() in callbacks
  function setPanelFlag(key: keyof PanelVisibilityState, value: boolean) {
    appStore.dispatch(setPanelVisibility(workspaceId, key, value));
  }

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

  // Track if we're in a transition to prevent skeleton loaders
  let isInTransition = $derived(tabManagement.isInTransition);

  // Surface any workspace creation error captured before navigation.
  // Initial-agent activation and panel opening are owned by the daemon +
  // pre-persisted navigation state (drawer stashed by the initializer /
  // onboarding path), so the FE no longer performs any pending-agent
  // activation, session-storage sniffing, or drawer heuristics here.
  $effect(() => {
    const capturedWorkspaceId = $workspace?.id;
    if (!capturedWorkspaceId) return;
    const errorKey = `workspace:${capturedWorkspaceId}:creation-error`;
    const errorData = sessionStorage.getItem(errorKey);
    if (!errorData) return;
    try {
      const { error, timestamp } = JSON.parse(errorData);
      if (Date.now() - timestamp < 30000) {
        logger.error('[WorkspacePage] Workspace creation failed', { error });
        toast.error(m.workspace_page_createFailed_error({ error }), {
          duration: 10000,
          description: m.workspace_page_createFailedRetry_description(),
        });
      }
    } catch (e) {
      logger.error('[WorkspacePage] Failed to parse error data', e);
    } finally {
      sessionStorage.removeItem(errorKey);
    }
  });

  // Agent loading is now handled by the agent-loading-saga (triggered on workspaceMounted).

  // Terminal management is handled through agent sessions
  // Terminals are created and managed as part of agent interactions

  // File tracking initialization is handled by workspaceAgentsSaga on workspace mount.

  // Monitor file tracking store's main panel view for commit and diff navigation
  $effect(() => {
    const mainPanelView = $ftMainPanelView$;
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
      appStore.dispatch(ftClearMainPanelView());
    } else if (mainPanelView?.type === 'diff' && mainPanelView.change && workspaceState) {
      logger.info('[WorkspacePage] Navigating to diff view from file tracking store', {
        change: mainPanelView.change,
      });

      // Use openDiff to properly add to navigation history
      workspaceState.openDiff(mainPanelView.change);
    }
  });

  function handleFileRenamed(oldPath: string, newPath: string) {
    logger.info('onFileRenamed callback received in +page.svelte', {
      oldPath,
      newPath,
      hasWorkspaceState: !!workspaceState,
      hasHandleFileRenamed: typeof workspaceState?.handleFileRenamed === 'function',
    });
    try {
      workspaceState?.handleFileRenamed(oldPath, newPath);
    } catch (error) {
      logger.error('Error calling handleFileRenamed', error as Error);
    }
  }

  function handleCreateFile(folderPath: string, fileName?: string) {
    if (!$workspace?.id) return;
    createFileFolderPath = folderPath;
    if (fileName) {
      // Inline creation from the file tree — skip the dialog
      handleCreateFileConfirm(fileName);
      return;
    }
    // Open the dialog for manual entry
    createFileDialogOpen = true;
  }

  function handleCreateFileConfirm(fileName: string) {
    dispatchCreateFileRequest($workspace, createFileFolderPath, fileName, appStore.dispatch);
  }

  $effect(() => {
    const pending = $pendingCommandPaletteAction$;
    if (!pending) return;
    if (pending.workspaceId !== workspaceId) return;
    if (pending.type !== 'create-file') return;

    handleCommandPaletteCreateFile($workspace, (folderPath) => handleCreateFile(folderPath));
    appStore.dispatch(commandPaletteActionConsumed(workspaceId));
  });

  function handleCreateNote() {
    if (!$workspace?.id) return;
    appStore.dispatch(createNoteRequested($workspace.id));
  }

  // ============================================================================
  // Close handlers + workspace-level event wiring
  // ============================================================================

  useCloseHandlers({
    get workspaceId() {
      return workspaceId;
    },
    get workspaceState() {
      return workspaceState;
    },
  });

  /**
   * Create a new agent (used by keyboard shortcuts and UI buttons)
   */
  async function handleCreateAgent(agentType?: string) {
    if (!$workspace) return;
    appStore.dispatch(createAgentRequested($workspace.id, agentType));
  }

  /**
   * Create a new agent with a specific specialist configuration
   * @param specialistId - The ID of the specialist to use, or null for default agent
   */
  async function handleCreateAgentWithSpecialist(specialistId: string | null) {
    if (!$workspace) return;
    appStore.dispatch(createAgentWithSpecialistRequested($workspace.id, specialistId));
  }

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
    // Note: Cmd+B sidebar toggle is handled by appStore.dispatch(toggleSidebar())
    // in use-panel-shortcuts.svelte.ts
    onOpenAgentOverview: () => {
      // Open the Agent Overview panel tab
      const layoutManager = getPanelLayoutManager(workspaceId);
      layoutManager.openTab({
        type: 'agent-overview',
        title: m.layout_tabTypes_agentOverview_title(),
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
      appStore.dispatch(setSidebarActiveTab(workspaceId, 'files'));
    },
    onFocusGit: () => {
      // Switch to changes tab in TabbedSidebar
      appStore.dispatch(setSidebarActiveTab(workspaceId, 'changes'));
    },
    onFocusNotes: () => {
      // Switch to notes tab in TabbedSidebar
      appStore.dispatch(setSidebarActiveTab(workspaceId, 'notes'));
    },
    onFocusActivity: () => {
      // Switch to agents tab in TabbedSidebar (Activity tab was removed)
      appStore.dispatch(setSidebarActiveTab(workspaceId, 'agents'));
    },
    onMaximizePanel: () => {
      // Toggle maximize: hide sidebar and dock for focus mode
      const state = appStore.state;
      const isMaximized =
        !selectPanelVisibilityFlag.select(state, workspaceId, 'showNavigationRail') &&
        !selectPanelVisibilityFlag.select(state, workspaceId, 'showWorkspaceDock');
      if (isMaximized) {
        // Restore
        setPanelFlag('showNavigationRail', true);
        setPanelFlag('showWorkspaceDock', true);
      } else {
        // Maximize
        setPanelFlag('showNavigationRail', false);
        setPanelFlag('showWorkspaceDock', false);
      }
    },
    onLayoutFocus: () => {
      // Focus mode: hide sidebar and dock, maximize main content
      setPanelFlag('showNavigationRail', false);
      setPanelFlag('showWorkspaceDock', false);
    },
    onLayoutSplit: () => {
      // Split view: show sidebar and main content, no dock
      setPanelFlag('showNavigationRail', true);
      setPanelFlag('showWorkspaceDock', false);
    },
    onLayoutFull: () => {
      // Full layout: show everything
      setPanelFlag('showNavigationRail', true);
      setPanelFlag('showWorkspaceDock', true);
    },
  });

  // ============================================================================
  // Cleanup
  // ============================================================================

  onDestroy(async () => {
    logger.debug('Starting workspace page cleanup', { workspaceId });

    // Dispatch workspaceUnmounted so sagas can clean up (cancel agent loading,
    // terminal loading, spec panel, window event watchers for this workspace).
    if (workspaceId) {
      appStore.dispatch(workspaceUnmounted(workspaceId));
    }

    // Cancel any pending loads
    workspaceLoader.clearLoadingState();

    // Flush any pending undo-able agent deletions (permanently delete them now)
    const flushDeletionsAction = flushPendingAgentDeletionsRequested(workspaceId);
    appStore.dispatch(flushDeletionsAction);
    await flushDeletionsAction.promise;

    // Clear workspace state reference
    workspaceState = null;

    // Clear all local state
    appStore.dispatch(setAgents(workspaceId, []));
    appStore.dispatch(setAgentsLoaded(workspaceId, false));

    // Dispose all managed resources (timers, intervals, etc.)
    cleanupManager.dispose();

    // Note: file tracking Redux state handles its own cleanup internally

    logger.debug('Workspace page cleaned up', { workspaceId });
  });
</script>

<!-- ============================================================================
     Template - Using WorkspaceLayout with snippets
     ============================================================================ -->

<svelte:head>
  <title>{isOnboarding || showOnboarding ? m.workspace_page_newSpace_title() : $workspace?.title || m.workspace_page_space_title()}</title>
</svelte:head>

<!-- Sidebar Snippet -->
{#snippet sidebarContent()}
  {#if showOnboarding || isCreatingWorkspace}
    <!-- Empty sidebar during onboarding and workspace creation -->
    <div class="flex items-center flex-none w-full"></div>
  {:else if !$workspace || isCreatingWorkspace}
    {#if isCreatingWorkspace || isInTransition}
      <!-- Blank panel while creating new workspace or during transition -->
      <div class="w-full h-full"></div>
    {:else if workspaceLoader.loadError}
      <!-- Terminal load failure — blank panel; main content shows the not-found state -->
      <div class="w-full h-full"></div>
    {:else}
      <!-- Show skeleton for normal loading -->
      <SidebarSkeleton />
    {/if}
  {:else}
    <div
      class="h-full"
      style={isFreshCreation
        ? 'animation: slideInFromLeft 500ms cubic-bezier(0.16, 1, 0.3, 1) 200ms forwards; opacity: 0;'
        : ''}
    >
      <MultiSelectTabbedSidebar
        workspaceId={$workspace?.id || workspaceId}
        onCreateNote={handleCreateNote}
        onCreateFile={handleCreateFile}
        onFileRenamed={handleFileRenamed}
        onAcceptChanges={() => workspaceState?.openAcceptChanges()}
        isNewWorkspaceSession={$isNewWorkspaceSession$}
        onCreateAgent={handleCreateAgent}
        onCreateAgentWithSpecialist={handleCreateAgentWithSpecialist}
      />
    </div>
  {/if}
{/snippet}

<!-- Main Content Snippet -->
{#snippet mainContent()}
  <div class="h-full w-full relative">
    {#if showOnboarding}
      <OnboardingPage
        {isOnboarding}
        fadingOut={onboardingFadingOut}
        onHoldActiveChange={(active) => (onboardingHoldActive = active)}
        onFadingOutChange={(fading) => (onboardingFadingOut = fading)}
      />
    {/if}
    {#if !showOnboarding || onboardingFadingOut}
      {#if !$workspace || isCreatingWorkspace}
        {#if workspaceLoader.loadError && !isCreatingWorkspace}
          <ResourceNotFound
            kind={workspaceLoader.loadError.kind}
            resourceLabel={m.workspace_page_workspaceResource_label()}
            resourceId={workspaceId}
            detail={workspaceLoader.loadError.kind === 'error'
              ? workspaceLoader.loadError.message
              : undefined}
            onGoHome={() => navigateToRoute('/')}
          />
        {:else}
          <ContentSkeleton />
        {/if}
      {:else}
        <div
          class="h-full w-full absolute inset-0"
          style={isFreshCreation
            ? 'animation: fadeInContent 600ms cubic-bezier(0.16, 1, 0.3, 1) 250ms forwards; opacity: 0;'
            : ''}
        >
          <!-- Panel-based layout when using TabbedSidebar -->
          <PanelLayout
            workspaceId={$workspace?.id || workspaceId}
            onCreateAgent={handleCreateAgent}
            onCreateAgentWithSpecialist={handleCreateAgentWithSpecialist}
            onCreateNote={handleCreateNote}
          />
        </div>
      {/if}
    {/if}
  </div>
{/snippet}

<!-- Terminal Overlay Snippet -->
{#snippet terminalOverlayContent()}
  <QuakeTerminalOverlay workspaceId={WorkspaceId($workspace?.id || workspaceId)} />
{/snippet}

<!-- Modals Snippet -->
{#snippet modalsContent()}
  <WorkspaceModals workspace={$workspace ?? null} showPRCreator={false} />
  <InputDialog
    bind:open={createFileDialogOpen}
    title={m.workspace_page_createFile_title()}
    description={m.workspace_page_createFile_description()}
    placeholder={m.workspace_page_createFile_placeholder()}
    confirmLabel={m.workspace_page_create_label()}
    onConfirm={handleCreateFileConfirm}
  />
{/snippet}

<!-- Always render WorkspaceLayout — sidebar starts collapsed during onboarding -->
<div class="h-full w-full">
  <WorkspaceLayout
    sidebar={sidebarContent}
    content={mainContent}
    terminalOverlay={terminalOverlayContent}
    modals={modalsContent}
    sidebarSide={$sidebarSide$}
    startCollapsed={isOnboarding}
  />
</div>

<style>
  :global {
    @keyframes slideInFromLeft {
      from {
        opacity: 0;
        transform: translateX(-30px);
      }
      to {
        opacity: 1;
        transform: translateX(0);
      }
    }

    @keyframes fadeInContent {
      from {
        opacity: 0;
        transform: translateY(8px) scale(0.995);
        filter: blur(2px);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
        filter: blur(0);
      }
    }

    @keyframes slideDownTabBar {
      from {
        opacity: 0;
        transform: translateY(-100%);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @keyframes collapseOut {
      0% {
        opacity: 1;
        max-height: 100vh;
        transform: translateY(0) scale(1);
        filter: blur(0);
      }
      40% {
        opacity: 0.5;
        max-height: 60vh;
        transform: translateY(-16px) scale(0.99);
        filter: blur(0);
      }
      100% {
        opacity: 0;
        max-height: 0;
        transform: translateY(-40px) scale(0.97);
        filter: blur(4px);
      }
    }

    .onboarding-collapse-out {
      animation: collapseOut 500ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
      overflow: hidden;
      pointer-events: none;
      transform-origin: top center;
    }
  }
</style>
