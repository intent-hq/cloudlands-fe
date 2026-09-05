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
  import { onDestroy } from 'svelte';
  import { writable } from 'svelte/store';
  import {
    localizeDaemonTerminalName,
    terminalDisplayName,
  } from '$lib/utils/terminal-display-name';
  import {
    selectIsTerminalOverlayOpenForWorkspace,
    selectTerminalOverlayHeight,
    selectActiveTerminalIdForWorkspace,
    selectTerminalsForWorkspace,
    selectWorkspaceTerminalState,
  } from '$store/renderer/slices/terminals/terminals-selectors';
  import {
    openTerminalOverlay,
    closeTerminalOverlay,
    selectTerminal,
    addTerminal,
    removeTerminal,
    setTerminalOverlayHeight,
    renameTerminal,
    selectScript,
    clearScriptSelection,
    type TerminalTab,
  } from '$store/renderer/slices/terminals/terminals-slice';
  import { appClient } from '$lib/client';

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
    faChevronLeft,
    faTerminal,
    faBan,
    faPlay,
    faStop,
    faRotateRight,
    faSpinner,
    faTableColumns,
    faArrowUpRightFromSquare,
    faCircle,
    faPencil,
  } from '@fortawesome/free-solid-svg-icons';
  import { scriptsClient } from '$features/scripts/scripts.client';
  import type { ScriptWithState } from '$features/scripts/types';
  import {
    getScriptStatusKind,
    isLiveScriptStatus,
    type ScriptStatusKind,
  } from '$features/scripts/utils/script-status';
  import { toast } from '$lib/components/ui/toast';
  import { m } from '$shared/paraglide/messages.js';
  import { rewriteBrowserLinkForDisplay } from '$lib/utils/browser-url-resolution';
  import { resolveBrowserLinkForOpen } from '$lib/utils/browser-link-open';

  import {
    selectWorkspaceScriptEntries,
    selectWorkspaceScriptsInitialized,
  } from '$store/renderer/slices/scripts/scripts-selectors';
  import { refreshScripts, removeScript } from '$store/renderer/slices/scripts/scripts-slice';
  import { cn } from '$lib/utils';
  import { ListContainer, ListItem } from '$lib/components/ui/list';
  import { Tooltip, TooltipRich } from '$lib/components/ui/tooltip';
  import { Button } from '$lib/components/ui/button';
  import { terminalManager } from '$features/terminal/terminal-manager.svelte';
  import { terminalHistoryTracker } from '$features/terminal/terminal-history-tracker';
  import { isFocusInTerminal } from '$lib/utils/keyboardShortcuts';
  import type { WorkspaceId } from '$shared/types/branded-ids';
  import Header from '../ui/Header.svelte';
  import { store as appStore } from '$store/renderer/store';
  import { createTerminalOverlayResize } from './terminal-overlay-resize';
  import { getPanelLayoutManager } from '$features/layout/panel-layout-adapter';

  // ============================================================================
  // Props & State
  // ============================================================================

  interface Props {
    workspaceId?: WorkspaceId;
    showDockWhenClosed?: boolean;
  }

  let { workspaceId: propWorkspaceId, showDockWhenClosed = true }: Props = $props();

  // Workspace ID from props (required)
  const workspaceId = $derived(propWorkspaceId);
  const workspaceIdStore = writable<string>(ROOT_WORKSPACE_ID);
  $effect(() => workspaceIdStore.set(workspaceId ?? ROOT_WORKSPACE_ID));

  // Store bindings
  const isOpen = selectIsTerminalOverlayOpenForWorkspace(workspaceIdStore);
  const height = selectTerminalOverlayHeight();
  const activeTerminalId = selectActiveTerminalIdForWorkspace(workspaceIdStore);
  const terminals = selectTerminalsForWorkspace(workspaceIdStore);
  const workspaceTerminalState$ = selectWorkspaceTerminalState(workspaceIdStore);
  const scriptEntries$ = selectWorkspaceScriptEntries(workspaceIdStore);
  const scriptsInitialized$ = selectWorkspaceScriptsInitialized(workspaceIdStore);

  const workspaceOwnership = $derived.by(() => ({ workspaceId }));
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
  let resizePreviewHeight = $state<number | null>(null);
  const renderedHeight = $derived(resizePreviewHeight ?? $height);
  let editingTerminalId = $state<string | null>(null);
  let editingValue = $state('');
  let isEditingHeaderName = $state(false);
  let headerEditValue = $state('');
  const selectedScriptId = $derived($workspaceTerminalState$.selectedScriptId);
  let editingScriptTabId = $state<string | null>(null);
  let editingScriptTabValue = $state('');

  // Script header editing state
  let isEditingScriptName = $state(false);
  let editedScriptName = $state('');
  let showScriptEditPanel = $state(false);
  let editScriptCommandTextarea: HTMLInputElement | undefined = $state();
  let editedScriptCommand = $state('');

  let isDetectingScripts = $state(false);
  let terminalPanel: HTMLDivElement | undefined = $state();
  let mountedPanelWorkspaceId: string | null = $state(null);
  const panelIsVisible = $derived(
    $isOpen && ($activeTerminalId !== null || selectedScriptId !== null),
  );
  const shouldMountPanel = $derived(mountedPanelWorkspaceId === workspaceId);

  $effect(() => {
    if (panelIsVisible && workspaceId) mountedPanelWorkspaceId = workspaceId;
  });

  $effect(() => {
    if (
      !panelIsVisible &&
      terminalPanel &&
      typeof document !== 'undefined' &&
      terminalPanel.contains(document.activeElement)
    ) {
      overlayContainer?.focus({ preventScroll: true });
    }
  });

  function setSelectedScript(scriptId: string | null) {
    if (!workspaceId) return;
    appStore.dispatch(
      scriptId ? selectScript(workspaceId, scriptId) : clearScriptSelection(workspaceId),
    );
  }

  async function handleDetectScripts() {
    if (!workspaceId) return;
    isDetectingScripts = true;
    try {
      const result = await scriptsClient.detect(workspaceId);
      appStore.dispatch(refreshScripts(workspaceId));
      if (!result.success) {
        toast.error(result.error || m.terminal_quakeOverlay_detectFailed_error());
        return;
      }
      const detected = result.detected ?? 0;
      const added = result.added ?? 0;
      const removed = result.removed ?? 0;
      const changeParts: string[] = [];
      if (added > 0) changeParts.push(m.terminal_quakeOverlay_detectAdded_part({ count: added }));
      if (removed > 0)
        changeParts.push(m.terminal_quakeOverlay_detectRemoved_part({ count: removed }));
      const summary =
        changeParts.length > 0
          ? detected === 1
            ? m.terminal_quakeOverlay_detectedSummary_one({
                count: detected,
                changes: changeParts.join(', '),
              })
            : m.terminal_quakeOverlay_detectedSummary_many({
                count: detected,
                changes: changeParts.join(', '),
              })
          : detected === 1
            ? m.terminal_quakeOverlay_detectedNoNew_one({ count: detected })
            : m.terminal_quakeOverlay_detectedNoNew_many({ count: detected });
      if (detected === 0) {
        toast.info(m.terminal_quakeOverlay_noScriptsDetected_info());
      } else {
        toast.success(summary);
      }
      const skippedRunning = result.skippedRunning ?? [];
      if (skippedRunning.length > 0) {
        toast.warning(
          skippedRunning.length === 1
            ? m.scripts_detect_skippedRunning_one({ name: skippedRunning[0] })
            : m.scripts_detect_skippedRunning_many({
                count: skippedRunning.length,
                names: skippedRunning.join(', '),
              }),
        );
      }
    } finally {
      isDetectingScripts = false;
    }
  }

  // Script Actions
  const STATUS_CONFIG: Record<
    ScriptStatusKind,
    {
      label: (script: ScriptWithState) => string;
      dotClass: string;
      textClass: string;
    }
  > = {
    running: {
      label: () => m.terminal_quakeOverlay_status_running(),
      dotClass: 'bg-green-500',
      textClass: 'text-green-500',
    },
    restarting: {
      label: () => m.workspace_devScripts_restarting_label(),
      dotClass: 'bg-amber-500',
      textClass: 'text-amber-500',
    },
    idle: {
      label: () => m.terminal_quakeOverlay_status_idle(),
      dotClass: 'bg-muted-foreground/40',
      textClass: 'text-zinc-400',
    },
    succeeded: {
      label: () => m.terminal_quakeOverlay_status_exitedZero(),
      dotClass: 'bg-green-500',
      textClass: 'text-green-500',
    },
    failed: {
      label: (script) =>
        m.terminal_quakeOverlay_status_errorCode({ code: script.runtime.exitCode ?? 1 }),
      dotClass: 'bg-red-500',
      textClass: 'text-red-400',
    },
    stopped: {
      label: (script) =>
        m.terminal_quakeOverlay_status_stoppedSignal({
          signal: (script.runtime.exitCode ?? 128) - 128,
        }),
      dotClass: 'bg-muted-foreground/60',
      textClass: 'text-zinc-400',
    },
    exited: {
      label: () => m.terminal_quakeOverlay_status_exited(),
      dotClass: 'bg-muted-foreground/40',
      textClass: 'text-zinc-400',
    },
  };

  function getStatusInfo(script: ScriptWithState) {
    const config = STATUS_CONFIG[getScriptStatusKind(script.runtime)];
    return {
      dotClass: config.dotClass,
      textClass: config.textClass,
      get label() {
        return config.label(script);
      },
    };
  }

  function sortScripts(scripts: ScriptWithState[]): ScriptWithState[] {
    return [...scripts].sort((a, b) => {
      // Priority: live (running/restarting) > exited > idle
      const statusPriority = { running: 0, restarting: 0, exited: 1, idle: 2 };
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
    if (isLiveScriptStatus(script.runtime.status)) {
      actions.push({
        icon: faStop,
        label: m.terminal_quakeOverlay_stop_label(),
        onClick: () => handleScriptAction('stop', script.id),
      });
      actions.push({
        icon: faRotateRight,
        label: m.terminal_quakeOverlay_restart_label(),
        onClick: () => handleScriptAction('restart', script.id),
      });
    } else {
      actions.push({
        icon: faPlay,
        label: m.terminal_quakeOverlay_start_label(),
        onClick: () => handleScriptAction('start', script.id),
      });
    }
    return actions;
  }

  async function runScriptMutation(
    mutation: () => Promise<{ success: boolean; error?: string }>,
    fallbackError: string,
  ): Promise<boolean> {
    try {
      const result = await mutation();
      if (!result.success) {
        toast.error(result.error || fallbackError);
        return false;
      }
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : fallbackError);
      return false;
    }
  }

  export async function handleScriptAction(
    action: 'start' | 'stop' | 'restart' | 'delete',
    scriptId: string,
  ) {
    const ownership = workspaceOwnership;
    const mutationWorkspaceId = ownership.workspaceId;
    if (!mutationWorkspaceId) return;
    const scriptActionErrors = {
      start: m.terminal_quakeOverlay_startScriptFailed_error,
      stop: m.terminal_quakeOverlay_stopScriptFailed_error,
      restart: m.terminal_quakeOverlay_restartScriptFailed_error,
      delete: m.terminal_quakeOverlay_deleteScriptFailed_error,
    };
    const succeeded = await runScriptMutation(
      () => scriptsClient[action === 'delete' ? 'remove' : action](mutationWorkspaceId, scriptId),
      scriptActionErrors[action](),
    );
    if (!succeeded) return;

    if (action === 'delete') {
      const wasSelected =
        selectWorkspaceTerminalState.select(appStore.state, mutationWorkspaceId)
          .selectedScriptId === scriptId;
      appStore.dispatch(removeScript(mutationWorkspaceId, scriptId));
      if (wasSelected) appStore.dispatch(clearScriptSelection(mutationWorkspaceId));
    }
  }

  // ---- Script header state (for top header bar when script is selected) ----

  const selectedScript = $derived(
    selectedScriptId
      ? ($scriptEntries$.find((script) => script.id === selectedScriptId) ?? null)
      : null,
  );
  const selectedScriptRuntime = $derived(selectedScript?.runtime ?? null);

  // Display form of the selected script's detected URL: the loopback rewrite
  // only (daemon host in remote mode), NO probe and NO tunnel, so the chip
  // shows where the link actually points without side effects. The full
  // resolve (probe + tunnel) runs only on click.
  let displayedDetectedUrl = $state<string | null>(null);
  $effect(() => {
    const rawUrl = selectedScriptRuntime?.detectedUrl;
    if (!rawUrl) {
      displayedDetectedUrl = null;
      return;
    }
    displayedDetectedUrl = rawUrl;
    void rewriteBrowserLinkForDisplay(rawUrl, window.electronAPI?.invoke).then((rewritten) => {
      // Only apply if the detected URL hasn't changed while resolving.
      if (selectedScriptRuntime?.detectedUrl === rawUrl) {
        displayedDetectedUrl = rewritten;
      }
    });
  });

  const selectedScriptStatusInfo = $derived(selectedScript ? getStatusInfo(selectedScript) : null);

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

  async function finishEditingScriptName(): Promise<void> {
    const ownership = workspaceOwnership;
    const mutationWorkspaceId = ownership.workspaceId;
    const mutationScriptId = selectedScriptId;
    const mutationValue = editedScriptName;
    if (isEditingScriptName && selectedScript && mutationScriptId && mutationWorkspaceId) {
      const trimmed = mutationValue.trim();
      if (trimmed && trimmed !== selectedScript.name) {
        const succeeded = await runScriptMutation(
          () => scriptsClient.update(mutationWorkspaceId, mutationScriptId, { name: trimmed }),
          m.terminal_quakeOverlay_renameScriptFailed_error(),
        );
        if (!succeeded) return;
        appStore.dispatch(refreshScripts(mutationWorkspaceId));
        if (
          workspaceOwnership !== ownership ||
          selectedScriptId !== mutationScriptId ||
          editedScriptName !== mutationValue
        ) {
          return;
        }
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

  async function saveScriptCommand(): Promise<void> {
    const ownership = workspaceOwnership;
    const mutationWorkspaceId = ownership.workspaceId;
    const mutationScriptId = selectedScriptId;
    const mutationValue = editedScriptCommand;
    if (selectedScript && mutationScriptId && mutationWorkspaceId) {
      const updates: Record<string, any> = {};
      if (mutationValue !== selectedScript.command) updates.command = mutationValue;
      if (Object.keys(updates).length > 0) {
        const succeeded = await runScriptMutation(
          () => scriptsClient.update(mutationWorkspaceId, mutationScriptId, updates),
          m.terminal_quakeOverlay_updateCommandFailed_error(),
        );
        if (!succeeded) return;
        appStore.dispatch(refreshScripts(mutationWorkspaceId));
        if (
          workspaceOwnership !== ownership ||
          selectedScriptId !== mutationScriptId ||
          editedScriptCommand !== mutationValue
        ) {
          return;
        }
      }
    }
    showScriptEditPanel = false;
  }

  // Resolve a script's detected URL (rewrite → probe → tunnel; toasts on
  // resolver warning/error) BEFORE opening the browser panel on it.
  function openScriptUrl(rawUrl: string): void {
    void resolveBrowserLinkForOpen(rawUrl).then((resolved) => {
      import('$features/layout/panel-layout-adapter')
        .then(({ getPanelLayoutManager }) => {
          const layoutManager = getPanelLayoutManager(workspaceId!);
          layoutManager.openBrowserPanel(resolved.url, undefined, undefined, resolved.requestedUrl);
        })
        .catch(() => {
          window.open(resolved.url, '_blank');
        });
    });
  }

  function handleScriptOpenUrl(): void {
    if (!selectedScriptRuntime?.detectedUrl) return;
    openScriptUrl(selectedScriptRuntime.detectedUrl);
  }

  function moveSelectionToPanel(): void {
    if (!workspaceId) return;
    const activeTerminal = $terminals.find((terminal) => terminal.id === $activeTerminalId);
    if (selectedScript) {
      getPanelLayoutManager(workspaceId).openUserTab({
        type: 'terminal',
        title: selectedScript.name,
        scriptId: selectedScript.id,
        workspaceId,
        closable: true,
      });
    } else if (activeTerminal) {
      getPanelLayoutManager(workspaceId).openUserTab({
        type: 'terminal',
        title: terminalDisplayName(activeTerminal),
        terminalId: activeTerminal.id,
        workspaceId,
        closable: true,
      });
    } else {
      return;
    }
    appStore.dispatch(closeTerminalOverlay(workspaceId));
  }

  // Live and previously-running scripts shown as tabs in the bottom bar.
  const runningScripts = $derived(
    $scriptEntries$.filter(
      (s) => isLiveScriptStatus(s.runtime.status) || s.runtime.previouslyRunning === true,
    ),
  );

  async function dismissPreviouslyRunningTab(scriptId: string, event: MouseEvent) {
    event.stopPropagation();
    if (!workspaceId) return;
    const succeeded = await runScriptMutation(
      () => scriptsClient.stop(workspaceId, scriptId),
      m.terminal_quakeOverlay_dismissScriptTab_ariaLabel(),
    );
    if (succeeded) appStore.dispatch(refreshScripts(workspaceId));
  }

  // Constants
  const TAB_BAR_HEIGHT = 36; // h-9 = 2.25rem = 36px

  // ============================================================================
  // Effects
  // ============================================================================

  // Update CSS custom property for layout bottom padding
  $effect(() => {
    if (typeof document === 'undefined') return;

    const scriptCount = $scriptEntries$.length;
    const hasTerminals = isRealWorkspace && ($terminals.length > 0 || scriptCount > 0);
    const terminalIsOpen = $isOpen && $activeTerminalId;
    const terminalHeight = renderedHeight;

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

    function handleCreateNew(event: Event) {
      if (!isForThisWorkspace(event)) return;
      createNewTerminal();
    }

    window.addEventListener('workspace:new-terminal', handleCreateNew);

    return () => {
      window.removeEventListener('workspace:new-terminal', handleCreateNew);
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
    return localizeDaemonTerminalName(term.name) || m.terminal_quakeOverlay_terminal_fallback();
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
      appStore.dispatch(renameTerminal(workspaceId, editingTerminalId, editingValue));
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

  async function finishEditingScriptTab() {
    const ownership = workspaceOwnership;
    const mutationWorkspaceId = ownership.workspaceId;
    const mutationScriptId = editingScriptTabId;
    const mutationValue = editingScriptTabValue;
    if (mutationScriptId && mutationValue.trim() && mutationWorkspaceId) {
      const succeeded = await runScriptMutation(
        () =>
          scriptsClient.update(mutationWorkspaceId, mutationScriptId, {
            name: mutationValue.trim(),
          }),
        m.terminal_quakeOverlay_renameScriptFailed_error(),
      );
      if (!succeeded) return;
      appStore.dispatch(refreshScripts(mutationWorkspaceId));
      if (
        workspaceOwnership !== ownership ||
        editingScriptTabId !== mutationScriptId ||
        editingScriptTabValue !== mutationValue
      ) {
        return;
      }
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
    headerEditValue = terminalDisplayName(term);
    requestAnimationFrame(() => {
      const input = document.querySelector('[data-edit-header-terminal]') as HTMLInputElement;
      input?.focus();
      input?.select();
    });
  }

  function finishEditingHeaderName() {
    if (isEditingHeaderName && $activeTerminalId && workspaceId) {
      appStore.dispatch(renameTerminal(workspaceId, $activeTerminalId, headerEditValue));
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
    if (workspaceId) appStore.dispatch(closeTerminalOverlay(workspaceId));
  }

  function handleOpen() {
    if (workspaceId) {
      appStore.dispatch(openTerminalOverlay(workspaceId));
    }
  }

  let overlayContainer = $state<HTMLDivElement>();

  let isCreatingTerminal = false;

  async function createNewTerminal() {
    if (!workspaceId || isCreatingTerminal) return;
    const createWorkspaceId = workspaceId;
    isCreatingTerminal = true;
    try {
      // eslint-disable-next-line intent/no-component-async-data-fetch -- mutation must return the daemon-assigned PTY id before the Redux tab is created
      const result = await appClient.terminals.create({
        workspaceId: createWorkspaceId,
        cols: 80,
        rows: 24,
      });
      if (!result.success || !result.id) {
        toast.error(m.terminal_adapter_openFailed_error());
        return;
      }
      const stale = workspaceId !== createWorkspaceId;
      if (!stale) {
        appStore.dispatch(
          addTerminal(
            createWorkspaceId,
            result.id,
            m.terminal_quakeOverlay_terminalNumber_label({ number: $terminals.length + 1 }),
          ),
        );
      }
      if (stale) return;
      if (!$isOpen) appStore.dispatch(openTerminalOverlay(createWorkspaceId, result.id));
      requestAnimationFrame(() => overlayContainer?.focus());
    } catch {
      toast.error(m.terminal_adapter_openFailed_error());
    } finally {
      isCreatingTerminal = false;
    }
  }

  function closeTerminal(termId: string, e?: MouseEvent) {
    e?.stopPropagation();
    if (workspaceId) appStore.dispatch(removeTerminal(workspaceId, termId));
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
      if (termId === $activeTerminalId && $isOpen && !wasShowingScript) {
        handleClose();
      } else {
        if (workspaceId) {
          appStore.dispatch(selectTerminal(workspaceId, termId));
          if (!$isOpen) {
            appStore.dispatch(openTerminalOverlay(workspaceId, termId));
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
    appStore.dispatch(selectTerminal(workspaceId, $terminals[nextIndex].id));
  }

  // ============================================================================
  // Resize Handling
  // ============================================================================

  const { start: startResize, stop: stopResize } = createTerminalOverlayResize({
    getHeight: () => $height,
    setPreviewHeight: (height) => (resizePreviewHeight = height),
    setResizing: (resizing) => (isResizing = resizing),
    commitHeight: (height) => appStore.dispatch(setTerminalOverlayHeight(height)),
  });

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

  onDestroy(() => {
    if (pendingClickTimeout) {
      clearTimeout(pendingClickTimeout);
      pendingClickTimeout = null;
    }
    stopResize();
  });
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
    <div
      class="terminal-panel-spacer"
      class:is-visible={panelIsVisible}
      style="--terminal-panel-height: {renderedHeight}vh;"
      aria-hidden="true"
    ></div>

    <!-- Keep the expensive panel subtree mounted after its first reveal. -->
    {#if shouldMountPanel}
      <div
        bind:this={terminalPanel}
        class="terminal-panel relative flex flex-col bg-sidebar border-t border-border shadow-2xl w-full"
        class:is-resizing={isResizing}
        class:is-visible={panelIsVisible}
        style="height: {renderedHeight}vh;"
        aria-hidden={!panelIsVisible}
        inert={!panelIsVisible}
      >
        <!-- Resize Handle - Sleek minimal design -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="app-resize-handle absolute -top-2 left-0 right-0 z-10 h-4"
          data-resize-axis="y"
          data-resize-indicator="short"
          data-resizing={isResizing}
          onmousedown={startResize}
        ></div>

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
              <div class="relative inline-flex min-w-0 items-center">
                {#if isEditingScriptName}
                  <input
                    type="text"
                    data-edit-script-header-name
                    bind:value={editedScriptName}
                    onblur={finishEditingScriptName}
                    onkeydown={handleScriptNameKeydown}
                    class="inline-edit-input relative z-10 w-40 border-0 bg-transparent px-0 text-sm font-medium text-foreground/80 outline-none focus:outline-none! focus:ring-0! a11y-ignore"
                    placeholder={m.terminal_quakeOverlay_scriptName_placeholder()}
                  />
                {:else}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <span
                    class="relative z-10 cursor-text whitespace-nowrap text-sm font-medium text-foreground/80 transition-colors hover:text-foreground"
                    onclick={startEditingScriptName}
                    title={m.terminal_quakeOverlay_renameScript_tooltip()}
                  >
                    {selectedScript.name}
                  </span>
                {/if}
                <span
                  aria-hidden="true"
                  class="pointer-events-none absolute z-0 rounded-(--radius-small) border transition-[inset,border-color,background-color] duration-(--motion-standard) ease-(--ease-standard) motion-reduce:transition-none {isEditingScriptName
                    ? '-inset-x-2 -inset-y-1.5 border-ring/60 bg-background'
                    : '-inset-x-1 -inset-y-0.5 border-transparent bg-transparent'}"
                ></span>
              </div>

              <!-- Command (inline-editable) -->
              <div class="relative flex min-w-0 flex-1 items-center gap-1">
                {#if showScriptEditPanel}
                  <span class="relative z-10 flex-shrink-0 text-xs font-semibold text-green-500"
                    >$</span
                  >
                  <input
                    bind:this={editScriptCommandTextarea}
                    bind:value={editedScriptCommand}
                    class="inline-edit-input relative z-10 min-w-0 flex-1 border-0 bg-transparent px-0 font-mono text-xs text-muted-foreground outline-none focus:outline-none! focus:ring-0!"
                    placeholder={/* i18n-ignore (shell command example) */ 'npm run dev'}
                    spellcheck="false"
                  />
                {:else}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <span
                    class="relative z-10 flex min-w-0 cursor-text items-center gap-1 rounded px-1 font-mono text-xs text-muted-foreground transition-colors hover:bg-muted/50"
                    onclick={startEditingScriptCommand}
                    title={m.terminal_quakeOverlay_editCommand_tooltip()}
                  >
                    <span class="flex-shrink-0 font-semibold text-green-500">$</span>
                    <span class="truncate">{selectedScript.command}</span>
                  </span>
                {/if}
                <span
                  aria-hidden="true"
                  class="pointer-events-none absolute z-0 rounded-(--radius-small) border transition-[inset,border-color,background-color] duration-(--motion-standard) ease-(--ease-standard) motion-reduce:transition-none {showScriptEditPanel
                    ? '-inset-x-2 -inset-y-1.5 border-ring/60 bg-background'
                    : '-inset-x-1 -inset-y-0.5 border-transparent bg-transparent'}"
                ></span>
              </div>

              <!-- Status badge -->
              <span
                class="{selectedScriptStatusInfo.textClass} flex items-center gap-1 text-xs whitespace-nowrap flex-shrink-0"
                title={selectedScriptStatusInfo.label}
              >
                <Fa icon={faCircle} size="0.45em" />
                {selectedScriptStatusInfo.label}
              </span>

              <!-- Detected URL (display shows the rewrite-only form) -->
              {#if selectedScriptRuntime.detectedUrl}
                {@const shownUrl = displayedDetectedUrl ?? selectedScriptRuntime.detectedUrl}
                <Button
                  variant="plain"
                  class="text-blue-400 hover:underline text-xs flex items-center gap-1 cursor-pointer flex-shrink-0"
                  onclick={handleScriptOpenUrl}
                  title={shownUrl}
                >
                  <Fa icon={faArrowUpRightFromSquare} size="xs" />
                  <span class="max-w-[200px] truncate">{shownUrl}</span>
                </Button>
              {/if}
            </div>

            <!-- Script Controls -->
            <div class="flex items-center gap-0.5 flex-shrink-0">
              <Button
                variant="ghost-light"
                size="icon-xs"
                onclick={moveSelectionToPanel}
                tooltip={m.workspace_shell_showInPanel_tooltip()}
                aria-label={m.workspace_shell_showInPanel_tooltip()}
                data-move-to-panel
              >
                <Fa icon={faTableColumns} size="xs" />
              </Button>
              {#if isLiveScriptStatus(selectedScriptRuntime.status)}
                <Button
                  variant="ghost-light"
                  size="icon-xs"
                  onclick={() => handleScriptAction('stop', selectedScriptId!)}
                  tooltip={m.terminal_quakeOverlay_stop_label()}
                  aria-label={m.terminal_quakeOverlay_stopScript_ariaLabel()}
                >
                  <Fa icon={faStop} size="xs" />
                </Button>
                <Button
                  variant="ghost-light"
                  size="icon-xs"
                  onclick={() => handleScriptAction('restart', selectedScriptId!)}
                  tooltip={m.terminal_quakeOverlay_restart_label()}
                  aria-label={m.terminal_quakeOverlay_restartScript_ariaLabel()}
                >
                  <Fa icon={faRotateRight} size="xs" />
                </Button>
              {:else}
                <Button
                  variant="ghost-light"
                  size="icon-xs"
                  onclick={() => handleScriptAction('start', selectedScriptId!)}
                  tooltip={m.terminal_quakeOverlay_start_label()}
                  aria-label={m.terminal_quakeOverlay_startScript_ariaLabel()}
                >
                  <Fa icon={faPlay} size="xs" />
                </Button>
              {/if}

              {#if showScriptEditPanel}
                <Button
                  variant="ghost-light"
                  size="icon-xs"
                  onclick={cancelEditingScriptCommand}
                  tooltip={m.terminal_quakeOverlay_cancelEditing_tooltip()}
                  aria-label={m.terminal_quakeOverlay_cancelEditing_tooltip()}
                >
                  <Fa icon={faXmark} size="xs" />
                </Button>
              {:else}
                <Button
                  variant="ghost-light"
                  size="icon-xs"
                  onclick={startEditingScriptCommand}
                  tooltip={m.terminal_quakeOverlay_editCommand_label()}
                  aria-label={m.terminal_quakeOverlay_editCommand_label()}
                >
                  <Fa icon={faPencil} size="xs" />
                </Button>
              {/if}

              <!-- Collapse Button -->
              <Button
                variant="ghost-light"
                size="icon-xs"
                onclick={handleClose}
                tooltip={m.terminal_quakeOverlay_collapse_tooltip()}
                tooltipShortcut="mod+`"
                aria-label={m.terminal_quakeOverlay_collapse_ariaLabel()}
              >
                <Fa icon={faChevronDown} size="xs" />
              </Button>
            </div>
          {:else}
            <!-- Terminal Header Content (original) -->
            <div class="flex items-center gap-2">
              <Fa icon={faTerminal} class="w-3.5 h-3.5 text-muted-foreground/75" />
              <div class="relative inline-flex min-w-0 items-center">
                {#if isEditingHeaderName}
                  <input
                    type="text"
                    data-edit-header-terminal
                    bind:value={headerEditValue}
                    onblur={finishEditingHeaderName}
                    onkeydown={handleHeaderEditKeydown}
                    class="inline-edit-input relative z-10 w-40 border-0 bg-transparent px-0 text-sm font-medium text-foreground/80 outline-none focus:outline-none! focus:ring-0! a11y-ignore"
                    placeholder={m.terminal_quakeOverlay_terminalName_placeholder()}
                  />
                {:else}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <span
                    class="relative z-10 cursor-text text-sm font-medium text-foreground/80 transition-colors hover:text-foreground"
                    onclick={startEditingHeaderName}
                    ondblclick={startEditingHeaderName}
                    title={m.terminal_quakeOverlay_renameTerminal_tooltip()}
                  >
                    {terminalDisplayName($terminals.find((t) => t.id === $activeTerminalId) ?? {})}
                  </span>
                {/if}
                <span
                  aria-hidden="true"
                  class="pointer-events-none absolute z-0 rounded-(--radius-small) border transition-[inset,border-color,background-color] duration-(--motion-standard) ease-(--ease-standard) motion-reduce:transition-none {isEditingHeaderName
                    ? '-inset-x-2 -inset-y-1.5 border-ring/60 bg-background'
                    : '-inset-x-1 -inset-y-0.5 border-transparent bg-transparent'}"
                ></span>
              </div>
            </div>

            <!-- Clear and Collapse Buttons -->
            <div class="flex items-center gap-0.5">
              <Button
                variant="ghost-light"
                size="icon-xs"
                onclick={moveSelectionToPanel}
                tooltip={m.workspace_shell_showInPanel_tooltip()}
                aria-label={m.workspace_shell_showInPanel_tooltip()}
                data-move-to-panel
              >
                <Fa icon={faTableColumns} size="xs" />
              </Button>
              <!-- Clear Button -->
              <Button
                variant="ghost-light"
                size="icon-xs"
                onclick={clearActiveTerminal}
                tooltip={m.terminal_quakeOverlay_clear_tooltip()}
                tooltipShortcut="⌘K"
                aria-label={m.terminal_quakeOverlay_clear_ariaLabel()}
              >
                <Fa icon={faBan} size="xs" />
              </Button>

              <!-- Collapse Button -->
              <Button
                variant="ghost-light"
                size="icon-xs"
                onclick={handleClose}
                tooltip={m.terminal_quakeOverlay_collapse_tooltip()}
                tooltipShortcut="mod+`"
                aria-label={m.terminal_quakeOverlay_collapse_ariaLabel()}
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
            {#if $activeTerminalId}
              <div
                class="flex-1 overflow-hidden"
                class:hidden={selectedScriptId !== null}
                data-terminal-content
                aria-hidden={selectedScriptId !== null}
                inert={selectedScriptId !== null}
              >
                {#key terminalWorkspaceId + ':' + $activeTerminalId}
                  <Terminal
                    terminalId={$activeTerminalId}
                    workspaceId={terminalWorkspaceId}
                    visible={panelIsVisible && selectedScriptId === null}
                    class="h-full w-full"
                  />
                {/key}
              </div>
            {/if}

            {#if selectedScriptId}
              {#key `${workspaceId}:${selectedScriptId}`}
                <ScriptOutputViewer
                  scriptId={selectedScriptId}
                  {workspaceId}
                  class="flex-1"
                  onDelete={() => {
                    setSelectedScript(null);
                  }}
                />
              {/key}
            {/if}

            <!-- Setup Script Banner - horizontal bar at bottom -->
            {#if isRealWorkspace}
              <SetupScriptBanner {workspaceId} />
            {/if}
          </div>

          <!-- Scripts Sidebar -->
          {#if isRealWorkspace}
            {#key workspaceId}
              <TerminalSidebar
                {workspaceId}
                {selectedScriptId}
                onSelectScript={(id) => setSelectedScript(id)}
                onSelectTerminal={(id) => {
                  if (workspaceId) appStore.dispatch(selectTerminal(workspaceId, id));
                }}
                onCreateTerminal={createNewTerminal}
              />
            {/key}
          {/if}
        </div>
      </div>
    {/if}

    <!-- Contextual tab bar; workspace pages use the sidebar dock while collapsed. -->
    {#if showDockWhenClosed || $isOpen}
      <div class="flex items-center justify-between h-9 px-1 bg-background backdrop-blur-xl">
        <!-- Tabs Container -->
        <div class="flex items-center h-full min-w-0 overflow-x-auto scrollbar-none">
          <!-- Terminal Icon - toggle panel -->
          <Button
            variant="ghost-light"
            size="icon-xs"
            class="mx-1 text-muted-foreground"
            onclick={() => ($isOpen ? handleClose() : handleOpen())}
            tooltip={$isOpen
              ? m.terminal_quakeOverlay_collapse_tooltip()
              : m.terminal_quakeOverlay_expand_tooltip()}
            tooltipShortcut="mod+`"
            aria-label={$isOpen
              ? m.terminal_quakeOverlay_collapse_ariaLabel()
              : m.terminal_quakeOverlay_expand_ariaLabel()}
          >
            <Fa icon={faTerminal} size="xs" />
          </Button>

          {#each $terminals as term (term.id)}
            {@const isActive =
              term.id === $activeTerminalId && $isOpen && selectedScriptId === null}
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
              <div class="relative inline-flex min-w-0 items-center">
                {#if editingTerminalId === term.id}
                  <input
                    type="text"
                    data-edit-terminal={term.id}
                    bind:value={editingValue}
                    onblur={finishEditing}
                    onkeydown={handleEditKeydown}
                    onclick={(e) => e.stopPropagation()}
                    placeholder={m.terminal_quakeOverlay_name_placeholder()}
                    class="inline-edit-input relative z-10 w-60 border-none bg-transparent p-0 font-inherit text-inherit outline-none focus:outline-none! focus:ring-0!"
                  />
                {:else}
                  <span
                    class="relative z-10 cursor-text overflow-hidden text-ellipsis whitespace-nowrap"
                    >{getTabDisplayName(term)}</span
                  >
                {/if}
                <span
                  aria-hidden="true"
                  class="pointer-events-none absolute z-0 rounded-(--radius-small) border transition-[inset,border-color,background-color] duration-(--motion-standard) ease-(--ease-standard) motion-reduce:transition-none {editingTerminalId ===
                  term.id
                    ? '-inset-x-2 -inset-y-1.5 border-ring/60 bg-sidebar'
                    : '-inset-x-1 -inset-y-0.5 border-transparent bg-transparent'}"
                ></span>
              </div>

              <!-- Close Button - appears on hover -->
              <Button
                variant="plain"
                size="icon-xs"
                iconOnly
                class="ml-0.5 p-1 text-muted-foreground/50 hover:text-muted-foreground opacity-0 group-hover/tab:opacity-100 transition-opacity duration-150 cursor-pointer"
                onclick={(e) => closeTerminal(term.id, e)}
                aria-label={m.terminal_quakeOverlay_closeTerminal_ariaLabel()}
              >
                <Fa icon={faXmark} size="xs" />
              </Button>
            </div>
          {/each}

          <!-- Running Script Tabs -->
          {#each runningScripts as script (script.id)}
            {@const isScriptActive = selectedScriptId === script.id && $isOpen}
            {@const scriptStatusInfo = getStatusInfo(script)}
            {@const isPreviouslyRunningOnly =
              script.runtime.previouslyRunning === true &&
              !isLiveScriptStatus(script.runtime.status)}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div
              class={cn(
                'flex items-center gap-1.5 h-full px-2.5 text-sm font-medium text-muted-foreground cursor-pointer transition-all duration-150 min-w-0 max-w-90 whitespace-nowrap group/tab',
                'hover:text-foreground hover:bg-muted/80',
                isScriptActive && 'text-foreground bg-sidebar shadow-sm',
              )}
              onclick={() => {
                if (isScriptActive) {
                  handleClose();
                  setSelectedScript(null);
                } else {
                  setSelectedScript(script.id);
                  if (!$isOpen && workspaceId) {
                    appStore.dispatch(openTerminalOverlay(workspaceId));
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
              <div
                class={cn('w-2 h-2 rounded-full shrink-0', scriptStatusInfo.dotClass)}
                role="img"
                aria-label={scriptStatusInfo.label}
                title={scriptStatusInfo.label}
              ></div>
              <div class="relative inline-flex min-w-0 items-center">
                {#if editingScriptTabId === script.id}
                  <input
                    type="text"
                    data-edit-script-tab={script.id}
                    bind:value={editingScriptTabValue}
                    onblur={finishEditingScriptTab}
                    onkeydown={handleEditScriptTabKeydown}
                    onclick={(e) => e.stopPropagation()}
                    placeholder={m.terminal_quakeOverlay_name_placeholder()}
                    class="inline-edit-input relative z-10 w-60 border-none bg-transparent p-0 font-inherit text-inherit outline-none focus:outline-none! focus:ring-0!"
                  />
                {:else}
                  <span
                    class="relative z-10 cursor-text overflow-hidden text-ellipsis whitespace-nowrap"
                    >{script.name}</span
                  >
                {/if}
                <span
                  aria-hidden="true"
                  class="pointer-events-none absolute z-0 rounded-(--radius-small) border transition-[inset,border-color,background-color] duration-(--motion-standard) ease-(--ease-standard) motion-reduce:transition-none {editingScriptTabId ===
                  script.id
                    ? '-inset-x-2 -inset-y-1.5 border-ring/60 bg-sidebar'
                    : '-inset-x-1 -inset-y-0.5 border-transparent bg-transparent'}"
                ></span>
              </div>
              {#if editingScriptTabId !== script.id && script.runtime.detectedUrl}
                <Button
                  variant="plain"
                  size="icon-xs"
                  iconOnly
                  class="ml-auto p-1 text-muted-foreground/50 hover:text-foreground cursor-pointer transition-colors shrink-0"
                  onclick={(e) => {
                    e.stopPropagation();
                    const url = script.runtime.detectedUrl;
                    if (url) openScriptUrl(url);
                  }}
                  title={m.terminal_quakeOverlay_openUrl_tooltip()}
                  aria-label={m.terminal_quakeOverlay_openUrl_tooltip()}
                >
                  <Fa icon={faArrowUpRightFromSquare} size="xs" />
                </Button>
              {/if}
              {#if editingScriptTabId !== script.id && isPreviouslyRunningOnly}
                <Button
                  variant="plain"
                  size="icon-xs"
                  iconOnly
                  class="ml-0.5 p-1 text-muted-foreground/50 hover:text-muted-foreground opacity-0 group-hover/tab:opacity-100 transition-opacity duration-150 cursor-pointer"
                  data-dismiss-script-tab={script.id}
                  onclick={(event) => dismissPreviouslyRunningTab(script.id, event)}
                  aria-label={m.terminal_quakeOverlay_dismissScriptTab_ariaLabel()}
                >
                  <Fa icon={faXmark} size="xs" />
                </Button>
              {/if}
            </div>
          {/each}
        </div>

        <!-- New Terminal Button (sticky, never scrolls) -->
        <Tooltip
          content={m.terminal_quakeOverlay_newTerminal_tooltip()}
          side="top"
          class="mr-auto pl-1"
          delayDuration={300}
        >
          <Button
            variant="ghost-light"
            size="icon-xs"
            class="text-muted-foreground/75 cursor-pointer a11y-ignore"
            onclick={createNewTerminal}
            aria-label={m.terminal_quakeOverlay_newTerminal_ariaLabel()}
          >
            <Fa icon={faPlus} class="size-2.75" />
          </Button>
        </Tooltip>

        <!-- Right Actions -->
        <div class="flex items-center gap-1">
          {#if isRealWorkspace && $scriptsInitialized$ && $scriptEntries$.length === 0}
            <Button
              variant="ghost-light"
              size="sm"
              class="text-xs text-muted-foreground hover:text-foreground h-6 px-2 mr-1"
              onclick={handleDetectScripts}
              disabled={isDetectingScripts}
            >
              {#if isDetectingScripts}
                <Fa icon={faSpinner} spin size="sm" class="mr-1.5" />
                {m.terminal_quakeOverlay_detecting_label()}
              {:else}
                {m.terminal_quakeOverlay_detectScripts_label()}
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
                <Button
                  variant="plain"
                  class="flex items-center justify-center h-full px-2 text-muted-foreground/50 cursor-pointer hover:text-foreground transition-colors text-muted-foreground/75 relative"
                  onclick={() => {
                    if ($isOpen) {
                      handleClose();
                    } else if (workspaceId) {
                      if ($terminals.length === 0) createNewTerminal();
                      appStore.dispatch(openTerminalOverlay(workspaceId));
                      const entries = selectWorkspaceScriptEntries.select(
                        appStore.state,
                        workspaceId,
                      );
                      if (entries.length > 0 && !selectedScriptId) {
                        setSelectedScript(entries[0].id);
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
                </Button>
              {/snippet}

              {#snippet content()}
                <div class="flex flex-col min-w-[200px] max-h-[300px] overflow-y-auto p-2 pt-2.5">
                  <Header size={6} class="px-1">{m.terminal_quakeOverlay_scripts_title()}</Header>
                  {#if $scriptEntries$.length > 0}
                    <ListContainer spacing="compact" class="py-0! px-0">
                      {#each sortScripts($scriptEntries$) as script (script.id)}
                        {@const scriptStatusInfo = getStatusInfo(script)}
                        <ListItem
                          size="sm"
                          class="gap-0.5!"
                          title={script.name}
                          subtitle={script.command}
                          subtitleClass="leading-none"
                          active={selectedScriptId === script.id}
                          onclick={() => {
                            setSelectedScript(script.id);
                            if (!$isOpen && workspaceId) {
                              appStore.dispatch(openTerminalOverlay(workspaceId));
                            }
                          }}
                          actions={getScriptActions(script)}
                          actionsVisible="hover"
                          actionsClass="absolute right-0 top-1/2 -translate-y-1/2 bg-background px-1 rounded"
                        >
                          {#snippet iconSnippet()}
                            <div class="flex items-center justify-center w-2">
                              <div
                                class={cn('w-2 h-2 rounded-full', scriptStatusInfo.dotClass)}
                                role="img"
                                aria-label={scriptStatusInfo.label}
                                title={scriptStatusInfo.label}
                              ></div>
                            </div>
                          {/snippet}
                        </ListItem>
                      {/each}
                    </ListContainer>
                  {:else}
                    <div class="text-xs text-muted-foreground italic p-2">
                      {m.terminal_quakeOverlay_noScriptsYet_label()}
                    </div>
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
            tooltip={$isOpen
              ? m.terminal_quakeOverlay_collapse_tooltip()
              : m.terminal_quakeOverlay_expand_tooltip()}
            tooltipShortcut="mod+`"
            aria-label={$isOpen
              ? m.terminal_quakeOverlay_collapse_ariaLabel()
              : m.terminal_quakeOverlay_expand_ariaLabel()}
          >
            <Fa icon={$isOpen ? faChevronDown : faChevronLeft} size="xs" />
          </Button>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  input.inline-edit-input::selection {
    background: hsl(var(--ring) / 0.3);
  }

  .terminal-overlay {
    position: relative;
  }

  .terminal-panel-spacer {
    height: 0;
  }

  .terminal-panel-spacer.is-visible {
    height: var(--terminal-panel-height);
  }

  .terminal-panel {
    position: absolute;
    right: 0;
    bottom: 36px;
    left: 0;
    visibility: hidden;
    pointer-events: none;
    transform: translate3d(0, 100%, 0);
    transition:
      transform 160ms cubic-bezier(0.33, 1, 0.68, 1),
      visibility 0s linear 160ms;
  }

  .terminal-panel.is-visible {
    visibility: visible;
    pointer-events: auto;
    transform: translate3d(0, 0, 0);
    transition:
      transform 160ms cubic-bezier(0.33, 1, 0.68, 1),
      visibility 0s linear 0s;
  }

  .terminal-panel.is-resizing {
    user-select: none;
    pointer-events: none;
  }

  .terminal-panel.is-resizing :global(*) {
    pointer-events: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .terminal-panel,
    .terminal-panel.is-visible {
      transition: none;
    }
  }
</style>
