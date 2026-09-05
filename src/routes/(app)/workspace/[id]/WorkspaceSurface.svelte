<script lang="ts">
  /**
   * Workspace Detail Page - Unified State Version
   *
   * Complete rewrite using the new unified state management system.
   * No URL state, no backward compatibility, clean implementation.
   */

  import { onMount, onDestroy, untrack } from 'svelte';
  import { writable } from 'svelte/store';

  import { WorkspaceId } from '$shared/types/branded-ids';
  import { toast } from 'svelte-sonner';

  import { createWorkspacePageState } from './composables/workspace-page-state.svelte';
  import { useCloseHandlers, usePanelShortcuts, useTabManagement } from './composables';
  import {
    dispatchCreateFileRequest,
    handleCommandPaletteCreateFile,
  } from './composables/create-file-command';
  import { commandPaletteActionConsumed } from '$store/renderer/slices/app-layout/app-layout-slice';
  import { selectPendingCommandPaletteAction } from '$store/renderer/slices/app-layout/app-layout-selectors';

  // Performance optimization
  import { CleanupManager } from '$features/optimization/memory-manager';

  import { selectMainPanelView } from '$store/renderer/slices/changes/changes-selectors';
  import { clearMainPanelView as ftClearMainPanelView } from '$store/renderer/slices/changes/changes-slice';
  import {
    selectWorkspaceIsEmpty,
    selectIsNewWorkspaceSession,
  } from '$store/renderer/slices/workspace/workspace-selectors';
  import {
    selectWorkspaceLoadResult,
    selectWorkspaceLoadState,
  } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-selectors';
  import { workspaceLoadRequested } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
  import {
    selectPanelVisibilityFlag,
    selectSidebarSide,
  } from '$store/renderer/slices/ui-layout/ui-layout-selectors';
  import { loadWorkspacesRequested } from '$store/renderer/slices/workspace/workspace-slice';
  import {
    setPanelVisibility,
    type PanelVisibilityState,
  } from '$store/renderer/slices/ui-layout/ui-layout-slice';

  import { createNoteRequested } from '$store/renderer/slices/note-read-tracking/note-read-tracking-slice';
  // Components
  import WorkspaceLayout from '$lib/components/workspace/WorkspaceLayout.svelte';
  import WorkspaceModals from '$lib/components/workspace/WorkspaceModals.svelte';
  import WorkspaceRouteContextProvider from '$lib/components/workspace/WorkspaceRouteContextProvider.svelte';
  import SidebarSkeleton from '$lib/components/workspace/SidebarSkeleton.svelte';
  import ContentSkeleton from '$lib/components/workspace/ContentSkeleton.svelte';
  import ResourceNotFound from '$lib/components/common/ResourceNotFound.svelte';
  import WorkspaceSurfaceLoadBoundary from './WorkspaceSurfaceLoadBoundary.svelte';
  import InputDialog from '$lib/components/modals/InputDialog.svelte';
  import QuakeTerminalOverlay from '$lib/components/terminal/QuakeTerminalOverlay.svelte';
  import { PanelLayout } from '$lib/components/layout/panel-system';
  import { getPanelLayoutManager } from '$features/layout/panel-layout-adapter';

  import { selectPanelLayoutRoot } from '$store/renderer/slices/panel-layout/panel-layout-selectors';

  // Utils
  import { createLogger } from '$lib/utils/client-logger';
  import { navigateToFirstWorkspace } from '$lib/utils/workspace-navigation';

  import { setSidebarActiveTab } from '$store/renderer/slices/transient-ui/transient-ui-slice';
  import {
    createAgentRequested,
    createAgentWithSpecialistRequested,
  } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import MultiSelectTabbedSidebar from '$lib/components/workspace/MultiSelectTabbedSidebar.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';

  // eslint-disable-next-line intent/no-component-async-data-fetch -- Constructs a logger; no domain data is fetched.
  const logger = createLogger('workspace-page');

  interface Props {
    workspaceId: string;
    active?: boolean;
  }

  let { workspaceId, active = true }: Props = $props();
  const surfaceWorkspaceId = $derived(
    workspaceId && workspaceId !== 'new' ? WorkspaceId(workspaceId) : null,
  );
  const panelLayoutId = $derived(workspaceId);
  const panelLayoutIdStore = writable(untrack(() => workspaceId));
  $effect(() => panelLayoutIdStore.set(workspaceId));
  const panelLayoutRoot$ = selectPanelLayoutRoot(panelLayoutIdStore);

  // ============================================================================
  // Core State
  // ============================================================================

  const sidebarSide$ = selectSidebarSide();

  // Create unified state for this workspace
  let workspaceState = $state<ReturnType<typeof createWorkspacePageState> | null>(null);
  let stateDisposing = $state(false);
  let previousWorkspaceId = $state<string | null>(null);
  // Create file dialog state
  let createFileDialogOpen = $state(false);
  let createFileFolderPath = '';
  let surfaceElement = $state<HTMLElement | null>(null);

  /**
   * Initialize a new workspace state for the given ID, pre-populating data from the store
   * to avoid a flash of empty/skeleton UI. Used by both the initial load and transition paths.
   *
   * Sets presentation data from the canonical Redux entity on the first frame.
   * Backend admission and publication are owned by workspaceLoadSaga.
   */
  function initializeWorkspaceState(wsId: string): ReturnType<typeof createWorkspacePageState> {
    const newState = createWorkspacePageState(wsId);

    // Pre-populate workspace data from the store to avoid blank state.
    // This is a synchronous Map lookup — cheap and eliminates the skeleton flash
    // when the workspace is already cached (the common case during workspace navigation).
    const cachedWorkspace = selectWorkspaceLoadResult.select(appStore.state, wsId);
    if (cachedWorkspace) {
      newState.updateState({
        workspaceData: cachedWorkspace,
      });
    }

    // Batch state updates with untrack to prevent effect cascades
    untrack(() => {
      workspaceState = newState;
      previousWorkspaceId = wsId;
    });

    return newState;
  }

  // Reactive writable store that carries the route-provided workspaceId so the
  // Redux selector re-evaluates whenever the route param changes.
  // svelte-ignore state_referenced_locally - intentional initial capture; the $effect below syncs later changes
  const workspaceIdStore = writable(workspaceId);
  $effect(() => {
    workspaceIdStore.set(workspaceId);
  });

  // Redux-backed workspace result selector. Called at component init time
  // (top-level script) with a Readable<string> so it stays reactive to both
  // workspaceId changes AND Redux state updates.
  const workspace = selectWorkspaceLoadResult(workspaceIdStore);
  const workspaceLoadState = selectWorkspaceLoadState(workspaceIdStore);

  $effect(() => {
    const currentWorkspaceId = workspaceId;
    if (
      !active ||
      !currentWorkspaceId ||
      currentWorkspaceId === 'undefined' ||
      currentWorkspaceId === 'new'
    ) {
      return;
    }
    appStore.dispatch(workspaceLoadRequested(currentWorkspaceId));
  });

  // Transient signal: command palette → create-file dialog
  const pendingCommandPaletteAction$ = selectPendingCommandPaletteAction();

  // File tracking state from Redux
  const ftMainPanelView$ = selectMainPanelView();

  // Optimistic workspace IDs use the loading presentation until the daemon
  // publishes the durable workspace identity.
  let isCreatingWorkspace = $derived(workspaceId?.startsWith('optimistic-'));

  // Viewing a workspace does NOT clear its unread attention: the flag is
  // daemon-derived from per-agent seen markers (PROTOCOL §5.1) and clears only
  // as each unread agent conversation is read (`agent.markSeen`, driven by the
  // per-agent unread-tracking triggers). Explicit "mark as read" gestures call
  // `workspace.markSeen` (mark every agent seen) from the sidebar cards.

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
    if (!active) return;
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

      // Use untrack to prevent this state mutation from triggering effect re-runs
      untrack(() => {
        previousWorkspaceId = currentWorkspaceId;
      });

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
  let pageState: any = $derived(workspaceState?.state);

  // Mirror selectedNoteId into a writable store so the isNewWorkspaceSession selector
  // can subscribe to it reactively alongside Redux state.
  const selectedNoteIdStore = writable<string | null>(null);
  $effect(() => {
    selectedNoteIdStore.set(pageState?.mainPanel?.selectedNoteId ?? null);
  });
  const isNewWorkspaceSession$ = selectIsNewWorkspaceSession(workspaceIdStore, selectedNoteIdStore);

  // Restore scroll position after workspace state is created
  $effect(() => {
    if (active && workspaceState) {
      // Restore scroll position after initial load
      // Use a delay to ensure content is rendered
      // Capture reference to avoid stale closure if workspaceState becomes null
      const currentState = workspaceState;
      const timeout = setTimeout(() => {
        // Check if the state is still valid before calling
        if (currentState) {
          currentState.restoreInitialScrollPosition();
        }
      }, 200);
      return () => clearTimeout(timeout);
    }
  });

  // Debug workspace state changes
  $effect(() => {
    if (workspace === undefined && pageState?.workspaceData === undefined && workspaceState) {
      logger.warn('[WorkspacePage] Workspace became undefined', {
        hasState: !!pageState,
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
    if (!active) return;
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
    if (!active) return;
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
    // eslint-disable-next-line intent/no-component-async-data-fetch -- Dispatches the existing Redux-backed file command.
    dispatchCreateFileRequest($workspace, createFileFolderPath, fileName, appStore.dispatch);
  }

  $effect(() => {
    if (!active) return;
    const pending = $pendingCommandPaletteAction$;
    if (!pending) return;
    if (pending.workspaceId !== workspaceId) return;
    if (pending.type !== 'create-file') return;

    // eslint-disable-next-line intent/no-component-async-data-fetch -- Routes a local command-palette callback; no fetch occurs.
    handleCommandPaletteCreateFile($workspace, (folderPath) => handleCreateFile(folderPath));
    appStore.dispatch(commandPaletteActionConsumed(workspaceId));
  });

  function handleCreateNote(panelId?: string) {
    if (!$workspace?.id) return;
    appStore.dispatch(createNoteRequested($workspace.id, { panelLayoutId, panelId }));
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
  async function handleCreateAgent(agentType?: string, panelId?: string) {
    if (!$workspace) return;
    appStore.dispatch(createAgentRequested($workspace.id, agentType, { panelId }));
  }

  /**
   * Create a new agent with a specific specialist configuration
   * @param specialistId - The ID of the specialist to use, or null for default agent
   */
  async function handleCreateAgentWithSpecialist(specialistId: string | null, panelId?: string) {
    if (!$workspace) return;
    appStore.dispatch(createAgentWithSpecialistRequested($workspace.id, specialistId, { panelId }));
  }

  // ============================================================================
  // Panel Shortcuts (Keyboard Navigation)
  // ============================================================================

  // Helper to find and focus the first focusable element in a container
  function focusFirstInContainer(selector: string) {
    const container = (surfaceElement as HTMLElement | null)?.querySelector(selector);
    if (!container) return;
    const focusable = container.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    focusable?.focus();
  }

  usePanelShortcuts({
    get enabled() {
      return active;
    },
    // Cmd+B is registered once by the global workspace shortcut router.
    onOpenAgentOverview: () => {
      // Open the Agent Overview panel tab
      const layoutManager = getPanelLayoutManager(panelLayoutId);
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
      if (!pageState?.drawer?.open) {
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

  onDestroy(() => {
    logger.debug('Starting workspace page cleanup', { workspaceId });

    // Clear workspace state reference
    workspaceState = null;

    // Dispose all managed resources (timers, intervals, etc.)
    cleanupManager.dispose();

    // Note: file tracking Redux state handles its own cleanup internally

    logger.debug('Workspace page cleaned up', { workspaceId });
  });
</script>

<!-- ============================================================================
     Template - Using WorkspaceLayout with snippets
     ============================================================================ -->

<!-- Sidebar Snippet -->
{#snippet sidebarContent()}
  {#if !active}
    <div class="h-full w-full"></div>
  {:else if !$workspace || isCreatingWorkspace}
    {#if isCreatingWorkspace || isInTransition}
      <!-- Blank panel while creating new workspace or during transition -->
      <div class="w-full h-full"></div>
    {:else if $workspaceLoadState.error}
      <!-- Terminal load failure — blank panel; main content shows the not-found state -->
      <div class="w-full h-full"></div>
    {:else}
      <!-- Show skeleton for normal loading -->
      <SidebarSkeleton />
    {/if}
  {:else}
    <div class="h-full">
      <MultiSelectTabbedSidebar
        workspaceId={$workspace?.id || workspaceId}
        {panelLayoutId}
        onCreateNote={handleCreateNote}
        onCreateFile={handleCreateFile}
        onFileRenamed={handleFileRenamed}
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
    {#if !$workspace || isCreatingWorkspace}
      {#if $workspaceLoadState.error && !isCreatingWorkspace}
        <ResourceNotFound
          kind={$workspaceLoadState.error.kind}
          resourceLabel={m.workspace_page_workspaceResource_label()}
          resourceId={workspaceId}
          detail={$workspaceLoadState.error.kind === 'error'
            ? $workspaceLoadState.error.message
            : undefined}
          onNavigateAway={() => void navigateToFirstWorkspace()}
        />
      {:else}
        <ContentSkeleton panelCount={1} layoutRoot={$panelLayoutRoot$} />
      {/if}
    {:else}
      <div class="h-full w-full absolute inset-0">
        <!-- Panel-based layout when using TabbedSidebar -->
        <PanelLayout
          workspaceId={$workspace?.id || workspaceId}
          layoutId={panelLayoutId}
          {active}
          onCreateAgent={(panelId) => handleCreateAgent(undefined, panelId)}
          onCreateAgentWithSpecialist={handleCreateAgentWithSpecialist}
          onCreateNote={handleCreateNote}
        />
      </div>
    {/if}
  </div>
{/snippet}

<!-- Terminal Overlay Snippet -->
{#snippet terminalOverlayContent()}
  {#if active}
    <QuakeTerminalOverlay
      workspaceId={WorkspaceId($workspace?.id || workspaceId)}
      showDockWhenClosed={false}
    />
  {/if}
{/snippet}

<!-- Modals Snippet -->
{#snippet modalsContent()}
  {#if active}
    <WorkspaceModals workspace={$workspace ?? null} showPRCreator={false} />
    <InputDialog
      bind:open={createFileDialogOpen}
      title={m.workspace_page_createFile_title()}
      description={m.workspace_page_createFile_description()}
      placeholder={m.workspace_page_createFile_placeholder()}
      confirmLabel={m.workspace_page_create_label()}
      onConfirm={handleCreateFileConfirm}
    />
  {/if}
{/snippet}

<!-- Always render WorkspaceLayout for concrete workspace routes. -->
{#key surfaceWorkspaceId}
  <WorkspaceRouteContextProvider workspaceId={surfaceWorkspaceId}>
    <div
      bind:this={surfaceElement}
      class="h-full min-h-0 w-full overflow-hidden"
      data-workspace-surface={workspaceId}
      data-loading={!$workspace}
    >
      <WorkspaceSurfaceLoadBoundary
        loadError={isCreatingWorkspace ? null : $workspaceLoadState.error}
        resourceLabel={m.workspace_page_workspaceResource_label()}
        resourceId={workspaceId}
        onNavigateAway={() => void navigateToFirstWorkspace()}
      >
        {#snippet children()}
          <WorkspaceLayout
            {active}
            sidebar={sidebarContent}
            content={mainContent}
            terminalOverlay={terminalOverlayContent}
            modals={modalsContent}
            sidebarSide={$sidebarSide$}
            sidebarStorageKey={`workspace-left-panel-width:${workspaceId}`}
            sidebarExpandedStorageKey={`workspace-left-panel-expanded-width:${workspaceId}`}
          />
        {/snippet}
      </WorkspaceSurfaceLoadBoundary>
    </div>
  </WorkspaceRouteContextProvider>
{/key}
