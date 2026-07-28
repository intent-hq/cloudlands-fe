/**
 * On-demand workspace summary IPC endpoints.
 *
 * Source-of-truth handlers for WORKSPACE_CHANNELS.GET_DIFF_SUMMARY,
 * GET_GIT_SUMMARY, and GET_TASKS. Each call computes fresh data from
 * git / the notes service; results are never persisted back onto the
 * workspace object.
 */

import { ipcMain } from 'electron';

import { WORKSPACE_CHANNELS } from '../../../shared/ipc/channels';
import { Logger } from '../../../shared/logger';
import { m } from '$shared/paraglide/messages.js';
import type { CommandResponse, WorkspaceId } from '../../../shared/types';
import {
  WorkspaceGetDiffSummarySchema,
  WorkspaceGetGitSummarySchema,
  WorkspaceGetTasksSchema,
} from '../../../main/ipc-schemas';
import {
  createSafeValidatedHandler,
  registerValidationSchema,
} from '../../../main/ipc-validation-middleware';
import { protocolAdapter } from '../../protocol/main/protocol-adapter';
import {
  computeWorkspaceDiffSummary,
  computeWorkspaceGitSummary,
  getWorkspaceTasks,
} from './workspace-summaries';

const logger = new Logger('WorkspaceSummaryIPC');

function success<T>(data: T): CommandResponse<T> {
  return { success: true, data };
}

function failure(error: string): CommandResponse<never> {
  return { success: false, error };
}

export function setupWorkspaceSummaryIPC(): void {
  registerValidationSchema(WORKSPACE_CHANNELS.GET_DIFF_SUMMARY, WorkspaceGetDiffSummarySchema);
  registerValidationSchema(WORKSPACE_CHANNELS.GET_GIT_SUMMARY, WorkspaceGetGitSummarySchema);
  registerValidationSchema(WORKSPACE_CHANNELS.GET_TASKS, WorkspaceGetTasksSchema);

  // On-demand diff summary (file/line change counts vs HEAD)
  ipcMain.handle(
    WORKSPACE_CHANNELS.GET_DIFF_SUMMARY,
    createSafeValidatedHandler(
      WorkspaceGetDiffSummarySchema,
      async (_, validated) => {
        const workspaceId = validated.workspaceId as WorkspaceId;
        try {
          const workspace = await protocolAdapter.getWorkspace(workspaceId);
          if (!workspace) {
            return failure(m.workspaceIpc_workspaceNotFound_error());
          }
          const summary = await computeWorkspaceDiffSummary(workspaceId, workspace.worktreePath);
          return success(summary ?? null);
        } catch (error) {
          logger.error('Failed to get diff summary', error as Error, { workspaceId });
          return failure(m.workspaceSummary_diffSummaryFailed_error());
        }
      },
      WORKSPACE_CHANNELS.GET_DIFF_SUMMARY,
    ),
  );

  // On-demand git summary (ahead/behind/unpushed/recent commits)
  ipcMain.handle(
    WORKSPACE_CHANNELS.GET_GIT_SUMMARY,
    createSafeValidatedHandler(
      WorkspaceGetGitSummarySchema,
      async (_, validated) => {
        const workspaceId = validated.workspaceId as WorkspaceId;
        try {
          const workspace = await protocolAdapter.getWorkspace(workspaceId);
          if (!workspace) {
            return failure(m.workspaceIpc_workspaceNotFound_error());
          }
          const summary = await computeWorkspaceGitSummary({
            id: workspaceId,
            worktreePath: workspace.worktreePath,
            baseRef: workspace.baseRef,
          });
          return success(summary ?? null);
        } catch (error) {
          logger.error('Failed to get git summary', error as Error, { workspaceId });
          return failure(m.workspaceSummary_gitSummaryFailed_error());
        }
      },
      WORKSPACE_CHANNELS.GET_GIT_SUMMARY,
    ),
  );

  // On-demand canonical task list (renderer selectors derive counts)
  ipcMain.handle(
    WORKSPACE_CHANNELS.GET_TASKS,
    createSafeValidatedHandler(
      WorkspaceGetTasksSchema,
      async (_, validated) => {
        const workspaceId = validated.workspaceId as WorkspaceId;
        try {
          const tasks = await getWorkspaceTasks(workspaceId);
          return success(tasks);
        } catch (error) {
          logger.error('Failed to get workspace tasks', error as Error, { workspaceId });
          return failure(m.workspaceSummary_tasksFailed_error());
        }
      },
      WORKSPACE_CHANNELS.GET_TASKS,
    ),
  );

  logger.info('Workspace summary IPC handlers registered');
}
