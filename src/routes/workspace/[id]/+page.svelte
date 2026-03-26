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
  import { writable } from 'svelte/store';

  import type { AgentSession } from '$shared/types';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { toast } from 'svelte-sonner';

  // New unified state management
  import { createUnifiedWorkspaceState } from '$features/workspace/workspace-unified-state.svelte';
  import {
    useCloseHandlers,
    usePanelActions,
    usePanelShortcuts,
    useSidebarState,
    useTaskDelegationHandlers,
    useTabManagement,
    useWorkspaceLoader,
  } from './composables';
  import {
    dispatchCreateFileRequest,
    handleCommandPaletteCreateFile,
  } from './composables/create-file-command';

  // Performance optimization
  import { CleanupManager } from '$features/optimization/memory-manager';

  // Stores
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import { agentService } from '$features/agent/agent.service'; // Keep for backward compat
  import { gitStore } from '$features/git/git.store.svelte';
  import { fileTrackingStore } from '$features/file-tracking/file-tracking.store.svelte';
  import {
    selectPanelVisibilityFlag,
    selectWorkspaceById,
  } from '$lib/store/slices/workspace/workspace-selectors';
  import {
    setActiveWorkspaceId,
    setPanelVisibility,
    setWorkspaceEntity,
    type PanelVisibilityState,
  } from '$lib/store/slices/workspace/workspace-slice';

  import { workspaceStorageManager } from '$features/workspace/workspace-storage-manager';

  import {
    markAsViewed,
    clearCurrentlyViewed,
    markNoteRead,
    createNoteRequested,
  } from '$lib/store/slices/note-read-tracking/note-read-tracking-slice';
  import { workspaceUnmounted } from '$lib/store/slices/workspace-lifecycle/workspace-lifecycle-slice';
  import { getTransientUIStore } from '$features/workspace/transient-ui-state.store.svelte';
  import { track, setAnalyticsContextProvider, getFileExtension } from '$lib/services/analytics';
  import { layoutSettings } from '$features/layout/layout-settings.svelte';
  import { getDispatch } from '$lib/store/utils/utils';

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

  // Utils
  import { createLogger } from '$lib/utils/client-logger';
  import { transitionMCPWorkspace } from '$lib/api/mcp-client';
  import { SPEC_NOTE_ID } from '$shared/constants/notes';

  import { getReduxStore } from '$lib/store/redux-dispatch-bridge';
  import {
    addAgent,
    createAgentRequested,
    createAgentWithSpecialistRequested,
    delegateTaskRequested,
    markAgentRecentlyCreated as markAgentRecentlyCreatedAction,
    setAgents,
    setAgentsLoaded,
    setInitialAgentConfig,
    clearInitialAgentConfig,
    setInitialAgentConfigProcessed,
    setInitialAgentId,
  } from '$lib/store/slices/workspace-agents/workspace-agents-slice';
  import {
    selectInitialAgentConfig,
    selectInitialAgentConfigProcessed,
    selectInitialAgentId,
    selectAllWorkspaceAgents,
    selectIsNewlyCreatedWorkspace,
  } from '$lib/store/slices/workspace-agents/workspace-agents-selectors';
  import { createTerminalRequested } from '$lib/store/slices/terminals/terminals-slice';
  import MultiSelectTabbedSidebar from '$lib/components/workspace/MultiSelectTabbedSidebar.svelte';

  const logger = createLogger('workspace-page');

  // ============================================================================
  // Core State
  // ============================================================================

  const dispatch = getDispatch();

  // Create unified state for this workspace
  // @ts-expect-error - Svelte 5 rune scoping issue
  let workspaceState = $state(null);
  // @ts-expect-error - Svelte 5 rune scoping issue
  let stateDisposing = $state(false);
  // @ts-expect-error - Svelte 5 rune scoping issue
  let previousWorkspaceId = $state(null);
  // Draft prompt to pre-fill in agent input without sending
  // @ts-expect-error - Svelte 5 rune scoping issue
  let draftPrompt = $state<string | null>(null);

  // Create file dialog state
  // @ts-expect-error - Svelte 5 rune scoping issue
  let createFileDialogOpen = $state(false);
  let createFileFolderPath = '';

  /**
   * Initialize a new workspace state for the given ID, pre-populating data from the store
   * to avoid a flash of empty/skeleton UI. Used by both the initial load and transition paths.
   *
   * Sets workspaceData on the state AND hydrates Redux so the selector-backed
   * safeWorkspace has data on the first render frame. The workspace loader's
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
    // Read from Redux first, fall back to sessionStorage for page reloads
    const pendingConfig = selectInitialAgentConfig.select(getReduxStore().getState(), wsId);
    const pendingAgentKey = `workspace:${wsId}:initial-agent-pending`;
    const sessionData = sessionStorage.getItem(pendingAgentKey);
    const hasInitialAgent = !!pendingConfig || !!sessionData;

    // Hydrate Redux from sessionStorage on reload if needed
    if (!pendingConfig && sessionData) {
      try {
        const parsed = JSON.parse(sessionData);
        dispatch(setInitialAgentConfig(wsId, parsed));
      } catch {
        /* ignore parse errors */
      }
    }

    if (hasInitialAgent) {
      logger.info('Detected newly created workspace', { workspaceId: wsId });
      // isNewlyCreatedWorkspace is now derived from Redux initialAgentConfig
    }

    // Hydrate Redux immediately so the selector-backed safeWorkspace has
    // data on the very first render frame (before the workspace loader runs).
    if (cachedWorkspace) {
      dispatch(setWorkspaceEntity(cachedWorkspace));
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

  // Reactive writable store that mirrors workspaceId so the Redux selector
  // re-evaluates whenever the route param changes.
  const workspaceIdStore = writable(workspaceId);
  $effect(() => {
    workspaceIdStore.set(workspaceId);
  });

  // Redux-backed workspace entity selector.  Called at component init time
  // (top-level script) with a Readable<string> so it stays reactive to both
  // workspaceId changes AND Redux state updates.
  const workspaceFromRedux = selectWorkspaceById(workspaceIdStore);

  // Reactive readable selector for isNewlyCreatedWorkspace.  Using the readable
  // form (called at component init) ensures the value updates when Redux state
  // changes (e.g. when clearInitialAgentConfig is dispatched), unlike a one-shot
  // `.select()` call which would only snapshot the value at render time.
  const isNewlyCreatedWorkspaceStore = selectIsNewlyCreatedWorkspace(workspaceIdStore);

  // Track if we're in the process of creating a workspace (including optimistic phase)
  let isCreatingWorkspace = $derived(
    workspaceId === 'new' || workspaceId?.startsWith('optimistic-'),
  );

  $effect(() => {
    if (workspaceId) {
      dispatch(setActiveWorkspaceId(workspaceId));
    }
  });

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

        // Hydrate Redux so the selector-backed safeWorkspace picks up the
        // workspace entity immediately during the optimistic→real transition.
        {
          const cachedWorkspace = workspaceStore.findById(WorkspaceId(currentWorkspaceId));
          if (cachedWorkspace) {
            dispatch(setWorkspaceEntity(cachedWorkspace));
          }
        }

        // Check if this is a newly created workspace by looking for initial agent config
        // Read from Redux first, fall back to sessionStorage for page reloads
        const pendingConfig = selectInitialAgentConfig.select(
          getReduxStore().getState(),
          currentWorkspaceId,
        );
        const pendingAgentKey = `workspace:${currentWorkspaceId}:initial-agent-pending`;
        const sessionData = sessionStorage.getItem(pendingAgentKey);
        const hasInitialAgent = !!pendingConfig || !!sessionData;

        // Hydrate Redux from sessionStorage on reload if needed
        if (!pendingConfig && sessionData) {
          try {
            const parsed = JSON.parse(sessionData);
            dispatch(setInitialAgentConfig(currentWorkspaceId, parsed));
          } catch {
            /* ignore parse errors */
          }
        }

        if (hasInitialAgent) {
          logger.info('Detected newly created workspace during transition', {
            workspaceId: currentWorkspaceId,
          });
          // isNewlyCreatedWorkspace is now derived from Redux initialAgentConfig
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
      // Dispatch workspaceUnmounted for the old workspace so sagas can clean up
      // (cancel agent loading, terminal loading, IPC listeners, etc.).
      // SvelteKit reuses the same component instance for same-route navigation
      // (/workspace/A → /workspace/B), so onDestroy does NOT fire — we must
      // dispatch the unmount action here during the workspace switch.
      if (previousWorkspaceId && previousWorkspaceId !== currentWorkspaceId) {
        dispatch(workspaceUnmounted(previousWorkspaceId));
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

  // Workspace entity backed by Redux.  The selector reacts to both workspaceId
  // changes (via workspaceIdStore) and Redux state updates, eliminating the
  // previous $state / $effect / Object.assign dance.
  let safeWorkspace: any = $derived($workspaceFromRedux ?? null);

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

  // Panel visibility — write via Redux actions, read via selector.select() in callbacks
  function setPanelFlag(key: keyof PanelVisibilityState, value: boolean) {
    dispatch(setPanelVisibility(workspaceId, key, value));
  }

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

  // Check for optimistic initial agent on mount and transitions
  $effect(() => {
    // Capture workspace ID and workspace reference at the start to avoid race conditions
    // during async execution where safeWorkspace could become null or change
    const capturedWorkspaceId = safeWorkspace?.id;
    const capturedWorkspace = safeWorkspace;

    // Read initialAgentConfigProcessed with untrack to avoid creating a reactive dependency
    // that would cause the effect to re-run when we set it to true
    const alreadyProcessed = untrack(() =>
      capturedWorkspaceId
        ? selectInitialAgentConfigProcessed.select(getReduxStore().getState(), capturedWorkspaceId)
        : false,
    );

    if (capturedWorkspaceId && !alreadyProcessed) {
      dispatch(setInitialAgentConfigProcessed(capturedWorkspaceId, true));

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
      // Read from Redux first, fall back to sessionStorage for page reloads
      const reduxConfig = selectInitialAgentConfig.select(
        getReduxStore().getState(),
        capturedWorkspaceId,
      );
      const pendingAgentKey = `workspace:${capturedWorkspaceId}:initial-agent-pending`;
      const pendingAgentData = sessionStorage.getItem(pendingAgentKey);

      // Also check for regular agent config (in case of page reload after migration)
      const agentConfigKey = `workspace:${capturedWorkspaceId}:agent-config`;
      const agentConfigData = sessionStorage.getItem(agentConfigKey);

      if (reduxConfig || pendingAgentData || agentConfigData) {
        try {
          let agentId: string | undefined, config: any, timestamp: number | undefined;

          if (reduxConfig) {
            // Prefer Redux state (set during workspace creation, avoids serialization round-trip)
            agentId = reduxConfig.agentId;
            config = reduxConfig.config;
            timestamp = reduxConfig.timestamp;
          } else if (pendingAgentData) {
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

            const currentInitialAgentId = selectInitialAgentId.select(
              getReduxStore().getState(),
              capturedWorkspaceId,
            );

            if (currentInitialAgentId !== (agentId ?? null)) {
              dispatch(setInitialAgentId(capturedWorkspaceId, agentId ?? null));
            }

            // Mark this agent as recently created so the drawer doesn't close
            if (agentId) {
              dispatch(markAgentRecentlyCreatedAction(capturedWorkspaceId, agentId));
            }

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
                const currentAgents = selectAllWorkspaceAgents.select(
                  getReduxStore().getState(),
                  capturedWorkspaceId,
                );

                if (!currentAgents.find((a: AgentSession) => a?.id === agentId)) {
                  dispatch(addAgent(capturedWorkspaceId, existingSession));
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
                  .activateInitialAgent(agentId as string, capturedWorkspace, () =>
                    agentService.restoreSession(agentId as string, capturedWorkspace),
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
                      const currentAgents = selectAllWorkspaceAgents.select(
                        getReduxStore().getState(),
                        capturedWorkspaceId,
                      );

                      if (!currentAgents.find((a: AgentSession) => a?.id === agentId)) {
                        dispatch(addAgent(capturedWorkspaceId, session));
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
                      // The agent-loading-saga will handle restoring this agent
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
              window.dispatchEvent(
                new CustomEvent('workspace:show-agent', { detail: { agentId } }),
              );

              // For spec-writer agents in new workspaces, the spec panel will be
              // opened dynamically (with a slide-in animation) once spec generation
              // begins. See the specPanelSlideIn effect below.
            }

            // Cleanup pending marker once handled (non-optimistic only)
            if (!capturedWorkspaceId.startsWith('optimistic-')) {
              dispatch(clearInitialAgentConfig(capturedWorkspaceId));
              sessionStorage.removeItem(pendingAgentKey);
            }
          } else {
            // Only clean up if it's too old
            dispatch(clearInitialAgentConfig(capturedWorkspaceId));
            sessionStorage.removeItem(pendingAgentKey);
          }
        } catch (e) {
          logger.error('[WorkspacePage] Failed to parse pending agent data', e);
          dispatch(clearInitialAgentConfig(capturedWorkspaceId));
          sessionStorage.removeItem(pendingAgentKey);
        }
      }
    }
  });

  // Agent loading is now handled by the agent-loading-saga (triggered on workspaceMounted).

  // Terminal management is handled through agent sessions
  // Terminals are created and managed as part of agent interactions

  // File tracking initialization is handled by workspaceAgentsSaga on workspace mount.

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
      dispatch(markAsViewed(selectedNoteId));
    } else {
      // No note is being viewed in the main panel
      dispatch(clearCurrentlyViewed());
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

  function handleCreateFileConfirm(fileName: string) {
    dispatchCreateFileRequest(safeWorkspace, createFileFolderPath, fileName, dispatch);
  }

  $effect(() => {
    const handleNewFileCommand = () => {
      handleCommandPaletteCreateFile(safeWorkspace, (folderPath) => handleCreateFile(folderPath));
    };

    window.addEventListener('app:new-file', handleNewFileCommand);

    return () => {
      window.removeEventListener('app:new-file', handleNewFileCommand);
    };
  });

  async function handleOpenNote(noteId: string) {
    if (workspaceState) {
      logger.debug('[WorkspacePage] handleOpenNote called', { noteId });
      await workspaceState.openNote(noteId);

      // Mark note as read when opened (await to ensure persistence before refresh)
      if (safeWorkspace?.id) {
        dispatch(markNoteRead(safeWorkspace.id, noteId));
      }
    }
  }

  function handleCreateNote() {
    if (!safeWorkspace?.id) return;
    dispatch(createNoteRequested(safeWorkspace.id));
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

  async function handleDelegateTask(taskText: string, openAgent?: boolean): Promise<string | null> {
    if (!safeWorkspace) return null;
    dispatch(delegateTaskRequested(safeWorkspace.id, taskText, openAgent));
    return null;
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
    markAgentRecentlyCreated: (agentId: string) => {
      const wsId = safeWorkspace?.id || workspaceId;
      if (wsId) {
        dispatch(markAgentRecentlyCreatedAction(wsId, agentId));
      }
    },
    onDraftPromptSet: (prompt) => {
      draftPrompt = prompt;
    },
  });

  function openAgent(agentId: string) {
    panelActions.openAgent(agentId);
  }

  function openTerminal(terminalId: string) {
    panelActions.openTerminal(terminalId);
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
    if (!safeWorkspace) return;
    dispatch(createAgentRequested(safeWorkspace.id, agentType));
  }

  /**
   * Create a new agent with a specific specialist configuration
   * @param specialistId - The ID of the specialist to use, or null for default agent
   */
  async function handleCreateAgentWithSpecialist(specialistId: string | null) {
    if (!safeWorkspace) return;
    dispatch(createAgentWithSpecialistRequested(safeWorkspace.id, specialistId));
  }

  /**
   * Create a new terminal (used by keyboard shortcuts and UI buttons)
   */
  async function handleCreateTerminal() {
    if (!safeWorkspace) return;
    dispatch(createTerminalRequested(safeWorkspace.id));
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
    // Note: Cmd+B sidebar toggle is handled by dispatch(toggleSidebar())
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
      const state = getReduxStore().getState();
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
  // Workspace Creation
  // ============================================================================

  // ============================================================================
  // Cleanup
  // ============================================================================

  onDestroy(async () => {
    logger.debug('Starting workspace page cleanup', { workspaceId });

    // Dispatch workspaceUnmounted so sagas can clean up (cancel agent loading,
    // terminal loading, spec panel, window event watchers for this workspace).
    if (workspaceId) {
      dispatch(workspaceUnmounted(workspaceId));
    }

    // Cancel any pending loads
    workspaceLoader.clearLoadingState();

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
    dispatch(setAgents(workspaceId, []));
    dispatch(setAgentsLoaded(workspaceId, false));

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
      isNewWorkspaceSession={$isNewlyCreatedWorkspaceStore &&
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
      loading={false}
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
