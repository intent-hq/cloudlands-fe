/**
 * Skills IPC Handler
 *
 * Exposes discovered agent skills to the renderer process.
 */

import { ipcMain } from 'electron';
import { SKILLS_CHANNELS } from '$shared/ipc/channels';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import { SkillsListSchema } from '../../../main/ipc-schemas';
import { protocolAdapter } from '../../protocol/main/protocol-adapter';
import { discoverSkills } from './skills-loader';
import { Logger } from '$shared/logger';

const logger = new Logger('SkillsIPC');

export function setupSkillsIPC(): void {
  logger.info('Setting up skills IPC handlers');

  ipcMain.handle(
    SKILLS_CHANNELS.LIST,
    createSafeValidatedHandler(
      SkillsListSchema,
      async (_event, validated) => {
        try {
          const workspace = await protocolAdapter.getWorkspace(validated.workspaceId);
          if (!workspace) {
            return { success: false, error: 'Workspace not found' };
          }

          const workspacePath = workspace.worktreePath || workspace.repositoryPath;
          if (!workspacePath) {
            return { success: false, error: 'Workspace has no path' };
          }

          const skills = await discoverSkills(workspacePath);
          return { success: true, data: skills };
        } catch (error) {
          logger.error('Failed to list skills', error as Error);
          return { success: false, error: (error as Error).message };
        }
      },
      SKILLS_CHANNELS.LIST,
    ),
  );

  logger.info('Skills IPC handlers setup complete');
}

