<script lang="ts">
/* eslint-disable max-lines */
  /**
   * QuakeTerminalOverlay - A sleek, Quake-style terminal overlay
   *
   * Features:
   * - Always-visible tab bar at bottom when terminals exist
   * - Smooth slide-up animation for terminal panel
   * - Multiple terminal tabs with close buttons
   * - Drag-to-resize handle
   * - Keyboard shortcuts (Ctrl+`, Cmd+J, Cmd+Shift+N, Cmd+W, Cmd+Shift+[/])
   * - Double-click to rename tabs
   * - Persisted height and custom names
   */
  import { sanitizeCommandForDisplay } from '$shared/utils/sanitize-credentials';
  import { untrack } from 'svelte';
  import { slide } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import {
    selectIsTerminalOverlayOpen,
    selectTerminalOverlayHeight,
    selectActiveTerminalId,
    selectTerminals,
  } from '$lib/store/slices/terminals/terminals-selectors';
  import {
    openTerminalOverlay,
    closeTerminalOverlay,
    toggleTerminalOverlay,
    selectTerminal,
    addTerminal,
    removeTerminal,
    setTerminalOverlayHeight,
    renameTerminal,
    type TerminalTab,
  } from '$lib/store/slices/terminals/terminals-slice';
  import { getDispatch } from '$lib/store/utils/svelte-context';
  import { ROOT_WORKSPACE_ID } from '$shared/types/branded-ids';
  import Terminal from './Terminal.svelte';
  import SetupScriptBanner from './SetupScriptBanner.svelte';
  import ScriptOutputViewer from './ScriptOutputViewer.svelte';
  import TerminalSidebar from './TerminalSidebar.svelte';
  import Fa from 'svelte-fa';
  import {
    faPlus,
    faXmark,
    faChevronDown,
    faChevronUp,
    faTerminal,
    faBan,
    faPlay,
    faStop,
    faRotateRight,
    faSpinner,
    faArrowUpRightFromSquare,
    faCircle,
    faPencil,
  } from '@fortawesome/free-solid-svg-icons';
  import { scriptsClient } from '$features/scripts/scripts.client';
  import type { ScriptWithState } from '$features/scripts/types';
  import { getReduxStore } from '$lib/store/redux-dispatch-bridge';
  import { selectScriptEntries, selectScriptById, selectScriptRuntime } from '$lib/store/slices/scripts/scripts-selectors';
  import { refreshScripts, initializeScripts, disposeScripts, removeScript } from '$lib/store/slices/scripts/scripts-slice';
  import { cn } from '$lib/utils';
  import { ListContainer, ListItem } from '$lib/components/ui/list';
  import { Tooltip, TooltipRich } from '$lib/components/ui/tooltip';
  import Button from '$lib/components/ui/button/button.svelte';
  import { terminalManager } from '$features/terminal/terminal-manager.svelte';
  import { track } from '$lib/services/analytics';
  import { terminalHistoryTracker } from '$features/terminal/terminal-history-tracker';
  import { isFocusInTerminal } from '$lib/utils/keyboardShortcuts';
  import type { WorkspaceId } from '$shared/types/branded-ids';
  import Header from '../ui/Header.svelte';

  // ============================================================================
  // Props & State
  // ============================================================================

  interface Props {
    workspaceId?: WorkspaceId;
  }

  let { workspaceId: propWorkspaceId }: Props = $props();

  // Store bindings
  const dispatch = getDispatch();
  const isOpen = selectIsTerminalOverlayOpen();
  const height = selectTerminalOverlayHeight();
  const activeTerminalId = selectActiveTerminalId();
  const terminals = selectTerminals();
  const scriptEntries$ = selectScriptEntries();

  // Workspace ID from props (required)
  const workspaceId = $derived(propWorkspaceId);
  const isRealWorkspace = $derived(
    !!workspaceId &&
      workspaceId !== 'new' &&
      workspaceId !== ROOT_WORKSPACE_ID &&
      !workspaceId.startsWith('optimistic-'),
  );
  // During onboarding (workspaceId === 'new') terminals are created under
  // ROOT_WORKSPACE_ID ('__root__') on the main process side. Pass this
  // effective ID to the Terminal component so it connects to the correct PTY.
  const terminalWorkspaceId = $derived(
    workspaceId === 'new' ? ROOT_WORKSPACE_ID : (workspaceId ?? ROOT_WORKSPACE_ID),
  );

  // UI state
  let isResizing = $state(false);
  let editingTerminalId = $state<string | null>(null);
  let editingValue = $state('');
  let isEditingHeaderName = $state(false);
  let headerEditValue = $state('');
  let selectedScriptId = $state<string | null>(null);
  let editingScriptTabId = $state<string | null>(null);
  let editingScriptTabValue = $state('');

  // Script header editing state
  let isEditingScriptName = $state(false);
  let editedScriptName = $state('');
  let showScriptEditPanel = $state(false);
  let editScriptCommandTextarea: HTMLInputElement | undefined = $state();
  let editedScriptCommand = $state('');

  let isDetectingScripts = $state(false);

  async function handleDetectScripts() {
    if (!workspaceId) return;
    isDetectingScripts = true;
    try {
      await scriptsClient.detect(workspaceId);
      dispatch(refreshScripts(workspaceId));
    } finally {
      isDetectingScripts = false;
    }
  }

  // Script Actions
  function getStatusColor(script: ScriptWithState): string {
    const { status, exitCode } = script.runtime;
    if (status === 'running') return 'bg-green-500';
    if (status === 'idle') return 'bg-muted-foreground/40';
    if (exitCode === 0 || exitCode === null || exitCode === undefined)
      return 'bg-muted-foreground/40';
    if (exitCode >= 128) return 'bg-muted-foreground/60';
    return 'bg-red-500';
  }

  function getStatusLabel(script: ScriptWithState): string {
    const { status, exitCode } = script.runtime;
    if (status === 'running') return 'Running';
    if (status === 'idle') return 'Idle';
    if (exitCode === 0) return 'Exited (0)';
    if (exitCode !== null && exitCode !== undefined) {
      if (exitCode >= 128) return `Stopped (signal ${exitCode - 128})`;
      return `Error (${exitCode})`;
    }
    return 'Exited';
  }

  function sortScripts(scripts: ScriptWithState[]): ScriptWithState[] {
    return [...scripts].sort((a, b) => {
      // Priority: running > exited > idle
      const statusPriority = { running: 0, exited: 1, idle: 2 };
      const aPriority = statusPriority[a.runtime.status] ?? 3;
      const bPriority = statusPriority[b.runtime.status] ?? 3;

      if (aPriority !== bPriority) return aPriority - bPriority;

      // Within same status, sort alphabetically by name
      return a.name.localeCompare(b.name);
    });
  }

  function getScriptActions(script: ScriptWithState) {
    const actions: Array<{
      icon: any;
      label: string;
      tooltip?: string;
      onClick: (e: MouseEvent) => void;
    }> = [];
    if (script.runtime.status === 'running') {
      actions.push({
        icon: faStop,
        label: 'Stop',
        onClick: () => handleScriptAction('stop', script.id),
      });
      actions.push({
        icon: faRotateRight,
        label: 'Restart',
        onClick: () => handleScriptAction('restart', script.id),
      });
    } else {
      actions.push({
        icon: faPlay,
        label: 'Start',
        onClick: () => handleScriptAction('start', script.id),
      });
    }
    return actions;
  }

  async function handleScriptAction(
    action: 'start' | 'stop' | 'restart' | 'delete',
    scriptId: string,
  ) {
    if (!workspaceId) return;
    if (action === 'start') await scriptsClient.start(workspaceId, scriptId);
    else if (action === 'stop') await scriptsClient.stop(workspaceId, scriptId);
    else if (action === 'restart') await scriptsClient.restart(workspaceId, scriptId);
    else if (action === 'delete') {
      await scriptsClient.remove(workspaceId, scriptId);
      dispatch(removeScript(workspaceId!, scriptId));
      if (selectedScriptId === scriptId) selectedScriptId = null;
    }
  }

  // ---- Script header state (for top header bar when script is selected) ----

  const selectedScript = $derived.by(() => {
    void $scriptEntries$; // trigger reactivity on script state changes
    return selectedScriptId ? selectScriptById.select(getReduxStore().getState(), selectedScriptId) : null;
  });
  const selectedScriptRuntime = $derived.by(() => {
    void $scriptEntries$; // trigger reactivity on script state changes
    return selectedScriptId ? selectScriptRuntime.select(getReduxStore().getState(), selectedScriptId) : null;
  });

  const STATUS_CONFIG: Record<string, { label: string; colorClass: string }> = {
    idle: { label: 'Idle', colorClass: 'text-zinc-400' },
    running: { label: 'Running', colorClass: 'text-green-500' },
    exited: { label: 'Exited', colorClass: 'text-red-400' },
  };

  const selectedScriptStatusInfo = $derived(
    selectedScriptRuntime
      ? (STATUS_CONFIG[selectedScriptRuntime.status] ?? STATUS_CONFIG.idle)
      : null,
  );

  function startEditingScriptName(): void {
    if (!selectedScript) return;
    isEditingScriptName = true;
    editedScriptName = selectedScript.name;
    requestAnimationFrame(() => {
      const input = document.querySelector('[data-edit-script-header-name]') as HTMLInputElement;
      input?.focus();
      input?.select();
    });
  }

  function finishEditingScriptName(): void {
    if (isEditingScriptName && selectedScript && selectedScriptId) {
      const trimmed = editedScriptName.trim();
      if (trimmed && trimmed !== selectedScript.name) {
        scriptsClient.update(workspaceId!, selectedScriptId, { name: trimmed });
        dispatch(refreshScripts(workspaceId!));
      }
    }
    isEditingScriptName = false;
  }

  function cancelEditingScriptName(): void {
    isEditingScriptName = false;
    editedScriptName = '';
  }

  function handleScriptNameKeydown(e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      finishEditingScriptName();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEditingScriptName();
    }
  }

  function startEditingScriptCommand(): void {
    if (!selectedScript) return;
    editedScriptCommand = selectedScript.command;
    showScriptEditPanel = true;
    requestAnimationFrame(() => {
      editScriptCommandTextarea?.focus();
    });
  }

  function cancelEditingScriptCommand(): void {
    showScriptEditPanel = false;
  }

  function saveScriptCommand(): void {
    if (selectedScript && selectedScriptId) {
      const updates: Record<string, any> = {};
      if (editedScriptCommand !== selectedScript.command) updates.command = editedScriptCommand;
      if (Object.keys(updates).length > 0) {
        scriptsClient.update(workspaceId!, selectedScriptId, updates);
        dispatch(refreshScripts(workspaceId!));
      }
    }
    showScriptEditPanel = false;
  }

  function handleScriptOpenUrl(): void {
    if (!selectedScriptRuntime?.detectedUrl) return;
    import('$features/layout/panel-layout-adapter')
      .then(({ getPanelLayoutManager }) => {
        const layoutManager = getPanelLayoutManager(workspaceId!);
        layoutManager.openBrowserPanel(selectedScriptRuntime.detectedUrl);
      })
      .catch(() => {
        window.open(selectedScriptRuntime.detectedUrl, '_blank');
      });
  }

  // Running scripts shown as tabs in the bottom bar
  const runningScripts = $derived(
    $scriptEntries$.filter((s) => s.runtime.status === 'running'),
  );

  // Constants
  const TAB_BAR_HEIGHT = 36; // h-9 = 2.25rem = 36px

  // ============================================================================
  // Effects
  // ============================================================================

  // Initialize scripts store at overlay level (persists across panel open/close)
  $effect(() => {
    if (isRealWorkspace && workspaceId) {
      untrack(() => dispatch(initializeScripts(workspaceId)));
    }
    return () => {
      if (isRealWorkspace && workspaceId) dispatch(disposeScripts(workspaceId));
    };
  });

  // Update CSS custom property for layout bottom padding
  $effect(() => {
    if (typeof document === 'undefined') return;

    const scriptCount = $scriptEntries$.length;
    const hasTerminals = isRealWorkspace && ($terminals.length > 0 || scriptCount > 0);
    const terminalIsOpen = $isOpen && $activeTerminalId;
    const terminalHeight = $height;

    function updateLayoutHeight() {
      let totalHeight = 0;
      if (hasTerminals) {
        totalHeight = TAB_BAR_HEIGHT;
        if (terminalIsOpen) {
          totalHeight += (terminalHeight / 100) * window.innerHeight;
        }
      }
      document.documentElement.style.setProperty('--terminal-overlay-height', `${totalHeight}px`);
    }

    updateLayoutHeight();
    window.addEventListener('resize', updateLayoutHeight);

    return () => {
      window.removeEventListener('resize', updateLayoutHeight);
      document.documentElement.style.removeProperty('--terminal-overlay-height');
    };
  });

  // Listen for custom events from terminal adapter (when terminal has focus).
  // RootQuakeTerminalOverlay listens for the same events on `window`, so we must
  // ignore events whose detail.workspaceId belongs to a different overlay context;
  // otherwise pressing Ctrl+` in a workspace terminal also toggles the root overlay.
  $effect(() => {
    if (typeof window === 'undefined') return;

    const wsId = isRealWorkspace ? workspaceId : null;
    if (!wsId) return;

    function isForThisWorkspace(event: Event): boolean {
      const detail = (event as CustomEvent<{ workspaceId?: string }>).detail;
      // Legacy callers without a detail target the workspace overlay by default.
      if (!detail || detail.workspaceId === undefined) return true;
      return detail.workspaceId === wsId;
    }

    function handleToggle(event: Event) {
      if (!isForThisWorkspace(event)) return;
      if (wsId) {
        dispatch(toggleTerminalOverlay(wsId));
      }
    }

    function handleCreateNew(event: Event) {
      if (!isForThisWorkspace(event)) return;
      createNewTerminal();
    }

    function handleCloseActive(event: Event) {
      if (!isForThisWorkspace(event)) return;
      if ($activeTerminalId) {
        closeTerminal($activeTerminalId);
      }
    }

    window.addEventListener('terminal:toggle-overlay', handleToggle);
    window.addEventListener('terminal:create-new', handleCreateNew);
    window.addEventListener('terminal:close-active', handleCloseActive);

    return () => {
      window.removeEventListener('terminal:toggle-overlay', handleToggle);
      window.removeEventListener('terminal:create-new', handleCreateNew);
      window.removeEventListener('terminal:close-active', handleCloseActive);
    };
  });

  // ============================================================================
  // Tab Display Logic
  // ============================================================================


  /** Split text into segments of plain text and localhost URLs */


  function getTabDisplayName(term: { id: string; name: string; customName?: string }): string {
    if (term.customName) return term.customName;
    const lastCommand = terminalHistoryTracker.getLastCommand(term.id);
    if (lastCommand) {
      const sanitized = sanitizeCommandForDisplay(lastCommand);
      return sanitized.length > 20 ? sanitized.slice(0, 20) + '…' : sanitized;
    }
    return term.name || 'Terminal';
  }

  // ============================================================================
  // Tab Editing
  // ============================================================================

  function startEditing(termId: string, currentName: string) {
    editingTerminalId = termId;
    editingValue = currentName;
    requestAnimationFrame(() => {
      const input = document.querySelector(`[data-edit-terminal="${termId}"]`) as HTMLInputElement;
      input?.focus();
      input?.select();
    });
  }

  function finishEditing() {
    if (editingTerminalId && workspaceId) {
      dispatch(renameTerminal(workspaceId, editingTerminalId, editingValue));
      editingTerminalId = null;
      editingValue = '';
    }
  }

  function cancelEditing() {
    editingTerminalId = null;
    editingValue = '';
  }

  // Script tab name editing
  function startEditingScriptTab(scriptId: string, currentName: string) {
    editingScriptTabId = scriptId;
    editingScriptTabValue = currentName;
    requestAnimationFrame(() => {
      const input = document.querySelector(
        `[data-edit-script-tab="${scriptId}"]`,
      ) as HTMLInputElement;
      input?.focus();
      input?.select();
    });
  }

  function finishEditingScriptTab() {
    if (editingScriptTabId && editingScriptTabValue.trim()) {
      scriptsClient.update(workspaceId!, editingScriptTabId, {
        name: editingScriptTabValue.trim(),
      });
      dispatch(refreshScripts(workspaceId!));
    }
    editingScriptTabId = null;
    editingScriptTabValue = '';
  }

  function handleEditScriptTabKeydown(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      finishEditingScriptTab();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      editingScriptTabId = null;
      editingScriptTabValue = '';
    }
  }

  // Header name editing
  function startEditingHeaderName() {
    if (!$activeTerminalId) return;
    const term = $terminals.find((t: TerminalTab) => t.id === $activeTerminalId);
    if (!term) return;
    isEditingHeaderName = true;
    headerEditValue = term.customName || term.name || 'Terminal';
    requestAnimationFrame(() => {
      const input = document.querySelector('[data-edit-header-terminal]') as HTMLInputElement;
      input?.focus();
      input?.select();
    });
  }

  function finishEditingHeaderName() {
    if (isEditingHeaderName && $activeTerminalId && workspaceId) {
      dispatch(renameTerminal(workspaceId, $activeTerminalId, headerEditValue));
    }
    isEditingHeaderName = false;
    headerEditValue = '';
  }

  function cancelEditingHeaderName() {
    isEditingHeaderName = false;
    headerEditValue = '';
  }

  function handleHeaderEditKeydown(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      finishEditingHeaderName();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEditingHeaderName();
    }
  }

  function handleEditKeydown(e: KeyboardEvent) {
    e.stopPropagation(); // Prevent parent tab from handling keydown
    if (e.key === 'Enter') {
      e.preventDefault();
      finishEditing();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEditing();
    }
  }

  // ============================================================================
  // Terminal Actions
  // ============================================================================

  function handleClose() {
    if (workspaceId) dispatch(closeTerminalOverlay(workspaceId));
  }

  function handleOpen() {
    if (workspaceId) {
      dispatch(openTerminalOverlay(workspaceId));
    }
  }

  let overlayContainer = $state<HTMLDivElement>();

  function createNewTerminal() {
    if (!workspaceId) return;
    const newId = `terminal-${Date.now()}`;
    dispatch(addTerminal(workspaceId, newId, `Terminal ${$terminals.length + 1}`));
    if (!$isOpen) {
      dispatch(openTerminalOverlay(workspaceId, newId));
    }
    track('Opened Terminal', { workspace_id: workspaceId, source: 'bottom-bar' });
    // Focus the overlay container immediately so keyboard shortcuts
    // (Cmd+T, Cmd+W) route to the terminal before xterm is ready
    requestAnimationFrame(() => {
      overlayContainer?.focus();
    });
  }

  function closeTerminal(termId: string, e?: MouseEvent) {
    e?.stopPropagation();
    if (workspaceId) dispatch(removeTerminal(workspaceId, termId));
    terminalManager.disposeTerminal(termId);
  }

  function clearActiveTerminal() {
    if ($activeTerminalId) {
      terminalManager.clearTerminal($activeTerminalId);
    }
  }

  // Track pending single click to differentiate from double-click
  let pendingClickTimeout: ReturnType<typeof setTimeout> | null = null;

  function handleTabClick(termId: string) {
    // Clear any pending click to prevent toggle on double-click
    if (pendingClickTimeout) {
      clearTimeout(pendingClickTimeout);
      pendingClickTimeout = null;
    }

    // Delay single-click action to allow double-click to cancel it
    pendingClickTimeout = setTimeout(() => {
      pendingClickTimeout = null;
      const wasShowingScript = selectedScriptId !== null;
      selectedScriptId = null;
      if (termId === $activeTerminalId && $isOpen && !wasShowingScript) {
        handleClose();
      } else {
        if (workspaceId) {
          dispatch(selectTerminal(workspaceId, termId));
          if (!$isOpen) {
            dispatch(openTerminalOverlay(workspaceId, termId));
          }
        }
      }
    }, 200);
  }

  function handleTabDoubleClick(termId: string, customName: string | undefined, e: MouseEvent) {
    e.stopPropagation();
    // Cancel pending single-click action
    if (pendingClickTimeout) {
      clearTimeout(pendingClickTimeout);
      pendingClickTimeout = null;
    }
    startEditing(termId, customName || '');
  }

  function cycleTerminal(direction: 1 | -1) {
    if (!$activeTerminalId || $terminals.length <= 1 || !workspaceId) return;
    const currentIndex = $terminals.findIndex((t: TerminalTab) => t.id === $activeTerminalId);
    const nextIndex = (currentIndex + direction + $terminals.length) % $terminals.length;
    dispatch(selectTerminal(workspaceId, $terminals[nextIndex].id));
  }

  // ============================================================================
  // Resize Handling
  // ============================================================================

  function startResize(event: MouseEvent) {
    event.preventDefault();
    isResizing = true;
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleResize);
    document.addEventListener('mouseup', stopResize);
  }

  function handleResize(event: MouseEvent) {
    if (!isResizing) return;
    const windowHeight = window.innerHeight;
    const newHeight = ((windowHeight - event.clientY) / windowHeight) * 100;
    dispatch(setTerminalOverlayHeight(newHeight));
  }

  function stopResize() {
    isResizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', handleResize);
    document.removeEventListener('mouseup', stopResize);
  }

  // ============================================================================
  // Keyboard Shortcuts
  // ============================================================================

  function handleKeydown(event: KeyboardEvent) {
    const isMod = event.metaKey || event.ctrlKey;

    // Note: Cmd+` is reserved for native macOS window cycling; use Ctrl+` or Cmd+J for terminal toggle

    // Only handle tab cycling when terminal is open
    if (!$isOpen) return;

    // Tab cycling shortcuts (Cmd+Shift+[/]) should only work when focus is in the terminal
    // This prevents conflicts with panel cycling shortcuts in PanelLayout
    const isTerminalFocused = isFocusInTerminal(event.target as HTMLElement | null);
    if (!isTerminalFocused) return;

    // Tab cycling (only with multiple terminals)
    if ($terminals.length <= 1) return;

    // Cmd+Shift+] - Next terminal
    // Note: Shift+] produces } on US keyboards, so we check for both
    if ((event.key === ']' || event.key === '}') && isMod && event.shiftKey) {
      event.preventDefault();
      event.stopImmediatePropagation(); // Prevent panel handler from also firing
      cycleTerminal(1);
      return;
    }

    // Cmd+Shift+[ - Previous terminal
    // Note: Shift+[ produces { on US keyboards, so we check for both
    if ((event.key === '[' || event.key === '{') && isMod && event.shiftKey) {
      event.preventDefault();
      event.stopImmediatePropagation(); // Prevent panel handler from also firing
      cycleTerminal(-1);
      return;
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if isRealWorkspace && workspaceId}
  <!-- Terminal Overlay Container - rendered within layout's terminal-overlay-container -->
  <!-- tabindex=-1 allows programmatic focus for keyboard shortcut routing -->
  <div
    bind:this={overlayContainer}
    tabindex="-1"
    class="terminal-overlay flex flex-col w-full outline-none"
  >
    <!-- Expanded Terminal Panel -->
    {#if $isOpen && ($activeTerminalId || selectedScriptId)}
      <div
        class="terminal-panel relative flex flex-col bg-sidebar border-t border-border shadow-2xl w-full"
        class:is-resizing={isResizing}
        style="height: {$height}vh;"
        transition:slide={{ axis: 'y', duration: 200, easing: cubicOut }}
      >
        <!-- Resize Handle - Sleek minimal design -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="absolute -top-1 left-0 right-0 h-3 cursor-ns-resize z-10 flex items-center justify-center group/resize"
          onmousedown={startResize}
        >
          <div
            class="w-9 h-1 rounded-sm bg-muted-foreground/20 transition-all duration-150 group-hover/resize:bg-muted-foreground/40 group-hover/resize:scale-x-110"
          ></div>
        </div>

        <!-- Header Bar -->
        <div class="flex items-center justify-between h-9 px-3 bg-background shrink-0">
          {#if selectedScriptId && selectedScript && selectedScriptRuntime && selectedScriptStatusInfo}
            <!-- Script Header Content -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="flex items-center gap-2 flex-1 min-w-0"
              onkeydown={(e) => {
                if (showScriptEditPanel) {
                  if (e.key === 'Escape') cancelEditingScriptCommand();
                  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                    e.preventDefault();
                    saveScriptCommand();
                  }
                }
              }}
            >
              <!-- Script name (editable) -->
              {#if isEditingScriptName}
                <input
                  type="text"
                  data-edit-script-header-name
                  bind:value={editedScriptName}
                  onblur={finishEditingScriptName}
                  onkeydown={handleScriptNameKeydown}
                  class="text-sm font-medium bg-transparent border-0 outline-none focus:outline-none! focus:ring-0! px-0 w-40 text-foreground/80 a11y-ignore"
                  placeholder="Script name"
                />
              {:else}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <span
                  class="text-sm font-medium text-foreground/80 cursor-pointer hover:text-foreground transition-colors whitespace-nowrap"
                  onclick={startEditingScriptName}
                  title="Click to rename script"
                >
                  {selectedScript.name}
                </span>
              {/if}

              <!-- Command (inline-editable) -->
              {#if showScriptEditPanel}
                <span class="text-green-500 font-semibold text-xs flex-shrink-0">$</span>
                <input
                  bind:this={editScriptCommandTextarea}
                  bind:value={editedScriptCommand}
                  class="text-xs font-mono bg-transparent border-0 outline-none focus:outline-none! focus:ring-0! px-0 text-muted-foreground flex-1 min-w-0"
                  placeholder="npm run dev"
                  spellcheck="false"
                />
              {:else}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <span
                  class="text-xs font-mono text-muted-foreground cursor-pointer hover:bg-muted/50 rounded px-1 transition-colors flex items-center gap-1 min-w-0"
                  onclick={startEditingScriptCommand}
                  title="Click to edit command"
                >
                  <span class="text-green-500 font-semibold flex-shrink-0">$</span>
                  <span class="truncate">{selectedScript.command}</span>
                </span>
              {/if}

              <!-- Status badge -->
              <span
                class="{selectedScriptStatusInfo.colorClass} flex items-center gap-1 text-xs whitespace-nowrap flex-shrink-0"
              >
                <Fa icon={faCircle} size="0.45em" />
                {selectedScriptStatusInfo.label}
              </span>

              <!-- Detected URL -->
              {#if selectedScriptRuntime.detectedUrl}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <button
                  class="text-blue-400 hover:underline text-xs flex items-center gap-1 cursor-pointer flex-shrink-0"
                  onclick={handleScriptOpenUrl}
                  title={selectedScriptRuntime.detectedUrl}
                >
                  <Fa icon={faArrowUpRightFromSquare} size="xs" />
                  <span class="max-w-[200px] truncate">{selectedScriptRuntime.detectedUrl}</span>
                </button>
              {/if}
            </div>

            <!-- Script Controls -->
            <div class="flex items-center gap-0.5 flex-shrink-0">
              {#if selectedScriptRuntime.status === 'running'}
                <Button
                  variant="ghost-light"
                  size="icon-xs"
                  onclick={() => handleScriptAction('stop', selectedScriptId!)}
                  tooltip="Stop"
                  aria-label="Stop script"
                >
                  <Fa icon={faStop} size="xs" />
                </Button>
                <Button
                  variant="ghost-light"
                  size="icon-xs"
                  onclick={() => handleScriptAction('restart', selectedScriptId!)}
                  tooltip="Restart"
                  aria-label="Restart script"
                >
                  <Fa icon={faRotateRight} size="xs" />
                </Button>
              {:else}
                <Button
                  variant="ghost-light"
                  size="icon-xs"
                  onclick={() => handleScriptAction('start', selectedScriptId!)}
                  tooltip="Start"
                  aria-label="Start script"
                >
                  <Fa icon={faPlay} size="xs" />
                </Button>
              {/if}

              {#if showScriptEditPanel}
                <Button
                  variant="ghost-light"
                  size="icon-xs"
                  onclick={cancelEditingScriptCommand}
                  tooltip="Cancel editing"
                  aria-label="Cancel editing"
                >
                  <Fa icon={faXmark} size="xs" />
                </Button>
              {:else}
                <Button
                  variant="ghost-light"
                  size="icon-xs"
                  onclick={startEditingScriptCommand}
                  tooltip="Edit command"
                  aria-label="Edit command"
                >
                  <Fa icon={faPencil} size="xs" />
                </Button>
              {/if}

              <!-- Collapse Button -->
              <Button
                variant="ghost-light"
                size="icon-xs"
                onclick={handleClose}
                tooltip="Collapse Terminal"
                tooltipShortcut="mod+`"
                aria-label="Collapse terminal"
              >
                <Fa icon={faChevronDown} size="xs" />
              </Button>
            </div>
          {:else}
            <!-- Terminal Header Content (original) -->
            <div class="flex items-center gap-2">
              <Fa icon={faTerminal} class="w-3.5 h-3.5 text-muted-foreground/75" />
              {#if isEditingHeaderName}
                <input
                  type="text"
                  data-edit-header-terminal
                  bind:value={headerEditValue}
                  onblur={finishEditingHeaderName}
                  onkeydown={handleHeaderEditKeydown}
                  class="text-sm font-medium bg-transparent border-0 outline-none focus:outline-none! focus:ring-0! px-0 w-40 text-foreground/80 a11y-ignore"
                  placeholder="Terminal name"
                />
              {:else}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <span
                  class="text-sm font-medium text-foreground/80 cursor-pointer hover:text-foreground transition-colors"
                  onclick={startEditingHeaderName}
                  ondblclick={startEditingHeaderName}
                  title="Click to rename terminal"
                >
                  {$terminals.find((t) => t.id === $activeTerminalId)?.customName ||
                    $terminals.find((t) => t.id === $activeTerminalId)?.name ||
                    'Terminal'}
                </span>
              {/if}
            </div>

            <!-- Clear and Collapse Buttons -->
            <div class="flex items-center gap-0.5">
              <!-- Clear Button -->
              <Button
                variant="ghost-light"
                size="icon-xs"
                onclick={clearActiveTerminal}
                tooltip="Clear Terminal"
                tooltipShortcut="⌘K"
                aria-label="Clear terminal"
              >
                <Fa icon={faBan} size="xs" />
              </Button>

              <!-- Collapse Button -->
              <Button
                variant="ghost-light"
                size="icon-xs"
                onclick={handleClose}
                tooltip="Collapse Terminal"
                tooltipShortcut="mod+`"
                aria-label="Collapse terminal"
              >
                <Fa icon={faChevronDown} size="xs" />
              </Button>
            </div>
          {/if}
        </div>

        <!-- Terminal Content with Sidebar -->
        <div class="flex-1 flex min-h-0 relative overflow-hidden">
          <!-- Terminal Content + Setup Script Editor -->
          <div class="flex-1 flex flex-col min-h-0 overflow-hidden">
            {#if selectedScriptId}
              {#key selectedScriptId}
                <ScriptOutputViewer
                  scriptId={selectedScriptId}
                  {workspaceId}
                  class="flex-1"
                  onDelete={() => {
                    selectedScriptId = null;
                  }}
                />
              {/key}
            {:else if $activeTerminalId}
              <!-- Terminal Content -->
              <div class="flex-1 overflow-hidden">
                {#key $activeTerminalId}
                  <Terminal terminalId={$activeTerminalId} workspaceId={terminalWorkspaceId} class="h-full w-full" />
                {/key}
              </div>
            {/if}

            <!-- Setup Script Banner - horizontal bar at bottom -->
            {#if isRealWorkspace}
              <SetupScriptBanner {workspaceId} />
            {/if}
          </div>

          <!-- Scripts Sidebar -->
          {#if isRealWorkspace}
            <TerminalSidebar
              {workspaceId}
              {selectedScriptId}
              onSelectScript={(id) => (selectedScriptId = id)}
              onSelectTerminal={(id) => {
                selectedScriptId = null;
                if (workspaceId) dispatch(selectTerminal(workspaceId, id));
              }}
            />
          {/if}
        </div>
      </div>
    {/if}

    <!-- Tab Bar - Always visible when terminals exist -->
    <div class="flex items-center justify-between h-9 px-1 bg-background backdrop-blur-xl">
      <!-- Tabs Container -->
      <div class="flex items-center h-full min-w-0 overflow-x-auto scrollbar-none">
        <!-- Terminal Icon - toggle panel -->
        <Button
          variant="ghost-light"
          size="icon-xs"
          class="mx-1 text-muted-foreground"
          onclick={() => ($isOpen ? handleClose() : handleOpen())}
          tooltip={$isOpen ? 'Collapse Terminal' : 'Expand Terminal'}
          tooltipShortcut="mod+`"
          aria-label={$isOpen ? 'Collapse terminal' : 'Expand terminal'}
        >
          <Fa icon={faTerminal} size="xs" />
        </Button>

        {#each $terminals as term (term.id)}
          {@const isActive = term.id === $activeTerminalId && $isOpen && selectedScriptId === null}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class={cn(
              'flex items-center gap-1.5 h-full px-2.5 text-sm font-medium text-muted-foreground cursor-pointer transition-all duration-150 min-w-0 max-w-90 whitespace-nowrap group/tab',
              'hover:text-foreground hover:bg-muted/80',
              isActive && 'text-foreground bg-sidebar shadow-sm',
            )}
            onclick={() => handleTabClick(term.id)}
            ondblclick={(e) => handleTabDoubleClick(term.id, term.customName, e)}
            onkeydown={(e) => e.key === 'Enter' && handleTabClick(term.id)}
            role="tab"
            tabindex="0"
            aria-selected={isActive}
          >
            <!-- Tab Label (editable) -->
            {#if editingTerminalId === term.id}
              <input
                type="text"
                data-edit-terminal={term.id}
                bind:value={editingValue}
                onblur={finishEditing}
                onkeydown={handleEditKeydown}
                onclick={(e) => e.stopPropagation()}
                placeholder="Name"
                class="w-60 p-0 border-none bg-transparent font-inherit text-inherit outline-none focus:outline-none! focus:ring-0!"
              />
            {:else}
              <span class="overflow-hidden text-ellipsis whitespace-nowrap"
                >{getTabDisplayName(term)}</span
              >
            {/if}

            <!-- Close Button - appears on hover -->
            <button
              type="button"
              class="ml-0.5 p-1 text-muted-foreground/50 hover:text-muted-foreground opacity-0 group-hover/tab:opacity-100 transition-opacity duration-150 cursor-pointer"
              onclick={(e) => closeTerminal(term.id, e)}
              aria-label="Close terminal"
            >
              <Fa icon={faXmark} size="xs" />
            </button>
          </div>
        {/each}

        <!-- Running Script Tabs -->
        {#each runningScripts as script (script.id)}
          {@const isScriptActive = selectedScriptId === script.id && $isOpen}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class={cn(
              'flex items-center gap-1.5 h-full px-2.5 text-sm font-medium text-muted-foreground cursor-pointer transition-all duration-150 min-w-0 max-w-90 whitespace-nowrap group/tab',
              'hover:text-foreground hover:bg-muted/80',
              isScriptActive && 'text-foreground bg-sidebar shadow-sm',
            )}
            onclick={() => {
              if (isScriptActive) {
                handleClose();
                selectedScriptId = null;
              } else {
                selectedScriptId = script.id;
                if (!$isOpen && workspaceId) {
                  dispatch(openTerminalOverlay(workspaceId));
                }
              }
            }}
            ondblclick={(e) => {
              e.stopPropagation();
              startEditingScriptTab(script.id, script.name);
            }}
            role="tab"
            tabindex="0"
            aria-selected={isScriptActive}
          >
            <div class="w-2 h-2 rounded-full bg-green-500 shrink-0"></div>
            {#if editingScriptTabId === script.id}
              <input
                type="text"
                data-edit-script-tab={script.id}
                bind:value={editingScriptTabValue}
                onblur={finishEditingScriptTab}
                onkeydown={handleEditScriptTabKeydown}
                onclick={(e) => e.stopPropagation()}
                placeholder="Name"
                class="w-60 p-0 border-none bg-transparent font-inherit text-inherit outline-none focus:outline-none! focus:ring-0!"
              />
            {:else}
              <span class="overflow-hidden text-ellipsis whitespace-nowrap">{script.name}</span>
              {#if script.runtime.detectedUrl}
                <button
                  type="button"
                  class="ml-auto p-1 text-muted-foreground/50 hover:text-foreground cursor-pointer transition-colors shrink-0"
                  onclick={(e) => {
                    e.stopPropagation();
                    const url = script.runtime.detectedUrl;
                    if (url) {
                      import('$features/layout/panel-layout-adapter')
                        .then(({ getPanelLayoutManager }) => {
                          const layoutManager = getPanelLayoutManager(workspaceId!);
                          layoutManager.openBrowserPanel(url);
                        })
                        .catch(() => {
                          window.open(url, '_blank');
                        });
                    }
                  }}
                  title="Open URL in browser"
                  aria-label="Open URL in browser"
                >
                  <Fa icon={faArrowUpRightFromSquare} size="xs" />
                </button>
              {/if}
            {/if}
          </div>
        {/each}
      </div>

      <!-- New Terminal Button (sticky, never scrolls) -->
      <Tooltip content="New Terminal" side="top" class="mr-auto pl-1" delayDuration={300}>
        <Button
          variant="ghost-light"
          size="icon-xs"
          class="text-muted-foreground/75 cursor-pointer a11y-ignore"
          onclick={createNewTerminal}
          aria-label="New terminal"
        >
          <Fa icon={faPlus} class="size-2.75" />
        </Button>
      </Tooltip>

      <!-- Right Actions -->
      <div class="flex items-center gap-1">
        {#if isRealWorkspace && $scriptEntries$.length === 0}
          <Button
            variant="ghost-light"
            size="sm"
            class="text-xs text-muted-foreground hover:text-foreground h-6 px-2 mr-1"
            onclick={handleDetectScripts}
            disabled={isDetectingScripts}
          >
            {#if isDetectingScripts}
              <Fa icon={faSpinner} spin size="sm" class="mr-1.5" /> Detecting...
            {:else}
              Detect Scripts
            {/if}
          </Button>
        {/if}

        {#if isRealWorkspace}
        <TooltipRich
          side="top"
          align="end"
          sideOffset={8}
          interactive
          delayDuration={400}
          maxWidth="16rem"
          contentContainerClass="p-0!"
        >
          {#snippet trigger()}
            <button
              type="button"
              class="flex items-center justify-center h-full px-2 text-muted-foreground/50 cursor-pointer hover:text-foreground transition-colors text-muted-foreground/75 relative"
              onclick={() => {
                if ($isOpen) {
                  handleClose();
                } else if (workspaceId) {
                  if ($terminals.length === 0) createNewTerminal();
                  dispatch(openTerminalOverlay(workspaceId));
                  const entries = selectScriptEntries.select(getReduxStore().getState());
                  if (entries.length > 0 && !selectedScriptId) {
                    selectedScriptId = entries[0].id;
                  }
                }
              }}
            >
              <div class="flex items-center gap-1.5">
                <Fa icon={faPlay} size="xs" />
                {#if $scriptEntries$.length > 0}
                  <span
                    class="text-xs bg-muted-foreground/20 text-foreground px-1 py-0.5 rounded leading-none"
                    >{$scriptEntries$.length}</span
                  >
                {/if}
              </div>
            </button>
          {/snippet}

          {#snippet content()}
            <div class="flex flex-col min-w-[200px] max-h-[300px] overflow-y-auto p-2 pt-2.5">
              <Header size={6} class="pb-1 px-1">Scripts</Header>
              {#if $scriptEntries$.length > 0}
                <ListContainer spacing="compact" class="py-0 px-0">
                  {#each sortScripts($scriptEntries$) as script (script.id)}
                    <ListItem
                      size="sm"
                      class="py-0.5! px-1! gap-1.5!"
                      title={script.name}
                      subtitle={script.command}
                      subtitleClass="leading-none"
                      active={selectedScriptId === script.id}
                      onclick={() => {
                        selectedScriptId = script.id;
                        if (!$isOpen && workspaceId) {
                          dispatch(openTerminalOverlay(workspaceId));
                        }
                      }}
                      actions={getScriptActions(script)}
                      actionsVisible="hover"
                      actionsClass="absolute right-0 top-1/2 -translate-y-1/2 bg-background px-1 rounded"
                    >
                      {#snippet iconSnippet()}
                        <div class="flex items-center justify-center w-3">
                          <div
                            class={cn('w-2 h-2 rounded-full', getStatusColor(script))}
                            title={getStatusLabel(script)}
                          ></div>
                        </div>
                      {/snippet}
                    </ListItem>
                  {/each}
                </ListContainer>
              {:else}
                <div class="text-xs text-muted-foreground italic p-2">No scripts detected yet</div>
              {/if}
            </div>
          {/snippet}
        </TooltipRich>
        {/if}

        <!-- Collapse/Expand Toggle -->
        <Button
          variant="ghost-light"
          size="icon-xs"
          onclick={() => ($isOpen ? handleClose() : handleOpen())}
          tooltip={$isOpen ? 'Collapse Terminal' : 'Expand Terminal'}
          tooltipShortcut="mod+`"
          aria-label={$isOpen ? 'Collapse terminal' : 'Expand terminal'}
        >
          <Fa icon={$isOpen ? faChevronDown : faChevronUp} size="xs" />
        </Button>
      </div>
    </div>
  </div>
{/if}

<style>
  .terminal-panel.is-resizing {
    user-select: none;
    pointer-events: none;
  }

  .terminal-panel.is-resizing :global(*) {
    pointer-events: none;
  }
</style>
