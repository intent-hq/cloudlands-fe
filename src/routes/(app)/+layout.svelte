<script lang="ts">
  import './app-layout.css';
  import { m } from '$shared/paraglide/messages.js';
  import { afterNavigate, beforeNavigate, goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { navigateToSettings } from '$lib/utils/workspace-navigation';

  import {
    initializeReleaseNotes,
    closeReleaseNotesModal,
  } from '$store/renderer/slices/release-notes/release-notes-slice';
  import {
    selectShowReleaseNotesModal,
    selectReleaseNotes,
  } from '$store/renderer/slices/release-notes/release-notes-selectors';
  import { initializeGitHubAuth } from '$store/renderer/slices/github-auth/github-auth-slice';
  import { globalCleanupService } from '$features/memory/browser/global-cleanup.service';
  import {
    openPalette,
    closePalette,
    togglePalette,
    openGoToLine,
  } from '$store/renderer/slices/palette/palette-slice';
  import {
    selectIsPaletteOpen,
    selectPaletteQuery,
  } from '$store/renderer/slices/palette/palette-selectors';
  import RadialPromptPickerOverlay from '$features/hardware-console/prompt-picker/RadialPromptPickerOverlay.svelte';
  import EncoderCycleHud from '$features/hardware-console/encoder/EncoderCycleHud.svelte';
  import ActionKeyHud from '$features/hardware-console/actions/ActionKeyHud.svelte';
  import StatsOverlay from '$features/stats/StatsOverlay.svelte';
  import DaemonStoppedOverlay from '$features/daemon-status/DaemonStoppedOverlay.svelte';
  import DaemonUpdatingOverlay from '$features/daemon-status/DaemonUpdatingOverlay.svelte';
  import { registerWorkspaceTabShortcuts } from '$features/workspace/utils/workspace-tab-navigation';
  import { WORKSPACE_TAB_MOVED_EVENT } from '$features/workspace/utils/workspace-tab-move-event';
  import AuggieSetupGate from '$lib/components/AuggieSetupGate.svelte';
  import CommandPalette from '$lib/components/CommandPalette.svelte';
  import DebugPanel from '$lib/components/debug/DebugPanel.svelte';
  import ErrorBoundary from '$lib/components/ErrorBoundary.svelte';
  import GitCredentialsModal from '$lib/components/GitCredentialsModal.svelte';
  import GitHubAuthModal from '$lib/components/GitHubAuthModal.svelte';
  import KeyboardShortcutsCheatSheet from '$lib/components/layout/KeyboardShortcutsCheatSheet.svelte';
  import WindowTitleBar from '$lib/components/layout/WindowTitleBar.svelte';
  import WorkspaceWarningDialogs from '$lib/components/modals/WorkspaceWarningDialogs.svelte';
  import TransferWorkspaceModalHost from '$lib/components/modals/TransferWorkspaceModalHost.svelte';
  import ImportWorkspaceModalHost from '$lib/components/modals/ImportWorkspaceModalHost.svelte';
  import SetupPromptDialog from '$lib/components/modals/SetupPromptDialog.svelte';
  import ReleaseNotesModal from '$lib/components/modals/ReleaseNotesModal.svelte';
  import Toast from '$lib/components/ui/toast/Toast.svelte';
  import NodeVersionToast from '$lib/components/NodeVersionToast.svelte';
  import { TooltipProvider } from '$lib/components/ui/tooltip';
  import LinkTooltip from '$lib/components/ui/tooltip/LinkTooltip.svelte';
  import LinkActionMenu from '$features/navigation/LinkActionMenu.svelte';
  import OffscreenWebviewHost from '$lib/components/browser/OffscreenWebviewHost.svelte';
  import { dispatchWindowEvent } from '$lib/utils/window-events';
  import { openWorkspaceFile } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
  import { invoke } from '$lib/electron-bridge';

  import {
    closeGitCredentialsModal,
    closeGitHubAuthModal,
  } from '$store/renderer/slices/global-modals/global-modals-slice';
  import {
    selectGitCredentialsError,
    selectGlobalModals,
    selectPendingGitHubAuth,
  } from '$store/renderer/slices/global-modals/global-modals-selectors';
  import { selectFeatureCodeDialogOpen } from '$store/renderer/slices/feature-codes/feature-codes-selectors';
  import { toggleFeatureCodeDialog } from '$store/renderer/slices/feature-codes/feature-codes-slice';
  import { toggleCheatSheet } from '$store/renderer/slices/shortcuts-cheatsheet/shortcuts-cheatsheet-slice';
  import { toggleLineWrapping } from '$store/renderer/slices/ui-layout/ui-layout-slice';
  import { setStatsOverlayOpen } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import { openWorkspaceTab } from '$store/renderer/slices/tab-state/tab-state-slice';
  import {
    selectCurrentWorkspaceTabId,
    selectWorkspaceTabOrder,
    selectWorkspaceTabsHydrated,
  } from '$store/renderer/slices/tab-state/tab-state-selectors';
  import {
    toggleTerminalOverlay,
    openTerminalOverlay,
  } from '$store/renderer/slices/terminals/terminals-slice';
  import { resolveTerminalShortcutWorkspaceId } from '$features/terminal/terminal-shortcut-context';
  import {
    selectWorkspaceHasLoaded,
    selectWorkspaceItems,
    selectWorkspaceLoading,
  } from '$store/renderer/slices/workspace/workspace-selectors';
  import {
    selectBootRouteGateResolved,
    selectBackendSetupGate,
  } from '$store/renderer/slices/setup-prompt/setup-prompt-selectors';
  import { bootRouteGateResolved } from '$store/renderer/slices/setup-prompt/setup-prompt-slice';
  import { selectCurrentConnection } from '$store/renderer/slices/connections/connections-selectors';
  import { selectShellTransparencyEnabled } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import { connectionShellTint } from '$lib/utils/connection-accents';
  import {
    BOOT_ROUTE_HOLD_TIMEOUT_MS,
    decideBootRoute,
    getBootRoutePathname,
  } from '$lib/utils/boot-route-gate';
  import {
    loadWorkspacesRequested,
    recordWorkspaceView,
  } from '$store/renderer/slices/workspace/workspace-slice';
  import { createLogger } from '$lib/utils/client-logger';
  import { preloadDiffHighlighter } from '$lib/utils/diff-highlighter-preloader';
  import { isFocusInEditableElement, KeyboardShortcutManager } from '$lib/utils/keyboardShortcuts';
  import { configureMonacoWorkers } from '$lib/utils/monaco-workers';
  import { hasCapability } from '$lib/utils/platform-capabilities';
  import { onDestroy, onMount, untrack } from 'svelte';

  import { createLinkTooltipHandler } from '$features/navigation/link-handler';
  import { registerAllTabTypes } from '$features/layout/tab-types/register-all';
  import { IPC_CHANNELS } from '$shared/ipc-registry';
  import RootQuakeTerminalOverlay from '$lib/components/terminal/RootQuakeTerminalOverlay.svelte';
  import FeatureCodeDialog from '$lib/components/modals/FeatureCodeDialog.svelte';
  import { SidebarPanel } from '$lib/components/layout/sidebar-nav';
  import {
    togglePanel,
    setShowCreateModal,
  } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import { selectShowCreateModal } from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';
  import NewSpaceModal from '$lib/components/modals/NewSpaceModal.svelte';
  import { store as appStore } from '$store/renderer/store';
  import { getEffectiveShortcut } from '$lib/utils/effective-shortcuts';
  import type { ShortcutId } from '$lib/utils/shortcut-bindings';
  // Installs production bridge handlers before the app sagas and route startup use them.
  import '$store/renderer/seeders';
  import { startAppStoreLifecycle } from '$store/renderer/app-store-lifecycle';
  import {
    installInterruptedAgentsService,
    notifyInterruptedAgentsModalClosed,
    resolveInterruptedAgents,
  } from '$features/agent/interrupted-agents-service';
  import InterruptedAgentsModal from '$lib/components/modals/InterruptedAgentsModal.svelte';
  import {
    installQuitConfirmationService,
    respondToQuitConfirmation,
  } from '$features/quit-confirmation/quit-confirmation-service';
  import QuitConfirmationModal from '$lib/components/modals/QuitConfirmationModal.svelte';
  import type { QuitConfirmationShowPayload } from '$shared/ipc/quit-confirmation';
  import type { InterruptedAgent } from '$lib/client/app-client';
  import { LiveAppClient } from '$lib/client/live/live-app-client';
  import { workspaceIdFromRoute } from '$lib/utils/workspace-route-context';
  const logger = createLogger('+layout');

  const disposeAppStore = startAppStoreLifecycle(appStore, import.meta.hot?.data);
  onDestroy(disposeAppStore);

  const routePathname = $derived($page.url.pathname);
  const routeWorkspaceId = $derived(($page.params?.id as string | undefined) ?? '');
  const workspaceId = $derived(workspaceIdFromRoute(routePathname, routeWorkspaceId) ?? undefined);
  const workspaceItems = selectWorkspaceItems();
  const workspaceHasLoaded = selectWorkspaceHasLoaded();
  const backendSetupGate = selectBackendSetupGate();
  const bootGateResolved = selectBootRouteGateResolved();
  const currentWorkspaceTabId = selectCurrentWorkspaceTabId();
  const workspaceTabsHydrated = selectWorkspaceTabsHydrated();
  const workspaceTabOrder = selectWorkspaceTabOrder();
  const showReleaseNotesModal$ = selectShowReleaseNotesModal();
  const releaseNotes$ = selectReleaseNotes();
  const showCreateModal$ = selectShowCreateModal();
  const currentConnection$ = selectCurrentConnection();
  const shellTransparencyEnabled$ = selectShellTransparencyEnabled();
  const applicationShellTint = $derived(
    connectionShellTint($currentConnection$?.accent, $currentConnection$?.isLocal ?? true),
  );

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
  const globalModals = selectGlobalModals();
  const featureCodeDialogOpen = selectFeatureCodeDialogOpen();
  const isPaletteOpen$ = selectIsPaletteOpen();
  const paletteQuery$ = selectPaletteQuery();

  // The routed workspace renders its own webviews; all other open workspace
  // browser tabs stay alive in the offscreen host (monorepo#2789 slice 2).
  const offscreenExcludedWorkspaceIds = $derived<ReadonlySet<string>>(
    new Set(workspaceId ? [workspaceId] : []),
  );

  // Interrupted agents modal state
  let showInterruptedAgentsModal = $state(false);
  let interruptedAgents = $state<InterruptedAgent[]>([]);

  // Quit confirmation modal state (main-process quit/restart interception)
  let showQuitConfirmationModal = $state(false);
  let quitConfirmationPayload = $state<QuitConfirmationShowPayload | null>(null);

  // The root route is a minimal empty state and fresh windows boot at
  // /workspace/new, which renders onboarding. Gate boot (and legacy `/`)
  // loads on the backend-derived setup evaluation: land on an existing
  // workspace when the backend has one, and only fall through to onboarding
  // when the active backend (local or remote) genuinely needs first-run setup
  // (no workspaces and no ready providers). The decision logic lives in
  // decideBootRoute (boot-route-gate); it fires at most once per full page
  // load, so deliberate in-app navigation to `/` or /workspace/new is
  // unaffected. While it holds, WorkspaceSurface suppresses onboarding so the
  // wizard never flashes before a redirect. The hold is bounded: if nothing
  // settles within BOOT_ROUTE_HOLD_TIMEOUT_MS (e.g. provider probes failing
  // forever, so neither a check settlement nor an evaluation ever arrives),
  // bootHoldTimedOut flips and decideBootRoute resolves best-effort instead
  // of holding a blank surface indefinitely.
  let bootHoldTimedOut = $state(false);
  $effect(() => {
    if ($bootGateResolved) return;
    const timer = setTimeout(() => {
      bootHoldTimedOut = true;
    }, BOOT_ROUTE_HOLD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  });
  $effect(() => {
    const decision = decideBootRoute({
      bootPathname: getBootRoutePathname(),
      currentPathname: window.location.pathname,
      gateResolved: $bootGateResolved,
      setupGate: $backendSetupGate,
      workspaceHasLoaded: $workspaceHasLoaded,
      workspaces: $workspaceItems,
      tabsHydrated: $workspaceTabsHydrated,
      currentTabId: $currentWorkspaceTabId,
      holdTimedOut: bootHoldTimedOut,
    });
    if (decision.kind !== 'resolve') return;
    untrack(() => {
      if (decision.openTabWorkspaceId) {
        appStore.dispatch(openWorkspaceTab(decision.openTabWorkspaceId));
      }
      appStore.dispatch(bootRouteGateResolved());
    });
    if (decision.target) {
      void goto(decision.target, { replaceState: true });
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

    // Initialize interrupted-agents service
    const appClient = new LiveAppClient();
    const disposeInterruptedAgents = installInterruptedAgentsService(appClient, (agents) => {
      interruptedAgents = agents;
      showInterruptedAgentsModal = agents.length > 0;
    });

    // Initialize quit-confirmation service (in-app modal for quit/restart)
    const disposeQuitConfirmation = installQuitConfirmationService({
      onShow: (payload) => {
        quitConfirmationPayload = payload;
        showQuitConfirmationModal = true;
      },
      onDismiss: () => {
        showQuitConfirmationModal = false;
        quitConfirmationPayload = null;
      },
    });

    // Initialize release notes store to detect version changes and show release notes
    // We need to fetch the channel directly from main process since the auto-update
    // Redux state hasn't loaded the user's preference yet at this point
    if (hasCapability('autoUpdate')) {
      (async () => {
        try {
          // Import dynamically to avoid the formatter removing unused imports
          const { autoUpdateClient } = await import('$features/auto-update/auto-update.client');

          const updateState = await autoUpdateClient.getState().catch(() => null);

          // Build-time constant — the app version is FE-only, not a daemon surface.
          const currentVersion = __APP_VERSION__;
          const channel = updateState?.channel || 'stable';

          logger.info(
            `[+layout] Initializing release notes: version=${currentVersion}, channel=${channel}`,
          );
          appStore.dispatch(initializeReleaseNotes());
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
      // i18n-ignore (matches SvelteKit router error message, not rendered in UI)
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
    let workspacesIdleHandle: number | null = null;
    let workspacesTimerHandle: ReturnType<typeof setTimeout> | null = null;
    const loadData = () => {
      // Use requestIdleCallback to load workspaces when browser is idle
      if (typeof requestIdleCallback !== 'undefined') {
        workspacesIdleHandle = requestIdleCallback(() => {
          workspacesIdleHandle = null;
          appStore.dispatch(loadWorkspacesRequested());
        });
      } else {
        // Fallback to setTimeout for browsers without requestIdleCallback
        workspacesTimerHandle = setTimeout(() => {
          workspacesTimerHandle = null;
          appStore.dispatch(loadWorkspacesRequested());
        }, 100);
      }
    };

    loadData();

    // Direct workspace routes open their tab without mirroring route identity into Redux.
    if (workspaceId) {
      appStore.dispatch(openWorkspaceTab(workspaceId));
      appStore.dispatch(recordWorkspaceView(workspaceId, Date.now()));
    }
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
      ignoreRepeat?: boolean;
      enabled?: () => boolean;
      action: () => void;
      shortcutId?: ShortcutId;
      binding?: () => string;
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
        ignoreRepeat: opts.ignoreRepeat,
        enabled: opts.enabled,
        action: opts.action,
        binding:
          opts.binding ??
          (opts.shortcutId ? () => getEffectiveShortcut(opts.shortcutId!) : undefined),
      });
    };
    const openCmd = () => appStore.dispatch(openPalette());
    const openFile = () => appStore.dispatch(openPalette());
    const openSearch = () => appStore.dispatch(openPalette());

    registerWorkspaceTabShortcuts({
      isMac,
      register,
      store: appStore,
      getCurrentPath: () => window.location.pathname,
      navigate: (path) => goto(path),
      openNewWorkspace: () => appStore.dispatch(setShowCreateModal(true)),
      onWorkspaceTabMoved: (detail) => dispatchWindowEvent(WORKSPACE_TAB_MOVED_EVENT, detail),
      resolveBinding: getEffectiveShortcut,
    });

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
          // i18n-ignore (shortcut registry metadata, not rendered in UI)
          registerChord(shortcuts['command-palette'], 'Open Command Palette (Config)', openCmd);
        }
      } catch {
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
      shortcutId: 'global.command-palette-alt',
      description: 'Command Palette (Mac)', // i18n-ignore (shortcut registry metadata, not rendered in UI)
      action: openCommandPalette,
    });
    // Cmd+O (Mac) / Ctrl+O (Win/Linux) -> toggle all spaces sidebar panel
    const toggleAllSpaces = () => {
      appStore.dispatch(togglePanel('all-workspaces'));
    };
    register({
      key: 'o',
      meta: true,
      shortcutId: 'global.toggle-spaces',
      description: 'Toggle All Spaces (Mac)', // i18n-ignore (shortcut registry metadata, not rendered in UI)
      skipInEditableElements: true,
      action: toggleAllSpaces,
    });
    // Cmd+T is registered by registerWorkspaceTabShortcuts (New Panel)
    // F12 - Go to Definition (dispatches event for Monaco editor to handle)
    const goToDefinition = () => {
      dispatchWindowEvent('editor:go-to-definition');
    };
    // i18n-ignore (shortcut registry metadata, not rendered in UI)
    register({ key: 'F12', description: 'Go to Definition', action: goToDefinition });
    // Cmd+P (Mac) / Ctrl+P (Win/Linux)
    // Note: On macOS, Ctrl+P is an Emacs shortcut (previous line) and should NOT open quick open
    // i18n-ignore (shortcut registry metadata, not rendered in UI)
    register({ key: 'p', meta: true, description: 'Quick Open (Mac)', action: openFile });
    if (!isMac) {
      // i18n-ignore (shortcut registry metadata, not rendered in UI)
      register({ key: 'p', ctrl: true, description: 'Quick Open (Win/Linux)', action: openFile });
    }
    // Cmd+Shift+P (Mac) / Ctrl+Shift+P (Win/Linux) -> command palette (VS Code-style)
    register({
      key: 'p',
      meta: isMac,
      ctrl: !isMac,
      shift: true,
      shortcutId: 'global.command-palette',
      description: 'Command Palette (Alt)', // i18n-ignore (shortcut registry metadata, not rendered in UI)
      action: openCmd,
    });
    // Cmd+G (Mac) / Ctrl+G (Win/Linux) -> Go to Line
    const openGoToLineAction = () => appStore.dispatch(openGoToLine());
    register({
      key: 'g',
      meta: true,
      shortcutId: 'editor.go-to-line',
      // i18n-ignore (shortcut registry metadata, not rendered in UI)
      description: 'Go to Line (Mac)',
      action: openGoToLineAction,
    });
    // Cmd+Shift+F (Mac) / Ctrl+Shift+F (Win/Linux) -> search
    register({
      key: 'f',
      meta: isMac,
      ctrl: !isMac,
      shift: true,
      shortcutId: 'global.search',
      description: 'Search in files', // i18n-ignore (shortcut registry metadata, not rendered in UI)
      action: openSearch,
    });
    // Alt/Option + Z -> toggle word wrap (like VS Code)
    register({
      key: 'z',
      alt: true,
      shortcutId: 'editor.toggle-word-wrap',
      description: 'Toggle Word Wrap', // i18n-ignore (shortcut registry metadata, not rendered in UI)
      action: () => appStore.dispatch(toggleLineWrapping()),
    });
    // Ctrl+` -> toggle terminal overlay (matches VS Code behavior - Ctrl on all platforms including Mac)
    // Registered globally so it works on workspace and non-workspace pages alike.
    const toggleTerminal = () => {
      const isOnWorkspacePage = $page.url.pathname.startsWith('/workspace/');
      const terminalContextId = resolveTerminalShortcutWorkspaceId({
        isOnWorkspacePage,
        useSelectedWorkspace: false,
        selectedWorkspaceId: $currentWorkspaceTabId,
        routeWorkspaceId: currentWorkspaceId,
      });
      appStore.dispatch(toggleTerminalOverlay(terminalContextId));
    };
    register({
      key: '`',
      ctrl: true, // Ctrl on all platforms (including Mac) to match VS Code
      global: true, // Must work even when an input is focused
      description: 'Toggle Terminal Overlay', // i18n-ignore (shortcut registry metadata, not rendered in UI)
      action: toggleTerminal,
    });
    // NOTE: Cmd+` is intentionally NOT registered here — it is the native macOS shortcut
    // for cycling between application windows and must not be intercepted.
    // Use Ctrl+` or Cmd+J instead to toggle the terminal overlay.
    // Cmd+J (Mac) / Ctrl+J (Win/Linux) -> toggle Quake-style terminal overlay (alternate)
    // Works on workspace pages (using the route workspace ID) and non-workspace pages (using ROOT_WORKSPACE_ID).
    register({
      key: 'j',
      meta: isMac,
      ctrl: !isMac,
      description: 'Toggle Terminal Overlay', // i18n-ignore (shortcut registry metadata, not rendered in UI)
      action: toggleTerminal,
    });
    // Cmd+, (Mac) / Ctrl+, (Win/Linux) -> toggle settings
    register({
      key: ',',
      meta: isMac,
      ctrl: !isMac,
      shortcutId: 'global.settings',
      description: 'Toggle Settings', // i18n-ignore (shortcut registry metadata, not rendered in UI)
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

    register({
      key: '/',
      meta: isMac,
      ctrl: !isMac,
      description: 'Enhance Prompt', // i18n-ignore (shortcut registry metadata, not rendered in UI)
      action: () => dispatchWindowEvent('chat:enhance-prompt'),
    });
    register({
      key: 'a',
      meta: isMac,
      ctrl: !isMac,
      shift: true,
      description: 'Attach Files', // i18n-ignore (shortcut registry metadata, not rendered in UI)
      action: () => dispatchWindowEvent('chat:attach-files'),
    });
    register({
      key: 'h',
      meta: isMac,
      ctrl: !isMac,
      shift: true,
      description: 'Open HUD', // i18n-ignore (shortcut registry metadata, not rendered in UI)
      action: () => void invoke(IPC_CHANNELS.WINDOW.OPEN_NEW, { route: '/hud' }),
    });
    register({
      key: 'u',
      meta: isMac,
      ctrl: !isMac,
      shift: true,
      description: 'Open Usage Stats', // i18n-ignore (shortcut registry metadata, not rendered in UI)
      action: () => appStore.dispatch(setStatsOverlayOpen(true)),
    });

    // Cmd+? (Cmd+Shift+/) (Mac) / Ctrl+? (Ctrl+Shift+/) (Win/Linux) -> toggle keyboard shortcuts cheat sheet
    // Note: On US keyboards, Shift+/ produces '?', so we register both variants
    register({
      key: '?',
      meta: isMac,
      ctrl: !isMac,
      shift: true,
      shortcutId: 'global.keyboard-shortcuts',
      description: 'Toggle Keyboard Shortcuts', // i18n-ignore (shortcut registry metadata, not rendered in UI)
      action: () => appStore.dispatch(toggleCheatSheet('global')),
    });
    // Ctrl+Shift+F12 -> Feature Code Entry (hidden shortcut, all platforms)
    register({
      key: 'F12',
      ctrl: true,
      shift: true,
      global: true,
      description: 'Feature Code Entry', // i18n-ignore (shortcut registry metadata, not rendered in UI)
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
      description: 'Scroll Conversation Up', // i18n-ignore (shortcut registry metadata, not rendered in UI)
      skipInEditableElements: true,
      action: () => dispatchWindowEvent('navigate-message', { direction: 'previous' }),
    });

    // Cmd+Down (Mac) / Ctrl+Down (Win/Linux) -> Scroll to next message
    // Skip in editable elements to allow standard cursor navigation (move to end of document)
    register({
      key: 'ArrowDown',
      meta: isMac,
      ctrl: !isMac,
      description: 'Scroll Conversation Down', // i18n-ignore (shortcut registry metadata, not rendered in UI)
      skipInEditableElements: true,
      action: () => dispatchWindowEvent('navigate-message', { direction: 'next' }),
    });

    // Cmd+Alt+. (Mac) / Ctrl+Alt+. (Win/Linux) -> Open Model Picker
    register({
      key: '.',
      meta: isMac,
      ctrl: !isMac,
      alt: true,
      description: 'Open Model Picker', // i18n-ignore (shortcut registry metadata, not rendered in UI)
      action: () => dispatchWindowEvent('chat:open-model-picker'),
    });

    // Alt+Enter -> Resend Message (regenerate last response)
    register({
      key: 'Enter',
      alt: true,
      description: 'Resend Message', // i18n-ignore (shortcut registry metadata, not rendered in UI)
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
      if (workspacesIdleHandle !== null) cancelIdleCallback(workspacesIdleHandle);
      if (workspacesTimerHandle !== null) clearTimeout(workspacesTimerHandle);
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
      disposeInterruptedAgents();
      disposeQuitConfirmation();
    };
  });

  // Both modal actions go through the service so it stops the cross-window
  // watcher before sending the resolution request.
  async function handleResumeSelectedAgents(resumeIds: string[], abandonIds: string[]) {
    await resolveInterruptedAgents(new LiveAppClient(), resumeIds, abandonIds);
  }

  async function handleAbandonAllAgents(abandonIds: string[]) {
    await resolveInterruptedAgents(new LiveAppClient(), [], abandonIds);
  }

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
        toast.success(m.layout_appShell_githubConnected_toast(), {
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

  // Keep the workspace list warm when navigating away from workspace pages.
  beforeNavigate(({ to }: any) => {
    if (to && !to.url.pathname.startsWith('/workspace/')) {
      // Load workspaces when navigating to any non-workspace route
      // This ensures workspaces are loaded for tabs, switcher, and other UI components
      const state = appStore.state;
      if (!selectWorkspaceLoading.select(state)) {
        logger.debug('[+layout] Loading workspaces on navigation to non-workspace page');
        appStore.dispatch(loadWorkspacesRequested());
      }
    }
  });

  // Notify main process about workspace state for menu enabling/disabling
  afterNavigate(({ to }) => {
    if (!to) return;

    const pathname = to.url.pathname;
    // Check if we're in a workspace (not just creating one)
    const inWorkspace =
      pathname.startsWith('/workspace/') && !pathname.startsWith('/workspace/new');

    // Read the route-owned workspace ID from the navigation target.
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
    class="panel-layout-container relative h-screen w-screen overflow-hidden bg-transparent text-foreground flex flex-col"
    style:background-image={applicationShellTint}
    data-shell-opaque={!$shellTransparencyEnabled$ || undefined}
    aria-label={m.layout_appShell_shell_ariaLabel()}
    data-testid="app-ready"
  >
    <!-- Title bar at top -->
    <WindowTitleBar {workspaceId} />

    <!-- Main Content Area with Sidebar Nav -->
    <ErrorBoundary componentName="MainLayout">
      <div class="workspace-frame-row flex flex-1 min-h-0 bg-transparent pb-2 pl-2">
        <!-- Sidebar Panel (persistent, pushes content) -->
        <div
          class="workspace-sidebar-frame relative z-40 flex min-h-0 shrink-0 bg-transparent"
          data-sidebar-panel-frame
        >
          <SidebarPanel />
        </div>

        <!-- Workspace content area -->
        <div class="workspace-frame relative mr-2 flex min-h-0 min-w-0 flex-1 bg-transparent">
          <main
            class="workspace-main flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl bg-sidebar border border-border shadow-sm"
            aria-label={m.layout_appShell_mainContent_ariaLabel()}
          >
            <div class="flex-1 min-h-0 overflow-hidden">
              {@render children?.()}
            </div>

            <!-- Root Quake Terminal Overlay (self-gates on __root__ terminal state) -->
            <RootQuakeTerminalOverlay />
          </main>
        </div>
      </div>
    </ErrorBoundary>
  </div>

  <!-- Global Command Palette Mount -->
  <CommandPalette
    isOpen={$isPaletteOpen$}
    initialQuery={$paletteQuery$}
    {workspaceId}
    onClose={() => appStore.dispatch(closePalette())}
    onSelectFile={(detail: { path: string; line?: number; openInAdjacentPanel?: boolean }) => {
      if (workspaceId) {
        appStore.dispatch(
          openWorkspaceFile(workspaceId, detail.path, {
            line: detail.line,
            openInAdjacentPanel: detail.openInAdjacentPanel ?? false,
          }),
        );
      }
    }}
  />

  <!-- Product-route hardware-console overlays; HUD and sandbox routes sit outside this group. -->
  <ActionKeyHud />
  <RadialPromptPickerOverlay />
  <EncoderCycleHud />

  <StatsOverlay />

  <DaemonStoppedOverlay />
  <DaemonUpdatingOverlay />

  <KeyboardShortcutsCheatSheet />

  <AuggieSetupGate />

  <Toast />

  <!-- Once-per-session Node.js requirement warning (renders nothing itself) -->
  <NodeVersionToast />

  <!-- Link Hover Tooltip (singleton — shows URL + Cmd+Click hint on link hover) -->
  <LinkTooltip />

  <!-- Link Action Menu (singleton — anchored menu for GitHub issue/PR links) -->
  <LinkActionMenu />

  <!-- Offscreen keep-alive host for background-workspace browser tabs (monorepo#2789) -->
  <OffscreenWebviewHost excludedWorkspaceIds={offscreenExcludedWorkspaceIds} />

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
      workspaceId={$globalModals.gitCredentials.error?.workspaceId}
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

  <!-- Redux-owned delete/archive warning hosts (global for all workspace entrypoints) -->
  <WorkspaceWarningDialogs />

  <!-- Redux-owned Transfer/Download wizard host (global for all workspace entrypoints) -->
  <TransferWorkspaceModalHost />

  <!-- Redux-owned Import-from-file wizard host (opened from the File menu) -->
  <ImportWorkspaceModalHost />

  <SetupPromptDialog />

  <!-- Interrupted-agent recovery owns the startup modal slot. Keeping release
       notes in Redux while this component is unmounted avoids consuming the
       queued payload through the dialog's close callback. -->
  {#if !showInterruptedAgentsModal}
    <ReleaseNotesModal
      open={$showReleaseNotesModal$}
      releaseNotes={$releaseNotes$}
      onClose={() => appStore.dispatch(closeReleaseNotesModal())}
    />
  {/if}

  <FeatureCodeDialog
    open={$featureCodeDialogOpen}
    onClose={() => {
      if ($featureCodeDialogOpen) {
        appStore.dispatch(toggleFeatureCodeDialog());
      }
    }}
  />

  <!-- Interrupted Agents Modal (shown on connect/reconnect if agents were interrupted) -->
  <InterruptedAgentsModal
    bind:open={showInterruptedAgentsModal}
    agents={interruptedAgents}
    onResumeSelected={handleResumeSelectedAgents}
    onAbandonAll={handleAbandonAllAgents}
    onClose={() => {
      showInterruptedAgentsModal = false;
      notifyInterruptedAgentsModalClosed();
    }}
  />

  <!-- Quit Confirmation Modal (shown when main intercepts quit/restart) -->
  <QuitConfirmationModal
    bind:open={showQuitConfirmationModal}
    payload={quitConfirmationPayload}
    onRespond={(proceed) => {
      quitConfirmationPayload = null;
      respondToQuitConfirmation(proceed);
    }}
  />

  {#if import.meta.env.DEV}
    <DebugPanel />
  {/if}
</TooltipProvider>
