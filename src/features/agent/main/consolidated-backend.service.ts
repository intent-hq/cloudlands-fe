/**
 * Consolidated Backend Service
 *
 * Single source of truth for all agent operations.
 * Handles:
 * - Frontend coordination
 * - Backend service operations
 * - Session management
 * - IPC bridge
 *
 * Features:
 * - Unified session management
 * - Integrated streaming pipeline
 * - Built-in health monitoring
 * - Memory leak prevention
 * - Concurrent agent support (30+)
 * - Automatic error recovery
 * - User rules always loaded via agent-factory
 * - IPC handler setup for Electron
 * - Persistence support
 */

import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from '$shared/utils/event-emitter';
import { createAppMessageId } from '$shared/utils/app-message-id';
import { unifiedIdService } from '$shared/services/unified-id.service';
import { Logger } from '$shared/logger';
import type { Workspace, AgentSession } from '$shared/types';
import { AgentStatus } from '$shared/types';
import type { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import {
  createAgentId,
  createSessionId,
  createWorkspaceId,
  createMessageId,
} from '$shared/types/branded-ids';
import { type UnifiedAgentConfig } from '$shared/types/agent.types';
import { StreamManager } from '../services/stream-manager';
import { agentValidator } from '../services/agent-validator';
import { errorHandler } from '../services/error-handler';
import {
  AGENT_BACKEND_CHANNELS,
  PERSISTENCE_CHANNELS,
} from '$shared/ipc/channels';
import { memoryManager } from '../services/memory-manager';
import type { IDisposable } from '$shared/types/disposable';
import { DEFAULT_AGENT_MODEL } from '$shared/constants/agent-services';

// Node.js modules for backend operations
let ipcMain: any;
let BrowserWindow: any;
let fs: typeof import('fs/promises') | undefined;
let path: typeof import('path') | undefined;
let WorkspaceConfig: typeof import('$shared/main/config').WorkspaceConfig | undefined;

// Lazy-loaded invoke function for frontend context
let invokeFunction: (typeof import('$lib/electron-bridge'))['invoke'] | undefined;
let agentPersistence: any;
let metadataFSFactory: ((workspaceId: string) => import('../../metadata-fs/main/metadata-fs').IMetadataFS) | undefined;



// Check if we're in the main process
function isMainProcess(): boolean {
  return typeof window === 'undefined' && typeof process !== 'undefined';
}

// Get invoke function lazily (only in frontend context)
async function getInvoke(): Promise<(typeof import('$lib/electron-bridge'))['invoke']> {
  if (!invokeFunction) {
    const module = await import('$lib/electron-bridge');
    invokeFunction = module.invoke;
  }
  return invokeFunction;
}



// Lazy load Node.js modules when needed
async function getNodeModules() {
  if (typeof window === 'undefined' && !fs && !path) {
    fs = await import('fs/promises');
    path = await import('path');

    // Load WorkspaceConfig
    try {
      const configModule = await import('$shared/main/config');
      WorkspaceConfig = configModule.WorkspaceConfig;
    } catch (error) {
      logger.warn('Could not load WorkspaceConfig module', error);
    }

    // Load Electron modules if available
    try {
      const electron = await import('electron');
      ipcMain = electron.ipcMain;
      BrowserWindow = electron.BrowserWindow;
    } catch {
      // Electron may not be available in all contexts
    }

    // Load agent persistence if in main process
    try {
      const persistenceModule = await import('../main/agent-persistence');
      agentPersistence = persistenceModule.agentPersistence;
      // Wire up IMetadataFS resolver for remote workspace support
      const { getMetadataFS } = await import('../../metadata-fs/main/metadata-fs-factory');
      metadataFSFactory = getMetadataFS;
      persistenceModule.unifiedPersistence.setMetadataFSResolver(getMetadataFS);
    } catch (error) {
      logger.warn('Could not load agent persistence module', error);
    }
  }
  return { fs, path, ipcMain, BrowserWindow, agentPersistence, WorkspaceConfig, metadataFSFactory };
}

const logger = new Logger('ConsolidatedBackend');

// Health monitoring types
export interface HealthMetrics {
  healthy: boolean;
  uptime: number;
  memoryUsage: NodeJS.MemoryUsage;
  activeSessions: number;
  totalMessages: number;
  errorRate: number;
  responseTime: number;
  lastCheck: Date;
}

export interface BackendConfig {
  maxConcurrentAgents: number;
  memoryLimit: number; // in MB
  healthCheckInterval: number; // in ms
  persistenceEnabled: boolean;
  streamingBufferSize: number;
  errorRecoveryEnabled: boolean;
}

// Unified session record with provider support
interface UnifiedSessionRecord {
  agentId: AgentId;
  sessionId: AgentId;
  workspaceId: WorkspaceId;
  session: AgentSession;
  streamBuffer: string[];
  messageCount: number;
  lastActivity: Date;
  errors: Error[];
  provider?: any; // BaseAgentProvider when available
}

/**
 * Consolidated backend service - single source of truth for agent operations.
 * Manages agent sessions, streaming, health monitoring, and persistence.
 * Implements singleton pattern with automatic cleanup and error recovery.
 *
 * @class ConsolidatedBackendService
 * @extends EventEmitter
 * @implements IDisposable
 * @example
 * ```typescript
 * const backend = ConsolidatedBackendService.getInstance();
 *
 * // Create an agent
 * const agentId = await backend.createAgent({
 *   workspaceId: 'workspace-123',
 *   config: { model: 'gpt-4' }
 * });
 *
 * // Send a message
 * await backend.sendMessage({
 *   agentId,
 *   content: 'Hello, agent!'
 * });
 *
 * // Get health metrics
 * const health = await backend.getHealth();
 * ```
 */
export class ConsolidatedBackendService extends EventEmitter implements IDisposable {
  /** @property {ConsolidatedBackendService} instance - Singleton instance */
  private static instance?: ConsolidatedBackendService;
  /** @property {Map<AgentId, UnifiedSessionRecord>} sessions - Active agent sessions */
  private sessions: Map<AgentId, UnifiedSessionRecord> = new Map();
  /** @property {StreamManager} streaming - Stream manager for handling message streaming */
  private streaming: StreamManager;
  /** @property {BackendConfig} config - Backend configuration */
  private config: BackendConfig;
  /** @property {NodeJS.Timeout} healthTimer - Timer for health monitoring */
  private healthTimer?: NodeJS.Timeout;
  /** @property {HealthMetrics} metrics - Current health metrics */
  private metrics: HealthMetrics;
  /** @property {Date} startTime - Service start time */
  private startTime: Date;
  /** @property {boolean} disposed - Whether the service has been disposed */
  private disposed = false;
  /** @property {number} totalMessageCount - Total messages processed */
  private totalMessageCount: number = 0;
  /** @property {number} errorCount - Total errors encountered */
  private errorCount: number = 0;
  /** @property {boolean} isShuttingDown - Whether service is shutting down */
  private isShuttingDown: boolean = false;
  /** @property {number[]} responseTimes - Track last N response times for averaging */
  private responseTimes: number[] = [];
  /** @property {number} MAX_RESPONSE_TIME_SAMPLES - Maximum number of response time samples to keep */
  private readonly MAX_RESPONSE_TIME_SAMPLES = 100;
  /** @property {number} lastMemoryWarningTime - Last time memory warning was logged */
  private lastMemoryWarningTime = 0;
  /** @property {number} MEMORY_WARNING_INTERVAL - Minimum interval between memory warnings */
  private readonly MEMORY_WARNING_INTERVAL = 60000; // 1 minute
  /** @property {Function} sigintHandler - Stored SIGINT handler for cleanup */
  private sigintHandler?: () => void;
  /** @property {Function} sigtermHandler - Stored SIGTERM handler for cleanup */
  private sigtermHandler?: () => void;

  /**
   * Private constructor for singleton pattern.
   * Initializes configuration, streaming, and health monitoring.
   *
   * @private
   * @param {Partial<BackendConfig>} config - Optional configuration overrides
   */
  private constructor(config: Partial<BackendConfig> = {}) {
    super();
    this.config = {
      maxConcurrentAgents: 30,
      memoryLimit: 2048, // 2GB
      healthCheckInterval: 30000, // 30 seconds
      persistenceEnabled: true,
      streamingBufferSize: 1000,
      errorRecoveryEnabled: true,
      ...config,
    };

    this.streaming = StreamManager.getInstance();
    this.startTime = new Date();
    this.metrics = this.createInitialMetrics();

    // Start health monitoring
    if (this.config.healthCheckInterval > 0) {
      this.startHealthMonitoring();
    }

    // Setup cleanup on shutdown
    this.setupShutdownHandlers();
  }

  /**
   * Gets the singleton instance of ConsolidatedBackendService.
   * Creates a new instance if one doesn't exist.
   *
   * @static
   * @param {Partial<BackendConfig>} [config] - Optional configuration for first initialization
   * @returns {ConsolidatedBackendService} The singleton instance
   * @example
   * ```typescript
   * const backend = ConsolidatedBackendService.getInstance({
   *   maxConcurrentAgents: 100,
   *   memoryLimit: 4096
   * });
   * ```
   */
  static getInstance(config?: Partial<BackendConfig>): ConsolidatedBackendService {
    if (!ConsolidatedBackendService.instance) {
      ConsolidatedBackendService.instance = new ConsolidatedBackendService(config);
    }
    return ConsolidatedBackendService.instance;
  }

  /**
   * Get an agent session
   */
  async getAgent(agentId: string): Promise<AgentSession | null> {
    try {
      const id = createAgentId(agentId);
      const record = this.sessions.get(id);
      return record?.session || null;
    } catch (error) {
      logger.error('[getAgent] Error getting agent', error);
      return null;
    }
  }

  /**
   * Resume an existing agent session
   * This restores an agent with its messages to memory and reconnects with the backend
   */
  async resumeSession(
    agentSession: AgentSession,
  ): Promise<{ success: boolean; agent?: AgentSession; error?: string }> {
    try {
      const agentId = createAgentId(agentSession.id);
      const workspaceId = createWorkspaceId(agentSession.workspaceId);

      logger.info('Resuming agent session', {
        agentId,
        workspaceId,
        messageCount: agentSession.messages?.length || 0,
        hasBackendSessionId: !!agentSession.backendSessionId,
      });

      // Check if already in memory
      if (this.sessions.has(agentId)) {
        const existingRecord = this.sessions.get(agentId)!;
        const existingMessages = existingRecord.session.messages || [];
        const incomingMessages = agentSession.messages || [];

        // If the incoming session has more messages (e.g., frontend saved a user message
        // to disk that the backend doesn't have yet), update the in-memory session's messages.
        // This fixes the coordinator agent bug where:
        // 1. handleCreateAgent creates session with empty messages (no initialMessage for coordinator)
        // 2. Frontend adds user message to Redux and saves to disk
        // 3. handleSendMessage loads from persistence (has user message) and calls resumeSession
        // 4. resumeSession was returning early with the stale empty-messages session
        // 5. skipUserMessage=true prevented re-adding, so backend session never got the user message
        // 6. onComplete saved backend session (missing user message) → overwrote frontend's save
        if (incomingMessages.length > existingMessages.length) {
          existingRecord.session.messages = [...incomingMessages];
          existingRecord.messageCount = incomingMessages.length;
          existingRecord.lastActivity = new Date();
          existingRecord.session.updatedAt = new Date().toISOString();
          logger.info('Updated in-memory session with newer messages from persistence', {
            agentId,
            previousMessageCount: existingMessages.length,
            newMessageCount: incomingMessages.length,
          });
        }

        logger.info('Agent already in memory', { agentId });
        return {
          success: true,
          agent: existingRecord.session,
        };
      }

      // If the agent has messages, we need to recreate the backend session with those messages
      // This ensures the AI has the full conversation context
      if (agentSession.messages && agentSession.messages.length > 0) {
        logger.info('Recreating backend session with existing messages', {
          agentId,
          messageCount: agentSession.messages.length,
        });

        // Create a new backend session with the existing messages
        // This is done by calling the backend's create method with the messages parameter
        // Note: sessionId is typed as AgentId in the codebase (not SessionId), so we use generateAgentId()
        const sessionId = createSessionId(unifiedIdService.generateAgentId());

        // Create the session with the full conversation history
        const agent: AgentSession = {
          ...agentSession,
          backendSessionId: sessionId,
          status: AgentStatus.Active,
          updatedAt: new Date().toISOString(),
        };

        // Create session record
        const record: UnifiedSessionRecord = {
          agentId,
          sessionId,
          workspaceId,
          session: agent,
          streamBuffer: [],
          messageCount: agent.messages?.length || 0,
          lastActivity: new Date(),
          errors: [],
        };

        // Store in memory
        this.sessions.set(agentId, record);

        // The backend will be properly initialized when the first message is sent
        // with the full conversation context
        logger.info('Agent session resumed with new backend session', {
          agentId,
          sessionId: record.sessionId,
          messageCount: record.messageCount,
        });

        return { success: true, agent };
      } else {
        // No messages, just store in memory as-is
        const record: UnifiedSessionRecord = {
          agentId,
          sessionId: agentSession.backendSessionId || agentId,
          workspaceId,
          session: agentSession,
          streamBuffer: [],
          messageCount: 0,
          lastActivity: new Date(),
          errors: [],
        };

        // Store in memory
        this.sessions.set(agentId, record);

        logger.info('Agent session resumed (no messages)', {
          agentId,
          sessionId: record.sessionId,
        });

        return { success: true, agent: agentSession };
      }
    } catch (error) {
      logger.error('Failed to resume session', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to resume session',
      };
    }
  }

  /**
   * List all active agents for a workspace
   */
  async listAgents(workspaceId: string): Promise<AgentSession[]> {
    try {
      const wsId = createWorkspaceId(workspaceId);
      const agents: AgentSession[] = [];

      for (const record of this.sessions.values()) {
        if (record.workspaceId === wsId) {
          agents.push(record.session);
        }
      }

      return agents;
    } catch (error) {
      logger.error('[listAgents] Error listing agents', error);
      return [];
    }
  }

  /**
   * Stop an agent's execution (interrupt streaming)
   */
  async backendStop(params: {
    agentId: string;
    killProcess?: boolean;
    _stopTrigger?: string;
    _stopReason?: string;
  }): Promise<{ success: boolean; error?: string }> {
    try {
      const { agentId, killProcess = false, _stopTrigger, _stopReason } = params;
      const trigger = _stopTrigger || 'unknown';
      const triggerReason = _stopReason || 'none';
      const id = createAgentId(agentId);
      const record = this.sessions.get(id);

      // Structured cancellation-origin log: identifies WHO triggered the stop and WHY.
      // This is the consolidated-backend entry point — it can bypass handleStopSession
      // and call provider.interrupt() directly, so it needs its own origin log.
      logger.info('[cancellation-origin] [consolidated-backend] backendStop', {
        trigger,
        triggerReason,
        agentId,
        hasRecord: !!record,
        killProcess,
        hasProvider: !!record?.provider,
        sessionStatus: record?.session?.status,
      });

      // Cancel streaming if active
      if (record) {
        if (killProcess) {
          // Full stop - kill the process (used for workspace deletion)
          if (
            record.provider &&
            'stop' in record.provider &&
            typeof record.provider.stop === 'function'
          ) {
            logger.info('[backendStop] Killing ACP provider process', { agentId });
            // Use forceCleanup: true to ensure all streaming callbacks are cleaned up
            await record.provider.stop({ forceCleanup: true });
          }
          // Remove from sessions map
          this.sessions.delete(id);
        } else {
          // Just interrupt - keep process alive (normal stop)
          if (
            record.provider &&
            'interrupt' in record.provider &&
            typeof record.provider.interrupt === 'function'
          ) {
            logger.info('[backendStop] Interrupting ACP provider', { agentId });
            await record.provider.interrupt();
          }
        }

        this.streaming.cancelStream(agentId);

        // Update agent state to idle (only if not killing)
        if (!killProcess && record.session) {
          record.session.status = AgentStatus.Idle;
          record.session.isStreaming = false;
        }

        // Emit stop event
        this.emit('agent:stopped', { agentId });
      }

      return { success: true };
    } catch (error) {
      logger.error('[backendStop] Error stopping agent', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Delete an agent session
   */
  async deleteAgent(
    agentId: string,
    workspaceId?: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const id = createAgentId(agentId);
      const record = this.sessions.get(id);

      // If not in sessions but we have a workspaceId, still try to delete from disk
      if (!record && !workspaceId) {
        logger.warn('[deleteAgent] Agent not found in sessions and no workspaceId provided', {
          agentId,
        });
        return { success: false, error: 'Agent not found' };
      }

      const effectiveWorkspaceId = record?.workspaceId.toString() || workspaceId;

      logger.info('[deleteAgent] Starting agent deletion', {
        agentId,
        workspaceId: effectiveWorkspaceId,
        hasRecord: !!record,
        persistenceEnabled: this.config.persistenceEnabled,
        isMainProcess: isMainProcess(),
      });

      // Clean up streaming if we have a record
      if (record) {
        this.streaming.cancelStream(agentId);

        // Delete from sessions
        this.sessions.delete(id);
      }

      // Persist deletion if enabled
      if (this.config.persistenceEnabled && effectiveWorkspaceId) {
        // Check if we're in the main process
        if (isMainProcess()) {
          logger.info('[deleteAgent] Running in main process, using direct persistence call');
          // Direct call to persistence service in main process
          const { agentPersistence } = await getNodeModules();
          if (agentPersistence) {
            logger.info('[deleteAgent] Calling agentPersistence.deleteAgent', {
              agentId,
              workspaceId: effectiveWorkspaceId,
            });
            const result = await agentPersistence.deleteAgent(agentId, effectiveWorkspaceId);
            logger.info('[deleteAgent] Persistence deletion result', { result });
          } else {
            logger.error('[deleteAgent] agentPersistence not available in main process');
          }
        } else {
          logger.info('[deleteAgent] Running in renderer process, using IPC');
          // Use IPC from renderer process
          const invoke = await getInvoke();
          await invoke(PERSISTENCE_CHANNELS.DELETE, { agentId });
        }
      }

      logger.info('[deleteAgent] Agent deleted successfully', { agentId });
      this.emit('agent:deleted', { agentId });

      return { success: true };
    } catch (error) {
      logger.error('[deleteAgent] Error deleting agent', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Create a new agent session.
   * ALWAYS uses agentFactory to ensure user rules are loaded.
   * Validates configuration, enforces concurrent agent limits, and sets up persistence.
   *
   * @public
   * @param {Workspace} workspace - The workspace for the agent
   * @param {UnifiedAgentConfig} config - Agent configuration
   * @returns {Promise<Object>} Result object with success status and agent or error
   * @returns {boolean} result.success - Whether agent creation succeeded
   * @returns {AgentSession} [result.agent] - The created agent session if successful
   * @returns {string} [result.error] - Error message if creation failed
   * @throws {Error} If critical system error occurs
   * @example
   * ```typescript
   * const result = await backend.createAgent(workspace, {
   *   name: 'My Agent',
   *   model: 'gpt-4',
   *   systemPrompt: 'You are a helpful assistant'
   * });
   *
   * if (result.success && result.agent) {
   *   console.log('Agent created:', result.agent.id);
   * }
   * ```
   */
  async createAgent(
    workspace: Workspace,
    config: UnifiedAgentConfig,
  ): Promise<{ success: boolean; agent?: AgentSession; error?: string }> {
    try {
      logger.info('[createAgent] Creating new agent', {
        workspaceId: workspace.id,
        name: config.name,
        providedId: config.id,
        hasId: !!config.id,
      });

      // Validate configuration
      const validation = agentValidator.validateConfig(config);
      if (!validation.valid) {
        return { success: false, error: validation.errors?.join(', ') || 'Invalid configuration' };
      }

      // Check concurrent agent limit
      if (this.sessions.size >= this.config.maxConcurrentAgents) {
        return {
          success: false,
          error: `Maximum concurrent agents (${this.config.maxConcurrentAgents}) reached`,
        };
      }

      // When called from backend (via IPC), create agent directly without calling factory
      // The factory has already done its work on the frontend side
      // This prevents circular dependency and duplicate agent creation

      // Generate IDs (or use provided ones)
      // Note: streamId is no longer needed - agentId is the canonical key for streams
      const agentId = config.id ? createAgentId(config.id) : unifiedIdService.generateAgentId();
      // Note: sessionId is typed as AgentId in the codebase (not SessionId), so we use generateAgentId()
      const sessionId = createSessionId(unifiedIdService.generateAgentId());

      // Create the agent session object
      // If there's an initial message, add it to the messages array so it's included in agent:created event
      const initialMessages: any[] = [];
      if (config.initialMessage || config.imageBlocks?.length) {
        const userMessage = {
          id: `msg_${agentId}_${Date.now()}`,
          appMessageId: createAppMessageId(),
          role: 'user' as const,
          contentBlocks: [
            ...(config.initialMessage?.trim()
              ? [{ type: 'text' as const, text: config.initialMessage.trim() }]
              : []),
            ...(config.imageBlocks || []),
          ],
          timestamp: new Date().toISOString(),
        };
        initialMessages.push(userMessage);
        logger.info('[createAgent] Added initial user message to agent', {
          agentId,
          messageId: userMessage.id,
        });
      }

      // Extract isBackground from metadata to set at top level
      const isBackground = config.metadata?.isBackground === true;

      const agent: AgentSession = {
        id: agentId,
        workspaceId: workspace.id,
        name: config.name || 'Agent',
        model: config.model || DEFAULT_AGENT_MODEL,
        provider: config.provider, // Top-level ACP provider — locked after first real prompt/session use
        systemPrompt: config.systemPrompt || '',
        metadata: config.metadata || {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: initialMessages,
        status: AgentStatus.Idle,
        isStreaming: false,
        isProcessing: false,
        isResponding: false,
        // Local backend session ID is assigned immediately for persistence/routing,
        // but blank agents are still considered unused until they get an ACP session
        // or any real conversation messages.
        backendSessionId: sessionId,
        isBackground, // Set at top level so agent appears in correct lists
      };

      const workspaceId = createWorkspaceId(workspace.id);

      // Create session record
      const record: UnifiedSessionRecord = {
        agentId,
        sessionId,
        workspaceId,
        session: agent,
        streamBuffer: [],
        messageCount: 0,
        lastActivity: new Date(),
        errors: [],
      };

      // Store session
      this.sessions.set(agentId, record);

      // Register in session registry
      // Session registered in state

      logger.info('[createAgent] Agent created successfully', {
        agentId: agent.id,
        sessionId: agent.id,
        hasSystemPrompt: !!agent.systemPrompt,
        systemPromptLength: agent.systemPrompt?.length || 0,
      });

      // Save agent to disk immediately after creation to persist systemPrompt
      if (this.config.persistenceEnabled) {
        logger.info('[createAgent] Saving agent to disk', { agentId: agent.id });

        // Mark agent as pending before save to avoid ENOENT errors from concurrent loadAgent calls
        // This is important during bulk task delegation when multiple agents are created in parallel
        if (isMainProcess() && agentPersistence) {
          const { unifiedPersistence } = await import('../main/agent-persistence');
          unifiedPersistence.markAgentPending(agent.id, agent);
        }

        const saveResult = await this.saveAgent(agent.id);
        if (!saveResult.success) {
          logger.warn('[createAgent] Failed to save agent to disk', {
            agentId: agent.id,
            error: saveResult.error,
          });
        } else {
          logger.info('[createAgent] Agent saved to disk successfully', { agentId: agent.id });
        }
      }

      this.emit('agent:created', { agentId: agent.id, workspaceId: agent.workspaceId, agent });

      return { success: true, agent };
    } catch (error) {
      logger.error('[createAgent] Error creating agent', error);
      errorHandler.handleError(error as Error, {
        service: 'consolidated-backend',
        operation: 'createAgent',
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Update agent status
   */
  async updateAgentStatus(agentId: string, status: AgentStatus): Promise<void> {
    try {
      const id = createAgentId(agentId);
      const record = this.sessions.get(id);

      if (!record) {
        throw new Error(`Agent ${agentId} not found`);
      }

      // Update the status
      record.session.status = status;
      record.lastActivity = new Date();

      // Emit status change event with required canonical status metadata.
      const isActive = status === AgentStatus.Active || status === AgentStatus.Processing;
      const isTerminal =
        status === AgentStatus.Idle ||
        status === AgentStatus.Completed ||
        status === AgentStatus.Error ||
        status === AgentStatus.Deleted;
      this.emit('agent:status', {
        agentId,
        status: String(status),
        activationState: status === AgentStatus.Error ? 'error' : isActive ? 'active' : null,
        isActive,
        isStreaming: isActive,
        isProcessing: isActive,
        isResponding: isActive,
        stopReason: isTerminal ? String(status) : null,
      });


    } catch (error) {
      logger.error('Failed to update agent status', { agentId, status, error });
      throw error;
    }
  }

  /**
   * Send a message to an agent
   */
  async sendMessage(
    agentId: string,
    content: string,
    options: {
      contextReferences?: any[];
      model?: string;
    } = {},
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Defensive runtime validation: callers may bypass TS types (e.g. tests, IPC).
      if (content === null || content === undefined) {
        return { success: false, error: 'Message content is required' };
      }
      if (typeof content !== 'string') {
        return { success: false, error: 'Invalid message content' };
      }

      const id = createAgentId(agentId);
      const record = this.sessions.get(id);

      if (!record) {
        return { success: false, error: 'Agent not found' };
      }

      // Update last activity
      record.lastActivity = new Date();
      record.messageCount++;
      this.totalMessageCount++;

      // Track response time start
      const responseStartTime = Date.now();

      // Start streaming with response time tracking
      // Uses agentId as the canonical key (one stream per agent)
      this.streaming.startStream({
        agentId,
        sessionId: record.session.id,
        workspaceId: record.session.workspaceId,
        messageId: createMessageId(uuidv4()),
        onComplete: () => {
          // Track response time when streaming completes
          const responseTime = Date.now() - responseStartTime;
          this.trackResponseTime(responseTime);
        },
      });

      // This service should only be used in the renderer process
      // In the main process, the agent-backend-handler should directly use providers
      if (typeof window === 'undefined') {
        // We're in the main process - this shouldn't happen
        logger.error('[sendMessage] ConsolidatedBackendService should not be used in main process');
        return {
          success: false,
          error:
            'ConsolidatedBackendService should not be used in main process. Use agent-backend-handler directly.',
        };
      }

      // Send message via IPC to backend
      // Note: Backend uses agentId as the primary key for streams
      const invoke = await getInvoke();
      const response = (await invoke(AGENT_BACKEND_CHANNELS.STREAM_MESSAGE, {
        agentId,
        sessionId: record.session.id,
        content,
        workspaceId: record.workspaceId,
        contextReferences: options.contextReferences,
        model: options.model,
        agentName: record.session.name,
        systemPrompt: record.session.systemPrompt,
      })) as { success: boolean; error?: string };

      if (!response?.success) {
        // Use agentId for error handling (canonical key for StreamManager)
        this.streaming.handleError(agentId, new Error(response?.error || 'Failed to send message'));
        return { success: false, error: response?.error || 'Failed to send message' };
      }

      return { success: true };
    } catch (error) {
      logger.error('[sendMessage] Error sending message', error);
      errorHandler.handleError(error as Error, {
        service: 'consolidated-backend',
        operation: 'sendMessage',
        agentId,
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Save agent state
   */
  async saveAgent(agentId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const id = createAgentId(agentId);
      const record = this.sessions.get(id);

      if (!record) {
        logger.error('[saveAgent] Agent not found for save', { agentId });
        return { success: false, error: 'Agent not found' };
      }

      if (this.config.persistenceEnabled) {
        let result: { success: boolean; error?: string };

        // Check if we're in the main process
        if (isMainProcess()) {
          // Direct call to persistence service in main process
          const { agentPersistence } = await getNodeModules();
          if (agentPersistence) {
            const saveResult = await agentPersistence.saveAgent(record.session);
            result = saveResult;
          } else {
            result = { success: false, error: 'Persistence service not available' };
          }
        } else {
          // Use IPC from renderer process
          const invoke = await getInvoke();
          result = (await invoke(PERSISTENCE_CHANNELS.SAVE, {
            agentId,
            session: record.session,
          })) as { success: boolean; error?: string };
        }

        if (!result?.success) {
          return { success: false, error: result?.error || 'Failed to save agent' };
        }
      }

      logger.info('[saveAgent] Agent saved', { agentId });
      return { success: true };
    } catch (error) {
      logger.error('[saveAgent] Error saving agent', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Load agent from persistence
   */
  async loadAgent(
    agentId: string,
    workspace: Workspace,
  ): Promise<{ success: boolean; agent?: AgentSession; error?: string }> {
    try {
      if (!this.config.persistenceEnabled) {
        return { success: false, error: 'Persistence not enabled' };
      }

      let result: { success: boolean; data?: AgentSession; error?: string };

      // Check if we're in the main process
      if (isMainProcess()) {
        // Main process - use direct persistence call
        const { agentPersistence } = await getNodeModules();
        if (agentPersistence) {
          // Do NOT pass workspace.path - let it use the correct metadata directory
          const loadResult = await agentPersistence.loadAgent(
            createAgentId(agentId),
            createWorkspaceId(workspace.id),
          );

          if (loadResult.success && loadResult.data) {
            result = { success: true, data: loadResult.data };
          } else {
            result = { success: false, error: loadResult.error || 'Failed to load agent' };
          }
        } else {
          result = { success: false, error: 'Persistence service not available' };
        }
      } else {
        // Renderer process - use IPC
        const invoke = await getInvoke();
        result = (await invoke(PERSISTENCE_CHANNELS.LOAD, { agentId })) as {
          success: boolean;
          data?: AgentSession;
          error?: string;
        };
      }

      if (!result?.success || !result?.data) {
        return { success: false, error: result?.error || 'Agent not found' };
      }

      const agent = result.data as AgentSession;
      const id = createAgentId(agent.id);
      const sessionId = createSessionId(agent.id);
      const workspaceId = createWorkspaceId(workspace.id);

      // Create session record
      const record: UnifiedSessionRecord = {
        agentId: id,
        sessionId,
        workspaceId,
        session: agent,
        streamBuffer: [],
        messageCount: agent.messages?.length || 0,
        lastActivity: new Date(),
        errors: [],
      };

      // Store session
      this.sessions.set(id, record);

      // Register in session registry
      // Session registered in state

      logger.info('[loadAgent] Agent loaded', { agentId });
      this.emit('agent:loaded', { agent });

      return { success: true, agent };
    } catch (error) {
      logger.error('[loadAgent] Error loading agent', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * List persisted agents for a workspace
   */
  async listPersistedAgents(workspaceId: string): Promise<string[]> {
    try {
      if (!this.config.persistenceEnabled) {
        return [];
      }

      // Check if we're in the main process
      if (isMainProcess()) {
        // Direct call to persistence service in main process
        const { agentPersistence } = await getNodeModules();
        if (agentPersistence) {
          const agents = await agentPersistence.listAgents(workspaceId);
          return agents || [];
        } else {
          return [];
        }
      } else {
        // Use IPC from renderer process
        const invoke = await getInvoke();
        const result = (await invoke(AGENT_BACKEND_CHANNELS.LIST, { workspaceId })) as {
          success: boolean;
          data?: string[];
        };
        return result?.success && result?.data ? result.data : [];
      }
    } catch (error) {
      logger.error('[listPersistedAgents] Error listing persisted agents', {
        workspaceId,
        error,
      });
      return [];
    }
  }

  /**
   * Load persisted sessions from disk (backend mode)
   */
  async loadPersistedSessions(workspaceId: string): Promise<number> {
    if (!this.config.persistenceEnabled) return 0;

    const { path, WorkspaceConfig, metadataFSFactory } = await getNodeModules();
    if (!path || !WorkspaceConfig) {
      logger.warn('[loadPersistedSessions] path or WorkspaceConfig not available');
      return 0;
    }

    try {
      // Use IMetadataFS for remote workspace support.
      // Falls back to LocalMetadataFS (pass-through to fs/promises) for local workspaces.
      const { LocalMetadataFS } = await import('../../metadata-fs/main/local-metadata-fs');
      const metadataFS = metadataFSFactory ? metadataFSFactory(workspaceId) : new LocalMetadataFS();

      // Use the correct workspace metadata directory, NOT process.cwd()
      const agentsDir = WorkspaceConfig.paths.agents(workspaceId);

      // Check if directory exists
      try {
        await metadataFS.access(agentsDir);
      } catch {
        return 0; // Directory doesn't exist
      }

      // Load all agent files
      const entries = await metadataFS.readdir(agentsDir, { withFileTypes: true });
      const jsonFiles = entries.filter((e) => e.isFile() && e.name.endsWith('.json'));
      let loadedCount = 0;

      for (const entry of jsonFiles) {
        try {
          const filePath = path.join(agentsDir, entry.name);
          const content = await metadataFS.readFile(filePath, 'utf-8');
          const session = JSON.parse(content) as AgentSession;

          // Only load sessions for this workspace
          if (session.workspaceId === createWorkspaceId(workspaceId)) {
            // Recreate the record
            const record: UnifiedSessionRecord = {
              agentId: session.id,
              sessionId: session.id || createSessionId(unifiedIdService.generateAgentId()),
              workspaceId: session.workspaceId,
              session,
              streamBuffer: [],
              messageCount: session.messages.length,
              lastActivity: new Date(session.updatedAt),
              errors: [],
            };

            this.sessions.set(session.id, record);
            loadedCount++;
          }
        } catch (error) {
          logger.warn('[loadPersistedSessions] Failed to load session file', { file: entry.name, error });
        }
      }

      logger.info('[loadPersistedSessions] Loaded persisted sessions', {
        count: loadedCount,
        workspaceId,
      });
      return loadedCount;
    } catch (error) {
      logger.error('[loadPersistedSessions] Failed to load persisted sessions', { error });
      return 0;
    }
  }

  /**
   * Track a response time sample
   */
  private trackResponseTime(responseTime: number): void {
    // Add to samples array
    this.responseTimes.push(responseTime);

    // Keep only the last N samples
    if (this.responseTimes.length > this.MAX_RESPONSE_TIME_SAMPLES) {
      this.responseTimes.shift();
    }

    logger.debug(`[trackResponseTime] Response time: ${responseTime}ms`);
  }

  /**
   * Calculate average response time from samples
   */
  private calculateAverageResponseTime(): number {
    if (this.responseTimes.length === 0) {
      return 0;
    }

    const sum = this.responseTimes.reduce((acc, time) => acc + time, 0);
    return Math.round(sum / this.responseTimes.length);
  }

  /**
   * Get health metrics
   */
  getHealthMetrics(): HealthMetrics {
    return { ...this.metrics };
  }

  /**
   * Initialize health metrics
   */
  private createInitialMetrics(): HealthMetrics {
    // Get memory usage safely (works in both Node.js and browser)
    let memoryUsage: any = {
      rss: 0,
      heapTotal: 0,
      heapUsed: 0,
      external: 0,
      arrayBuffers: 0,
    };

    if (typeof process !== 'undefined' && typeof process.memoryUsage === 'function') {
      memoryUsage = process.memoryUsage();
    }

    return {
      healthy: true,
      uptime: 0,
      memoryUsage,
      activeSessions: 0,
      totalMessages: 0,
      errorRate: 0,
      responseTime: 0,
      lastCheck: new Date(),
    };
  }

  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    const cleanup = memoryManager.registerTimer(
      () => this.checkHealth(),
      this.config.healthCheckInterval,
      'interval',
      this,
    );
    this.healthTimer = { cleanup } as any;
  }

  /**
   * Setup shutdown handlers
   *
   * NOTE: When running inside the Electron main process, `src/main/index.ts`
   * is the single owner of SIGINT/SIGTERM — it routes those signals through
   * `gracefulShutdown()` so that `agentBackendHandler.persistShutdownState()`
   * runs BEFORE backend provider teardown. Registering our own listeners here
   * would race with that ordering (Node invokes signal listeners in
   * registration order and these are registered first, during module init).
   * Detect the Electron runtime and skip registration in that context; other
   * callers can force-skip via INTENT_DISABLE_BACKEND_SIGNAL_HANDLERS=1.
   */
  private setupShutdownHandlers(): void {
    if (!(isMainProcess() && typeof process !== 'undefined' && typeof process.on === 'function')) {
      return;
    }
    const isElectronMain = !!(process as any)?.versions?.electron;
    const disabledByEnv = process.env?.INTENT_DISABLE_BACKEND_SIGNAL_HANDLERS === '1';
    if (isElectronMain || disabledByEnv) {
      return;
    }
    this.sigintHandler = () => this.shutdown();
    this.sigtermHandler = () => this.shutdown();
    process.on('SIGINT', this.sigintHandler);
    process.on('SIGTERM', this.sigtermHandler);
  }

  /**
   * Health check
   */
  private checkHealth(): void {
    // Get memory usage safely
    let memUsage: any = {
      rss: 0,
      heapTotal: 0,
      heapUsed: 0,
      external: 0,
      arrayBuffers: 0,
    };

    if (typeof process !== 'undefined' && typeof process.memoryUsage === 'function') {
      memUsage = process.memoryUsage();
    }

    const memUsageMB = memUsage.heapUsed / 1024 / 1024;
    const uptime = Date.now() - this.startTime.getTime();
    const errorRate = this.totalMessageCount > 0 ? this.errorCount / this.totalMessageCount : 0;

    this.metrics = {
      healthy: memUsageMB < this.config.memoryLimit && errorRate < 0.1,
      uptime,
      memoryUsage: memUsage,
      activeSessions: this.sessions.size,
      totalMessages: this.totalMessageCount,
      errorRate,
      responseTime: this.calculateAverageResponseTime(),
      lastCheck: new Date(),
    };

    // Emit health status
    this.emit('health:check', this.metrics);

    // Trigger cleanup if memory is high
    if (memUsageMB > this.config.memoryLimit * 0.9) {
      // Throttle warnings to avoid log spam (once per minute max)
      const now = Date.now();
      if (now - this.lastMemoryWarningTime >= this.MEMORY_WARNING_INTERVAL) {
        this.lastMemoryWarningTime = now;
        logger.warn('[checkHealth] Memory usage high, triggering cleanup', { memUsageMB });
      }
      this.cleanupInactiveSessions();
    }

    // Proactively cleanup completed agents that have been idle for 10+ minutes
    // This prevents memory accumulation from delegation chains
    this.cleanupCompletedAgents();

    // Enforce max sessions in memory (LRU eviction when over 80% capacity)
    if (this.sessions.size > this.config.maxConcurrentAgents * 0.8) {
      this.evictLRUSessions();
    }
  }

  /**
   * Cleanup completed agents that have been idle for a short period.
   * More aggressive than cleanupInactiveSessions for completed agents.
   */
  private cleanupCompletedAgents(): void {
    const now = Date.now();
    const completedIdleThreshold = 10 * 60 * 1000; // 10 minutes for completed agents

    // Terminal statuses - agents that won't be doing more work
    const terminalStatuses = [AgentStatus.Completed, AgentStatus.Error, AgentStatus.Deleted];

    for (const [agentId, record] of this.sessions.entries()) {
      const inactiveTime = now - record.lastActivity.getTime();
      const isTerminal = terminalStatuses.includes(record.session.status);

      if (isTerminal && inactiveTime > completedIdleThreshold) {
        logger.debug('[cleanupCompletedAgents] Evicting completed idle agent from memory', {
          agentId: agentId.toString(),
          status: record.session.status,
          inactiveMinutes: Math.round(inactiveTime / 60000),
        });
        this.evictFromMemory(agentId.toString());
      }
    }
  }

  /**
   * Evict least recently used sessions when approaching capacity.
   * Prioritizes evicting completed/terminal agents first.
   */
  private evictLRUSessions(): void {
    const targetSize = Math.floor(this.config.maxConcurrentAgents * 0.7); // Evict down to 70%
    const sessionsToEvict = this.sessions.size - targetSize;

    if (sessionsToEvict <= 0) return;

    // Terminal statuses - agents that won't be doing more work
    const terminalStatuses = [AgentStatus.Completed, AgentStatus.Error, AgentStatus.Deleted];

    // Sort sessions by priority for eviction:
    // 1. Completed/Error/Deleted status (most evictable)
    // 2. Least recently active
    const sortedSessions = Array.from(this.sessions.entries()).sort((a, b) => {
      const aTerminal = terminalStatuses.includes(a[1].session.status);
      const bTerminal = terminalStatuses.includes(b[1].session.status);

      // Terminal agents are evicted first
      if (aTerminal && !bTerminal) return -1;
      if (!aTerminal && bTerminal) return 1;

      // Otherwise, evict least recently used
      return a[1].lastActivity.getTime() - b[1].lastActivity.getTime();
    });

    let evicted = 0;
    for (const [agentId] of sortedSessions) {
      if (evicted >= sessionsToEvict) break;
      this.evictFromMemory(agentId.toString());
      evicted++;
    }

    logger.info('[evictLRUSessions] LRU eviction complete', {
      evicted,
      remainingSessions: this.sessions.size,
    });
  }

  /**
   * Cleanup inactive sessions from memory only.
   * This does NOT delete from persistence - agents can be reloaded from disk when needed.
   * This is a memory optimization, not a deletion operation.
   */
  private cleanupInactiveSessions(): void {
    const now = Date.now();
    const inactiveThreshold = 30 * 60 * 1000; // 30 minutes

    for (const [agentId, record] of this.sessions.entries()) {
      const inactiveTime = now - record.lastActivity.getTime();

      if (inactiveTime > inactiveThreshold && record.session.status !== AgentStatus.Active) {
        logger.info(
          '[cleanupInactiveSessions] Evicting inactive session from memory (not deleting from disk)',
          {
            agentId: agentId.toString(),
            inactiveMinutes: Math.round(inactiveTime / 60000),
          },
        );

        // Only remove from memory, NOT from persistence
        // The agent can be reloaded from disk when needed again
        this.evictFromMemory(agentId.toString());
      }
    }
  }

  /**
   * Evict an agent session from memory only (does NOT delete from persistence).
   * This is used for memory cleanup - the agent can be reloaded from disk when needed.
   */
  private evictFromMemory(agentId: string): void {
    try {
      const id = createAgentId(agentId);
      const record = this.sessions.get(id);

      if (!record) {
        logger.debug('[evictFromMemory] Agent not in memory', { agentId });
        return;
      }

      // Cancel any active streaming
      this.streaming.cancelStream(agentId);

      // Remove from sessions map (memory only)
      this.sessions.delete(id);

      logger.info('[evictFromMemory] Agent evicted from memory', { agentId });
    } catch (error) {
      logger.error('[evictFromMemory] Error evicting agent from memory', { agentId, error });
    }
  }

  /**
   * Setup IPC handlers for Electron (backend mode)
   */
  async setupIPCHandlers(mainWindow?: any): Promise<void> {
    const { ipcMain } = await getNodeModules();
    if (!ipcMain) {
      logger.warn('[setupIPCHandlers] IPC not available, skipping handler setup');
      return;
    }

    // Store main window reference
    if (mainWindow) {
      this.mainWindow = mainWindow;
    }

    // Health monitoring handlers
    ipcMain.handle('agent:health:check', async () => this.performHealthCheck());

    ipcMain.handle('agent:health:metrics', async () => this.getHealthMetrics());

    // NOTE: Agent operation handlers are registered in unified-agent-handlers.ts
    // Do NOT register duplicate handlers here as it causes issues with agent ID and systemPrompt passing
    // The handlers in unified-agent-handlers.ts properly extract agentId from the request object

    // NOTE: Persistence handlers (PERSISTENCE_CHANNELS.SAVE and PERSISTENCE_CHANNELS.LOAD)
    // are registered in persistence.ipc.ts with proper validation and error handling.
    // Do NOT register duplicate handlers here as it causes "Attempted to register a second handler" errors.

    // Setup event forwarding
    this.setupEventForwarding();

    logger.info('[setupIPCHandlers] IPC handlers configured');
  }

  /**
   * Forward events to renderer process
   */
  private eventForwardingSetup = false;
  /**
   * Forward events to renderer process.
   *
   * IMPORTANT: Events listed here are AUTOMATICALLY forwarded to the renderer
   * when this.emit() is called. Do NOT manually call webContents.send() for
   * these events elsewhere in the codebase - this will cause duplicate events
   * which can lead to bugs like duplicate stream handlers being registered.
   *
   * If you need to emit one of these events, use this.emit('event-name', data)
   * and the forwarding will happen automatically.
   */
  private setupEventForwarding(): void {
    // Guard against duplicate setup
    if (this.eventForwardingSetup) {
      logger.debug('[setupEventForwarding] Already set up, skipping');
      return;
    }
    this.eventForwardingSetup = true;

    // IMPORTANT: Do NOT manually send these events via webContents.send() elsewhere!
    // They are automatically forwarded when this.emit() is called.
    // Sending them manually will cause duplicate events and bugs.
    //
    // NOTE: Streaming events (chunk, content-blocks, complete, error) are sent via
    // sendToRenderer() with dynamic channel names like 'agent:stream:${agentId}',
    // NOT through this.emit(). So they don't need to be in this list.
    const events = [
      'agent:created', // New agent created
      'agent:deleted', // Agent deleted
      'agent:stopped', // Agent streaming stopped/interrupted
      'agent:status', // Agent status changed (idle, responding, etc.)
      'agent:loaded', // Agent loaded from persistence
      'agent:prepare-handler', // Used by wake handler to prepare frontend stream handler
      'health:check', // Health check metrics (used by health monitoring)
    ];

    // Lazy-import workspace-scoped window lookup (main-process only module)
    let getWindowIdsForWorkspaceFn: ((workspaceId: string) => number[]) | null = null;
    import('../../system/main/system.ipc')
      .then((mod) => {
        getWindowIdsForWorkspaceFn = mod.getWindowIdsForWorkspace;
      })
      .catch(() => {
        logger.warn('[setupEventForwarding] Could not load system.ipc module for workspace scoping');
      });

    for (const event of events) {
      this.on(event, (data: any) => {
        if (!BrowserWindow) {
          logger.warn('[setupEventForwarding] BrowserWindow not available, cannot forward event', {
            event,
          });
          return;
        }

        // Determine workspace-scoped target windows when possible.
        // Events with workspaceId in their data should only go to windows viewing that workspace.
        const workspaceId = data?.workspaceId || data?.agent?.workspaceId;
        let targetWindows: any[];

        if (workspaceId && getWindowIdsForWorkspaceFn) {
          const windowIds = getWindowIdsForWorkspaceFn(workspaceId);
          if (windowIds.length > 0) {
            targetWindows = windowIds
              .map((id: number) => BrowserWindow.fromId(id))
              .filter((w: any) => w && !w.isDestroyed());
          } else {
            // No windows found for workspace - fall back to all windows
            targetWindows = BrowserWindow.getAllWindows().filter((w: any) => !w.isDestroyed());
          }
        } else {
          // Global events or workspace lookup not available - broadcast to all
          targetWindows = BrowserWindow.getAllWindows().filter((w: any) => !w.isDestroyed());
        }

        let sentToAny = false;

        for (const window of targetWindows) {
          try {
            window.webContents.send(event, data);
            sentToAny = true;
          } catch (error) {
            logger.error('[setupEventForwarding] Failed to send to window', {
              event,
              windowId: window.id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        if (sentToAny) {
          logger.debug('[setupEventForwarding] Forwarded event to renderer', {
            event,
            dataKeys: data ? Object.keys(data) : [],
            windowCount: targetWindows.length,
            workspaceScoped: !!workspaceId,
          });
        } else {
          logger.warn('[setupEventForwarding] No windows available to forward event', {
            event,
            windowCount: targetWindows.length,
          });
        }
      });
    }
  }

  /**
   * Update health metrics with current system state
   */
  private updateHealthMetrics(): void {
    // Update memory usage
    if (typeof process !== 'undefined' && typeof process.memoryUsage === 'function') {
      const memUsage = process.memoryUsage();
      // Store memory usage in MB
      (this.metrics as any).memoryUsageMB = memUsage.heapUsed / 1024 / 1024;
    }

    // Update session counts
    this.metrics.activeSessions = this.sessions.size;
    (this.metrics as any).totalSessions = this.totalMessageCount;

    // Update uptime
    this.metrics.uptime = Date.now() - this.startTime.getTime();

    // Update error rate
    const totalRequests = this.totalMessageCount + this.errorCount;
    this.metrics.errorRate = totalRequests > 0 ? this.errorCount / totalRequests : 0;

    // Update last check time
    this.metrics.lastCheck = new Date();
  }

  /**
   * Perform health check
   */
  async performHealthCheck(): Promise<{
    healthy: boolean;
    metrics: HealthMetrics;
    issues: string[];
  }> {
    // Update metrics before health check
    this.updateHealthMetrics();

    const issues: string[] = [];

    // Check memory
    let memUsageMB = 0;
    if (typeof process !== 'undefined' && typeof process.memoryUsage === 'function') {
      memUsageMB = process.memoryUsage().heapUsed / 1024 / 1024;
    }

    if (memUsageMB > this.config.memoryLimit * 0.9) {
      issues.push(`Memory usage critical: ${Math.round(memUsageMB)}MB`);
    }

    // Check error rate
    if (this.metrics.errorRate > 0.1) {
      issues.push(`High error rate: ${(this.metrics.errorRate * 100).toFixed(1)}%`);
    }

    // Check session count
    if (this.sessions.size > this.config.maxConcurrentAgents * 0.9) {
      issues.push(
        `Near max concurrent agents: ${this.sessions.size}/${this.config.maxConcurrentAgents}`,
      );
    }

    // Check for stuck sessions
    const now = new Date();
    for (const record of this.sessions.values()) {
      if (record.session.isProcessing) {
        const processingTime = now.getTime() - record.lastActivity.getTime();
        if (processingTime > 60000) {
          // 1 minute
          issues.push(`Session ${record.agentId} stuck in processing state`);
        }
      }
    }

    return {
      healthy: issues.length === 0,
      metrics: this.metrics,
      issues,
    };
  }

  private mainWindow?: any; // BrowserWindow reference

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    logger.info('[shutdown] Starting graceful shutdown', {
      sessionCount: this.sessions.size,
    });

    // Stop health monitoring
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
    }

    // Save all active sessions first.
    //
    // IMPORTANT: Skip sessions whose in-memory state still looks like an
    // in-flight stream. The clean-quit path calls
    // `agentBackendHandler.persistShutdownState()` BEFORE this shutdown — that
    // flush loads a fresh copy from disk, repairs the stale streaming flags to
    // idle, and writes the repaired copy back. Our in-memory `record.session`
    // is a SEPARATE object reference that still carries the stale streaming
    // snapshot; calling `saveAgent()` here would overwrite the repaired idle
    // on-disk state with that stale snapshot.
    //
    // Detection must cover BOTH forms of stale streaming state:
    //  1. Session-level flags — `record.session.isStreaming/isProcessing`.
    //  2. Message-level flags — `persistStreamingSessionState()` writes an
    //     assistant message with `message.isStreaming: true` onto the shared
    //     in-memory backend session without setting session-level flags, so
    //     a session can be mid-stream with only the per-message flag set.
    //
    // Skipping is safe when `persistShutdownState()` did not run (e.g.
    // hard-kill or test environments): the disk state is left untouched and
    // the next `loadAgent` path triggers orphan-recovery which repairs it.
    const hasStreamingMessage = (session: AgentSession | undefined): boolean => {
      if (!session?.messages) return false;
      for (const m of session.messages) {
        if ((m as any)?.isStreaming === true) return true;
      }
      return false;
    };
    const savePromises: Promise<any>[] = [];
    for (const [agentId, record] of this.sessions.entries()) {
      if (!this.config.persistenceEnabled) continue;
      const sessionStreaming =
        record.session?.isStreaming === true || record.session?.isProcessing === true;
      const messageStreaming = hasStreamingMessage(record.session);
      if (sessionStreaming || messageStreaming) {
        logger.info('[shutdown] Skipping save for streaming session to preserve repaired on-disk state', {
          agentId: agentId.toString(),
          isStreaming: record.session?.isStreaming === true,
          isProcessing: record.session?.isProcessing === true,
          hasStreamingMessage: messageStreaming,
        });
        continue;
      }
      savePromises.push(this.saveAgent(agentId.toString()));
    }

    await Promise.allSettled(savePromises);

    // Kill all auggie processes - this is critical to prevent orphaned processes
    const killPromises: Promise<void>[] = [];
    for (const [agentId, record] of this.sessions.entries()) {
      if (
        record.provider &&
        'stop' in record.provider &&
        typeof record.provider.stop === 'function'
      ) {
        logger.info('[shutdown] Killing agent process', { agentId: agentId.toString() });
        killPromises.push(
          // Use forceCleanup: true to ensure all streaming callbacks are cleaned up during shutdown
          record.provider.stop({ forceCleanup: true }).catch((error: Error) => {
            logger.warn('[shutdown] Failed to stop agent process', {
              agentId: agentId.toString(),
              error: error.message,
            });
          }),
        );
      }
    }

    // Wait for all processes to be killed (with timeout)
    if (killPromises.length > 0) {
      logger.info('[shutdown] Waiting for agent processes to terminate', {
        count: killPromises.length,
      });
      await Promise.race([
        Promise.allSettled(killPromises),
        new Promise((resolve) => setTimeout(resolve, 5000)), // 5 second timeout
      ]);
    }

    // Clean up streaming
    this.streaming.destroy();

    // Clear sessions
    this.sessions.clear();

    logger.info('[shutdown] Graceful shutdown complete');
    this.emit('shutdown');
  }

  /**
   * Reset for testing
   */
  async reset(): Promise<void> {
    // Clear sessions and reset counters
    this.sessions.clear();
    this.totalMessageCount = 0;
    this.errorCount = 0;
    this.metrics = this.createInitialMetrics();
  }

  /**
   * Get all active sessions
   */
  getAllSessions(): AgentSession[] {
    return Array.from(this.sessions.values()).map((record) => record.session);
  }

  /**
   * Get a specific session (sync version for compatibility)
   */
  getSession(agentId: string): AgentSession | undefined {
    try {
      const id = createAgentId(agentId);
      return this.sessions.get(id)?.session;
    } catch {
      return undefined;
    }
  }

  /**
   * Get sessions for a workspace (sync version)
   */
  getWorkspaceSessions(workspaceId: string): AgentSession[] {
    try {
      const wsId = createWorkspaceId(workspaceId);
      return Array.from(this.sessions.values())
        .filter((record) => record.workspaceId === wsId)
        .map((record) => record.session);
    } catch {
      return [];
    }
  }

  // ============================================================================
  // Message Queue Operations (Frontend)
  // ============================================================================

  /**
   * Queue a message for an agent (frontend only)
   */
  async queueMessage(
    agentId: string,
    content: string,
    contextItems?: any[],
    imageBlocks?: Array<{ type: 'image'; data: string; mimeType: string }>,
    workspaceId?: string,
  ): Promise<{ success: boolean; queuedMessage?: any; error?: string }> {
    if (isMainProcess()) {
      throw new Error('queueMessage should only be called from frontend');
    }

    try {
      const invoke = await getInvoke();
      const result = (await invoke(AGENT_BACKEND_CHANNELS.QUEUE_MESSAGE, {
        agentId,
        content,
        contextItems,
        imageBlocks,
        workspaceId,
      })) as {
        success: boolean;
        data?: { success: boolean; queuedMessage?: any; error?: string };
        error?: any;
      };
      // IPC wraps response in { success, data }, so unwrap the inner data
      if (result?.success && result?.data) {
        return result.data;
      }
      return { success: false, error: result?.error?.message || 'Failed to queue message' };
    } catch (error) {
      logger.error('Failed to queue message', { agentId, error });
      return { success: false, error: String(error) };
    }
  }

  /**
   * Edit a queued message (frontend only)
   */
  async editQueuedMessage(
    agentId: string,
    messageId: string,
    content: string,
  ): Promise<{ success: boolean; error?: string }> {
    if (isMainProcess()) {
      throw new Error('editQueuedMessage should only be called from frontend');
    }

    try {
      const invoke = await getInvoke();
      const result = (await invoke(AGENT_BACKEND_CHANNELS.EDIT_QUEUED, {
        agentId,
        messageId,
        content,
      })) as { success: boolean; data?: { success: boolean; error?: string }; error?: any };
      // IPC wraps response in { success, data }, so unwrap the inner data
      if (result?.success && result?.data) {
        return result.data;
      }
      return { success: false, error: result?.error?.message || 'Failed to edit queued message' };
    } catch (error) {
      logger.error('Failed to edit queued message', { agentId, messageId, error });
      return { success: false, error: String(error) };
    }
  }

  /**
   * Remove a queued message (frontend only)
   */
  async removeQueuedMessage(
    agentId: string,
    messageId: string,
  ): Promise<{ success: boolean; error?: string }> {
    if (isMainProcess()) {
      throw new Error('removeQueuedMessage should only be called from frontend');
    }

    try {
      const invoke = await getInvoke();
      const result = (await invoke(AGENT_BACKEND_CHANNELS.REMOVE_QUEUED, {
        agentId,
        messageId,
      })) as { success: boolean; data?: { success: boolean; error?: string }; error?: any };
      // IPC wraps response in { success, data }, so unwrap the inner data
      if (result?.success && result?.data) {
        return result.data;
      }
      return { success: false, error: result?.error?.message || 'Failed to remove queued message' };
    } catch (error) {
      logger.error('Failed to remove queued message', { agentId, messageId, error });
      return { success: false, error: String(error) };
    }
  }

  /**
   * Get the queue for an agent (frontend only)
   */
  async getQueue(agentId: string): Promise<{ success: boolean; queue?: any[]; error?: string }> {
    if (isMainProcess()) {
      throw new Error('getQueue should only be called from frontend');
    }

    try {
      const invoke = await getInvoke();
      const result = (await invoke(AGENT_BACKEND_CHANNELS.GET_QUEUE, { agentId })) as {
        success: boolean;
        data?: { success: boolean; queue?: any[]; error?: string };
        error?: any;
      };
      // IPC wraps response in { success, data }, so unwrap the inner data
      if (result?.success && result?.data) {
        return result.data;
      }
      return { success: false, error: result?.error?.message || 'Failed to get queue' };
    } catch (error) {
      logger.error('Failed to get queue', { agentId, error });
      return { success: false, error: String(error) };
    }
  }

  /**
   * Dispose of all resources and cleanup
   */
  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    logger.info('Disposing ConsolidatedBackendService', {
      sessionCount: this.sessions.size,
    });

    // Stop health monitoring
    if (this.healthTimer) {
      if (typeof this.healthTimer === 'object' && 'cleanup' in this.healthTimer) {
        (this.healthTimer as any).cleanup();
      } else {
        clearInterval(this.healthTimer);
      }
      this.healthTimer = undefined;
    }

    // Kill all auggie processes synchronously (best effort)
    // This is critical to prevent orphaned processes on dispose
    this.sessions.forEach((record, agentId) => {
      try {
        // Kill the auggie process if provider exists
        if (
          record.provider &&
          'stop' in record.provider &&
          typeof record.provider.stop === 'function'
        ) {
          logger.info('[dispose] Killing agent process', { agentId: agentId.toString() });
          // Fire and forget - we can't await in dispose()
          // Use forceCleanup: true to ensure all streaming callbacks are cleaned up during dispose
          record.provider.stop({ forceCleanup: true }).catch((error: Error) => {
            logger.warn('[dispose] Failed to stop agent process', {
              agentId: agentId.toString(),
              error: error.message,
            });
          });
        }
        // Clean up session-specific resources
        if (record.session) {
          this.streaming.cleanupSession(record.session.id);
        }
      } catch (error) {
        logger.error('Error cleaning up session', { error });
      }
    });

    // Clear sessions map
    this.sessions.clear();

    // Dispose streaming manager
    if (this.streaming) {
      this.streaming.dispose();
    }

    // Clean up with memory manager
    memoryManager.cleanup(this);

    // Remove process signal handlers to prevent listener leak across singleton cycles
    if (typeof process !== 'undefined' && typeof process.removeListener === 'function') {
      if (this.sigintHandler) {
        process.removeListener('SIGINT', this.sigintHandler);
        this.sigintHandler = undefined;
      }
      if (this.sigtermHandler) {
        process.removeListener('SIGTERM', this.sigtermHandler);
        this.sigtermHandler = undefined;
      }
    }

    // Remove all event listeners
    this.removeAllListeners();

    // Clear singleton instance
    ConsolidatedBackendService.instance = undefined;

    logger.info('ConsolidatedBackendService disposed successfully');
  }
}

// Export singleton instance
// Lazy-initialized singleton to avoid instantiation in browser context
let _consolidatedBackend: ConsolidatedBackendService | undefined;

function getConsolidatedBackend(): ConsolidatedBackendService {
  if (!_consolidatedBackend) {
    _consolidatedBackend = ConsolidatedBackendService.getInstance();
  }
  return _consolidatedBackend;
}

// Export as unifiedOrchestrator for backward compatibility
export const unifiedOrchestrator = new Proxy({} as any, {
  get(target, prop) {
    const backend = getConsolidatedBackend();
    const value = (backend as any)[prop];
    if (typeof value === 'function') {
      return value.bind(backend);
    }
    return value;
  },
});

// Export as unifiedAgentBackend for backward compatibility
export const unifiedAgentBackend = unifiedOrchestrator;
