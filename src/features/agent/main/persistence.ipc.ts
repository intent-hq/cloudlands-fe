/**
 * Persistence IPC Handler
 *
 * Handles IPC communication for persistence operations between renderer and main process.
 * Uses the unified persistence service for all operations.
 */

import { ipcMain } from 'electron';
import { unifiedPersistence } from './agent-persistence';
import type { CommandResponse } from '../../../shared/types';
import { Logger } from '../../../shared/logger';
import { PERSISTENCE_CHANNELS } from '../../../shared/ipc/channels';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import {
  PersistenceLoadSchema,
  PersistenceLoadAgentConfigSchema,
  PersistenceLoadSessionSchema,
  PersistenceSaveSchema,
  PersistenceSaveAgentConfigSchema,
  PersistenceSaveSessionSchema,
  PersistenceLoadRegistrySchema,
  PersistenceSaveRegistrySchema,
} from '../../../main/ipc-schemas';

const logger = new Logger('PersistenceIPC');

export function setupPersistenceIPC(): void {
  logger.info('Setting up persistence IPC handlers');

  // Load data by key
  ipcMain.handle(
    PERSISTENCE_CHANNELS.LOAD,
    createSafeValidatedHandler(
      PersistenceLoadSchema,
      async (event, validated) => {
        try {
          // For now, just return null as this is a placeholder
          // In a real implementation, this would load from a persistent store
          logger.debug(`Loading data for key: ${validated.key}`);
          return {
            success: true,
            data: null,
          } as CommandResponse;
        } catch (error) {
          logger.error(`Failed to load data for key: ${validated.key}`, error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to load data',
          } as CommandResponse;
        }
      },
      PERSISTENCE_CHANNELS.LOAD,
    ),
  );

  // Load agent config (via unified persistence)
  ipcMain.handle(
    PERSISTENCE_CHANNELS.LOAD_AGENT_CONFIG,
    createSafeValidatedHandler(
      PersistenceLoadAgentConfigSchema,
      async (event, validated) => {
        try {
          // Ensure IDs are strings
          const plainAgentId = validated.agentId ? String(validated.agentId) : undefined;
          const plainWorkspaceId = String(validated.workspaceId);

          logger.debug(
            `Loading agent config for: ${plainAgentId} in workspace: ${plainWorkspaceId}`,
          );

          // If workspaceId is not provided, we can't load the config
          if (!plainWorkspaceId) {
            logger.warn(`No workspaceId provided for agent: ${plainAgentId}`);
            return {
              success: true,
              data: null,
            } as CommandResponse;
          }

          // Get workspace path for the workspace
          const { WorkspaceConfig } = await import('../../../shared/main/config.js');
          const workspacePath = WorkspaceConfig.paths.workspace(plainWorkspaceId);

          const result = await unifiedPersistence.loadAgent(
            plainAgentId as any,
            plainWorkspaceId as any,
            workspacePath,
          );

          return {
            success: result.success,
            data: result.data,
            error: result.error,
          } as CommandResponse;
        } catch (error) {
          logger.error(`Failed to load agent config for: ${validated.agentId}`, error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to load agent config',
          } as CommandResponse;
        }
      },
      PERSISTENCE_CHANNELS.LOAD_AGENT_CONFIG,
    ),
  );

  // Load session (via unified persistence)
  ipcMain.handle(
    PERSISTENCE_CHANNELS.LOAD_SESSION,
    createSafeValidatedHandler(
      PersistenceLoadSessionSchema,
      async (event, validated) => {
        try {
          // Ensure agentId is a string
          const plainAgentId = validated.agentId ? String(validated.agentId) : undefined;
          const plainWorkspaceId = String(validated.workspaceId);

          logger.debug(`Loading session: ${plainAgentId} in workspace: ${plainWorkspaceId}`);

          // If workspaceId is not provided, we can't load the session
          if (!plainWorkspaceId) {
            logger.warn(`No workspaceId provided for agent: ${plainAgentId}`);
            return {
              success: true,
              data: null,
            } as CommandResponse;
          }

          // Get workspace path for the workspace
          const { WorkspaceConfig } = await import('../../../shared/main/config.js');
          const workspacePath = WorkspaceConfig.paths.workspace(plainWorkspaceId);

          const result = await unifiedPersistence.loadAgent(
            plainAgentId as any,
            plainWorkspaceId as any,
            workspacePath,
          );

          // Return the data wrapped in a success response
          // The frontend expects { success: boolean; data: any }
          if (result.success && result.data) {
            return {
              success: true,
              data: result.data,
            };
          }

          // Return null data when agent doesn't exist
          return {
            success: true,
            data: null,
          };
        } catch (error) {
          logger.error(`Failed to load session for agent: ${validated.agentId}`, error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to load session',
          } as CommandResponse;
        }
      },
      PERSISTENCE_CHANNELS.LOAD_SESSION,
    ),
  );

  // Save data by key
  ipcMain.handle(
    PERSISTENCE_CHANNELS.SAVE,
    createSafeValidatedHandler(
      PersistenceSaveSchema,
      async (event, validated) => {
        try {
          // For now, just return success as this is a placeholder
          // In a real implementation, this would save to a persistent store
          logger.debug(`Saving data for key: ${validated.key}`);
          return {
            success: true,
          } as CommandResponse;
        } catch (error) {
          logger.error(`Failed to save data for key: ${validated.key}`, error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to save data',
          } as CommandResponse;
        }
      },
      PERSISTENCE_CHANNELS.SAVE,
    ),
  );

  // Save agent config (via unified persistence)
  ipcMain.handle(
    PERSISTENCE_CHANNELS.SAVE_AGENT_CONFIG,
    createSafeValidatedHandler(
      PersistenceSaveAgentConfigSchema,
      async (event, validated) => {
        try {
          // Ensure IDs are strings
          const plainAgentId = String(validated.agentId);
          const plainWorkspaceId = String(validated.workspaceId);

          logger.debug(
            `Saving agent config for: ${plainAgentId} in workspace: ${plainWorkspaceId}`,
          );

          // Get workspace path for the workspace
          const { WorkspaceConfig } = await import('../../../shared/main/config.js');
          const workspacePath = WorkspaceConfig.paths.workspace(plainWorkspaceId);

          // Load existing agent, update config, and save
          const loadResult = await unifiedPersistence.loadAgent(
            plainAgentId as any,
            plainWorkspaceId as any,
            workspacePath,
          );

          if (!loadResult.success || !loadResult.data) {
            logger.warn(`Agent not found for config update: ${plainAgentId}`);
            return {
              success: false,
              error: 'Agent not found',
            } as CommandResponse;
          }

          // Update agent with new config
          const updatedAgent = {
            ...loadResult.data,
            ...validated.config,
            updatedAt: new Date(),
          };

          // Save updated agent
          const saveResult = await unifiedPersistence.saveAgent(updatedAgent);

          return {
            success: saveResult.success,
            error: saveResult.error,
          } as CommandResponse;
        } catch (error) {
          logger.error(`Failed to save agent config for: ${validated.agentId}`, error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to save agent config',
          } as CommandResponse;
        }
      },
      PERSISTENCE_CHANNELS.SAVE_AGENT_CONFIG,
    ),
  );

  // Save session (via unified persistence)
  ipcMain.handle(
    PERSISTENCE_CHANNELS.SAVE_SESSION,
    createSafeValidatedHandler(
      PersistenceSaveSessionSchema,
      async (event, validated) => {
        try {
          // Ensure workspaceId is a string
          const plainWorkspaceId = String(validated.workspaceId);

          logger.debug(
            `Saving session: ${validated.session?.id} in workspace: ${plainWorkspaceId}`,
          );

          // Get workspace path for the workspace
          const { WorkspaceConfig } = await import('../../../shared/main/config.js');
          const workspacePath = WorkspaceConfig.paths.workspace(plainWorkspaceId);

          // CRITICAL FIX: Load existing agent first to preserve fields like systemPrompt
          // that the frontend doesn't manage
          const existingAgent = await unifiedPersistence.loadAgent(
            validated.session.id as any,
            plainWorkspaceId as any,
            workspacePath,
          );

          let agentToSave = validated.session;

          if (existingAgent.success && existingAgent.data) {
            // CRITICAL FIX: Prevent frontend from overwriting backend-persisted messages.
            const existingMessages: any[] = existingAgent.data.messages || [];
            const frontendMessages: any[] = validated.session.messages || [];
            let mergedMessages = frontendMessages;

            const allowTruncation = validated.options?.allowTruncation === true;

            // Safety net: never let an empty frontend save overwrite non-empty disk messages.
            // This prevents race conditions where the frontend hasn't received messages yet
            // (e.g., during workspace creation) from clobbering backend-persisted messages.
            if (!allowTruncation && frontendMessages.length === 0 && existingMessages.length > 0) {
              logger.warn('Frontend save has empty messages but disk has messages — keeping disk messages', {
                agentId: validated.session.id,
                existingMessageCount: existingMessages.length,
              });
              mergedMessages = existingMessages;
            }

            if (
              !allowTruncation &&
              frontendMessages.length > 0 &&
              existingMessages.length > 0
            ) {
              const existingMessageIds = new Set(existingMessages.map((m: any) => m.id));

              // Split frontend messages into those that exist on disk and those that are new
              const frontendNewMessages = frontendMessages.filter(
                (m: any) => !existingMessageIds.has(m.id),
              );
              const frontendKnownMessages = frontendMessages.filter(
                (m: any) => existingMessageIds.has(m.id),
              );

              // Check if the frontend's known messages form a prefix of the disk messages.
              // This distinguishes "stale frontend missing backend-added messages" from
              // "intentional edit/regenerate that removed messages from the middle/end".
              let isPrefix = true;
              for (let i = 0; i < frontendKnownMessages.length; i++) {
                if (
                  i >= existingMessages.length ||
                  frontendKnownMessages[i].id !== existingMessages[i].id
                ) {
                  isPrefix = false;
                  break;
                }
              }

              if (isPrefix && frontendKnownMessages.length > 0 && frontendKnownMessages.length < existingMessages.length) {
                logger.warn(
                  'Frontend save has stale message subset - merging with disk to prevent data loss',
                  {
                    agentId: validated.session.id,
                    existingMessageCount: existingMessages.length,
                    frontendMessageCount: frontendMessages.length,
                    frontendKnownCount: frontendKnownMessages.length,
                    frontendNewCount: frontendNewMessages.length,
                  },
                );

                // Merge: keep all disk messages, append new frontend messages
                mergedMessages = [...existingMessages, ...frontendNewMessages];
              }
            }

            // Merge with existing data, preserving systemPrompt and other backend-only fields
            agentToSave = {
              ...existingAgent.data,
              ...validated.session,
              // Use merged messages to prevent data loss
              messages: mergedMessages,
              // Explicitly preserve systemPrompt from existing data if not provided
              systemPrompt: validated.session.systemPrompt || existingAgent.data.systemPrompt,
            };

            logger.debug('Merging with existing agent data', {
              agentId: validated.session.id,
              hadExistingSystemPrompt: !!existingAgent.data.systemPrompt,
              hasNewSystemPrompt: !!validated.session.systemPrompt,
              preservedSystemPrompt: !!agentToSave.systemPrompt,
              existingMessageCount: existingMessages.length,
              frontendMessageCount: frontendMessages.length,
              mergedMessageCount: mergedMessages.length,
            });
          }

          const result = await unifiedPersistence.saveAgent(agentToSave, undefined);

          return {
            success: result.success,
            error: result.error,
          } as CommandResponse;
        } catch (error) {
          logger.error(`Failed to save session: ${validated.session?.id}`, error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to save session',
          } as CommandResponse;
        }
      },
      PERSISTENCE_CHANNELS.SAVE_SESSION,
    ),
  );

  // Load registry
  ipcMain.handle(
    PERSISTENCE_CHANNELS.LOAD_REGISTRY,
    createSafeValidatedHandler(
      PersistenceLoadRegistrySchema,
      async (event, validated) => {
        try {
          logger.debug(`Loading registry: ${validated.filename}`);

          // For now, return empty registry as this is a placeholder
          // In a real implementation, this would load from a persistent store
          return {
            success: true,
            data: {
              sessions: [],
              version: '1.0.0',
            },
          } as CommandResponse;
        } catch (error) {
          logger.error(`Failed to load registry: ${validated.filename}`, error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to load registry',
          } as CommandResponse;
        }
      },
      PERSISTENCE_CHANNELS.LOAD_REGISTRY,
    ),
  );

  // Save registry
  ipcMain.handle(
    PERSISTENCE_CHANNELS.SAVE_REGISTRY,
    createSafeValidatedHandler(
      PersistenceSaveRegistrySchema,
      async (event, validated) => {
        try {
          logger.debug(`Saving registry: ${validated.filename}`);

          // For now, just return success as this is a placeholder
          // In a real implementation, this would save to a persistent store
          return {
            success: true,
          } as CommandResponse;
        } catch (error) {
          logger.error(`Failed to save registry: ${validated.filename}`, error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to save registry',
          } as CommandResponse;
        }
      },
      PERSISTENCE_CHANNELS.SAVE_REGISTRY,
    ),
  );
}
