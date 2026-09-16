<script lang="ts">
  /* eslint-disable max-lines */
  import { flip } from 'svelte/animate';
  import type { ScriptCategory, ScriptMode, ScriptWithState } from '$features/scripts/types';
  import { getScriptStatusKind, isLiveScriptStatus } from '$features/scripts/utils/script-status';

  import {
    selectScriptEntries,
    selectWorkspaceScriptCommandOperations,
  } from '$store/renderer/slices/scripts/scripts-selectors';
  import {
    applyScriptDetectionRequested,
    createScriptRequested,
    detectScriptsRequested,
    removeScriptRequested,
    restartScriptRequested,
    restoreScriptsRequested,
    saveScriptsToRepoRequested,
    startScriptRequested,
    stopScriptRequested,
    updateScriptRequested,
  } from '$store/renderer/slices/scripts/scripts-slice';
  import type {
    ScriptDefinitionInput,
    ScriptDetectionChanges,
  } from '$store/renderer/slices/scripts/scripts-types';
  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
  import { writable } from 'svelte/store';

  import AgentAvatarWithState from '$features/agent/components/agent-avatar/AgentAvatarWithState.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Input } from '$lib/components/ui/input';
  import { ListContainer, ListItem, ListSection } from '$lib/components/ui/list';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import { toast, withToastCountdown } from '$lib/components/ui/toast';
  import { useBackgroundAgent } from '$lib/hooks/use-background-agent.svelte';
  import {
    selectExecutorAgentId,
    selectExecutorState,
  } from '$store/renderer/slices/background-agent-executor/background-agent-executor-selectors';
  import {
    selectActiveTerminalId as selectActiveTerminalIdSelector,
    selectUserTerminals as selectTerminalsSelector,
  } from '$store/renderer/slices/terminals/terminals-selectors';
  import { removeTerminal } from '$store/renderer/slices/terminals/terminals-slice';
  import { terminalDisplayName } from '$lib/utils/terminal-display-name';

  import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
  import { getNavigationContext } from '$lib/components/layout/panel-system/panel-context';
  import { cn } from '$lib/utils';
  import { createLogger } from '$lib/utils/client-logger';
  import { pushEscapeLayer } from '$lib/utils/escapeLayers';
  import {
    faCheck,
    faFloppyDisk,
    faPlay,
    faPlus,
    faRotateRight,
    faSearch,
    faStop,
    faTerminal,
    faTrash,
    faWandMagicSparkles,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    workspaceId: string;
    selectedScriptId?: string | null;
    onSelectScript?: (scriptId: string | null) => void;
    onSelectTerminal?: (terminalId: string) => void;
    onCreateTerminal?: () => void;
    class?: string;
  }

  let {
    workspaceId,
    selectedScriptId = null,
    onSelectScript,
    onSelectTerminal,
    onCreateTerminal,
    class: className,
  }: Props = $props();

  const workspaceIdStore = writable('');
  $effect(() => workspaceIdStore.set(workspaceId));
  const activeWorkspace = selectWorkspaceById(workspaceIdStore);

  const logger = createLogger('TerminalSidebar');

  // i18n-ignore (agent-facing prompt, kept in English)
  const SCRIPT_DETECT_PROMPT = `Read package.json (and Makefile, docker-compose.yml, Cargo.toml, or pyproject.toml if they exist) to find runnable scripts.

For each script, determine: name, command, mode ("service" for long-running like dev servers, "command" for one-shot like build/test), category (one of: dev, build, test, lint, typecheck, format, storybook, other).

CRITICAL INSTRUCTIONS:
1. You MUST wrap your JSON result in <<<DETECTED_SCRIPTS>>> and <<</DETECTED_SCRIPTS>>> tags
2. Do NOT use markdown code blocks
3. Do NOT add any text outside the tags
4. Return ONLY a JSON object with keys "add", "update", and "remove"

Example response (you MUST follow this exact format):
<<<DETECTED_SCRIPTS>>>
{"add":[{"name":"dev","command":"npm run dev","mode":"service","category":"dev"}],"update":[],"remove":[]}
<<</DETECTED_SCRIPTS>>>

Your entire response must be ONLY the tags with JSON inside. Nothing else.`;

  const validCategories = new Set([
    'dev',
    'build',
    'test',
    'lint',
    'typecheck',
    'format',
    'storybook',
    'other',
  ]);
  const validModes = new Set(['service', 'command']);

  type DetectFlow = 'idle' | 'local';

  let detectFlow = $state<DetectFlow>('idle');
  let showAgentAssist = $state(false);
  let showAllScripts = $state(false);

  let selectedScriptIds = $state<Set<string>>(new Set());
  let contextMenuPos = $state<{ x: number; y: number } | null>(null);
  let contextMenuScriptId = $state<string | null>(null);
  let lastClickedScriptId = $state<string | null>(null);
  let pendingScrollScriptId = $state<string | null>(null);

  function scriptDefinition(entry: any): ScriptDefinitionInput | null {
    if (
      typeof entry?.name !== 'string' ||
      typeof entry?.command !== 'string' ||
      !validModes.has(entry.mode)
    ) {
      return null;
    }
    return {
      name: entry.name,
      command: entry.command,
      mode: entry.mode as ScriptMode,
      category: validCategories.has(entry.category) ? (entry.category as ScriptCategory) : 'other',
      source: 'auto-detected',
    };
  }

  function normalizeDetectionResult(parsed: any): ScriptDetectionChanges | null {
    if (Array.isArray(parsed)) {
      const existing = new Set(
        selectScriptEntries
          .select(appStore.state, workspaceId)
          .map((script) => `${script.name}::${script.command}`),
      );
      return {
        add: parsed
          .map(scriptDefinition)
          .filter((entry): entry is ScriptDefinitionInput =>
            entry ? !existing.has(`${entry.name}::${entry.command}`) : false,
          ),
        update: [],
        remove: [],
      };
    }
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      add: Array.isArray(parsed.add)
        ? (parsed.add.map(scriptDefinition).filter(Boolean) as ScriptDefinitionInput[])
        : [],
      update: Array.isArray(parsed.update)
        ? parsed.update.flatMap((entry: any) => {
            if (typeof entry?.id !== 'string') return [];
            const updates: Record<string, string> = {};
            if (typeof entry.name === 'string') updates.name = entry.name;
            if (typeof entry.command === 'string') updates.command = entry.command;
            if (validModes.has(entry.mode)) updates.mode = entry.mode;
            if (validCategories.has(entry.category)) updates.category = entry.category;
            return [{ id: entry.id, updates }];
          })
        : [],
      remove: Array.isArray(parsed.remove)
        ? parsed.remove.filter((id: unknown): id is string => typeof id === 'string')
        : [],
    };
  }

  let pendingDetectionSnapshot: ScriptDefinitionInput[] = [];

  function handleDetectionResult(parsed: any): void {
    const changes = normalizeDetectionResult(parsed);
    if (!changes) {
      logger.warn('DETECTED_SCRIPTS result is not recognized format');
      toast.info(m.terminal_sidebar_unexpectedFormat_info());
      runLocalDetect({ source: 'fallback' });
      return;
    }
    pendingDetectionSnapshot = selectScriptEntries
      .select(appStore.state, workspaceId)
      .map(({ runtime: _runtime, ...script }) => script);
    appStore.dispatch(applyScriptDetectionRequested(workspaceId, changes));
  }

  const scriptDetectAgent = useBackgroundAgent('script-detect');

  function handleAgentDetectionResult(result: string) {
    try {
      handleDetectionResult(JSON.parse(result));
    } catch (error) {
      logger.warn('Failed to parse DETECTED_SCRIPTS result', {
        error: error instanceof Error ? error.message : String(error),
      });
      toast.info(m.terminal_sidebar_agentDetectFailed_info());
      runLocalDetect({ source: 'fallback' });
    }
  }

  function handleAgentDetectionError() {
    logger.warn('Script detection agent failed, falling back to local detection');
    toast.info(m.terminal_sidebar_agentDetectFailed_info());
    runLocalDetect({ source: 'fallback' });
  }

  function runLocalDetect(options: { source?: 'primary' | 'fallback' } = {}) {
    detectFlow = 'local';
    logger.info('Running local script detection', { source: options.source ?? 'primary' });
    appStore.dispatch(detectScriptsRequested(workspaceId));
  }

  function buildExistingScriptsContext(): string {
    const existingScripts = selectScriptEntries.select(appStore.state, workspaceId).map((s) => ({
      id: s.id,
      name: s.name,
      command: s.command,
      mode: s.mode,
      category: s.category,
    }));

    return existingScripts.length > 0
      ? // i18n-ignore (agent-facing prompt, kept in English)
        `\n\nExisting scripts (do NOT duplicate these, return only changes):\n${JSON.stringify(existingScripts, null, 2)}`
      : '';
  }

  // Sidebar state
  let collapsed = $state(false);
  let sidebarWidth = $state(240);
  let isResizing = $state(false);
  let showAddForm = $state(false);
  let saveToRepoStatus = $state<'idle' | 'saving' | 'saved'>('idle');
  const saveToRepoTooltip = $derived(
    saveToRepoStatus === 'saved'
      ? m.terminal_sidebar_saved_tooltip()
      : m.terminal_sidebar_saveToRepo_tooltip(),
  );

  // Add form state
  let newName = $state('');
  let newCommand = $state('');
  let newMode = $state<ScriptMode>('command');

  // Constants
  const MIN_WIDTH = 48;
  const MAX_WIDTH = 400;
  const COLLAPSED_WIDTH = 48;
  const COLLAPSED_SCRIPT_LIMIT = 6;

  // Store bindings
  const _sidebarTerminals = selectTerminalsSelector(workspaceIdStore);
  const _sidebarActiveTerminalId = selectActiveTerminalIdSelector(workspaceIdStore);
  const scriptEntries$ = selectScriptEntries(workspaceIdStore);
  const scriptCommandOperations$ = selectWorkspaceScriptCommandOperations(workspaceIdStore);
  const scriptDetectState$ = selectExecutorState(workspaceIdStore, 'script-detect');
  const _scriptDetectAgentId$ = selectExecutorAgentId(workspaceIdStore, 'script-detect');

  // Derived
  const hasScripts = $derived($scriptEntries$.length > 0);
  const sortedScripts = $derived(sortScripts($scriptEntries$));
  const collapsedScriptLimit = $derived(
    $scriptEntries$.length === COLLAPSED_SCRIPT_LIMIT + 1
      ? COLLAPSED_SCRIPT_LIMIT + 1
      : COLLAPSED_SCRIPT_LIMIT,
  );
  const visibleScripts = $derived(
    showAllScripts ? sortedScripts : sortedScripts.slice(0, collapsedScriptLimit),
  );
  const hiddenScriptCount = $derived(Math.max(0, $scriptEntries$.length - collapsedScriptLimit));
  const showScriptListToggle = $derived(
    showAllScripts ? $scriptEntries$.length > collapsedScriptLimit : hiddenScriptCount >= 2,
  );
  const effectiveWidth = $derived(collapsed ? COLLAPSED_WIDTH : sidebarWidth);
  const isAgentDetecting = $derived(
    $scriptDetectState$.status === 'initializing' || $scriptDetectState$.status === 'running',
  );
  const isDetecting = $derived(detectFlow !== 'idle' || isAgentDetecting);
  const isLocalDetecting = $derived(detectFlow === 'local');
  const sidebarTerminals = $derived($_sidebarTerminals);
  const activeTerminalId = $derived($_sidebarActiveTerminalId);

  let handledCommandVersions = $state<Record<string, number>>({});
  let awaitingScriptDetectResult = $state(false);

  $effect(() => {
    const execution = $scriptDetectState$;
    if (execution.status === 'initializing' || execution.status === 'running') {
      awaitingScriptDetectResult = true;
      return;
    }
    if (!awaitingScriptDetectResult) return;
    if (execution.status === 'success' && execution.result) {
      awaitingScriptDetectResult = false;
      handleAgentDetectionResult(execution.result);
    } else if (execution.status === 'error') {
      awaitingScriptDetectResult = false;
      handleAgentDetectionError();
    } else if (execution.status === 'cancelled') {
      awaitingScriptDetectResult = false;
    }
  });

  $effect(() => {
    for (const [key, operation] of Object.entries($scriptCommandOperations$)) {
      if (operation.status === 'loading' || handledCommandVersions[key] === operation.version)
        continue;
      handledCommandVersions = { ...handledCommandVersions, [key]: operation.version };
      if (operation.status === 'error') {
        if (key === 'detect') {
          showAgentAssist = true;
          detectFlow = 'idle';
          toast.error(m.terminal_quakeOverlay_detectFailed_error());
        } else if (key === 'save') {
          saveToRepoStatus = 'idle';
          toast.error(operation.error || m.terminal_sidebar_saveToRepoFailed_error());
        } else if (operation.error) {
          toast.warning(operation.error);
        }
        continue;
      }
      const result = operation.result;
      if (!result) continue;
      if (result.kind === 'create') {
        onSelectScript?.(result.script.id);
        newName = '';
        newCommand = '';
        newMode = 'command';
        showAddForm = false;
      } else if (result.kind === 'remove' && selectedScriptId === result.scriptId) {
        onSelectScript?.(null);
      } else if (result.kind === 'save') {
        saveToRepoStatus = 'saved';
        setTimeout(() => (saveToRepoStatus = 'idle'), 1500);
      } else if (result.kind === 'restore') {
        toast.success(m.terminal_sidebar_scriptsRestored_success());
      } else if (result.kind === 'detect') {
        detectFlow = 'idle';
        showAgentAssist = result.detected === 0;
        toast.info(
          result.detected > 0
            ? result.detected === 1
              ? m.terminal_sidebar_detectedFromFiles_one({ count: result.detected })
              : m.terminal_sidebar_detectedFromFiles_many({ count: result.detected })
            : m.terminal_sidebar_noScriptsLocally_info(),
        );
      } else if (result.kind === 'apply') {
        showAgentAssist = $scriptEntries$.length === 0;
        const parts: string[] = [];
        if (result.added) parts.push(m.terminal_sidebar_detectAdded_part({ count: result.added }));
        if (result.updated)
          parts.push(m.terminal_sidebar_detectUpdated_part({ count: result.updated }));
        if (result.removed)
          parts.push(m.terminal_sidebar_detectRemoved_part({ count: result.removed }));
        if (parts.length === 0) {
          toast.info(m.terminal_sidebar_noScriptChanges_info());
        } else {
          toast.success(
            m.terminal_sidebar_scriptsUpdated_success({ changes: parts.join(', ') }),
            withToastCountdown(
              {
                action: {
                  label: m.terminal_sidebar_undo_label(),
                  onClick: () =>
                    appStore.dispatch(
                      restoreScriptsRequested(workspaceId, pendingDetectionSnapshot),
                    ),
                },
                duration: 10000,
              },
              { pauseOnHover: false },
            ),
          );
        }
      }
      if ('skippedRunning' in result && result.skippedRunning.length > 0) {
        toast.warning(
          result.skippedRunning.length === 1
            ? m.scripts_detect_skippedRunning_one({ name: result.skippedRunning[0] })
            : m.scripts_detect_skippedRunning_many({
                count: result.skippedRunning.length,
                names: result.skippedRunning.join(', '),
              }),
        );
      }
    }
  });

  // ---- Sort function ----
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

  // ---- Status dot helpers ----
  function getStatusColor(script: ScriptWithState): string {
    const kind = getScriptStatusKind(script.runtime);
    if (kind === 'running' || kind === 'succeeded') return 'bg-green-500';
    if (kind === 'restarting') return 'bg-amber-500';
    if (kind === 'failed') return 'bg-red-500';
    if (kind === 'stopped') return 'bg-muted-foreground/60';
    return 'bg-muted-foreground/40';
  }

  function getStatusLabel(script: ScriptWithState): string {
    const kind = getScriptStatusKind(script.runtime);
    if (kind === 'running') return m.terminal_quakeOverlay_status_running();
    if (kind === 'restarting') return m.workspace_devScripts_restarting_label();
    if (kind === 'idle') return m.terminal_quakeOverlay_status_idle();
    if (kind === 'succeeded') return m.terminal_quakeOverlay_status_exitedZero();
    if (kind === 'failed')
      return m.terminal_quakeOverlay_status_errorCode({ code: script.runtime.exitCode ?? 1 });
    if (kind === 'stopped')
      return m.terminal_quakeOverlay_status_stoppedSignal({
        signal: (script.runtime.exitCode ?? 128) - 128,
      });
    return m.terminal_quakeOverlay_status_exited();
  }

  // ---- Actions ----
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
        onClick: () => handleStop(script.id),
      });
      actions.push({
        icon: faRotateRight,
        label: m.terminal_quakeOverlay_restart_label(),
        onClick: () => handleRestart(script.id),
      });
    } else {
      actions.push({
        icon: faPlay,
        label: m.terminal_quakeOverlay_start_label(),
        onClick: () => handleStart(script.id),
      });
    }
    return actions;
  }

  function handleStart(scriptId: string) {
    appStore.dispatch(startScriptRequested(workspaceId, scriptId));
    onSelectScript?.(scriptId);
    pendingScrollScriptId = scriptId;
  }

  function handleStop(scriptId: string) {
    appStore.dispatch(stopScriptRequested(workspaceId, scriptId));
  }

  function handleRestart(scriptId: string) {
    appStore.dispatch(restartScriptRequested(workspaceId, scriptId));
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function handleDelete(scriptId: string) {
    appStore.dispatch(removeScriptRequested(workspaceId, scriptId));
  }

  function handleDetect() {
    if (isDetecting) {
      return;
    }

    showAgentAssist = false;
    runLocalDetect({ source: 'primary' });
  }

  function handleAgentDetect() {
    if (isDetecting) {
      return;
    }

    const workspace = $activeWorkspace;
    if (!workspace) {
      toast.info(m.terminal_sidebar_openWorkspaceFirst_info());
      return;
    }

    showAgentAssist = false;
    awaitingScriptDetectResult = true;
    scriptDetectAgent.execute(workspace, {
      message: SCRIPT_DETECT_PROMPT + buildExistingScriptsContext(),
    });
  }

  function handleAddScript() {
    if (!newName.trim() || !newCommand.trim()) return;
    appStore.dispatch(
      createScriptRequested(workspaceId, {
        name: newName.trim(),
        command: newCommand.trim(),
        mode: newMode,
        source: 'user',
      }),
    );
  }

  function handleSaveToRepo() {
    if (saveToRepoStatus !== 'idle') return;
    saveToRepoStatus = 'saving';
    appStore.dispatch(saveScriptsToRepoRequested(workspaceId));
  }

  function handleSelectScript(scriptId: string, event?: MouseEvent) {
    // Multi-select with Cmd/Ctrl+click
    if (event && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      if (selectedScriptIds.has(scriptId)) {
        selectedScriptIds.delete(scriptId);
      } else {
        selectedScriptIds.add(scriptId);
      }
      selectedScriptIds = new Set(selectedScriptIds);
      lastClickedScriptId = scriptId;
      return;
    }

    // Range select with Shift+click
    if (event && event.shiftKey && lastClickedScriptId) {
      event.preventDefault();
      const scripts = sortScripts(selectScriptEntries.select(appStore.state, workspaceId));
      const lastIndex = scripts.findIndex((s) => s.id === lastClickedScriptId);
      const currentIndex = scripts.findIndex((s) => s.id === scriptId);
      if (lastIndex !== -1 && currentIndex !== -1) {
        const start = Math.min(lastIndex, currentIndex);
        const end = Math.max(lastIndex, currentIndex);
        selectedScriptIds.clear();
        for (let i = start; i <= end; i++) {
          selectedScriptIds.add(scripts[i].id);
        }
        selectedScriptIds = new Set(selectedScriptIds);
      }
      return;
    }

    // Regular click: clear selection and select/view the script
    selectedScriptIds.clear();
    selectedScriptIds = new Set(selectedScriptIds);
    lastClickedScriptId = scriptId;
    onSelectScript?.(scriptId);
  }

  function handleScriptContextMenu(scriptId: string, event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();

    // If right-clicking on an unselected script, select only that one
    if (!selectedScriptIds.has(scriptId)) {
      selectedScriptIds.clear();
      selectedScriptIds.add(scriptId);
      selectedScriptIds = new Set(selectedScriptIds);
      lastClickedScriptId = scriptId;
    }

    contextMenuScriptId = scriptId;
    contextMenuPos = { x: event.clientX, y: event.clientY };
  }

  function closeContextMenu() {
    contextMenuPos = null;
    contextMenuScriptId = null;
  }

  function handleContextMenuAction(
    action: 'start' | 'stop' | 'restart' | 'edit' | 'delete' | 'startAll' | 'stopAll',
  ) {
    if (action === 'delete') {
      // Delete all selected scripts
      const idsToDelete = Array.from(selectedScriptIds);
      for (const id of idsToDelete) {
        appStore.dispatch(removeScriptRequested(workspaceId, id));
        if (selectedScriptId === id) {
          onSelectScript?.(null);
        }
      }
      selectedScriptIds.clear();
      selectedScriptIds = new Set(selectedScriptIds);
      lastClickedScriptId = null;
    } else if (action === 'startAll') {
      // Start all selected scripts
      for (const id of selectedScriptIds) {
        handleStart(id);
      }
    } else if (action === 'stopAll') {
      // Stop all selected scripts
      for (const id of selectedScriptIds) {
        handleStop(id);
      }
    } else if (action === 'edit' && contextMenuScriptId) {
      // Edit the right-clicked script
      onSelectScript?.(contextMenuScriptId);
    } else if (contextMenuScriptId) {
      // Start/stop/restart the right-clicked script
      if (action === 'start') {
        handleStart(contextMenuScriptId);
      } else if (action === 'stop') {
        handleStop(contextMenuScriptId);
      } else if (action === 'restart') {
        handleRestart(contextMenuScriptId);
      }
    }
    closeContextMenu();
  }

  // ---- Script inline rename ----
  let editingScriptId = $state<string | null>(null);
  let editingScriptName = $state('');

  function startEditingScript(scriptId: string, currentName: string) {
    editingScriptId = scriptId;
    editingScriptName = currentName;
    requestAnimationFrame(() => {
      const input = document.querySelector(`[data-edit-script="${scriptId}"]`) as HTMLInputElement;
      input?.focus();
      input?.select();
    });
  }

  function finishEditingScript() {
    if (editingScriptId && editingScriptName.trim()) {
      appStore.dispatch(
        updateScriptRequested(workspaceId, editingScriptId, { name: editingScriptName.trim() }),
      );
    }
    editingScriptId = null;
    editingScriptName = '';
  }

  function handleEditScriptKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      finishEditingScript();
    }
    if (e.key === 'Escape') {
      editingScriptId = null;
      editingScriptName = '';
    }
  }

  // ---- Resize ----
  function startResize(event: MouseEvent) {
    event.preventDefault();
    isResizing = true;
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleResize);
    document.addEventListener('mouseup', stopResize);
  }

  function handleResize(event: MouseEvent) {
    if (!isResizing) return;
    const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, window.innerWidth - event.clientX));
    if (newWidth <= MIN_WIDTH + 10) {
      collapsed = true;
    } else {
      collapsed = false;
      sidebarWidth = newWidth;
    }
  }

  function stopResize() {
    isResizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', handleResize);
    document.removeEventListener('mouseup', stopResize);
  }

  function toggleCollapse() {
    collapsed = !collapsed;
  }

  function handleAddFormKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAddScript();
    } else if (e.key === 'Escape') {
      showAddForm = false;
    }
  }

  // Scroll started script into view once it transitions to running
  $effect(() => {
    if (pendingScrollScriptId) {
      const script = selectScriptEntries
        .select(appStore.state, workspaceId)
        .find((s) => s.id === pendingScrollScriptId);
      if (script?.runtime.status === 'running') {
        const id = pendingScrollScriptId;
        pendingScrollScriptId = null;
        setTimeout(() => {
          const el = document.querySelector(`[data-script-id="${id}"]`);
          el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 500);
      }
    }
  });

  // Escape layer: while the context menu is open it is the topmost overlay,
  // so Escape closes only the menu (not a lower overlay)
  $effect(() => {
    if (!contextMenuPos) return;
    return pushEscapeLayer(() => closeContextMenu());
  });
</script>

<!-- Sidebar Container -->
<div
  class={cn(
    'flex flex-col h-full bg-sidebar border-l border-border shrink-0 relative select-none',
    isResizing && 'pointer-events-none',
    className,
  )}
  style="width: {effectiveWidth}px;"
>
  {#if collapsed}
    <!-- Collapsed: icon-only mode -->
    <div class="flex flex-col items-center gap-1 py-2">
      <Button
        variant="ghost-light"
        size="icon-xs"
        onclick={toggleCollapse}
        tooltip={m.terminal_quakeOverlay_scripts_title()}
        aria-label={m.terminal_sidebar_expandScripts_ariaLabel()}
      >
        <Fa icon={faPlay} size="xs" />
      </Button>
    </div>
  {:else}
    <!-- Expanded: full sidebar -->
    <div class="flex-1 flex flex-col min-h-0 overflow-y-auto pt-0">
      <!-- Scripts Section -->
      <ListSection
        title={m.terminal_quakeOverlay_scripts_title()}
        titleClass="mb-0.5 mt-1.5 px-3.5! pb-0!"
        icon={faPlay}
        class="py-1 shrink-0"
      >
        {#snippet actions()}
          {#if hasScripts}
            <Button
              variant="ghost-light"
              size="icon-xs"
              class="-mt-0.5 -mb-1 opacity-0 group-hover:opacity-100 transition-opacity"
              onclick={(e) => {
                e.stopPropagation();
                handleSaveToRepo();
              }}
              tooltip={saveToRepoTooltip}
              aria-label={m.terminal_sidebar_saveToRepo_tooltip()}
              disabled={saveToRepoStatus === 'saving'}
            >
              <Fa
                icon={saveToRepoStatus === 'saved' ? faCheck : faFloppyDisk}
                size="xs"
                class={saveToRepoStatus === 'saved' ? 'text-green-500' : ''}
              />
            </Button>
          {/if}
          <Button
            variant="ghost-light"
            size="icon-xs"
            class="-mt-0.5 -mb-1 opacity-0 group-hover:opacity-100 transition-opacity"
            onclick={(e) => {
              e.stopPropagation();
              showAddForm = !showAddForm;
            }}
            tooltip={m.terminal_sidebar_addScript_tooltip()}
          >
            <Fa icon={faPlus} size="xs" />
          </Button>
          {#if isAgentDetecting && $_scriptDetectAgentId$}
            <Button
              variant="plain"
              type="button"
              class="-mt-0.5 -mb-1 flex items-center gap-1 px-1 rounded text-muted-foreground/60 hover:text-muted-foreground transition-colors cursor-pointer shrink-0"
              onclick={(e) => {
                e.stopPropagation();
                const wsId = $activeWorkspace?.id;
                if (wsId) {
                  appStore.dispatch(
                    openAgentTabRequested(wsId, {
                      agentId: $_scriptDetectAgentId$,
                      ...getNavigationContext(e),
                    }),
                  );
                }
              }}
              title={m.terminal_sidebar_viewDetectionAgent_tooltip()}
            >
              <div
                class="shrink-0 flex-none"
                style="min-width: 16px; min-height: 16px; width: 16px; height: 16px;"
              >
                <AgentAvatarWithState
                  agentId={$_scriptDetectAgentId$}
                  state="running"
                  variant="compact"
                />
              </div>
              <span class="text-ui">{m.terminal_sidebar_askingAgent_label()}</span>
            </Button>
          {:else if isAgentDetecting}
            <div class="-mt-0.5 -mb-1 flex items-center gap-1 px-1 text-muted-foreground">
              <!-- a11y-ignore -->
              <IntentMarkLoader size={12} />
              <span class="text-ui">{m.terminal_sidebar_askingAgent_label()}</span>
            </div>
          {:else if isLocalDetecting}
            <div class="-mt-0.5 -mb-1 flex items-center gap-1 px-1 text-muted-foreground">
              <!-- a11y-ignore -->
              <IntentMarkLoader size={12} />
              <span class="text-ui">{m.terminal_sidebar_scanningFiles_label()}</span>
            </div>
          {:else if hasScripts}
            {#if showAgentAssist}
              <Button
                variant="outline"
                size="xs"
                class="-mt-0.5 -mb-1"
                onclick={(e) => {
                  e.stopPropagation();
                  handleAgentDetect();
                }}
                tooltip={m.terminal_sidebar_agentAssist_tooltip()}
              >
                {m.terminal_sidebar_agentAssist_label()}
              </Button>
            {/if}
            <Button
              variant="ghost-light"
              size="icon-xs"
              class={cn(
                '-mt-0.5 -mb-1 transition-opacity',
                showAgentAssist ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
              )}
              onclick={(e) => {
                e.stopPropagation();
                handleDetect();
              }}
              tooltip={m.terminal_sidebar_scanLocal_tooltip()}
            >
              <Fa icon={faSearch} size="xs" />
            </Button>
          {:else}
            <Button
              variant="outline"
              size="xs"
              class="-mt-0.5 -mb-1"
              onclick={(e) => {
                e.stopPropagation();
                handleAgentDetect();
              }}
              tooltip={m.terminal_sidebar_detectWithAi_tooltip()}
            >
              <Fa icon={faWandMagicSparkles} size="xs" />
              {m.terminal_sidebar_detectWithAi_label()}
            </Button>
          {/if}
        {/snippet}

        <!-- Add Script Form -->
        {#if showAddForm}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="px-2 py-2 border-b border-border flex flex-col gap-1.5"
            onkeydown={handleAddFormKeydown}
          >
            <Input
              type="text"
              bind:value={newName}
              placeholder={m.terminal_quakeOverlay_name_placeholder()}
              class="w-full text-xs bg-muted/50 border border-border rounded-md px-2 py-1.5 outline-none focus:border-primary/50 focus:bg-background text-foreground placeholder:text-muted-foreground/50 transition-colors"
            />
            <Input
              type="text"
              bind:value={newCommand}
              placeholder={m.terminal_sidebar_command_placeholder()}
              class="w-full text-xs bg-muted/50 border border-border rounded-md px-2 py-1.5 outline-none focus:border-primary/50 focus:bg-background text-foreground placeholder:text-muted-foreground/50 font-mono transition-colors"
            />
            <div class="flex items-center gap-1.5 justify-end">
              <Button variant="ghost-light" size="xs" onclick={() => (showAddForm = false)}>
                {m.terminal_sidebar_cancel_label()}
              </Button>
              <Button
                variant="default"
                size="xs"
                onclick={handleAddScript}
                disabled={!newName.trim() || !newCommand.trim()}
              >
                <Fa icon={faPlus} size="xs" />
                {m.terminal_sidebar_add_label()}
              </Button>
            </div>
          </div>
        {/if}

        <!-- Script List -->
        {#if hasScripts}
          <ListContainer spacing="compact" class="py-0.5 px-1.5">
            {#each visibleScripts as script (script.id)}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                animate:flip={{ duration: 200 }}
                data-script-id={script.id}
                onclick={(event) => handleSelectScript(script.id, event)}
                ondblclick={() => startEditingScript(script.id, script.name)}
                oncontextmenu={(event) => handleScriptContextMenu(script.id, event)}
                onkeydown={(event) => {
                  if (event.key !== 'F2') return;
                  event.preventDefault();
                  startEditingScript(script.id, script.name);
                }}
              >
                <ListItem
                  size="sm"
                  class={cn(
                    'pr-1.5! pl-1.5!',
                    selectedScriptIds.has(script.id) && 'bg-accent/50! hover:bg-accent/60!',
                  )}
                  title={editingScriptId === script.id ? '' : script.name}
                  subtitle={editingScriptId === script.id ? '' : script.command}
                  subtitleClass="leading-none"
                  active={selectedScriptId === script.id}
                  actions={getScriptActions(script)}
                  actionsVisible="hover"
                  actionsClass="absolute right-0 top-1/2 -translate-y-1/2 bg-background px-1 rounded"
                >
                  {#snippet iconSnippet()}
                    <div class="flex items-center justify-center w-4">
                      <div
                        class={cn('w-2 h-2 rounded-full', getStatusColor(script))}
                        title={getStatusLabel(script)}
                        role="img"
                        aria-label={getStatusLabel(script)}
                      ></div>
                    </div>
                  {/snippet}
                  {#snippet children()}
                    <div
                      class={editingScriptId === script.id
                        ? 'relative flex w-full min-w-0 items-center'
                        : 'pointer-events-none absolute'}
                    >
                      {#if editingScriptId === script.id}
                        <Input
                          type="text"
                          data-edit-script={script.id}
                          bind:value={editingScriptName}
                          onblur={finishEditingScript}
                          onkeydown={handleEditScriptKeydown}
                          onclick={(e) => e.stopPropagation()}
                          placeholder={m.terminal_quakeOverlay_name_placeholder()}
                          class="relative z-10 w-full cursor-text border-none bg-transparent p-0 text-sm outline-none focus:outline-none! focus:ring-0!"
                        />
                      {/if}
                      <span
                        aria-hidden="true"
                        data-script-rename-decoration={script.id}
                        class="pointer-events-none absolute z-0 rounded-(--radius-small) border transition-[inset,border-color,background-color] duration-(--motion-standard) ease-(--ease-standard) motion-reduce:transition-none {editingScriptId ===
                        script.id
                          ? '-inset-x-2 -inset-y-1.5 border-ring/60 bg-sidebar'
                          : '-inset-x-1 -inset-y-0.5 border-transparent bg-transparent'}"
                      ></span>
                    </div>
                  {/snippet}
                </ListItem>
              </div>
            {/each}
            {#if showScriptListToggle}
              <Button
                variant="ghost-light"
                type="button"
                class="w-full text-left px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                onclick={() => (showAllScripts = !showAllScripts)}
              >
                {showAllScripts
                  ? m.terminal_sidebar_showLess_label()
                  : m.terminal_sidebar_moreScripts_label({ count: hiddenScriptCount })}
              </Button>
            {/if}
          </ListContainer>

          <!-- Context Menu -->
          {#if contextMenuPos}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="fixed inset-0 z-40"
              onclick={closeContextMenu}
              onkeydown={(e) => e.key === 'Escape' && closeContextMenu()}
            ></div>
            <div
              class="fixed z-50 bg-popover border border-border rounded-md shadow-lg py-1"
              style="left: {contextMenuPos.x}px; top: {contextMenuPos.y}px;"
            >
              {#if contextMenuScriptId}
                {@const script = $scriptEntries$.find((s) => s.id === contextMenuScriptId)}
                {#if script}
                  {#if selectedScriptIds.size > 1}
                    <!-- Multi-select actions -->
                    <Button
                      variant="ghost-light"
                      type="button"
                      class="w-full text-left px-3 py-1.5 text-sm hover:bg-accent cursor-pointer transition-colors"
                      onclick={() => handleContextMenuAction('startAll')}
                    >
                      {m.terminal_sidebar_startAll_label()}
                    </Button>
                    <Button
                      variant="ghost-light"
                      type="button"
                      class="w-full text-left px-3 py-1.5 text-sm hover:bg-accent cursor-pointer transition-colors"
                      onclick={() => handleContextMenuAction('stopAll')}
                    >
                      {m.terminal_sidebar_stopAll_label()}
                    </Button>
                  {:else}
                    <!-- Single-select actions -->
                    {#if isLiveScriptStatus(script.runtime.status)}
                      <Button
                        variant="ghost-light"
                        type="button"
                        class="w-full text-left px-3 py-1.5 text-sm hover:bg-accent cursor-pointer transition-colors"
                        onclick={() => handleContextMenuAction('stop')}
                      >
                        {m.terminal_quakeOverlay_stop_label()}
                      </Button>
                      <Button
                        variant="ghost-light"
                        type="button"
                        class="w-full text-left px-3 py-1.5 text-sm hover:bg-accent cursor-pointer transition-colors"
                        onclick={() => handleContextMenuAction('restart')}
                      >
                        {m.terminal_quakeOverlay_restart_label()}
                      </Button>
                    {:else}
                      <Button
                        variant="ghost-light"
                        type="button"
                        class="w-full text-left px-3 py-1.5 text-sm hover:bg-accent cursor-pointer transition-colors"
                        onclick={() => handleContextMenuAction('start')}
                      >
                        {m.terminal_quakeOverlay_start_label()}
                      </Button>
                    {/if}
                    <Button
                      variant="ghost-light"
                      type="button"
                      class="w-full text-left px-3 py-1.5 text-sm hover:bg-accent cursor-pointer transition-colors"
                      onclick={() => handleContextMenuAction('edit')}
                    >
                      {m.terminal_sidebar_edit_label()}
                    </Button>
                  {/if}
                  <div class="border-t border-border my-1"></div>
                  <Button
                    variant="plain"
                    type="button"
                    class="w-full text-left px-3 py-1.5 text-sm hover:bg-accent cursor-pointer transition-colors text-danger hover:bg-danger-background/10"
                    onclick={() => handleContextMenuAction('delete')}
                  >
                    {selectedScriptIds.size > 1
                      ? m.terminal_sidebar_deleteMany_label({ count: selectedScriptIds.size })
                      : m.terminal_sidebar_delete_label()}
                  </Button>
                {/if}
              {/if}
            </div>
          {/if}
        {:else if !showAddForm && isDetecting}
          <div class="px-3 text-center">
            <div class="flex flex-col gap-1 px-1 py-1">
              {#each Array(4) as { }}
                <div class="flex items-center gap-2 py-0.75 rounded">
                  <Skeleton class="h-2 w-2 rounded-full shrink-0" />
                  <Skeleton class="h-3.5 flex-1 rounded" />
                </div>
              {/each}
            </div>
          </div>
        {:else if !showAddForm}
          <div class="px-3 py-3 text-center text-xs text-muted-foreground space-y-2">
            {#if showAgentAssist}
              <p>{m.terminal_sidebar_noScriptsTryAi_label()}</p>
              <Button variant="outline" size="xs" onclick={handleAgentDetect}>
                <Fa icon={faWandMagicSparkles} size="xs" />
                {m.terminal_sidebar_detectWithAi_label()}
              </Button>
            {:else}
              <p>{m.terminal_sidebar_noScriptsAddManually_label()}</p>
            {/if}
          </div>
        {/if}
      </ListSection>

      <!-- Terminals Section -->
      <ListSection
        title={m.terminal_sidebar_terminals_title()}
        titleClass="mb-0.5 mt-1.5 px-3.5! pb-0!"
        icon={faTerminal}
        class="py-1 shrink-0"
      >
        {#snippet actions()}
          <Button
            variant="ghost-light"
            size="icon-xs"
            class="-mt-0.5 -mb-1 opacity-0 group-hover:opacity-100 transition-opacity"
            onclick={(e) => {
              e.stopPropagation();
              onCreateTerminal?.();
            }}
            tooltip={m.terminal_quakeOverlay_newTerminal_ariaLabel()}
            aria-label={m.terminal_quakeOverlay_newTerminal_ariaLabel()}
          >
            <Fa icon={faPlus} size="xs" />
          </Button>
        {/snippet}

        {#if sidebarTerminals.length > 0}
          <ListContainer spacing="compact" class="py-0.5 px-2">
            {#each sidebarTerminals as term (term.id)}
              <ListItem
                size="sm"
                class="pr-2! pl-2!"
                title={terminalDisplayName(term)}
                active={selectedScriptId === null && activeTerminalId === term.id}
                onclick={() => {
                  onSelectScript?.(null);
                  onSelectTerminal?.(term.id);
                }}
                actions={[
                  {
                    icon: faTrash,
                    label: m.terminal_sidebar_closeTerminal_label(),
                    onClick: (e) => {
                      e.stopPropagation();
                      if (workspaceId) appStore.dispatch(removeTerminal(workspaceId, term.id));
                    },
                  },
                ]}
                actionsVisible="hover"
                actionsClass="absolute right-0 top-1/2 -translate-y-1/2 bg-background px-1 rounded"
              >
                {#snippet iconSnippet()}
                  <div class="flex items-center justify-center w-4">
                    <Fa icon={faTerminal} size="xs" class="text-muted-foreground/60" />
                  </div>
                {/snippet}
              </ListItem>
            {/each}
          </ListContainer>
        {:else}
          <div class="px-3 py-3 text-center">
            <p class="text-ui text-muted-foreground">{m.terminal_sidebar_noTerminals_label()}</p>
          </div>
        {/if}
      </ListSection>
    </div>
  {/if}
  {#if !collapsed}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="app-resize-handle absolute -left-2 top-0 z-10 h-full w-4"
      data-resize-axis="x"
      data-resizing={isResizing}
      onmousedown={startResize}
    ></div>
  {/if}
</div>

<style>
  @container style(--motion-reduced: 1) {
    [data-script-rename-decoration] {
      transition-duration: 0s !important;
    }
  }
</style>
