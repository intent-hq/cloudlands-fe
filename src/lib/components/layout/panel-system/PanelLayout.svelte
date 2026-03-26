<script lang="ts">
  /**
   * PanelLayout - Root component for the panel system
   *
   * Manages the panel tree for a workspace and provides the context
   * for opening tabs, splitting panels, etc.
   */

  import { setContext } from 'svelte';
  import {
    getPanelLayoutManager,
    type PanelTab,
  } from '$features/layout/panel-layout-manager.svelte';
  import {
    createPanelKeyboardShortcuts,
    registerPanelKeyboardShortcuts,
    unregisterPanelKeyboardShortcuts,
  } from '$features/layout/panel-keyboard-shortcuts.svelte';
  import PanelContainer from './PanelContainer.svelte';
  import HandleDropOverlay from './HandleDropOverlay.svelte';
  import { terminalManager } from '$features/terminal/terminal-manager.svelte';
  import { terminalHistoryTracker } from '$features/terminal/terminal-history-tracker';
  import { selectIsTerminalOverlayOpen } from '$lib/store/slices/terminals/terminals-selectors';
  import { get } from 'svelte/store';
  import { isFocusInTerminal } from '$lib/utils/keyboardShortcuts';
  import { createLogger } from '$lib/utils/client-logger';
  import { track } from '$lib/services/analytics';
  import { onMount, onDestroy, untrack } from 'svelte';
  import { fade } from 'svelte/transition';
  import { agentService } from '$features/agent/agent.service';
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import { layoutSettings } from '$features/layout/layout-settings.svelte';
  import { selectIsCollapsed } from '$lib/store/slices/ui-layout/ui-layout-selectors';
  import { notesStateManager } from '$features/notes/notes.store.svelte';
  import { NoteId } from '$shared/types/branded-ids';
  import { renameWithUndo } from '$lib/utils/reversible-actions';
  import { sessionStore } from '$features/agent/browser';
  import { invoke, listenSync } from '$lib/electron-bridge';
  import { IPC_CHANNELS } from '$shared/ipc-registry';

  const logger = createLogger('PanelLayout');
  const isCollapsed = selectIsCollapsed();

  interface Props {
    workspaceId: string;
    /** Callbacks for creating new items (passed to panel tab bars) */
    onCreateAgent?: () => void;
    onCreateNote?: () => void;
    onOpenBrowser?: () => void;
  }

  let { workspaceId, onCreateAgent, onCreateNote, onOpenBrowser }: Props = $props();

  // Get or create the panel layout manager for this workspace
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
    const isBrowser = layoutManager.focusedContent.type === 'browser';
    invoke(IPC_CHANNELS.WINDOW.SET_BROWSER_FOCUSED, { browserFocused: isBrowser }).catch(() => {
      // Silently ignore errors (e.g., if main process handler not ready)
    });
  });

  // Terminal list state
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

  // Handler to create a new terminal
  async function handleCreateTerminal() {
    try {
      const result = await window.electronAPI.invoke('terminal:professional:create', {
        workspaceId,
        cols: 80,
        rows: 24,
      });

      if (result.success && result.terminalId) {
        logger.info('Created new terminal', { terminalId: result.terminalId });

        // Save terminal metadata
        terminalManager.saveTerminalMetadata(result.terminalId, workspaceId, 'Terminal');

        // Reload terminals to include the new one
        loadTerminals(workspaceId);

        // Open the new terminal as a tab in the panel layout
        layoutManager.openTab({
          type: 'terminal',
          title: 'Terminal',
          terminalId: result.terminalId,
          closable: true,
        });

        // Track terminal creation
        track('Opened Terminal', { workspace_id: workspaceId, source: 'tab-bar' });
      }
    } catch (error) {
      logger.error('Failed to create terminal', error);
    }
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
          notesStateManager.updateNoteTitle(noteId, newName);
          // Update the tab title in the layout manager
          layoutManager.updateTabTitle(tab.id, newName);
        },
        () => {
          notesStateManager.updateNoteTitle(noteId, oldName);
          layoutManager.updateTabTitle(tab.id, oldName);
        },
      );
    } else if (tab.type === 'agent' && tab.agentId) {
      // Rename agent
      const agentId = tab.agentId;
      await renameWithUndo(
        'agent',
        oldName,
        newName,
        () => {
          sessionStore.updateSessionForWorkspace(workspaceId, agentId, { name: newName });
          layoutManager.updateTabTitle(tab.id, newName);
          // Save the session to persist the name change
          agentService.saveSession(agentId, workspaceId, true);
        },
        () => {
          sessionStore.updateSessionForWorkspace(workspaceId, agentId, { name: oldName });
          layoutManager.updateTabTitle(tab.id, oldName);
          agentService.saveSession(agentId, workspaceId, true);
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
        window.dispatchEvent(
          new CustomEvent('panel:focus-content', {
            detail: {
              panelId,
              tabId: activeTab.id,
              tabType: activeTab.type,
              agentId: activeTab.agentId,
              noteId: activeTab.noteId,
              workspaceId,
            },
          }),
        );
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
      const reopened = layoutManager.reopenClosedTab();
      if (reopened) {
        logger.debug('Reopened last closed tab');
      }
      return;
    }

    // Mod+\ - Split horizontally
    if (isMod && e.key === '\\' && !e.shiftKey) {
      e.preventDefault();
      const focusedId = layoutManager.focusedPanelId;
      if (focusedId) {
        handleSplitPanel(focusedId, 'horizontal');
      }
      return;
    }

    // Mod+Shift+\ - Split vertically
    if (isMod && e.key === '\\' && e.shiftKey) {
      e.preventDefault();
      const focusedId = layoutManager.focusedPanelId;
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
        window.dispatchEvent(new CustomEvent('terminal:close-active'));
        return;
      }

      // Always prevent default first to stop browser from closing the tab
      e.preventDefault();
      e.stopPropagation();

      const panel = layoutManager.focusedPanel;
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
      const panel = layoutManager.focusedPanel;
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
      const panelIds = layoutManager.getPanelIds();
      if (panelIds.length > 1) {
        e.preventDefault();
        const currentIndex = layoutManager.focusedPanelId
          ? panelIds.indexOf(layoutManager.focusedPanelId)
          : -1;

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
      const panel = layoutManager.focusedPanel;
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

    // Listen for workspace:open-note events to open notes as tabs in panels
    const handleOpenNote = (event: Event) => {
      const detail = (event as CustomEvent)?.detail;
      const noteId = detail?.noteId;
      const openInAdjacentPanel = detail?.openInAdjacentPanel ?? false;
      const sourcePanelId = detail?.sourcePanelId;

      if (noteId) {
        logger.debug('Received workspace:open-note event, opening in panel', {
          noteId,
          openInAdjacentPanel,
          sourcePanelId,
        });

        const tab = {
          type: 'note' as const,
          title: 'Note', // Title will be updated when the note loads
          closable: true,
          noteId,
          workspaceId,
        };

        if (openInAdjacentPanel) {
          layoutManager.openTabInAdjacentOrSplit(tab, sourcePanelId);
          // Focus the new panel after opening in adjacent
          if (layoutManager.focusedPanelId) {
            dispatchFocusPanelContent(layoutManager.focusedPanelId);
          }
        } else {
          layoutManager.openTab(tab);
        }
      }
    };

    // Listen for workspace:open-file events to open files as tabs in panels
    const handleOpenFile = (event: Event) => {
      const detail = (event as CustomEvent)?.detail;
      // Support both 'path' and 'filePath' for compatibility with different event sources
      const filePath = detail?.path || detail?.filePath;
      const line = detail?.line as number | undefined;
      const openInAdjacentPanel = detail?.openInAdjacentPanel ?? false;
      const sourcePanelId = detail?.sourcePanelId;

      if (filePath) {
        logger.debug('Received workspace:open-file event, opening in panel', {
          filePath,
          line,
          openInAdjacentPanel,
          sourcePanelId,
        });
        const fileName = filePath.split('/').pop() || filePath;

        const tab = {
          type: 'file' as const,
          title: fileName,
          closable: true,
          filePath,
          workspaceId,
          // Pass line number in data for CodeEditor to jump to
          // Include timestamp to force re-trigger even when navigating to same line
          data: line ? { line, jumpTimestamp: Date.now() } : undefined,
        };

        if (openInAdjacentPanel) {
          layoutManager.openTabInAdjacentOrSplit(tab, sourcePanelId);
          // Focus the new panel after opening in adjacent
          if (layoutManager.focusedPanelId) {
            dispatchFocusPanelContent(layoutManager.focusedPanelId);
          }
        } else {
          layoutManager.openTab(tab);
        }
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

      // Flatten nested panel structures (AI sometimes returns nested panels)
      const flattenPanels = (
        panelConfigs: typeof panels,
      ): Array<{ tabs: (typeof panels)[0]['tabs'] }> => {
        const result: Array<{ tabs: (typeof panels)[0]['tabs'] }> = [];
        for (const panel of panelConfigs) {
          if (Array.isArray(panel.tabs) && panel.tabs.length > 0) {
            // Panel has tabs directly - use it
            result.push({ tabs: panel.tabs });
          } else if ('panels' in panel && Array.isArray((panel as any).panels)) {
            // Panel has nested panels - flatten them
            result.push(...flattenPanels((panel as any).panels));
          }
        }
        return result;
      };

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
            await openTabFromConfig(tab, panelId, panelIndex);
          }
        }
      });
    };

    // Helper function to open a tab from AI config
    const openTabFromConfig = async (
      tab: {
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
      },
      panelId: string,
      panelIndex: number,
    ) => {
      switch (tab.type) {
        case 'agent':
          // For agent, either use existing agent ID or create new
          if (tab.agentId) {
            // Open existing agent
            layoutManager.openTab(
              {
                type: 'agent',
                title: tab.title || tab.agentName || 'Agent',
                closable: true,
                agentId: tab.agentId,
                workspaceId,
              },
              panelId,
            );
          } else {
            // Create a new agent session first, then open the tab
            const agentName = tab.newAgentName || tab.title || `Agent ${panelIndex + 1}`;
            try {
              const workspace = workspaceStore.findById(
                workspaceId as import('$shared/types').WorkspaceId,
              );
              if (workspace) {
                const newSession = await agentService.createSession(workspace, {
                  name: agentName,
                });
                if (newSession?.id) {
                  layoutManager.openTab(
                    {
                      type: 'agent',
                      title: agentName,
                      closable: true,
                      agentId: newSession.id,
                      workspaceId,
                    },
                    panelId,
                  );
                  logger.info('Created new agent for layout', {
                    agentId: newSession.id,
                    name: agentName,
                  });
                } else {
                  logger.error('Failed to create agent - no ID returned');
                }
              } else {
                logger.error('Cannot create agent - workspace not found', { workspaceId });
              }
            } catch (error) {
              logger.error('Failed to create agent for layout', { error, agentName });
            }
          }
          break;

        case 'note':
          layoutManager.openTab(
            {
              type: 'note',
              title: tab.title || tab.noteId || 'Note',
              closable: true,
              noteId: tab.noteId,
              workspaceId,
            },
            panelId,
          );
          break;

        case 'file':
          if (tab.filePath) {
            const fileName = tab.filePath.split('/').pop() || tab.filePath;
            layoutManager.openTab(
              {
                type: 'file',
                title: tab.title || fileName,
                closable: true,
                filePath: tab.filePath,
                workspaceId,
              },
              panelId,
            );
          }
          break;

        case 'terminal':
          layoutManager.openTab(
            {
              type: 'terminal',
              title: tab.title || 'Terminal',
              closable: true,
              workspaceId,
            },
            panelId,
          );
          break;

        case 'browser':
          layoutManager.openTab(
            {
              type: 'browser',
              title: tab.title || 'Browser',
              closable: true,
              browserUrl: tab.browserUrl || 'about:blank',
              workspaceId,
            },
            panelId,
          );
          break;

        case 'changes':
          layoutManager.openTab(
            {
              type: 'changes',
              title: tab.title || 'Changes',
              closable: true,
              workspaceId,
            },
            panelId,
          );
          break;

        case 'activity':
          layoutManager.openTab(
            {
              type: 'activity',
              title: tab.title || 'Activity',
              closable: true,
              workspaceId,
            },
            panelId,
          );
          break;

        default:
          logger.warn('Unknown content type', { type: tab.type });
      }
    };

    // Listen for workspace:open-local-changes events to open local changes as a tab
    const handleOpenLocalChanges = () => {
      logger.debug('Received workspace:open-local-changes event, opening in panel');
      layoutManager.openTab({
        type: 'local-changes',
        title: 'Space changes',
        closable: true,
        workspaceId,
      });
    };

    // Listen for workspace:open-chat-changes events to open chat changes as a tab
    const handleOpenChatChanges = (event: Event) => {
      const detail = (event as CustomEvent)?.detail as {
        changes: any[];
        title: string;
        messageId?: string;
        isAggregate?: boolean;
        agentId?: string;
        turnNumber?: number;
      };

      if (!detail?.changes) {
        logger.warn('workspace:open-chat-changes missing changes', { detail });
        return;
      }

      logger.debug('Received workspace:open-chat-changes event, opening in panel', {
        changesCount: detail.changes.length,
        title: detail.title,
      });

      layoutManager.openTab({
        type: 'chat-changes',
        title: detail.title || 'File Changes',
        closable: true,
        workspaceId,
        data: {
          changes: detail.changes,
          title: detail.title,
          messageId: detail.messageId,
          isAggregate: detail.isAggregate,
          agentId: detail.agentId,
          turnNumber: detail.turnNumber,
        },
      });
    };

    // Handle focus requests from other components
    const handleRequestFocus = (event: Event) => {
      const detail = (event as CustomEvent)?.detail;
      const panelId = detail?.panelId;
      if (panelId) {
        dispatchFocusPanelContent(panelId);
      }
    };

    window.addEventListener('workspace:open-note', handleOpenNote);
    window.addEventListener('workspace:open-file', handleOpenFile);
    window.addEventListener('workspace:open-local-changes', handleOpenLocalChanges);
    window.addEventListener('workspace:open-chat-changes', handleOpenChatChanges);
    window.addEventListener('panel:request-focus', handleRequestFocus);
    document.addEventListener('layout:configure-panels', handleConfigurePanels);

    // Use listenSync for proper cleanup without race conditions
    const unsubTerminalCreated = listenSync('terminal:created', (event: any) => {
      handleTerminalCreated(event.payload || event);
    });

    // Shared logic for focusing a browser tab by ID
    function focusBrowserTab(tabId: string) {
      if (!tabId) return;
      logger.debug('Focusing browser tab request', { tabId });
      for (const [panelId, panel] of Object.entries(layoutManager.layout.panels)) {
        const tab = panel.tabs.find((t) => t.id === tabId);
        if (tab) {
          logger.info('Focusing browser tab', { tabId, panelId });
          layoutManager.focusPanel(panelId);
          layoutManager.setActiveTab(tabId, panelId);
          return;
        }
      }
      logger.warn('Browser tab not found for focus request', { tabId });
    }

    // Listen for browser tab focus requests from main process (CDP agent)
    const unsubBrowserFocus = listenSync('browser:focus-tab', (event: any) => {
      const tabId = event?.payload?.tabId;
      if (!tabId) {
        logger.warn('browser:focus-tab received without tabId', { event });
        return;
      }
      focusBrowserTab(tabId);
    });

    // Listen for browser tab focus requests from renderer components (e.g., ToolDetails tab list)
    function handleBrowserFocusTabDom(e: Event) {
      const tabId = (e as CustomEvent).detail?.tabId;
      if (tabId) focusBrowserTab(tabId);
    }
    window.addEventListener('browser:focus-tab', handleBrowserFocusTabDom);

    // Listen for browser tab list requests from main process
    const unsubBrowserListTabs = listenSync('browser:list-tabs-request', () => {
      // Collect all browser tabs from the panel layout
      const browserTabs = layoutManager.allOpenTabs
        .filter((t) => t.type === 'browser')
        .map((t) => ({
          tabId: t.id,
          url: t.browserUrl || '',
          title: t.title || 'Browser',
        }));

      logger.debug('Responding to browser:list-tabs-request', { count: browserTabs.length });

      // Send the list back to main process
      window.electronAPI?.invoke('browser:list-tabs-response', { tabs: browserTabs });
    });

    return () => {
      window.removeEventListener('workspace:open-note', handleOpenNote);
      window.removeEventListener('workspace:open-file', handleOpenFile);
      window.removeEventListener('workspace:open-local-changes', handleOpenLocalChanges);
      window.removeEventListener('workspace:open-chat-changes', handleOpenChatChanges);
      window.removeEventListener('panel:request-focus', handleRequestFocus);
      window.removeEventListener('browser:focus-tab', handleBrowserFocusTabDom);
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
      : layoutSettings.sidebarSide === 'left'
        ? 'p-3 pl-0'
        : 'p-3 pr-0'}"
  >
    {#if layoutManager.layout}
      {@const currentFocusedPanelId = layoutManager.focusedPanelId}
      <PanelContainer
        node={layoutManager.layout.root}
        panels={layoutManager.layout.panels}
        focusedPanelId={currentFocusedPanelId}
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
        {onCreateNote}
        onCreateTerminal={handleCreateTerminal}
        {onOpenBrowser}
      />
    {:else}
      <div class="flex items-center justify-center h-full text-subtle">
        <p>Loading layout...</p>
      </div>
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
