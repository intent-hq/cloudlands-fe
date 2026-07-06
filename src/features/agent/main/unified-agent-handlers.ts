/**
 * Complete Unified Agent IPC Handlers
 *
 * This file contains ALL agent operation handlers as requested.
 * Type-safe, clean IPC handlers for all agent operations.
 * Provides consistent error handling, request validation, and response formatting.
 *
 * Usage:
 *   registerAgentHandlers(backend);
 */

import { ipcMain } from '../../../main/tracked-ipc';
import { BrowserWindow } from 'electron';
import { Logger } from '$shared/logger';
import { WorkspaceConfig } from '$shared/main/config';
import {
  AGENT_CHANNELS,
  AGENT_BACKEND_CHANNELS,
} from '$shared/ipc/channels';
import type { AgentIpc } from '$shared/ipc/contracts';
import {
  formatIpcError,
  formatIpcSuccess,
} from './ipc-response-formatter';
import {
  restoreAgentId,
  restoreWorkspaceId,
} from '$shared/types/type-guards';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import {
  AgentBackendStopSchema,
  AgentBackendStreamMessageSchema,
  AgentCreateSchema,
  AgentGetSessionSchema,
  AgentSendMessageSchema,
  AgentListSessionsSchema,
  AgentDeleteSessionSchema,
  AgentActivateSchema,
  AgentLifecycleStartSchema,
  AgentLifecycleStopSchema,
  AgentMessagingSendSchema,
  AgentMessagingReceiveSchema,
  AgentSetModelSchema,
  AgentRenameSchema,
  AgentGetSpecializationRulesSchema,
  AgentContextUpdateSchema,
  AgentContextGetByWorkspaceSchema,
  AgentContextGetBySessionSchema,
  AgentQueueMessageSchema,
  AgentEditQueuedMessageSchema,
  AgentRemoveQueuedMessageSchema,
  AgentForceMessageSchema,
  AgentGetQueueSchema,
  EmptySchema,
} from '../../../main/ipc-schemas';

const logger = new Logger('UnifiedAgentHandlers');

/**
 * Complete Backend service interface for ALL agent operations
 * Defines all methods that must be implemented by the backend adapter
 */
export interface IAgentBackendService {
  // Core CRUD operations
  createAgent(request: AgentIpc.CreateRequest): Promise<AgentIpc.CreateResponse>;
  getAgent(request: AgentIpc.GetRequest): Promise<AgentIpc.GetResponse>;
  sendMessage(request: AgentIpc.SendMessageRequest): Promise<AgentIpc.SendMessageResponse>;
  listAgents(request: AgentIpc.ListRequest): Promise<AgentIpc.ListResponse>;
  deleteAgent(request: AgentIpc.DeleteRequest): Promise<AgentIpc.DeleteResponse>;
  updateSession(request: any): Promise<any>;
  exportSession(request: any): Promise<any>;
  importSession(request: any): Promise<any>;
  getHistory(request: any): Promise<any>;
  updateMetadata(request: any): Promise<any>;
  forkSession(request: any): Promise<any>;
  mergeSession(request: any): Promise<any>;
  getStats(request: any): Promise<any>;
  validateSession(request: any): Promise<any>;
  repairSession(request: any): Promise<any>;

  // Session management
  stopSession(request: AgentIpc.StopRequest): Promise<AgentIpc.StopResponse>;
  clearSession(request: any): Promise<any>;
  pauseSession(request: any): Promise<any>;
  getStatus(request: any): Promise<any>;


  // Lifecycle operations
  activateAgent(request: AgentIpc.ActivateRequest): Promise<AgentIpc.ActivateResponse>;
  lifecycleStart(request: any): Promise<any>;
  lifecycleStop(request: any): Promise<any>;

  // Messaging operations
  messagingSend(request: any): Promise<any>;
  messagingReceive(request: any): Promise<any>;

  // Model operations
  setModel(request: {
    agentId: string;
    modelId: string;
    workspaceId: string;
  }): Promise<{ success: boolean; modelId?: string; error?: string }>;

  // Message queue operations
  queueMessage(request: {
    agentId: string;
    content: string;
    workspaceId?: string;
    contextItems?: any[];
    imageBlocks?: Array<{ type: 'image'; data: string; mimeType: string }>;
  }): Promise<{ success: boolean; queuedMessage?: any; error?: string }>;
  editQueuedMessage(request: {
    agentId: string;
    messageId: string;
    content: string;
  }): Promise<{ success: boolean; error?: string }>;
  removeQueuedMessage(request: {
    agentId: string;
    messageId: string;
  }): Promise<{ success: boolean; error?: string }>;
  forceMessage(request: {
    agentId: string;
    messageId: string;
    content: string;
    workspaceId: string;
    imageBlocks?: any[];
    noteIds?: string[];
  }): Promise<{ success: boolean; error?: string }>;
  getQueue(request: {
    agentId: string;
  }): Promise<{ success: boolean; queue?: any[]; error?: string }>;

  // Backend streaming operations (for AGENT_BACKEND_CHANNELS)
  streamMessage(request: any): Promise<any>;
  backendStop(request: any): Promise<any>;

  // Context operations
  getContext(request: any): Promise<any>;
  updateContext(request: any): Promise<any>;
  getContextByWorkspace(request: any): Promise<any>;
  getContextBySession(request: any): Promise<any>;

  // Capabilities operations
  getCapabilities(request: any): Promise<any>;
  setCapabilities(request: any): Promise<any>;

  // Metrics and logging
  getMetrics(request: any): Promise<any>;
  resetMetrics(request: any): Promise<any>;
  getLogs(request: any): Promise<any>;
  clearLogs(request: any): Promise<any>;
}

// Note: createHandler function removed - all handlers now use createSafeValidatedHandler
// which properly uses the validation middleware with registered schemas

/**
 * Register ALL agent IPC handlers with type-safe contracts
 * This function registers handlers for ALL agent operations
 */
export function registerAgentHandlers(backend: IAgentBackendService): void {
  logger.info('Registering ALL unified agent IPC handlers');

  // Register all handler groups
  registerCoreHandlers(backend);
  registerSessionHandlers(backend);
  registerLifecycleHandlers(backend);
  registerMessagingHandlers(backend);
  registerRulesHandlers();
  registerContextHandlers(backend);
  registerCapabilitiesHandlers(backend);
  registerMetricsHandlers(backend);
  registerBackendChannelHandlers(backend);
  registerQueueHandlers(backend);

  logger.info('ALL unified agent IPC handlers registered successfully');
}

/**
 * Register core CRUD operation handlers
 */
function registerCoreHandlers(backend: IAgentBackendService): void {
  // Create agent - handles both flat and nested config formats
  // Also derives workspacePath and name when not provided
  ipcMain.handle(AGENT_CHANNELS.CREATE, async (_event, data: any) => {
    try {
      logger.info('[agent:create] Received data', {
        workspaceId: data.workspaceId,
        agentType: data.agentType,
        model: data.model,
        hasBehaviorPrompt: !!data.behaviorPrompt,
        behaviorPromptLength: data.behaviorPrompt?.length || 0,
        hasInstruction: !!data.instruction,
        instructionPreview: data.instruction?.substring?.(0, 100),
        hasInitialMessage: !!data.initialMessage,
        hasConfig: !!data.config,
        configKeys: data.config ? Object.keys(data.config) : [],
      });

      // Normalize the data - handle nested config format from frontend
      let normalizedData: any = { ...data };

      if (data.config) {
        // Frontend sends nested format with config object
        normalizedData = {
          workspaceId: data.workspaceId,
          workspacePath:
            data.config.workspacePath || data.config.workspaceRoot || data.workspacePath,
          name: data.name,
          agentId: data.agentId,
          model: data.config.model || data.model,
          provider: data.config.provider || data.provider, // Preserve provider for correct ACP provider selection
          agentType: data.config.agentType || data.agentType,
          behaviorPrompt: data.config.behaviorPrompt || data.behaviorPrompt, // Extract behaviorPrompt from config or top-level
          systemPrompt: data.config.systemPrompt || data.systemPrompt,
          initialMessage: data.initialMessage || data.instruction || data.config.initialMessage,
          skipInitialPrompt: true,
          contextReferences: data.contextReferences || data.contextRefs,
          imageBlocks: data.imageBlocks || data.config.imageBlocks,
          metadata: data.metadata,
          workspaceContext: data.config.workspaceContext || data.workspaceContext, // Open panels + linked references
        };
      } else {
        normalizedData.skipInitialPrompt = true;
        // No config object - map instruction to initialMessage if present
        if (data.instruction && !data.initialMessage) {
          normalizedData.initialMessage = data.instruction;
        }
        // Map contextRefs to contextReferences if present
        if (data.contextRefs && !data.contextReferences) {
          normalizedData.contextReferences = data.contextRefs;
        }
      }

      logger.info('[agent:create] Normalized data', {
        hasInitialMessage: !!normalizedData.initialMessage,
        initialMessagePreview: normalizedData.initialMessage?.substring?.(0, 100),
        agentType: normalizedData.agentType,
        hasBehaviorPrompt: !!normalizedData.behaviorPrompt,
        behaviorPromptLength: normalizedData.behaviorPrompt?.length || 0,
        openPanelsCount: normalizedData.workspaceContext?.openPanels?.length || 0,
        linkedReferencesCount: normalizedData.workspaceContext?.linkedReferences?.length || 0,
      });

      // Derive name from instruction/initialMessage if not provided
      const { generateAgentNameFromText, generateRandomAgentName } =
        await import('../../../lib/utils/agent-name-generator');
      if (!normalizedData.name && (normalizedData.initialMessage || data.instruction)) {
        normalizedData.name =
          generateAgentNameFromText(normalizedData.initialMessage || data.instruction) ||
          generateRandomAgentName();
      }

      // Default name if still not set
      if (!normalizedData.name) {
        normalizedData.name = generateRandomAgentName();
      }

      // Derive workspacePath from workspace if not provided
      if (!normalizedData.workspacePath && normalizedData.workspaceId) {
        const { workspaceService } = await import('../../workspace/main/workspace.service');
        const workspace = await workspaceService.getWorkspace(normalizedData.workspaceId);
        if (workspace?.ok && workspace.data) {
          normalizedData.workspacePath =
            workspace.data.worktreePath || workspace.data.repositoryPath || workspace.data.path;
        }
      }

      // Validate the normalized data
      const validated = AgentCreateSchema.parse(normalizedData);

      // Restore branded IDs from IPC
      const workspaceId = restoreWorkspaceId(validated.workspaceId as string);
      if (!workspaceId) {
        throw new Error('Invalid workspace ID');
      }

      // Ensure workspacePath is set (required by CreateRequest)
      if (!validated.workspacePath) {
        throw new Error('Workspace path is required');
      }

      const restoredRequest: AgentIpc.CreateRequest = {
        ...validated,
        workspaceId,
        workspacePath: validated.workspacePath,
        name: validated.name || generateRandomAgentName(),
        agentId: validated.agentId ? restoreAgentId(validated.agentId as string) : undefined,
        // When an initialMessage is provided, allow the backend to send it
        // immediately (fire-and-forget). The frontend handler may not be ready
        // yet, but the response is persisted to disk by handleSendMessage and
        // loaded when the chat panel opens later via initializeChatSaga.
        skipInitialPrompt: !validated.initialMessage?.trim(),
      };
      const response = await backend.createAgent(restoredRequest);
      return formatIpcSuccess(response);
    } catch (error) {
      logger.error('Failed to create agent', error);
      return formatIpcError(error);
    }
  });

  // Get agent
  ipcMain.handle(
    AGENT_CHANNELS.GET_SESSION,
    createSafeValidatedHandler(
      AgentGetSessionSchema,
      async (_event, validated) => {
        // AgentGetSessionSchema is just a string (agentId)
        const agentId = validated;
        const response = await backend.getAgent({ agentId, workspaceId: '' } as any);
        return formatIpcSuccess(response);
      },
      AGENT_CHANNELS.GET_SESSION,
    ),
  );

  // Send message
  ipcMain.handle(
    AGENT_CHANNELS.SEND_MESSAGE,
    createSafeValidatedHandler(
      AgentSendMessageSchema,
      async (_event, validated) => {
        // Convert branded types to plain strings for backend
        const request = {
          ...validated,
          agentId: String(validated.agentId),
        };
        const response = await backend.sendMessage(request as any);
        return formatIpcSuccess(response);
      },
      AGENT_CHANNELS.SEND_MESSAGE,
    ),
  );

  // List agents
  ipcMain.handle(
    AGENT_CHANNELS.LIST_SESSIONS,
    createSafeValidatedHandler(
      AgentListSessionsSchema,
      async (_event, validated) => {
        // AgentListSessionsSchema is just a string (workspaceId)
        const workspaceId = validated;
        const response = await backend.listAgents({ workspaceId, includeDeleted: false } as any);
        return formatIpcSuccess(response);
      },
      AGENT_CHANNELS.LIST_SESSIONS,
    ),
  );

  // Delete agent
  ipcMain.handle(
    AGENT_CHANNELS.DELETE_SESSION,
    createSafeValidatedHandler(
      AgentDeleteSessionSchema,
      async (_event, validated) => {
        // Handle both string and object formats
        const request =
          typeof validated === 'string' ? { agentId: validated, workspaceId: '' } : validated;
        const response = await backend.deleteAgent(request as any);
        return formatIpcSuccess(response);
      },
      AGENT_CHANNELS.DELETE_SESSION,
    ),
  );

  // Update session
  ipcMain.handle(
    AGENT_CHANNELS.UPDATE_SESSION,
    createSafeValidatedHandler(
      EmptySchema,
      async (_event, validated) => {
        const response = await backend.updateSession(validated);
        return formatIpcSuccess(response);
      },
      AGENT_CHANNELS.UPDATE_SESSION,
    ),
  );

  // Export session
  ipcMain.handle(
    AGENT_CHANNELS.EXPORT_SESSION,
    createSafeValidatedHandler(
      EmptySchema,
      async (_event, validated) => {
        const response = await backend.exportSession(validated);
        return formatIpcSuccess(response);
      },
      AGENT_CHANNELS.EXPORT_SESSION,
    ),
  );

  // Import session
  ipcMain.handle(
    AGENT_CHANNELS.IMPORT_SESSION,
    createSafeValidatedHandler(
      EmptySchema,
      async (_event, validated) => {
        const response = await backend.importSession(validated);
        return formatIpcSuccess(response);
      },
      AGENT_CHANNELS.IMPORT_SESSION,
    ),
  );

  // Get history
  ipcMain.handle(
    AGENT_CHANNELS.GET_HISTORY,
    createSafeValidatedHandler(
      EmptySchema,
      async (_event, validated) => {
        const response = await backend.getHistory(validated);
        return formatIpcSuccess(response);
      },
      AGENT_CHANNELS.GET_HISTORY,
    ),
  );

  // Update metadata
  ipcMain.handle(
    AGENT_CHANNELS.UPDATE_METADATA,
    createSafeValidatedHandler(
      EmptySchema,
      async (_event, validated) => {
        const response = await backend.updateMetadata(validated);
        return formatIpcSuccess(response);
      },
      AGENT_CHANNELS.UPDATE_METADATA,
    ),
  );

  // Rename — lightweight: patches only name fields in the session file,
  // invalidates the persistence cache, syncs the in-memory session, and
  // broadcasts `agent:renamed` to all windows. Avoids the full saveSession
  // round-trip that was causing multi-minute UI delays.
  ipcMain.handle(
    AGENT_CHANNELS.RENAME,
    createSafeValidatedHandler(
      AgentRenameSchema,
      async (_event, validated) => {
        const { renameAgentOnDisk } = await import('./agent-rename');
        const response = await renameAgentOnDisk({
          workspaceId: validated.workspaceId,
          agentId: validated.agentId,
          name: validated.name,
        });
        return formatIpcSuccess(response);
      },
      AGENT_CHANNELS.RENAME,
    ),
  );

  // Fork session
  ipcMain.handle(
    AGENT_CHANNELS.FORK_SESSION,
    createSafeValidatedHandler(
      EmptySchema,
      async (_event, validated) => {
        const response = await backend.forkSession(validated);
        return formatIpcSuccess(response);
      },
      AGENT_CHANNELS.FORK_SESSION,
    ),
  );

  // Merge sessions
  ipcMain.handle(
    AGENT_CHANNELS.MERGE_SESSIONS,
    createSafeValidatedHandler(
      EmptySchema,
      async (_event, validated) => {
        const response = await backend.mergeSession(validated);
        return formatIpcSuccess(response);
      },
      AGENT_CHANNELS.MERGE_SESSIONS,
    ),
  );

  // Get stats
  ipcMain.handle(
    AGENT_CHANNELS.GET_STATS,
    createSafeValidatedHandler(
      EmptySchema,
      async (_event, validated) => {
        const response = await backend.getStats(validated);
        return formatIpcSuccess(response);
      },
      AGENT_CHANNELS.GET_STATS,
    ),
  );

  // Validate session
  ipcMain.handle(
    AGENT_CHANNELS.VALIDATE_SESSION,
    createSafeValidatedHandler(
      EmptySchema,
      async (_event, validated) => {
        const response = await backend.validateSession(validated);
        return formatIpcSuccess(response);
      },
      AGENT_CHANNELS.VALIDATE_SESSION,
    ),
  );

  // Repair session
  ipcMain.handle(
    AGENT_CHANNELS.REPAIR_SESSION,
    createSafeValidatedHandler(
      EmptySchema,
      async (_event, validated) => {
        const response = await backend.repairSession(validated);
        return formatIpcSuccess(response);
      },
      AGENT_CHANNELS.REPAIR_SESSION,
    ),
  );

  // Load initial agent config - used when workspace opens to check for pending agent creation
  ipcMain.handle(AGENT_CHANNELS.LOAD_INITIAL_CONFIG, async (_event, { workspaceId }) => {
    try {
      if (!workspaceId) {
        return { success: false, error: 'Workspace ID is required' };
      }

      const path = await import('path');
      // Use IMetadataFS for remote workspace support
      const { getMetadataFS } = await import('../../metadata-fs/main/metadata-fs-factory');
      const metadataFS = getMetadataFS(workspaceId);

      const agentConfigDir = WorkspaceConfig.paths.agents(workspaceId);

      // Check if directory exists and look for config files
      try {
        const entries = await metadataFS.readdir(agentConfigDir, { withFileTypes: true });
        // Look for any config file ending with -config.json
        const configEntry = entries.find((e) => e.isFile() && e.name.endsWith('-config.json'));

        if (configEntry) {
          const configPath = path.join(agentConfigDir, configEntry.name);
          const configData = await metadataFS.readFile(configPath, 'utf-8');
          const config = JSON.parse(configData);

          logger.info('Loaded initial agent config', {
            workspaceId,
            agentId: config.agentId,
            hasPrompt: !!config.prompt,
          });

          return { success: true, data: config };
        }
      } catch {
        // Directory doesn't exist or no config files - this is normal
        logger.debug('No initial agent config found', { workspaceId });
      }

      return { success: false, error: 'No initial agent config found' };
    } catch (error) {
      logger.error('Failed to load initial agent config', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load config',
      };
    }
  });
}

/**
 * Register session management handlers
 */
function registerSessionHandlers(backend: IAgentBackendService): void {
  // Stop session
  ipcMain.handle(
    AGENT_CHANNELS.STOP,
    createSafeValidatedHandler(
      AgentBackendStopSchema,
      async (_event, validated) => {
        // Handle both string and object formats
        const request =
          typeof validated === 'string'
            ? { agentId: validated }
            : { agentId: String(validated.agentId) };
        const response = await backend.stopSession(request as any);
        return formatIpcSuccess(response);
      },
      AGENT_CHANNELS.STOP,
    ),
  );

  // Clear session
  ipcMain.handle(
    AGENT_CHANNELS.CLEAR,
    createSafeValidatedHandler(
      EmptySchema,
      async (_event, validated) => {
        const response = await backend.clearSession(validated);
        return formatIpcSuccess(response);
      },
      AGENT_CHANNELS.CLEAR,
    ),
  );

  // Pause session
  ipcMain.handle(
    AGENT_CHANNELS.PAUSE,
    createSafeValidatedHandler(
      EmptySchema,
      async (_event, validated) => {
        const response = await backend.pauseSession(validated);
        return formatIpcSuccess(response);
      },
      AGENT_CHANNELS.PAUSE,
    ),
  );

  // Get status
  ipcMain.handle(
    AGENT_CHANNELS.GET_STATUS,
    createSafeValidatedHandler(
      EmptySchema,
      async (_event, validated) => {
        const response = await backend.getStatus(validated);
        return formatIpcSuccess(response);
      },
      AGENT_CHANNELS.GET_STATUS,
    ),
  );
}

/**
 * Register lifecycle handlers
 */
function registerLifecycleHandlers(backend: IAgentBackendService): void {
  // Activate agent
  ipcMain.handle(
    AGENT_CHANNELS.ACTIVATE,
    createSafeValidatedHandler(
      AgentActivateSchema,
      async (_event, validated) => {
        // Convert to branded type
        const request = {
          agentId: String(validated.agentId),
          workspaceId: validated.workspaceId ? String(validated.workspaceId) : undefined,
          sessionId: validated.sessionId ? String(validated.sessionId) : undefined,
        };
        const response = await backend.activateAgent(request as any);
        return formatIpcSuccess(response);
      },
      AGENT_CHANNELS.ACTIVATE,
    ),
  );

  // Lifecycle start
  ipcMain.handle(
    AGENT_CHANNELS.LIFECYCLE_START,
    createSafeValidatedHandler(
      AgentLifecycleStartSchema,
      async (_event, validated) => {
        const response = await backend.lifecycleStart(validated);
        return formatIpcSuccess(response);
      },
      AGENT_CHANNELS.LIFECYCLE_START,
    ),
  );

  // Lifecycle stop
  ipcMain.handle(
    AGENT_CHANNELS.LIFECYCLE_STOP,
    createSafeValidatedHandler(
      AgentLifecycleStopSchema,
      async (_event, validated) => {
        const response = await backend.lifecycleStop(validated);
        return formatIpcSuccess(response);
      },
      AGENT_CHANNELS.LIFECYCLE_STOP,
    ),
  );
}

/**
 * Register messaging handlers
 */
function registerMessagingHandlers(backend: IAgentBackendService): void {
  // Messaging send
  ipcMain.handle(
    AGENT_CHANNELS.MESSAGING_SEND,
    createSafeValidatedHandler(
      AgentMessagingSendSchema,
      async (_event, validated) => {
        const response = await backend.messagingSend(validated);
        return formatIpcSuccess(response);
      },
      AGENT_CHANNELS.MESSAGING_SEND,
    ),
  );

  // Messaging receive
  ipcMain.handle(
    AGENT_CHANNELS.MESSAGING_RECEIVE,
    createSafeValidatedHandler(
      AgentMessagingReceiveSchema,
      async (_event, validated) => {
        const response = await backend.messagingReceive(validated);
        return formatIpcSuccess(response);
      },
      AGENT_CHANNELS.MESSAGING_RECEIVE,
    ),
  );

  // Set agent model
  ipcMain.handle(
    AGENT_CHANNELS.SET_MODEL,
    createSafeValidatedHandler(
      AgentSetModelSchema,
      async (_event, validated) => {
        const response = await backend.setModel(validated);
        return formatIpcSuccess(response);
      },
      AGENT_CHANNELS.SET_MODEL,
    ),
  );
}

/**
 * Register rules handlers
 */
function registerRulesHandlers(): void {
  // Get user rules from .augment/rules/user.md
  // Note: This handler is not currently used. User rules are loaded via EndUserRulesManager
  // (electron-store) in the 3-tier fallback system. The commented code below is preserved
  // in case a getUserRules() IPC handler is needed in the future.
  // ipcMain.handle(
  //   AGENT_CHANNELS.GET_USER_RULES,
  //   createSafeValidatedHandler(
  //     AgentGetUserRulesSchema,
  //     async (_event, validated) => {
  //       try {
  //         // Use InstructionService to load user rules
  //         const { InstructionService } = await import('../../agent/services/instruction-service');
  //         const instructionService = InstructionService.getInstance();
  //
  //         const userRules = await instructionService.getUserRules(validated.workspacePath);
  //
  //         if (userRules) {
  //           logger.info('Loaded user rules from .augment/rules/user.md', {
  //             workspacePath: validated.workspacePath,
  //             contentLength: userRules.length,
  //           });
  //           return formatIpcSuccess({ data: userRules });
  //         } else {
  //           logger.debug('No user rules found', {
  //             workspacePath: validated.workspacePath,
  //           });
  //           return formatIpcSuccess({ data: '' });
  //         }
  //       } catch (error) {
  //         logger.error('Failed to get user rules', error as Error);
  //         return formatIpcError((error as Error).message || 'Failed to get user rules');
  //       }
  //     },
  //     AGENT_CHANNELS.GET_USER_RULES,
  //   ),
  // );

  // Get specialization rules with 3-tier fallback
  ipcMain.handle(
    AGENT_CHANNELS.GET_SPECIALIZATION_RULES,
    createSafeValidatedHandler(
      AgentGetSpecializationRulesSchema,
      async (_event, validated) => {
        try {
          // Use InstructionService to load specialization rules
          const { InstructionService } = await import('./instruction-service');
          const instructionService = InstructionService.getInstance();

          const rules = await instructionService.getSpecializationRules(
            validated.agentType,
            validated.workspacePath,
          );

          if (rules) {
            logger.info('Loaded specialization rules via InstructionService', {
              agentType: validated.agentType,
              workspacePath: validated.workspacePath,
              contentLength: rules.length,
            });
            return formatIpcSuccess({ success: true, rules });
          } else {
            logger.debug('No specialization rules found', {
              agentType: validated.agentType,
              workspacePath: validated.workspacePath,
            });
            return formatIpcSuccess({ success: true, rules: null });
          }
        } catch (error) {
          logger.error('Failed to get specialization rules', error as Error);
          return formatIpcError((error as Error).message || 'Failed to get specialization rules');
        }
      },
      AGENT_CHANNELS.GET_SPECIALIZATION_RULES,
    ),
  );
}

/**
 * Register context handlers
 */
function registerContextHandlers(backend: IAgentBackendService): void {
  // Get context
  ipcMain.handle(
    AGENT_CHANNELS.GET_CONTEXT,
    createSafeValidatedHandler(
      EmptySchema,
      async (_event, validated) => {
        const response = await backend.getContext(validated);
        return formatIpcSuccess(response);
      },
      AGENT_CHANNELS.GET_CONTEXT,
    ),
  );

  // Update context
  ipcMain.handle(
    AGENT_CHANNELS.UPDATE_CONTEXT,
    createSafeValidatedHandler(
      AgentContextUpdateSchema,
      async (_event, validated) => {
        const response = await backend.updateContext(validated);
        return formatIpcSuccess(response);
      },
      AGENT_CHANNELS.UPDATE_CONTEXT,
    ),
  );

  // Get context by workspace
  ipcMain.handle(
    AGENT_CHANNELS.CONTEXT_GET_BY_WORKSPACE,
    createSafeValidatedHandler(
      AgentContextGetByWorkspaceSchema,
      async (_event, validated) => {
        // AgentContextGetByWorkspaceSchema is just a string (workspaceId)
        const workspaceId = validated;
        const response = await backend.getContextByWorkspace({ workspaceId } as any);
        return formatIpcSuccess(response);
      },
      AGENT_CHANNELS.CONTEXT_GET_BY_WORKSPACE,
    ),
  );

  // Get context by session
  ipcMain.handle(
    AGENT_CHANNELS.CONTEXT_GET_BY_SESSION,
    createSafeValidatedHandler(
      AgentContextGetBySessionSchema,
      async (_event, validated) => {
        // AgentContextGetBySessionSchema is just a string (sessionId)
        const sessionId = validated;
        const response = await backend.getContextBySession({ sessionId } as any);
        return formatIpcSuccess(response);
      },
      AGENT_CHANNELS.CONTEXT_GET_BY_SESSION,
    ),
  );
}

/**
 * Register capabilities handlers
 */
function registerCapabilitiesHandlers(backend: IAgentBackendService): void {
  // Get capabilities
  ipcMain.handle(
    AGENT_CHANNELS.GET_CAPABILITIES,
    createSafeValidatedHandler(
      EmptySchema,
      async (_event, validated) => {
        const response = await backend.getCapabilities(validated);
        return formatIpcSuccess(response);
      },
      AGENT_CHANNELS.GET_CAPABILITIES,
    ),
  );

  // Set capabilities
  ipcMain.handle(
    AGENT_CHANNELS.SET_CAPABILITIES,
    createSafeValidatedHandler(
      EmptySchema,
      async (_event, validated) => {
        const response = await backend.setCapabilities(validated);
        return formatIpcSuccess(response);
      },
      AGENT_CHANNELS.SET_CAPABILITIES,
    ),
  );
}

/**
 * Register metrics and logging handlers
 */
function registerMetricsHandlers(backend: IAgentBackendService): void {
  // Get metrics
  ipcMain.handle(
    AGENT_CHANNELS.GET_METRICS,
    createSafeValidatedHandler(
      EmptySchema,
      async (_event, validated) => {
        const response = await backend.getMetrics(validated);
        return formatIpcSuccess(response);
      },
      AGENT_CHANNELS.GET_METRICS,
    ),
  );

  // Reset metrics
  ipcMain.handle(
    AGENT_CHANNELS.RESET_METRICS,
    createSafeValidatedHandler(
      EmptySchema,
      async (_event, validated) => {
        const response = await backend.resetMetrics(validated);
        return formatIpcSuccess(response);
      },
      AGENT_CHANNELS.RESET_METRICS,
    ),
  );

  // Get logs
  ipcMain.handle(
    AGENT_CHANNELS.GET_LOGS,
    createSafeValidatedHandler(
      EmptySchema,
      async (_event, validated) => {
        const response = await backend.getLogs(validated);
        return formatIpcSuccess(response);
      },
      AGENT_CHANNELS.GET_LOGS,
    ),
  );

  // Clear logs
  ipcMain.handle(
    AGENT_CHANNELS.CLEAR_LOGS,
    createSafeValidatedHandler(
      EmptySchema,
      async (_event, validated) => {
        const response = await backend.clearLogs(validated);
        return formatIpcSuccess(response);
      },
      AGENT_CHANNELS.CLEAR_LOGS,
    ),
  );
}

/**
 * Register backend channel handlers (AGENT_BACKEND_CHANNELS)
 * These are used by the frontend for streaming operations
 */
function registerBackendChannelHandlers(backend: IAgentBackendService): void {
  // Stream message handler
  ipcMain.handle(
    AGENT_BACKEND_CHANNELS.STREAM_MESSAGE,
    createSafeValidatedHandler(
      AgentBackendStreamMessageSchema,
      async (event, validated: any) => {
        // Extract the window ID from the sender to target stream responses
        // This prevents "crossed streams" where messages go to the wrong window
        // When called from the HTTP bridge (browser mode), event.sender is synthetic
        // and BrowserWindow.fromWebContents would throw, so we skip it.
        let senderWindowId: number | undefined;
        if (!(event as any).__isBrowserBridge) {
          try {
            senderWindowId = BrowserWindow.fromWebContents(event.sender)?.id;
          } catch {
            // Synthetic sender from HTTP bridge — no window ID needed
          }
        }
        const requestWithWindowId = {
          ...validated,
          _senderWindowId: senderWindowId,
        };
        const response = await backend.streamMessage(requestWithWindowId as any);
        return formatIpcSuccess(response);
      },
      AGENT_BACKEND_CHANNELS.STREAM_MESSAGE,
    ),
  );

  // Backend stop handler
  ipcMain.handle(
    AGENT_BACKEND_CHANNELS.STOP,
    createSafeValidatedHandler(
      AgentBackendStopSchema,
      async (_event, validated) => {
        // Handle both string and object formats
        const agentId = typeof validated === 'string' ? validated : validated.agentId;
        const response = await backend.backendStop({ agentId });
        return formatIpcSuccess(response);
      },
      AGENT_BACKEND_CHANNELS.STOP,
    ),
  );
}

/**
 * Register message queue handlers
 */
function registerQueueHandlers(backend: IAgentBackendService): void {
  // Queue a message
  ipcMain.handle(
    AGENT_BACKEND_CHANNELS.QUEUE_MESSAGE,
    createSafeValidatedHandler(
      AgentQueueMessageSchema,
      async (_event, validated) => {
        const response = await backend.queueMessage(validated);
        return formatIpcSuccess(response);
      },
      AGENT_BACKEND_CHANNELS.QUEUE_MESSAGE,
    ),
  );

  // Edit a queued message
  ipcMain.handle(
    AGENT_BACKEND_CHANNELS.EDIT_QUEUED,
    createSafeValidatedHandler(
      AgentEditQueuedMessageSchema,
      async (_event, validated) => {
        const response = await backend.editQueuedMessage(validated);
        return formatIpcSuccess(response);
      },
      AGENT_BACKEND_CHANNELS.EDIT_QUEUED,
    ),
  );

  // Remove a queued message
  ipcMain.handle(
    AGENT_BACKEND_CHANNELS.REMOVE_QUEUED,
    createSafeValidatedHandler(
      AgentRemoveQueuedMessageSchema,
      async (_event, validated) => {
        const response = await backend.removeQueuedMessage(validated);
        return formatIpcSuccess(response);
      },
      AGENT_BACKEND_CHANNELS.REMOVE_QUEUED,
    ),
  );

  // Force-send a queued message (stop + remove + send atomically)
  ipcMain.handle(
    AGENT_BACKEND_CHANNELS.FORCE_MESSAGE,
    createSafeValidatedHandler(
      AgentForceMessageSchema,
      async (_event, validated) => {
        const response = await backend.forceMessage(validated as any);
        return formatIpcSuccess(response);
      },
      AGENT_BACKEND_CHANNELS.FORCE_MESSAGE,
    ),
  );

  // Get the queue
  ipcMain.handle(
    AGENT_BACKEND_CHANNELS.GET_QUEUE,
    createSafeValidatedHandler(
      AgentGetQueueSchema,
      async (_event, validated) => {
        const response = await backend.getQueue(validated);
        logger.debug('[GET_QUEUE] Backend response:', JSON.stringify(response));
        const wrapped = formatIpcSuccess(response);
        logger.debug('[GET_QUEUE] Wrapped response:', JSON.stringify(wrapped));
        return wrapped;
      },
      AGENT_BACKEND_CHANNELS.GET_QUEUE,
    ),
  );
}
