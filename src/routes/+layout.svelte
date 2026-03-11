<script lang="ts">
  import '../app.css';

  import { afterNavigate, beforeNavigate, goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { sessionStoreData } from '$features/agent/browser';
  import { track, trackGitOp, isGitOp, setAnalyticsContextProvider } from '$lib/services/analytics';
  import type { AnalyticsUIContext } from '$lib/services/analytics';
  import { navigateToSettings } from '$lib/utils/workspace-navigation';

  import { autoUpdateStore } from '$features/auto-update/auto-update.store.svelte';
  import { releaseNotesStore } from '$features/auto-update/release-notes.store.svelte';
  import { githubAuthStore } from '$features/github-auth/renderer/github-auth.store.svelte';
  import type { GitHubAuthRequiredEvent } from '$features/github-auth/types';
  import { globalCleanupService } from '$features/memory/browser/global-cleanup.service';
  import { paletteStore } from '$features/palette/palette.store.svelte';
  import {
    createSpacesSwitcherKeyboard,
    type SpacesSwitcherKeyboard,
  } from '$features/workspace/spaces-switcher-keyboard.svelte';
  import SpacesSwitcherOverlay from '$features/workspace/SpacesSwitcherOverlay.svelte';
  import { workspaceRecencyStore } from '$features/workspace/workspace-recency.store.svelte';
  import { workspaceTabManager } from '$features/workspace/workspace-tab-manager.svelte';
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import AuggieSetupGate from '$lib/components/AuggieSetupGate.svelte';
  import CommandPalette from '$lib/components/CommandPalette.svelte';
  import DebugPanel from '$lib/components/debug/DebugPanel.svelte';
  import ErrorBoundary from '$lib/components/ErrorBoundary.svelte';
  import GitCredentialsModal from '$lib/components/GitCredentialsModal.svelte';
  import GitHubAuthModal from '$lib/components/GitHubAuthModal.svelte';
  import KeyboardShortcutsCheatSheet from '$lib/components/layout/KeyboardShortcutsCheatSheet.svelte';
  import WindowTitleBar from '$lib/components/layout/WindowTitleBar.svelte';
  import ReleaseNotesModal from '$lib/components/ReleaseNotesModal.svelte';
  import Toast from '$lib/components/ui/toast/Toast.svelte';
  import { TooltipProvider } from '$lib/components/ui/tooltip';
  import LinkTooltip from '$lib/components/ui/tooltip/LinkTooltip.svelte';
  import UpdateDownloadIndicator from '$lib/components/UpdateDownloadIndicator.svelte';
  import { invoke, listenSync } from '$lib/electron-bridge';
  import { dispatch } from '$lib/store/redux-dispatch-bridge';
  import { toggleCheatSheet } from '$lib/store/slices/shortcuts-cheatsheet/shortcuts-cheatsheet-slice';
  import { toggleLineWrapping } from '$lib/store/slices/editor-settings/editor-settings-slice';
  import { featureCodesStore } from '$lib/stores/feature-codes.store.svelte';
  import { modelStore } from '$lib/stores/model.store.svelte';
  import { initPipStore } from '$lib/stores/pip.store.svelte';
  import {
    toggleTerminalOverlay,
    openTerminalOverlay,
  } from '$lib/store/slices/terminal-overlay/terminal-overlay-slice';
  import { createLogger } from '$lib/utils/client-logger';
  import { preloadDiffHighlighter } from '$lib/utils/diff-highlighter-preloader';
  import { isFocusInEditableElement, KeyboardShortcutManager } from '$lib/utils/keyboardShortcuts';
  import { configureMonacoWorkers } from '$lib/utils/monaco-workers';
  import { themeManager } from '$lib/utils/theme';
  import { WorkspaceStatus, type AgentSession, type Workspace } from '$shared/types';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { onMount, untrack } from 'svelte';

  import { createLinkTooltipHandler } from '$features/navigation/link-handler';
  import { registerAllTabTypes } from '$features/layout/tab-types/register-all';
  import {
    getPanelLayoutManager,
    hasPanelLayoutManager,
  } from '$features/layout/panel-layout-manager.svelte';
  import { IPC_CHANNELS } from '$shared/ipc-registry';
  import RootQuakeTerminalOverlay, {
    ROOT_WORKSPACE_ID,
  } from '$lib/components/terminal/RootQuakeTerminalOverlay.svelte';
  import FeatureCodeDialog from '$lib/components/modals/FeatureCodeDialog.svelte';
  import NewSpaceModal from '$lib/components/modals/NewSpaceModal.svelte';
  import type { InitialRepoInfo } from '$lib/components/workspace/CompactWorkspaceInitializer.svelte';
  import { SidebarNav, sidebarNavStore, SidebarPanel } from '$lib/components/layout/sidebar-nav';
  import Store from '$lib/store/components/Store.svelte';

  const logger = createLogger('+layout');

  // Register all tab types early
  // This must happen before any panels are rendered
  registerAllTabTypes();

  // Preload the diff highlighter early to avoid blocking when opening first diff
  // This runs during idle time and doesn't block the main thread
  if (typeof window !== 'undefined') {
    preloadDiffHighlighter();
  }

  // Initialize theme manager early to ensure theme is applied
  // The singleton will load and apply the saved theme on first import
  const _themeManagerInit = themeManager;

  // Import dev tools in development mode
  if (import.meta.env.DEV) {
    import('$lib/dev-tools')
      .then(() => {
        logger.info('Development tools loaded');
      })
      .catch(() => {
        // Dev tools failed to load - not critical
      });
  }

  // Initialize model store to ensure models are loaded
  // This ensures the modelStore singleton is created and loads models immediately
  const _modelStoreInit = modelStore;

  interface Props {
    children?: import('svelte').Snippet;
  }

  let { children }: Props = $props();

  // Configure Monaco Editor web workers for Electron + Vite
  if (typeof window !== 'undefined') {
    configureMonacoWorkers();
  }

  let agents: AgentSession[] = $state([]);
  let previousAgentsJson = $state('');
  let currentWorkspaceId = $derived($page.params.id as string | undefined);
  let isHome = $derived($page.route.id === '/');

  // Svelte 5: Use $derived for computed values from stores
  let workspaces = $derived(workspaceStore.items);
  let workspaceId = $derived(workspaceStore.current?.id || undefined);

  // PERF: Consolidated workspace sync effect - handles both tab syncing and cleanup
  // Merging these effects reduces re-renders when workspaces change
  let lastSyncedTabId = '';
  let lastWorkspaceIds = '';
  $effect(() => {
    // Part 1: Sync workspace store with tab manager
    const currentTabId = workspaceTabManager.currentTabId;
    if (currentTabId && currentTabId !== lastSyncedTabId) {
      lastSyncedTabId = currentTabId;
      untrack(() => {
        if (currentTabId !== workspaceStore.current?.id) {
          workspaceStore.setCurrentWorkspace(WorkspaceId(currentTabId));
        }
      });
    }

    // Part 2: Clean up invalid tabs when workspaces change
    // IMPORTANT: Don't cleanup if workspaces is empty or still loading
    // This prevents closing all tabs during initial load or when a reload fails
    const isLoading = workspaceStore.loading;
    if (workspaces.length === 0 || isLoading) {
      // Skip cleanup when workspaces list is empty or loading
      // This prevents closing tabs during:
      // - Initial load before workspaces are fetched
      // - Network errors that return empty results
      // - HMR refreshes that temporarily clear the store
      return;
    }

    const validIds = workspaces
      .filter((w) => w.status !== 'Archived' && w.status !== 'Deleted')
      .map((w) => w.id);
    const currentIds = validIds.sort().join(',');
    if (currentIds !== lastWorkspaceIds) {
      lastWorkspaceIds = currentIds;
      untrack(() => {
        workspaceTabManager.cleanupInvalidTabs(new Set(validIds));
      });
    }
  });

  // Send open workspace tabs to main process for Window menu
  $effect(() => {
    const tabOrder = workspaceTabManager.tabOrder;
    invoke(IPC_CHANNELS.WINDOW.SET_OPEN_WORKSPACE_TABS, {
      workspaceIds: [...tabOrder],
    }).catch(() => {
      // Silently ignore errors
    });
  });

  // Terminal overlay state is now persisted per-workspace via Redux terminal-overlay slice
  // No need to close it here - the store handles saving/restoring state when switching workspaces

  // Analytics context provider for non-workspace routes
  // Workspace pages set their own provider with full UI context; this handles home, settings, agent routes
  $effect(() => {
    const routeId = $page.route.id;
    const pathname = $page.url.pathname;

    // Skip if on workspace page - it sets its own context provider with full UI context
    if (pathname.startsWith('/workspace/') && !pathname.startsWith('/workspace/creating')) {
      return;
    }

    // Derive route name from current route
    const routeName: AnalyticsUIContext['routeName'] =
      routeId === '/'
        ? 'home'
        : pathname.startsWith('/settings')
          ? 'settings'
          : pathname.startsWith('/agent/')
            ? 'agent'
            : pathname.startsWith('/workspace/creating')
              ? 'creating'
              : null;

    // Set analytics context for non-workspace routes
    setAnalyticsContextProvider(() => ({
      routeName,
      mainPanelType: null,
      sidebarActiveTab: null,
      workspaceTitle: null,
    }));

    return () => {
      // Clear context when leaving this route
      setAnalyticsContextProvider(null);
    };
  });

  // Expose goto function globally for new windows
  if (typeof window !== 'undefined') {
    (window as any).__app_goto = goto;
  }

  // Subscribe to agent service state changes
  $effect(() => {
    // Use sessionStoreData directly - it's a simple Svelte writable that's always available
    // This avoids timing issues with agentService initialization
    const unsubscribe = sessionStoreData.subscribe((state: any) => {
      // Use untrack to prevent reactive updates from triggering the effect again
      untrack(() => {
        // Get agents from state
        const newAgents = state.sessions || [];
        const newAgentsJson = JSON.stringify(newAgents);
        if (newAgentsJson !== previousAgentsJson) {
          // Filter out any invalid agents, terminal IDs, and background agents from the dock
          agents = newAgents.filter((a: any) => {
            // Filter out invalid agents
            if (!a || !a.id) return false;
            // Filter out terminal IDs - they should not appear in the agents list
            if (String(a.id).startsWith('terminal-')) return false;
            // Filter out background agents from the dock
            if (a.metadata?.isBackground || a.isBackground) return false;
            return true;
          });

          const filteredCount = newAgents.length - agents.length;
          if (filteredCount > 0) {
            logger.debug(`Filtered out ${filteredCount} agents (invalid or background)`);
          }
          previousAgentsJson = newAgentsJson;
        }
      });
    });
    return () => unsubscribe();
  });

  // Track last non-settings path for cmd+, toggle behavior
  let lastNonSettingsPath = $state('/');

  // Cmd hold cheat sheet state
  let cmdHoldTimer: ReturnType<typeof setTimeout> | null = null;
  const CMD_HOLD_DELAY = 500; // half second
  $effect(() => {
    const currentPath = $page.url.pathname;
    if (!currentPath.startsWith('/settings')) {
      lastNonSettingsPath = currentPath;
    }
  });

  let paletteShortcuts: KeyboardShortcutManager | null = null;

  // Spaces switcher (Cmd+L to cycle through workspaces like Cmd+Tab)
  let spacesSwitcher: SpacesSwitcherKeyboard | null = $state(null);

  // Resolve the switcher's workspace ID ordering to live store data so that
  // titles, taskStats, agentSummary, PR status, etc. stay current.
  // The keyboard manager stores only IDs; we look up live objects here.
  const switcherLiveWorkspaces = $derived.by(() => {
    if (!spacesSwitcher) return [];
    const storeItems = workspaceStore.items;
    const byId = new Map(storeItems.map((w) => [w.id, w]));
    return spacesSwitcher.workspaceIds
      .map((id) => byId.get(id))
      .filter((w): w is Workspace => w != null);
  });

  let showGitHubAuthModal = $state(false);
  let pendingGitHubAuth = $state<GitHubAuthRequiredEvent | null>(null);
  let githubAuthModalKey = $state(0);

  // Keychain access modal state (for macOS keychain consent)
  let showKeychainAccessModal = $state(false);
  let keychainWarningData = $state<{
    requestId: string;
    service?: string;
    account?: string;
  } | null>(null);

  // Feature code dialog state
  let showFeatureCodeDialog = $state(false);

  // New Workspace modal state
  let showNewSpaceModal = $state(false);
  let newSpaceInitialRepo = $state<InitialRepoInfo | undefined>(undefined);

  // Git credentials modal state (for git push/pull auth errors)
  let showGitCredentialsModal = $state(false);
  let gitCredentialsError = $state<{
    workspaceId?: string;
    message: string;
    operation: string;
    command?: string;
    cwd?: string;
    /** The raw error output from git (stderr) for debugging */
    rawError?: string;
  } | null>(null);
  // Track workspaces that have already shown the credentials modal this session
  // to avoid repeatedly showing it for the same workspace
  const shownCredentialsModalForWorkspaces = new Set<string>();

  onMount(() => {
    featureCodesStore.init();

    // Hide the splash screen from app.html now that Svelte has mounted
    const splash = document.getElementById('splash');
    if (splash) {
      splash.classList.add('mounted');
      // Remove from DOM after fade-out transition completes
      splash.addEventListener('transitionend', () => splash.remove(), { once: true });
    }

    // Remove the static drag region from app.html now that Svelte's own drag region is active
    document.getElementById('app-drag-region')?.remove();

    // ===== PERF: Animation pause when tab hidden =====
    // Adds/removes 'animations-paused' class on body to pause CSS animations
    // when the page is not visible, reducing GPU usage
    const handleVisibilityChange = () => {
      if (document.hidden) {
        document.body.classList.add('animations-paused');
      } else {
        document.body.classList.remove('animations-paused');
      }
    };
    // Set initial state
    if (document.hidden) {
      document.body.classList.add('animations-paused');
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // ===== Link tooltip on hover =====
    // Attach tooltip handler to document.body so hovering over any <a> in the
    // app shows the link tooltip (URL + Cmd+Click hint).
    const cleanupLinkTooltip = createLinkTooltipHandler(document.body);

    // Initialize global cleanup service
    globalCleanupService.initialize();
    githubAuthStore.initialize().catch((error) => {
      logger.warn('[+layout] Failed to initialize GitHub auth store', error);
    });

    // Initialize PiP store to listen for pip:opened and pip:closed events
    initPipStore();

    // Initialize release notes store to detect version changes and show release notes
    // We need to fetch the channel directly from main process since autoUpdateStore
    // hasn't loaded the user's preference yet at this point
    if (window.electronAPI) {
      (async () => {
        try {
          // Import dynamically to avoid the formatter removing unused imports
          const { autoUpdateClient } = await import('$features/auto-update/auto-update.client');

          // Get version and channel from main process
          const [versionResult, updateState] = await Promise.all([
            window.electronAPI.invoke('app:version', undefined),
            autoUpdateClient.getState().catch(() => null),
          ]);

          const currentVersion = versionResult?.data || 'unknown';
          const channel = updateState?.channel || 'stable';

          logger.info(
            `[+layout] Initializing release notes: version=${currentVersion}, channel=${channel}`,
          );
          await releaseNotesStore.initialize(currentVersion, channel);
        } catch (e) {
          logger.warn('[+layout] Failed to initialize release notes store', e);
        }
      })();
    }

    // Recovery mechanism for router corruption after HMR reloads
    // When Vite triggers a page reload (e.g., after .svelte-kit/generated files change),
    // the SvelteKit router can get into a bad state where no routes are found.
    // This listener detects navigation failures and triggers a full page reload to recover.
    let navigationFailureCount = 0;
    const MAX_NAVIGATION_FAILURES = 2;

    const handleNavigationError = (event: CustomEvent) => {
      // Check if this is a "Not found" error (routeId is null)
      if (event.detail?.error?.message?.includes('Not found')) {
        navigationFailureCount++;
        logger.warn('[Layout] Navigation failure detected', {
          count: navigationFailureCount,
          error: event.detail?.error?.message,
        });

        if (navigationFailureCount >= MAX_NAVIGATION_FAILURES) {
          logger.info('[Layout] Multiple navigation failures - triggering recovery reload');
          navigationFailureCount = 0;
          // Use setTimeout to allow the current event to complete
          setTimeout(() => {
            window.location.reload();
          }, 100);
        }
      }
    };

    // Listen for SvelteKit navigation errors
    document.addEventListener('sveltekit:navigation-error', handleNavigationError as EventListener);

    // ThemeManager is already initialized and handles theme application
    // No need to manually apply theme here

    // Check for initial route from query parameter (used when opening new windows)
    const urlParams = new URLSearchParams(window.location.search);
    const initialRoute = urlParams.get('initialRoute');
    if (initialRoute) {
      // Navigate to the specified route
      goto(initialRoute)
        .then(() => {
          // Clear the query parameter from the URL without reloading
          const newUrl = new URL(window.location.href);
          newUrl.searchParams.delete('initialRoute');
          window.history.replaceState({}, '', newUrl.pathname + newUrl.hash);
        })
        .catch((err) => {
          logger.error('Failed to navigate to initial route', err);
        });
    }

    // Always load workspaces - the Header needs them for tabs regardless of current page
    const loadData = async () => {
      // Use requestIdleCallback to load workspaces when browser is idle
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(() => {
          workspaceStore.load().catch((err) => {
            logger.error('Failed to load workspaces', err);
          });
        });
      } else {
        // Fallback to setTimeout for browsers without requestIdleCallback
        setTimeout(() => {
          workspaceStore.load().catch((err) => {
            logger.error('Failed to load workspaces', err);
          });
        }, 100);
      }
    };

    loadData();

    // Ensure current workspace is set on initial load (direct navigation)
    try {
      const pathname = window.location?.pathname || '';
      const match = pathname.match(/^\/workspace\/([^/]+)/);
      if (match?.[1]) {
        const id = match[1];
        // Don't set workspace for 'new' page
        if (id === 'new') {
          workspaceStore.close();
        } else {
          // Open tab and set as current - use untrack to prevent loops
          untrack(() => {
            workspaceTabManager.openTab(id);
            if (!workspaceStore.current || workspaceStore.current.id !== id) {
              workspaceStore.setCurrentWorkspace(WorkspaceId(id));
            }
          });
        }
      }
    } catch {}

    // Listen for workspace updates
    // workspace:updated is the format from EventBus
    const unsubscribeWorkspaceColon = listenSync('workspace:updated', (event) => {
      logger.info('[+layout] Received workspace:updated event:', event.payload);
      const { workspaceId, changes } = event.payload as { workspaceId: string; changes: any };

      // Update the workspace in local state only (no API call)
      workspaceStore.updateLocalWorkspace(WorkspaceId(workspaceId), changes);
    });

    // Listen for background agent spawned events (for toast notifications)
    const setupBackgroundAgentListener = () => {
      if (typeof window !== 'undefined' && window.electronAPI) {
        window.electronAPI.on(
          'background-agent:spawned',
          (data: {
            workspaceId: string;
            agentId: string;
            taskTitle: string;
            agentType: string;
          }) => {
            logger.info('[+layout] Background agent spawned:', data);
            // Import toast dynamically to avoid SSR issues
            import('svelte-sonner')
              .then(({ toast }) => {
                // Find the workspace that spawned this agent
                const eventWorkspace = workspaceStore.items.find((w) => w.id === data.workspaceId);
                const currentWorkspace = workspaceStore.current;
                const workspaceTitle = eventWorkspace?.title || 'Space';

                // Only show "Open" action if event is from a different workspace
                const shouldShowOpenAction =
                  currentWorkspace && currentWorkspace.id !== data.workspaceId;

                const toastOptions: {
                  description: string;
                  duration: number;
                  action?: { label: string; onClick: () => Promise<void> };
                } = {
                  description: `Working on: ${data.taskTitle}`,
                  duration: 5000,
                };

                // Add "Open" action only if viewing a different workspace
                if (shouldShowOpenAction) {
                  toastOptions.action = {
                    label: 'Open',
                    onClick: async () => {
                      await goto(`/workspace/${data.workspaceId}`);
                    },
                  };
                }

                toast.info(`🤖 Task orchestrator started in "${workspaceTitle}"`, toastOptions);
              })
              .catch(() => {
                // Toast not available - not critical
              });
          },
        );
      }
    };

    setupBackgroundAgentListener();

    // Listen for git operation completed events (for cross-workspace toast notifications)
    let gitOpCompletedListenerId: string | null = null;
    const setupGitOpCompletedListener = () => {
      if (typeof window !== 'undefined' && window.electronAPI) {
        gitOpCompletedListenerId = window.electronAPI.on(
          'git:op-completed',
          (data: {
            operationId: string;
            workspaceId: string;
            operationType: 'commit' | 'push' | 'create-pr' | 'auto-commit';
            result?: {
              commitHash?: string;
              prNumber?: number;
              prUrl?: string;
              noChanges?: boolean;
              reason?: string;
            };
            metadata?: {
              message?: string;
              prTitle?: string;
              agentId?: string;
              agentName?: string;
            };
          }) => {
            logger.info('[+layout] Git operation completed', {
              operationId: data.operationId,
              workspaceId: data.workspaceId,
              operationType: data.operationType,
            });

            // Skip no-change commits (they're noise - nothing actually happened)
            if (
              (data.operationType === 'auto-commit' || data.operationType === 'commit') &&
              data.result?.noChanges
            ) {
              return;
            }

            // Import toast dynamically to avoid SSR issues
            import('svelte-sonner')
              .then(({ toast }) => {
                // Find the workspace where this operation happened
                const eventWorkspace = workspaceStore.items.find((w) => w.id === data.workspaceId);
                const currentWorkspace = workspaceStore.current;
                const workspaceName = eventWorkspace?.title || 'Space';

                // Build toast message based on operation type
                let message: string;
                switch (data.operationType) {
                  case 'commit':
                    message = `✅ Changes committed in "${workspaceName}"`;
                    break;
                  case 'push':
                    message = `✅ Changes pushed in "${workspaceName}"`;
                    break;
                  case 'create-pr':
                    message = data.result?.prNumber
                      ? `✅ PR #${data.result.prNumber} created in "${workspaceName}"`
                      : `✅ PR created in "${workspaceName}"`;
                    break;
                  case 'auto-commit':
                    message = `✅ Auto-committed in "${workspaceName}"`;
                    break;
                  default:
                    message = `✅ Git operation completed in "${workspaceName}"`;
                }

                // Only show "Open" action if event is from a different workspace
                const shouldShowOpenAction =
                  currentWorkspace && currentWorkspace.id !== data.workspaceId;

                const toastOptions: {
                  description?: string;
                  duration: number;
                  action?: { label: string; onClick: () => Promise<void> };
                } = {
                  duration: 5000,
                };

                // For PR creation, add description with PR title if available
                if (data.operationType === 'create-pr' && data.metadata?.prTitle) {
                  toastOptions.description = data.metadata.prTitle;
                }

                // Add "Open" action only if viewing a different workspace
                if (shouldShowOpenAction) {
                  toastOptions.action = {
                    label: 'Open',
                    onClick: async () => {
                      await goto(`/workspace/${data.workspaceId}`);
                    },
                  };
                }

                toast.success(message, toastOptions);
              })
              .catch(() => {
                // Toast not available - not critical
              });

            // Track agent-initiated git operations in analytics
            // Manual operations are tracked at their UI call sites (SidebarChangesPanel, AcceptChangesPanel, SidebarGitStatusBar)
            // so we only track here when agentId is present to avoid double-tracking
            if (data.metadata?.agentId) {
              const trigger = data.operationType === 'auto-commit' ? 'auto_commit' : 'agent';
              const op = data.operationType === 'auto-commit' ? 'commit' : data.operationType;
              if (isGitOp(op)) {
                trackGitOp(op, {
                  workspaceId: data.workspaceId,
                  success: true,
                  trigger,
                  agentId: data.metadata.agentId,
                });
              }
            }
          },
        );
      }
    };

    setupGitOpCompletedListener();

    // Listen for git operation failed events (for cross-workspace toast notifications)
    let gitOpFailedListenerId: string | null = null;
    const setupGitOpFailedListener = () => {
      if (typeof window !== 'undefined' && window.electronAPI) {
        gitOpFailedListenerId = window.electronAPI.on(
          'git:op-failed',
          (data: {
            operationId: string;
            workspaceId: string;
            operationType: 'commit' | 'push' | 'create-pr' | 'auto-commit';
            error: string;
            metadata?: {
              message?: string;
              prTitle?: string;
              agentId?: string;
              agentName?: string;
            };
          }) => {
            logger.info('[+layout] Git operation failed', {
              operationId: data.operationId,
              workspaceId: data.workspaceId,
              operationType: data.operationType,
            });

            // Skip toast for auto-commit hook failures - they have their own more specific toast
            // via the 'git:auto-commit-hook-failure' event
            if (
              data.operationType === 'auto-commit' &&
              (data.error.toLowerCase().includes('pre-commit hook') ||
                data.error.toLowerCase().includes('hook') ||
                data.error.includes('woken to retry'))
            ) {
              logger.debug(
                '[+layout] Skipping toast for auto-commit hook failure (handled by git:auto-commit-hook-failure)',
              );
              return;
            }

            // Import toast dynamically to avoid SSR issues
            import('svelte-sonner')
              .then(({ toast }) => {
                // Find the workspace where this operation happened
                const eventWorkspace = workspaceStore.items.find((w) => w.id === data.workspaceId);
                const currentWorkspace = workspaceStore.current;
                const workspaceName = eventWorkspace?.title || 'Space';

                // Skip toast if user is already viewing the failing workspace
                // (SidebarChangesPanel shows its own contextual error toasts)
                // Exception: auto-commit failures always show a toast (no in-workspace equivalent)
                const isViewingFailingWorkspace =
                  currentWorkspace && currentWorkspace.id === data.workspaceId;
                if (isViewingFailingWorkspace && data.operationType !== 'auto-commit') {
                  return;
                }

                // Build error toast message based on operation type
                let message: string;
                switch (data.operationType) {
                  case 'commit':
                    message = `❌ Commit failed in "${workspaceName}"`;
                    break;
                  case 'push':
                    message = `❌ Push failed in "${workspaceName}"`;
                    break;
                  case 'create-pr':
                    message = `❌ PR creation failed in "${workspaceName}"`;
                    break;
                  case 'auto-commit':
                    message = `❌ Auto-commit failed in "${workspaceName}"`;
                    break;
                  default:
                    message = `❌ Git operation failed in "${workspaceName}"`;
                }

                const toastOptions: {
                  description: string;
                  duration: number;
                  action?: { label: string; onClick: () => Promise<void> };
                } = {
                  description: data.error,
                  duration: 10000, // Longer duration for errors
                };

                // Only show "Open" action if viewing a different workspace
                const shouldShowOpenAction =
                  currentWorkspace && currentWorkspace.id !== data.workspaceId;
                if (shouldShowOpenAction) {
                  toastOptions.action = {
                    label: 'Open',
                    onClick: async () => {
                      await goto(`/workspace/${data.workspaceId}`);
                    },
                  };
                }

                toast.error(message, toastOptions);
              })
              .catch(() => {
                // Toast not available - not critical
              });

            // Track agent-initiated git operation failures in analytics
            if (data.metadata?.agentId) {
              const trigger = data.operationType === 'auto-commit' ? 'auto_commit' : 'agent';
              const op = data.operationType === 'auto-commit' ? 'commit' : data.operationType;
              if (isGitOp(op)) {
                trackGitOp(op, {
                  workspaceId: data.workspaceId,
                  success: false,
                  trigger,
                  agentId: data.metadata.agentId,
                });
              }
            }
          },
        );
      }
    };

    setupGitOpFailedListener();

    const setupGitHubAuthListener = () => {
      if (typeof window !== 'undefined' && window.electronAPI) {
        window.electronAPI.on('github:auth-required', (data: GitHubAuthRequiredEvent) => {
          logger.warn('[+layout] GitHub authentication required:', data);
          pendingGitHubAuth = data;
          showGitHubAuthModal = true;
          githubAuthModalKey += 1;
        });
      }
    };

    setupGitHubAuthListener();

    // Listen for git authentication required events
    // Note: Git push/pull requires local credentials (SSH keys or credential manager).
    // GitHub API operations (PRs, repos) work through Augment's backend.
    const setupGitAuthListener = () => {
      if (typeof window !== 'undefined' && window.electronAPI) {
        window.electronAPI.on(
          'git:auth-required',
          (data: {
            workspaceId?: string;
            operation: string;
            remote?: string;
            message: string;
            command?: string;
            cwd?: string;
            rawError?: string;
          }) => {
            logger.warn('[+layout] Git credentials required:', data);

            // Only show the modal once per workspace per session
            // This prevents repeatedly showing the same modal for background git operations
            if (data.workspaceId && shownCredentialsModalForWorkspaces.has(data.workspaceId)) {
              logger.info(
                '[+layout] Skipping credentials modal - already shown for workspace:',
                data.workspaceId,
              );
              return;
            }

            // Mark this workspace as having shown the modal
            if (data.workspaceId) {
              shownCredentialsModalForWorkspaces.add(data.workspaceId);
            }

            // Show the git credentials modal with setup instructions and retry option
            gitCredentialsError = {
              workspaceId: data.workspaceId,
              message: data.message,
              operation: data.operation,
              command: data.command,
              cwd: data.cwd,
              rawError: data.rawError,
            };
            showGitCredentialsModal = true;
          },
        );
      }
    };

    setupGitAuthListener();

    // Listen for agent authentication required events (e.g., auggie login needed on remote)
    const setupAgentAuthListener = () => {
      if (typeof window !== 'undefined' && window.electronAPI) {
        window.electronAPI.on(
          'agent:auth-required',
          (data: {
            workspaceId?: string;
            agentId?: string;
            isRemote: boolean;
            host?: string;
            message: string;
          }) => {
            logger.warn('[+layout] Agent authentication required:', data);
            import('svelte-sonner')
              .then(({ toast }) => {
                toast.warning('Agent Authentication Required', {
                  description: data.message,
                  duration: 15000,
                  action: {
                    label: 'Open Terminal',
                    onClick: () => {
                      // Navigate to workspace terminal if we have a workspace ID
                      if (data.workspaceId) {
                        goto(`/workspace/${data.workspaceId}?panel=terminal`);
                      }
                    },
                  },
                });
              })
              .catch(() => {
                // Toast not available - not critical
              });
          },
        );
      }
    };

    setupAgentAuthListener();

    // Listen for agent plan-required events (e.g., enterprise user without Intent access)
    const setupAgentPlanRequiredListener = () => {
      if (typeof window !== 'undefined' && window.electronAPI) {
        window.electronAPI.on(
          'agent:plan-required',
          (data: { workspaceId?: string; agentId?: string; message: string; helpUrl?: string }) => {
            logger.warn('[+layout] Agent plan required:', data);
            import('svelte-sonner')
              .then(({ toast }) => {
                toast.error('Intent: Plan Upgrade Required', {
                  description: data.message,
                  duration: 20000,
                });
              })
              .catch(() => {
                // Toast not available - not critical
              });
          },
        );
      }
    };

    setupAgentPlanRequiredListener();

    // Listen for auto-commit pre-commit hook failure events
    const setupAutoCommitHookFailureListener = () => {
      if (typeof window !== 'undefined' && window.electronAPI) {
        window.electronAPI.on(
          'git:auto-commit-hook-failure',
          (data: {
            workspaceId: string;
            agentId: string;
            agentName?: string;
            status: 'waking-agent' | 'retries-exhausted';
            hookOutput: string;
            retryCount: number;
          }) => {
            import('svelte-sonner')
              .then(({ toast }) => {
                const name = data.agentName || 'Agent';
                if (data.status === 'waking-agent') {
                  toast.warning('Auto-commit: pre-commit hooks failed', {
                    description: `Asking ${name} to fix the issues (attempt ${data.retryCount})`,
                    duration: 8000,
                  });
                } else {
                  toast.error('Auto-commit failed: pre-commit hooks', {
                    description: `${name} couldn't fix the hook failures after ${data.retryCount} attempts. Please commit manually.`,
                    duration: 15000,
                  });
                }
              })
              .catch(() => {
                // Toast not available - not critical
              });
          },
        );
      }
    };

    setupAutoCommitHookFailureListener();

    // Listen for notification:show events to play sound in renderer
    const setupNotificationSoundListener = () => {
      if (typeof window !== 'undefined' && window.electronAPI) {
        window.electronAPI.on(
          'notification:show',
          async (data: { agentName: string; timestamp: string }) => {
            try {
              // Import stores and utilities dynamically to avoid SSR issues
              const { notificationSettingsStore } =
                await import('$lib/stores/notification-settings.store.svelte');
              const { playNotificationSound } = await import('$lib/utils/notification-sound');

              // Check if sound is enabled
              if (!notificationSettingsStore.soundEnabled) {
                logger.debug('[+layout] Notification sound disabled');
                return;
              }

              // Check if we should only play when unfocused
              if (notificationSettingsStore.soundOnlyWhenUnfocused && document.hasFocus()) {
                logger.debug('[+layout] Window focused, skipping notification sound');
                return;
              }

              // Play the notification sound
              await playNotificationSound(notificationSettingsStore.volume);
              logger.debug('[+layout] Played notification sound for agent:', data.agentName);
            } catch (error) {
              logger.error('[+layout] Failed to play notification sound:', error);
            }
          },
        );
      }
    };

    setupNotificationSoundListener();

    // Listen for notification:navigate events to navigate to the correct workspace on click
    const setupNotificationNavigateListener = () => {
      if (typeof window !== 'undefined' && window.electronAPI) {
        window.electronAPI.on('notification:navigate', (data: { workspaceId: string }) => {
          if (data?.workspaceId) {
            goto(`/workspace/${data.workspaceId}`);
          }
        });
      }
    };

    setupNotificationNavigateListener();

    // Listen for "up to date" notifications from auto-update (manual check)
    const setupAutoUpdateListener = () => {
      if (typeof window !== 'undefined' && window.electronAPI) {
        logger.info('[+layout] Setting up auto-update:up-to-date listener');
        window.electronAPI.on(
          'auto-update:up-to-date',
          (data: { version: string; isDev?: boolean }) => {
            logger.info('[+layout] App is up to date:', data);
            // If the update toast UI is already visible, don't show a duplicate toast here.
            if (autoUpdateStore.toastVisible) {
              logger.info('[+layout] Skipping up-to-date toast (update toast already visible)');
              return;
            }

            import('svelte-sonner')
              .then(({ toast }) => {
                const message = data.isDev
                  ? "You're running a development build"
                  : `You're running the latest version (${data.version})`;
                toast.success('Up to Date', {
                  description: message,
                  duration: 4000,
                });
              })
              .catch((err) => {
                logger.error('[+layout] Failed to show toast:', err);
              });
          },
        );
      } else {
        logger.warn('[+layout] electronAPI not available for auto-update listener');
      }
    };

    setupAutoUpdateListener();

    // Listen for navigation events from main process (e.g., menu items)
    const setupNavigateListener = () => {
      if (typeof window !== 'undefined' && window.electronAPI) {
        window.electronAPI.on('navigate', (path: string) => {
          logger.info('[+layout] Navigate event received:', path);
          // Intercept /?create=true to open the modal instead of navigating
          if (path === '/?create=true') {
            newSpaceInitialRepo = undefined;
            showNewSpaceModal = true;
            return;
          }
          goto(path);
        });
      }
    };

    setupNavigateListener();

    // Listen for navigate-to-settings from macOS menu (Cmd+,)
    const setupNavigateToSettingsListener = () => {
      if (typeof window !== 'undefined' && window.electronAPI) {
        window.electronAPI.on('navigate-to-settings', () => {
          logger.info('[+layout] Navigate to settings from menu');
          const isOnSettings = window.location.pathname.startsWith('/settings');
          if (isOnSettings) {
            goto(lastNonSettingsPath);
          } else {
            navigateToSettings();
          }
        });
      }
    };

    setupNavigateToSettingsListener();

    // Listen for menu events from main process (macOS menu bar)
    const setupMenuEventListeners = () => {
      if (typeof window !== 'undefined' && window.electronAPI) {
        // New Agent - dispatch event for workspace page to handle
        window.electronAPI.on('menu:new-agent', () => {
          logger.info('[+layout] New agent from menu');
          window.dispatchEvent(new CustomEvent('app:new-agent'));
        });

        // New Note - dispatch event for workspace page to handle
        window.electronAPI.on('menu:new-note', () => {
          logger.info('[+layout] New note from menu');
          window.dispatchEvent(new CustomEvent('app:new-note'));
        });

        // New Terminal - dispatch event for workspace page to handle
        window.electronAPI.on('menu:new-terminal', () => {
          logger.info('[+layout] New terminal from menu');
          window.dispatchEvent(new CustomEvent('app:new-terminal'));
        });

        // New Browser - open browser panel directly via panel layout manager
        window.electronAPI.on('menu:new-browser', () => {
          logger.info('[+layout] New browser from menu');
          const wsId = workspaceStore.current?.id;
          if (wsId && hasPanelLayoutManager(wsId)) {
            const manager = getPanelLayoutManager(wsId);
            manager.openBrowserPanel();
          }
        });

        // Browser open tab request from main process (agent wants to open a browser tab)
        window.electronAPI.on(
          'browser:open-tab',
          (data: { url: string; position?: 'adjacent' | 'replace' | 'same' }) => {
            logger.info('[+layout] Browser open tab request from main process', data);
            const wsId = workspaceStore.current?.id;
            if (wsId && hasPanelLayoutManager(wsId)) {
              const manager = getPanelLayoutManager(wsId);
              const { url, position = 'adjacent' } = data;

              if (position === 'replace') {
                // Find existing browser tab and update its URL, or create new if none exists
                const existingBrowserTab = manager.allOpenTabs.find((t) => t.type === 'browser');
                if (existingBrowserTab) {
                  manager.updateTabBrowserUrl(existingBrowserTab.id, url);
                  manager.setActiveTab(existingBrowserTab.id);
                  logger.info('[+layout] Replaced existing browser tab URL', {
                    tabId: existingBrowserTab.id,
                    url,
                  });
                } else {
                  manager.openBrowserPanel(url);
                }
              } else if (position === 'adjacent') {
                // Open in adjacent panel (or create split if needed)
                manager.openTabInAdjacentOrSplit({
                  type: 'browser',
                  title: 'Browser',
                  browserUrl: url,
                  closable: true,
                });
              } else {
                // 'same' - open in current/focused panel
                manager.openBrowserPanel(url);
              }
            }
          },
        );

        // Close Tab - close the active tab in the focused panel
        window.electronAPI.on('menu:close-tab', () => {
          logger.info('[+layout] Close tab from menu');
          const wsId = workspaceStore.current?.id;
          if (wsId && hasPanelLayoutManager(wsId)) {
            const manager = getPanelLayoutManager(wsId);
            manager.closeActiveTab();
          }
        });

        // Reopen Closed Tab - reopen the most recently closed tab
        window.electronAPI.on('menu:reopen-closed-tab', () => {
          logger.info('[+layout] Reopen closed tab from menu');
          const wsId = workspaceStore.current?.id;
          if (wsId && hasPanelLayoutManager(wsId)) {
            const manager = getPanelLayoutManager(wsId);
            manager.reopenClosedTab();
          }
        });

        // Select Previous Tab - switch to the previous tab in the focused panel
        window.electronAPI.on('menu:select-previous-tab', () => {
          logger.info('[+layout] Select previous tab from menu');
          const wsId = workspaceStore.current?.id;
          if (wsId && hasPanelLayoutManager(wsId)) {
            const manager = getPanelLayoutManager(wsId);
            manager.selectPreviousTab();
          }
        });

        // Select Next Tab - switch to the next tab in the focused panel
        window.electronAPI.on('menu:select-next-tab', () => {
          logger.info('[+layout] Select next tab from menu');
          const wsId = workspaceStore.current?.id;
          if (wsId && hasPanelLayoutManager(wsId)) {
            const manager = getPanelLayoutManager(wsId);
            manager.selectNextTab();
          }
        });

        // Zoom events - forwarded from main process when browser panel is focused
        // Dispatched as CustomEvents for the active EmbeddedBrowser to handle
        window.electronAPI.on('menu:zoom-in', () => {
          window.dispatchEvent(new CustomEvent('browser:zoom', { detail: { action: 'in' } }));
        });
        window.electronAPI.on('menu:zoom-out', () => {
          window.dispatchEvent(new CustomEvent('browser:zoom', { detail: { action: 'out' } }));
        });
        window.electronAPI.on('menu:reset-zoom', () => {
          window.dispatchEvent(new CustomEvent('browser:zoom', { detail: { action: 'reset' } }));
        });
      }
    };

    setupMenuEventListeners();

    // Register global palette shortcuts (config-driven later)
    paletteShortcuts = new KeyboardShortcutManager();
    const isMac =
      typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');
    const register = (opts: {
      key: string;
      meta?: boolean;
      ctrl?: boolean;
      shift?: boolean;
      alt?: boolean;
      description: string;
      skipInEditableElements?: boolean;
      global?: boolean;
      action: () => void;
    }) => {
      paletteShortcuts!.register({
        key: opts.key,
        meta: !!opts.meta,
        ctrl: !!opts.ctrl,
        shift: !!opts.shift,
        alt: !!opts.alt,
        description: opts.description,
        skipInEditableElements: opts.skipInEditableElements,
        global: opts.global,
        action: opts.action,
      });
    };
    const openCmd = () => paletteStore.open();
    const openFile = () => paletteStore.open();
    const openSearch = () => paletteStore.open();

    // Optionally register config-driven shortcut for opening the command palette
    const registerChord = (chord: string | undefined, description: string, action: () => void) => {
      if (!chord) return;
      try {
        const parts = chord.split('+');
        let meta = false,
          ctrl = false,
          shift = false;
        let key = '';
        for (const raw of parts) {
          const p = raw.trim().toLowerCase();
          if (p === 'cmdorctrl' || p === 'ctrlorcmd') {
            meta = isMac;
            ctrl = !isMac;
          } else if (p === 'cmd' || p === 'command' || p === 'meta') {
            meta = true;
          } else if (p === 'ctrl' || p === 'control') {
            ctrl = true;
          } else if (p === 'shift') {
            shift = true;
          } else if (p === 'alt' || p === 'option') {
            // KeyboardShortcutManager does not currently support alt
            // Ignore alt for now to avoid accidental conflicts
          } else if (!key) {
            key = p.length === 1 ? p : p[0];
          }
        }
        if (key) register({ key, meta, ctrl, shift, description, action });
      } catch (e) {
        logger.warn('[Layout] Failed to parse shortcut chord', { chord, error: e });
      }
    };

    // Fetch config shortcuts (non-blocking best-effort)
    (async () => {
      try {
        const shortcuts = await invoke<any>('config:get', { key: 'shortcuts' });
        if (shortcuts && typeof shortcuts === 'object') {
          registerChord(shortcuts['command-palette'], 'Open Command Palette (Config)', openCmd);
        }
      } catch (e) {
        // Ignore if not available (e.g., web build)
      }
    })();
    // Cmd+K (Mac) / Ctrl+K (Win/Linux) -> open command palette
    // Note: On macOS, Ctrl+K is an Emacs shortcut (kill line) and should NOT open command palette
    const openCommandPalette = () => {
      paletteStore.toggle();
    };
    register({
      key: 'k',
      meta: true,
      description: 'Command Palette (Mac)',
      action: openCommandPalette,
    });
    if (!isMac) {
      register({
        key: 'k',
        ctrl: true,
        description: 'Command Palette (Win/Linux)',
        action: openCommandPalette,
      });
    }
    // Cmd+O (Mac) / Ctrl+O (Win/Linux) -> toggle all spaces sidebar panel
    const toggleAllSpaces = () => {
      sidebarNavStore.togglePanel('all-workspaces');
    };
    register({
      key: 'o',
      meta: true,
      description: 'Toggle All Spaces (Mac)',
      action: toggleAllSpaces,
    });
    if (!isMac) {
      register({
        key: 'o',
        ctrl: true,
        description: 'Toggle All Spaces (Win/Linux)',
        action: toggleAllSpaces,
      });
    }
    // Cmd+T (Mac) / Ctrl+T (Win/Linux) - New Tab (creates new agent, like browser new tab)
    const newTab = () => {
      // Dispatch event for workspace page to handle (creates new agent)
      window.dispatchEvent(new CustomEvent('workspace:new-tab'));
    };
    register({ key: 't', meta: true, description: 'New Tab (Mac)', action: newTab });
    if (!isMac) {
      register({
        key: 't',
        ctrl: true,
        description: 'New Tab (Win/Linux)',
        action: newTab,
      });
    }
    // F12 - Go to Definition (dispatches event for Monaco editor to handle)
    const goToDefinition = () => {
      window.dispatchEvent(new CustomEvent('editor:go-to-definition'));
    };
    register({ key: 'F12', description: 'Go to Definition', action: goToDefinition });
    // Cmd+P (Mac) / Ctrl+P (Win/Linux)
    // Note: On macOS, Ctrl+P is an Emacs shortcut (previous line) and should NOT open quick open
    register({ key: 'p', meta: true, description: 'Quick Open (Mac)', action: openFile });
    if (!isMac) {
      register({ key: 'p', ctrl: true, description: 'Quick Open (Win/Linux)', action: openFile });
    }
    // Cmd+Shift+P (Mac) / Ctrl+Shift+P (Win/Linux) -> command palette (VS Code-style)
    register({
      key: 'p',
      meta: isMac,
      ctrl: !isMac,
      shift: true,
      description: 'Command Palette (Alt)',
      action: openCmd,
    });
    // Cmd+G (Mac) / Ctrl+G (Win/Linux) -> Go to Line
    const openGoToLine = () => paletteStore.openGoToLine();
    register({ key: 'g', meta: true, description: 'Go to Line (Mac)', action: openGoToLine });
    if (!isMac) {
      register({
        key: 'g',
        ctrl: true,
        description: 'Go to Line (Win/Linux)',
        action: openGoToLine,
      });
    }
    // Cmd+Shift+F (Mac) / Ctrl+Shift+F (Win/Linux) -> search
    register({
      key: 'f',
      meta: isMac,
      ctrl: !isMac,
      shift: true,
      description: 'Search in files',
      action: openSearch,
    });
    // Alt/Option + Z -> toggle word wrap (like VS Code)
    register({
      key: 'z',
      alt: true,
      description: 'Toggle Word Wrap',
      action: () => dispatch(toggleLineWrapping()),
    });
    // Ctrl+` -> toggle terminal overlay (matches VS Code behavior - Ctrl on all platforms including Mac)
    // In workspace pages, this is also handled by useDockNavigation, but we register it globally
    // so it works on non-workspace pages too (home, settings, etc.)
    const toggleTerminal = () => {
      // Check if we're on a workspace page by looking at the current URL
      // We can't rely on workspaceId from the store because it might not be cleared yet
      const isOnWorkspacePage = $page.url.pathname.startsWith('/workspace/');
      const terminalContextId = isOnWorkspacePage && workspaceId ? workspaceId : ROOT_WORKSPACE_ID;
      dispatch(toggleTerminalOverlay(terminalContextId));
    };
    register({
      key: '`',
      ctrl: true, // Ctrl on all platforms (including Mac) to match VS Code
      global: true, // Must work even when an input is focused
      description: 'Toggle Terminal Overlay',
      action: toggleTerminal,
    });
    // NOTE: Cmd+` is intentionally NOT registered here — it is the native macOS shortcut
    // for cycling between application windows and must not be intercepted.
    // Use Ctrl+` or Cmd+J instead to toggle the terminal overlay.
    // Cmd+J (Mac) / Ctrl+J (Win/Linux) -> toggle Quake-style terminal overlay (alternate)
    // Works both in workspace pages (uses workspaceId) and non-workspace pages (uses ROOT_WORKSPACE_ID)
    register({
      key: 'j',
      meta: isMac,
      ctrl: !isMac,
      description: 'Toggle Terminal Overlay',
      action: toggleTerminal,
    });
    // Cmd+, (Mac) / Ctrl+, (Win/Linux) -> toggle settings
    register({
      key: ',',
      meta: isMac,
      ctrl: !isMac,
      description: 'Toggle Settings',
      action: () => {
        const isOnSettings = $page.url.pathname.startsWith('/settings');
        if (isOnSettings) {
          goto(lastNonSettingsPath);
        } else {
          navigateToSettings();
        }
      },
    });

    // Cmd+B (Mac) / Ctrl+B (Win/Linux) is handled by workspace-specific shortcuts
    // to toggle the left sidebar. Not registered globally.

    // Cmd+/ (Mac) / Ctrl+/ (Win/Linux) -> Enhance Prompt (matches VS Code keybinding)
    register({
      key: '/',
      meta: isMac,
      ctrl: !isMac,
      description: 'Enhance Prompt',
      action: () => window.dispatchEvent(new CustomEvent('chat:enhance-prompt')),
    });

    // Cmd+? (Cmd+Shift+/) (Mac) / Ctrl+? (Ctrl+Shift+/) (Win/Linux) -> toggle keyboard shortcuts cheat sheet
    // Note: On US keyboards, Shift+/ produces '?', so we register both variants
    register({
      key: '?',
      meta: isMac,
      ctrl: !isMac,
      shift: true,
      description: 'Toggle Keyboard Shortcuts',
      action: () => dispatch(toggleCheatSheet('global')),
    });
    // Also register with '/' for keyboards where e.key stays as '/' even with shift
    register({
      key: '/',
      meta: isMac,
      ctrl: !isMac,
      shift: true,
      description: 'Toggle Keyboard Shortcuts',
      action: () => dispatch(toggleCheatSheet('global')),
    });

    // Ctrl+Shift+F12 -> Feature Code Entry (hidden shortcut, all platforms)
    register({
      key: 'F12',
      ctrl: true,
      shift: true,
      global: true,
      description: 'Feature Code Entry',
      action: () => {
        showFeatureCodeDialog = !showFeatureCodeDialog;
      },
    });

    // Cmd+Up (Mac) / Ctrl+Up (Win/Linux) -> Scroll to previous message
    // Skip in editable elements to allow standard cursor navigation (move to start of document)
    register({
      key: 'ArrowUp',
      meta: isMac,
      ctrl: !isMac,
      description: 'Scroll Conversation Up',
      skipInEditableElements: true,
      action: () =>
        window.dispatchEvent(
          new CustomEvent('navigate-message', { detail: { direction: 'previous' } }),
        ),
    });

    // Cmd+Down (Mac) / Ctrl+Down (Win/Linux) -> Scroll to next message
    // Skip in editable elements to allow standard cursor navigation (move to end of document)
    register({
      key: 'ArrowDown',
      meta: isMac,
      ctrl: !isMac,
      description: 'Scroll Conversation Down',
      skipInEditableElements: true,
      action: () =>
        window.dispatchEvent(
          new CustomEvent('navigate-message', { detail: { direction: 'next' } }),
        ),
    });

    // Cmd+Alt+. (Mac) / Ctrl+Alt+. (Win/Linux) -> Open Model Picker
    register({
      key: '.',
      meta: isMac,
      ctrl: !isMac,
      alt: true,
      description: 'Open Model Picker',
      action: () => window.dispatchEvent(new CustomEvent('chat:open-model-picker')),
    });

    // Alt+Enter -> Resend Message (regenerate last response)
    register({
      key: 'Enter',
      alt: true,
      description: 'Resend Message',
      action: () => window.dispatchEvent(new CustomEvent('chat:resend-message')),
    });

    paletteShortcuts.attach();

    // Browser-style back/forward navigation with Cmd+Left/Right (Mac) or Ctrl+Left/Right (Win/Linux)
    const handleBrowserNavigation = (e: KeyboardEvent) => {
      const isMod = isMac ? e.metaKey : e.ctrlKey;
      if (!isMod || e.altKey || e.shiftKey) return;

      // Skip navigation when focused in editable elements (inputs, textareas, contenteditable)
      // This allows Cmd+Left/Right to work normally for cursor navigation in text fields
      if (isFocusInEditableElement(e.target as HTMLElement)) {
        return;
      }

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        history.back();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        history.forward();
      }
    };
    window.addEventListener('keydown', handleBrowserNavigation);

    // Initialize spaces switcher (Ctrl+Tab to cycle through workspaces like Cmd+Tab)
    spacesSwitcher = createSpacesSwitcherKeyboard({
      getCurrentWorkspaceId: () => workspaceStore.current?.id ?? null,
      getWorkspacesSortedByLastViewed: () => {
        // Filter out archived workspaces, but include current workspace
        // The keyboard handler will put current workspace first
        const activeWorkspaces = workspaceStore.items.filter(
          (w) => w.status !== WorkspaceStatus.Archived,
        );
        return workspaceRecencyStore.sortByRecency(activeWorkspaces);
      },
      onSelectWorkspaceId: (workspaceId) => {
        logger.info('[+layout] Spaces switcher selected workspace', { workspaceId });
        goto(`/workspace/${workspaceId}`);
      },
      onOpen: () => {
        logger.debug('[+layout] Spaces switcher opened');
      },
      onClose: () => {
        logger.debug('[+layout] Spaces switcher closed');
      },
    });

    // Handle spaces switcher keyboard events
    // Use capture phase to ensure we get the event before other handlers can stop propagation
    const handleSpacesSwitcherKeyDown = (e: KeyboardEvent) => {
      spacesSwitcher?.handleKeyDown(e);
    };
    const handleSpacesSwitcherKeyUp = (e: KeyboardEvent) => {
      spacesSwitcher?.handleKeyUp(e);
    };
    const handleSpacesSwitcherSelect = (e: Event) => {
      spacesSwitcher?.handleSelectEvent(e as CustomEvent);
    };
    window.addEventListener('keydown', handleSpacesSwitcherKeyDown, true);
    window.addEventListener('keyup', handleSpacesSwitcherKeyUp, true);
    window.addEventListener('spaces-switcher:select', handleSpacesSwitcherSelect);

    // Listen for workspace:create-for-repo events from SidebarChangesPanel
    // This event is dispatched when user clicks "Start New Space" after merging
    const handleCreateForRepo = (event: Event) => {
      const customEvent = event as CustomEvent<{
        repositoryPath: string;
        workspaceId?: string;
        workspaceTitle?: string;
      }>;
      const { repositoryPath, workspaceId, workspaceTitle } = customEvent.detail;

      // Get the current workspace to carry over environment config
      const currentWorkspace = workspaceStore.current;

      newSpaceInitialRepo = repositoryPath
        ? {
            repoPath: repositoryPath,
            environmentType: currentWorkspace?.environmentConfig?.type,
            sshConfig: currentWorkspace?.environmentConfig?.ssh,
            previousWorkspaceId: workspaceId,
            previousWorkspaceTitle: workspaceTitle,
          }
        : undefined;
      showNewSpaceModal = true;
    };
    window.addEventListener('workspace:create-for-repo', handleCreateForRepo);

    // Listen for app:open-new-space-modal events (from overlay, sidebar, etc.)
    const handleOpenNewSpaceModal = (event: Event) => {
      const customEvent = event as CustomEvent<{ initialRepo?: InitialRepoInfo }>;
      newSpaceInitialRepo = customEvent.detail?.initialRepo;
      showNewSpaceModal = true;
    };
    window.addEventListener('app:open-new-space-modal', handleOpenNewSpaceModal);

    return () => {
      unsubscribeWorkspaceColon?.();
      paletteShortcuts?.detach();
      paletteShortcuts?.destroy();
      paletteShortcuts = null;
      spacesSwitcher?.cleanup();
      spacesSwitcher = null;
      if (cmdHoldTimer) {
        clearTimeout(cmdHoldTimer);
        cmdHoldTimer = null;
      }
      document.removeEventListener(
        'sveltekit:navigation-error',
        handleNavigationError as EventListener,
      );
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      cleanupLinkTooltip();
      window.removeEventListener('workspace:create-for-repo', handleCreateForRepo);
      window.removeEventListener('app:open-new-space-modal', handleOpenNewSpaceModal);
      window.removeEventListener('keydown', handleBrowserNavigation);
      window.removeEventListener('keydown', handleSpacesSwitcherKeyDown, true);
      window.removeEventListener('keyup', handleSpacesSwitcherKeyUp, true);
      window.removeEventListener('spaces-switcher:select', handleSpacesSwitcherSelect);

      // Clean up git operation listeners (prevents duplicate toasts on HMR/remount)
      if (gitOpCompletedListenerId && window.electronAPI) {
        window.electronAPI.offById('git:op-completed', gitOpCompletedListenerId);
        gitOpCompletedListenerId = null;
      }
      if (gitOpFailedListenerId && window.electronAPI) {
        window.electronAPI.offById('git:op-failed', gitOpFailedListenerId);
        gitOpFailedListenerId = null;
      }
    };
  });

  // Don't use reactive statement for loading as it can cause loops
  // The agents are already loaded on mount and via event listeners

  function handleCreateWorkspace() {
    newSpaceInitialRepo = undefined;
    showNewSpaceModal = true;
  }

  function handleGitHubAuthSuccess() {
    const pendingAuth = pendingGitHubAuth;
    pendingGitHubAuth = null;
    showGitHubAuthModal = false;

    // Emit event to notify components that auth succeeded and they should retry their pending action
    if (pendingAuth?.operation && pendingAuth?.workspaceId) {
      window.dispatchEvent(
        new CustomEvent('github:auth-success', {
          detail: {
            workspaceId: pendingAuth.workspaceId,
            operation: pendingAuth.operation,
          },
        }),
      );
    }

    import('svelte-sonner')
      .then(({ toast }) => {
        toast.success('GitHub connected', {
          duration: 3000,
        });
      })
      .catch(() => {
        // Toast not available - not critical
      });
  }

  function handleKeychainAllow() {
    if (keychainWarningData?.requestId && window.electronAPI) {
      window.electronAPI.invoke('git:keychain-consent-respond', {
        requestId: keychainWarningData.requestId,
        outcome: 'allow',
      });
    }
    showKeychainAccessModal = false;
    keychainWarningData = null;
  }

  function handleKeychainDeny() {
    if (keychainWarningData?.requestId && window.electronAPI) {
      window.electronAPI.invoke('git:keychain-consent-respond', {
        requestId: keychainWarningData.requestId,
        outcome: 'deny',
      });
    }
    showKeychainAccessModal = false;
    keychainWarningData = null;
  }

  function handleKeychainClose() {
    if (keychainWarningData?.requestId && window.electronAPI) {
      window.electronAPI.invoke('git:keychain-consent-respond', {
        requestId: keychainWarningData.requestId,
        outcome: 'cancelled',
      });
    }
    showKeychainAccessModal = false;
    keychainWarningData = null;
  }

  // Handle retry in terminal for git credentials errors (auth failures)
  async function handleCredentialsRetryInTerminal() {
    if (
      !gitCredentialsError?.command ||
      !gitCredentialsError?.cwd ||
      !gitCredentialsError?.workspaceId
    ) {
      logger.warn('[+layout] Missing data for credentials retry', gitCredentialsError);
      return;
    }

    try {
      const result = await invoke<{
        ok: boolean;
        terminalId?: string;
        error?: string;
      }>('terminal:createWithCommand', {
        workspaceId: gitCredentialsError.workspaceId,
        command: gitCredentialsError.command,
        cwd: gitCredentialsError.cwd,
        title: `Retry: git ${gitCredentialsError.operation}`,
      });

      if (result.ok && result.terminalId) {
        dispatch(openTerminalOverlay(gitCredentialsError.workspaceId, result.terminalId));
      }
    } catch (err) {
      logger.error('[+layout] Failed to create terminal for credentials retry:', err);
    }

    showGitCredentialsModal = false;
    gitCredentialsError = null;
  }

  function handleCreateWorkspaceForRepo(repoName: string, lastWorkspace: Workspace) {
    newSpaceInitialRepo = {
      repoPath: lastWorkspace.repositoryPath || '',
      isGithub: !!(lastWorkspace.repositoryOwner && lastWorkspace.repositoryName),
      owner: lastWorkspace.repositoryOwner || undefined,
      name: lastWorkspace.repositoryName || undefined,
      environmentType: lastWorkspace.environmentConfig?.type,
      sshConfig: lastWorkspace.environmentConfig?.ssh,
    };
    showNewSpaceModal = true;
  }

  // Set currentWorkspaceId when navigating to workspace pages
  beforeNavigate(({ to }: any) => {
    if (to && to.url.pathname.startsWith('/workspace/')) {
      const workspaceId = to.url.pathname.split('/')[2];
      // Don't set workspace for 'new' page - let the page handle it
      if (workspaceId === 'new') {
        workspaceStore.close();
      } else {
        // Check if this is an optimistic workspace being created
        const isOptimistic =
          sessionStorage.getItem(`workspace-${workspaceId}-optimistic`) === 'true';

        if (isOptimistic) {
          // For optimistic workspaces, don't try to set in store yet
          // The page will handle creating the placeholder and loading the real workspace
          logger.debug('[+layout] Navigating to optimistic workspace, skipping store update', {
            workspaceId,
          });
        } else {
          // Only set current workspace if it exists in the store
          // The workspace page will handle loading it if it doesn't exist
          const workspace = workspaceStore.findById(workspaceId);
          if (workspace) {
            logger.debug('[+layout] Setting current workspace', {
              workspaceId,
              foundWorkspaceId: workspace.id,
              foundWorkspaceTitle: workspace.title,
            });
            workspaceStore.setCurrentWorkspace(workspace);
          } else {
            logger.debug('[+layout] Workspace not found in store, page will load it', {
              workspaceId,
            });
          }
          // If workspace doesn't exist in store, the page will load it
        }
      }
    } else if (to && !to.url.pathname.startsWith('/workspace/')) {
      // Clear the current workspace when navigating away from workspace pages
      workspaceStore.close();

      // Load workspaces when navigating to the home page
      // This ensures workspaces are loaded when coming from pages like settings
      if (to.url.pathname === '/') {
        // Check if workspaces are already loaded or currently loading
        if (workspaceStore.items.length === 0 && !workspaceStore.loading) {
          logger.debug('[+layout] Loading workspaces on navigation to home page');
          workspaceStore.load().catch((err) => {
            logger.error('Failed to load workspaces on navigation', err);
          });
        }
      }
    }
  });

  // Track page views for analytics
  afterNavigate(({ to }) => {
    if (!to) return;

    const pathname = to.url.pathname;
    let pageName: 'home' | 'workspace' | 'settings' | 'agent' | 'creating';

    if (pathname === '/') {
      pageName = 'home';
    } else if (pathname.startsWith('/workspace/new')) {
      pageName = 'creating';
    } else if (pathname.startsWith('/workspace/')) {
      pageName = 'workspace';
    } else if (pathname.startsWith('/settings')) {
      pageName = 'settings';
    } else {
      // Don't track unknown pages
      return;
    }

    track('Viewed Page', {
      page_name: pageName,
      page_type: 'app',
    });
  });

  // Notify main process about workspace state for menu enabling/disabling
  afterNavigate(({ to }) => {
    if (!to) return;

    const pathname = to.url.pathname;
    // Check if we're in a workspace (not just creating one)
    const inWorkspace =
      pathname.startsWith('/workspace/') && !pathname.startsWith('/workspace/new');

    // Extract workspace ID from pathname if in a workspace
    let workspaceId: string | undefined;
    if (inWorkspace) {
      const match = pathname.match(/^\/workspace\/([^/?]+)/);
      if (match?.[1]) {
        workspaceId = match[1];
      }
    }

    // Tell main process so it can enable/disable tab-related menu items
    invoke(IPC_CHANNELS.WINDOW.SET_IN_WORKSPACE, { inWorkspace, workspaceId }).catch(() => {
      // Silently ignore errors (e.g., if main process handler not ready)
    });
  });
</script>

<TooltipProvider>
  <Store>
    <!-- Main Layout with Title Bar -->
    <div
      class="panel-layout-container relative h-screen w-screen overflow-hidden text-foreground flex flex-col bg-app-background"
      aria-label="Application shell"
    >
      <!-- Title bar at top -->
      <WindowTitleBar {workspaceId} />

      <!-- Update indicator (top-right corner) -->
      <div class="absolute top-2 right-3 z-10">
        <UpdateDownloadIndicator />
      </div>

      <!-- Main Content Area with Sidebar Nav -->
      <ErrorBoundary componentName="MainLayout">
        <div class="flex flex-1 min-h-0">
          <!-- Global Sidebar Nav Rail -->
          <SidebarNav />

          <!-- Sidebar Panel (persistent, pushes content) -->
          <SidebarPanel />

          <!-- Content area with rounded corners -->
          <main
            class="flex flex-1 min-h-0 flex-col mr-1.5 mb-1.5 rounded-xl overflow-hidden bg-sidebar border border-border/30 shadow-sm"
            aria-label="Main content"
          >
            <div class="flex-1 min-h-0 overflow-auto">
              {@render children?.()}
            </div>

            <!-- Root Quake Terminal Overlay (for non-workspace pages) -->
            <!-- Only shown when not in a workspace context -->
            {#if !workspaceId}
              <RootQuakeTerminalOverlay />
            {/if}
          </main>
        </div>
      </ErrorBoundary>
    </div>

    <!-- Global Command Palette Mount -->
    <CommandPalette
      isOpen={paletteStore.isOpen}
      initialQuery={paletteStore.query}
      {workspaceId}
      onClose={() => paletteStore.close()}
      onSelectFile={(detail: { path: string; line?: number; openInAdjacentPanel?: boolean }) => {
        window.dispatchEvent(
          new CustomEvent('workspace:open-file', {
            detail: {
              path: detail.path,
              line: detail.line,
              openInAdjacentPanel: detail.openInAdjacentPanel ?? false,
            },
          }),
        );
      }}
    />

    <!-- Spaces Switcher Overlay (Ctrl+Tab) -->
    {#if spacesSwitcher}
      <SpacesSwitcherOverlay
        isOpen={spacesSwitcher.isOpen}
        workspaces={switcherLiveWorkspaces}
        selectedIndex={spacesSwitcher.selectedIndex}
        currentWorkspaceId={workspaceStore.current?.id ?? null}
      />
    {/if}

    <!-- Keyboard Shortcuts Cheat Sheet (press Cmd+/ to toggle) -->
    <KeyboardShortcutsCheatSheet />

    <!-- Auggie Setup Gate -->
    <AuggieSetupGate />

    <!-- Error Console (Enhanced Error Handling) -->
    <!-- <ErrorConsole /> -->

    <!-- Toast Notifications -->
    <Toast />

    <!-- Link Hover Tooltip (singleton — shows URL + Cmd+Click hint on link hover) -->
    <LinkTooltip />

    <!-- Auto-Update Notification -->
    {#await import('$lib/components/UpdateNotification.svelte') then { default: UpdateNotification }}
      <UpdateNotification />
    {/await}

    {#if showGitHubAuthModal}
      {#key githubAuthModalKey}
        <GitHubAuthModal
          open={true}
          autoStart={pendingGitHubAuth !== null}
          onClose={() => {
            showGitHubAuthModal = false;
            pendingGitHubAuth = null;
          }}
          onSuccess={handleGitHubAuthSuccess}
        />
      {/key}
    {/if}

    {#if showGitCredentialsModal}
      <GitCredentialsModal
        open={true}
        errorMessage={gitCredentialsError?.message ?? ''}
        rawError={gitCredentialsError?.rawError}
        operation={gitCredentialsError?.operation ?? 'push'}
        command={gitCredentialsError?.command}
        cwd={gitCredentialsError?.cwd}
        onClose={() => {
          showGitCredentialsModal = false;
          gitCredentialsError = null;
        }}
        onRetryInTerminal={handleCredentialsRetryInTerminal}
      />
    {/if}

    <!-- Release Notes Modal (shown after update) -->
    <ReleaseNotesModal
      open={releaseNotesStore.showModal}
      releaseNotes={releaseNotesStore.releaseNotes}
      onClose={() => releaseNotesStore.closeModal()}
    />

    <!-- New Workspace Modal -->
    <NewSpaceModal
      bind:open={showNewSpaceModal}
      initialRepo={newSpaceInitialRepo}
      onClose={() => {
        showNewSpaceModal = false;
        newSpaceInitialRepo = undefined;
      }}
    />

    <!-- Feature Code Dialog (hidden, activated via Ctrl+Shift+F12) -->
    <FeatureCodeDialog bind:open={showFeatureCodeDialog} />

    <!-- Debug Panel (only in dev mode) -->
    {#if import.meta.env.DEV}
      <DebugPanel />
    {/if}
  </Store>
</TooltipProvider>

<style>
  :global(html, body) {
    height: 100%;
    overflow: hidden;
    margin: 0;
    padding: 0;
    font-family:
      -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  }

  /* macOS-style draggable title bar using pseudo-element */
  .panel-layout-container::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 25px;
    -webkit-app-region: drag;
    /* pointer-events: none allows hover to work on elements below,
       while -webkit-app-region: drag still works at the OS level */
    pointer-events: none;
  }

  /* Global: Make all interactive elements clickable (no-drag) */
  :global(button),
  :global(a),
  :global(input),
  :global(select),
  :global(textarea),
  :global([role='button']),
  :global([role='tab']),
  :global([role='menuitem']),
  :global([data-interactive]),
  :global([tabindex]:not([tabindex='-1'])) {
    -webkit-app-region: no-drag;
  }
</style>
