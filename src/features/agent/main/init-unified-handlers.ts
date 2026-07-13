/**
 * Initialize Unified Agent Handlers
 *
 * Sets up all agent IPC handlers with type-safe contracts.
 * Call this once during application startup in the main process.
 *
 * Usage:
 *   import { initializeUnifiedAgentHandlers } from './init-unified-handlers';
 *   initializeUnifiedAgentHandlers();
 */

import { registerAgentHandlers } from './unified-agent-handlers';
import { getAgentBackendAdapter } from './agent-backend-adapter';
import { Logger } from '$shared/logger';
import { registerValidationSchema } from '../../../main/ipc-validation-middleware';
import {
  AGENT_CHANNELS,
  AGENT_BACKEND_CHANNELS,
} from '$shared/ipc/channels';
import {
  AgentCreateSchema,
  AgentGetSessionSchema,
  AgentSendMessageSchema,
  AgentListSessionsSchema,
  AgentDeleteSessionSchema,
  AgentBackendStreamMessageSchema,
  AgentBackendStopSchema,
  EmptySchema,
} from '../../../main/ipc-schemas';

const logger = new Logger('InitUnifiedHandlers');

/**
 * Register validation schemas for all agent channels
 */
function registerAgentValidationSchemas(): void {
  logger.info('Registering agent validation schemas');

  // Core agent channels
  registerValidationSchema(AGENT_CHANNELS.CREATE, AgentCreateSchema);
  registerValidationSchema(AGENT_CHANNELS.GET_SESSION, AgentGetSessionSchema);
  registerValidationSchema(AGENT_CHANNELS.SEND_MESSAGE, AgentSendMessageSchema);
  registerValidationSchema(AGENT_CHANNELS.LIST_SESSIONS, AgentListSessionsSchema);
  registerValidationSchema(AGENT_CHANNELS.DELETE_SESSION, AgentDeleteSessionSchema);

  registerValidationSchema(AGENT_CHANNELS.STOP, EmptySchema);

  // Backend channels for streaming operations
  registerValidationSchema(AGENT_BACKEND_CHANNELS.STREAM_MESSAGE, AgentBackendStreamMessageSchema);
  registerValidationSchema(AGENT_BACKEND_CHANNELS.STOP, AgentBackendStopSchema);
  registerValidationSchema(AGENT_BACKEND_CHANNELS.GET_STATUS, EmptySchema);
  registerValidationSchema(AGENT_BACKEND_CHANNELS.CANCEL_STREAM, EmptySchema);

  logger.info('Agent validation schemas registered successfully');
}

/**
 * Initialize all unified agent IPC handlers
 * Should be called once during app startup
 */
export function initializeUnifiedAgentHandlers(): void {
  try {
    logger.info('Initializing unified agent IPC handlers');

    // Register validation schemas first
    registerAgentValidationSchemas();

    // Get the backend service (adapter for existing implementation)
    const backend = getAgentBackendAdapter();

    // Register all handlers
    registerAgentHandlers(backend);

    logger.info('Unified agent IPC handlers initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize unified agent handlers', error as Error);
    throw error;
  }
}

/**
 * Alternative: Initialize with custom backend service
 */
export function initializeUnifiedAgentHandlersWithBackend(backend: any): void {
  try {
    logger.info('Initializing unified agent IPC handlers with custom backend');

    // Register validation schemas first
    registerAgentValidationSchemas();

    registerAgentHandlers(backend);

    logger.info('Unified agent IPC handlers initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize unified agent handlers', error as Error);
    throw error;
  }
}
