/**
 * Scripts client — renderer-side script operations.
 *
 * The daemon-backed operations (`script.list/create/remove/start/stop/restart/
 * status`, PROTOCOL §5.8) route through the `AppClient` seam
 * (`appClient.scripts`), which reaches the intentd daemon over the JSON-RPC
 * bridge. `update` and `detect` both ride `script.create`'s `scriptId` upsert
 * (§5.8: an existing id replaces the definition).
 *
 * `detect` runs the heuristic manifest scan renderer-side against the
 * daemon-owned `file.read` seam (`./detect-scripts.ts`), diffs candidates
 * against the live `script.list`, and only upserts genuinely new or changed
 * auto-detected scripts — so repeat clicks are no-ops and user scripts are
 * never overwritten. The legacy `scripts:detect` IPC channel is retired.
 *
 * `saveToRepo` is the only remaining IPC surface — it stays on
 * `scripts:save-to-repo`, sourcing its payload from the live daemon
 * `script.list` (the legacy local store is empty in daemon builds, and
 * letting the main handler read it is what silently clobbered
 * `.intent/config.json` with `scripts: []`).
 */

import type {
  WorkspaceScript,
  ScriptRuntimeState,
  ScriptWithState,
  ScriptMode,
  ScriptCategory,
  ScriptSource,
} from './types';
import { IPC_CHANNELS } from '../../shared/ipc-registry';
import { createLogger } from '$lib/utils/client-logger';
import { invoke as invokeIpc } from '../../shared/generated/ipc-client';
import { appClient } from '$lib/client';
import type { MutationResult } from '$lib/client';
import { detectScriptCandidates, type PackageManager } from './detect-scripts';

const logger = createLogger('ScriptsClient');

/** Input for creating a new script. */
export interface CreateScriptInput {
  name: string;
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  mode: ScriptMode;
  category?: ScriptCategory;
  source?: ScriptSource;
  autoStart?: boolean;
}

/** Input for updating an existing script. */
export interface UpdateScriptInput {
  name?: string;
  command?: string;
  cwd?: string;
  env?: Record<string, string>;
  mode?: ScriptMode;
  category?: ScriptCategory;
  autoStart?: boolean;
}

/** Standard command response from IPC handlers. */
interface CommandResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/** Invoke an IPC channel with error handling. */
async function invoke<T>(channel: string, data?: unknown): Promise<CommandResponse<T>> {
  if (typeof window !== 'undefined' && window.electronAPI) {
    try {
      return await invokeIpc<CommandResponse<T>>(channel, data);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'IPC call failed';
      logger.error(`IPC call to ${channel} failed`, { error: message });
      return { success: false, error: message };
    }
  }
  return { success: false, error: 'Electron IPC not available' };
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
    return { success: true, data: await appClient.scripts.list(workspaceId) };
  },

  /** Create a new script definition (`script.create`, §5.8). */
  async create(
    workspaceId: string,
    script: CreateScriptInput,
  ): Promise<CommandResponse<WorkspaceScript>> {
    const result = await appClient.scripts.create(workspaceId, {
      name: script.name,
      command: script.command,
      mode: script.mode,
      cwd: script.cwd,
      env: script.env,
      category: script.category,
      autoStart: script.autoStart,
    });
    return result.success
      ? { success: true, data: result.script }
      : { success: false, error: result.error };
  },

  /**
   * Update an existing script definition. The daemon has no dedicated update
   * RPC; `script.create` with the existing `scriptId` replaces the definition
   * (§5.8 upsert), so the current definition is read from `script.list` and
   * merged with the partial updates before the upsert.
   */
  async update(
    workspaceId: string,
    scriptId: string,
    updates: UpdateScriptInput,
  ): Promise<CommandResponse<WorkspaceScript>> {
    const scripts = await appClient.scripts.list(workspaceId);
    const existing = scripts.find((script) => script.id === scriptId);
    if (!existing) {
      return { success: false, error: `Script not found: ${scriptId}` };
    }
    const result = await appClient.scripts.create(workspaceId, {
      scriptId,
      name: updates.name ?? existing.name,
      command: updates.command ?? existing.command,
      mode: updates.mode ?? existing.mode,
      cwd: updates.cwd ?? existing.cwd,
      env: updates.env ?? existing.env,
      category: updates.category ?? existing.category,
      autoStart: updates.autoStart ?? existing.autoStart,
    });
    return result.success
      ? { success: true, data: result.script }
      : { success: false, error: result.error };
  },

  /** Remove a script definition (`script.remove`, §5.8). */
  async remove(workspaceId: string, scriptId: string): Promise<CommandResponse<void>> {
    return toCommandResponse(await appClient.scripts.remove(workspaceId, scriptId));
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
      : { success: false, error: 'Failed to read script status' };
  },

  /**
   * Auto-detect scripts from repo manifests and upsert them into the daemon.
   *
   * Reads `package.json` / `Makefile` / `Cargo.toml` / `pyproject.toml` through
   * the daemon's `file.read` seam (`detect-scripts.ts`), diffs the candidates
   * against the live `script.list`, and:
   *  - creates any candidate whose name isn't already registered,
   *  - upserts the existing auto-detected row (reusing its id via
   *    `script.create({ scriptId })`, §5.8) when its command / mode / category
   *    changed,
   *  - removes auto-detected rows whose name is no longer produced by any
   *    manifest,
   *  - never touches user-created scripts, even when a manifest exposes the
   *    same name.
   *
   * Result counts the daemon-side outcome (`added` = newly created,
   * `removed` = auto-detected rows removed), so repeat clicks resolve to
   * `{ added: 0, removed: 0 }` when nothing changed.
   */
  async detect(
    workspaceId: string,
  ): Promise<{
    success: boolean;
    detected?: number;
    added?: number;
    removed?: number;
    packageManager?: PackageManager;
    error?: string;
  }> {
    try {
      const { candidates, packageManager } = await detectScriptCandidates(
        appClient.files,
        workspaceId,
      );
      const existing = await appClient.scripts.list(workspaceId);

      const existingUserNames = new Set<string>();
      const existingAutoByName = new Map<string, ScriptWithState>();
      for (const s of existing) {
        if (s.source === 'auto-detected') {
          existingAutoByName.set(s.name, s);
        } else {
          existingUserNames.add(s.name);
        }
      }

      const detectedNames = new Set<string>();
      let added = 0;

      for (const candidate of candidates) {
        detectedNames.add(candidate.name);
        if (existingUserNames.has(candidate.name)) continue;

        const existingAuto = existingAutoByName.get(candidate.name);
        if (!existingAuto) {
          const createResult = await appClient.scripts.create(workspaceId, {
            name: candidate.name,
            command: candidate.command,
            mode: candidate.mode,
            category: candidate.category,
          });
          if (createResult.success) {
            added += 1;
          } else {
            logger.warn('script.create failed for detected candidate', {
              name: candidate.name,
              error: createResult.error,
            });
          }
        } else if (
          existingAuto.command !== candidate.command ||
          existingAuto.category !== candidate.category ||
          existingAuto.mode !== candidate.mode
        ) {
          const upsertResult = await appClient.scripts.create(workspaceId, {
            scriptId: existingAuto.id,
            name: candidate.name,
            command: candidate.command,
            mode: candidate.mode,
            category: candidate.category,
            ...(existingAuto.cwd !== undefined ? { cwd: existingAuto.cwd } : {}),
            ...(existingAuto.env !== undefined ? { env: existingAuto.env } : {}),
            ...(existingAuto.autoStart !== undefined
              ? { autoStart: existingAuto.autoStart }
              : {}),
          });
          if (!upsertResult.success) {
            logger.warn('script.create upsert failed for detected candidate', {
              name: candidate.name,
              scriptId: existingAuto.id,
              error: upsertResult.error,
            });
          }
        }
      }

      let removed = 0;
      for (const [name, s] of existingAutoByName) {
        if (!detectedNames.has(name)) {
          const removeResult = await appClient.scripts.remove(workspaceId, s.id);
          if (removeResult.success) {
            removed += 1;
          } else {
            logger.warn('script.remove failed for stale auto-detected script', {
              name,
              scriptId: s.id,
              error: removeResult.error,
            });
          }
        }
      }

      return {
        success: true,
        detected: candidates.length,
        added,
        removed,
        packageManager,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Script detection failed', { error: message });
      return { success: false, error: message };
    }
  },

  /**
   * Save workspace scripts to the repo-level `.intent/config.json`.
   *
   * The payload is sourced from the live daemon `script.list` (§5.8) and
   * shipped to the main handler, which merges it into the existing repo
   * config (preserving non-script keys). An empty live list is a no-op on
   * the main side (`written: false`) — it never clobbers a populated repo
   * config with `[]`.
   */
  async saveToRepo(workspaceId: string): Promise<CommandResponse<void>> {
    const scripts = await appClient.scripts.list(workspaceId);
    const payload = scripts.map(({ name, command, mode, category, cwd, env, autoStart }) => ({
      name,
      command,
      mode,
      ...(category !== undefined ? { category } : {}),
      ...(cwd !== undefined ? { cwd } : {}),
      ...(env !== undefined ? { env } : {}),
      ...(autoStart !== undefined ? { autoStart } : {}),
    }));
    return invoke<void>(IPC_CHANNELS.SCRIPTS.SAVE_TO_REPO, { workspaceId, scripts: payload });
  },
};
