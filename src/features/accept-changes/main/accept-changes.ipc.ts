/**
 * Accept Changes IPC Handlers
 *
 * IPC handlers for the accept changes workflow.
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { IPC_CHANNELS } from '../../../shared/ipc-registry';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import { Logger } from '../../../shared/logger';
import { AcceptChangesService } from './accept-changes.service';
import type { AcceptAction, MergeStrategy } from '../types';

const logger = new Logger('AcceptChangesIPC');

// Zod schemas for validation
const GetStatusSchema = z.object({
  workspaceId: z.string(),
});

const PrepareSchema = z.object({
  workspaceId: z.string(),
  action: z.enum(['commit', 'push', 'create-pr', 'merge', 'export', 'undo-push', 'undo-commit', 'reset-to-trunk', 'rebase-onto-trunk']),
  files: z.array(z.string()).optional(),
});

const UndoCommitMetadataSchema = z.object({
  hash: z.string(),
  agentId: z.string().optional(),
  agentName: z.string().optional(),
  linkedNoteId: z.string().optional(),
  files: z.array(z.string()).optional(),
});

const ExecuteSchema = z.object({
  workspaceId: z.string(),
  action: z.enum(['commit', 'push', 'create-pr', 'merge', 'export', 'undo-push', 'undo-commit', 'reset-to-trunk', 'rebase-onto-trunk']),
  files: z.array(z.string()).optional(),
  commitMessage: z.string().optional(),
  prTitle: z.string().optional(),
  prBody: z.string().optional(),
  targetBranch: z.string().optional(),
  mergeStrategy: z.enum(['merge', 'squash', 'rebase']).optional(),
  exportPath: z.string().optional(),
  upToCommitHash: z.string().optional(),
  undoCommitsMetadata: z.array(UndoCommitMetadataSchema).optional(),
  options: z
    .object({
      stageUnstaged: z.boolean().optional(),
      pushAfterCommit: z.boolean().optional(),
      createPRAfterPush: z.boolean().optional(),
      rebaseFirst: z.boolean().optional(),
      localOnly: z.boolean().optional(),
    })
    .optional(),
});

const ExportSchema = z.object({
  workspaceId: z.string(),
  targetPath: z.string(),
  files: z.array(z.string()).optional(),
  preserveStructure: z.boolean().optional(),
});

const CheckPathHasChangesSchema = z.object({
  targetPath: z.string(),
});

const MergePRSchema = z.object({
  workspaceId: z.string(),
  prNumber: z.number(),
  mergeMethod: z.enum(['merge', 'squash', 'rebase']).optional(),
  commitTitle: z.string().optional(),
  commitMessage: z.string().optional(),
});

const AddRemoteSchema = z.object({
  workspaceId: z.string(),
  remoteUrl: z.string(),
});

let acceptChangesService: AcceptChangesService | null = null;

function getService(): AcceptChangesService {
  if (!acceptChangesService) {
    acceptChangesService = new AcceptChangesService();
  }
  return acceptChangesService;
}

export function registerAcceptChangesHandlers(): void {
  logger.info('Registering accept changes IPC handlers');
  const channels = IPC_CHANNELS.ACCEPT_CHANGES;

  // Get Status
  ipcMain.handle(
    channels.GET_STATUS,
    createSafeValidatedHandler(
      GetStatusSchema,
      async (_: IpcMainInvokeEvent, validated: z.infer<typeof GetStatusSchema>) => {
        const service = getService();
        const status = await service.getWorkspaceGitStatus(validated.workspaceId as any);
        return { success: true, data: status };
      },
      channels.GET_STATUS,
    ),
  );

  // Prepare
  ipcMain.handle(
    channels.PREPARE,
    createSafeValidatedHandler(
      PrepareSchema,
      async (_: IpcMainInvokeEvent, validated: z.infer<typeof PrepareSchema>) => {
        const service = getService();
        const result = await service.prepare({
          workspaceId: validated.workspaceId as any,
          action: validated.action as AcceptAction,
          files: validated.files,
        });
        return { success: true, data: result };
      },
      channels.PREPARE,
    ),
  );

  // Execute
  ipcMain.handle(
    channels.EXECUTE,
    createSafeValidatedHandler(
      ExecuteSchema,
      async (_: IpcMainInvokeEvent, validated: z.infer<typeof ExecuteSchema>) => {
        const service = getService();
        const result = await service.execute({
          workspaceId: validated.workspaceId as any,
          action: validated.action as AcceptAction,
          files: validated.files,
          commitMessage: validated.commitMessage,
          prTitle: validated.prTitle,
          prBody: validated.prBody,
          targetBranch: validated.targetBranch,
          mergeStrategy: validated.mergeStrategy as MergeStrategy | undefined,
          exportPath: validated.exportPath,
          upToCommitHash: validated.upToCommitHash,
          undoCommitsMetadata: validated.undoCommitsMetadata,
          options: validated.options,
        });
        return { success: result.success, data: result, error: result.error };
      },
      channels.EXECUTE,
    ),
  );

  // Export
  ipcMain.handle(
    channels.EXPORT,
    createSafeValidatedHandler(
      ExportSchema,
      async (_: IpcMainInvokeEvent, validated: z.infer<typeof ExportSchema>) => {
        const service = getService();
        const result = await service.exportFiles({
          workspaceId: validated.workspaceId as any,
          targetPath: validated.targetPath,
          files: validated.files,
          preserveStructure: validated.preserveStructure,
        });
        return { success: result.success, data: result, error: result.error };
      },
      channels.EXPORT,
    ),
  );

  // Check if path has uncommitted changes
  ipcMain.handle(
    channels.CHECK_PATH_HAS_CHANGES,
    createSafeValidatedHandler(
      CheckPathHasChangesSchema,
      async (_: IpcMainInvokeEvent, validated: z.infer<typeof CheckPathHasChangesSchema>) => {
        const service = getService();
        const result = await service.checkPathHasChanges(validated.targetPath);
        return { success: true, data: result };
      },
      channels.CHECK_PATH_HAS_CHANGES,
    ),
  );

  // Merge PR on GitHub
  ipcMain.handle(
    channels.MERGE_PR,
    createSafeValidatedHandler(
      MergePRSchema,
      async (_: IpcMainInvokeEvent, validated: z.infer<typeof MergePRSchema>) => {
        const service = getService();
        const result = await service.mergePR(validated.workspaceId as any, validated.prNumber, {
          mergeMethod: validated.mergeMethod as 'merge' | 'squash' | 'rebase' | undefined,
          commitTitle: validated.commitTitle,
          commitMessage: validated.commitMessage,
        });
        return { success: result.success, data: result, error: result.error };
      },
      channels.MERGE_PR,
    ),
  );

  // Add Remote
  ipcMain.handle(
    channels.ADD_REMOTE,
    createSafeValidatedHandler(
      AddRemoteSchema,
      async (_: IpcMainInvokeEvent, validated: z.infer<typeof AddRemoteSchema>) => {
        const service = getService();
        const status = await service.addRemote(
          validated.workspaceId as any,
          validated.remoteUrl,
        );
        return { success: true, data: status };
      },
      channels.ADD_REMOTE,
    ),
  );

  logger.info('Accept changes IPC handlers registered');
}
