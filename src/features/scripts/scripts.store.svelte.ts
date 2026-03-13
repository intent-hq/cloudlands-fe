/**
 * Scripts Store (Svelte 5 Runes)
 *
 * Reactive store for workspace scripts state. Tracks all scripts,
 * their runtime states, and accumulated output. Listens for IPC events
 * from the main process to update state in real-time.
 */

import type { WorkspaceScript, ScriptRuntimeState, ScriptWithState } from './types';
import { createDefaultRuntimeState } from './types';
import { scriptsClient } from './scripts.client';
import { listenSync } from '$lib/electron-bridge';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('ScriptsStore');

// ============================================================================
// IPC Event Payload Types
// ============================================================================

interface ScriptStartedEvent {
  workspaceId: string;
  scriptId: string;
  pid?: number;
  startedAt: string;
}

interface ScriptStoppedEvent {
  workspaceId: string;
  scriptId: string;
  exitCode: number | null;
  signal?: string | null;
  stoppedAt: string;
}

interface ScriptOutputEvent {
  workspaceId: string;
  scriptId: string;
  lines: Array<{ text: string; stream: 'stdout' | 'stderr'; timestamp: string }>;
}

interface ScriptErrorEvent {
  workspaceId: string;
  scriptId: string;
  error: string;
}

interface ScriptUrlDetectedEvent {
  workspaceId: string;
  scriptId: string;
  url: string;
}

// ============================================================================
// Output Line Type (for display)
// ============================================================================

export interface ScriptOutputLine {
  text: string;
  stream: 'stdout' | 'stderr';
  timestamp: string;
}

// ============================================================================
// Store
// ============================================================================

/** Maximum output lines to keep per script. */
const MAX_OUTPUT_LINES = 5000;

function createScriptsStore() {
  // Core reactive state
  let scripts = $state<Map<string, WorkspaceScript>>(new Map());
  let runtimeStates = $state<Map<string, ScriptRuntimeState>>(new Map());
  let outputBuffers = $state<Map<string, ScriptOutputLine[]>>(new Map());
  let currentWorkspaceId = $state<string | null>(null);
  let initialized = $state(false);
  let loading = $state(false);

  // Cleanup functions for IPC listeners
  let cleanupFns: Array<() => void> = [];

  // Generation counter to guard against stale async results
  let initGeneration = 0;

  // Derived state
  const scriptEntries = $derived.by(() => {
    const entries: ScriptWithState[] = [];
    for (const [id, script] of scripts) {
      entries.push({
        ...script,
        runtime: runtimeStates.get(id) ?? createDefaultRuntimeState(),
      });
    }
    return entries;
  });

  const runningScripts = $derived(
    scriptEntries.filter((s) => s.runtime.status === 'running'),
  );

  const idleScripts = $derived(
    scriptEntries.filter((s) => s.runtime.status === 'idle'),
  );

  // ---- Internal helpers ----

  function updateRuntimeState(scriptId: string, partial: Partial<ScriptRuntimeState>): void {
    const current = runtimeStates.get(scriptId) ?? createDefaultRuntimeState();
    const updated = { ...current, ...partial };
    runtimeStates = new Map(runtimeStates).set(scriptId, updated);
  }

  function appendOutput(scriptId: string, lines: ScriptOutputLine[]): void {
    const current = outputBuffers.get(scriptId) ?? [];
    let combined = [...current, ...lines];
    if (combined.length > MAX_OUTPUT_LINES) {
      combined = combined.slice(combined.length - MAX_OUTPUT_LINES);
    }
    outputBuffers = new Map(outputBuffers).set(scriptId, combined);
  }

  // ---- IPC Event Handlers ----

  function setupListeners(): void {
    cleanupListeners();

    cleanupFns.push(
      listenSync<ScriptStartedEvent>('script:started', ({ payload }) => {
        if (String(payload.workspaceId) !== String(currentWorkspaceId)) return;
        logger.debug('Script started', { scriptId: payload.scriptId });
        updateRuntimeState(payload.scriptId, {
          status: 'running',
          pid: payload.pid,
          startedAt: payload.startedAt,
          exitCode: undefined,
          stoppedAt: undefined,
          error: undefined,
        });
      }),
    );

    cleanupFns.push(
      listenSync<ScriptStoppedEvent>('script:stopped', ({ payload }) => {
        if (String(payload.workspaceId) !== String(currentWorkspaceId)) return;
        logger.debug('Script stopped', {
          scriptId: payload.scriptId,
          exitCode: payload.exitCode,
        });
        updateRuntimeState(payload.scriptId, {
          status: 'exited',
          exitCode: payload.exitCode,
          stoppedAt: payload.stoppedAt,
          pid: undefined,
        });
      }),
    );

    cleanupFns.push(
      listenSync<ScriptOutputEvent>('script:output', ({ payload }) => {
        logger.debug('script:output event received', {
          payloadWsId: payload.workspaceId,
          currentWsId: currentWorkspaceId,
          lineCount: payload.lines?.length,
        });
        if (String(payload.workspaceId) !== String(currentWorkspaceId)) return;
        appendOutput(
          payload.scriptId,
          payload.lines.map((l) => ({
            text: l.text,
            stream: l.stream,
            timestamp: l.timestamp,
          })),
        );
      }),
    );

    cleanupFns.push(
      listenSync<ScriptErrorEvent>('script:error', ({ payload }) => {
        if (String(payload.workspaceId) !== String(currentWorkspaceId)) return;
        logger.warn('Script error', { scriptId: payload.scriptId, error: payload.error });
        updateRuntimeState(payload.scriptId, {
          error: payload.error,
        });
      }),
    );

    cleanupFns.push(
      listenSync<ScriptUrlDetectedEvent>('script:url-detected', ({ payload }) => {
        if (String(payload.workspaceId) !== String(currentWorkspaceId)) return;
        logger.info('Script URL detected', { scriptId: payload.scriptId, url: payload.url });
        updateRuntimeState(payload.scriptId, {
          detectedUrl: payload.url,
        });
      }),
    );
  }

  function cleanupListeners(): void {
    for (const fn of cleanupFns) fn();
    cleanupFns = [];
  }

  // ---- Public API ----

  return {
    // Reactive getters
    get scriptEntries() { return scriptEntries; },
    get runningScripts() { return runningScripts; },
    get idleScripts() { return idleScripts; },
    get scripts() { return scripts; },
    get runtimeStates() { return runtimeStates; },
    get initialized() { return initialized; },
    get loading() { return loading; },
    get currentWorkspaceId() { return currentWorkspaceId; },

    /** Get output lines for a specific script. */
    getOutput(scriptId: string): ScriptOutputLine[] {
      return outputBuffers.get(scriptId) ?? [];
    },

    /** Get runtime state for a specific script. */
    getRuntime(scriptId: string): ScriptRuntimeState {
      return runtimeStates.get(scriptId) ?? createDefaultRuntimeState();
    },

    /** Initialize the store for a workspace. Loads scripts and sets up IPC listeners. */
    async initialize(workspaceId: string): Promise<void> {
      if (currentWorkspaceId === workspaceId && initialized) return;

      logger.info('Initializing scripts store', { workspaceId });
      const thisGeneration = ++initGeneration;
      loading = true;
      currentWorkspaceId = workspaceId;

      // Clear previous state
      scripts = new Map();
      runtimeStates = new Map();
      outputBuffers = new Map();

      // Set up IPC event listeners
      setupListeners();

      // Load scripts from main process
      const response = await scriptsClient.list(workspaceId);
      if (thisGeneration !== initGeneration) return; // workspace changed during await

      if (response.success && response.data) {
        for (const entry of response.data) {
          const { runtime, ...scriptDef } = entry;
          scripts = new Map(scripts).set(scriptDef.id, scriptDef);
          runtimeStates = new Map(runtimeStates).set(scriptDef.id, runtime);
        }
        logger.info('Scripts loaded', { count: response.data.length });

        // Fetch buffered output for running/exited scripts
        for (const entry of response.data) {
          if (thisGeneration !== initGeneration) return; // workspace changed during await
          if (entry.runtime.status !== 'idle') {
            try {
              const outputResponse = await scriptsClient.getOutput(workspaceId, entry.id);
              if (thisGeneration !== initGeneration) return; // workspace changed during await
              if (outputResponse.success && outputResponse.lines && outputResponse.lines.length > 0) {
                const lines: ScriptOutputLine[] = outputResponse.lines.map((line) => ({
                  text: line.text,
                  stream: line.stream,
                  timestamp: typeof line.timestamp === 'number'
                    ? new Date(line.timestamp).toISOString()
                    : String(line.timestamp),
                }));
                outputBuffers = new Map(outputBuffers).set(entry.id, lines);
              }
            } catch (err) {
              logger.warn('Failed to fetch buffered output', { scriptId: entry.id, error: err });
            }
          }
        }
      } else if (response.error) {
        logger.warn('Failed to load scripts', { error: response.error });
      }

      if (thisGeneration !== initGeneration) return; // final guard
      initialized = true;
      loading = false;
    },

    /** Refresh scripts from the main process. */
    async refresh(): Promise<void> {
      if (!currentWorkspaceId) return;

      const response = await scriptsClient.list(currentWorkspaceId);
      if (response.success && response.data) {
        const newScripts = new Map<string, WorkspaceScript>();
        const newStates = new Map<string, ScriptRuntimeState>();
        for (const entry of response.data) {
          const { runtime, ...scriptDef } = entry;
          newScripts.set(scriptDef.id, scriptDef);
          newStates.set(scriptDef.id, runtime);
        }
        scripts = newScripts;
        runtimeStates = newStates;
      }
    },

    /** Add or update a script in local state (called after IPC create/update). */
    upsertScript(script: WorkspaceScript): void {
      scripts = new Map(scripts).set(script.id, script);
      if (!runtimeStates.has(script.id)) {
        runtimeStates = new Map(runtimeStates).set(script.id, createDefaultRuntimeState());
      }
    },

    /** Remove a script from local state. */
    removeScript(scriptId: string): void {
      const newScripts = new Map(scripts);
      newScripts.delete(scriptId);
      scripts = newScripts;

      const newStates = new Map(runtimeStates);
      newStates.delete(scriptId);
      runtimeStates = newStates;

      const newBuffers = new Map(outputBuffers);
      newBuffers.delete(scriptId);
      outputBuffers = newBuffers;
    },

    /** Clear output buffer for a script. */
    clearOutput(scriptId: string): void {
      outputBuffers = new Map(outputBuffers).set(scriptId, []);
    },

    /** Clean up listeners and reset state. */
    dispose(): void {
      cleanupListeners();
      scripts = new Map();
      runtimeStates = new Map();
      outputBuffers = new Map();
      currentWorkspaceId = null;
      initialized = false;
      loading = false;
    },
  };
}

export const scriptsStore = createScriptsStore();

