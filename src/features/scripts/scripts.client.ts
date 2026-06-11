/**
 * Scripts IPC Client
 *
 * Thin wrapper around the generated IPC invoke helper for all script IPC calls.
 * Used by the renderer process to communicate with the main process.
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

/**
 * Scripts IPC client — all renderer-to-main script operations.
 */
export const scriptsClient = {
  /** List all scripts for a workspace with their runtime state. */
  async list(workspaceId: string): Promise<CommandResponse<ScriptWithState[]>> {
    return invoke<ScriptWithState[]>(IPC_CHANNELS.SCRIPTS.LIST, { workspaceId });
  },

  /** Create a new script definition. */
  async create(
    workspaceId: string,
    script: CreateScriptInput,
  ): Promise<CommandResponse<WorkspaceScript>> {
    return invoke<WorkspaceScript>(IPC_CHANNELS.SCRIPTS.CREATE, { workspaceId, script });
  },

  /** Update an existing script definition. */
  async update(
    workspaceId: string,
    scriptId: string,
    updates: UpdateScriptInput,
  ): Promise<CommandResponse<WorkspaceScript>> {
    return invoke<WorkspaceScript>(IPC_CHANNELS.SCRIPTS.UPDATE, {
      workspaceId,
      scriptId,
      updates,
    });
  },

  /** Remove a script definition. */
  async remove(workspaceId: string, scriptId: string): Promise<CommandResponse<void>> {
    return invoke<void>(IPC_CHANNELS.SCRIPTS.REMOVE, { workspaceId, scriptId });
  },

  /** Start a script by ID. */
  async start(workspaceId: string, scriptId: string): Promise<CommandResponse<void>> {
    return invoke<void>(IPC_CHANNELS.SCRIPTS.START, { workspaceId, scriptId });
  },

  /** Stop a running script. */
  async stop(workspaceId: string, scriptId: string): Promise<CommandResponse<void>> {
    return invoke<void>(IPC_CHANNELS.SCRIPTS.STOP, { workspaceId, scriptId });
  },

  /** Restart a script (stop then start). */
  async restart(workspaceId: string, scriptId: string): Promise<CommandResponse<void>> {
    return invoke<void>(IPC_CHANNELS.SCRIPTS.RESTART, { workspaceId, scriptId });
  },

  /** Get detailed runtime status of a script. */
  async getStatus(
    workspaceId: string,
    scriptId: string,
  ): Promise<{ success: boolean; status?: ScriptRuntimeState; error?: string }> {
    if (typeof window !== 'undefined' && window.electronAPI) {
      try {
        return await invokeIpc(IPC_CHANNELS.SCRIPTS.GET_STATUS, { workspaceId, scriptId });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'IPC call failed';
        logger.error(`IPC call to ${IPC_CHANNELS.SCRIPTS.GET_STATUS} failed`, { error: message });
        return { success: false, error: message };
      }
    }
    return { success: false, error: 'Electron IPC not available' };
  },

  /** Get recent output lines for a script. */
  async getOutput(
    workspaceId: string,
    scriptId: string,
    lastN?: number,
  ): Promise<{ success: boolean; lines: Array<{ text: string; stream: 'stdout' | 'stderr'; timestamp: number }>; error?: string }> {
    if (typeof window !== 'undefined' && window.electronAPI) {
      try {
        return await invokeIpc(IPC_CHANNELS.SCRIPTS.GET_OUTPUT, { workspaceId, scriptId, lastN });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'IPC call failed';
        logger.error(`IPC call to ${IPC_CHANNELS.SCRIPTS.GET_OUTPUT} failed`, { error: message });
        return { success: false, error: message, lines: [] };
      }
    }
    return { success: false, error: 'Electron IPC not available', lines: [] };
  },

  /** Auto-detect scripts from package.json and other config files. */
  async detect(workspaceId: string): Promise<{ success: boolean; detected?: number; added?: number; removed?: number; packageManager?: string; error?: string }> {
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

