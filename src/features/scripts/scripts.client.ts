/**
 * Scripts client — renderer-side script operations.
 *
 * The daemon-backed operations (`script.list/create/remove/start/stop/restart/
 * status`, PROTOCOL §5.8) route through the `AppClient` seam
 * (`appClient.scripts`), which reaches the intentd daemon over the JSON-RPC
 * bridge. `update` rides `script.create`'s `scriptId` upsert (§5.8: an
 * existing id replaces the definition). Operations with no daemon counterpart
 * (`detect`, `saveToRepo`) stay on their legacy channels, which resolve to
 * the allowlisted "not available in this build" failure envelope
 * (UNBRIDGED_INVOKE_ALLOWLIST) until the daemon grows a script-detection /
 * repo-config surface.
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
  async remove(_workspaceId: string, scriptId: string): Promise<CommandResponse<void>> {
    return toCommandResponse(await appClient.scripts.remove(scriptId));
  },

  /** Start a script by ID (`script.start`, §5.8). */
  async start(_workspaceId: string, scriptId: string): Promise<CommandResponse<void>> {
    return toCommandResponse(await appClient.scripts.start(scriptId));
  },

  /** Stop a running script (`script.stop`, §5.8). */
  async stop(_workspaceId: string, scriptId: string): Promise<CommandResponse<void>> {
    return toCommandResponse(await appClient.scripts.stop(scriptId));
  },

  /** Restart a script (`script.restart`, §5.8). */
  async restart(_workspaceId: string, scriptId: string): Promise<CommandResponse<void>> {
    return toCommandResponse(await appClient.scripts.restart(scriptId));
  },

  /** Get detailed runtime status of a script (`script.status`, §5.8). */
  async getStatus(
    _workspaceId: string,
    scriptId: string,
  ): Promise<{ success: boolean; status?: ScriptRuntimeState; error?: string }> {
    const status = await appClient.scripts.status(scriptId);
    return status
      ? { success: true, status }
      : { success: false, error: 'Failed to read script status' };
  },

  /** Auto-detect scripts from package.json and other config files. */
  async detect(
    workspaceId: string,
  ): Promise<{
    success: boolean;
    detected?: number;
    added?: number;
    removed?: number;
    packageManager?: string;
    error?: string;
  }> {
    if (typeof window !== 'undefined' && window.electronAPI) {
      try {
        return await invokeIpc(IPC_CHANNELS.SCRIPTS.DETECT, { workspaceId });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'IPC call failed';
        logger.error(`IPC call to ${IPC_CHANNELS.SCRIPTS.DETECT} failed`, { error: message });
        return { success: false, error: message };
      }
    }
    return { success: false, error: 'Electron IPC not available' };
  },

  /** Save workspace scripts to the repo-level shared file. */
  async saveToRepo(workspaceId: string): Promise<CommandResponse<void>> {
    return invoke<void>(IPC_CHANNELS.SCRIPTS.SAVE_TO_REPO, { workspaceId });
  },
};
