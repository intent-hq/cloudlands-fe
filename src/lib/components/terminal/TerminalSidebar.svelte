<script lang="ts">
  /* eslint-disable max-lines */
import { selectAgentSession } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import { flip } from 'svelte/animate';
  import { scriptsClient } from '$features/scripts/scripts.client';
  import type { ScriptCategory,
  ScriptMode,
  ScriptWithState } from '$features/scripts/types';

  import { selectScriptEntries } from '$store/renderer/slices/scripts/scripts-selectors';
  import {
  refreshScripts,
  removeScript,
  upsertScript,
} from '$store/renderer/slices/scripts/scripts-slice';
  import { selectActiveWorkspace } from '$store/renderer/slices/workspace/workspace-selectors';

  import AugieAvatarWithState from '$lib/components/ui/auggie-avatar/AugieAvatarWithState.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import {
  ListContainer,
  ListItem,
  ListSection,
} from '$lib/components/ui/list';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { toast } from '$lib/components/ui/toast';
  import { useBackgroundAgent } from '$lib/hooks/use-background-agent.svelte';
  import {
  selectExecutorIsRunning,
  selectExecutorAgentId,
} from '$store/renderer/slices/background-agent-executor/background-agent-executor-selectors';
  import {
  selectActiveTerminalId as selectActiveTerminalIdSelector,
  selectUserTerminals as selectTerminalsSelector,
} from '$store/renderer/slices/terminals/terminals-selectors';
  import { removeTerminal } from '$store/renderer/slices/terminals/terminals-slice';
  import { terminalDisplayName } from '$lib/utils/terminal-display-name';

  const activeWorkspace = selectActiveWorkspace();

  import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
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
  faSpinner,
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

  type DetectFlow = 'idle' | 'local' | 'agent';

  let detectFlow = $state<DetectFlow>('idle');
  let showAgentAssist = $state(false);
  let showAllScripts = $state(false);

  let selectedScriptIds = $state<Set<string>>(new Set());
  let contextMenuPos = $state<{ x: number; y: number } | null>(null);
  let contextMenuScriptId = $state<string | null>(null);
  let lastClickedScriptId = $state<string | null>(null);
  let pendingScrollScriptId = $state<string | null>(null);

  async function handleDetectionResult(parsed: any): Promise<void> {
    const snapshot = selectScriptEntries.select(appStore.state).map((s) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { runtime, ...scriptDef } = s;
      return { ...scriptDef };
    });

    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      ('add' in parsed || 'update' in parsed || 'remove' in parsed)
    ) {
      let addedCount = 0;
      let updatedCount = 0;
      let removedCount = 0;

      const scriptEntries = selectScriptEntries.select(appStore.state);
      const autoDetectedIds = new Set(
        scriptEntries.filter((s) => s.source === 'auto-detected').map((s) => s.id),
      );
      const entriesById = new Map(scriptEntries.map((s) => [s.id, s]));
      const skippedRunning: string[] = [];

      if (Array.isArray(parsed.remove)) {
        for (const scriptId of parsed.remove) {
          if (typeof scriptId === 'string' && autoDetectedIds.has(scriptId)) {
            // Removing a running script kills its live PTY group daemon-side —
            // skip it and surface the skip so the user can stop + re-detect.
            const target = entriesById.get(scriptId);
            if (target?.runtime?.status === 'running') {
              skippedRunning.push(target.name);
              logger.info('Skipping script.remove for running script', {
                name: target.name,
                scriptId,
              });
              continue;
            }
            await scriptsClient.remove(workspaceId, scriptId);
            appStore.dispatch(removeScript(workspaceId, scriptId));
            removedCount++;
          }
        }
      }

      if (Array.isArray(parsed.update)) {
        for (const entry of parsed.update) {
          if (entry.id && typeof entry.id === 'string' && autoDetectedIds.has(entry.id)) {
            // The update rides the §5.8 script.create scriptId upsert, which
            // tears down the live PTY group — never send it for a running row.
            const target = entriesById.get(entry.id);
            if (target?.runtime?.status === 'running') {
              skippedRunning.push(target.name);
              logger.info('Skipping script.update for running script', {
                name: target.name,
                scriptId: entry.id,
              });
              continue;
            }
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
              appStore.dispatch(upsertScript(workspaceId, createResult.data));
              addedCount++;
            }
          }
        }
      }

      appStore.dispatch(refreshScripts(workspaceId));

      const parts: string[] = [];
      if (addedCount > 0) parts.push(m.terminal_sidebar_detectAdded_part({ count: addedCount }));
      if (updatedCount > 0)
        parts.push(m.terminal_sidebar_detectUpdated_part({ count: updatedCount }));
      if (removedCount > 0)
        parts.push(m.terminal_sidebar_detectRemoved_part({ count: removedCount }));

      showAgentAssist = selectScriptEntries.select(appStore.state).length === 0;

      if (parts.length > 0) {
        toast.success(m.terminal_sidebar_scriptsUpdated_success({ changes: parts.join(', ') }), {
          action: {
            label: m.terminal_sidebar_undo_label(),
            onClick: async () => {
              for (const s of selectScriptEntries.select(appStore.state)) {
                await scriptsClient.remove(workspaceId, s.id);
              }
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
              appStore.dispatch(refreshScripts(workspaceId));
              toast.success(m.terminal_sidebar_scriptsRestored_success());
            },
          },
          duration: 10000,
        });
      } else {
        toast.info(m.terminal_sidebar_noScriptChanges_info());
      }
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
      return;
    }

    // Fallback: old flat array format — deduplicate
    if (Array.isArray(parsed)) {
      const existingKeys = new Set(
        selectScriptEntries.select(appStore.state).map((s) => `${s.name}::${s.command}`),
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
            appStore.dispatch(upsertScript(workspaceId, createResult.data));
            createdCount++;
          }
        }
      }

      showAgentAssist = selectScriptEntries.select(appStore.state).length === 0;

      if (createdCount > 0) {
        toast.success(
          createdCount === 1
            ? m.terminal_sidebar_detectedNew_one({ count: createdCount })
            : m.terminal_sidebar_detectedNew_many({ count: createdCount }),
        );
      } else {
        toast.info(m.terminal_sidebar_noNewScripts_info());
      }
      return;
    }

    // Neither format matched
    logger.warn('DETECTED_SCRIPTS result is not recognized format');
    toast.info(m.terminal_sidebar_unexpectedFormat_info());
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
        toast.info(m.terminal_sidebar_agentDetectFailed_info());
        await runLocalDetect({ source: 'fallback' });
      }
    },
    onError: async () => {
      // Try to salvage JSON from the agent's raw messages via Redux
      const currentAgentId = selectExecutorAgentId.select(appStore.state, workspaceId, 'script-detect');
      const agentSession = currentAgentId
        ? selectAgentSession.select(appStore.state, currentAgentId)
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
      toast.info(m.terminal_sidebar_agentDetectFailed_info());
      await runLocalDetect({ source: 'fallback' });
    },
  });

  async function runLocalDetect(options: { source?: 'primary' | 'fallback' } = {}) {
    detectFlow = 'local';
    try {
      logger.info('Running local script detection', { source: options.source ?? 'primary' });
      const result = await scriptsClient.detect(workspaceId);
      if (!result.success) {
        // i18n-ignore (internal error, caught and surfaced via extracted toast)
        throw new Error(result.error || 'Local script detection failed');
      }

      appStore.dispatch(refreshScripts(workspaceId));
      // Use the detected count from the IPC response (number of scripts found
      // in project manifests) rather than the total store count which includes
      // user-created scripts. Default to 0 so agent assist is shown when the
      // field is missing.
      const detectedCount = typeof result.detected === 'number' ? result.detected : 0;
      showAgentAssist = detectedCount === 0;

      if (detectedCount > 0) {
        toast.success(
          detectedCount === 1
            ? m.terminal_sidebar_detectedFromFiles_one({ count: detectedCount })
            : m.terminal_sidebar_detectedFromFiles_many({ count: detectedCount }),
        );
      } else {
        toast.info(m.terminal_sidebar_noScriptsLocally_info());
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
      logger.info('Local detection complete', {
        totalScripts: selectScriptEntries.select(appStore.state).length,
        detectedCount,
        source: options.source ?? 'primary',
      });
    } catch (e) {
      showAgentAssist = true;
      logger.error('Local script detection failed', {
        error: e instanceof Error ? e.message : String(e),
        source: options.source ?? 'primary',
      });
      toast.error(m.terminal_quakeOverlay_detectFailed_error());
    } finally {
      detectFlow = 'idle';
    }
  }

  function buildExistingScriptsContext(): string {
    const existingScripts = selectScriptEntries.select(appStore.state).map((s) => ({
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
  const _sidebarTerminals = selectTerminalsSelector();
  const _sidebarActiveTerminalId = selectActiveTerminalIdSelector();
  const scriptEntries$ = selectScriptEntries();
  // Background agent executor state via direct selector subscriptions
  const _scriptDetectIsRunning$ = selectExecutorIsRunning(workspaceId, 'script-detect');
  const _scriptDetectAgentId$ = selectExecutorAgentId(workspaceId, 'script-detect');

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
    if (status === 'running') return m.terminal_quakeOverlay_status_running();
    if (status === 'idle') return m.terminal_quakeOverlay_status_idle();
    if (exitCode === 0) return m.terminal_quakeOverlay_status_exitedZero();
    if (exitCode !== null && exitCode !== undefined) {
      if (exitCode >= 128)
        return m.terminal_quakeOverlay_status_stoppedSignal({ signal: exitCode - 128 });
      return m.terminal_quakeOverlay_status_errorCode({ code: exitCode });
    }
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
    if (script.runtime.status === 'running') {
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
    appStore.dispatch(removeScript(workspaceId, scriptId));
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
      toast.info(m.terminal_sidebar_openWorkspaceFirst_info());
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
      appStore.dispatch(upsertScript(workspaceId, result.data));
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
        toast.error(result.error || m.terminal_sidebar_saveToRepoFailed_error());
        saveToRepoStatus = 'idle';
      }
    } catch {
      toast.error(m.terminal_sidebar_saveToRepoFailed_error());
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
      const scripts = sortScripts(selectScriptEntries.select(appStore.state));
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
        appStore.dispatch(removeScript(workspaceId, id));
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
      appStore.dispatch(refreshScripts(workspaceId));
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
      const script = selectScriptEntries.select(appStore.state).find((s) => s.id === pendingScrollScriptId);
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
  /* eslint-disable @typescript-eslint/no-unused-vars -- template-level vars used by Svelte runtime */
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
            <button
              type="button"
              class="-mt-0.5 -mb-1 flex items-center gap-1 px-1 rounded text-muted-foreground/60 hover:text-muted-foreground transition-colors cursor-pointer shrink-0"
              onclick={(e) => {
                e.stopPropagation();
                const wsId = $activeWorkspace?.id;
                if (wsId) {
                  appStore.dispatch(
                    openAgentTabRequested(wsId, { agentId: $_scriptDetectAgentId$ }),
                  );
                }
              }}
              title={m.terminal_sidebar_viewDetectionAgent_tooltip()}
            >
              <div
                class="shrink-0 flex-none"
                style="min-width: 16px; min-height: 16px; width: 16px; height: 16px;"
              >
                <AugieAvatarWithState
                  agentId={$_scriptDetectAgentId$}
                  state="running"
                  size={16}
                />
              </div>
              <span class="text-ui">{m.terminal_sidebar_askingAgent_label()}</span>
            </button>
          {:else if isAgentDetecting}
            <div class="-mt-0.5 -mb-1 flex items-center gap-1 px-1 text-muted-foreground">
              <!-- a11y-ignore -->
              <Fa icon={faSpinner} size="xs" class="animate-spin" />
              <span class="text-ui">{m.terminal_sidebar_askingAgent_label()}</span>
            </div>
          {:else if isLocalDetecting}
            <div class="-mt-0.5 -mb-1 flex items-center gap-1 px-1 text-muted-foreground">
              <!-- a11y-ignore -->
              <Fa icon={faSpinner} size="xs" class="animate-spin" />
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
            <input
              type="text"
              bind:value={newName}
              placeholder={m.terminal_quakeOverlay_name_placeholder()}
              class="w-full text-xs bg-muted/50 border border-border/40 rounded-md px-2 py-1.5 outline-none focus:border-primary/50 focus:bg-background text-foreground placeholder:text-muted-foreground/50 transition-colors"
            />
            <input
              type="text"
              bind:value={newCommand}
              placeholder={m.terminal_sidebar_command_placeholder()}
              class="w-full text-xs bg-muted/50 border border-border/40 rounded-md px-2 py-1.5 outline-none focus:border-primary/50 focus:bg-background text-foreground placeholder:text-muted-foreground/50 font-mono transition-colors"
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
                      placeholder={m.terminal_quakeOverlay_name_placeholder()}
                      class="w-full p-0 border-none bg-transparent text-sm outline-none focus:outline-none! focus:ring-0!"
                    />
                  {/snippet}
                {/if}
              </ListItem>
              </div>
            {/each}
            {#if showScriptListToggle}
              <button
                type="button"
                class="w-full text-left px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                onclick={() => (showAllScripts = !showAllScripts)}
              >
                {showAllScripts
                  ? m.terminal_sidebar_showLess_label()
                  : m.terminal_sidebar_moreScripts_label({ count: hiddenScriptCount })}
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
                {@const script = $scriptEntries$.find((s) => s.id === contextMenuScriptId)}
                {#if script}
                  {#if selectedScriptIds.size > 1}
                    <!-- Multi-select actions -->
                    <button
                      type="button"
                      class="w-full text-left px-3 py-1.5 text-sm hover:bg-accent cursor-pointer transition-colors"
                      onclick={() => handleContextMenuAction('startAll')}
                    >
                      {m.terminal_sidebar_startAll_label()}
                    </button>
                    <button
                      type="button"
                      class="w-full text-left px-3 py-1.5 text-sm hover:bg-accent cursor-pointer transition-colors"
                      onclick={() => handleContextMenuAction('stopAll')}
                    >
                      {m.terminal_sidebar_stopAll_label()}
                    </button>
                  {:else}
                    <!-- Single-select actions -->
                    {#if script.runtime.status === 'running'}
                      <button
                        type="button"
                        class="w-full text-left px-3 py-1.5 text-sm hover:bg-accent cursor-pointer transition-colors"
                        onclick={() => handleContextMenuAction('stop')}
                      >
                        {m.terminal_quakeOverlay_stop_label()}
                      </button>
                      <button
                        type="button"
                        class="w-full text-left px-3 py-1.5 text-sm hover:bg-accent cursor-pointer transition-colors"
                        onclick={() => handleContextMenuAction('restart')}
                      >
                        {m.terminal_quakeOverlay_restart_label()}
                      </button>
                    {:else}
                      <button
                        type="button"
                        class="w-full text-left px-3 py-1.5 text-sm hover:bg-accent cursor-pointer transition-colors"
                        onclick={() => handleContextMenuAction('start')}
                      >
                        {m.terminal_quakeOverlay_start_label()}
                      </button>
                    {/if}
                    <button
                      type="button"
                      class="w-full text-left px-3 py-1.5 text-sm hover:bg-accent cursor-pointer transition-colors"
                      onclick={() => handleContextMenuAction('edit')}
                    >
                      {m.terminal_sidebar_edit_label()}
                    </button>
                  {/if}
                  <div class="border-t border-border my-1"></div>
                  <button
                    type="button"
                    class="w-full text-left px-3 py-1.5 text-sm hover:bg-accent cursor-pointer transition-colors text-destructive-foreground hover:bg-destructive/10"
                    onclick={() => handleContextMenuAction('delete')}
                  >
                    {selectedScriptIds.size > 1
                      ? m.terminal_sidebar_deleteMany_label({ count: selectedScriptIds.size })
                      : m.terminal_sidebar_delete_label()}
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
        titleClass="mb-0.5 mt-1.5 px-3.5!"
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
    <div class="absolute top-0 left-0 w-1 h-full cursor-ew-resize hover:bg-primary/20 transition-colors z-10 -ml-0.5" onmousedown={startResize}></div>
  {/if}
</div>
