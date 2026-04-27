<script lang="ts">
  /**
   * TerminalSidebar - Vertical sidebar within the terminal panel
   *
   * Shows Scripts section (top) and Terminals section (bottom).
   * Collapsible to 48px icon-only mode, resizable via drag handle.
   */
  import { flip } from 'svelte/animate';
  import { scriptsClient } from '$features/scripts/scripts.client';
  import type { ScriptCategory, ScriptMode, ScriptWithState } from '$features/scripts/types';
  import { getReduxStore } from '$lib/store/redux-dispatch-bridge';
  import { selectScriptEntries } from '$lib/store/slices/scripts/scripts-selectors';
  import { refreshScripts, removeScript, upsertScript } from '$lib/store/slices/scripts/scripts-slice';
  import { selectActiveWorkspace } from '$lib/store/slices/workspace/workspace-selectors';
  import { selectAgentById } from '$lib/store/slices/workspace-agents/workspace-agents-selectors';
  import AugieAvatarWithState from '$lib/components/ui/auggie-avatar/AugieAvatarWithState.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import { ListContainer, ListItem, ListSection } from '$lib/components/ui/list';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { toast } from '$lib/components/ui/toast';
  import { useBackgroundAgent } from '$lib/hooks/use-background-agent.svelte';
  import {
    selectExecutorIsRunning,
    selectExecutorAgentId,
  } from '$lib/store/slices/background-agent-executor/background-agent-executor-selectors';
  import {
    selectActiveTerminalId as selectActiveTerminalIdSelector,
    selectUserTerminals as selectTerminalsSelector,
  } from '$lib/store/slices/terminals/terminals-selectors';
  import {
    removeTerminal,
  } from '$lib/store/slices/terminals/terminals-slice';

  const activeWorkspace = selectActiveWorkspace();
  import { getDispatch } from '$lib/store/utils/svelte-context';
  import { openAgentTabRequested } from '$lib/store/slices/app-layout/app-layout-slice';
  import { cn } from '$lib/utils';
  import { createLogger } from '$lib/utils/client-logger';
  import {
    faCheck,
    faFloppyDisk,
    faPlay,
    faPlus,
    faRotateRight,
    faSearch,
    faSpinner,
    faStop,
    faTerminal,
    faTrash,
    faWandMagicSparkles,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';

  interface Props {
    workspaceId: string;
    selectedScriptId?: string | null;
    onSelectScript?: (scriptId: string | null) => void;
    onSelectTerminal?: (terminalId: string) => void;
    class?: string;
  }

  let {
    workspaceId,
    selectedScriptId = null,
    onSelectScript,
    onSelectTerminal,
    class: className,
  }: Props = $props();

  const logger = createLogger('TerminalSidebar');

  // ---- Agent-assisted script detection ----
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

  type DetectFlow = 'idle' | 'local' | 'agent';

  let detectFlow = $state<DetectFlow>('idle');
  let showAgentAssist = $state(false);
  let showAllScripts = $state(false);

  // Multi-select and context menu state
  let selectedScriptIds = $state<Set<string>>(new Set());
  let contextMenuPos = $state<{ x: number; y: number } | null>(null);
  let contextMenuScriptId = $state<string | null>(null);
  let lastClickedScriptId = $state<string | null>(null);
  let pendingScrollScriptId = $state<string | null>(null);

  /** Process a parsed detection result (diff or array format). */
  async function handleDetectionResult(parsed: any): Promise<void> {
    // Snapshot full script objects for undo (preserves cwd, env, autoStart, etc.)
    const snapshot = selectScriptEntries.select(getReduxStore().getState()).map((s) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { runtime, ...scriptDef } = s;
      return { ...scriptDef };
    });

    // Handle diff format: { add: [...], update: [...], remove: [...] }
    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      ('add' in parsed || 'update' in parsed || 'remove' in parsed)
    ) {
      let addedCount = 0;
      let updatedCount = 0;
      let removedCount = 0;

      // Only allow remove/update on auto-detected scripts — user scripts are sacred
      const autoDetectedIds = new Set(
        selectScriptEntries.select(getReduxStore().getState()).filter((s) => s.source === 'auto-detected').map((s) => s.id),
      );

      // Process removals (only auto-detected scripts)
      if (Array.isArray(parsed.remove)) {
        for (const scriptId of parsed.remove) {
          if (typeof scriptId === 'string' && autoDetectedIds.has(scriptId)) {
            await scriptsClient.remove(workspaceId, scriptId);
            sidebarDispatch(removeScript(workspaceId, scriptId));
            removedCount++;
          }
        }
      }

      // Process updates (only auto-detected scripts)
      if (Array.isArray(parsed.update)) {
        for (const entry of parsed.update) {
          if (entry.id && typeof entry.id === 'string' && autoDetectedIds.has(entry.id)) {
            const updates: Record<string, string> = {};
            if (entry.name) updates.name = entry.name;
            if (entry.command) updates.command = entry.command;
            if (entry.mode && validModes.has(entry.mode)) updates.mode = entry.mode;
            if (entry.category && validCategories.has(entry.category))
              updates.category = entry.category;
            await scriptsClient.update(workspaceId, entry.id, updates);
            updatedCount++;
          }
        }
      }

      // Process additions
      if (Array.isArray(parsed.add)) {
        for (const entry of parsed.add) {
          if (
            typeof entry.name === 'string' &&
            typeof entry.command === 'string' &&
            validModes.has(entry.mode)
          ) {
            const createResult = await scriptsClient.create(workspaceId, {
              name: entry.name,
              command: entry.command,
              mode: entry.mode as ScriptMode,
              category: (entry.category as ScriptCategory) || 'other',
              source: 'auto-detected',
            });
            if (createResult.success && createResult.data) {
              sidebarDispatch(upsertScript(workspaceId, createResult.data));
              addedCount++;
            }
          }
        }
      }

      sidebarDispatch(refreshScripts(workspaceId));

      const parts: string[] = [];
      if (addedCount > 0) parts.push(`+${addedCount} added`);
      if (updatedCount > 0) parts.push(`~${updatedCount} updated`);
      if (removedCount > 0) parts.push(`-${removedCount} removed`);

      showAgentAssist = selectScriptEntries.select(getReduxStore().getState()).length === 0;

      if (parts.length > 0) {
        toast.success(`Scripts updated: ${parts.join(', ')}`, {
          action: {
            label: 'Undo',
            onClick: async () => {
              // Remove all current scripts
              for (const s of selectScriptEntries.select(getReduxStore().getState())) {
                await scriptsClient.remove(workspaceId, s.id);
              }
              // Re-create from snapshot (preserving all fields)
              for (const s of snapshot) {
                await scriptsClient.create(workspaceId, {
                  name: s.name,
                  command: s.command,
                  mode: s.mode,
                  category: s.category,
                  source: s.source || 'user',
                  cwd: s.cwd,
                  env: s.env,
                  autoStart: s.autoStart,
                });
              }
              sidebarDispatch(refreshScripts(workspaceId));
              toast.success('Scripts restored');
            },
          },
          duration: 10000,
        });
      } else {
        toast.info('No script changes detected');
      }
      return;
    }

    // Fallback: old flat array format — deduplicate
    if (Array.isArray(parsed)) {
      const existingKeys = new Set(
        selectScriptEntries.select(getReduxStore().getState()).map((s) => `${s.name}::${s.command}`),
      );

      let createdCount = 0;
      for (const entry of parsed) {
        if (
          typeof entry.name === 'string' &&
          typeof entry.command === 'string' &&
          validModes.has(entry.mode) &&
          !existingKeys.has(`${entry.name}::${entry.command}`)
        ) {
          const createResult = await scriptsClient.create(workspaceId, {
            name: entry.name,
            command: entry.command,
            mode: entry.mode as ScriptMode,
            category: (entry.category as ScriptCategory) || 'other',
            source: 'auto-detected',
          });
          if (createResult.success && createResult.data) {
            sidebarDispatch(upsertScript(workspaceId, createResult.data));
            createdCount++;
          }
        }
      }

      showAgentAssist = selectScriptEntries.select(getReduxStore().getState()).length === 0;

      if (createdCount > 0) {
        toast.success(`Detected ${createdCount} new script${createdCount === 1 ? '' : 's'}`);
      } else {
        toast.info('No new scripts detected');
      }
      return;
    }

    // Neither format matched
    logger.warn('DETECTED_SCRIPTS result is not recognized format');
    toast.info('Script detection returned unexpected format');
    await runLocalDetect({ source: 'fallback' });
  }

  const scriptDetectAgent = useBackgroundAgent('script-detect', {
    resultTag: 'DETECTED_SCRIPTS',
    timeout: 90000,
    onResult: async (result) => {
      try {
        const parsed = JSON.parse(result);
        await handleDetectionResult(parsed);
      } catch (e) {
        logger.warn('Failed to parse DETECTED_SCRIPTS result', {
          error: e instanceof Error ? e.message : String(e),
        });
        toast.info('Agent detection failed, re-scanning local project files...');
        await runLocalDetect({ source: 'fallback' });
      }
    },
    onError: async () => {
      // Try to salvage JSON from the agent's raw messages via Redux
      const currentAgentId = selectExecutorAgentId.select(getReduxStore().getState(), workspaceId, 'script-detect');
      const agentSession = currentAgentId
        ? selectAgentById.select(getReduxStore().getState(), currentAgentId)
        : undefined;
      const messages = agentSession?.messages;
      if (messages && messages.length > 0) {
        for (let i = messages.length - 1; i >= 0; i--) {
          const msg = messages[i];
          const texts: string[] = [];
          if (msg.contentBlocks) {
            for (const block of msg.contentBlocks) {
              if (block.type === 'text' && block.text) texts.push(block.text);
            }
          }
          const content = texts.join('\n');

          // Try extracting JSON from code blocks or raw content
          const jsonMatch =
            content.match(/```json?\s*\n?([\s\S]*?)\n?\s*```/) ||
            content.match(/(\{[\s\S]*?"add"[\s\S]*?\})/);
          if (jsonMatch) {
            try {
              const parsed = JSON.parse(jsonMatch[1].trim());
              logger.info('Salvaged detection result from raw agent response');
              await handleDetectionResult(parsed);
              return;
            } catch (e) {
              logger.warn('Failed to parse salvaged JSON', { error: e });
            }
          }
        }
      }

      logger.warn('Script detection agent failed, falling back to local detection');
      toast.info('Agent detection failed, re-scanning local project files...');
      await runLocalDetect({ source: 'fallback' });
    },
  });

  async function runLocalDetect(options: { source?: 'primary' | 'fallback' } = {}) {
    detectFlow = 'local';
    try {
      logger.info('Running local script detection', { source: options.source ?? 'primary' });
      const result = await scriptsClient.detect(workspaceId);
      if (!result.success) {
        throw new Error(result.error || 'Local script detection failed');
      }

      sidebarDispatch(refreshScripts(workspaceId));
      // Use the detected count from the IPC response (number of scripts found
      // in project manifests) rather than the total store count which includes
      // user-created scripts. Default to 0 so agent assist is shown when the
      // field is missing.
      const detectedCount = typeof result.detected === 'number' ? result.detected : 0;
      showAgentAssist = detectedCount === 0;

      if (detectedCount > 0) {
        toast.success(
          `Detected ${detectedCount} script${detectedCount === 1 ? '' : 's'} from project files`,
        );
      } else {
        toast.info('No scripts found locally. You can try agent-assisted detection.');
      }
      logger.info('Local detection complete', {
        totalScripts: selectScriptEntries.select(getReduxStore().getState()).length,
        detectedCount,
        source: options.source ?? 'primary',
      });
    } catch (e) {
      showAgentAssist = true;
      logger.error('Local script detection failed', {
        error: e instanceof Error ? e.message : String(e),
        source: options.source ?? 'primary',
      });
      toast.error('Script detection failed');
    } finally {
      detectFlow = 'idle';
    }
  }

  function buildExistingScriptsContext(): string {
    const existingScripts = selectScriptEntries.select(getReduxStore().getState()).map((s) => ({
      id: s.id,
      name: s.name,
      command: s.command,
      mode: s.mode,
      category: s.category,
    }));

    return existingScripts.length > 0
      ? `\n\nExisting scripts (do NOT duplicate these, return only changes):\n${JSON.stringify(existingScripts, null, 2)}`
      : '';
  }

  // Sidebar state
  let collapsed = $state(false);
  let sidebarWidth = $state(240);
  let isResizing = $state(false);
  let showAddForm = $state(false);
  let saveToRepoStatus = $state<'idle' | 'saving' | 'saved'>('idle');

  // Add form state
  let newName = $state('');
  let newCommand = $state('');
  let newMode = $state<ScriptMode>('command');

  // Constants
  const MIN_WIDTH = 48;
  const MAX_WIDTH = 400;
  const COLLAPSED_WIDTH = 48;

  // Store bindings
  const sidebarDispatch = getDispatch();
  const _sidebarTerminals = selectTerminalsSelector();
  const _sidebarActiveTerminalId = selectActiveTerminalIdSelector();
  const scriptEntries$ = selectScriptEntries();
  // Background agent executor state via direct selector subscriptions
  const _scriptDetectIsRunning$ = selectExecutorIsRunning(workspaceId, 'script-detect');
  const _scriptDetectAgentId$ = selectExecutorAgentId(workspaceId, 'script-detect');

  // Derived
  const scripts = $derived($scriptEntries$);
  const hasScripts = $derived(scripts.length > 0);
  const effectiveWidth = $derived(collapsed ? COLLAPSED_WIDTH : sidebarWidth);
  const scriptDetectIsRunning = $derived($_scriptDetectIsRunning$);
  const scriptDetectAgentId = $derived($_scriptDetectAgentId$);
  const isDetecting = $derived(detectFlow !== 'idle' || scriptDetectIsRunning);
  const isLocalDetecting = $derived(detectFlow === 'local');
  const isAgentDetecting = $derived(detectFlow === 'agent' || scriptDetectIsRunning);
  const sidebarTerminals = $derived($_sidebarTerminals);
  const activeTerminalId = $derived($_sidebarActiveTerminalId);

  // ---- Sort function ----
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

  // ---- Status dot helpers ----
  function getStatusColor(script: ScriptWithState): string {
    const { status, exitCode } = script.runtime;
    if (status === 'running') return 'bg-green-500';
    if (status === 'idle') return 'bg-muted-foreground/40';
    // exited
    if (exitCode === 0 || exitCode === null || exitCode === undefined)
      return 'bg-muted-foreground/40';
    if (exitCode >= 128) return 'bg-muted-foreground/60'; // signal-stopped
    return 'bg-red-500'; // error (1-127)
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

  // ---- Actions ----
  function getScriptActions(script: ScriptWithState) {
    const actions: Array<{
      icon: any;
      label: string;
      tooltip?: string;
      onClick: (e: MouseEvent) => void;
    }> = [];
    if (script.runtime.status === 'running') {
      actions.push({ icon: faStop, label: 'Stop', onClick: () => handleStop(script.id) });
      actions.push({
        icon: faRotateRight,
        label: 'Restart',
        onClick: () => handleRestart(script.id),
      });
    } else {
      actions.push({ icon: faPlay, label: 'Start', onClick: () => handleStart(script.id) });
    }
    return actions;
  }

  async function handleStart(scriptId: string) {
    await scriptsClient.start(workspaceId, scriptId);
    onSelectScript?.(scriptId);
    pendingScrollScriptId = scriptId;
  }

  async function handleStop(scriptId: string) {
    await scriptsClient.stop(workspaceId, scriptId);
  }

  async function handleRestart(scriptId: string) {
    await scriptsClient.restart(workspaceId, scriptId);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async function handleDelete(scriptId: string) {
    await scriptsClient.remove(workspaceId, scriptId);
    sidebarDispatch(removeScript(workspaceId, scriptId));
    if (selectedScriptId === scriptId) {
      onSelectScript?.(null);
    }
  }

  async function handleDetect() {
    if (isDetecting) {
      return;
    }

    showAgentAssist = false;
    await runLocalDetect({ source: 'primary' });
  }

  async function handleAgentDetect() {
    if (isDetecting) {
      return;
    }

    const workspace = $activeWorkspace;
    if (!workspace) {
      toast.info('Open the workspace before asking an agent to inspect scripts.');
      return;
    }

    showAgentAssist = false;
    detectFlow = 'agent';

    try {
      await scriptDetectAgent.execute(workspace, {
        message: SCRIPT_DETECT_PROMPT + buildExistingScriptsContext(),
      });
    } finally {
      detectFlow = 'idle';
    }
  }

  async function handleAddScript() {
    if (!newName.trim() || !newCommand.trim()) return;
    const result = await scriptsClient.create(workspaceId, {
      name: newName.trim(),
      command: newCommand.trim(),
      mode: newMode,
      source: 'user',
    });
    if (result.success && result.data) {
      sidebarDispatch(upsertScript(workspaceId, result.data));
      onSelectScript?.(result.data.id);
      newName = '';
      newCommand = '';
      newMode = 'command';
      showAddForm = false;
    }
  }

  async function handleSaveToRepo() {
    if (saveToRepoStatus !== 'idle') return;
    saveToRepoStatus = 'saving';
    try {
      const result = await scriptsClient.saveToRepo(workspaceId);
      if (result.success) {
        saveToRepoStatus = 'saved';
        setTimeout(() => {
          saveToRepoStatus = 'idle';
        }, 1500);
      } else {
        toast.error(result.error || 'Failed to save scripts to repo');
        saveToRepoStatus = 'idle';
      }
    } catch {
      toast.error('Failed to save scripts to repo');
      saveToRepoStatus = 'idle';
    }
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
      const scripts = sortScripts(selectScriptEntries.select(getReduxStore().getState()));
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

  async function handleContextMenuAction(action: 'start' | 'stop' | 'restart' | 'edit' | 'delete' | 'startAll' | 'stopAll') {
    if (action === 'delete') {
      // Delete all selected scripts
      const idsToDelete = Array.from(selectedScriptIds);
      for (const id of idsToDelete) {
        await scriptsClient.remove(workspaceId, id);
        sidebarDispatch(removeScript(workspaceId, id));
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
        await handleStart(id);
      }
    } else if (action === 'stopAll') {
      // Stop all selected scripts
      for (const id of selectedScriptIds) {
        await handleStop(id);
      }
    } else if (action === 'edit' && contextMenuScriptId) {
      // Edit the right-clicked script
      onSelectScript?.(contextMenuScriptId);
    } else if (contextMenuScriptId) {
      // Start/stop/restart the right-clicked script
      if (action === 'start') {
        await handleStart(contextMenuScriptId);
      } else if (action === 'stop') {
        await handleStop(contextMenuScriptId);
      } else if (action === 'restart') {
        await handleRestart(contextMenuScriptId);
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
      scriptsClient.update(workspaceId, editingScriptId, { name: editingScriptName.trim() });
      sidebarDispatch(refreshScripts(workspaceId));
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
      const script = selectScriptEntries.select(getReduxStore().getState()).find((s) => s.id === pendingScrollScriptId);
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

  // Close context menu on Escape key
  function handleWindowKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && contextMenuPos) {
      closeContextMenu();
    }
  }
  /* eslint-disable @typescript-eslint/no-unused-vars -- template-level vars used by Svelte runtime */
</script>

<svelte:window onkeydown={handleWindowKeydown} />

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
        tooltip="Scripts"
        aria-label="Expand scripts"
      >
        <Fa icon={faPlay} size="xs" />
      </Button>
    </div>
  {:else}
    <!-- Expanded: full sidebar -->
    <div class="flex-1 flex flex-col min-h-0 overflow-y-auto pt-0">
      <!-- Scripts Section -->
      <ListSection
        title="Scripts"
        titleClass="mb-0.5 mt-1.5 px-3.5!"
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
              tooltip={saveToRepoStatus === 'saved' ? 'Saved!' : 'Save scripts to repo'}
              aria-label="Save scripts to repo"
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
            tooltip="Add script"
          >
            <Fa icon={faPlus} size="xs" />
          </Button>
          {#if isAgentDetecting && scriptDetectAgentId}
            <button
              type="button"
              class="-mt-0.5 -mb-1 flex items-center gap-1 px-1 rounded text-muted-foreground/60 hover:text-muted-foreground transition-colors cursor-pointer shrink-0"
              onclick={(e) => {
                e.stopPropagation();
                const wsId = $activeWorkspace?.id;
                if (wsId) {
                  getReduxStore().dispatch(
                    openAgentTabRequested(wsId, { agentId: scriptDetectAgentId }),
                  );
                }
              }}
              title="View detection agent"
            >
              <div
                class="shrink-0 flex-none"
                style="min-width: 16px; min-height: 16px; width: 16px; height: 16px;"
              >
                <AugieAvatarWithState
                  agentId={scriptDetectAgentId}
                  state="running"
                  size={16}
                />
              </div>
              <span class="text-ui">Asking agent…</span>
            </button>
          {:else if isAgentDetecting}
            <div class="-mt-0.5 -mb-1 flex items-center gap-1 px-1 text-muted-foreground">
              <!-- a11y-ignore -->
              <Fa icon={faSpinner} size="xs" class="animate-spin" />
              <span class="text-ui">Asking agent…</span>
            </div>
          {:else if isLocalDetecting}
            <div class="-mt-0.5 -mb-1 flex items-center gap-1 px-1 text-muted-foreground">
              <!-- a11y-ignore -->
              <Fa icon={faSpinner} size="xs" class="animate-spin" />
              <span class="text-ui">Scanning files…</span>
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
                tooltip="Ask an agent to inspect unusual project layouts"
              >
                Agent assist
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
              tooltip="Scan local project files for scripts"
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
              tooltip="Use AI to detect scripts from project files"
            >
              <Fa icon={faWandMagicSparkles} size="xs" />
              Detect with AI
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
            <input
              type="text"
              bind:value={newName}
              placeholder="Name"
              class="w-full text-xs bg-muted/50 border border-border/40 rounded-md px-2 py-1.5 outline-none focus:border-primary/50 focus:bg-background text-foreground placeholder:text-muted-foreground/50 transition-colors"
            />
            <input
              type="text"
              bind:value={newCommand}
              placeholder="Command, e.g. npm run dev"
              class="w-full text-xs bg-muted/50 border border-border/40 rounded-md px-2 py-1.5 outline-none focus:border-primary/50 focus:bg-background text-foreground placeholder:text-muted-foreground/50 font-mono transition-colors"
            />
            <div class="flex items-center gap-1.5 justify-end">
              <Button variant="ghost-light" size="xs" onclick={() => (showAddForm = false)}>
                Cancel
              </Button>
              <Button
                variant="default"
                size="xs"
                onclick={handleAddScript}
                disabled={!newName.trim() || !newCommand.trim()}
              >
                <Fa icon={faPlus} size="xs" />
                Add
              </Button>
            </div>
          </div>
        {/if}

        <!-- Script List -->
        {#if hasScripts}
          <ListContainer spacing="compact" class="py-0.5 px-1.5">
            {#each showAllScripts ? sortScripts(scripts) : sortScripts(scripts).slice(0, 6) as script (script.id)}
              <div animate:flip={{ duration: 200 }} data-script-id={script.id}>
              <ListItem
                size="sm"
                class={cn('pr-1.5! pl-1.5!', selectedScriptIds.has(script.id) && 'bg-accent/50! hover:bg-accent/60!')}
                title={editingScriptId === script.id ? '' : script.name}
                subtitle={editingScriptId === script.id ? '' : script.command}
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
                    ></div>
                  </div>
                {/snippet}
                {#if editingScriptId === script.id}
                  {#snippet children()}
                    <input
                      type="text"
                      data-edit-script={script.id}
                      bind:value={editingScriptName}
                      onblur={finishEditingScript}
                      onkeydown={handleEditScriptKeydown}
                      onclick={(e) => e.stopPropagation()}
                      placeholder="Name"
                      class="w-full p-0 border-none bg-transparent text-sm outline-none focus:outline-none! focus:ring-0!"
                    />
                  {/snippet}
                {/if}
              </ListItem>
              </div>
            {/each}
            {#if scripts.length > 6}
              <button
                type="button"
                class="w-full text-left px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                onclick={() => (showAllScripts = !showAllScripts)}
              >
                {showAllScripts ? 'Show less' : `+ ${scripts.length - 6} scripts`}
              </button>
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
                {@const script = scripts.find((s) => s.id === contextMenuScriptId)}
                {#if script}
                  {#if selectedScriptIds.size > 1}
                    <!-- Multi-select actions -->
                    <button
                      type="button"
                      class="w-full text-left px-3 py-1.5 text-sm hover:bg-accent cursor-pointer transition-colors"
                      onclick={() => handleContextMenuAction('startAll')}
                    >
                      Start All
                    </button>
                    <button
                      type="button"
                      class="w-full text-left px-3 py-1.5 text-sm hover:bg-accent cursor-pointer transition-colors"
                      onclick={() => handleContextMenuAction('stopAll')}
                    >
                      Stop All
                    </button>
                  {:else}
                    <!-- Single-select actions -->
                    {#if script.runtime.status === 'running'}
                      <button
                        type="button"
                        class="w-full text-left px-3 py-1.5 text-sm hover:bg-accent cursor-pointer transition-colors"
                        onclick={() => handleContextMenuAction('stop')}
                      >
                        Stop
                      </button>
                      <button
                        type="button"
                        class="w-full text-left px-3 py-1.5 text-sm hover:bg-accent cursor-pointer transition-colors"
                        onclick={() => handleContextMenuAction('restart')}
                      >
                        Restart
                      </button>
                    {:else}
                      <button
                        type="button"
                        class="w-full text-left px-3 py-1.5 text-sm hover:bg-accent cursor-pointer transition-colors"
                        onclick={() => handleContextMenuAction('start')}
                      >
                        Start
                      </button>
                    {/if}
                    <button
                      type="button"
                      class="w-full text-left px-3 py-1.5 text-sm hover:bg-accent cursor-pointer transition-colors"
                      onclick={() => handleContextMenuAction('edit')}
                    >
                      Edit
                    </button>
                  {/if}
                  <div class="border-t border-border my-1"></div>
                  <button
                    type="button"
                    class="w-full text-left px-3 py-1.5 text-sm hover:bg-accent cursor-pointer transition-colors text-destructive-foreground hover:bg-destructive/10"
                    onclick={() => handleContextMenuAction('delete')}
                  >
                    {selectedScriptIds.size > 1 ? `Delete ${selectedScriptIds.size} scripts` : 'Delete'}
                  </button>
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
              <p>No scripts found. Try AI detection for unusual project layouts.</p>
              <Button variant="outline" size="xs" onclick={handleAgentDetect}>
                <Fa icon={faWandMagicSparkles} size="xs" />
                Detect with AI
              </Button>
            {:else}
              <p>No scripts found. Add one manually or use AI detection.</p>
            {/if}
          </div>
        {/if}
      </ListSection>

      <!-- Terminals Section -->
      <ListSection
        title="Terminals"
        titleClass="mb-0.5 mt-1.5 px-3.5!"
        icon={faTerminal}
        class="py-1 shrink-0"
      >
        {#if sidebarTerminals.length > 0}
          <ListContainer spacing="compact" class="py-0.5 px-2">
            {#each sidebarTerminals as term (term.id)}
              <ListItem
                size="sm"
                class="pr-2! pl-2!"
                title={term.customName || term.name || 'Terminal'}
                active={selectedScriptId === null && activeTerminalId === term.id}
                onclick={() => {
                  onSelectScript?.(null);
                  onSelectTerminal?.(term.id);
                }}
                actions={[
                  {
                    icon: faTrash,
                    label: 'Close Terminal',
                    onClick: (e) => {
                      e.stopPropagation();
                      if (workspaceId) sidebarDispatch(removeTerminal(workspaceId, term.id));
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
            <p class="text-ui text-muted-foreground">No terminals open</p>
          </div>
        {/if}
      </ListSection>
    </div>
  {/if}

  <!-- Resize Handle -->
  {#if !collapsed}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="absolute top-0 left-0 w-1 h-full cursor-ew-resize hover:bg-primary/20 transition-colors z-10 -ml-0.5"
      onmousedown={startResize}
    ></div>
  {/if}
</div>
