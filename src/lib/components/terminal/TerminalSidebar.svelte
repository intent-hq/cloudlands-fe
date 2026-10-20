<script lang="ts">
  import {
    selectScriptListPageState,
    selectScriptWorkflowOutcome,
    selectWorkspaceScriptsInitialized,
    selectScriptDetectionOperation,
  } from '$store/renderer/slices/scripts/scripts-selectors';
  import { loadMoreScripts, refreshScripts } from '$store/renderer/slices/scripts/scripts-slice';
  import { Input } from '$lib/components/ui/input';
  import { flip } from 'svelte/animate';
  import { prefersReducedMotion, spring } from '$lib/motion';
  import type { ScriptMode, ScriptListEntry } from '$features/scripts/types';
  import { getScriptStatusKind, isLiveScriptStatus } from '$features/scripts/utils/script-status';

  import { selectScriptEntries } from '$store/renderer/slices/scripts/scripts-selectors';
  import {
    createScriptDefinitionRequested,
    removeScriptDefinitionsRequested,
    saveScriptDefinitionsToRepoRequested,
    scriptWorkflowConsumed,
    scriptWorkflowReleased,
    stopScriptRequested,
    startScriptRequested,
    restartScriptRequested,
    updateScriptDefinitionRequested,
  } from '$store/renderer/slices/scripts/scripts-slice';
  import type {
    ScriptBulkRemovalOutcome,
    ScriptWorkflowConsumer,
  } from '$store/renderer/slices/scripts/scripts-types';
  import { writable } from 'svelte/store';
  import { onDestroy } from 'svelte';

  import { Button } from '$lib/components/ui/button';
  import ScriptDetectionControls from '$features/scripts/components/ScriptDetectionControls.svelte';
  import { ListContainer, ListItem, ListSection } from '$lib/components/ui/list';
  import { EmptyState, ErrorState, LoadingState } from '$lib/components/patterns/screen';
  import { notify } from '$lib/components/patterns/notify';
  import { cn } from '$lib/utils';
  import { createLogger } from '$lib/utils/client-logger';
  import { pushEscapeLayer } from '$lib/utils/escapeLayers';
  import {
    faCheck,
    faFloppyDisk,
    faPlay,
    faPlus,
    faRotateRight,
    faStop,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    workspaceId: string;
    selectedScriptId?: string | null;
    onSelectScript?: (scriptId: string | null) => void;
    class?: string;
  }

  let { workspaceId, selectedScriptId = null, onSelectScript, class: className }: Props = $props();

  const workspaceIdStore = writable('');
  $effect(() => workspaceIdStore.set(workspaceId));
  const logger = createLogger('TerminalSidebar');
  const createConsumerId = crypto.randomUUID();
  const removeConsumerId = crypto.randomUUID();
  const saveConsumerId = crypto.randomUUID();
  const updateConsumerId = crypto.randomUUID();
  const updateResourceIdStore = writable('');
  const createOutcome$ = selectScriptWorkflowOutcome(createConsumerId, workspaceIdStore, 'create');
  const removeOutcome$ = selectScriptWorkflowOutcome(
    removeConsumerId,
    workspaceIdStore,
    'bulk-remove',
  );
  const saveOutcome$ = selectScriptWorkflowOutcome(saveConsumerId, workspaceIdStore, 'save');
  const updateOutcome$ = selectScriptWorkflowOutcome(
    updateConsumerId,
    workspaceIdStore,
    updateResourceIdStore,
  );

  let showAllScripts = $state(false);

  let selectedScriptIds = $state<Set<string>>(new Set());
  let contextMenuPos = $state<{ x: number; y: number } | null>(null);
  let contextMenuScriptId = $state<string | null>(null);
  let lastClickedScriptId = $state<string | null>(null);
  let pendingScrollScriptId = $state<string | null>(null);

  let pendingCreate = $state<{ requestId: string; workspaceId: string } | null>(null);
  let pendingRemove = $state<{
    requestId: string;
    workspaceId: string;
    selectedScriptId: string | null;
    targetIds: string[];
  } | null>(null);
  let pendingSave = $state<{ requestId: string; workspaceId: string } | null>(null);
  let pendingUpdate = $state<{ requestId: string; workspaceId: string } | null>(null);
  let saveStatusResetTimer: ReturnType<typeof setTimeout> | null = null;
  let workflowWorkspaceId = '';
  const workflowConsumerIds = [
    createConsumerId,
    removeConsumerId,
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
    if (saveStatusResetTimer) clearTimeout(saveStatusResetTimer);
    if (workflowWorkspaceId) releaseWorkflows(workflowWorkspaceId);
  });

  $effect(() => {
    const nextWorkspaceId = workspaceId;
    if (workflowWorkspaceId && workflowWorkspaceId !== nextWorkspaceId) {
      releaseWorkflows(workflowWorkspaceId);
      pendingCreate = null;
      pendingRemove = null;
      pendingSave = null;
      pendingUpdate = null;
    }
    workflowWorkspaceId = nextWorkspaceId;
  });

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
  const scriptEntries$ = selectScriptEntries(workspaceIdStore);

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

  function completeWorkflow(
    consumerId: string,
    outcome: { workspaceId: string; requestId: string },
  ): void {
    appStore.dispatch(scriptWorkflowConsumed(outcome.workspaceId, consumerId, outcome.requestId));
  }

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
      selectedScriptId === pending.selectedScriptId &&
      result?.removed.includes(pending.selectedScriptId)
    ) {
      onSelectScript?.(null);
    }
    const removedTargets = new Set(outcome.status === 'success' && result ? result.removed : []);
    selectedScriptIds = new Set(
      Array.from(selectedScriptIds).filter((scriptId) => !removedTargets.has(scriptId)),
    );
    if (lastClickedScriptId && removedTargets.has(lastClickedScriptId)) lastClickedScriptId = null;
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
  const scriptsInitialized$ = selectWorkspaceScriptsInitialized(workspaceIdStore);
  const detectionOperation$ = selectScriptDetectionOperation(workspaceIdStore);
</script>

{#snippet scriptListError()}
  <ErrorState density="compact" class="min-h-0 justify-start px-3.5 py-2 text-left">
    {#snippet message()}<p class="break-words">{$scriptPage$.error}</p>{/snippet}
  </ErrorState>
{/snippet}

<!-- Sidebar Container -->
<div
  class={cn(
    'relative flex h-full min-w-0 shrink-0 flex-col select-none border-l border-border bg-sidebar',
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
    <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto py-2">
      <!-- Scripts Section -->
      <ListSection
        title={m.terminal_quakeOverlay_scripts_title()}
        titleClass="mb-0 flex-wrap gap-y-0 px-3.5 py-0"
        icon={faPlay}
        class="shrink-0"
      >
        {#snippet actions()}
          <ScriptDetectionControls {workspaceId} />
          {#if $scriptPage$.error || (!$scriptsInitialized$ && !$scriptPage$.loading && !$detectionOperation$?.pending)}
            <Button
              variant="ghost-light"
              size="icon-compact"
              iconOnly
              aria-label={m.terminal_sidebar_retryScripts_label()}
              tooltip={m.terminal_sidebar_retryScripts_label()}
              disabled={$scriptPage$.loading}
              onclick={() => appStore.dispatch(refreshScripts(workspaceId))}
            >
              <Fa icon={faRotateRight} size="xs" />
            </Button>
          {/if}
          {#if hasScripts}
            <Button
              variant="ghost-light"
              size="icon-xs"
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
                class={saveToRepoStatus === 'saved' ? 'text-success' : ''}
              />
            </Button>
          {/if}
          <Button
            variant="ghost-light"
            size="icon-xs"
            onclick={(e) => {
              e.stopPropagation();
              showAddForm = !showAddForm;
            }}
            tooltip={m.terminal_sidebar_addScript_tooltip()}
            aria-label={m.terminal_sidebar_addScript_tooltip()}
          >
            <Fa icon={faPlus} size="xs" />
          </Button>
        {/snippet}

        <!-- Add Script Form -->
        {#if showAddForm}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="flex flex-col gap-1.5 px-3.5 py-2" onkeydown={handleAddFormKeydown}>
            <Input
              type="text"
              bind:value={newName}
              placeholder={m.terminal_quakeOverlay_name_placeholder()}
              class="w-full type-caption bg-muted/50 border border-border rounded-md px-2 py-1.5 outline-none focus:border-primary-ink/50 focus:bg-background text-foreground placeholder:text-muted-foreground transition-colors"
            />
            <Input
              type="text"
              bind:value={newCommand}
              placeholder={m.terminal_sidebar_command_placeholder()}
              class="w-full type-caption bg-muted/50 border border-border rounded-md px-2 py-1.5 outline-none focus:border-primary-ink/50 focus:bg-background text-foreground placeholder:text-muted-foreground font-mono transition-colors"
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

        {#if $scriptPage$.error && !hasScripts}
          {@render scriptListError()}
        {/if}
        <!-- Script List -->
        {#if hasScripts}
          <ListContainer spacing="compact" class="px-2 py-1">
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
                          class="pointer-events-auto relative z-10 w-full cursor-text border-none bg-transparent hover:bg-transparent p-0 type-caption outline-none focus:outline-none! focus:ring-0!"
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
                class="w-full text-left px-2 py-1.5 type-caption text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
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
                      class="w-full text-left px-3 py-1.5 type-caption hover:bg-accent cursor-pointer transition-colors"
                      onclick={() => handleContextMenuAction('startAll')}
                    >
                      {m.terminal_sidebar_startAll_label()}
                    </Button>
                    <Button
                      variant="ghost-light"
                      type="button"
                      class="w-full text-left px-3 py-1.5 type-caption hover:bg-accent cursor-pointer transition-colors"
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
                        class="w-full text-left px-3 py-1.5 type-caption hover:bg-accent cursor-pointer transition-colors"
                        onclick={() => handleContextMenuAction('stop')}
                      >
                        {m.terminal_quakeOverlay_stop_label()}
                      </Button>
                      <Button
                        variant="ghost-light"
                        type="button"
                        class="w-full text-left px-3 py-1.5 type-caption hover:bg-accent cursor-pointer transition-colors"
                        onclick={() => handleContextMenuAction('restart')}
                      >
                        {m.terminal_quakeOverlay_restart_label()}
                      </Button>
                    {:else}
                      <Button
                        variant="ghost-light"
                        type="button"
                        class="w-full text-left px-3 py-1.5 type-caption hover:bg-accent cursor-pointer transition-colors"
                        onclick={() => handleContextMenuAction('start')}
                      >
                        {m.terminal_quakeOverlay_start_label()}
                      </Button>
                    {/if}
                    <Button
                      variant="ghost-light"
                      type="button"
                      class="w-full text-left px-3 py-1.5 type-caption hover:bg-accent cursor-pointer transition-colors"
                      onclick={() => handleContextMenuAction('edit')}
                    >
                      {m.terminal_sidebar_edit_label()}
                    </Button>
                  {/if}
                  <div class="border-t border-border my-1"></div>
                  <Button
                    variant="plain"
                    type="button"
                    class="w-full text-left px-3 py-1.5 type-caption hover:bg-accent cursor-pointer transition-colors text-danger hover:bg-danger-background/10"
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
        {:else if !showAddForm && !$scriptPage$.error}
          {#if $detectionOperation$?.pending || $scriptPage$.loading || !$scriptsInitialized$}
            <LoadingState
              density="compact"
              count={3}
              label={m.terminal_sidebar_loadingScripts_label()}
              class="gap-1 px-3.5 py-2 [&_[data-slot=skeleton]]:h-(--control-height-compact)"
            />
          {:else}
            <EmptyState density="compact" class="min-h-0 justify-start px-3.5 py-2 text-left">
              {#snippet description()}{m.terminal_quakeOverlay_noScriptsYet_label()}{/snippet}
            </EmptyState>
          {/if}
        {/if}
        {#if $scriptPage$.error && hasScripts}
          {@render scriptListError()}
        {:else if hasScripts && $scriptPage$.nextCursor}
          <div class="px-3.5 py-1">
            <Button
              variant="ghost"
              size="compact"
              disabled={$scriptPage$.loading}
              onclick={() => appStore.dispatch(loadMoreScripts(workspaceId))}
              >{m.gitlabCheckout_loadMore_label()}</Button
            >
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
