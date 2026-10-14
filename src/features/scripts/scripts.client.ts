/** Compatibility facade for imperative script callers. Definition reads and
 * writes are owned by scriptsOperationSaga; this module only dispatches its
 * correlated async actions and preserves the established response envelopes. */

import type {
  WorkspaceScript,
  ScriptRuntimeState,
  ScriptWithState,
  ScriptMode,
  ScriptPurpose,
} from './types';
import { appClient } from '$lib/client';
import type { MutationResult } from '$lib/client';
import type { PackageManager } from './detect-scripts';
import { m } from '$shared/paraglide/messages.js';
import { store } from '$store/renderer/store';
import {
  createScriptDefinitionRequested,
  detectScriptDefinitionsRequested,
  listScriptDefinitionsRequested,
  removeScriptDefinitionRequested,
  restoreScriptDefinitionsRequested,
  saveScriptDefinitionsToRepoRequested,
  updateScriptDefinitionRequested,
} from '$store/renderer/slices/scripts/scripts-slice';

/** Input for creating a new script. */
export interface CreateScriptInput {
  purpose?: ScriptPurpose;
  name: string;
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  mode: ScriptMode;
  category?: string;
  source?: string;
  autoStart?: boolean;
  healthUrl?: string;
  readyPattern?: string;
}

/** Input for updating an existing script. */
export interface UpdateScriptInput {
  name?: string;
  command?: string;
  cwd?: string;
  env?: Record<string, string>;
  mode?: ScriptMode;
  category?: string;
  autoStart?: boolean;
  healthUrl?: string;
  readyPattern?: string;
}

/** Standard command response from IPC handlers. */
interface CommandResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

type AsyncRequest<T> = { promise: Promise<T> };

async function dispatchCommand<T>(request: AsyncRequest<T>): Promise<CommandResponse<T>> {
  try {
    store.dispatch(request as never);
    const data = await request.promise;
    return data === undefined ? { success: true } : { success: true, data };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Fold an AppClient MutationResult into the CommandResponse shape callers expect. */
function toCommandResponse(result: MutationResult): CommandResponse<void> {
  return result.success ? { success: true } : { success: false, error: result.error };
}

/**
 * Scripts client — all renderer script operations.
 */
export const scriptsClient = {
  /** List all scripts for a workspace with their runtime state (`script.list`, §5.8). */
  async list(workspaceId: string): Promise<CommandResponse<ScriptWithState[]>> {
    return dispatchCommand(listScriptDefinitionsRequested(workspaceId));
  },

  /** Create a new script definition (`script.create`, §5.8). */
  async create(
    workspaceId: string,
    script: CreateScriptInput,
  ): Promise<CommandResponse<WorkspaceScript>> {
    return dispatchCommand(
      createScriptDefinitionRequested(workspaceId, {
        name: script.name,
        command: script.command,
        mode: script.mode,
        ...(script.purpose !== undefined ? { purpose: script.purpose } : {}),
        cwd: script.cwd,
        env: script.env,
        category: script.category,
        autoStart: script.autoStart,
        healthUrl: script.healthUrl,
        readyPattern: script.readyPattern,
      }),
    );
  },

  /**
   * Update an existing script definition. The daemon has no dedicated update
   * RPC; `script.create` with the existing `scriptId` replaces the definition
   * (§5.8 upsert), so the current definition is read from `script.get` and
   * merged with the partial updates before the upsert. The reservation starts
   * before that read and owns the complete mutation; callers must not reserve again.
   */
  async update(
    workspaceId: string,
    scriptId: string,
    updates: UpdateScriptInput,
    selectedDefinition?: WorkspaceScript,
    isCurrent: () => boolean = () => true,
  ): Promise<CommandResponse<WorkspaceScript>> {
    if (!isCurrent()) return { success: false, error: m.scripts_pendingChange_error() };
    const result = await dispatchCommand(
      updateScriptDefinitionRequested(
        workspaceId,
        scriptId,
        updates,
        undefined,
        selectedDefinition,
      ),
    );
    return result.success && !isCurrent()
      ? { success: false, error: m.scripts_pendingChange_error() }
      : result;
  },

  /** Remove a script definition (`script.remove`, §5.8). */
  async remove(
    workspaceId: string,
    scriptId: string,
    selectedDefinition?: WorkspaceScript,
    isCurrent: () => boolean = () => true,
  ): Promise<CommandResponse<void>> {
    if (!isCurrent()) return { success: false, error: m.scripts_pendingChange_error() };
    const result = await dispatchCommand(
      removeScriptDefinitionRequested(workspaceId, scriptId, undefined, selectedDefinition),
    );
    return result.success && !isCurrent()
      ? { success: false, error: m.scripts_pendingChange_error() }
      : result;
  },

  /** Restore detection's snapshot as one reserved remove-and-recreate operation. */
  async restoreSnapshot(
    workspaceId: string,
    snapshot: WorkspaceScript[],
  ): Promise<CommandResponse<void>> {
    return dispatchCommand(restoreScriptDefinitionsRequested(workspaceId, snapshot));
  },

  /** Start a script by ID (`script.start`, §5.8). */
  async start(workspaceId: string, scriptId: string): Promise<CommandResponse<void>> {
    return toCommandResponse(await appClient.scripts.start(workspaceId, scriptId));
  },

  /** Stop a running script (`script.stop`, §5.8). */
  async stop(workspaceId: string, scriptId: string): Promise<CommandResponse<void>> {
    return toCommandResponse(await appClient.scripts.stop(workspaceId, scriptId));
  },

  /** Restart a script (`script.restart`, §5.8). */
  async restart(workspaceId: string, scriptId: string): Promise<CommandResponse<void>> {
    return toCommandResponse(await appClient.scripts.restart(workspaceId, scriptId));
  },

  /** Get detailed runtime status of a script (`script.status`, §5.8). */
  async getStatus(
    workspaceId: string,
    scriptId: string,
  ): Promise<{ success: boolean; status?: ScriptRuntimeState; error?: string }> {
    const status = await appClient.scripts.status(workspaceId, scriptId);
    return status
      ? { success: true, status }
      : { success: false, error: m.scripts_client_statusFailed_error() };
  },

  /**
   * Auto-detect scripts from repo manifests and upsert them into the daemon.
   * Reserve all retained definitions before scanning, through the final removal.
   *
   * Reads `package.json` / `Makefile` / `Cargo.toml` / `pyproject.toml` through
   * the daemon's `file.read` seam (`detect-scripts.ts`), diffs the candidates
   * against the live `script.list`, and:
   *  - creates any candidate whose name isn't already registered,
   *  - upserts the existing auto-detected row (reusing its id via
   *    `script.create({ scriptId })`, §5.8) when its command / mode / category
   *    changed — UNLESS that row is currently live (any status outside the
   *    safe-to-upsert `idle`/`exited` allowlist, e.g. `running` or
   *    `restarting`): the daemon upsert tears down the live PTY group, so the
   *    upsert is skipped and the script's name is reported back in
   *    `skippedRunning` for the caller to surface,
   *  - removes auto-detected rows whose name is no longer produced by any
   *    manifest — UNLESS that row is currently `running` (removal kills the
   *    live PTY group), in which case it is skipped and reported in
   *    `skippedRunning`,
   *  - never touches user-created scripts, even when a manifest exposes the
   *    same name.
   *
   * Result counts the daemon-side outcome (`added` = newly created,
   * `removed` = auto-detected rows removed), so repeat clicks resolve to
   * `{ added: 0, removed: 0 }` when nothing changed.
   */
  async detect(workspaceId: string): Promise<{
    success: boolean;
    detected?: number;
    added?: number;
    removed?: number;
    skippedRunning?: string[];
    packageManager?: PackageManager;
    error?: string;
  }> {
    const result = await dispatchCommand(detectScriptDefinitionsRequested(workspaceId));
    if (!result.success) return result;
    const outcome = result.data!;
    return {
      success: true,
      detected: outcome.detected,
      added: outcome.added,
      removed: outcome.removed,
      ...(outcome.skippedRunning.length ? { skippedRunning: outcome.skippedRunning } : {}),
      ...(outcome.packageManager ? { packageManager: outcome.packageManager } : {}),
    };
  },

  /**
   * Save workspace scripts to the repo-level `.intent/config.json`.
   *
   * Routes through the daemon's `repoConfig.save` surface (PROTOCOL §5.33).
   * Reads the live `script.list` and persists ONLY the `scripts` field —
   * `repoConfig.save` merges the patch into the on-disk config (present keys
   * overwrite, absent keys are preserved, explicit null clears), so sending a
   * minimal object guarantees other fields (`setupScript`, `branchPrefix`, …)
   * are never reverted from a stale renderer-side read. An empty live list is
   * a no-op (never clobbers a populated repo config with `[]`).
   */
  async saveToRepo(workspaceId: string): Promise<CommandResponse<void>> {
    return dispatchCommand(saveScriptDefinitionsToRepoRequested(workspaceId));
  },
};
