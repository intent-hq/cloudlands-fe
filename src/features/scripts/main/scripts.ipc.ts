/**
 * Scripts IPC Handlers
 *
 * Registers IPC handlers for workspace script operations (CRUD, lifecycle, output).
 * Emits domain events via Redux dispatch (script-events slice) for lifecycle changes.
 * Forwards output batches to renderer via domain events.
 */

import { ipcMain } from 'electron';
import * as path from 'path';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../../../shared/logger';
import { SCRIPTS_CHANNELS } from '$shared/ipc/channels';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import { mainDispatch } from '../../../store/main/redux-store-bridge';
import {
  scriptStarted,
  scriptStopped,
  scriptError,
  scriptUrlDetected,
  scriptOutput,
} from '../../../store/main/slices/script-events/script-events-slice';
import { workspaceService } from '../../workspace/main/workspace.service';
import { createWorkspaceId } from '$shared/types/branded-ids';
import type { WorkspaceId } from '$shared/types';
import {
  readScripts,
  writeScripts,
  upsertScript,
  removeScript,
} from './scripts-persistence';
import {
  getScriptProcessManager,
  disposeScriptProcessManager,
} from './script-process-manager';
import { WorkspaceConfig } from '$shared/main/config';
import {
  CreateScriptSchema,
  UpdateScriptSchema,
  ScriptModeSchema,
  ScriptCategorySchema,
} from '../schemas';
import type { WorkspaceScript, ScriptRuntimeState, ScriptWithState } from '../types';
import { createDefaultRuntimeState } from '../types';
import type { OutputLine } from './script-output-buffer';

const logger = new Logger('ScriptsIPC');

/** Track workspaces that have already triggered auto-start to avoid duplicates */
const autoStartTriggered = new Set<string>();

// ============================================================================
// Validation Schemas
// ============================================================================

const WorkspaceIdField = z.string().min(1, 'Workspace ID is required');

const ScriptsListSchema = z.object({
  workspaceId: WorkspaceIdField,
});

const ScriptsCreateSchema = z.object({
  workspaceId: WorkspaceIdField,
  script: CreateScriptSchema,
});

const ScriptsUpdateSchema = z.object({
  workspaceId: WorkspaceIdField,
  scriptId: z.string().min(1, 'Script ID is required'),
  updates: UpdateScriptSchema,
});

const ScriptsRemoveSchema = z.object({
  workspaceId: WorkspaceIdField,
  scriptId: z.string().min(1, 'Script ID is required'),
});

const ScriptsStartSchema = z.object({
  workspaceId: WorkspaceIdField,
  scriptId: z.string().min(1, 'Script ID is required'),
});

const ScriptsStopSchema = z.object({
  workspaceId: WorkspaceIdField,
  scriptId: z.string().min(1, 'Script ID is required'),
});

const ScriptsRestartSchema = z.object({
  workspaceId: WorkspaceIdField,
  scriptId: z.string().min(1, 'Script ID is required'),
});

const ScriptsGetStatusSchema = z.object({
  workspaceId: WorkspaceIdField,
  scriptId: z.string().min(1, 'Script ID is required'),
});

const ScriptsGetOutputSchema = z.object({
  workspaceId: WorkspaceIdField,
  scriptId: z.string().min(1, 'Script ID is required'),
  lastN: z.number().int().positive().optional(),
});

// ============================================================================
// Helpers
// ============================================================================

/**
 * Validate that a cwd value doesn't escape the workspace root.
 * Returns an error string if invalid, or null if valid.
 */
function validateCwd(cwd: string | undefined, workspacePath: string): string | null {
  if (!cwd) return null;
  if (path.isAbsolute(cwd)) {
    return `cwd must be a relative path, got absolute: ${cwd}`;
  }
  const resolved = path.resolve(workspacePath, cwd);
  const normalizedWorkspace = path.resolve(workspacePath);
  if (!resolved.startsWith(normalizedWorkspace + path.sep) && resolved !== normalizedWorkspace) {
    return `cwd escapes workspace root: ${cwd}`;
  }
  return null;
}

/**
 * Resolve workspace path for the ScriptProcessManager.
 * Returns { workspacePath, metadataPath } or throws.
 */
async function resolveWorkspacePaths(
  workspaceId: string,
): Promise<{ workspacePath: string; metadataPath: string; repositoryPath: string }> {
  const ws = await workspaceService.getWorkspace(createWorkspaceId(workspaceId));
  if (!ws.ok) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }
  const data = ws.data;
  const workspacePath = data.worktreePath || data.repositoryPath || data.path;
  if (!workspacePath) {
    throw new Error(`Workspace ${workspaceId} has no path`);
  }
  const repositoryPath = data.repositoryPath || workspacePath;
  const metadataPath = WorkspaceConfig.paths.metadata(workspaceId);
  return { workspacePath, metadataPath, repositoryPath };
}

/**
 * Get or create a ScriptProcessManager for a workspace,
 * wiring up state-change and output callbacks to emit domain events.
 */
async function getOrCreateManager(workspaceId: string) {
  const { workspacePath, metadataPath } = await resolveWorkspacePaths(workspaceId);
  const manager = getScriptProcessManager(workspaceId, workspacePath, metadataPath);

  // Wire callbacks (idempotent — ScriptProcessManager stores only one callback)
  manager.setStateChangeCallback((scriptId: string, state: ScriptRuntimeState) => {
    const wsId = workspaceId as unknown as WorkspaceId;
    // Look up the actual script name asynchronously
    readScripts(workspaceId).then((scripts) => {
      const script = scripts.find((s) => s.id === scriptId);
      const scriptName = script?.name || scriptId;

      if (state.status === 'running') {
        mainDispatch(scriptStarted({
          workspaceId: wsId,
          scriptId,
          scriptName,
          pid: state.pid,
          startedAt: state.startedAt ? new Date(state.startedAt).toISOString() : new Date().toISOString(),
        }));
      } else if (state.status === 'exited' || state.status === 'idle') {
        // Only emit stopped if it was previously running (has stoppedAt)
        if (state.stoppedAt) {
          mainDispatch(scriptStopped({
            workspaceId: wsId,
            scriptId,
            scriptName,
            exitCode: state.exitCode,
            stoppedAt: new Date(state.stoppedAt).toISOString(),
          }));
        }
      }
      if (state.error) {
        mainDispatch(scriptError({
          workspaceId: wsId,
          scriptId,
          scriptName,
          error: state.error,
        }));
      }
      if (state.detectedUrl) {
        mainDispatch(scriptUrlDetected({
          workspaceId: wsId,
          scriptId,
          scriptName,
          url: state.detectedUrl,
        }));
      }
    }).catch((err) => {
      logger.warn('Failed to look up script name for event', { scriptId, error: String(err) });
    });
  });

  manager.setOutputCallback((scriptId: string, lines: OutputLine[]) => {
    const wsId = workspaceId as unknown as WorkspaceId;
    mainDispatch(scriptOutput({
      workspaceId: wsId,
      scriptId,
      lines: lines.map((l) => ({
        text: l.text,
        stream: l.stream,
        timestamp: new Date(l.timestamp).toISOString(),
      })),
    }));
  });

  // Trigger auto-start for this workspace (once per workspace)
  if (!autoStartTriggered.has(workspaceId)) {
    autoStartTriggered.add(workspaceId);
    const mgr = manager;
    setTimeout(async () => {
      try {
        const scripts = await readScripts(workspaceId);
        const autoStartScripts = scripts.filter(
          (s) => s.autoStart && s.mode === 'service',
        );
        for (const script of autoStartScripts) {
          logger.info(`[Scripts] Auto-starting "${script.name}"`, {
            scriptId: script.id,
            workspaceId,
          });
          mgr.start(script);
        }
      } catch (error) {
        logger.error('[Scripts] Failed to auto-start scripts:', error as Error);
      }
    }, 2000);
  }

  return manager;
}

// ============================================================================
// IPC Handler Registration
// ============================================================================

export function registerScriptsHandlers(): void {
  logger.info('[Scripts] Registering scripts IPC handlers...');

  // ---- scripts:list ----
  ipcMain.handle(
    SCRIPTS_CHANNELS.LIST,
    createSafeValidatedHandler(
      ScriptsListSchema,
      async (_event, { workspaceId }) => {
        try {
          const scripts = await readScripts(workspaceId);
          const manager = await getOrCreateManager(workspaceId);

          const result: ScriptWithState[] = scripts.map((s) => ({
            ...s,
            runtime: manager.getState(s.id) || createDefaultRuntimeState(),
          }));

          return { success: true, data: result };
        } catch (error) {
          logger.error('[Scripts] Error listing scripts:', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            data: [],
          };
        }
      },
      SCRIPTS_CHANNELS.LIST,
    ),
  );

  // ---- scripts:create ----
  ipcMain.handle(
    SCRIPTS_CHANNELS.CREATE,
    createSafeValidatedHandler(
      ScriptsCreateSchema,
      async (_event, { workspaceId, script: input }) => {
        try {
          // Validate cwd doesn't escape workspace root
          if (input.cwd) {
            const { workspacePath } = await resolveWorkspacePaths(workspaceId);
            const cwdError = validateCwd(input.cwd, workspacePath);
            if (cwdError) {
              return { success: false, error: cwdError };
            }
          }

          const now = new Date().toISOString();
          const newScript: WorkspaceScript = {
            id: uuidv4(),
            workspaceId,
            name: input.name,
            command: input.command,
            cwd: input.cwd,
            env: input.env,
            mode: input.mode,
            category: input.category,
            source: input.source || 'user',
            autoStart: input.autoStart,
            createdAt: now,
          };

          await upsertScript(workspaceId, newScript);
          logger.info(`[Scripts] Created script "${newScript.name}"`, {
            scriptId: newScript.id,
            workspaceId,
          });

          return { success: true, data: newScript };
        } catch (error) {
          logger.error('[Scripts] Error creating script:', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      SCRIPTS_CHANNELS.CREATE,
    ),
  );

  // ---- scripts:update ----
  ipcMain.handle(
    SCRIPTS_CHANNELS.UPDATE,
    createSafeValidatedHandler(
      ScriptsUpdateSchema,
      async (_event, { workspaceId, scriptId, updates }) => {
        try {
          // Validate cwd doesn't escape workspace root
          if (updates.cwd) {
            const { workspacePath } = await resolveWorkspacePaths(workspaceId);
            const cwdError = validateCwd(updates.cwd, workspacePath);
            if (cwdError) {
              return { success: false, error: cwdError };
            }
          }

          const scripts = await readScripts(workspaceId);
          const existing = scripts.find((s) => s.id === scriptId);
          if (!existing) {
            return { success: false, error: `Script not found: ${scriptId}` };
          }

          const updated: WorkspaceScript = {
            ...existing,
            ...updates,
            updatedAt: new Date().toISOString(),
          };

          await upsertScript(workspaceId, updated);

          // Update in-memory definition so restarts use the latest version
          try {
            const manager = await getOrCreateManager(workspaceId);
            manager.updateDefinition(scriptId, updated);
          } catch { /* manager may not exist yet */ }

          logger.info(`[Scripts] Updated script "${updated.name}"`, {
            scriptId,
            workspaceId,
          });

          return { success: true, data: updated };
        } catch (error) {
          logger.error('[Scripts] Error updating script:', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      SCRIPTS_CHANNELS.UPDATE,
    ),
  );

  // ---- scripts:remove ----
  ipcMain.handle(
    SCRIPTS_CHANNELS.REMOVE,
    createSafeValidatedHandler(
      ScriptsRemoveSchema,
      async (_event, { workspaceId, scriptId }) => {
        try {
          // Stop if running
          try {
            const manager = await getOrCreateManager(workspaceId);
            await manager.remove(scriptId);
          } catch { /* manager may not exist yet */ }

          const removed = await removeScript(workspaceId, scriptId);
          if (!removed) {
            return { success: false, error: `Script not found: ${scriptId}` };
          }

          logger.info(`[Scripts] Removed script ${scriptId}`, { workspaceId });
          return { success: true };
        } catch (error) {
          logger.error('[Scripts] Error removing script:', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      SCRIPTS_CHANNELS.REMOVE,
    ),
  );

  // ---- scripts:start ----
  ipcMain.handle(
    SCRIPTS_CHANNELS.START,
    createSafeValidatedHandler(
      ScriptsStartSchema,
      async (_event, { workspaceId, scriptId }) => {
        try {
          const scripts = await readScripts(workspaceId);
          const script = scripts.find((s) => s.id === scriptId);
          if (!script) {
            return { success: false, error: `Script not found: ${scriptId}` };
          }

          const manager = await getOrCreateManager(workspaceId);
          manager.start(script);

          logger.info(`[Scripts] Started script "${script.name}"`, {
            scriptId,
            workspaceId,
          });

          return { success: true };
        } catch (error) {
          logger.error('[Scripts] Error starting script:', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      SCRIPTS_CHANNELS.START,
    ),
  );

  // ---- scripts:stop ----
  ipcMain.handle(
    SCRIPTS_CHANNELS.STOP,
    createSafeValidatedHandler(
      ScriptsStopSchema,
      async (_event, { workspaceId, scriptId }) => {
        try {
          const manager = await getOrCreateManager(workspaceId);
          await manager.stop(scriptId);

          logger.info(`[Scripts] Stopped script ${scriptId}`, { workspaceId });
          return { success: true };
        } catch (error) {
          logger.error('[Scripts] Error stopping script:', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      SCRIPTS_CHANNELS.STOP,
    ),
  );

  // ---- scripts:restart ----
  ipcMain.handle(
    SCRIPTS_CHANNELS.RESTART,
    createSafeValidatedHandler(
      ScriptsRestartSchema,
      async (_event, { workspaceId, scriptId }) => {
        try {
          const scripts = await readScripts(workspaceId);
          const script = scripts.find((s) => s.id === scriptId);
          if (!script) {
            return { success: false, error: `Script not found: ${scriptId}` };
          }

          const manager = await getOrCreateManager(workspaceId);
          // Update in-memory definition before restarting so the latest command is used
          manager.updateDefinition(scriptId, script);
          await manager.restart(scriptId);

          logger.info(`[Scripts] Restarted script "${script.name}"`, {
            scriptId,
            workspaceId,
          });

          return { success: true };
        } catch (error) {
          logger.error('[Scripts] Error restarting script:', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      SCRIPTS_CHANNELS.RESTART,
    ),
  );

  // ---- scripts:get-status ----
  ipcMain.handle(
    SCRIPTS_CHANNELS.GET_STATUS,
    createSafeValidatedHandler(
      ScriptsGetStatusSchema,
      async (_event, { workspaceId, scriptId }) => {
        try {
          const manager = await getOrCreateManager(workspaceId);
          const state = manager.getState(scriptId);

          return {
            success: true,
            status: state || createDefaultRuntimeState(),
          };
        } catch (error) {
          logger.error('[Scripts] Error getting script status:', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      SCRIPTS_CHANNELS.GET_STATUS,
    ),
  );

  // ---- scripts:get-output ----
  ipcMain.handle(
    SCRIPTS_CHANNELS.GET_OUTPUT,
    createSafeValidatedHandler(
      ScriptsGetOutputSchema,
      async (_event, { workspaceId, scriptId, lastN }) => {
        try {
          const manager = await getOrCreateManager(workspaceId);
          const buffer = manager.getBuffer(scriptId);

          if (!buffer) {
            return { success: true, lines: [] };
          }

          const lines = lastN ? buffer.getLastLines(lastN) : buffer.getLines();
          return { success: true, lines };
        } catch (error) {
          logger.error('[Scripts] Error getting script output:', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            lines: [],
          };
        }
      },
      SCRIPTS_CHANNELS.GET_OUTPUT,
    ),
  );

  logger.info('[Scripts] Scripts IPC handlers registered');
}