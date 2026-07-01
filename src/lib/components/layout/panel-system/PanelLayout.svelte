<script lang="ts">
  /**
   * PanelLayout - Root component for the panel system
   *
   * Manages the panel tree for a workspace and provides the context
   * for opening tabs, splitting panels, etc.
   */

  import {
  setContext,
  onMount,
  onDestroy,
  untrack,
} from 'svelte';
  import {
  getPanelLayoutManager,
  type PanelTab,
} from '$features/layout/panel-layout-adapter';
  import { invoke as ipcInvoke } from '$shared/generated/ipc-client';
  import {
  createPanelKeyboardShortcuts,
  registerPanelKeyboardShortcuts,
  unregisterPanelKeyboardShortcuts,
} from '$features/layout/panel-keyboard-shortcuts.svelte';
  import PanelContainer from './PanelContainer.svelte';
  import HandleDropOverlay from './HandleDropOverlay.svelte';
  import { terminalManager } from '$features/terminal/terminal-manager.svelte';
  import { terminalHistoryTracker } from '$features/terminal/terminal-history-tracker';
  import { appClient } from '$lib/client';
  import { selectIsTerminalOverlayOpen } from '$store/renderer/slices/terminals/terminals-selectors';
  import {
  get,
  writable,
} from 'svelte/store';
  import { isFocusInTerminal } from '$lib/utils/keyboardShortcuts';
  import { createLogger } from '$lib/utils/client-logger';
  import { dispatchWindowEvent } from '$lib/utils/window-events';
  import { track } from '$lib/services/analytics';

  import { fade } from 'svelte/transition';
  import {
  selectIsCollapsed,
  selectSidebarSide,
} from '$store/renderer/slices/ui-layout/ui-layout-selectors';
  import {
  flattenPanels,
  openTabFromConfig,
} from './panel-ai-layout-helpers';
  import { NoteId } from '$shared/types/branded-ids';
  import { updateNoteTitle } from '$features/notes/notes-write-service';
  import { renameWithUndo } from '$lib/utils/reversible-actions';
  import { updateSession as updateAgentSessionFields } from '$store/renderer/slices/agent-session/agent-session-slice';
  import { selectAgentSession } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import {
  invoke,
  listenSync,
} from '$lib/electron-bridge';

  import { IPC_CHANNELS } from '$shared/ipc-registry';
  import {
  selectPanelLayoutRoot,
  selectPanels,
  selectFocusedPanelId,
  selectFocusedPanel,
  selectActiveTab,
  selectAllTabs,
  selectPanelIds,
  selectRestoreStatus,
} from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import { focusBrowserTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
  import { closeActiveTerminalRequested, removeTerminal } from '$store/renderer/slices/terminals/terminals-slice';
  import { selectActiveWorkspaceId } from '$store/renderer/slices/workspace/workspace-selectors';
  import { renameAgentSessionRequested } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import { store as appStore } from '$store/renderer/store';

  const logger = createLogger('PanelLayout');
  const isCollapsed = selectIsCollapsed();
  const sidebarSide$ = selectSidebarSide();

  interface Props {
    workspaceId: string;
    /** Callbacks for creating new items (passed to panel tab bars) */
    onCreateAgent?: () => void;
    onCreateAgentWithSpecialist?: (specialistId: string | null) => void;
    onCreateNote?: () => void;
  }

  let { workspaceId, onCreateAgent, onCreateAgentWithSpecialist, onCreateNote }: Props = $props();

  // Reactive writable store that mirrors workspaceId so Redux selectors
  // re-evaluate whenever the prop changes (called at component init time).
  const workspaceIdStore = writable(workspaceId);
  $effect(() => {
    workspaceIdStore.set(workspaceId);
  });

  // Reactive selector subscriptions for template rendering
  const root$ = selectPanelLayoutRoot(workspaceIdStore);
  const panels$ = selectPanels(workspaceIdStore);
  const focusedPanelId$ = selectFocusedPanelId(workspaceIdStore);
  const activeTab$ = selectActiveTab(workspaceIdStore);
  const allTabs$ = selectAllTabs(workspaceIdStore);
  const restoreStatus$ = selectRestoreStatus(workspaceIdStore);
  const EMPTY_LAYOUT_LOADING_TIMEOUT_MS = 3000;

  let emptyLayoutLoadingTimedOut = $state(false);

  $effect(() => {
    const isUnresolved = $restoreStatus$ === 'empty' || $restoreStatus$ === 'idle';
    if (!isUnresolved || $allTabs$.length > 0) {
      untrack(() => {
        emptyLayoutLoadingTimedOut = false;
      });
      return;
    }

    untrack(() => {
      emptyLayoutLoadingTimedOut = false;
    });

    const timeoutId = window.setTimeout(() => {
      emptyLayoutLoadingTimedOut = true;
    }, EMPTY_LAYOUT_LOADING_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  });

  const shouldRenderPanelContainer = $derived(
    $restoreStatus$ === 'restored' ||
      $restoreStatus$ === 'invalid' ||
      (($restoreStatus$ === 'empty' || $restoreStatus$ === 'idle') &&
        ($allTabs$.length > 0 || emptyLayoutLoadingTimedOut)),
  );

  // Get or create the panel layout manager for this workspace (action methods only)
  let layoutManager = $derived(getPanelLayoutManager(workspaceId));

  // Create keyboard shortcuts manager and register it globally
  const keyboardShortcuts = createPanelKeyboardShortcuts(() => layoutManager);

  // Register keyboard shortcuts in cache so they can be accessed from outside
  $effect(() => {
    registerPanelKeyboardShortcuts(workspaceId, keyboardShortcuts);
    return () => {
      unregisterPanelKeyboardShortcuts(workspaceId);
    };
  });

  // Notify main process when a browser panel becomes the active/focused panel.
  // The main process uses this to route zoom shortcuts (Cmd+=/-/0) to the webview
  // instead of the main app when the browser panel is active.
  $effect(() => {
    const isBrowser = $activeTab$?.type === 'browser';
    invoke(IPC_CHANNELS.WINDOW.SET_BROWSER_FOCUSED, { browserFocused: !!isBrowser }).catch(() => {
      // Silently ignore errors (e.g., if main process handler not ready)
    });
  });

  // Terminal list state
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let terminals = $state<
    Array<{
      id: string;
      name: string;
      lastCommand?: string;
      lastOutput?: string;
      hasRunningProcess: boolean;
    }>
  >([]);

  // Load terminals - called explicitly when workspace changes or terminals update
  function loadTerminals(wsId: string) {
    const terminalMetadata = terminalManager.loadTerminalMetadata(wsId);
    terminals = terminalMetadata.map((t) => {
      const history = terminalHistoryTracker.getHistory(t.terminalId);
      return {
        id: t.terminalId,
        name: t.title || `Terminal ${t.terminalId.substring(0, 8)}`,
        lastCommand: history?.lastCommand,
        lastOutput: history?.lastOutput,
        hasRunningProcess: history?.isExecuting || false,
      };
    });
  }

  // Track last loaded to prevent redundant loads
  // Using a non-reactive variable to avoid dependency tracking
  let lastLoadedWorkspaceId: string | null = null;

  // Effect to load terminals when workspaceId changes
  // Terminal history updates are handled via the onMount subscription
  $effect(() => {
    const wsId = workspaceId;

    // Only reload if workspace changed
    if (wsId !== lastLoadedWorkspaceId) {
      lastLoadedWorkspaceId = wsId;
      // Use untrack to prevent the terminals state update from re-triggering effects
      untrack(() => {
        loadTerminals(wsId);
      });
    }
  });

  // Subscribe to terminal history updates via onMount
  // We track the first call to skip the immediate invocation that happens on subscribe
  onMount(() => {
    let isFirstCall = true;
    const unsubscribe = terminalHistoryTracker.updateCounter.subscribe(() => {
      // Skip the first call (immediate invocation on subscribe)
      // as we already load terminals in the $effect
      if (isFirstCall) {
        isFirstCall = false;
        return;
      }
      // Reload terminals when history updates
      loadTerminals(workspaceId);
    });
    return unsubscribe;
  });

  // Handler to create a new terminal via the daemon (`terminal.create`,
  // PROTOCOL §5.13). The daemon assigns the terminalId; we surface it as
  // `MutationResult.id` from the live client.
  async function handleCreateTerminal() {
    try {
      const result = await appClient.terminals.create({
        workspaceId,
        cols: 80,
        rows: 24,
      });

      if (result.success && result.id) {
        logger.info('Created new terminal', { terminalId: result.id });

        // Clear any stale Redux entry for this id before saving fresh metadata.
        // `saveTerminalMetadata` spreads the existing entry to preserve
        // customName across remounts, but for a freshly daemon-assigned id
        // (e.g. after a daemon restart that resets the id counter) a stale
        // customName from a previously renamed terminal must not carry over.
        appStore.dispatch(removeTerminal(workspaceId, result.id));

        // Save terminal metadata
        terminalManager.saveTerminalMetadata(result.id, workspaceId, 'Terminal');

        // Reload terminals to include the new one
        loadTerminals(workspaceId);

        // Open the new terminal as a tab in the panel layout
        layoutManager.openTab({
          type: 'terminal',
          title: 'Terminal',
          terminalId: result.id,
          closable: true,
        });

        // Track terminal creation
        track('Opened Terminal', { workspace_id: workspaceId, source: 'tab-bar' });
      } else if (!result.success) {
        logger.error('Failed to create terminal', { error: result.error });
      }
    } catch (error) {
      logger.error('Failed to create terminal', error);
    }
  }

  // Handler to open a new browser tab
  function handleOpenBrowser() {
    layoutManager.openBrowserPanel('about:blank');
  }

  // Provide a getter function to child components via context
  // This ensures they always get the current manager even if workspaceId changes
  setContext('panelLayoutManager', () => layoutManager);

  // Event handlers
  function handleFocusPanel(panelId: string) {
    layoutManager.focusPanel(panelId);
  }

  function handleTabClick(panelId: string, tabId: string) {
    layoutManager.focusPanel(panelId);
    layoutManager.setActiveTab(tabId, panelId);
  }

  function handleTabClose(panelId: string, tabId: string) {
    layoutManager.closeTab(tabId, panelId);
  }

  function handleTabReorder(panelId: string, fromIndex: number, toIndex: number) {
    layoutManager.reorderTabs(panelId, fromIndex, toIndex);
  }

  function handleCloseOtherTabs(panelId: string, tabId: string) {
    layoutManager.closeOtherTabs(tabId, panelId);
  }

  function handleCloseTabsToRight(panelId: string, tabId: string) {
    layoutManager.closeTabsToRight(tabId, panelId);
  }

  function handleCloseAllTabs(panelId: string) {
    layoutManager.closeAllTabs(panelId);
  }

  function handleCloseAllOthersEverywhere(panelId: string, tabId: string) {
    layoutManager.closeAllOthersEverywhere(tabId, panelId);
  }

  function handleSplitPanel(panelId: string, direction: 'horizontal' | 'vertical') {
    layoutManager.splitPanel(panelId, direction);
  }

  function handleClosePanel(panelId: string) {
    layoutManager.closePanel(panelId);
  }


  function handleZoomToggle(_panelId: string) {
    keyboardShortcuts.executeAction('zoom-toggle');
  }

  function handleUpdateSizes(nodePath: number[], sizes: number[]) {
    // nodePath represents the path to the split node whose sizes are being updated
    // Empty path means root
    layoutManager.updateSizes(nodePath, sizes);
  }

  function handleTabDropToSplit(
    targetPanelId: string,
    tabId: string,
    fromPanelId: string,
    zone: 'top' | 'bottom' | 'left' | 'right' | 'center',
  ) {
    if (zone === 'center') {
      // Move to panel, not split
      layoutManager.moveTabToPanel(tabId, fromPanelId, targetPanelId);
    } else {
      layoutManager.moveTabToSplit(tabId, fromPanelId, targetPanelId, zone);
    }
  }

  function handleTabMoveToPanel(
    targetPanelId: string,
    tabId: string,
    fromPanelId: string,
    insertIndex?: number,
  ) {
    layoutManager.moveTabToPanel(tabId, fromPanelId, targetPanelId, insertIndex);
  }

  function handleTabDropToSplitHandle(
    tabId: string,
    fromPanelId: string,
    nodePath: number[],
    position: 'before' | 'after',
    direction: 'horizontal' | 'vertical',
  ) {
    layoutManager.moveTabToSplitLevel(tabId, fromPanelId, nodePath, position, direction);
  }

  /**
   * Handle renaming a tab (note, agent, or file).
   * Shows a toast with undo support.
   */
  async function handleTabRename(tab: PanelTab, newName: string) {
    const oldName = tab.title || 'Untitled';

    if (tab.type === 'note' && tab.noteId) {
      // Rename note
      const noteId = NoteId(tab.noteId);
      await renameWithUndo(
        'note',
        oldName,
        newName,
        () => {
          void updateNoteTitle(workspaceId, noteId, newName);
          // Update the tab title in the layout manager
          layoutManager.updateTabTitle(tab.id, newName);
        },
        () => {
          void updateNoteTitle(workspaceId, noteId, oldName);
          layoutManager.updateTabTitle(tab.id, oldName);
        },
      );
    } else if (tab.type === 'agent' && tab.agentId) {
      // Rename agent
      const agentId = tab.agentId;
      // Capture the pre-rename nameExplicitlySet flag so revert paths can
      // restore the exact disk state. Auto-named sessions have
      // nameExplicitlySet: false; hardcoding true here would diverge Redux
      // from disk and permanently block MCP/automatic naming on failure.
      const preRenameSession = selectAgentSession.select(appStore.state, agentId);
      const oldNameExplicitlySet = preRenameSession?.nameExplicitlySet ?? false;
      await renameWithUndo(
        'agent',
        oldName,
        newName,
        async () => {
          appStore.dispatch(
            updateAgentSessionFields(agentId, {
              name: newName,
              nameExplicitlySet: true,
            } as any),
          );
          layoutManager.updateTabTitle(tab.id, newName);
          // Persist the rename via the lightweight IPC path so other windows
          // pick it up immediately (full saveSession would stall for minutes).
          try {
            const action = renameAgentSessionRequested(workspaceId, agentId, newName);
            appStore.dispatch(action);
            await action.promise;
          } catch (err) {
            // Revert optimistic UI so tab title and Redux match disk, then
            // rethrow so ReversibleActionManager surfaces the error toast
            // and skips the undo toast.
            appStore.dispatch(
              updateAgentSessionFields(agentId, {
                name: oldName,
                nameExplicitlySet: oldNameExplicitlySet,
              } as any),
            );
            layoutManager.updateTabTitle(tab.id, oldName);
            throw err;
          }
        },
        async () => {
          // Undo: restore old name with the captured nameExplicitlySet so
          // Redux matches what disk held before the rename.
          appStore.dispatch(
            updateAgentSessionFields(agentId, {
              name: oldName,
              nameExplicitlySet: oldNameExplicitlySet,
            } as any),
          );
          layoutManager.updateTabTitle(tab.id, oldName);
          try {
            const action = renameAgentSessionRequested(workspaceId, agentId, oldName);
            appStore.dispatch(action);
            await action.promise;
          } catch (err) {
            // Revert the revert: undo failed, so restore the new name in the UI
            // and rethrow so the user sees the error.
            appStore.dispatch(
              updateAgentSessionFields(agentId, {
                name: newName,
                nameExplicitlySet: true,
              } as any),
            );
            layoutManager.updateTabTitle(tab.id, newName);
            throw err;
          }
        },
      );
    }
    // Note: File renaming is more complex (involves filesystem) - skipping for now
  }

  /**
   * Dispatch an event to focus the content of a panel.
   * Content components (ChatPanel, NoteWithComments) listen for this event
   * and focus their main input element accordingly.
   * For other tab types, blur any currently focused element.
   */
  function dispatchFocusPanelContent(panelId: string) {
    const panel = layoutManager.getPanel(panelId);
    if (!panel || !panel.activeTabId) {
      // No active tab, blur any currently focused element
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      return;
    }

    const activeTab = panel.tabs.find((t) => t.id === panel.activeTabId);
    if (!activeTab) return;

    // Types that have focusable content that should receive focus
    const focusableTypes = ['agent', 'note', 'file'];

    // Use a delay to ensure panel switch animation/rendering is complete
    // and any click event processing from the source panel has finished
    setTimeout(() => {
      if (focusableTypes.includes(activeTab.type)) {
        // Dispatch event with panel and tab info - content components will handle focus
        dispatchWindowEvent('panel:focus-content', {
          panelId,
          tabId: activeTab.id,
          tabType: activeTab.type,
          agentId: activeTab.agentId,
          noteId: activeTab.noteId,
          workspaceId,
        });
      } else {
        // For other tab types (terminal, file, diff, browser, etc.),
        // blur any currently focused element to defocus from previous content
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
      }
    }, 100);
  }

  const terminalOverlayOpen = selectIsTerminalOverlayOpen();

  const isMac =
    typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');

  // Keyboard shortcuts
  function handleKeyDown(e: KeyboardEvent) {
    // First, let the leader key system handle it
    if (keyboardShortcuts.handleKeyDown(e)) {
      return;
    }

    // On Mac, "Mod" is Cmd (metaKey) only — Ctrl is reserved for Emacs bindings and other uses.
    // On Win/Linux, "Mod" is Ctrl.
    const isMod = isMac ? e.metaKey : e.ctrlKey;

    // Note: Mod+/ for keyboard shortcuts cheat sheet is handled globally in +layout.svelte
    // Do NOT add a handler here or it will toggle twice (once per handler)

    // Mod+Shift+T - Reopen last closed tab
    if (isMod && e.shiftKey && (e.key === 't' || e.key === 'T')) {
      e.preventDefault();
      e.stopPropagation();
      layoutManager.reopenClosedTab();
      logger.debug('Reopened last closed tab');
      return;
    }

    // Mod+\ - Split horizontally
    if (isMod && e.key === '\\' && !e.shiftKey) {
      e.preventDefault();
      const focusedId = selectFocusedPanelId.select(appStore.state, workspaceId);
      if (focusedId) {
        handleSplitPanel(focusedId, 'horizontal');
      }
      return;
    }

    // Mod+Shift+\ - Split vertically
    if (isMod && e.key === '\\' && e.shiftKey) {
      e.preventDefault();
      const focusedId = selectFocusedPanelId.select(appStore.state, workspaceId);
      if (focusedId) {
        handleSplitPanel(focusedId, 'vertical');
      }
      return;
    }

    // Mod+Shift+M - Toggle zoom on focused panel
    if (isMod && e.shiftKey && (e.key === 'm' || e.key === 'M')) {
      e.preventDefault();
      e.stopPropagation();
      keyboardShortcuts.executeAction('zoom-toggle');
      return;
    }

    // Mod+Shift+Enter - Toggle zoom on focused panel (alternative)
    if (isMod && e.shiftKey && e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      keyboardShortcuts.executeAction('zoom-toggle');
      return;
    }

    // Mod+W - Close current tab or empty panel (must use capture to intercept before browser)
    if (isMod && (e.key === 'w' || e.key === 'W') && !e.shiftKey) {
      // When a terminal is focused and Ctrl (not Cmd/Meta) is pressed, let the
      // event propagate to xterm so the shell receives Ctrl+W (delete word
      // backward). This applies on all platforms: on macOS Cmd+W is the standard
      // close-tab shortcut (metaKey), and on Linux/Windows Ctrl+W in a terminal
      // should also reach the shell.
      if (e.ctrlKey && !e.metaKey && isFocusInTerminal(e.target as HTMLElement)) {
        return;
      }

      // When the terminal overlay is open and focus is in the terminal area
      // (or the terminal overlay itself), close the active terminal tab
      // instead of a panel tab. isFocusInTerminal checks xterm focus;
      // we also check if focus is within the terminal overlay container
      // (e.g., right after creating a terminal before xterm gets focus).
      const terminalAreaFocused =
        isFocusInTerminal(e.target as HTMLElement) ||
        (e.target as HTMLElement)?.closest?.('.terminal-overlay');
      if (get(terminalOverlayOpen) && terminalAreaFocused) {
        e.preventDefault();
        e.stopPropagation();
        const activeWsId = selectActiveWorkspaceId.select(appStore.state);
        if (activeWsId) {
          appStore.dispatch(closeActiveTerminalRequested(activeWsId));
        }
        return;
      }

      // Always prevent default first to stop browser from closing the tab
      e.preventDefault();
      e.stopPropagation();

      const panel = selectFocusedPanel.select(appStore.state, workspaceId);
      logger.debug('Cmd+W pressed', {
        hasFocusedPanel: !!panel,
        activeTabId: panel?.activeTabId,
        tabCount: panel?.tabs.length,
      });

      if (panel) {
        if (panel.activeTabId) {
          // Close the active tab
          const tab = panel.tabs.find((t) => t.id === panel.activeTabId);
          // Default to closable unless explicitly set to false
          if (tab && tab.closable !== false) {
            logger.debug('Closing tab', { tabId: tab.id, title: tab.title });
            handleTabClose(panel.id, panel.activeTabId);
          }
        } else if (panel.tabs.length === 0) {
          // Panel is empty - close the panel itself
          logger.debug('Closing empty panel', { panelId: panel.id });
          handleClosePanel(panel.id);
        }
      }
      return;
    }

    // Cmd+PageDown - Next tab in focused panel
    // Cmd+PageUp - Previous tab in focused panel
    if (e.metaKey && !e.ctrlKey && (e.key === 'PageDown' || e.key === 'PageUp')) {
      const panel = selectFocusedPanel.select(appStore.state, workspaceId);
      if (panel && panel.tabs.length > 1) {
        e.preventDefault();
        const currentIndex = panel.tabs.findIndex((t) => t.id === panel.activeTabId);
        let newIndex: number;
        if (e.key === 'PageUp') {
          // Previous tab
          newIndex = currentIndex <= 0 ? panel.tabs.length - 1 : currentIndex - 1;
        } else {
          // Next tab
          newIndex = currentIndex >= panel.tabs.length - 1 ? 0 : currentIndex + 1;
        }
        layoutManager.setActiveTab(panel.tabs[newIndex].id, panel.id);
      }
      return;
    }

    // Mod+Shift+] (or }) or Cmd+Shift+PageDown - Next panel
    // Mod+Shift+[ (or {) or Cmd+Shift+PageUp - Previous panel
    // Note: Shift+] produces } and Shift+[ produces { on US keyboards, so we check for both
    //
    // IMPORTANT: These shortcuts are context-aware based on which section has focus:
    // - If terminal is open AND focused: Let terminal handle tab cycling (don't handle here)
    // - Otherwise: Cycle through panels
    if (
      isMod &&
      e.shiftKey &&
      (e.key === ']' ||
        e.key === '}' ||
        e.key === '[' ||
        e.key === '{' ||
        e.key === 'PageDown' ||
        e.key === 'PageUp')
    ) {
      // Check if terminal is open and has focus - let terminal handle its own tab cycling
      const terminalIsOpen = get(terminalOverlayOpen);
      const terminalHasFocus = isFocusInTerminal(e.target as HTMLElement);

      if (terminalIsOpen && terminalHasFocus) {
        // Terminal is focused - don't handle here, let QuakeTerminalOverlay handle it
        return;
      }

      // Handle panel cycling
      const panelIds = selectPanelIds.select(appStore.state, workspaceId);
      if (panelIds.length > 1) {
        e.preventDefault();
        const currentFocusedId = selectFocusedPanelId.select(
          appStore.state,
          workspaceId,
        );
        const currentIndex = currentFocusedId ? panelIds.indexOf(currentFocusedId) : -1;

        // Determine direction: ] or PageDown = next, [ or PageUp = previous
        const isNext = e.key === ']' || e.key === '}' || e.key === 'PageDown';
        const newIndex = isNext
          ? currentIndex >= panelIds.length - 1
            ? 0
            : currentIndex + 1
          : currentIndex <= 0
            ? panelIds.length - 1
            : currentIndex - 1;

        const newPanelId = panelIds[newIndex];
        layoutManager.focusPanel(newPanelId);
        dispatchFocusPanelContent(newPanelId);
      }
      return;
    }

    // Mod+1-9 - Switch to tab by index (only if tab exists)
    if (isMod && e.key >= '1' && e.key <= '9') {
      const panel = selectFocusedPanel.select(appStore.state, workspaceId);
      if (panel) {
        const tabIndex = parseInt(e.key) - 1;
        if (tabIndex < panel.tabs.length) {
          e.preventDefault();
          layoutManager.setActiveTab(panel.tabs[tabIndex].id, panel.id);
        }
        // Don't prevent default if no tab at that index - allow other handlers
      }
    }
  }

  // Use capture phase for Cmd+W to intercept before browser handles it
  onMount(() => {
    window.addEventListener('keydown', handleKeyDown, true);

    // Listen for terminal creation events
    const handleTerminalCreated = (event: any) => {
      const { workspaceId: eventWorkspaceId } = event;
      if (eventWorkspaceId === workspaceId) {
        // Reload terminals to include the new one
        loadTerminals(workspaceId);
      }
    };

    // Listen for layout:configure-panels events from AI-generated layouts
    const handleConfigurePanels = async (event: Event) => {
      const detail = (event as CustomEvent)?.detail;
      const panels = detail?.panels as Array<{
        tabs: Array<{
          type: string;
          agentId?: string;
          agentName?: string;
          noteId?: string;
          noteTitle?: string;
          filePath?: string;
          browserUrl?: string;
          createNew?: boolean;
          newAgentName?: string;
          title?: string;
        }>;
        activeTabIndex?: number;
      }>;

      if (!panels || !layoutManager) {
        logger.warn('Invalid configure-panels event', { detail });
        return;
      }

      const flatPanels = flattenPanels(panels);
      logger.info('Configuring panels from AI layout', {
        originalPanelCount: panels.length,
        flatPanelCount: flatPanels.length,
        flatPanels,
      });

      // Batch all changes into a single history entry
      await layoutManager.batchMutations(async () => {
        // Create the right number of panels using createGridLayout
        // This ensures we have exactly the number of panels needed
        const panelCount = Math.max(1, Math.min(flatPanels.length, 6)); // Cap at 6 panels
        const panelIds = layoutManager.createGridLayout(panelCount);
        logger.info('Created grid layout for AI panels', {
          panelIds,
          panelCount,
          flatPanelCount: flatPanels.length,
        });

        // Open tabs in each panel (createGridLayout already created fresh empty panels)
        for (
          let panelIndex = 0;
          panelIndex < flatPanels.length && panelIndex < panelIds.length;
          panelIndex++
        ) {
          const panelConfig = flatPanels[panelIndex];
          const panelId = panelIds[panelIndex];

          const tabs = panelConfig.tabs;
          logger.info('Processing panel tabs', {
            panelIndex,
            panelId,
            tabCount: tabs.length,
            tabs,
          });
          for (const tab of tabs) {
            await openTabFromConfig(tab, panelId, panelIndex, {
              layoutManager,
              workspaceId,
              logger,
            });
          }
        }
      });
    };

    document.addEventListener('layout:configure-panels', handleConfigurePanels);

    // Use listenSync for proper cleanup without race conditions
    const unsubTerminalCreated = listenSync('terminal:created', (event: any) => {
      handleTerminalCreated(event.payload || event);
    });

    // Listen for browser tab focus requests from main process (CDP agent).
    // Translate the IPC payload into a Redux action handled by the app-layout saga.
    const unsubBrowserFocus = listenSync('browser:focus-tab', (event: any) => {
      const tabId = event?.payload?.tabId;
      if (!tabId) {
        logger.warn('browser:focus-tab received without tabId', { event });
        return;
      }
      appStore.dispatch(focusBrowserTabRequested(workspaceId, tabId));
    });

    // Listen for browser tab list requests from main process
    const unsubBrowserListTabs = listenSync('browser:list-tabs-request', () => {
      // Collect all browser tabs from the panel layout
      const browserTabs = selectAllTabs
        .select(appStore.state, workspaceId)
        .filter((t) => t.type === 'browser')
        .map((t) => ({
          tabId: t.id,
          url: t.browserUrl || '',
          title: t.title || 'Browser',
        }));

      logger.debug('Responding to browser:list-tabs-request', { count: browserTabs.length });

      // Send the list back to main process
      if (typeof window !== 'undefined' && window.electronAPI) {
        void ipcInvoke('browser:list-tabs-response', { tabs: browserTabs });
      }
    });

    return () => {
      document.removeEventListener('layout:configure-panels', handleConfigurePanels);
      unsubTerminalCreated();
      unsubBrowserFocus();
      unsubBrowserListTabs();
    };
  });

  onDestroy(() => {
    window.removeEventListener('keydown', handleKeyDown, true);
    keyboardShortcuts.cleanup();
  });
</script>

<div class="panel-layout h-full w-full flex flex-col" aria-label="Panel layout">
  <!-- Main panel area -->
  <div
    class="flex-1 min-h-0 overflow-hidden {$isCollapsed
      ? 'p-3'
      : $sidebarSide$ === 'left'
        ? 'p-3 pl-0'
        : 'p-3 pr-0'}"
  >
    {#if shouldRenderPanelContainer}
      <PanelContainer
        node={$root$}
        panels={$panels$}
        focusedPanelId={$focusedPanelId$}
        zoomedPanelId={keyboardShortcuts.zoomedPanelId}
        {workspaceId}
        onFocusPanel={handleFocusPanel}
        onTabClick={handleTabClick}
        onTabClose={handleTabClose}
        onTabReorder={handleTabReorder}
        onCloseOtherTabs={handleCloseOtherTabs}
        onCloseTabsToRight={handleCloseTabsToRight}
        onCloseAllTabs={handleCloseAllTabs}
        onCloseAllOthersEverywhere={handleCloseAllOthersEverywhere}
        onSplitPanel={handleSplitPanel}
        onClosePanel={handleClosePanel}
        onZoomToggle={handleZoomToggle}
        onUpdateSizes={handleUpdateSizes}
        onTabDropToSplit={handleTabDropToSplit}
        onTabMoveToPanel={handleTabMoveToPanel}
        onTabDropToSplitHandle={handleTabDropToSplitHandle}
        onTabRename={handleTabRename}
        {onCreateAgent}
        {onCreateAgentWithSpecialist}
        {onCreateNote}
        onCreateTerminal={handleCreateTerminal}
        onOpenBrowser={handleOpenBrowser}
      />
    {/if}
  </div>
</div>

<!-- Leader key indicator -->
{#if keyboardShortcuts.leaderActive}
  <div
    class="fixed bottom-20 left-1/2 -translate-x-1/2 bg-popover border border-border rounded-lg shadow-lg px-4 py-2 z-50"
    transition:fade={{ duration: 100 }}
  >
    <div class="text-sm font-medium text-foreground">
      {#if keyboardShortcuts.showPanelNumbers}
        <span class="text-primary">Press 1-9</span> to jump to panel
      {:else}
        <span class="text-primary">⌘K</span> activated — press a key
        <span class="text-subtle ml-2"> h/j/k/l navigate • z zoom • % split • x close </span>
      {/if}
    </div>
  </div>
{/if}

<!-- Global overlay for split handle drop zones (renders outside overflow:hidden containers) -->
<HandleDropOverlay />

<style>
  .panel-layout {
    display: flex;
    flex-direction: column;
  }
</style>
