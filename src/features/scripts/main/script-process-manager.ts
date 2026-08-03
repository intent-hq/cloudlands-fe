/**
 * Script Process Manager
 *
 * Thin FE client over the daemon's `script.*` RPC surface (PROTOCOL §5.8). The
 * daemon owns the process (spawn / PID / auto-restart / URL detection / output
 * fan-out); this file only mirrors runtime state, buffers `script:output` chunks
 * for the renderer, and forwards user intent through `getBackendClient()`.
 *
 * The public API (`ScriptProcessManager`, `getScriptProcessManager`,
 * `disposeScriptProcessManager`, `disposeAllScriptProcessManagers`) is preserved
 * so `scripts.ipc.ts`, `workspace.ipc.ts`, and `ws-script-api.ts` keep working
 * without touching their call sites.
 */

import { Logger } from '../../../shared/logger';
import { getBackendClient, onBackendReconnected } from '../../backend/main/backend.ipc';
import type { JsonRpcNotification } from '../../backend/main/json-rpc-client';
import {
  ScriptOutputBuffer,
  OutputLine,
} from './script-output-buffer';

const logger = new Logger('ScriptProcessManager');

// ============================================================================
// Types (inline until Task 1 types are available for import)
// ============================================================================

export type ScriptMode = 'service' | 'command';

export interface WorkspaceScript {
  id: string;
  name: string;
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  mode: ScriptMode;
  category?: 'dev' | 'build' | 'test' | 'lint' | 'typecheck' | 'format' | 'storybook' | 'other';
  source: 'auto-detected' | 'user';
  autoStart?: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface ScriptRuntimeState {
  status: 'idle' | 'running' | 'restarting' | 'exited';
  pid?: number;
  exitCode?: number | null;
  startedAt?: string;
  stoppedAt?: string;
  restartCount: number;
  error?: string;
  detectedUrl?: string;
}

export type ScriptStateChangeCallback = (scriptId: string, state: ScriptRuntimeState) => void;
export type ScriptOutputCallback = (scriptId: string, lines: OutputLine[]) => void;

// ============================================================================
// Internal Types
// ============================================================================

interface ManagedScript {
  script: WorkspaceScript;
  state: ScriptRuntimeState;
  buffer: ScriptOutputBuffer;
  /** True when the local definition differs from what the daemon last saw. */
  dirty: boolean;
  /** True once we have successfully called `script.create` for this script. */
  registered: boolean;
}

// ============================================================================
// Module-level daemon event dispatch hub
// ============================================================================

/** Global scriptId → owning manager map so daemon events reach the right buffer. */
const managersByScriptId = new Map<string, ScriptProcessManager>();

let subscriptionId: string | undefined;
let notificationListener: ((n: JsonRpcNotification) => void) | undefined;
let subscribePromise: Promise<void> | undefined;
/**
 * Sticky reconnect disposer, installed on first `ensureSubscription()`. On
 * daemon restart the in-memory subscription registry is dropped; we replay
 * `events.subscribe(['script:state', 'script:output'])` on the same client
 * (the notification listener persists across reconnects) so live state /
 * output continues to flow (RESUB-1).
 */
let reconnectDisposer: (() => void) | undefined;

function decodeBase64(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0) return '';
  try {
    return Buffer.from(input, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

/** Map the daemon's serialized `ScriptRuntimeState` onto the FE shape. */
function parseDaemonState(data: Record<string, unknown> | undefined): ScriptRuntimeState {
  const status = data?.status;
  const restartCount = data?.restartCount;
  return {
    status:
      status === 'running' || status === 'restarting' || status === 'exited' || status === 'idle'
        ? status
        : 'idle',
    pid: typeof data?.pid === 'number' ? (data.pid as number) : undefined,
    exitCode:
      typeof data?.exitCode === 'number' || data?.exitCode === null
        ? (data.exitCode as number | null)
        : undefined,
    startedAt: typeof data?.startedAt === 'string' ? (data.startedAt as string) : undefined,
    stoppedAt: typeof data?.stoppedAt === 'string' ? (data.stoppedAt as string) : undefined,
    restartCount: typeof restartCount === 'number' ? (restartCount as number) : 0,
    error: typeof data?.error === 'string' ? (data.error as string) : undefined,
    detectedUrl:
      typeof data?.detectedUrl === 'string' ? (data.detectedUrl as string) : undefined,
  };
}

async function ensureSubscription(): Promise<void> {
  if (subscriptionId || subscribePromise) {
    if (subscribePromise) await subscribePromise;
    return;
  }
  const client = getBackendClient();
  const listener = (n: JsonRpcNotification): void => {
    if (n.method !== 'events.event') return;
    const params = n.params as { subscriptionId?: unknown; event?: unknown } | undefined;
    const subId = typeof params?.subscriptionId === 'string' ? params.subscriptionId : undefined;
    if (subscriptionId !== undefined && subId !== subscriptionId) return;
    const event = params?.event as
      | { type?: unknown; data?: Record<string, unknown> }
      | undefined;
    if (!event) return;
    const type = typeof event.type === 'string' ? event.type : '';
    if (!type.startsWith('script:')) return;
    const scriptId =
      typeof event.data?.scriptId === 'string' ? (event.data.scriptId as string) : undefined;
    if (!scriptId) return;
    const manager = managersByScriptId.get(scriptId);
    if (!manager) return;
    if (type === 'script:state') {
      manager.handleStateEvent(scriptId, parseDaemonState(event.data));
    } else if (type === 'script:output') {
      manager.handleOutputEvent(scriptId, decodeBase64(event.data?.chunk));
    }
  };
  notificationListener = listener;
  client.on('notification', listener);
  if (!reconnectDisposer) {
    reconnectDisposer = onBackendReconnected(() => {
      // The notification listener persists across reconnects (same singleton
      // client). Drop the stale id and re-issue subscribe directly so
      // `script:*` events keep reaching the buffers (RESUB-1). Do NOT call
      // `ensureSubscription()`; it would re-register a second notification
      // handler and double-process every subsequent event.
      subscriptionId = undefined;
      if (managersByScriptId.size === 0) return;
      getBackendClient()
        .request<{ subscriptionId?: string }>('events.subscribe', {
          eventTypes: ['script:state', 'script:output'],
        })
        .then((r) => {
          subscriptionId = r?.subscriptionId;
        })
        .catch((error) => {
          logger.warn('[Scripts] events.subscribe replay failed after reconnect', {
            error: error instanceof Error ? error.message : String(error),
          });
        });
    });
  }
  subscribePromise = (async () => {
    try {
      const result = await client.request<{ subscriptionId?: string }>('events.subscribe', {
        eventTypes: ['script:state', 'script:output'],
      });
      subscriptionId = result?.subscriptionId;
    } catch (error) {
      logger.warn('[Scripts] events.subscribe failed; live script events will not stream', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();
  await subscribePromise;
}

// ============================================================================
// ScriptProcessManager
// ============================================================================

export class ScriptProcessManager {
  private readonly workspaceId: string;
  private scripts: Map<string, ManagedScript> = new Map();
  private onStateChange: ScriptStateChangeCallback | null = null;
  private onOutput: ScriptOutputCallback | null = null;

  // `workspacePath` / `metadataPath` are accepted for backwards compatibility
  // with existing callers but ignored — the daemon resolves cwd from the
  // workspace store and owns any PID/state files.
  constructor(workspaceId: string, _workspacePath?: string, _metadataPath?: string) {
    this.workspaceId = workspaceId;
  }

  /** Set callback for state changes. */
  setStateChangeCallback(cb: ScriptStateChangeCallback): void {
    this.onStateChange = cb;
  }

  /** Set callback for output batches. */
  setOutputCallback(cb: ScriptOutputCallback): void {
    this.onOutput = cb;
  }

  /**
   * Start a script through the daemon. Fire-and-forget: the async work (register
   * with the daemon if needed, then `script.start`) runs in the background so
   * the sync-style call sites in `scripts.ipc.ts` and `ws-script-api.ts` keep
   * working. Errors surface via the runtime-state callback.
   */
  start(script: WorkspaceScript): void {
    let managed = this.scripts.get(script.id);
    if (managed && managed.state.status === 'running') {
      logger.warn(`[Scripts] Script "${script.name}" is already running`, { scriptId: script.id });
      return;
    }
    if (managed) {
      // Local def may differ from daemon; capture the latest and let the
      // daemon-sync path re-create if it has changed.
      if (!scriptDefsEqual(managed.script, script)) {
        managed.dirty = true;
      }
      managed.script = script;
    } else {
      managed = this.createManagedScript(script);
      this.scripts.set(script.id, managed);
    }
    managersByScriptId.set(script.id, this);
    void this.startAsync(managed);
  }

  /** Stop a running script via the daemon. */
  async stop(scriptId: string): Promise<void> {
    const managed = this.scripts.get(scriptId);
    if (!managed) return;
    try {
      await ensureSubscription();
      await getBackendClient().request('script.stop', {
        workspaceId: this.workspaceId,
        scriptId,
      });
    } catch (error) {
      logger.warn('[Scripts] script.stop failed', {
        scriptId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Update the in-memory script definition; marks it for daemon re-sync. */
  updateDefinition(scriptId: string, updatedScript: WorkspaceScript): void {
    const managed = this.scripts.get(scriptId);
    if (!managed) return;
    if (!scriptDefsEqual(managed.script, updatedScript)) {
      managed.dirty = true;
    }
    managed.script = updatedScript;
  }

  /** Restart a script (stop → start). Uses the daemon's `script.restart` when
   *  the local def matches; otherwise stops, re-syncs the definition, restarts. */
  async restart(scriptId: string): Promise<void> {
    const managed = this.scripts.get(scriptId);
    if (!managed) return;
    try {
      await ensureSubscription();
      if (managed.dirty || !managed.registered) {
        await getBackendClient()
          .request('script.stop', { workspaceId: this.workspaceId, scriptId })
          .catch(() => undefined);
        await this.ensureRegistered(managed);
        await getBackendClient().request('script.start', {
          workspaceId: this.workspaceId,
          scriptId,
        });
      } else {
        await getBackendClient().request('script.restart', {
          workspaceId: this.workspaceId,
          scriptId,
        });
      }
    } catch (error) {
      logger.error('[Scripts] script.restart failed', error as Error);
      managed.state.error = error instanceof Error ? error.message : String(error);
      this.emitStateChange(managed);
    }
  }

  /** Get runtime state. */
  getState(scriptId: string): ScriptRuntimeState | undefined {
    return this.scripts.get(scriptId)?.state;
  }

  /** Get output buffer. */
  getBuffer(scriptId: string): ScriptOutputBuffer | undefined {
    return this.scripts.get(scriptId)?.buffer;
  }

  /** Get all managed script IDs. */
  getManagedScriptIds(): string[] {
    return Array.from(this.scripts.keys());
  }

  /** Remove a script from management. Also removes it from the daemon. */
  async remove(scriptId: string): Promise<void> {
    const managed = this.scripts.get(scriptId);
    if (!managed) return;
    try {
      await getBackendClient().request('script.remove', {
        workspaceId: this.workspaceId,
        scriptId,
      });
    } catch (error) {
      // Not-found is fine — the daemon may never have seen this script.
      logger.debug('[Scripts] script.remove ignored', {
        scriptId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    managed.buffer.dispose();
    this.scripts.delete(scriptId);
    managersByScriptId.delete(scriptId);
  }

  /**
   * No-op retained for API compatibility. Cross-session PID reconciliation now
   * lives in the daemon (PROTOCOL §5.8); the FE no longer owns a PID file.
   */
  cleanupStalePids(): void {
    // Intentionally empty — the daemon owns process lifecycle.
  }

  /** Dispose all scripts and clean up. */
  async dispose(): Promise<void> {
    logger.info(`[Scripts] Disposing ScriptProcessManager for workspace ${this.workspaceId}`);
    const ids = Array.from(this.scripts.keys());
    for (const id of ids) {
      await this.remove(id);
    }
  }

  // ==========================================================================
  // Daemon-facing helpers
  // ==========================================================================

  /** Callback invoked by the module-level dispatcher for `script:state`. */
  handleStateEvent(scriptId: string, state: ScriptRuntimeState): void {
    const managed = this.scripts.get(scriptId);
    if (!managed) return;
    // Flush any buffered output before an exit transition so `stoppedAt`
    // consumers see the final lines first (mirrors the pre-daemon behaviour).
    if (state.status === 'exited') {
      managed.buffer.flush();
    }
    managed.state = state;
    this.emitStateChange(managed);
  }

  /** Callback invoked by the module-level dispatcher for `script:output`. */
  handleOutputEvent(scriptId: string, chunk: string): void {
    const managed = this.scripts.get(scriptId);
    if (!managed || !chunk) return;
    managed.buffer.append(chunk, 'stdout');
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

  private createManagedScript(script: WorkspaceScript): ManagedScript {
    const buffer = new ScriptOutputBuffer();
    buffer.onBatch((lines) => {
      if (this.onOutput) {
        this.onOutput(script.id, lines);
      }
    });
    return {
      script,
      state: { status: 'idle', restartCount: 0 },
      buffer,
      dirty: true,
      registered: false,
    };
  }

  /**
   * Ensure the daemon holds the current definition for this script. Calls
   * `script.create` (which acts as an upsert on the daemon side) whenever we
   * have not yet registered the script, or the definition has changed since
   * the last sync.
   */
  private async ensureRegistered(managed: ManagedScript): Promise<void> {
    if (managed.registered && !managed.dirty) return;
    const { script } = managed;
    const params: Record<string, unknown> = {
      workspaceId: this.workspaceId,
      scriptId: script.id,
      name: script.name,
      command: script.command,
      mode: script.mode,
    };
    if (script.cwd) params.cwd = script.cwd;
    if (script.env && Object.keys(script.env).length > 0) params.env = script.env;
    if (script.category) params.category = script.category;
    if (script.autoStart !== undefined) params.autoStart = script.autoStart;
    await getBackendClient().request('script.create', params);
    managed.registered = true;
    managed.dirty = false;
  }

  private async startAsync(managed: ManagedScript): Promise<void> {
    try {
      await ensureSubscription();
      await this.ensureRegistered(managed);
      await getBackendClient().request('script.start', {
        workspaceId: this.workspaceId,
        scriptId: managed.script.id,
      });
    } catch (error) {
      logger.error('[Scripts] script.start failed', error as Error);
      managed.state = {
        ...managed.state,
        status: 'exited',
        error: error instanceof Error ? error.message : String(error),
        stoppedAt: new Date().toISOString(),
      };
      this.emitStateChange(managed);
    }
  }

  private emitStateChange(managed: ManagedScript): void {
    if (this.onStateChange) {
      this.onStateChange(managed.script.id, { ...managed.state });
    }
  }
}

function scriptDefsEqual(a: WorkspaceScript, b: WorkspaceScript): boolean {
  return (
    a.name === b.name &&
    a.command === b.command &&
    a.mode === b.mode &&
    a.cwd === b.cwd &&
    a.category === b.category &&
    a.autoStart === b.autoStart &&
    JSON.stringify(a.env ?? null) === JSON.stringify(b.env ?? null)
  );
}

// ============================================================================
// Singleton Accessor
// ============================================================================

const instances = new Map<string, ScriptProcessManager>();

/**
 * Get the ScriptProcessManager for a workspace.
 * Creates a new instance if one doesn't exist.
 *
 * The `workspacePath` / `metadataPath` parameters are accepted for backwards
 * compatibility with existing call sites but are ignored — the daemon resolves
 * the workspace root from its store.
 */
export function getScriptProcessManager(
  workspaceId: string,
  workspacePath?: string,
  metadataPath?: string,
): ScriptProcessManager {
  let instance = instances.get(workspaceId);
  if (!instance) {
    instance = new ScriptProcessManager(workspaceId, workspacePath, metadataPath);
    instances.set(workspaceId, instance);
    logger.info(`[Scripts] Created ScriptProcessManager for workspace ${workspaceId}`);
  }
  return instance;
}

/**
 * Remove and dispose the ScriptProcessManager for a workspace.
 */
export async function disposeScriptProcessManager(workspaceId: string): Promise<void> {
  const instance = instances.get(workspaceId);
  if (instance) {
    await instance.dispose();
    instances.delete(workspaceId);
    logger.info(`[Scripts] Disposed ScriptProcessManager for workspace ${workspaceId}`);
  }
}

/**
 * Dispose all ScriptProcessManager instances (app shutdown).
 */
export async function disposeAllScriptProcessManagers(): Promise<void> {
  const ids = Array.from(instances.keys());
  for (const id of ids) {
    await disposeScriptProcessManager(id);
  }
  // Tear down the shared event subscription when nothing needs it anymore.
  if (subscriptionId) {
    try {
      await getBackendClient().request('events.unsubscribe', { subscriptionId });
    } catch {
      // Best-effort cleanup on shutdown.
    }
    subscriptionId = undefined;
  }
  if (notificationListener) {
    try {
      getBackendClient().off('notification', notificationListener);
    } catch {
      // Client may already be torn down.
    }
    notificationListener = undefined;
  }
  if (reconnectDisposer) {
    try {
      reconnectDisposer();
    } catch {
      // Client may already be torn down.
    }
    reconnectDisposer = undefined;
  }
  subscribePromise = undefined;
}
