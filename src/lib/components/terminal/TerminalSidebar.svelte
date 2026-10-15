<script lang="ts">
  import {
    selectScriptListPageState,
    selectScriptWorkflowOutcome,
  } from '$store/renderer/slices/scripts/scripts-selectors';
  import { loadMoreScripts } from '$store/renderer/slices/scripts/scripts-slice';
  import { scriptCommandLabel } from '$features/scripts/types';
  import { Input } from '$lib/components/ui/input';
  /* eslint-disable max-lines */
  import { flip } from 'svelte/animate';
  import { prefersReducedMotion, spring } from '$lib/motion';
  import type { ScriptMode, ScriptListEntry } from '$features/scripts/types';
  import { getScriptStatusKind, isLiveScriptStatus } from '$features/scripts/utils/script-status';

  import { selectScriptEntries } from '$store/renderer/slices/scripts/scripts-selectors';
  import {
    createScriptDefinitionRequested,
    detectScriptDefinitionsRequested,
    detectScriptsWithAgentRequested,
    removeScriptDefinitionsRequested,
    restoreScriptDefinitionsRequested,
    saveScriptDefinitionsToRepoRequested,
    scriptWorkflowConsumed,
    scriptWorkflowReleased,
    stopScriptRequested,
    startScriptRequested,
    restartScriptRequested,
    updateScriptDefinitionRequested,
  } from '$store/renderer/slices/scripts/scripts-slice';
  import type {
    ScriptAgentDetectionOutcome,
    ScriptBulkRemovalOutcome,
    ScriptDetectionOutcome,
    ScriptWorkflowConsumer,
  } from '$store/renderer/slices/scripts/scripts-types';
  import { writable } from 'svelte/store';
  import { onDestroy } from 'svelte';

  import Button from '$lib/components/ui/button/button.svelte';
  import AgentAvatarWithState from '$features/agent/components/agent-avatar/AgentAvatarWithState.svelte';
  import { ListContainer, ListItem, ListSection } from '$lib/components/ui/list';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import { notify, withToastCountdown } from '$lib/components/patterns/notify';
  import {
    selectActiveTerminalId as selectActiveTerminalIdSelector,
    selectUserTerminals as selectTerminalsSelector,
  } from '$store/renderer/slices/terminals/terminals-selectors';
  import { removeTerminal } from '$store/renderer/slices/terminals/terminals-slice';
  import { terminalDisplayName } from '$lib/utils/terminal-display-name';
  import {
    selectExecutorAgentId,
    selectExecutorIsRunning,
  } from '$store/renderer/slices/background-agent-executor/background-agent-executor-selectors';
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
  const logger = createLogger('TerminalSidebar');
  const applyConsumerId = crypto.randomUUID();
  const createConsumerId = crypto.randomUUID();
  const detectConsumerId = crypto.randomUUID();
  const removeConsumerId = crypto.randomUUID();
  const restoreConsumerId = crypto.randomUUID();
  const saveConsumerId = crypto.randomUUID();
  const updateConsumerId = crypto.randomUUID();
  const updateResourceIdStore = writable('');
  const applyOutcome$ = selectScriptWorkflowOutcome(
    applyConsumerId,
    workspaceIdStore,
    'agent-detection',
  );
  const createOutcome$ = selectScriptWorkflowOutcome(createConsumerId, workspaceIdStore, 'create');
  const detectOutcome$ = selectScriptWorkflowOutcome(
    detectConsumerId,
    workspaceIdStore,
    'local-detection',
  );
  const removeOutcome$ = selectScriptWorkflowOutcome(
    removeConsumerId,
    workspaceIdStore,
    'bulk-remove',
  );
  const restoreOutcome$ = selectScriptWorkflowOutcome(
    restoreConsumerId,
    workspaceIdStore,
    'restore',
  );
  const saveOutcome$ = selectScriptWorkflowOutcome(saveConsumerId, workspaceIdStore, 'save');
  const updateOutcome$ = selectScriptWorkflowOutcome(
    updateConsumerId,
    workspaceIdStore,
    updateResourceIdStore,
  );

  type DetectFlow = 'idle' | 'local' | 'agent';

  let detectFlow = $state<DetectFlow>('idle');
  let showAgentAssist = $state(false);
  let showAllScripts = $state(false);

  let selectedScriptIds = $state<Set<string>>(new Set());
  let contextMenuPos = $state<{ x: number; y: number } | null>(null);
  let contextMenuScriptId = $state<string | null>(null);
  let lastClickedScriptId = $state<string | null>(null);
  let pendingScrollScriptId = $state<string | null>(null);

  let pendingApply = $state<{
    requestId: string;
    workspaceId: string;
  } | null>(null);
  let pendingCreate = $state<{ requestId: string; workspaceId: string } | null>(null);
  let pendingDetect = $state<{ requestId: string; workspaceId: string } | null>(null);
  let pendingRemove = $state<{
    requestId: string;
    workspaceId: string;
    selectedScriptId: string | null;
    targetIds: string[];
  } | null>(null);
  let pendingRestore = $state<{ requestId: string; workspaceId: string } | null>(null);
  let pendingSave = $state<{ requestId: string; workspaceId: string } | null>(null);
  let pendingUpdate = $state<{ requestId: string; workspaceId: string } | null>(null);
  let saveStatusResetTimer: ReturnType<typeof setTimeout> | null = null;
  let workflowWorkspaceId = '';
  let mounted = true;
  const workflowConsumerIds = [
    applyConsumerId,
    createConsumerId,
    detectConsumerId,
    removeConsumerId,
    restoreConsumerId,
    saveConsumerId,
    updateConsumerId,
  ];

  function consumer(
    consumerId: string,
    requestId: string,
    resourceId: string,
  ): ScriptWorkflowConsumer {
    return { consumerId, requestId, resourceId };
  }

  function releaseWorkflows(releaseWorkspaceId: string): void {
    for (const consumerId of workflowConsumerIds) {
      appStore.dispatch(scriptWorkflowReleased(releaseWorkspaceId, consumerId));
    }
  }

  onDestroy(() => {
    mounted = false;
    if (saveStatusResetTimer) clearTimeout(saveStatusResetTimer);
    if (workflowWorkspaceId) releaseWorkflows(workflowWorkspaceId);
  });

  $effect(() => {
    const nextWorkspaceId = workspaceId;
    if (workflowWorkspaceId && workflowWorkspaceId !== nextWorkspaceId) {
      releaseWorkflows(workflowWorkspaceId);
      pendingApply = null;
      pendingCreate = null;
      pendingDetect = null;
      pendingRemove = null;
      pendingRestore = null;
      pendingSave = null;
      pendingUpdate = null;
      detectFlow = 'idle';
    }
    workflowWorkspaceId = nextWorkspaceId;
  });

  function runLocalDetect(options: { source?: 'primary' | 'fallback' } = {}) {
    detectFlow = 'local';
    logger.info('Running local script detection', { source: options.source ?? 'primary' });
    const requestWorkspaceId = workspaceId;
    const requestId = crypto.randomUUID();
    pendingDetect = { requestId, workspaceId: requestWorkspaceId };
    appStore.dispatch(
      detectScriptDefinitionsRequested(
        requestWorkspaceId,
        consumer(detectConsumerId, requestId, 'local-detection'),
      ),
    );
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
  const _scriptDetectIsRunning$ = selectExecutorIsRunning(workspaceIdStore, 'script-detect');
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
  const isDetecting = $derived(detectFlow !== 'idle' || $_scriptDetectIsRunning$);
  const isLocalDetecting = $derived(detectFlow === 'local');
  const isAgentDetecting = $derived(detectFlow === 'agent' || $_scriptDetectIsRunning$);
  const sidebarTerminals = $derived($_sidebarTerminals);
  const activeTerminalId = $derived($_sidebarActiveTerminalId);

  function completeWorkflow(
    consumerId: string,
    outcome: { workspaceId: string; requestId: string },
  ): void {
    appStore.dispatch(scriptWorkflowConsumed(outcome.workspaceId, consumerId, outcome.requestId));
  }

  $effect(() => {
    const outcome = $applyOutcome$;
    const pending = pendingApply;
    if (
      !outcome ||
      !pending ||
      outcome.consumed ||
      outcome.status === 'pending' ||
      outcome.requestId !== pending.requestId ||
      outcome.workspaceId !== pending.workspaceId ||
      workspaceId !== pending.workspaceId
    )
      return;
    pendingApply = null;
    detectFlow = 'idle';
    completeWorkflow(applyConsumerId, outcome);
    if (outcome.status !== 'success' || !outcome.result) {
      notify.error(outcome.error ?? m.terminal_quakeOverlay_detectFailed_error());
      return;
    }
    const compound = outcome.result as ScriptAgentDetectionOutcome;
    if (compound.source === 'local') {
      notify.info(
        compound.fallbackReason === 'unexpected-format'
          ? m.terminal_sidebar_unexpectedFormat_info()
          : m.terminal_sidebar_agentDetectFailed_info(),
      );
      const result = compound.detection;
      showAgentAssist = result.detected === 0;
      notify[result.detected > 0 ? 'success' : 'info'](
        result.detected > 0
          ? result.detected === 1
            ? m.terminal_sidebar_detectedFromFiles_one({ count: result.detected })
            : m.terminal_sidebar_detectedFromFiles_many({ count: result.detected })
          : m.terminal_sidebar_noScriptsLocally_info(),
      );
      return;
    }
    const result = compound.changes;
    showAgentAssist = selectScriptEntries.select(appStore.state, outcome.workspaceId).length === 0;
    if (compound.presentation === 'legacy') {
      notify[result.added > 0 ? 'success' : 'info'](
        result.added > 0
          ? result.added === 1
            ? m.terminal_sidebar_detectedNew_one({ count: result.added })
            : m.terminal_sidebar_detectedNew_many({ count: result.added })
          : m.terminal_sidebar_noNewScripts_info(),
      );
      return;
    }
    const changes = [
      result.added > 0 ? m.terminal_sidebar_detectAdded_part({ count: result.added }) : '',
      result.updated > 0 ? m.terminal_sidebar_detectUpdated_part({ count: result.updated }) : '',
      result.removed > 0 ? m.terminal_sidebar_detectRemoved_part({ count: result.removed }) : '',
    ].filter(Boolean);
    if (changes.length > 0) {
      const resultWorkspaceId = outcome.workspaceId;
      notify.success(
        m.terminal_sidebar_scriptsUpdated_success({ changes: changes.join(', ') }),
        withToastCountdown(
          {
            action: {
              label: m.terminal_sidebar_undo_label(),
              onClick: () => {
                if (!mounted || workspaceId !== resultWorkspaceId) return;
                const requestId = crypto.randomUUID();
                pendingRestore = { requestId, workspaceId: resultWorkspaceId };
                appStore.dispatch(
                  restoreScriptDefinitionsRequested(
                    resultWorkspaceId,
                    result.snapshot,
                    consumer(restoreConsumerId, requestId, 'restore'),
                  ),
                );
              },
            },
            duration: 10000,
          },
          { pauseOnHover: false },
        ),
      );
    } else {
      notify.info(m.terminal_sidebar_noScriptChanges_info());
    }
    if (result.skippedRunning.length > 0) {
      notify.warning(
        result.skippedRunning.length === 1
          ? m.scripts_detect_skippedRunning_one({ name: result.skippedRunning[0] })
          : m.scripts_detect_skippedRunning_many({
              count: result.skippedRunning.length,
              names: result.skippedRunning.join(', '),
            }),
      );
    }
  });

  $effect(() => {
    const outcome = $removeOutcome$;
    const pending = pendingRemove;
    if (
      !outcome ||
      !pending ||
      outcome.consumed ||
      outcome.status === 'pending' ||
      outcome.requestId !== pending.requestId ||
      outcome.workspaceId !== pending.workspaceId ||
      workspaceId !== pending.workspaceId
    )
      return;
    pendingRemove = null;
    completeWorkflow(removeConsumerId, outcome);
    const result = outcome.result as ScriptBulkRemovalOutcome | undefined;
    if (
      outcome.status === 'success' &&
      pending.selectedScriptId &&
      result?.removed.includes(pending.selectedScriptId)
    ) {
      onSelectScript?.(null);
    }
    const removedTargets = new Set(pending.targetIds);
    selectedScriptIds = new Set(
      Array.from(selectedScriptIds).filter((scriptId) => !removedTargets.has(scriptId)),
    );
    if (lastClickedScriptId && removedTargets.has(lastClickedScriptId)) lastClickedScriptId = null;
  });

  $effect(() => {
    const outcome = $detectOutcome$;
    const pending = pendingDetect;
    if (
      !outcome ||
      !pending ||
      outcome.consumed ||
      outcome.status === 'pending' ||
      outcome.requestId !== pending.requestId ||
      outcome.workspaceId !== pending.workspaceId ||
      workspaceId !== pending.workspaceId
    )
      return;
    pendingDetect = null;
    detectFlow = 'idle';
    completeWorkflow(detectConsumerId, outcome);
    if (outcome.status !== 'success' || !outcome.result) {
      showAgentAssist = true;
      logger.error('Local script detection failed', { error: outcome.error });
      notify.error(m.terminal_quakeOverlay_detectFailed_error());
      return;
    }
    const result = outcome.result as ScriptDetectionOutcome;
    showAgentAssist = result.detected === 0;
    notify[result.detected > 0 ? 'success' : 'info'](
      result.detected > 0
        ? result.detected === 1
          ? m.terminal_sidebar_detectedFromFiles_one({ count: result.detected })
          : m.terminal_sidebar_detectedFromFiles_many({ count: result.detected })
        : m.terminal_sidebar_noScriptsLocally_info(),
    );
  });

  $effect(() => {
    const outcome = $createOutcome$;
    const pending = pendingCreate;
    if (
      !outcome ||
      !pending ||
      outcome.consumed ||
      outcome.status === 'pending' ||
      outcome.requestId !== pending.requestId ||
      outcome.workspaceId !== pending.workspaceId ||
      workspaceId !== pending.workspaceId
    )
      return;
    pendingCreate = null;
    completeWorkflow(createConsumerId, outcome);
    if (outcome.status !== 'success' || !outcome.result || Array.isArray(outcome.result)) {
      logger.error('Script creation failed', outcome.error);
      return;
    }
    const script = outcome.result as { id: string };
    onSelectScript?.(script.id);
    newName = '';
    newCommand = '';
    newMode = 'command';
    showAddForm = false;
  });

  $effect(() => {
    const outcome = $restoreOutcome$;
    const pending = pendingRestore;
    if (
      !outcome ||
      !pending ||
      outcome.consumed ||
      outcome.status === 'pending' ||
      outcome.requestId !== pending.requestId ||
      outcome.workspaceId !== pending.workspaceId ||
      workspaceId !== pending.workspaceId
    )
      return;
    pendingRestore = null;
    completeWorkflow(restoreConsumerId, outcome);
    if (outcome.status === 'success') notify.success(m.terminal_sidebar_scriptsRestored_success());
    else notify.warning(outcome.error ?? m.terminal_quakeOverlay_detectFailed_error());
  });

  $effect(() => {
    const outcome = $saveOutcome$;
    const pending = pendingSave;
    if (
      !outcome ||
      !pending ||
      outcome.consumed ||
      outcome.status === 'pending' ||
      outcome.requestId !== pending.requestId ||
      outcome.workspaceId !== pending.workspaceId ||
      workspaceId !== pending.workspaceId
    )
      return;
    pendingSave = null;
    completeWorkflow(saveConsumerId, outcome);
    if (outcome.status !== 'success') {
      notify.error(outcome.error ?? m.terminal_sidebar_saveToRepoFailed_error());
      saveToRepoStatus = 'idle';
      return;
    }
    saveToRepoStatus = 'saved';
    if (saveStatusResetTimer) clearTimeout(saveStatusResetTimer);
    saveStatusResetTimer = setTimeout(() => {
      saveStatusResetTimer = null;
      saveToRepoStatus = 'idle';
    }, 1500);
  });

  $effect(() => {
    const outcome = $updateOutcome$;
    const pending = pendingUpdate;
    if (
      !outcome ||
      !pending ||
      outcome.consumed ||
      outcome.status === 'pending' ||
      outcome.requestId !== pending.requestId ||
      outcome.workspaceId !== pending.workspaceId
    )
      return;
    pendingUpdate = null;
    completeWorkflow(updateConsumerId, outcome);
    if (outcome.status !== 'success') logger.error('Script update failed', outcome.error);
  });

  // ---- Sort function ----
  function sortScripts(scripts: ScriptListEntry[]): ScriptListEntry[] {
    return [...scripts].sort((a, b) => {
      // Priority: live (starting/running/restarting) > exited > idle
      const statusPriority = { starting: 0, running: 0, restarting: 0, exited: 1, idle: 2 };
      const aPriority = statusPriority[a.runtime.status] ?? 3;
      const bPriority = statusPriority[b.runtime.status] ?? 3;

      if (aPriority !== bPriority) return aPriority - bPriority;

      // Within same status, sort alphabetically by name
      return a.name.localeCompare(b.name);
    });
  }

  // ---- Status dot helpers ----
  function getStatusColor(script: ScriptListEntry): string {
    const kind = getScriptStatusKind(script.runtime);
    if (kind === 'running' || kind === 'succeeded') return 'bg-green-500';
    if (kind === 'restarting') return 'bg-warning';
    if (kind === 'failed') return 'bg-red-500';
    if (kind === 'stopped') return 'bg-muted-foreground/60';
    return 'bg-muted-foreground/40';
  }

  function getStatusLabel(script: ScriptListEntry): string {
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
  function getScriptActions(script: ScriptListEntry) {
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
    appStore.dispatch(
      startScriptRequested(
        workspaceId,
        scriptId,
        m.terminal_quakeOverlay_startScriptFailed_error(),
      ),
    );
    onSelectScript?.(scriptId);
    pendingScrollScriptId = scriptId;
  }

  function handleStop(scriptId: string) {
    appStore.dispatch(
      stopScriptRequested(workspaceId, scriptId, m.terminal_quakeOverlay_stopScriptFailed_error()),
    );
  }

  function handleRestart(scriptId: string) {
    appStore.dispatch(
      restartScriptRequested(
        workspaceId,
        scriptId,
        m.terminal_quakeOverlay_restartScriptFailed_error(),
      ),
    );
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

    if (!workspaceId) {
      notify.info(m.terminal_sidebar_openWorkspaceFirst_info());
      return;
    }

    showAgentAssist = false;
    detectFlow = 'agent';
    const requestId = crypto.randomUUID();
    pendingApply = { requestId, workspaceId };
    appStore.dispatch(
      detectScriptsWithAgentRequested(
        workspaceId,
        consumer(applyConsumerId, requestId, 'agent-detection'),
      ),
    );
  }

  function handleAddScript() {
    if (!newName.trim() || !newCommand.trim()) return;
    const requestWorkspaceId = workspaceId;
    const requestId = crypto.randomUUID();
    pendingCreate = { requestId, workspaceId: requestWorkspaceId };
    appStore.dispatch(
      createScriptDefinitionRequested(
        requestWorkspaceId,
        {
          name: newName.trim(),
          command: newCommand.trim(),
          mode: newMode,
          purpose: 'saved',
          source: 'user',
        },
        consumer(createConsumerId, requestId, 'create'),
      ),
    );
  }

  function handleSaveToRepo() {
    if (saveToRepoStatus !== 'idle') return;
    saveToRepoStatus = 'saving';
    const requestWorkspaceId = workspaceId;
    const requestId = crypto.randomUUID();
    pendingSave = { requestId, workspaceId: requestWorkspaceId };
    appStore.dispatch(
      saveScriptDefinitionsToRepoRequested(
        requestWorkspaceId,
        consumer(saveConsumerId, requestId, 'save'),
      ),
    );
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
      if (pendingRemove) return;
      // Delete all selected scripts
      const idsToDelete = Array.from(selectedScriptIds);
      const requestId = crypto.randomUUID();
      const selected = selectScriptEntries
        .select(appStore.state, workspaceId)
        .filter((script) => selectedScriptIds.has(script.id));
      const targets = selected.map((script) => ({ ...script, workspaceId }));
      appStore.dispatch(
        removeScriptDefinitionsRequested(
          workspaceId,
          targets,
          m.terminal_quakeOverlay_deleteScriptFailed_error(),
          consumer(removeConsumerId, requestId, 'bulk-remove'),
        ),
      );
      pendingRemove = {
        requestId,
        workspaceId,
        targetIds: idsToDelete,
        selectedScriptId:
          selectedScriptId && idsToDelete.includes(selectedScriptId) ? selectedScriptId : null,
      };
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
      const mutationWorkspaceId = workspaceId;
      const mutationScriptId = editingScriptId;
      const name = editingScriptName.trim();
      const requestId = crypto.randomUUID();
      updateResourceIdStore.set(mutationScriptId);
      pendingUpdate = { requestId, workspaceId: mutationWorkspaceId };
      appStore.dispatch(
        updateScriptDefinitionRequested(
          mutationWorkspaceId,
          mutationScriptId,
          { name },
          consumer(updateConsumerId, requestId, mutationScriptId),
        ),
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
  const scriptPage$ = selectScriptListPageState(workspaceIdStore);
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
              class="-mt-0.5 -mb-1 flex items-center gap-1 px-1 rounded text-muted-foreground hover:text-foreground transition-colors cursor-pointer shrink-0"
              onclick={(e) => {
                e.stopPropagation();
                appStore.dispatch(
                  openAgentTabRequested(workspaceId, {
                    agentId: $_scriptDetectAgentId$,
                    ...getNavigationContext(e),
                  }),
                );
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
              class="w-full text-xs bg-muted/50 border border-border rounded-md px-2 py-1.5 outline-none focus:border-primary-ink/50 focus:bg-background text-foreground placeholder:text-muted-foreground transition-colors"
            />
            <Input
              type="text"
              bind:value={newCommand}
              placeholder={m.terminal_sidebar_command_placeholder()}
              class="w-full text-xs bg-muted/50 border border-border rounded-md px-2 py-1.5 outline-none focus:border-primary-ink/50 focus:bg-background text-foreground placeholder:text-muted-foreground font-mono transition-colors"
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

        {#if $scriptPage$.nextCursor}
          <Button
            variant="ghost"
            size="sm"
            disabled={$scriptPage$.loading}
            onclick={() => appStore.dispatch(loadMoreScripts(workspaceId))}
            >{m.gitlabCheckout_loadMore_label()}</Button
          >
        {/if}
        {#if $scriptPage$.error}<p role="alert">{$scriptPage$.error}</p>{/if}
        <!-- Script List -->
        {#if hasScripts}
          <ListContainer spacing="compact" class="py-1 px-1.5">
            {#each visibleScripts as script (script.id)}
              <div
                animate:flip={{
                  duration: prefersReducedMotion() ? 0 : spring.moderate.settleMs,
                  easing: spring.moderate.exit.easing,
                }}
                data-script-id={script.id}
              >
                <ListItem
                  size="sm"
                  class={cn(
                    'pr-1.5! pl-1.5!',
                    selectedScriptIds.has(script.id) && 'bg-accent/50! hover:bg-accent/60!',
                  )}
                  title={editingScriptId === script.id ? '' : script.name}
                  subtitle={editingScriptId === script.id ? '' : scriptCommandLabel(script)}
                  subtitleClass="leading-none"
                  active={selectedScriptId === script.id}
                  onclick={(e) => handleSelectScript(script.id, e as MouseEvent)}
                  ondblclick={() => startEditingScript(script.id, script.name)}
                  oncontextmenu={(e) => handleScriptContextMenu(script.id, e as MouseEvent)}
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
                          noFocusStyle
                          placeholder={m.terminal_quakeOverlay_name_placeholder()}
                          class="pointer-events-auto relative z-10 w-full cursor-text border-none bg-transparent hover:bg-transparent p-0 text-sm outline-none focus:outline-none! focus:ring-0!"
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
