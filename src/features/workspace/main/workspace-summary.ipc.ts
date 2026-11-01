/**
 * On-demand workspace summary IPC endpoints.
 *
 * Source-of-truth handler for WORKSPACE_CHANNELS.GET_TASKS. Each call
 * computes fresh data from the notes service; results are never persisted
 * back onto the workspace object. The diff/git summaries are served by the
 * renderer's workspace-summaries-bridge-seeder.
 */

import { ipcMain } from 'electron';

import { WORKSPACE_CHANNELS } from '../../../shared/ipc/channels';
import { Logger } from '../../../shared/logger';
import { m } from '$shared/paraglide/messages.js';
import type { CommandResponse, WorkspaceId } from '../../../shared/types';
import { WorkspaceGetTasksSchema } from '../../../main/ipc-schemas';
import {
  createSafeValidatedHandler,
  registerValidationSchema,
} from '../../../main/ipc-validation-middleware';
import { getWorkspaceTasks } from './workspace-summaries';

const logger = new Logger('WorkspaceSummaryIPC');

function success<T>(data: T): CommandResponse<T> {
  return { success: true, data };
}

function failure(error: string): CommandResponse<never> {
  return { success: false, error };
}

export function setupWorkspaceSummaryIPC(): void {
  registerValidationSchema(WORKSPACE_CHANNELS.GET_TASKS, WorkspaceGetTasksSchema);

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
