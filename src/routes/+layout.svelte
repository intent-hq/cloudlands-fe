<script lang="ts">
  import '../app.css';

  import {
  afterNavigate,
  beforeNavigate,
  goto,
} from '$app/navigation';
  import { page } from '$app/stores';
  import {
  track,
  setAnalyticsContextProvider,
} from '$lib/services/analytics';
  import type { AnalyticsUIContext } from '$lib/services/analytics';
  import { navigateToSettings } from '$lib/utils/workspace-navigation';

  import {
  initializeReleaseNotes,
  closeReleaseNotesModal,
} from '$lib/store/slices/release-notes/release-notes-slice';
  import {
  selectShowReleaseNotesModal,
  selectReleaseNotes,
} from '$lib/store/slices/release-notes/release-notes-selectors';
  import { initializeGitHubAuth } from '$lib/store/slices/github-auth/github-auth-slice';
  import { globalCleanupService } from '$features/memory/browser/global-cleanup.service';
  import {
  openPalette,
  closePalette,
  togglePalette,
  openGoToLine,
} from '$lib/store/slices/palette/palette-slice';
  import {
  selectIsPaletteOpen,
  selectPaletteQuery,
} from '$lib/store/slices/palette/palette-selectors';
  import SpacesSwitcherOverlay from '$features/workspace/SpacesSwitcherOverlay.svelte';
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
  import { dispatchWindowEvent } from '$lib/utils/window-events';
  import { openWorkspaceFile } from '$lib/store/slices/workspace-navigation/workspace-navigation-slice';
  import UpdateDownloadIndicator from '$lib/components/UpdateDownloadIndicator.svelte';
  import { invoke } from '$lib/electron-bridge';

  import {
  closeGitCredentialsModal,
  closeGitHubAuthModal,
} from '$lib/store/slices/global-modals/global-modals-slice';
  import {
  selectGitCredentialsError,
  selectGlobalModals,
  selectPendingGitHubAuth,
} from '$lib/store/slices/global-modals/global-modals-selectors';
  import { selectFeatureCodeDialogOpen } from '$lib/store/slices/feature-codes/feature-codes-selectors';
  import { toggleFeatureCodeDialog } from '$lib/store/slices/feature-codes/feature-codes-slice';
  import { toggleCheatSheet } from '$lib/store/slices/shortcuts-cheatsheet/shortcuts-cheatsheet-slice';
  import { toggleLineWrapping } from '$lib/store/slices/ui-layout/ui-layout-slice';
  import {
  cleanupInvalidWorkspaceTabs,
  openWorkspaceTab,
} from '$lib/store/slices/tab-state/tab-state-slice';
  import {
  selectCurrentWorkspaceTabId,
  selectWorkspaceTabOrder,
} from '$lib/store/slices/tab-state/tab-state-selectors';
  import {
  toggleTerminalOverlay,
  openTerminalOverlay,
} from '$lib/store/slices/terminals/terminals-slice';
  import {
  selectActiveWorkspaceId,
  selectWorkspaceById,
  selectWorkspaceHasLoaded,
  selectWorkspaceItems,
  selectWorkspaceLoading,
} from '$lib/store/slices/workspace/workspace-selectors';
  import { selectHasCompletedProviderSetup } from '$lib/store/slices/user-preferences/user-preferences-selectors';
  import {
  clearActiveWorkspace,
  loadWorkspacesRequested,
  recordWorkspaceView,
  setActiveWorkspaceId,
} from '$lib/store/slices/workspace/workspace-slice';
  import { createAgentWithSpecialistRequested } from '$lib/store/slices/workspace-agents/workspace-agents-slice';

  import { createLogger } from '$lib/utils/client-logger';
  import { preloadDiffHighlighter } from '$lib/utils/diff-highlighter-preloader';
  import {
  isFocusInEditableElement,
  KeyboardShortcutManager,
} from '$lib/utils/keyboardShortcuts';
  import { configureMonacoWorkers } from '$lib/utils/monaco-workers';
  import {
  onDestroy,
  onMount,
  untrack,
} from 'svelte';

  import { createLinkTooltipHandler } from '$features/navigation/link-handler';
  import { registerAllTabTypes } from '$features/layout/tab-types/register-all';
  import { IPC_CHANNELS } from '$shared/ipc-registry';
  import RootQuakeTerminalOverlay from '$lib/components/terminal/RootQuakeTerminalOverlay.svelte';
  import {
  ROOT_WORKSPACE_ID,
  isValidWorkspaceId,
} from '$shared/types/branded-ids';
  import FeatureCodeDialog from '$lib/components/modals/FeatureCodeDialog.svelte';
  import {
  SidebarNav,
  SidebarPanel,
} from '$lib/components/layout/sidebar-nav';
  import {
  togglePanel,
  setShowCreateModal,
} from '$lib/store/slices/sidebar-nav/sidebar-nav-slice';
  import { selectShowCreateModal } from '$lib/store/slices/sidebar-nav/sidebar-nav-selectors';
  import NewSpaceModal from '$lib/components/modals/NewSpaceModal.svelte';
  import {
    store as appStore,
  } from '$lib/store/store';
  import {
    initRegisteredAppStore,
    startAllAppSagas,
  } from '$lib/store/saga-registration';
  const logger = createLogger('+layout');

  function initStore(): () => void {
    const storeContext = initRegisteredAppStore();
    const stopHandlers = startAllAppSagas();

    return () => {
      for (const stop of stopHandlers) {
        stop();
      }
      storeContext.dispose();
    };
  }

  const disposeStore = initStore();
  onDestroy(disposeStore);

  const workspaceItems = selectWorkspaceItems();
  const activeWorkspaceId = selectActiveWorkspaceId();
  const workspaceLoading = selectWorkspaceLoading();
  const workspaceHasLoaded = selectWorkspaceHasLoaded();
  const hasCompletedProviderSetup = selectHasCompletedProviderSetup();
  const currentWorkspaceTabId = selectCurrentWorkspaceTabId();
  const workspaceTabOrder = selectWorkspaceTabOrder();
  const showReleaseNotesModal$ = selectShowReleaseNotesModal();
  const releaseNotes$ = selectReleaseNotes();
  const showCreateModal$ = selectShowCreateModal();

  // Register all tab types early
  // This must happen before any panels are rendered
  registerAllTabTypes();

  // Preload the diff highlighter early to avoid blocking when opening first diff
  // This runs during idle time and doesn't block the main thread
  if (typeof window !== 'undefined') {
    preloadDiffHighlighter();
  }

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

  interface Props {
    children?: import('svelte').Snippet;
  }

  let { children }: Props = $props();

  // Configure Monaco Editor web workers for Electron + Vite
  if (typeof window !== 'undefined') {
    configureMonacoWorkers();
  }

  let currentWorkspaceId = $derived($page.params.id as string | undefined);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let isHome = $derived($page.route.id === '/');
  const globalModals = selectGlobalModals();
  const featureCodeDialogOpen = selectFeatureCodeDialogOpen();
  const isPaletteOpen$ = selectIsPaletteOpen();
  const paletteQuery$ = selectPaletteQuery();

  // PERF: Consolidated workspace sync effect - handles both tab syncing and cleanup
  // Merging these effects reduces re-renders when workspaces change
  let lastSyncedTabId = '';
  let lastWorkspaceIds = '';
  $effect(() => {
    // Part 1: Sync workspace store with tab manager
    const currentTabId = $currentWorkspaceTabId;
    if (currentTabId && currentTabId !== lastSyncedTabId) {
      lastSyncedTabId = currentTabId;
      untrack(() => {
        if (currentTabId !== $activeWorkspaceId) {
          appStore.dispatch(setActiveWorkspaceId(currentTabId));
          appStore.dispatch(recordWorkspaceView(currentTabId, Date.now()));
        }
      });
    }

    // Part 2: Clean up invalid tabs when workspaces change
    // IMPORTANT: Don't cleanup if workspaces is empty or still loading
    // This prevents closing all tabs during initial load or when a reload fails
    if ($workspaceItems.length === 0 || $workspaceLoading) {
      // Skip cleanup when workspaces list is empty or loading
      // This prevents closing tabs during:
      // - Initial load before workspaces are fetched
      // - Network errors that return empty results
      // - HMR refreshes that temporarily clear the store
      return;
    }

    const validIds = $workspaceItems
      .filter((w) => w.status !== 'Archived' && w.status !== 'Deleted')
      .map((w) => w.id);
    const currentIds = validIds.sort().join(',');
    if (currentIds !== lastWorkspaceIds) {
      lastWorkspaceIds = currentIds;
      untrack(() => {
        appStore.dispatch(cleanupInvalidWorkspaceTabs(validIds));
      });
    }
  });

  // Redirect first-time users to the full onboarding experience.
  // Once workspaces have loaded, if there are none and the user hasn't
  // completed provider setup, send them to /workspace/new instead of
  // showing the home page.  The splash screen covers the loading gap.
  $effect(() => {
    if (
      $workspaceHasLoaded &&
      $workspaceItems.length === 0 &&
      !$hasCompletedProviderSetup &&
      window.location.pathname === '/'
    ) {
      goto('/workspace/new');
    }
  });

  // Send open workspace tabs to main process for Window menu
  $effect(() => {
    const tabOrder = $workspaceTabOrder;
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

  // Track last non-settings path for cmd+, toggle behavior
  let lastNonSettingsPath = $state('/');

  // Cmd hold cheat sheet state
  let cmdHoldTimer: ReturnType<typeof setTimeout> | null = null;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const CMD_HOLD_DELAY = 500; // half second
  $effect(() => {
    const currentPath = $page.url.pathname;
    if (!currentPath.startsWith('/settings')) {
      lastNonSettingsPath = currentPath;
    }
  });

  let paletteShortcuts: KeyboardShortcutManager | null = null;

  onMount(() => {
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
    appStore.dispatch(initializeGitHubAuth());

    // Initialize release notes store to detect version changes and show release notes
    // We need to fetch the channel directly from main process since the auto-update
    // Redux state hasn't loaded the user's preference yet at this point
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
          appStore.dispatch(initializeReleaseNotes(currentVersion, channel));
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
          appStore.dispatch(loadWorkspacesRequested());
        });
      } else {
        // Fallback to setTimeout for browsers without requestIdleCallback
        setTimeout(() => {
          appStore.dispatch(loadWorkspacesRequested());
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
          appStore.dispatch(clearActiveWorkspace());
        } else {
          // Open tab and set as current - use untrack to prevent loops
          untrack(() => {
            appStore.dispatch(openWorkspaceTab(id));
            if (selectActiveWorkspaceId.select(appStore.state) !== id) {
              appStore.dispatch(setActiveWorkspaceId(id));
              appStore.dispatch(recordWorkspaceView(id, Date.now()));
            }
          });
        }
      }
    } catch {}
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
    const openCmd = () => appStore.dispatch(openPalette());
    const openFile = () => appStore.dispatch(openPalette());
    const openSearch = () => appStore.dispatch(openPalette());

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
      } catch  {
        // Ignore if not available (e.g., web build)
      }
    })();
    // Cmd+K (Mac) / Ctrl+K (Win/Linux) -> open command palette
    // Note: On macOS, Ctrl+K is an Emacs shortcut (kill line) and should NOT open command palette
    const openCommandPalette = () => {
      appStore.dispatch(togglePalette());
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
      appStore.dispatch(togglePanel('all-workspaces'));
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
    // Cmd+T (Mac) / Ctrl+T (Win/Linux) - New Tab (creates new agent with specialist picker)
    const newTab = () => {
      const wsId = selectActiveWorkspaceId.select(appStore.state);
      if (wsId) {
        appStore.dispatch(createAgentWithSpecialistRequested(wsId, null));
      }
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
      dispatchWindowEvent('editor:go-to-definition');
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
    const openGoToLineAction = () => appStore.dispatch(openGoToLine());
    register({ key: 'g', meta: true, description: 'Go to Line (Mac)', action: openGoToLineAction });
    if (!isMac) {
      register({
        key: 'g',
        ctrl: true,
        description: 'Go to Line (Win/Linux)',
        action: openGoToLineAction,
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
      action: () => appStore.dispatch(toggleLineWrapping()),
    });
    // Ctrl+` -> toggle terminal overlay (matches VS Code behavior - Ctrl on all platforms including Mac)
    // Registered globally so it works on workspace and non-workspace pages alike.
    const toggleTerminal = () => {
      // Use URL-derived currentWorkspaceId rather than Redux workspace selector
      // because the selector value can be null/stale during initial load or navigation,
      // which would incorrectly route the toggle to ROOT_WORKSPACE_ID.
      const isOnWorkspacePage = $page.url.pathname.startsWith('/workspace/');
      const terminalContextId =
        isOnWorkspacePage &&
        currentWorkspaceId &&
        currentWorkspaceId !== 'new' &&
        isValidWorkspaceId(currentWorkspaceId)
          ? currentWorkspaceId
          : ROOT_WORKSPACE_ID;
      appStore.dispatch(toggleTerminalOverlay(terminalContextId));
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
    // Works both in workspace pages (uses currentWorkspaceId) and non-workspace pages (uses ROOT_WORKSPACE_ID)
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
      action: () => dispatchWindowEvent('chat:enhance-prompt'),
    });

    // Cmd+? (Cmd+Shift+/) (Mac) / Ctrl+? (Ctrl+Shift+/) (Win/Linux) -> toggle keyboard shortcuts cheat sheet
    // Note: On US keyboards, Shift+/ produces '?', so we register both variants
    register({
      key: '?',
      meta: isMac,
      ctrl: !isMac,
      shift: true,
      description: 'Toggle Keyboard Shortcuts',
      action: () => appStore.dispatch(toggleCheatSheet('global')),
    });
    // Also register with '/' for keyboards where e.key stays as '/' even with shift
    register({
      key: '/',
      meta: isMac,
      ctrl: !isMac,
      shift: true,
      description: 'Toggle Keyboard Shortcuts',
      action: () => appStore.dispatch(toggleCheatSheet('global')),
    });

    // Ctrl+Shift+F12 -> Feature Code Entry (hidden shortcut, all platforms)
    register({
      key: 'F12',
      ctrl: true,
      shift: true,
      global: true,
      description: 'Feature Code Entry',
      action: () => {
        appStore.dispatch(toggleFeatureCodeDialog());
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
        dispatchWindowEvent('navigate-message', { direction: 'previous' }),
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
        dispatchWindowEvent('navigate-message', { direction: 'next' }),
    });

    // Cmd+Alt+. (Mac) / Ctrl+Alt+. (Win/Linux) -> Open Model Picker
    register({
      key: '.',
      meta: isMac,
      ctrl: !isMac,
      alt: true,
      description: 'Open Model Picker',
      action: () => dispatchWindowEvent('chat:open-model-picker'),
    });

    // Alt+Enter -> Resend Message (regenerate last response)
    register({
      key: 'Enter',
      alt: true,
      description: 'Resend Message',
      action: () => dispatchWindowEvent('chat:resend-message'),
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

    return () => {
      paletteShortcuts?.detach();
      paletteShortcuts?.destroy();
      paletteShortcuts = null;
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
      window.removeEventListener('keydown', handleBrowserNavigation);

    };
  });

  function handleGitHubAuthSuccess() {
    const pendingAuth = selectPendingGitHubAuth.select(appStore.state);
    appStore.dispatch(closeGitHubAuthModal());

    // Emit event to notify components that auth succeeded and they should retry their pending action
    if (pendingAuth?.operation && pendingAuth?.workspaceId) {
      dispatchWindowEvent('github:auth-success', {
        workspaceId: pendingAuth.workspaceId,
        operation: pendingAuth.operation,
      });
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

  // Handle retry in terminal for git credentials errors (auth failures)
  async function handleCredentialsRetryInTerminal() {
    const gitCredentialsError = selectGitCredentialsError.select(appStore.state);

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
        appStore.dispatch(openTerminalOverlay(gitCredentialsError.workspaceId, result.terminalId));
      }
    } catch (err) {
      logger.error('[+layout] Failed to create terminal for credentials retry:', err);
    }

    appStore.dispatch(closeGitCredentialsModal());
  }

  // Set currentWorkspaceId when navigating to workspace pages
  beforeNavigate(({ to }: any) => {
    if (to && to.url.pathname.startsWith('/workspace/')) {
      const workspaceId = to.url.pathname.split('/')[2];
      // Don't set workspace for 'new' page - let the page handle it
      if (workspaceId === 'new') {
        appStore.dispatch(clearActiveWorkspace());
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
          const workspace = selectWorkspaceById.select(appStore.state, workspaceId);
          if (workspace) {
            logger.debug('[+layout] Setting current workspace', {
              workspaceId,
              foundWorkspaceId: workspace.id,
              foundWorkspaceTitle: workspace.title,
            });
            appStore.dispatch(setActiveWorkspaceId(workspaceId));
            appStore.dispatch(recordWorkspaceView(workspaceId, Date.now()));
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
      appStore.dispatch(clearActiveWorkspace());

      // Load workspaces when navigating to any non-workspace route
      // This ensures workspaces are loaded for tabs, switcher, and other UI components
      const state = appStore.state;
      if (!selectWorkspaceLoading.select(state)) {
        logger.debug('[+layout] Loading workspaces on navigation to non-workspace page');
        appStore.dispatch(loadWorkspacesRequested());
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
    <!-- Main Layout with Title Bar -->
    <div
      class="panel-layout-container relative h-screen w-screen overflow-hidden text-foreground flex flex-col bg-app-background"
      aria-label="Application shell"
      data-testid="app-ready"
    >
      <!-- Title bar at top -->
      <WindowTitleBar workspaceId={$activeWorkspaceId || undefined} />

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

            <!-- Root Quake Terminal Overlay (self-gates on __root__ terminal state) -->
            <RootQuakeTerminalOverlay />
          </main>
        </div>
      </ErrorBoundary>
    </div>

    <!-- Global Command Palette Mount -->
    <CommandPalette
      isOpen={$isPaletteOpen$}
      initialQuery={$paletteQuery$}
      workspaceId={$activeWorkspaceId || undefined}
      onClose={() => appStore.dispatch(closePalette())}
      onSelectFile={(detail: { path: string; line?: number; openInAdjacentPanel?: boolean }) => {
        const wsId = $activeWorkspaceId;
        if (wsId) {
          appStore.dispatch(
            openWorkspaceFile(wsId, detail.path, {
              line: detail.line,
              openInAdjacentPanel: detail.openInAdjacentPanel ?? false,
            }),
          );
        }
      }}
    />

    <!-- Spaces Switcher Overlay (Ctrl+Tab) -->
    <SpacesSwitcherOverlay />

    <!-- Keyboard Shortcuts Cheat Sheet (press Cmd+/ to toggle) -->
    <KeyboardShortcutsCheatSheet />

    <!-- Auggie Setup Gate -->
    <AuggieSetupGate />

    <!-- Toast Notifications -->
    <Toast />

    <!-- Link Hover Tooltip (singleton — shows URL + Cmd+Click hint on link hover) -->
    <LinkTooltip />

    <!-- Auto-Update Notification -->
    {#await import('$lib/components/UpdateNotification.svelte') then { default: UpdateNotification }}
      <UpdateNotification />
    {/await}

    {#if $globalModals.githubAuth.open}
      {#key $globalModals.githubAuth.modalKey}
        <GitHubAuthModal
          open={true}
          autoStart={$globalModals.githubAuth.pendingAuth !== null}
          onClose={() => {
            appStore.dispatch(closeGitHubAuthModal());
          }}
          onSuccess={handleGitHubAuthSuccess}
        />
      {/key}
    {/if}

    {#if $globalModals.gitCredentials.open}
      <GitCredentialsModal
        open={true}
        errorMessage={$globalModals.gitCredentials.error?.message ?? ''}
        rawError={$globalModals.gitCredentials.error?.rawError}
        operation={$globalModals.gitCredentials.error?.operation ?? 'push'}
        command={$globalModals.gitCredentials.error?.command}
        cwd={$globalModals.gitCredentials.error?.cwd}
        onClose={() => {
          appStore.dispatch(closeGitCredentialsModal());
        }}
        onRetryInTerminal={handleCredentialsRetryInTerminal}
      />
    {/if}

    <!-- Create Workspace Modal (opened from sidebar nav + button) -->
    <NewSpaceModal
      open={$showCreateModal$}
      onClose={() => appStore.dispatch(setShowCreateModal(false))}
    />

    <!-- Release Notes Modal (shown after update) -->
    <ReleaseNotesModal
      open={$showReleaseNotesModal$}
      releaseNotes={$releaseNotes$}
      onClose={() => appStore.dispatch(closeReleaseNotesModal())}
    />

    <!-- Feature Code Dialog (hidden, activated via Ctrl+Shift+F12) -->
    <FeatureCodeDialog
      open={$featureCodeDialogOpen}
      onClose={() => {
        if ($featureCodeDialogOpen) {
          appStore.dispatch(toggleFeatureCodeDialog());
        }
      }}
    />

    <!-- Debug Panel (only in dev mode) -->
    {#if import.meta.env.DEV}
      <DebugPanel />
    {/if}
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
