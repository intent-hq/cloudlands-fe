/**
 * Rules IPC
 *
 * IPC handlers for rules and guidelines management
 */

import { ipcMain } from 'electron';
import { rulesService } from './rules.service';
import { Logger } from '$shared/logger';
import { RULES_CHANNELS } from '$shared/ipc/channels';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import {
  RulesListSchema,
  RulesLoadWorkspaceSchema,
  RulesGetContextSchema,
} from '../../../main/ipc-schemas';

const logger = new Logger('RulesIPC');

function resultToCommandResponse(result: any) {
  if (result.ok) {
    return { success: true, data: result.data };
  } else {
    return { success: false, error: result.error };
  }
}

export function setupRulesIPC() {
  logger.info('Setting up rules IPC handlers');

  // List rules
  ipcMain.handle(
    RULES_CHANNELS.LIST,
    createSafeValidatedHandler(
      RulesListSchema,
      async (_, validated) => {
        const result = await rulesService.listRules(validated.workspaceId);
        return resultToCommandResponse(result);
      },
      RULES_CHANNELS.LIST,
    ),
  );

  // Load project rules
  ipcMain.handle(
    RULES_CHANNELS.LOAD_WORKSPACE,
    createSafeValidatedHandler(
      RulesLoadWorkspaceSchema,
      async (_, validated) => {
        const result = await rulesService.loadProjectRules(validated.workspacePath);
        return resultToCommandResponse(result);
      },
      RULES_CHANNELS.LOAD_WORKSPACE,
    ),
  );

  // Get rules as context
  ipcMain.handle(
    RULES_CHANNELS.GET_CONTEXT,
    createSafeValidatedHandler(
      RulesGetContextSchema,
      async (_, validated) => {
        const result = await rulesService.getRulesAsContext(validated.workspaceId);
        return resultToCommandResponse(result);
      },
      RULES_CHANNELS.GET_CONTEXT,
    ),
  );

  logger.info('Rules IPC handlers setup complete');
}
