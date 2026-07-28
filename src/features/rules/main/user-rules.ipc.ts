/**
 * End User Rules IPC
 *
 * IPC handlers for managing user-defined rules
 *
 * IMPORTANT: These handlers are for UI/CRUD operations only.
 * Agent factory and other services should use CachedRulesService via agent:get-user-rules
 */

import { ipcMain } from 'electron';
import { EndUserRulesManager } from '../user-rules.service';
import { Logger } from '../../../shared/logger';
import { USER_RULES_CHANNELS } from '../../../shared/ipc/channels';
import type { ConfigManager } from '../../../shared/services/config-manager';
import { persistConfig } from '../../config/main/config.ipc';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import {
  UserRulesGetAllSchema,
  UserRulesGetFormattedSchema,
  UserRulesUpdateSchema,
  UserRulesSetEnabledSchema,
  UserRulesExportSchema,
  UserRulesImportSchema,
  UserRulesGetCombinedPromptSchema,
} from '../../../main/ipc-schemas';
import { z } from 'zod';

const logger = new Logger('EndUserRulesIPC');

// New schemas for per-type operations
const UserRulesGetByTypeSchema = z.object({
  // i18n-ignore (IPC payload validation, developer-facing)
  type: z.string().min(1, 'Rule type is required'),
});

const UserRulesUpdateByTypeSchema = z.object({
  // i18n-ignore (IPC payload validation, developer-facing)
  type: z.string().min(1, 'Rule type is required'),
  content: z.string(),
});

const UserRulesSetEnabledByTypeSchema = z.object({
  // i18n-ignore (IPC payload validation, developer-facing)
  type: z.string().min(1, 'Rule type is required'),
  enabled: z.boolean(),
});

const UserRulesDeleteByTypeSchema = z.object({
  // i18n-ignore (IPC payload validation, developer-facing)
  type: z.string().min(1, 'Rule type is required'),
});

const UserRulesExportByTypeSchema = z.object({
  // i18n-ignore (IPC payload validation, developer-facing)
  type: z.string().min(1, 'Rule type is required'),
});

export async function setupEndUserRulesIPC(configManager?: ConfigManager) {
  logger.info('Setting up end user rules IPC handlers');

  const endUserRulesManager = EndUserRulesManager.getInstance();
  await endUserRulesManager.initialize(configManager);

  // ========== NEW PER-TYPE HANDLERS ==========

  // Get all rules (new format)
  ipcMain.handle(
    USER_RULES_CHANNELS.GET_ALL,
    createSafeValidatedHandler(
      UserRulesGetAllSchema,
      async () => {
        try {
          const rules = endUserRulesManager.getAllRules();
          return { success: true, data: rules };
        } catch (error) {
          logger.error('Failed to get all rules', error as Error);
          return { success: false, error: String(error) };
        }
      },
      USER_RULES_CHANNELS.GET_ALL,
    ),
  );

  // Get rules by type
  ipcMain.handle(
    'user-rules:get-by-type',
    createSafeValidatedHandler(
      UserRulesGetByTypeSchema,
      async (_, validated) => {
        try {
          const rules = endUserRulesManager.getRulesByType(validated.type);
          return { success: true, data: rules };
        } catch (error) {
          logger.error('Failed to get rules by type', error as Error);
          return { success: false, error: String(error) };
        }
      },
      'user-rules:get-by-type',
    ),
  );

  // Get formatted rules by type (for CachedRulesService)
  ipcMain.handle(
    'user-rules:get-formatted-by-type',
    createSafeValidatedHandler(
      UserRulesGetByTypeSchema,
      async (_, validated) => {
        try {
          const formatted = endUserRulesManager.getFormattedRulesByType(validated.type);
          return { success: true, data: formatted };
        } catch (error) {
          logger.error('Failed to get formatted rules by type', error as Error);
          return { success: false, error: String(error) };
        }
      },
      'user-rules:get-formatted-by-type',
    ),
  );

  // Update rules by type
  ipcMain.handle(
    'user-rules:update-by-type',
    createSafeValidatedHandler(
      UserRulesUpdateByTypeSchema,
      async (_, validated) => {
        try {
          endUserRulesManager.updateRulesByType(validated.type, validated.content);

          // Persist to electron-store
          await persistConfig();

          const updated = endUserRulesManager.getRulesByType(validated.type);
          return { success: true, data: updated };
        } catch (error) {
          logger.error('Failed to update rules by type', error as Error);
          return { success: false, error: String(error) };
        }
      },
      'user-rules:update-by-type',
    ),
  );

  // Set enabled by type
  ipcMain.handle(
    'user-rules:set-enabled-by-type',
    createSafeValidatedHandler(
      UserRulesSetEnabledByTypeSchema,
      async (_, validated) => {
        try {
          endUserRulesManager.setRulesEnabledByType(validated.type, validated.enabled);

          // Persist to electron-store
          await persistConfig();

          return { success: true };
        } catch (error) {
          logger.error('Failed to set rules enabled by type', error as Error);
          return { success: false, error: String(error) };
        }
      },
      'user-rules:set-enabled-by-type',
    ),
  );

  // Delete rules by type
  ipcMain.handle(
    'user-rules:delete-by-type',
    createSafeValidatedHandler(
      UserRulesDeleteByTypeSchema,
      async (_, validated) => {
        try {
          endUserRulesManager.deleteRulesByType(validated.type);

          // Persist to electron-store
          await persistConfig();

          return { success: true };
        } catch (error) {
          logger.error('Failed to delete rules by type', error as Error);
          return { success: false, error: String(error) };
        }
      },
      'user-rules:delete-by-type',
    ),
  );

  // Get available rule types
  ipcMain.handle(
    'user-rules:get-available-types',
    createSafeValidatedHandler(
      z.object({}),
      async () => {
        try {
          const types = endUserRulesManager.getAvailableRuleTypes();
          return { success: true, data: types };
        } catch (error) {
          logger.error('Failed to get available rule types', error as Error);
          return { success: false, error: String(error) };
        }
      },
      'user-rules:get-available-types',
    ),
  );

  // ========== LEGACY HANDLERS (for backward compatibility) ==========

  // Get formatted rules for agent (legacy - returns 'system' type)
  ipcMain.handle(
    USER_RULES_CHANNELS.GET_FORMATTED,
    createSafeValidatedHandler(
      UserRulesGetFormattedSchema,
      async () => {
        try {
          const formatted = endUserRulesManager.getFormattedRulesByType('system');
          return { success: true, data: formatted || '' };
        } catch (error) {
          logger.error('Failed to get formatted rules', error as Error);
          return { success: false, error: String(error) };
        }
      },
      USER_RULES_CHANNELS.GET_FORMATTED,
    ),
  );

  // Update workspace rules (legacy - updates 'system' type)
  ipcMain.handle(
    USER_RULES_CHANNELS.UPDATE,
    createSafeValidatedHandler(
      UserRulesUpdateSchema,
      async (_, validated) => {
        try {
          endUserRulesManager.updateRulesByType('system', validated.content);

          // Persist to electron-store
          await persistConfig();

          const updated = endUserRulesManager.getRulesByType('system');
          return { success: true, data: updated };
        } catch (error) {
          logger.error('Failed to update workspace rules', error as Error);
          return { success: false, error: String(error) };
        }
      },
      USER_RULES_CHANNELS.UPDATE,
    ),
  );
  // Enable/disable workspace rules (legacy - affects 'system' type)
  ipcMain.handle(
    USER_RULES_CHANNELS.SET_ENABLED,
    createSafeValidatedHandler(
      UserRulesSetEnabledSchema,
      async (_, validated) => {
        try {
          endUserRulesManager.setRulesEnabledByType('system', validated.enabled);

          // Persist to electron-store
          await persistConfig();

          return { success: true };
        } catch (error) {
          logger.error('Failed to set rules enabled state', error as Error);
          return { success: false, error: String(error) };
        }
      },
      USER_RULES_CHANNELS.SET_ENABLED,
    ),
  );

  // Export all rules
  ipcMain.handle(
    USER_RULES_CHANNELS.EXPORT,
    createSafeValidatedHandler(
      UserRulesExportSchema,
      async () => {
        try {
          const json = endUserRulesManager.exportAllRules();
          return { success: true, data: json };
        } catch (error) {
          logger.error('Failed to export rules', error as Error);
          return { success: false, error: String(error) };
        }
      },
      USER_RULES_CHANNELS.EXPORT,
    ),
  );

  // Export rules by type
  ipcMain.handle(
    'user-rules:export-by-type',
    createSafeValidatedHandler(
      UserRulesExportByTypeSchema,
      async (_, validated) => {
        try {
          const json = endUserRulesManager.exportRulesByType(validated.type);
          return { success: true, data: json };
        } catch (error) {
          logger.error('Failed to export rules by type', error as Error);
          return { success: false, error: String(error) };
        }
      },
      'user-rules:export-by-type',
    ),
  );

  // Import rules
  ipcMain.handle(
    USER_RULES_CHANNELS.IMPORT,
    createSafeValidatedHandler(
      UserRulesImportSchema,
      async (_, validated) => {
        try {
          endUserRulesManager.importRules(validated.json);

          // Persist to electron-store
          await persistConfig();

          return { success: true };
        } catch (error) {
          logger.error('Failed to import rules', error as Error);
          return { success: false, error: String(error) };
        }
      },
      USER_RULES_CHANNELS.IMPORT,
    ),
  );

  // Get combined system prompt (deprecated - use CachedRulesService instead)
  ipcMain.handle(
    USER_RULES_CHANNELS.GET_COMBINED_PROMPT,
    createSafeValidatedHandler(
      UserRulesGetCombinedPromptSchema,
      async (_, validated) => {
        try {
          // Legacy behavior: just return the system rules
          const systemRules = endUserRulesManager.getFormattedRulesByType('system');
          const combined = systemRules
            ? validated.basePrompt
              ? `${validated.basePrompt}\n\n---\n\n${systemRules}`
              : systemRules
            : validated.basePrompt || '';
          return { success: true, data: combined };
        } catch (error) {
          logger.error('Failed to get combined prompt', error as Error);
          return { success: false, error: String(error) };
        }
      },
      USER_RULES_CHANNELS.GET_COMBINED_PROMPT,
    ),
  );

  logger.info('End user rules IPC handlers setup complete');
}

// Export legacy aliases for backward compatibility
export const setupWorkspaceRulesIPC = setupEndUserRulesIPC;
export const setupUserRulesIPC = setupEndUserRulesIPC;
