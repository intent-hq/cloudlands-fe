/**
 * Agent Backend Handler Service
 *
 * Main backend service for agent operations. Handles:
 * - Agent lifecycle (create, stop, resume)
 * - Message streaming and accumulation
 * - Session persistence via agentPersistence
 *
 * Handler methods are used by AgentBackendAdapter which is called
 * by unified-agent-handlers.ts for IPC routing.
 */

import { isRandomAgentName } from '$lib/utils/agent-name-generator';
import {
  buildProviderEnv,
  createCompoundModelId,
  getDefaultProviderId,
  getProviderConfig,
  parseCompoundModelId,
} from '$shared/config/provider-config';
import { upsertCodexConfigArgs } from './provider-registry';
import { parseCodexReasoningEffort } from '$shared/config/open-ai-codex-models';
import { DEFAULT_AGENT_MODEL } from '$shared/constants/agent-services';
import { isBinaryExtension } from '$shared/binary-file-extensions';
import { Logger } from '$shared/logger';
import { memEvents } from '$shared/main/memory-event-logger';
import { isWorkspaceSlug } from '$shared/services/workspace-slug';
import type { AgentMessage, AgentSession, ContentBlock } from '$shared/types';
import type { QueuedMessage } from '$shared/types/agent-session';
import type { AgentId, NoteId, WorkspaceId } from '$shared/types/branded-ids';
import type { IpcMainInvokeEvent } from 'electron';
import { BrowserWindow, ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { WorkspaceConfig } from '../../../shared/main/config';
import { workspaceService } from '../../workspace/main/workspace.service';
import { agentValidator } from '../services/agent-validator';
import * as messageAccumulator from '../../../store/main/slices/message-accumulator/message-accumulator-api';
import { resolveStreamingConfig, DEFAULT_PROFILE } from '$lib/store/slices/streaming-config/streaming-config-types';
import { agentPersistence } from './agent-persistence';
import { getWindowIdForWorkspace, getWindowIdsForWorkspace } from '../../system/main/system.ipc';
import { trackMain } from '$lib/services/analytics/main';

const logger = new Logger('AgentBackendHandler');

interface CreateAgentRequest {
  workspaceId: string;
  workspacePath: string;
  name?: string;
  agentId?: string; // Optional: if provided, backend will use this ID instead of generating a new one
  model?: string;
  provider?: string; // Provider ID (e.g., 'auggie', 'claude-code', 'codex') - from activeProviderStore.activeProviderId
  agentType?: string; // Agent type for specialization rules (debug, investigate, implement, etc.)
  behaviorPrompt?: string; // Custom behavior instructions for the agent
  specialistName?: string; // Display name of the specialist (e.g., "Coordinator", "Implementor")
  roleReminder?: string; // Critical constraints reminder for the specialist (injected at end of prompt for recency)
  initialMessage?: string;
  contextReferences?: any[];
  metadata?: Record<string, any>;
  workspaceContext?: {
    openPanels: Array<{ type: string; title: string; id?: string; path?: string }>;
    linkedReferences: Array<{
      type: string;
      title: string;
      identifier?: string;
      url?: string;
    }>;
  };
  /**
   * Optional callback invoked after the agent is created but BEFORE the initial
   * message starts processing. Use this to set up subscriptions that must exist
   * before the agent can complete, preventing the race condition where a fast-
   * completing child agent emits agent:idle before the parent's subscription
   * is registered.
   */
  onBeforeStart?: (agentId: string) => Promise<void>;
}

interface SendMessageRequest {
  agentId: string;
  sessionId: string;
  streamId: string;
  content: string;
  workspaceId: string;
  contextReferences?: any[];
  imageBlocks?: Array<{ type: 'image'; data: string; mimeType: string }>;
  fileBlocks?: Array<{ type: 'file'; data: string; mimeType: string; fileName: string }>;
  model?: string;
  noteIds?: string[];
  personality?: string;
  stdinContext?: string;
  /** Metadata to attach to the message (e.g., source: 'system' for system-initiated messages) */
  messageMetadata?: Record<string, any>;
}

/**
 * Agent resumability status
 * - 'running': Provider exists and process is alive - can send messages directly
 * - 'resumable': No provider but data exists on disk - can restore and then send
 * - 'not_found': No provider and no persisted data - need to create new agent
 */
type AgentResumabilityStatus = 'running' | 'resumable' | 'not_found';

/**
 * Result of checking agent resumability
 */
interface AgentResumabilityResult {
  canWake: boolean;
  status: AgentResumabilityStatus;
  hasProvider: boolean;
  hasPersistedData: boolean;
  processAlive: boolean;
  agentData?: any; // Persisted agent data if available
}

/**
 * Agent Backend Handler Service
 *
 * Core backend service for agent operations. Provides handler methods for:
 * - Agent lifecycle (create, stop, resume)
 * - Message streaming and accumulation
 * - Message queueing and interruption
 * - Session persistence via agentPersistence
 *
 * ARCHITECTURE:
 * - IPC handlers are registered in unified-agent-handlers.ts
 * - AgentBackendAdapter routes IPC calls to this service's handler methods
 * - This service contains the business logic, not IPC registration
 *
 * @class AgentBackendHandler
 * @example
 * ```typescript
 * // Used internally by AgentBackendAdapter:
 * const handler = AgentBackendHandler.getInstance();
 * await handler.handleCreateAgent(event, request);
 * ```
 */
/** Generic handler function type */
type EventHandlerFunction = (...args: unknown[]) => void;

export class AgentBackendHandler {
  /** @property {Map<string, Set<EventHandlerFunction>>} eventListeners - Map of event names to listener functions */
  private eventListeners = new Map<string, Set<EventHandlerFunction>>();
  /** @property {Map<string, NodeJS.Timeout>} streamHealthChecks - Health check intervals for active streams */
  private streamHealthChecks = new Map<string, NodeJS.Timeout>();
  /** @property {Map<string, number>} streamStartTimes - Track when streams started */
  private streamStartTimes = new Map<string, number>();
  /** @property {Map<string, string>} streamSessionIds - Map of agentId to sessionId for stream tracking */
  private streamSessionIds = new Map<string, string>();
  /** @property {Map<string, string>} streamWorkspaceIds - Map of agentId to workspaceId for stream tracking */
  private streamWorkspaceIds = new Map<string, string>();
  /** @property {Map<string, number>} streamGenerations - Monotonic counter per agent to detect stale stream cleanup.
   *  Incremented each time a new stream starts for an agent. Stale cleanup callbacks compare their
   *  captured generation against the current value to avoid erasing a newer stream's tracking state. */
  private streamGenerations = new Map<string, number>();
  /** @property {Map<string, number>} streamWindowIds - Map of agentId to window ID for targeted stream delivery */
  private streamWindowIds = new Map<string, number>();
  /** @property {Map<string, QueuedMessage[]>} messageQueues - Queued messages per agent */
  private messageQueues = new Map<string, QueuedMessage[]>();
  /** @property {Set<string>} processingQueue - Agents currently processing queued messages */
  private processingQueue = new Set<string>();
  /** @property {Set<string>} pendingQueueProcessing - Agents with queued messages about to be processed.
   *  Set synchronously in finalizeStream, checked in sendBackendInitiatedMessage to prevent
   *  event delivery from racing ahead of queued message processing. */
  private pendingQueueProcessing = new Set<string>();
  /** @property {Set<string>} pendingBackendDeliveries - Agents with a backend-initiated delivery
   *  already in flight. Prevents concurrent sendBackendInitiatedMessage calls from creating
   *  duplicate wake messages when multiple subscriptions match the same event simultaneously. */
  private pendingBackendDeliveries = new Set<string>();
  /** @property {Map<string, NodeJS.Timeout>} pendingBackendDeliveryTimeouts - Safety timeouts
   *  that force-clear pendingBackendDeliveries entries after 5 minutes. Prevents permanent
   *  unreachability if handleBackendStreamMessage hangs and the finally block never runs. */
  private pendingBackendDeliveryTimeouts = new Map<string, NodeJS.Timeout>();
  /** Safety timeout duration for pendingBackendDeliveries (5 minutes). */
  private static readonly PENDING_DELIVERY_TIMEOUT_MS = 5 * 60 * 1000;
  /** @property {Set<string>} interruptedAgents - Agents that were intentionally interrupted (skip auto queue processing) */
  private interruptedAgents = new Set<string>();
  /** @property {Map<string, Set<string>>} completedStreams - Track completed streamIds per agentId to prevent duplicate onComplete calls */
  private completedStreams = new Map<string, Set<string>>();
  /** @property {Map<string, { resolve: () => void, reject: (err: Error) => void }>} pendingHandlerReady - Promises waiting for frontend handler ready signal */
  private pendingHandlerReady = new Map<
    string,
    { resolve: () => void; reject: (err: Error) => void }
  >();
  /** @property {Map<string, number>} lastPongTimes - Track last pong received time per agent for IPC heartbeat */
  private lastPongTimes = new Map<string, number>();
  /** @property {Map<string, number>} lastPingSentTimes - Track when last ping was sent to check for missed pongs */
  private lastPingSentTimes = new Map<string, number>();
  /**
   * Secondary guard: tracks recently deleted agent IDs to prevent resurrection
   * in sendBackendInitiatedMessage. Maps agentId → deletedAt timestamp.
   * Primary guard is in the agent-subscriptions Redux slice (deletedAgents).
   * Entries older than 1 hour are evicted on each addition.
   */
  private deletedAgentIds: Map<string, number> = new Map();
  private static readonly DELETED_AGENT_EVICTION_MS = 60 * 60 * 1000; // 1 hour
  private static readonly MAX_DELETED_AGENTS = 1000; // Hard cap to prevent unbounded growth

  /** @property {Map<string, number>} emptyResponseRetries - Track consecutive empty end_turn responses per agent for auto-continue */
  private emptyResponseRetries = new Map<string, number>();

  /**
   * Registers an event listener for cleanup tracking.
   *
   * @private
   * @param {string} event - Event name
   * @param {EventHandlerFunction} handler - Event handler function
   * @returns {void}
   */
  private registerEventListener(event: string, handler: EventHandlerFunction): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(handler);
  }

  /**
   * Unregisters an event listener.
   *
   * @private
   * @param {string} event - Event name
   * @param {EventHandlerFunction} handler - Event handler function to remove
   * @returns {void}
   */
  private unregisterEventListener(event: string, handler: EventHandlerFunction): void {
    const handlers = this.eventListeners.get(event);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.eventListeners.delete(event);
      }
    }
  }

  /**
   * Cleans up all registered event listeners.
   *
   * @private
   * @returns {void}
   */
  private cleanupAllListeners(): void {
    for (const [event, handlers] of this.eventListeners) {
      for (const handler of handlers) {
        this.unifiedBackend?.off(event, handler as any);
      }
    }
    this.eventListeners.clear();
  }
  /** @property {AgentBackendHandler} instance - Singleton instance */
  private static instance: AgentBackendHandler;
  /** @property {any} unifiedBackend - Lazily loaded backend service */
  private unifiedBackend: any; // Will be lazily loaded
  /** @property {Map<string, any>} activeSessions - Map of active agent sessions */
  private activeSessions: Map<string, any> = new Map();
  /** @property {Map<string, any>} providers - Map to store active providers for each agent */
  private providers: Map<string, any> = new Map();
  /** @property {Map<string, number>} providerLastUsed - Track last activity time for each provider */
  private providerLastUsed: Map<string, number> = new Map();
  /** @property {NodeJS.Timeout | null} providerCleanupInterval - Interval for cleaning up idle providers */
  private providerCleanupInterval: NodeJS.Timeout | null = null;
  /** @property {number} PROVIDER_IDLE_TIMEOUT_MS - Time before an idle provider is cleaned up (5 minutes) */
  private readonly PROVIDER_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
  /** @property {number} PROVIDER_CLEANUP_INTERVAL_MS - How often to check for idle providers (1 minute) */
  private readonly PROVIDER_CLEANUP_INTERVAL_MS = 60 * 1000;

  /**
   * Private constructor for singleton pattern.
   *
   * IPC handlers are registered in unified-agent-handlers.ts.
   * This service provides the business logic methods used via AgentBackendAdapter.
   *
   * @private
   */
  private constructor() {
    this.setupHandlers();
    this.startProviderCleanupInterval();
  }

  /**
   * Start the interval that cleans up idle providers.
   * Providers that haven't been used for PROVIDER_IDLE_TIMEOUT_MS are cleaned up
   * to prevent memory leaks from accumulated auggie processes.
   */
  private startProviderCleanupInterval(): void {
    if (this.providerCleanupInterval) {
      clearInterval(this.providerCleanupInterval);
    }

    this.providerCleanupInterval = setInterval(() => {
      this.cleanupIdleProviders();
    }, this.PROVIDER_CLEANUP_INTERVAL_MS);

    logger.info('Started provider cleanup interval', {
      idleTimeoutMs: this.PROVIDER_IDLE_TIMEOUT_MS,
      checkIntervalMs: this.PROVIDER_CLEANUP_INTERVAL_MS,
    });
  }

  /**
   * Clean up providers that have been idle for too long.
   * This prevents memory leaks from accumulated auggie processes.
   */
  private async cleanupIdleProviders(): Promise<void> {
    const now = Date.now();
    const idleThreshold = now - this.PROVIDER_IDLE_TIMEOUT_MS;
    const providersToCleanup: string[] = [];

    // Find idle providers
    for (const [agentId, lastUsed] of this.providerLastUsed.entries()) {
      if (lastUsed < idleThreshold) {
        // Double-check the provider still exists
        if (this.providers.has(agentId)) {
          // CRITICAL: Skip agents that have an active stream!
          // The streamStartTimes map tracks agents that are currently streaming.
          // Cleaning up an actively streaming agent would kill the auggie process
          // mid-response, causing the agent to appear stuck.
          if (this.streamStartTimes.has(agentId)) {
            logger.debug('Skipping cleanup of provider with active stream', {
              agentId,
              lastUsed,
              streamStartTime: this.streamStartTimes.get(agentId),
            });
            continue;
          }
          providersToCleanup.push(agentId);
        }
      }
    }

    if (providersToCleanup.length === 0) {
      return;
    }

    logger.info('Cleaning up idle providers', {
      count: providersToCleanup.length,
      agentIds: providersToCleanup,
      idleTimeoutMs: this.PROVIDER_IDLE_TIMEOUT_MS,
      totalProviders: this.providers.size,
    });

    // Memory instrumentation
    memEvents.custom('idle_provider_cleanup_start', undefined, {
      providersToCleanup: providersToCleanup.length,
      totalProviders: this.providers.size,
    });

    for (const agentId of providersToCleanup) {
      try {
        const provider = this.providers.get(agentId);
        if (provider && typeof provider.cleanup === 'function') {
          await provider.cleanup();
          logger.info('Cleaned up idle provider', { agentId });
        }
        this.providers.delete(agentId);
        this.providerLastUsed.delete(agentId);
        this.emptyResponseRetries.delete(agentId);
      } catch (error) {
        logger.error('Error cleaning up idle provider', {
          agentId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Memory instrumentation
    memEvents.custom('idle_provider_cleanup_complete', undefined, {
      cleanedUp: providersToCleanup.length,
      remainingProviders: this.providers.size,
    });
  }

  /**
   * Update the last used time for a provider.
   * Call this when the provider is actively used (message sent, etc.)
   */
  private touchProvider(agentId: string): void {
    if (this.providers.has(agentId)) {
      this.providerLastUsed.set(agentId, Date.now());
    }
  }

  /**
   * Stop all providers for a specific workspace.
   * This is called when a workspace is deleted to ensure all agent processes are killed.
   *
   * @param workspaceId - The ID of the workspace being deleted
   * @returns The number of providers that were stopped
   */
  async stopProvidersForWorkspace(workspaceId: string): Promise<number> {
    const agentsToStop: string[] = [];

    // Find all agents that belong to this workspace from streamWorkspaceIds
    for (const [agentId, wsId] of this.streamWorkspaceIds) {
      if (wsId === workspaceId) {
        agentsToStop.push(agentId);
      }
    }

    // CRITICAL: Also check ALL providers directly by their config.workspaceId
    // This handles race conditions where:
    // 1. Provider is being created (registry.create() hasn't returned yet)
    // 2. Provider was created but streamWorkspaceIds wasn't set yet
    // 3. Provider exists but never sent a message
    for (const [agentId, provider] of this.providers) {
      if (!agentsToStop.includes(agentId)) {
        // Check the provider's config directly for workspaceId
        const providerWorkspaceId = (provider as any)?.config?.workspaceId;
        if (providerWorkspaceId === workspaceId) {
          agentsToStop.push(agentId);
          logger.info('[stopProvidersForWorkspace] Found provider via config.workspaceId', {
            agentId,
            workspaceId,
          });
        }
      }
    }

    if (agentsToStop.length === 0) {
      logger.info('[stopProvidersForWorkspace] No providers to stop for workspace', {
        workspaceId,
        totalProviders: this.providers.size,
      });
      return 0;
    }

    logger.info('[stopProvidersForWorkspace] Stopping providers for workspace', {
      workspaceId,
      agentCount: agentsToStop.length,
      agentIds: agentsToStop,
    });

    let stoppedCount = 0;
    const STOP_TIMEOUT_MS = 5000; // 5 second timeout per provider

    // Helper to stop a single provider with timeout
    const stopProvider = async (agentId: string): Promise<boolean> => {
      try {
        const provider = this.providers.get(agentId);
        if (provider) {
          // Stop the provider with timeout (kills the auggie process)
          // Use forceCleanup: true to ensure all streaming callbacks are cleaned up
          // This prevents the "janky hang" where streams are kept alive waiting for model fallback
          const stopPromise = (async () => {
            if (typeof provider.stop === 'function') {
              await provider.stop({ forceCleanup: true });
              logger.info('[stopProvidersForWorkspace] Stopped provider with forceCleanup', {
                agentId,
                workspaceId,
              });
            } else if (typeof provider.cleanup === 'function') {
              await provider.cleanup();
              logger.info('[stopProvidersForWorkspace] Cleaned up provider', {
                agentId,
                workspaceId,
              });
            }
          })();

          const timeoutPromise = new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error('Stop timeout')), STOP_TIMEOUT_MS),
          );

          await Promise.race([stopPromise, timeoutPromise]);
        }

        // Clean up all tracking maps for this agent (always do this, even if stop times out)
        this.cleanupAllAgentTrackingMaps(agentId);

        return true;
      } catch (error) {
        logger.error('[stopProvidersForWorkspace] Error stopping provider', {
          agentId,
          workspaceId,
          error: error instanceof Error ? error.message : String(error),
        });

        // Still clean up tracking maps even if stop failed
        this.cleanupAllAgentTrackingMaps(agentId);

        return false;
      }
    };

    // Stop all providers in parallel for faster cleanup
    const results = await Promise.all(agentsToStop.map(stopProvider));
    stoppedCount = results.filter(Boolean).length;

    logger.info('[stopProvidersForWorkspace] Completed stopping providers', {
      workspaceId,
      stoppedCount,
      remainingProviders: this.providers.size,
    });

    return stoppedCount;
  }

  /**
   * Get the set of workspace IDs that currently have active agent providers.
   * Used by the memory monitor to identify orphaned workspaces (providers running
   * with no open window) so it can stop them to free memory.
   */
  getWorkspaceIdsWithProviders(): Set<string> {
    const wsIds = new Set<string>();
    // Primary source: streamWorkspaceIds is always populated when a provider streams
    for (const [, wsId] of this.streamWorkspaceIds) {
      wsIds.add(wsId);
    }
    // Fallback: check provider config for providers that exist but haven't streamed yet.
    // Uses the same (provider as any)?.config?.workspaceId cast as stopProvidersForWorkspace().
    for (const [, provider] of this.providers) {
      const wsId = (provider as any)?.config?.workspaceId;
      if (typeof wsId === 'string' && wsId.length > 0) {
        wsIds.add(wsId);
      }
    }
    return wsIds;
  }

  /**
   * Estimate the size of content blocks in KB for memory instrumentation.
   */
  private estimateContentSizeKB(contentBlocks: any[] | undefined): number {
    if (!contentBlocks || contentBlocks.length === 0) return 0;
    try {
      const jsonStr = JSON.stringify(contentBlocks);
      return Math.round(jsonStr.length / 1024);
    } catch {
      return 0;
    }
  }

  /**
   * Estimate the total size of session messages in KB for memory instrumentation.
   */
  private estimateSessionSizeKB(messages: any[] | undefined): number {
    if (!messages || messages.length === 0) return 0;
    try {
      const jsonStr = JSON.stringify(messages);
      return Math.round(jsonStr.length / 1024);
    } catch {
      return 0;
    }
  }

  /**
   * Gets the backend service, loading it lazily if needed.
   *
   * @private
   * @returns {Promise<any>} The unified backend service
   */
  private async getBackend() {
    if (!this.unifiedBackend) {
      // Import from main/ (not services/) to get the real implementation with createAgent, etc.
      const { unifiedAgentBackend } = await import('./consolidated-backend.service');
      this.unifiedBackend = unifiedAgentBackend;
    }
    return this.unifiedBackend;
  }

  /**
   * Request frontend to prepare stream handler for a backend-initiated agent.
   * Emits 'agent:prepare-handler' and waits for 'agent:handler-ready' response.
   *
   * This is used for backend-initiated agents (e.g., wake handler, system-created agents)
   * to ensure the frontend has registered its stream handler before streaming starts.
   *
   * NOTE: Frontend-initiated agents (via agent:create IPC) don't need this - they already
   * have their own code path for setting up handlers. Eventually these should be unified,
   * but for now we only use this for backend-initiated cases.
   *
   * @param agentId - The agent ID to prepare handler for
   * @param workspaceId - The workspace ID
   * @param agentInfo - Basic agent info to send to frontend
   * @param timeoutMs - Timeout in milliseconds (default 10s)
   * @throws Error if frontend doesn't respond within timeout after all retries
   */
  private async requestFrontendHandler(
    agentId: string,
    workspaceId: string,
    agentInfo: { name: string; model?: string },
    timeoutMs: number = 10000,
    wakeMessage?: any,
  ): Promise<void> {
    // OPTIMIZATION: Skip handshake if no windows exist for this workspace.
    // This eliminates the 30s timeout (10s × 3 retries) for background agents
    // and cases where all windows are closed.
    const windowIds = getWindowIdsForWorkspace(workspaceId);
    if (windowIds.length === 0) {
      logger.info('Skipping frontend handler handshake - no windows for workspace', {
        agentId,
        workspaceId,
      });
      return;
    }

    const backend = await this.getBackend();

    // ROBUSTNESS FIX: Add retry logic to handle the restart timing issue.
    // After app restart, the frontend may not be ready immediately when the backend
    // tries to send tasks. This was causing the "task not sent after restart" bug.
    const maxRetries = 3;
    const retryDelayMs = 1000;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      logger.info('Requesting frontend to prepare stream handler', {
        agentId,
        workspaceId,
        agentName: agentInfo.name,
        timeoutMs,
        hasWakeMessage: !!wakeMessage,
        attempt,
        maxRetries,
      });

      try {
        // Create promise that will be resolved when frontend sends agent:handler-ready
        const handlerReadyPromise = new Promise<void>((resolve, reject) => {
          this.pendingHandlerReady.set(agentId, { resolve, reject });

          // Set up timeout - fail if frontend doesn't respond
          setTimeout(() => {
            if (this.pendingHandlerReady.has(agentId)) {
              this.pendingHandlerReady.delete(agentId);
              reject(
                new Error(
                  `Frontend did not respond to agent:prepare-handler within ${timeoutMs}ms for agent ${agentId}`,
                ),
              );
            }
          }, timeoutMs);
        });

        // Emit the prepare-handler event to frontend
        // Include wakeMessage if provided so frontend can add it to the session
        backend.emit('agent:prepare-handler', {
          agentId,
          workspaceId,
          agentInfo,
          wakeMessage,
        });

        // Wait for frontend to signal ready
        await handlerReadyPromise;

        logger.info('Frontend stream handler is ready', { agentId, attempt });
        return; // Success - exit the retry loop
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.warn('Frontend handshake attempt failed', {
          agentId,
          workspaceId,
          attempt,
          maxRetries,
          error: lastError.message,
        });

        // Wait before retrying (except on last attempt)
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
        }
      }
    }

    // All retries failed
    logger.error('Frontend handshake failed after all retries', {
      agentId,
      workspaceId,
      maxRetries,
      error: lastError?.message,
    });
    throw lastError || new Error('Frontend handshake failed after all retries');
  }

  /**
   * Wait for frontend to signal that stream handler is ready.
   * Used for queued message processing to ensure the frontend has re-registered
   * its stream handler after the previous stream completed.
   *
   * @param agentId - The agent ID to wait for
   * @param timeoutMs - Timeout in milliseconds
   * @throws Error if frontend doesn't respond within timeout
   */
  private async waitForFrontendHandlerReady(agentId: string, timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.pendingHandlerReady.set(agentId, { resolve, reject });

      // Set up timeout - fail if frontend doesn't respond
      setTimeout(() => {
        if (this.pendingHandlerReady.has(agentId)) {
          this.pendingHandlerReady.delete(agentId);
          reject(
            new Error(
              `Frontend did not respond with agent:handler-ready within ${timeoutMs}ms for agent ${agentId}`,
            ),
          );
        }
      }, timeoutMs);
    });
  }

  /**
   * Gets the singleton instance of AgentBackendHandler.
   *
   * @static
   * @returns {AgentBackendHandler} The singleton instance
   * @example
   * ```typescript
   * const handler = AgentBackendHandler.getInstance();
   * ```
   */
  static getInstance(): AgentBackendHandler {
    if (!AgentBackendHandler.instance) {
      AgentBackendHandler.instance = new AgentBackendHandler();
    }
    return AgentBackendHandler.instance;
  }

  /**
   * Initialize the handler service.
   *
   * IPC handlers are registered in unified-agent-handlers.ts.
   * This service provides the business logic methods used via AgentBackendAdapter.
   *
   * @private
   * @returns {void}
   */
  private setupHandlers(): void {
    logger.info('AgentBackendHandler initialized');

    // Listen for frontend signal that stream handler is ready
    // This is used for backend-initiated agents (e.g., wake handler) to ensure
    // the frontend has registered its stream handler before we start streaming
    ipcMain.on('agent:handler-ready', (_event: any, data: { agentId: string }) => {
      const { agentId } = data;
      logger.info('Received agent:handler-ready from frontend', { agentId });

      const pending = this.pendingHandlerReady.get(agentId);
      if (pending) {
        pending.resolve();
        this.pendingHandlerReady.delete(agentId);
      } else {
        logger.warn('Received agent:handler-ready but no pending request', { agentId });
      }
    });

    // Listen for pong responses from frontend for IPC heartbeat
    // This verifies the renderer is receiving messages during active streams
    ipcMain.on('agent:stream:pong', (_event: any, data: { agentId: string }) => {
      const { agentId } = data;
      if (this.streamStartTimes.has(agentId)) {
        this.lastPongTimes.set(agentId, Date.now());
        logger.debug('Received pong from frontend', { agentId });
      }
    });
  }

  /**
   * Handle create agent request
   */
  private async handleCreateAgent(
    _event: IpcMainInvokeEvent,
    validated: any,
  ): Promise<{ success: boolean; agent?: AgentSession; error?: string }> {
    const request = validated as CreateAgentRequest;
    try {
      // Use debug level for detailed logs to reduce overhead during bulk operations
      logger.debug('Creating agent', {
        workspaceId: request.workspaceId,
        name: request.name,
        agentType: request.agentType,
      });

      // Fetch full workspace data first to get title for system prompt building
      let workspace: any = {
        id: request.workspaceId,
        path: request.workspacePath,
      };

      try {
        const fullWorkspaceResult = await workspaceService.getWorkspace(request.workspaceId as any);
        if (fullWorkspaceResult.ok && fullWorkspaceResult.data) {
          workspace = fullWorkspaceResult.data;
        }
      } catch (error) {
        logger.warn('Failed to fetch full workspace data, using minimal workspace object', {
          workspaceId: request.workspaceId,
          error,
        });
      }

      // Build system prompt from agentType via InstructionService
      // Use provided agentType or default to 'workspace' to ensure agents always have instructions
      const agentType = request.agentType || 'workspace';

      logger.debug('Building system prompt from agentType', {
        agentType,
        requestedAgentType: request.agentType,
        usingDefault: !request.agentType,
        workspacePath: request.workspacePath,
        workspaceTitle: workspace?.title,
      });

      const { InstructionService } = await import('./instruction-service');
      const instructionService = InstructionService.getInstance();

      // Log behavior prompt receipt for debugging specialist agent creation
      if (request.behaviorPrompt) {
        logger.info('Received behaviorPrompt for agent creation', {
          agentId: request.agentId,
          name: request.name,
          behaviorPromptLength: request.behaviorPrompt.length,
          behaviorPromptPreview: request.behaviorPrompt.substring(0, 100),
        });
      }

      // Resolve specialist config using centralized resolver.
      // This ensures roleReminder, specialistName, and any future fields are always resolved.
      const specialistId = request.metadata?.specialist;
      let effectiveRoleReminder = request.roleReminder;
      let effectiveSpecialistName = request.specialistName;
      if (specialistId && (!effectiveRoleReminder || !effectiveSpecialistName)) {
        try {
          const { resolveSpecialistForAgent } = await import('./specialists.service');
          const resolved = resolveSpecialistForAgent(specialistId);
          if (resolved) {
            effectiveRoleReminder = effectiveRoleReminder || resolved.roleReminder;
            effectiveSpecialistName = effectiveSpecialistName || resolved.specialistName;
            logger.info('Resolved specialist config for agent creation', {
              specialistId,
              specialistName: effectiveSpecialistName,
              hasRoleReminder: !!effectiveRoleReminder,
            });
          }
        } catch (err) {
          logger.warn('Failed to resolve specialist config', { specialistId, error: err });
        }
      }

      // Detect sub-agents (delegated/background) to give them lighter prompts
      const isSubAgent = !!(request.metadata?.createdByAgentId || request.metadata?.isBackground);

      const { isAutoCommitEnabled } = await import(
        '../../workspace/main/workspace-settings.service'
      );

      const systemPrompt = await instructionService.buildSystemPrompt({
        agentType,
        workspacePath: request.workspacePath,
        contextReferences: request.contextReferences?.map((ref) =>
          typeof ref === 'string' ? ref : JSON.stringify(ref),
        ),
        behaviorPrompt: request.behaviorPrompt,
        specialistName: effectiveSpecialistName,
        roleReminder: effectiveRoleReminder,
        workspaceContext: request.workspaceContext,
        isInitialAgent: request.metadata?.isInitialAgent || false,
        workspaceTitle: workspace?.title,
        isSubAgent,
        autoCommitEnabled: isAutoCommitEnabled(request.workspaceId),
      });

      logger.debug('System prompt built from agentType', {
        agentType,
        systemPromptLength: systemPrompt.length,
        hasBehaviorPrompt: !!request.behaviorPrompt,
        hasRoleReminder: !!request.roleReminder,
      });

      // Validate request
      const validation = agentValidator.validateConfig({
        name: request.name || 'Agent',
        workspaceId: request.workspaceId,
        model: request.model,
        systemPrompt,
      });

      if (!validation.valid) {
        logger.error('Agent config validation failed', {
          errors: validation.errors,
          name: request.name,
          workspaceId: request.workspaceId,
          model: request.model,
          systemPromptLength: systemPrompt?.length,
        });
        return {
          success: false,
          error: validation.errors.join(', '),
        };
      }

      // Create agent
      const backend = await this.getBackend();

      // Log the agent ID being passed (debug level for bulk operations)
      logger.debug('Backend handler passing agent ID to consolidated backend', {
        providedAgentId: request.agentId,
        hasAgentId: !!request.agentId,
      });

      const result = await backend.createAgent(workspace, {
        name: request.name || 'Agent',
        model: request.model,
        systemPrompt, // Use the built system prompt
        provider:
          request.provider || parseCompoundModelId(request.model || DEFAULT_AGENT_MODEL).providerId, // Infer provider from model ID, falls back to default provider
        metadata: {
          ...request.metadata,
          initialMessage: request.initialMessage, // Store initial message in metadata
          agentType, // Store resolved agent type (with default) in metadata
          provider:
            request.provider ||
            parseCompoundModelId(request.model || DEFAULT_AGENT_MODEL).providerId, // Store provider in metadata for handleSendMessage
          roleReminder: effectiveRoleReminder, // Store resolved role reminder for system prompt rebuilds
        },
        workspaceId: request.workspaceId, // Pass workspace ID so MCP tools are configured
        workspacePath: request.workspacePath,
        id: request.agentId, // Pass the frontend-generated agent ID if provided
        initialMessage: request.initialMessage, // Pass initial message to backend
        contextReferences: request.contextReferences, // Pass context references
      });

      if (!result.success || !result.agent) {
        logger.error('Backend createAgent failed', {
          workspaceId: request.workspaceId,
          name: request.name,
          error: result.error,
          hasAgent: !!result.agent,
        });
        return {
          success: false,
          error: result.error || 'Failed to create agent',
        };
      }

      const agent = result.agent;

      // Use debug level for detailed logs to reduce overhead during bulk operations
      logger.debug('[AgentBackendHandler] Agent received from backend', {
        agentId: agent.id,
        workspaceId: agent.workspaceId,
      });

      // Note: Initial user message is now added in consolidated-backend.service.ts
      // when createAgent() is called with config.initialMessage
      if (request.initialMessage) {
        logger.debug('[AgentBackendHandler] Agent created with initial message', {
          agentId: agent.id,
          messageCount: agent.messages?.length || 0,
        });
      }

      // Call onBeforeStart hook BEFORE firing the initial message.
      // This allows callers to set up subscriptions before the agent starts
      // processing, preventing the race condition where a fast-completing child
      // agent emits agent:idle before the parent's subscription is registered.
      if (request.onBeforeStart) {
        try {
          await request.onBeforeStart(agent.id);
        } catch (err) {
          logger.warn('[AgentBackendHandler] onBeforeStart hook failed', {
            agentId: agent.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Send initial message if provided - ASYNC (fire-and-forget)
      // We don't await this because LLM processing can take 30+ seconds
      // The caller (e.g., create_prerequisite MCP tool) just needs to know
      // the agent was created and started processing, not wait for completion
      if (request.initialMessage) {
        logger.debug('[AgentBackendHandler] Starting initial message (async, non-blocking)', {
          agentId: agent.id,
          messageLength: request.initialMessage.length,
        });

        // Use handleSendMessage directly since we're in the main process
        // backend.sendMessage() refuses to run in main process
        // NOTE: Not awaited - this runs in the background
        // NOTE: handleSendMessage will skip adding the user message since it's already in the session
        // CRITICAL: Pass the messages array so handleSendMessage doesn't try to load from persistence
        // (which might not have the message yet since we haven't saved to disk)
        this.handleSendMessage(null as any, {
          agentId: agent.id,
          sessionId: agent.id,
          streamId: `${agent.id}:${Date.now()}`, // Unique per message turn
          content: request.initialMessage,
          workspaceId: request.workspaceId,
          contextReferences: request.contextReferences,
          skipUserMessage: true, // Signal that user message is already added
          messages: agent.messages, // Pass the messages array with the user message already included
        })
          .then((sendResult) => {
            if (!sendResult.success) {
              logger.warn('[AgentBackendHandler] Initial message failed (async)', {
                agentId: agent.id,
                error: sendResult.error,
              });
            } else {
              logger.debug('[AgentBackendHandler] Initial message completed (async)', {
                agentId: agent.id,
              });
            }
          })
          .catch((error) => {
            logger.error('[AgentBackendHandler] Initial message threw error (async)', {
              agentId: agent.id,
              error: error.message,
            });
          });
      }

      logger.debug('[AgentBackendHandler] Agent created successfully', {
        agentId: agent.id,
        workspaceId: agent.workspaceId,
      });

      // Emit agent:created event for activity log
      this.emitAgentCreatedEvent(
        agent.id,
        request.workspaceId,
        agent.name || request.name || 'Agent',
        request.model,
      );

      // Also emit via backend.emit() so frontend can create a session with full agent data (including metadata)
      // This is needed for delegated agents to show specialist badges and "Delegated by" text
      backend.emit('agent:created', {
        agentId: agent.id,
        workspaceId: request.workspaceId,
        agent: {
          id: agent.id,
          name: agent.name || request.name || 'Agent',
          workspaceId: request.workspaceId,
          model: request.model,
          provider: agent.provider, // Top-level ACP provider for frontend session creation
          systemPrompt: agent.systemPrompt,
          messages: agent.messages || [],
          createdAt: agent.createdAt,
          updatedAt: agent.updatedAt,
          metadata: agent.metadata,
          isBackground: agent.metadata?.isBackground,
        },
      });

      // NOTE: Agent is already saved to disk by consolidated-backend.service.ts createAgent()
      // Do NOT save again here - it was causing duplicate saves (2-3x) during creation
      // See: consolidated-backend.service.ts line ~691

      // Invalidate the persistence list cache since we added a new agent
      this.invalidatePersistenceListCache(request.workspaceId);

      const response = {
        success: true,
        agent,
      };

      logger.info('[AgentBackendHandler] Final response structure', {
        success: response.success,
        hasAgent: !!response.agent,
        agentId: response.agent?.id,
        agentWorkspaceId: response.agent?.workspaceId,
        responseKeys: Object.keys(response),
      });

      return response;
    } catch (error) {
      logger.error('Failed to create agent', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Handle send message request - directly use ACP provider
   */
  private async handleSendMessage(
    _event: IpcMainInvokeEvent,
    validated: any,
  ): Promise<{ success: boolean; error?: string }> {
    const request = validated as SendMessageRequest;
    // Track whether onError callback already handled the failure and emitted agent:failed.
    // This prevents double-emit when provider.streamMessage() rejects after onError fires
    // (since ACP provider's onError calls rejectStream, causing the outer catch to also fire).
    let onErrorHandled = false;
    try {
      // Log the full request to debug behaviorPrompt passing
      const extReq = request as any;
      logger.info(
        `Backend: handleBackendStreamMessage called: agentId=${request.agentId}, sessionId=${extReq.sessionId}, workspaceId=${request.workspaceId}, contentLength=${request.content?.length}, hasBehaviorPrompt=${!!extReq.behaviorPrompt}, behaviorPromptLength=${extReq.behaviorPrompt?.length || 0}, hasSpecialist=${!!extReq.specialist}, specialist=${extReq.specialist}`,
      );

      // Clear the interrupted flag now that a new message is being sent.
      // This is the correct place to clear it — the interrupt message has been delivered
      // (or a new user message is starting), so processNextQueuedMessage can resume
      // normal queue processing on the next stream completion.
      if (this.interruptedAgents.has(request.agentId)) {
        logger.info('Clearing interruptedAgents flag - new message being sent', {
          agentId: request.agentId,
        });
        this.interruptedAgents.delete(request.agentId);
      }

      // Get or create provider for this agent
      let provider = this.providers.get(request.agentId);
      let loadResult: any = null; // Store load result for message history
      // Track agent name for idle event. The agentName is passed through from
      // sendBackendInitiatedMessage to prevent existing agents from being renamed.
      // 'Agent' is only a fallback for edge cases (e.g., direct calls
      // without agentName) — the real name will be resolved from persistence later.
      let agentName = (request as any).agentName || 'Agent';

      // RESILIENCE: If the provider exists but its process is dead, remove it
      // so a fresh provider is created below. This handles ACP process crashes/disconnects.
      if (provider && typeof provider.isHealthy === 'function' && !provider.isHealthy()) {
        logger.warn('handleSendMessage: provider process is dead, removing stale provider', {
          agentId: request.agentId,
        });
        try {
          if (typeof provider.cleanup === 'function') {
            await provider.cleanup();
          }
        } catch (cleanupError) {
          logger.warn('Error cleaning up dead provider in handleSendMessage', {
            agentId: request.agentId,
            error: cleanupError,
          });
        }
        this.providers.delete(request.agentId);
        this.providerLastUsed.delete(request.agentId);
        // Clean up all stream tracking state (consistent with cleanupStreamResources)
        this.streamStartTimes.delete(request.agentId);
        this.streamSessionIds.delete(request.agentId);
        this.streamWorkspaceIds.delete(request.agentId);
        this.streamWindowIds.delete(request.agentId);
        this.streamGenerations.delete(request.agentId);
        provider = undefined;
      }

      // Workspace is fetched lazily - only when needed for:
      // 1. Creating a new provider (environment config, worktree path)
      // 2. First message (naming instructions)
      let workspace: any = null;
      let workspaceFetched = false;

      // Helper to fetch workspace lazily
      const fetchWorkspaceIfNeeded = async (): Promise<void> => {
        if (workspaceFetched) return;
        workspaceFetched = true;
        try {
          const workspaceResult = await workspaceService.getWorkspace(request.workspaceId as any);
          if (workspaceResult.ok && workspaceResult.data) {
            workspace = workspaceResult.data;
          }
        } catch (error) {
          logger.warn('Failed to fetch workspace', { error });
        }
      };

      if (!provider) {
        // Fetch workspace for environment config and worktree path
        await fetchWorkspaceIfNeeded();
        // Create a new ACP provider
        // NOTE: Pre-warmed provider optimization was removed because:
        // - System prompt is baked in at provider creation time (written to rules file)
        // - Warm providers were created without knowing the agent type or model
        // - Different agent types need different system prompts
        const { ProviderRegistry } = await import('./provider-registry');
        const registry = ProviderRegistry.createDefault();

        // Cast request to any to access extended properties
        const extendedRequest = request as any;

        // Get environment config from workspace
        let isRemote = false;
        let environmentConfig: any = undefined;
        if (workspace) {
          isRemote = workspace.isRemote === true;
          environmentConfig = workspace.environmentConfig;
        }

        // Use workspace-specific subdirectory if workspacePath is not provided
        // Priority: request.workspacePath > workspace.worktreePath > workspace.repositoryPath > metadata path
        // IMPORTANT: Use worktreePath to load user rules from the actual code repository, not the metadata folder
        let workspacePath = extendedRequest.workspacePath;
        if (!workspacePath && workspace) {
          // Prefer worktreePath (actual git worktree with code and .augment/rules)
          workspacePath = workspace.worktreePath || workspace.repositoryPath;
        }
        if (!workspacePath) {
          // Fallback to metadata path if no workspace available
          workspacePath = WorkspaceConfig.paths.workspace(request.workspaceId || 'default');

          // Ensure the directory exists
          try {
            if (!fs.existsSync(workspacePath)) {
              fs.mkdirSync(workspacePath, { recursive: true });
            }
          } catch (error) {
            logger.error('Failed to create workspace directory, falling back to /tmp', { error });
            workspacePath = '/tmp';
          }
        }

        // Load the agent from persistence to get the systemPrompt and messages
        let systemPrompt = extendedRequest.systemPrompt;
        // Update agentName from extendedRequest (outer scope variable)
        agentName = extendedRequest.agentName || agentName;

        logger.info('Loading agent from persistence to get systemPrompt and messages', {
          agentId: request.agentId,
          workspaceId: request.workspaceId,
          workspacePath,
        });

        // CRITICAL FIX: Don't pass workspacePath to loadAgent!
        // The workspacePath variable is set to the worktree path (for loading user rules),
        // but agents are stored in the metadata path. Passing workspacePath causes
        // loadAgent to look in the wrong directory (worktree instead of metadata).
        // Let loadAgent use WorkspaceConfig.paths.agents(workspaceId) internally.
        loadResult = await agentPersistence.loadAgent(
          request.agentId as AgentId,
          request.workspaceId as WorkspaceId,
          // DO NOT pass workspacePath here - it causes path mismatch!
        );

        if (loadResult.success && loadResult.data) {
          systemPrompt = loadResult.data.systemPrompt || systemPrompt;
          agentName = loadResult.data.name || agentName;

          // If no systemPrompt but agent has agentType in metadata, build the system prompt
          const agentType =
            loadResult.data.metadata?.agentType || loadResult.data.config?.agentType;
          // Get behavior prompt from specialist config if available
          // Priority: request (for specialist changes before first message) > metadata > config
          const agentBehaviorPrompt =
            extendedRequest.behaviorPrompt ||
            loadResult.data.metadata?.behaviorPrompt ||
            loadResult.data.config?.behaviorPrompt;
          const agentSpecialist =
            extendedRequest.specialist ||
            loadResult.data.metadata?.specialist ||
            loadResult.data.config?.specialist;
          // Get role reminder and specialist name — prefer persisted values, fall back to centralized resolver
          let agentRoleReminder: string | undefined =
            extendedRequest.roleReminder ||
            loadResult.data.metadata?.roleReminder ||
            loadResult.data.config?.roleReminder;
          let agentSpecialistName: string | undefined =
            loadResult.data.metadata?.specialistName || loadResult.data.config?.specialistName;

          // Use centralized resolver for any missing fields (handles legacy agents without stored fields)
          if (agentSpecialist && (!agentRoleReminder || !agentSpecialistName)) {
            try {
              const { resolveSpecialistForAgent } = await import('./specialists.service');
              const resolved = resolveSpecialistForAgent(agentSpecialist);
              if (resolved) {
                agentRoleReminder = agentRoleReminder || resolved.roleReminder;
                agentSpecialistName = agentSpecialistName || resolved.specialistName;
                logger.info('Resolved specialist config for persistence-loaded agent', {
                  specialistId: agentSpecialist,
                  specialistName: agentSpecialistName,
                  hasRoleReminder: !!agentRoleReminder,
                });
              }
            } catch (err) {
              logger.warn('Failed to resolve specialist config', {
                specialistId: agentSpecialist,
                error: err,
              });
            }
          }

          // Check if this is the initial agent (from metadata or config)
          const isInitialAgent =
            loadResult.data.metadata?.isInitialAgent ||
            loadResult.data.config?.metadata?.isInitialAgent ||
            false;

          // CRITICAL FIX: If the request has a behaviorPrompt (specialist changed before first message),
          // we need to rebuild the systemPrompt even if one exists from persistence.
          // This handles the case where user changes specialist after agent creation but before sending.
          // Note: We check for behaviorPrompt in request even if agentType is not set (use 'chat' as default)
          const effectiveAgentType = agentType || 'chat';
          const needsRebuild = extendedRequest.behaviorPrompt && !loadResult.data.messages?.length;

          logger.info(
            `Checking if system prompt rebuild is needed: hasRequestBehaviorPrompt=${!!extendedRequest.behaviorPrompt}, requestBehaviorPromptLength=${extendedRequest.behaviorPrompt?.length || 0}, agentType=${agentType}, effectiveAgentType=${effectiveAgentType}, messageCount=${loadResult.data.messages?.length || 0}, needsRebuild=${needsRebuild}, hasSystemPrompt=${!!systemPrompt}, systemPromptLength=${systemPrompt?.length || 0}`,
          );

          if ((!systemPrompt || needsRebuild) && effectiveAgentType) {
            logger.info(
              `Building system prompt from agentType (loaded from persistence): agentType=${effectiveAgentType}, specialist=${agentSpecialist}, hasBehaviorPrompt=${!!agentBehaviorPrompt}, behaviorPromptLength=${agentBehaviorPrompt?.length || 0}, hasRoleReminder=${!!agentRoleReminder}, isInitialAgent=${isInitialAgent}, workspaceTitle=${workspace?.title}, needsRebuild=${needsRebuild}`,
            );

            const { InstructionService } = await import('./instruction-service');
            const instructionService = InstructionService.getInstance();

            const { isAutoCommitEnabled: isAutoCommitEnabled2 } = await import(
              '../../workspace/main/workspace-settings.service'
            );

            systemPrompt = await instructionService.buildSystemPrompt({
              agentType: effectiveAgentType,
              workspacePath,
              behaviorPrompt: agentBehaviorPrompt, // Pass behavior prompt from specialist config
              specialistName: agentSpecialistName, // Pass specialist name for role reminder section
              roleReminder: agentRoleReminder, // Pass role reminder from specialist config
              isInitialAgent,
              workspaceTitle: workspace?.title, // Pass workspace title for rename check
              autoCommitEnabled: isAutoCommitEnabled2(request.workspaceId),
            });

            logger.info('System prompt built from agentType', {
              agentId: request.agentId,
              agentType: effectiveAgentType,
              specialist: agentSpecialist,
              hasBehaviorPrompt: !!agentBehaviorPrompt,
              hasRoleReminder: !!agentRoleReminder,
              systemPromptLength: systemPrompt.length,
              firstLine: systemPrompt.split('\n')[0],
              wasRebuild: needsRebuild,
            });
          }

          logger.info('Agent loaded from persistence', {
            agentId: request.agentId,
            hasSystemPrompt: !!systemPrompt,
            systemPromptLength: systemPrompt?.length || 0,
            agentName,
            messageCount: loadResult.data.messages?.length || 0,
            agentType: agentType || 'none',
            specialist: agentSpecialist,
          });
        } else {
          logger.warn(
            'Failed to load agent from persistence, attempting to build system prompt from request',
            {
              agentId: request.agentId,
              error: loadResult.error,
              hasAgentTypeInRequest: !!extendedRequest.agentType,
            },
          );

          // CRITICAL FIX: Try to get agent data from in-memory backend
          // When persistence fails (e.g., race condition with newly created agent),
          // the in-memory backend may still have the agent with messages and metadata.
          // This prevents loss of conversation history.
          const backend = this.unifiedBackend;
          let inMemoryAgent: any = null;
          if (backend) {
            inMemoryAgent = await backend.getAgent(request.agentId);
            if (inMemoryAgent) {
              logger.info('Found agent in memory after persistence failure', {
                agentId: request.agentId,
                messageCount: inMemoryAgent.messages?.length || 0,
                hasSystemPrompt: !!inMemoryAgent.systemPrompt,
              });

              // Create a synthetic loadResult from in-memory data
              loadResult = {
                success: true,
                data: inMemoryAgent,
              };

              // Extract data from in-memory agent
              if (inMemoryAgent.systemPrompt) {
                systemPrompt = inMemoryAgent.systemPrompt;
              }
              if (inMemoryAgent.name) {
                agentName = inMemoryAgent.name;
              }
            }
          }

          // Fallback: try to build system prompt from request's agentType
          // This handles the case where the agent is new and hasn't been persisted yet
          const requestAgentType = extendedRequest.agentType;
          // Check if this is the initial agent from request metadata
          const requestIsInitialAgent = extendedRequest.metadata?.isInitialAgent || false;
          // Get behavior prompt, role reminder, and specialist name from request
          const requestBehaviorPrompt = extendedRequest.behaviorPrompt;
          let requestRoleReminder = extendedRequest.roleReminder;
          let requestSpecialistName: string | undefined = extendedRequest.specialistName;
          const requestSpecialist =
            extendedRequest.specialist || extendedRequest.metadata?.specialist;

          // Use centralized resolver for any missing fields
          if (requestSpecialist && (!requestRoleReminder || !requestSpecialistName)) {
            try {
              const { resolveSpecialistForAgent } = await import('./specialists.service');
              const resolved = resolveSpecialistForAgent(requestSpecialist);
              if (resolved) {
                requestRoleReminder = requestRoleReminder || resolved.roleReminder;
                requestSpecialistName = requestSpecialistName || resolved.specialistName;
              }
            } catch (err) {
              logger.warn('Failed to resolve specialist config from request', {
                specialistId: requestSpecialist,
                error: err,
              });
            }
          }

          if (!systemPrompt && requestAgentType) {
            logger.info('Building system prompt from agentType (from request)', {
              agentId: request.agentId,
              agentType: requestAgentType,
              workspacePath,
              isInitialAgent: requestIsInitialAgent,
              workspaceTitle: workspace?.title,
              hasBehaviorPrompt: !!requestBehaviorPrompt,
              behaviorPromptLength: requestBehaviorPrompt?.length || 0,
              hasRoleReminder: !!requestRoleReminder,
            });

            const { InstructionService } = await import('./instruction-service');
            const instructionService = InstructionService.getInstance();

            const { isAutoCommitEnabled: isAutoCommitEnabled3 } = await import(
              '../../workspace/main/workspace-settings.service'
            );

            systemPrompt = await instructionService.buildSystemPrompt({
              agentType: requestAgentType,
              workspacePath,
              behaviorPrompt: requestBehaviorPrompt, // Pass behavior prompt from request
              specialistName: requestSpecialistName, // Pass specialist name for role reminder section
              roleReminder: requestRoleReminder, // Pass role reminder from request
              isInitialAgent: requestIsInitialAgent,
              workspaceTitle: workspace?.title, // Pass workspace title for rename check
              autoCommitEnabled: isAutoCommitEnabled3(request.workspaceId),
            });

            logger.info('System prompt built from agentType (from request)', {
              agentId: request.agentId,
              agentType: requestAgentType,
              hasBehaviorPrompt: !!requestBehaviorPrompt,
              hasRoleReminder: !!requestRoleReminder,
              systemPromptLength: systemPrompt.length,
              firstLine: systemPrompt.split('\n')[0],
            });
          } else if (!systemPrompt) {
            // Last resort: use default 'workspace' agent type
            logger.warn('No agentType in request, using default workspace agent type', {
              agentId: request.agentId,
              workspaceTitle: workspace?.title,
              hasBehaviorPrompt: !!requestBehaviorPrompt,
              hasRoleReminder: !!requestRoleReminder,
            });

            const { InstructionService } = await import('./instruction-service');
            const instructionService = InstructionService.getInstance();

            const { isAutoCommitEnabled: isAutoCommitEnabled4 } = await import(
              '../../workspace/main/workspace-settings.service'
            );

            systemPrompt = await instructionService.buildSystemPrompt({
              agentType: 'workspace',
              workspacePath,
              behaviorPrompt: requestBehaviorPrompt, // Pass behavior prompt from request
              specialistName: requestSpecialistName, // Pass specialist name for role reminder section
              roleReminder: requestRoleReminder, // Pass role reminder from request
              isInitialAgent: requestIsInitialAgent,
              workspaceTitle: workspace?.title, // Pass workspace title for rename check
              autoCommitEnabled: isAutoCommitEnabled4(request.workspaceId),
            });

            logger.info('System prompt built with default workspace type', {
              agentId: request.agentId,
              hasBehaviorPrompt: !!requestBehaviorPrompt,
              hasRoleReminder: !!requestRoleReminder,
              systemPromptLength: systemPrompt.length,
            });
          }
        }

        // Get metadata from loaded agent data (contains modelFallbackChain for retries)
        const agentMetadata = loadResult?.data?.metadata;
        const agentConfig = loadResult?.data?.config;

        // Parse compound model ID to determine provider (e.g., "opencode:anthropic/claude-sonnet-4" -> opencode)
        // Priority: request.model > loaded agent model > config model > provider-aware default
        let modelId =
          request.model || loadResult?.data?.model || agentConfig?.model || DEFAULT_AGENT_MODEL;

        // If model is still the default but we have an explicit NON-default provider,
        // re-resolve the model for that provider. When the provider IS the default (auggie),
        // DEFAULT_AGENT_MODEL is already correct — don't downgrade it.
        const explicitProvider =
          agentConfig?.provider || agentMetadata?.provider || (request as any).provider;
        if (modelId === DEFAULT_AGENT_MODEL && explicitProvider) {
          const { getDefaultModelForProvider, getDefaultProviderId, PROVIDER_MODEL_TIERS } =
            await import('$shared/config/provider-config');
          const defaultProviderId = getDefaultProviderId();
          // Only resolve for providers with known tier mappings — providers with
          // dynamic model lists (e.g. opencode) would produce invalid compound IDs.
          if (explicitProvider !== defaultProviderId && explicitProvider in PROVIDER_MODEL_TIERS) {
            const baseModel = getDefaultModelForProvider(explicitProvider, 'balanced');
            // Prefix with provider ID for non-default providers (matches model store behavior)
            modelId = `${explicitProvider}:${baseModel}`;
            logger.info('Using provider-aware default model', {
              agentId: request.agentId,
              provider: explicitProvider,
              resolvedModel: modelId,
            });
          } else if (explicitProvider !== defaultProviderId) {
            // Provider has dynamic models not in PROVIDER_MODEL_TIERS (e.g., opencode).
            // Use 'default' to let the provider pick its own default model instead of
            // passing the Auggie-specific DEFAULT_AGENT_MODEL which would be invalid.
            modelId = 'default';
            logger.info('Using provider default model for provider without tier mappings', {
              agentId: request.agentId,
              provider: explicitProvider,
            });
          }
        }
        let { providerId, modelId: rawModelId } = parseCompoundModelId(modelId);

        // If the model doesn't include a provider prefix, use the explicitly stored provider
        // from metadata/config (set during workspace creation when user selects a provider)
        if (!modelId.includes(':') && explicitProvider) {
          providerId = explicitProvider;
          logger.info('Using explicitly selected provider (model had no prefix)', {
            agentId: request.agentId,
            explicitProvider,
            modelId,
          });
        }

        // Ensure modelId includes provider prefix so child agents inherit the correct provider
        // via parseCompoundModelId() in getRequiredContext()
        if (!modelId.includes(':') && providerId !== getDefaultProviderId()) {
          modelId = createCompoundModelId(providerId, modelId);
          logger.info('Prefixed model with provider for context inheritance', {
            agentId: request.agentId,
            providerId,
            modelId,
          });
        }

        const providerConfig = getProviderConfig(providerId);

        // Log the systemPrompt to debug if it's being passed correctly
        logger.info('Creating ACP provider with configuration', {
          agentId: request.agentId,
          hasSystemPrompt: !!systemPrompt,
          systemPromptLength: systemPrompt?.length || 0,
          systemPromptPreview: systemPrompt?.substring(0, 100),
          workspacePath,
          model: rawModelId,
          providerId,
          providerCommand: providerConfig?.command,
          explicitProvider: agentConfig?.provider || agentMetadata?.provider,
        });

        // DEBUG: Log metadata to diagnose tool restriction bug
        logger.info('[handleSendMessage] Agent metadata for provider creation', {
          agentId: request.agentId,
          hasMetadata: !!agentMetadata,
          metadataKeys: agentMetadata ? Object.keys(agentMetadata) : [],
          specialist: agentMetadata?.specialist,
          agentType: agentMetadata?.agentType,
          provider: agentMetadata?.provider,
        });

        provider = await registry.create(providerId, {
          provider: providerId,
          workspaceId: request.workspaceId,
          workspacePath,
          agentId: request.agentId,
          // CRITICAL FIX: Session ID Mapping for Stream Routing
          // ====================================================
          // When auggie starts, it creates its OWN internal sessionId (e.g., "febcf9b3-...")
          // via the session/new ACP request. However, the frontend identifies agents by
          // their agentId (e.g., "agent-0df30f15-...").
          //
          // Without this mapping:
          // 1. Frontend registers stream handlers keyed by agentId
          // 2. Auggie streams messages tagged with its internal sessionId
          // 3. Frontend never receives them (wrong key!) → agent appears stuck/empty
          //
          // By passing sessionId: agentId here, the ACP provider stores it as
          // `frontendSessionId` and uses it when routing stream messages back.
          // This ensures messages arrive at the correct frontend handler.
          //
          // This was a painful debug session (Dec 2024) - do not remove!
          sessionId: request.agentId,
          name: agentName,
          model: modelId, // Pass the full compound model ID, provider-registry will parse it
          systemPrompt,
          // Don't pass args here - provider-registry.ts will set them
          // to avoid duplicate flags
          // Pass remote workspace configuration
          isRemote,
          environmentConfig,
          // Pass agent metadata (contains modelFallbackChain for model retry logic)
          metadata: agentMetadata,
          // Pass persisted backend session ID so AcpProvider can resume via session/load
          // after Intent restart (when the in-memory previousSessionId is lost)
          backendSessionId: loadResult?.data?.backendSessionId ?? undefined,
          acpSessionId: loadResult?.data?.acpSessionId ?? undefined,
        });

        // Store provider for reuse and track its creation time
        this.providers.set(request.agentId, provider);
        this.touchProvider(request.agentId);

        // Track workspace association immediately when provider is created
        // This ensures cleanup works even if no message is ever sent
        if (request.workspaceId) {
          this.streamWorkspaceIds.set(request.agentId, request.workspaceId);
        }

        // Listen for session:created from the ACP provider to persist the backend session ID.
        // This fires on both session/new and session/load, giving us the auggie session ID
        // that can be used for session/load on future Intent restarts.
        provider.on('session:created', async (event: { sessionId: string; agentId: string }) => {
          try {
            const backend = await this.getBackend();
            const session = backend.getSession(event.agentId);
            if (session) {
              session.backendSessionId = event.sessionId as AgentId;
              session.acpSessionId = event.sessionId;
              // Persist to disk so it survives Intent restart
              await agentPersistence.saveAgent(session);
              logger.info('Persisted backendSessionId from session:created event', {
                agentId: event.agentId,
                backendSessionId: event.sessionId,
              });
            } else {
              logger.warn('session:created fired but no in-memory session found to update', {
                agentId: event.agentId,
                sessionId: event.sessionId,
              });
            }
          } catch (error) {
            logger.warn('Failed to persist backendSessionId from session:created', {
              agentId: event.agentId,
              sessionId: event.sessionId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        });

        // If the agent already has messages from persistence, mark the provider
        // as needing to send full history. This is critical for conversation continuity
        // when a new provider is created for an existing agent (e.g., after page reload).
        // The ACP session is fresh and has no history, so we need to include the full
        // conversation context in the next message.
        //
        // EXCEPTION: If session/load succeeded during provider initialization, the agent
        // already has the conversation context — no history resend needed.
        if (
          loadResult?.success &&
          loadResult.data?.messages &&
          loadResult.data.messages.length > 0
        ) {
          if (typeof provider.markSessionRecreated === 'function') {
            if (provider.didUseSessionLoad?.()) {
              logger.info('Skipping markSessionRecreated — session/load restored context', {
                agentId: request.agentId,
                existingMessageCount: loadResult.data.messages.length,
              });
            } else if (!loadResult.data?.acpSessionId) {
              // Brand new agent — never had a real ACP session, no history to resend
              logger.info('Skipping markSessionRecreated — brand new agent with no prior ACP session', {
                agentId: request.agentId,
                existingMessageCount: loadResult.data.messages.length,
              });
            } else {
              provider.markSessionRecreated();
              logger.info('Marked new provider as needing full history (existing agent)', {
                agentId: request.agentId,
                existingMessageCount: loadResult.data.messages.length,
              });
            }
          }
        }

        // CRITICAL FIX: Resume session in backend memory BEFORE streaming.
        // This ensures backend.getSession() returns a session during onComplete/onError
        // so messages get persisted to disk.
        //
        // NOTE: We resume even when messages are empty (e.g., freshly created workspace agent).
        // The workspace service saves agent config with messages: [] before the first message
        // is sent. Without resuming the session here, backend.getSession() returns null
        // throughout the streaming lifecycle, and neither the user message nor the assistant
        // response gets persisted to disk.
        if (loadResult?.success && loadResult.data) {
          const backend = await this.getBackend();
          const { AgentStatus } = await import('../../../shared/types/agent.types.js');
          const agentSession: AgentSession = {
            id: request.agentId as AgentId,
            workspaceId: request.workspaceId as WorkspaceId,
            name: loadResult.data.name || agentName || 'Agent',
            status: AgentStatus.Idle,
            model: modelId, // Use already-resolved provider-aware model
            systemPrompt: loadResult.data.systemPrompt || systemPrompt,
            messages: loadResult.data.messages || [],
            createdAt: loadResult.data.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            metadata: loadResult.data.metadata || {},
            backendSessionId: loadResult.data.backendSessionId,
            acpSessionId: loadResult.data.acpSessionId,
          };

          const resumeResult = await backend.resumeSession(agentSession);
          if (resumeResult.success) {
            logger.info('Resumed session in backend memory for persistence', {
              agentId: request.agentId,
              messageCount: agentSession.messages.length,
            });

            // Capture the initial session ID created during provider initialization.
            // The session:created listener above only catches FUTURE session creations
            // (edit/regenerate, interrupt, restart). The initial session is created inside
            // createProvider() before the listener is attached, so we capture it here.
            // NOTE: This must run AFTER resumeSession() so backend.getSession() returns
            // the in-memory session.
            try {
              const initialSessionId = provider.getSessionId?.();
              if (initialSessionId && typeof initialSessionId === 'string') {
                const session = backend.getSession(request.agentId);
                if (session) {
                  session.acpSessionId = initialSessionId;
                  // Persist to disk so it survives Intent restart
                  await agentPersistence.saveAgent(session);
                  logger.info('Captured initial acpSessionId from provider', {
                    agentId: request.agentId,
                    acpSessionId: initialSessionId,
                  });
                }
              }
            } catch (error) {
              logger.warn('Failed to capture initial acpSessionId', {
                agentId: request.agentId,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          } else {
            logger.warn('Failed to resume session in backend memory', {
              agentId: request.agentId,
              error: resumeResult.error,
            });
          }
        }

        // Register agent context for MCP tool calls
        try {
          const { getAgentContextRegistry } = await import('../agent-context-registry');
          const contextRegistry = getAgentContextRegistry();
          contextRegistry.register({
            agentId: request.agentId,
            agentName: agentName || request.agentId,
            sessionId: provider.sessionId || request.agentId,
            workspaceId: request.workspaceId || 'default',
            model: modelId, // Use already-resolved provider-aware model for delegation tools to inherit
            provider: providerId, // Explicit provider so child agents don't have to parse model string
            updatedAt: new Date(),
          });
          logger.info('Registered agent context', {
            agentId: request.agentId,
          });
        } catch (error) {
          logger.warn('Failed to register agent context', { error });
        }
      } else {
        // Provider exists but we might need to load messages if not passed
        // This happens when resuming a session after page refresh
        const extendedRequest = request as any;
        const backend = this.unifiedBackend;

        if (!extendedRequest.messages || extendedRequest.messages.length === 0) {
          // FIX: When resetHistory is true (edit/regenerate flow), do NOT load old messages
          // from persistence or memory. The frontend intends to start fresh with just the
          // new user message content. Loading old messages causes them to be appended,
          // resulting in duplicated conversation history visible only after page refresh.
          if (extendedRequest.resetHistory) {
            logger.info(
              'Provider exists, no messages passed, but resetHistory=true - skipping old message load (regenerate flow)',
              {
                agentId: request.agentId,
                workspaceId: request.workspaceId,
              },
            );

            // Reset ACP session to clear internal history
            if (provider && typeof (provider as any).resetSession === 'function') {
              try {
                await (provider as any).resetSession();
                logger.info('ACP session reset successfully (regenerate flow, empty messages)', {
                  agentId: request.agentId,
                });
              } catch (resetError) {
                logger.error('Failed to reset ACP session (regenerate flow)', {
                  agentId: request.agentId,
                  error: resetError instanceof Error ? resetError.message : String(resetError),
                });
              }
            }

            // Clear the in-memory backend session messages so subsequent operations
            // don't pick up stale history
            if (backend) {
              const backendSession = backend.getSession(request.agentId);
              if (backendSession) {
                const oldMessageCount = backendSession.messages?.length || 0;
                backendSession.messages = [];
                backendSession.updatedAt = new Date();
                logger.info('Cleared backend session messages (regenerate flow)', {
                  agentId: request.agentId,
                  oldMessageCount,
                });
              }
            }
          } else {
            logger.info('Provider exists but no messages passed, loading from persistence', {
              agentId: request.agentId,
              workspaceId: request.workspaceId,
            });

            // OPTIMIZATION: First try in-memory backend before hitting disk
            // This avoids disk I/O when the agent is already active in memory
            let loadedFromMemory = false;
            if (backend) {
              const inMemoryAgent = await backend.getAgent(request.agentId);
              if (inMemoryAgent?.messages && inMemoryAgent.messages.length > 0) {
                loadResult = { success: true, data: inMemoryAgent };
                loadedFromMemory = true;
                logger.info('Loaded messages from in-memory backend (existing provider)', {
                  agentId: request.agentId,
                  messageCount: inMemoryAgent.messages.length,
                });
              }
            }

            if (!loadedFromMemory) {
              // Load messages from persistence
              // DON'T pass workspacePath - let loadAgent use the correct metadata path internally
              loadResult = await agentPersistence.loadAgent(
                request.agentId as AgentId,
                request.workspaceId as WorkspaceId,
              );

              if (loadResult.success && loadResult.data) {
                logger.info('Messages loaded from persistence for existing provider', {
                  agentId: request.agentId,
                  messageCount: loadResult.data.messages?.length || 0,
                });

                // CRITICAL FIX: Resume session in backend memory when loaded from persistence.
                // This ensures backend.getSession() returns the session during onComplete
                // so the assistant response gets persisted to disk.
                // NOTE: We resume even when messages are empty — a freshly created workspace
                // agent has messages: [] on disk, but we still need backend.getSession() to
                // return a session so the user message and assistant response get persisted.
                if (backend) {
                  const { AgentStatus } = await import('../../../shared/types/agent.types.js');

                  // Resolve model with provider-aware fallback (only for non-default providers)
                  let sessionModel =
                    loadResult.data.model ||
                    loadResult.data.config?.model ||
                    request.model ||
                    DEFAULT_AGENT_MODEL;
                  const sessionProvider =
                    loadResult.data.config?.provider ||
                    loadResult.data.metadata?.provider ||
                    (request as any).provider;
                  if (sessionModel === DEFAULT_AGENT_MODEL && sessionProvider) {
                    const {
                      getDefaultModelForProvider,
                      getDefaultProviderId,
                      PROVIDER_MODEL_TIERS,
                    } = await import('$shared/config/provider-config');
                    const defaultProviderId = getDefaultProviderId();
                    // Only resolve for providers with known tier mappings
                    if (
                      sessionProvider !== defaultProviderId &&
                      sessionProvider in PROVIDER_MODEL_TIERS
                    ) {
                      const baseModel = getDefaultModelForProvider(sessionProvider, 'balanced');
                      sessionModel = `${sessionProvider}:${baseModel}`;
                    } else if (sessionProvider !== defaultProviderId) {
                      // Provider has dynamic models not in PROVIDER_MODEL_TIERS (e.g., opencode).
                      // Use 'default' to let the provider pick its own default model.
                      sessionModel = 'default';
                      logger.info(
                        'Using provider default model for provider without tier mappings',
                        {
                          agentId: request.agentId,
                          provider: sessionProvider,
                        },
                      );
                    }
                  }

                  const agentSession: AgentSession = {
                    id: request.agentId as AgentId,
                    workspaceId: request.workspaceId as WorkspaceId,
                    name: loadResult.data.name || agentName || 'Agent',
                    status: AgentStatus.Idle,
                    model: sessionModel,
                    systemPrompt: loadResult.data.systemPrompt,
                    messages: loadResult.data.messages || [],
                    createdAt: loadResult.data.createdAt || new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    metadata: loadResult.data.metadata || {},
                    backendSessionId: loadResult.data.backendSessionId,
                  };

                  const resumeResult = await backend.resumeSession(agentSession);
                  if (resumeResult.success) {
                    logger.info('Resumed session in backend memory (existing provider)', {
                      agentId: request.agentId,
                      messageCount: agentSession.messages.length,
                    });
                  } else {
                    logger.warn('Failed to resume session in backend memory (existing provider)', {
                      agentId: request.agentId,
                      error: resumeResult.error,
                    });
                  }
                }
              } else {
                logger.warn('Persistence load failed', {
                  agentId: request.agentId,
                  error: loadResult?.error,
                });
              }
            }
          }
        }
      }

      // Build messages array - include existing conversation history
      // CRITICAL: If the frontend passes messages, we MUST use them instead of loading from
      // in-memory storage or persistence. This is essential for edit-and-regenerate to work
      // correctly - the frontend truncates messages and passes the truncated list.
      const extendedRequest = request as any;
      let messages = extendedRequest.messages || [];
      let messagesFromFrontend = messages.length > 0;

      if (messagesFromFrontend) {
        // Validate that the last message is from user - if not, ignore frontend messages
        // This prevents the "Last message must be from user" error that can occur when
        // streaming placeholder messages are accidentally included
        const lastMessage = messages[messages.length - 1];
        if (lastMessage && lastMessage.role !== 'user') {
          logger.warn(
            'Backend: Frontend passed messages with last message not from user, ignoring frontend messages',
            {
              agentId: request.agentId,
              messageCount: messages.length,
              lastMessageRole: lastMessage.role,
              messageRoles: messages.map((m: any) => m.role),
            },
          );
          // Clear messages so we fall through to loading from persistence
          messages = [];
          messagesFromFrontend = false;
        } else {
          logger.info('Using messages from frontend (edit/regenerate flow)', {
            agentId: request.agentId,
            messageCount: messages.length,
            messageRoles: messages.map((m: any) => m.role),
            resetHistory: extendedRequest.resetHistory,
          });
        }

        // CRITICAL: If resetHistory is true, we need to reset the ACP session
        // The ACP session maintains its own internal history, so even if we pass
        // truncated messages, the session still has the old messages.
        // By resetting the session, we create a fresh session that will receive
        // the truncated history as context in the prompt.
        if (extendedRequest.resetHistory && provider) {
          logger.info('Resetting ACP session for edit/regenerate flow', {
            agentId: request.agentId,
            messageCount: messages.length,
          });
          try {
            // Check if provider has resetSession method (ACPProvider does)
            if (typeof (provider as any).resetSession === 'function') {
              // Calculate how many user turns were removed by comparing full vs truncated messages
              const backendForCount = this.unifiedBackend;
              let userTurnsToRemove = 1; // default fallback
              if (backendForCount) {
                const backendSessionForCount = backendForCount.getSession(request.agentId);
                if (backendSessionForCount?.messages) {
                  const fullUserCount = backendSessionForCount.messages.filter((m: any) => m.role === 'user').length;
                  const truncatedUserCount = messages.filter((m: any) => m.role === 'user').length;
                  const diff = fullUserCount - truncatedUserCount;
                  if (diff > 0) {
                    userTurnsToRemove = diff;
                  }
                  logger.info('Calculated userTurnsToRemove for session trim', {
                    fullUserCount,
                    truncatedUserCount,
                    userTurnsToRemove,
                  });
                }
              }
              await (provider as any).resetSession(userTurnsToRemove);
              logger.info('ACP session reset successfully', {
                agentId: request.agentId,
              });
            } else {
              logger.warn('Provider does not support resetSession', {
                agentId: request.agentId,
              });
            }
          } catch (resetError) {
            logger.error('Failed to reset ACP session', {
              agentId: request.agentId,
              error: resetError instanceof Error ? resetError.message : String(resetError),
            });
            // Continue anyway - the message will still be sent, just with old history
          }

          // CRITICAL FIX: Also update the in-memory backend session with the truncated messages
          // Without this, subsequent messages would load the OLD messages from the in-memory
          // backend, causing history corruption after edit/regenerate flows.
          const backend = await this.getBackend();
          const backendSession = backend.getSession(request.agentId);
          if (backendSession) {
            const oldMessageCount = backendSession.messages?.length || 0;
            // Replace the backend session's messages with the truncated messages from frontend
            backendSession.messages = [...messages];
            backendSession.updatedAt = new Date();
            logger.info('Updated backend session with truncated messages (edit/regenerate flow)', {
              agentId: request.agentId,
              oldMessageCount,
              newMessageCount: messages.length,
            });

            // Also persist to disk immediately so refresh doesn't lose the edit
            // This is fire-and-forget since we don't want to block the message send
            agentPersistence.saveAgent(backendSession).then((saveResult) => {
              if (saveResult.success) {
                logger.info('Persisted truncated messages to disk (edit/regenerate flow)', {
                  agentId: request.agentId,
                  messageCount: messages.length,
                });
              } else {
                logger.warn('Failed to persist truncated messages to disk', {
                  agentId: request.agentId,
                  error: saveResult.error,
                });
              }
            });
          } else {
            logger.warn(
              'Backend: No backend session for edit/regenerate — truncated messages will NOT be persisted',
              {
                agentId: request.agentId,
                messageCount: messages.length,
              },
            );
          }
        }
      }

      // If no messages were passed but we have a loaded agent with messages,
      // use those to maintain conversation continuity
      if (messages.length === 0 && loadResult?.success && loadResult.data?.messages) {
        logger.info('Using messages from loaded agent for conversation continuity', {
          agentId: request.agentId,
          messageCount: loadResult.data.messages.length,
        });
        messages = [...loadResult.data.messages];

        // Debug: Log details about each message's contentBlocks
        for (let i = 0; i < messages.length; i++) {
          const msg = messages[i];
          const textBlock = msg.contentBlocks?.find((b: any) => b.type === 'text');
          logger.debug('Loaded message details', {
            agentId: request.agentId,
            messageIndex: i,
            role: msg.role,
            hasContentBlocks: !!msg.contentBlocks,
            contentBlocksCount: msg.contentBlocks?.length || 0,
            contentBlockTypes: msg.contentBlocks?.map((b: any) => b.type) || [],
            hasTextBlock: !!textBlock,
            textBlockHasText: !!textBlock?.text,
            textBlockHasContent: !!textBlock?.content,
            textLength: (textBlock?.text || textBlock?.content || '').length,
            textPreview: (textBlock?.text || textBlock?.content || '').substring(0, 100),
          });
        }
      }

      // Add the current message with required id and timestamp
      // We keep the original content for display/persistence, but create a separate
      // message with the mode prompt for sending to the agent
      const originalContent = request.content || '';

      // Check if we should skip adding the user message (already added by createAgent)
      // Also skip if messages came from frontend (edit/regenerate flow) - the user message
      // is already included in the messages array passed from the frontend
      //
      // CRITICAL FIX: Also check if the user message already exists in loaded messages.
      // This prevents duplicates when messaging a stopped agent:
      // 1. Frontend adds user message and saves to disk
      // 2. Backend loads from disk (includes user message)
      // 3. Backend would add user message AGAIN without this check
      // Check recent messages (last 5) for duplicate, matching frontend logic (agent.service.ts:2757)
      let userMessageAlreadyExists = false;
      if (messages.length > 0 && originalContent) {
        // Check if the LAST message is already this user message
        // We only skip adding if the user message is already at the end (pending response)
        // If there's an assistant message after a matching user message, this is a NEW request
        // (e.g., user retrying after an error) and we should NOT skip
        const lastMessage = messages[messages.length - 1];
        if (lastMessage?.role === 'user') {
          const textBlock = lastMessage.contentBlocks?.find((b: any) => b.type === 'text');
          const lastMsgContent = textBlock?.text || textBlock?.content || '';
          if (lastMsgContent === originalContent) {
            userMessageAlreadyExists = true;
            logger.info(
              'Backend: User message already exists as last message, skipping duplicate',
              {
                agentId: request.agentId,
                messageId: lastMessage.id,
                contentPreview: originalContent.substring(0, 50),
              },
            );
          }
        }
        // Note: If the same content exists earlier in conversation but not as the last message,
        // we DO add it again because this is a new request (possibly a retry after error)
      }

      const skipUserMessage =
        (request as any).skipUserMessage === true ||
        messagesFromFrontend ||
        userMessageAlreadyExists;

      // DEFENSIVE CHECK: When skipUserMessage is true, the last message MUST be from user.
      // If it isn't, the ACP provider will throw "Last message must be from user".
      // This can happen when backend-initiated wake-ups load stale messages from disk
      // that don't include the wake message added to the in-memory session.
      if (skipUserMessage && messages.length > 0) {
        const lastMsg = messages[messages.length - 1];
        if (lastMsg?.role !== 'user') {
          logger.warn(
            'Backend: skipUserMessage is true but last message is not from user - attempting recovery from in-memory session',
            {
              agentId: request.agentId,
              lastMessageRole: lastMsg?.role,
              messageCount: messages.length,
            },
          );

          // Try to get messages from the in-memory backend session, which should
          // have the wake message that was added by sendBackendInitiatedMessage
          const backend = await this.getBackend();
          const backendSession = backend.getSession(request.agentId);
          if (backendSession?.messages && backendSession.messages.length > 0) {
            const inMemoryLast = backendSession.messages[backendSession.messages.length - 1];
            if (inMemoryLast?.role === 'user') {
              logger.warn(
                'Backend: Recovered messages from in-memory session - last message is from user',
                {
                  agentId: request.agentId,
                  diskMessageCount: messages.length,
                  inMemoryMessageCount: backendSession.messages.length,
                  recoveredLastMessageRole: inMemoryLast.role,
                },
              );
              messages = [...backendSession.messages];
            } else {
              logger.error(
                'Backend: In-memory session also does not end with user message - cannot recover',
                {
                  agentId: request.agentId,
                  inMemoryLastRole: inMemoryLast?.role,
                  inMemoryMessageCount: backendSession.messages.length,
                },
              );
            }
          } else {
            logger.error('Backend: No in-memory session available for recovery', {
              agentId: request.agentId,
              hasBackendSession: !!backendSession,
              inMemoryMessageCount: backendSession?.messages?.length || 0,
            });
          }
        }
      }

      // Create user message with ORIGINAL content for display and persistence
      // Skip if the message was already added (e.g., during agent creation)
      // Use queuedMessageId if provided (for queued messages) to ensure frontend and backend use the same ID
      //
      // IMPORTANT: We maintain TWO sets of content blocks:
      // 1. displayContentBlocks - for UI display and persistence (user's actual content)
      // 2. agentContentBlocks - includes injected note images for the agent to see
      const displayContentBlocks: ContentBlock[] = [{ type: 'text', text: originalContent }];
      const agentContentBlocks: ContentBlock[] = [{ type: 'text', text: originalContent }];

      // Extract images from notes if noteIds are provided
      // This allows agents to "see" images in notes since auggie doesn't support
      // multi-modal tool results in ACP - we inject them into the prompt instead
      // NOTE: These are NOT added to displayContentBlocks since user didn't attach them
      if (request.noteIds && request.noteIds.length > 0 && request.workspaceId) {
        try {
          const { notesService } = await import('../../notes/main/notes.service');
          const { assetsService } = await import('../../notes/main/assets.service');

          for (const noteId of request.noteIds) {
            const noteResult = await notesService.getNote(
              request.workspaceId as WorkspaceId,
              noteId as NoteId,
            );
            if (noteResult.ok && noteResult.data?.content) {
              // Extract all image URLs from note content (both workspace-asset:// and http(s)://)
              const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
              let match;

              while ((match = imageRegex.exec(noteResult.data.content)) !== null) {
                const url = match[2];
                try {
                  if (url.startsWith('workspace-asset://')) {
                    // Parse the workspace-asset URL: workspace-asset://workspaceId/assetId
                    const urlMatch = url.match(/workspace-asset:\/\/([^/]+)\/(.+)/);
                    if (urlMatch) {
                      const assetId = urlMatch[2];
                      const dataUrl = await assetsService.readAssetAsDataUrl(
                        request.workspaceId,
                        assetId,
                      );

                      // Parse data URL to extract base64 and mimeType
                      const dataMatch = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
                      if (dataMatch) {
                        // Only add to agent blocks, not display blocks
                        agentContentBlocks.push({
                          type: 'image',
                          data: dataMatch[2],
                          mimeType: dataMatch[1],
                        } as ContentBlock);
                      }
                    }
                  } else if (url.startsWith('http://') || url.startsWith('https://')) {
                    // Fetch external image and convert to base64
                    const response = await fetch(url);
                    if (response.ok) {
                      const contentType = response.headers.get('content-type') || 'image/jpeg';
                      // Only process image content types
                      if (contentType.startsWith('image/')) {
                        const arrayBuffer = await response.arrayBuffer();
                        const base64 = Buffer.from(arrayBuffer).toString('base64');
                        // Only add to agent blocks, not display blocks
                        agentContentBlocks.push({
                          type: 'image',
                          data: base64,
                          mimeType: contentType,
                        } as ContentBlock);
                      }
                    }
                  }
                } catch (imgError) {
                  logger.warn('Failed to extract image from note for prompt', {
                    noteId,
                    url,
                    error: (imgError as Error).message,
                  });
                }
              }
            }
          }

          const imageCount = agentContentBlocks.filter((b) => b.type === 'image').length;
          if (imageCount > 0) {
            // Add a text note to tell the agent that images are included in this prompt
            // Append to the agent's text block (not display block)
            const imageInfoText = `\n\n[System: ${imageCount} image(s) from the current note are attached to this message. You can see them directly - no need to call read_asset or read_note to view them.]`;
            const textBlock = agentContentBlocks.find((b) => b.type === 'text');
            if (textBlock && 'text' in textBlock) {
              textBlock.text = textBlock.text + imageInfoText;
            }

            logger.debug('Backend: Extracted images from notes for agent prompt', {
              agentId: request.agentId,
              noteIds: request.noteIds,
              imageCount,
            });
          }
        } catch (error) {
          logger.warn('Failed to extract images from notes', {
            agentId: request.agentId,
            noteIds: request.noteIds,
            error: (error as Error).message,
          });
        }
      }

      // User-attached images go to BOTH display and agent blocks
      if (request.imageBlocks && request.imageBlocks.length > 0) {
        for (const imageBlock of request.imageBlocks) {
          const imgBlock = {
            type: 'image',
            data: imageBlock.data,
            mimeType: imageBlock.mimeType,
          } as ContentBlock;
          displayContentBlocks.push(imgBlock);
          agentContentBlocks.push(imgBlock);
        }
        logger.info('Backend: Added image blocks to user message', {
          agentId: request.agentId,
          imageCount: request.imageBlocks.length,
          imageDataSizes: request.imageBlocks.map((b) => ({
            mimeType: b.mimeType,
            dataLength: b.data?.length || 0,
          })),
        });
      } else {
        logger.info('Backend: No image blocks in request', {
          agentId: request.agentId,
          hasImageBlocks: !!request.imageBlocks,
          imageBlocksLength: request.imageBlocks?.length,
        });
      }

      // User-attached files go to BOTH display and agent blocks
      if (request.fileBlocks && request.fileBlocks.length > 0) {
        for (const fileBlock of request.fileBlocks) {
          const fBlock = {
            type: 'file',
            data: fileBlock.data,
            mimeType: fileBlock.mimeType,
            fileName: fileBlock.fileName,
          } as ContentBlock;
          displayContentBlocks.push(fBlock);
          agentContentBlocks.push(fBlock);
        }
        logger.info('Backend: Added file blocks to user message', {
          agentId: request.agentId,
          fileCount: request.fileBlocks.length,
          fileDataSizes: request.fileBlocks.map((b) => ({
            fileName: b.fileName,
            mimeType: b.mimeType,
            dataLength: b.data?.length || 0,
          })),
        });
      } else {
        logger.info('Backend: No file blocks in request', {
          agentId: request.agentId,
          hasFileBlocks: !!request.fileBlocks,
          fileBlocksLength: request.fileBlocks?.length,
        });
      }

      // Check if there are any non-text content blocks (images, files) that justify creating a message
      const hasAttachments =
        (request.imageBlocks && request.imageBlocks.length > 0) ||
        (request.fileBlocks && request.fileBlocks.length > 0);

      // User message for display/persistence uses displayContentBlocks
      const userMessage =
        (originalContent || hasAttachments) && !skipUserMessage
          ? {
              id: (request as any).queuedMessageId || `msg_${uuidv4()}`,
              role: 'user',
              contentBlocks: displayContentBlocks,
              timestamp: new Date().toISOString(),
              // Include message metadata if provided (e.g., source: 'system' for system-initiated messages)
              ...(request.messageMetadata && { metadata: request.messageMetadata }),
            }
          : null;

      if (userMessage) {
        messages.push(userMessage);

        // CRITICAL: Also update the backend session's messages
        const backend = await this.getBackend();
        const backendSession = backend.getSession(request.agentId);
        if (backendSession) {
          if (!backendSession.messages) {
            backendSession.messages = [];
          }
          backendSession.messages.push(userMessage);
          backendSession.updatedAt = new Date();
          logger.debug('Backend: Added user message to backend session', {
            agentId: request.agentId,
            messageId: userMessage.id,
            usedQueuedMessageId: !!(request as any).queuedMessageId,
            messageCount: backendSession.messages.length,
          });

          // CRITICAL: Persist user message to disk immediately so it survives page refresh.
          // Without this, the user message only exists in memory until the stream completes
          // (or 50 streaming chunks), meaning a refresh during streaming loses the message.
          agentPersistence.saveAgent(backendSession).then((saveResult) => {
            if (saveResult.success) {
              logger.debug('Backend: Persisted user message to disk immediately', {
                agentId: request.agentId,
                messageId: userMessage.id,
                messageCount: backendSession.messages.length,
              });
            } else {
              logger.warn('Backend: Failed to persist user message to disk', {
                agentId: request.agentId,
                error: saveResult.error,
              });
            }
          });
        } else {
          // backendSession is null — the user message won't be persisted to disk.
          // This should not happen after the resumeSession fix (which ensures the session
          // is always resumed in memory when loaded from persistence). If this warning fires,
          // it indicates a regression or a code path that skipped resumeSession.
          logger.error(
            'Backend: No backend session found — user message will NOT be persisted to disk. ' +
              'This is a data-loss risk. The session should have been resumed during provider creation.',
            {
              agentId: request.agentId,
              messageId: userMessage.id,
            },
          );
        }
      } else if (skipUserMessage) {
        logger.debug('Backend: Skipping user message addition (already in messages array)', {
          agentId: request.agentId,
          reason: messagesFromFrontend ? 'messagesFromFrontend' : 'skipUserMessage flag',
        });
      }

      // Create a separate messages array for the agent that includes injected prompts
      // This ensures the user sees their original message, but the agent gets additional context
      let messagesForAgent = [...messages];

      // Check if this is the first message (no assistant responses yet)
      // Add naming instructions for the agent on first message, but only when needed for token efficiency
      const hasAssistantMessage = messages.some((m: any) => m.role === 'assistant');
      const isFirstMessage = !hasAssistantMessage;

      // Build naming instructions for first message
      let namingInstructions = '';
      if (isFirstMessage) {
        // Fetch workspace for naming instructions (lazy - may already be fetched for provider creation)
        await fetchWorkspaceIfNeeded();
        const workspaceTitle = workspace?.title || '';
        // Only prompt for rename if we successfully fetched workspace data
        // If workspace is null (fetch failed), don't show false rename prompt
        const needsWorkspaceRename =
          workspace != null &&
          (!workspaceTitle || workspaceTitle.trim() === '' || isWorkspaceSlug(workspaceTitle));

        // Check if agent needs a custom name (has random "Adjective Animal" pattern like "Swift Falcon")
        const needsAgentRename = isRandomAgentName(agentName);

        // Only add instructions that are actually needed
        // NOTE: Tool names include the MCP server suffix (e.g., _workspace-mcp) because
        // that's how agents see them in their tool list
        if (needsWorkspaceRename && needsAgentRename) {
          namingInstructions = `<system>
This workspace needs a title. Call \`set_workspace_title_workspace-mcp\` and \`set_agent_name_workspace-mcp\` as your first actions. These can be called in parallel with information-gathering.
</system>

`;
        } else if (needsWorkspaceRename) {
          namingInstructions = `<system>
This workspace needs a title. Call \`set_workspace_title_workspace-mcp\` as your first action. This can be called in parallel with information-gathering.
</system>

`;
        } else if (needsAgentRename) {
          namingInstructions = `<system>
Call \`set_agent_name_workspace-mcp\` to name yourself based on your task. This can be called in parallel with information-gathering.
</system>

`;
        }
        // If neither needs renaming, namingInstructions stays empty - no tokens wasted

        if (namingInstructions) {
          logger.debug('Adding naming instructions to first message', {
            agentId: request.agentId,
            needsWorkspaceRename,
            needsAgentRename,
          });
        }
      }

      // Build the message for the agent with injected content (note images, etc.)
      // NOTE: Mode behavior prompts were removed - modes are only used for tool filtering now
      // The persisted userMessage uses displayContentBlocks, but the agent needs agentContentBlocks
      if (originalContent || hasAttachments) {
        const lastUserMsgIndex = messages.findLastIndex((m: any) => m.role === 'user');
        if (lastUserMsgIndex >= 0) {
          const lastUserMsg = messages[lastUserMsgIndex];
          // Build agent content blocks: text + note images + user images
          const agentTextContent = originalContent;

          // Use agentContentBlocks which includes note-extracted images
          // The first block is the text, followed by any images
          const agentMsgContentBlocks: ContentBlock[] = [];

          // Get text with any injected system notes from agentContentBlocks
          // Prepend naming instructions for first message
          const agentTextBlock = agentContentBlocks.find((b) => b.type === 'text');
          if (agentTextBlock && 'text' in agentTextBlock) {
            agentMsgContentBlocks.push({
              type: 'text',
              text: namingInstructions + agentTextBlock.text,
            });
          } else {
            agentMsgContentBlocks.push({
              type: 'text',
              text: namingInstructions + agentTextContent,
            });
          }

          // Add all image and file blocks from agentContentBlocks (includes note images + user images/files)
          for (const block of agentContentBlocks) {
            if (block.type === 'image' || block.type === 'file') {
              agentMsgContentBlocks.push(block);
            }
          }

          const userMessageWithContext = {
            ...lastUserMsg,
            contentBlocks: agentMsgContentBlocks,
          };
          messagesForAgent = [
            ...messages.slice(0, lastUserMsgIndex),
            userMessageWithContext,
            ...messages.slice(lastUserMsgIndex + 1),
          ];
        }
      }

      // Track stream start time, sessionId, workspaceId, and sender window ID
      // Increment stream generation so stale cleanup callbacks (from interrupted streams)
      // can detect they belong to an older generation and skip map deletions.
      const streamGeneration = (this.streamGenerations.get(request.agentId) || 0) + 1;
      this.streamGenerations.set(request.agentId, streamGeneration);
      this.streamStartTimes.set(request.agentId, Date.now());
      this.streamSessionIds.set(request.agentId, request.sessionId);
      this.streamWorkspaceIds.set(request.agentId, request.workspaceId);
      // Track the sender window ID for targeted stream delivery (prevents crossed streams)
      if ((request as any)._senderWindowId !== undefined) {
        this.streamWindowIds.set(request.agentId, (request as any)._senderWindowId);
      }

      // SAFETY NET: Notify frontend that a stream is starting for this agent.
      // This allows the frontend to register a stream handler if one doesn't exist yet.
      // This fixes the race condition where:
      // 1. Workspace is recreated with the same ID
      // 2. reconnectToBackendStreams() runs before the backend sets streamStartTimes
      // 3. Frontend never registers a handler for the new agent
      // 4. Chunks are sent but silently dropped
      // The notification is fire-and-forget — we don't wait for a response.
      // The frontend will register a handler if needed before the first chunk arrives,
      // since there's significant async work between here and the first chunk.
      //
      // Send to all windows viewing this workspace so they can all register stream handlers.
      // Since sendStreamToRenderer now targets all workspace windows (not just the initiator),
      // all windows will receive both chunks and the complete event, so no orphaned handlers.
      const workspaceWindowIds = getWindowIdsForWorkspace(request.workspaceId);
      const useBroadcastFallback = workspaceWindowIds.length === 0;
      logger.info('agent:stream-starting emission', {
        agentId: request.agentId,
        workspaceId: request.workspaceId,
        sessionId: request.sessionId,
        windowIds: workspaceWindowIds,
        windowCount: workspaceWindowIds.length,
        useBroadcastFallback,
      });
      this.sendToRenderer(
        'agent:stream-starting',
        {
          agentId: request.agentId,
          workspaceId: request.workspaceId,
          sessionId: request.sessionId,
        },
        workspaceWindowIds.length > 0 ? workspaceWindowIds : undefined,
      );

      // Update provider last used time (prevents idle cleanup during active use)
      this.touchProvider(request.agentId);

      // Memory instrumentation: agent turn starting
      // Include session size metrics to correlate with memory usage
      const backendForMetrics = await this.getBackend();
      const sessionForMetrics = backendForMetrics.getSession(request.agentId);
      const messageCount = sessionForMetrics?.messages?.length ?? 0;
      const totalMessagesKB = sessionForMetrics
        ? this.estimateSessionSizeKB(sessionForMetrics.messages)
        : 0;

      memEvents.agentTurnStart(request.agentId, {
        messageQueueSize: this.messageQueues.get(request.agentId)?.length ?? 0,
        messageCount,
        totalMessagesKB,
        activeProviders: this.providers.size,
        activeStreams: this.streamStartTimes.size,
      });

      // Mark agent as responding for event subscription service
      // This allows events to be queued until the agent becomes idle
      try {
        const { updateAgentStatus } =
          await import('../../events/main/agent-subscription-ops');
        updateAgentStatus(request.workspaceId, request.agentId, 'responding');
      } catch (err) {
        logger.warn('Failed to set agent status to responding', {
          agentId: request.agentId,
          error: err,
        });
      }

      // Emit agent:started event for activity log
      this.emitAgentStartedEvent(
        request.agentId,
        request.workspaceId,
        agentName,
        (request as any).model,
      );

      // Start health check for this stream
      this.startStreamHealthCheck(request.agentId);

      // NOTE: Message accumulation is handled by messageAccumulator service (single source of truth)
      // The messageAccumulator is used by ACPProvider to accumulate text chunks and content blocks
      // This handler just forwards events to the frontend and uses messageAccumulator on complete

      // Stream the response directly to the renderer
      logger.debug('Backend: About to call provider.streamMessage', {
        agentId: request.agentId,
        hasProvider: !!provider,
        messagesCount: messages.length,
      });

      // Track chunk count for periodic persistence
      let chunkCount = 0;
      const PERSIST_EVERY_N_CHUNKS = 50;
      let persistInProgress = false;

      // Helper to persist current state during streaming using messageAccumulator
      const persistStreamingState = async (reason: string) => {
        if (persistInProgress) return; // Don't overlap persistence calls
        persistInProgress = true;

        try {
          const backend = await this.getBackend();
          const backendSession = backend.getSession(request.agentId);
          if (backendSession) {
            // Get current content blocks from messageAccumulator (single source of truth)
            const { contentBlocks: currentContentBlocks } = messageAccumulator.getPartialContent(
              request.agentId,
            );

            // Create/update streaming assistant message
            // Look for existing streaming message or create new one
            const existingStreamingMsgIndex = backendSession.messages.findIndex(
              (m: any) => m.role === 'assistant' && m.isStreaming,
            );

            const streamingMessage = {
              id:
                existingStreamingMsgIndex >= 0
                  ? backendSession.messages[existingStreamingMsgIndex].id
                  : `msg_${uuidv4()}`,
              role: 'assistant' as const,
              contentBlocks: currentContentBlocks,
              timestamp: new Date().toISOString(),
              isStreaming: true, // Mark as in-progress
            };

            if (existingStreamingMsgIndex >= 0) {
              backendSession.messages[existingStreamingMsgIndex] = streamingMessage;
            } else {
              backendSession.messages.push(streamingMessage);
            }
            backendSession.updatedAt = new Date();

            // Persist to disk
            const saveResult = await agentPersistence.saveAgent(backendSession);
            if (saveResult.success) {
              logger.debug('Backend: Streaming state persisted', {
                agentId: request.agentId,
                reason,
                blocksCount: currentContentBlocks.length,
              });
            }
          } else {
            logger.warn(
              'Backend: No backend session during streaming — streaming state will NOT be persisted',
              {
                agentId: request.agentId,
                reason,
              },
            );
          }
        } catch (error) {
          logger.warn('Backend: Failed to persist streaming state', {
            agentId: request.agentId,
            reason,
            error: error instanceof Error ? error.message : String(error),
          });
        } finally {
          persistInProgress = false;
        }
      };

      // Build stdinContext from contextReferences if not already provided
      // This allows selected text and other context to be passed to the agent
      let stdinContext = request.stdinContext;
      if (!stdinContext && request.contextReferences && request.contextReferences.length > 0) {
        const contextParts: string[] = [];
        for (const ref of request.contextReferences) {
          // Support both ContextReference format (selectedText, taskText, codeChunk)
          // and AgentContext format (content)
          const content = ref.content || ref.selectedText || ref.taskText || ref.codeChunk;
          // Also support 'path' (AgentContext) and 'filePath' (ContextReference)
          const filePath = ref.path || ref.filePath;
          if (content) {
            let contextEntry = '';
            if (ref.type === 'selection') {
              contextEntry = `Selected text:\n${content}`;
            } else if (ref.type === 'task') {
              contextEntry = `Task:\n${content}`;
            } else if (ref.type === 'code_chunk') {
              contextEntry = `Code:\n${content}`;
            } else if (ref.type === 'file' && filePath) {
              contextEntry = `File ${filePath}:\n${content}`;
            } else if (ref.type === 'linear-issue') {
              contextEntry = `Linear Issue:\n${content}`;
            } else if (ref.type === 'github-issue') {
              contextEntry = `GitHub Issue:\n${content}`;
            } else if (ref.type === 'sentry-issue') {
              contextEntry = `Sentry Issue:\n${content}`;
            } else if (ref.type === 'terminal') {
              const terminalId = ref.metadata?.terminalId || 'unknown';
              const terminalName = ref.metadata?.terminalName || ref.title || 'Terminal';
              contextEntry = `Terminal "${terminalName}" (terminal_id: ${terminalId}):\n${content}`;
            } else {
              contextEntry = content;
            }
            contextParts.push(contextEntry);
          } else if (ref.type === 'file' && filePath) {
            // File reference without content - try to read the file from disk
            try {
              if (fs.existsSync(filePath) && !isBinaryExtension(filePath)) {
                // Text file: read content and include inline (up to 100KB)
                const stats = fs.statSync(filePath);
                if (stats.size <= 100 * 1024) {
                  const fileContent = fs.readFileSync(filePath, 'utf-8');
                  const ext = path.extname(filePath).replace('.', '') || 'text';
                  contextParts.push(`File ${filePath}:\n\`\`\`${ext}\n${fileContent}\n\`\`\``);
                } else {
                  contextParts.push(
                    `File: ${filePath} (text file, ${Math.round(stats.size / 1024)}KB - too large to inline)`,
                  );
                }
              } else if (fs.existsSync(filePath)) {
                // Binary file (PDF, etc.): provide absolute path so agent can access it
                contextParts.push(
                  `File: ${filePath} (binary file - use file tools to read this file)`,
                );
              } else {
                // File doesn't exist at path
                contextParts.push(`File: ${filePath}`);
              }
            } catch (readError) {
              logger.warn('Failed to read file for context reference', {
                filePath,
                error: readError,
              });
              contextParts.push(`File: ${filePath}`);
            }
          } else if (ref.type === 'note' && (ref.noteId || ref.metadata?.noteId)) {
            // Note reference - just mention the note ID
            contextParts.push(`Note: ${ref.noteId || ref.metadata?.noteId}`);
          }
        }
        if (contextParts.length > 0) {
          stdinContext = contextParts.join('\n\n');
          logger.info('Built stdinContext from contextReferences', {
            agentId: request.agentId,
            contextReferencesCount: request.contextReferences.length,
            stdinContextLength: stdinContext.length,
          });
        }
      }

      // Set up status callback on the provider BEFORE streamMessage so we capture
      // early lifecycle events (launchAgent, initializeProtocol) that fire before streaming starts.
      if (typeof (provider as any).setStatusCallback === 'function') {
        (provider as any).setStatusCallback((statusData: { phase: string; message: string; level: 'info' | 'warn' | 'error'; timestamp: number }) => {
          this.sendStreamToRenderer(request.agentId, `agent:stream:${request.agentId}`, {
            type: 'status',
            data: statusData,
            streamId: request.streamId,
            sessionId: request.agentId,
          });
        });
      }

      // Use messagesForAgent which includes the mode prompt, not the original messages
      await provider.streamMessage(messagesForAgent, {
        frontendSessionId: request.agentId, // Pass the agentId as frontendSessionId
        stdinContext, // Pass context from contextReferences or request.stdinContext
        onChunk: (chunk: string) => {
          // PERF: Changed from INFO to DEBUG - chunks are very frequent during streaming
          // Only log occasionally at INFO level to avoid log spam
          chunkCount++;

          // Log the first chunk of a new turn - useful for debugging handler lifecycle
          if (chunkCount === 1) {
            logger.debug('First chunk received for turn - streaming has started', {
              agentId: request.agentId,
              streamId: request.streamId,
              chunkLength: chunk.length,
              timestamp: Date.now(),
              note: 'If frontend does not receive this, stream handler is not registered',
            });
          }

          // Log every 50th chunk at debug, every 100th at info for tracing
          if (chunkCount % 100 === 0) {
            logger.info('Backend: Streaming progress', {
              agentId: request.agentId,
              chunkCount,
              chunkLength: chunk.length,
            });
          } else if (chunkCount % 50 === 0 || chunkCount <= 2) {
            logger.debug('Backend: onChunk callback', {
              agentId: request.agentId,
              chunkCount,
              chunkLength: chunk.length,
              chunkPreview: chunk.substring(0, 50),
            });
          }

          // NOTE: Text accumulation is handled by messageAccumulator in ACPProvider
          // We just forward chunks to frontend and persist periodically

          // Persist periodically during streaming
          if (chunkCount % PERSIST_EVERY_N_CHUNKS === 0) {
            persistStreamingState(`chunk ${chunkCount}`);
          }

          this.sendStreamToRenderer(request.agentId, `agent:stream:${request.agentId}`, {
            type: 'chunk',
            data: chunk,
            streamId: request.streamId,
            sessionId: request.agentId,
          });
        },
        onContentBlocks: (blocks: ContentBlock[]) => {
          logger.debug('Backend: onContentBlocks callback called', {
            agentId: request.agentId,
            blockCount: blocks.length,
          });

          // Keep provider alive during streaming - tool calls can take a long time
          // and we don't want the idle cleanup to kill an active agent
          this.touchProvider(request.agentId);

          // NOTE: Content block accumulation is handled by messageAccumulator in ACPProvider
          // We just forward blocks to frontend and persist

          // Persist on every tool call/content block (important state change)
          persistStreamingState('content-block');

          // Send content blocks (tool calls) to the renderer
          this.sendStreamToRenderer(request.agentId, `agent:stream:${request.agentId}`, {
            type: 'content-blocks',
            data: blocks,
            streamId: request.streamId,
            sessionId: request.agentId,
          });
        },
        onComplete: async (providerMessage?: any) => {
          // Idempotency guard: prevent duplicate onComplete calls for the same streamId
          // This defends against race conditions where both the streaming 'done' event and
          // the JSON-RPC prompt response with stopReason trigger completion
          const agentCompletedStreams =
            this.completedStreams.get(request.agentId) || new Set<string>();
          if (agentCompletedStreams.has(request.streamId)) {
            logger.warn('Backend: onComplete called twice for same streamId, ignoring duplicate', {
              agentId: request.agentId,
              streamId: request.streamId,
            });
            return;
          }
          agentCompletedStreams.add(request.streamId);
          this.completedStreams.set(request.agentId, agentCompletedStreams);

          // Final content is provided by providerMessage from messageAccumulator (single source of truth)
          const finishReason = providerMessage?.metadata?.stopReason || 'unknown';

          logger.info('Backend: onComplete callback called', {
            agentId: request.agentId,
            streamId: request.streamId,
            finishReason,
            hasProviderMessage: !!providerMessage,
            providerContentBlocksCount: providerMessage?.contentBlocks?.length || 0,
          });

          // Use the provider's accumulated content from messageAccumulator
          // Fall back to getting partial content directly from messageAccumulator if provider didn't pass it
          let finalContentBlocks: ContentBlock[];

          if (providerMessage?.contentBlocks?.length > 0) {
            // Use the provider's accumulated content - this is the authoritative source
            finalContentBlocks = providerMessage.contentBlocks;
            logger.debug('Backend: Using provider contentBlocks', {
              agentId: request.agentId,
              blockCount: finalContentBlocks.length,
              blockTypes: finalContentBlocks.map((b) => b.type),
              hasTextBlock: finalContentBlocks.some((b) => b.type === 'text'),
              textBlockPreview: finalContentBlocks
                .find((b) => b.type === 'text')
                ?.text?.substring(0, 100),
            });
          } else {
            // Fall back to getting content directly from messageAccumulator
            const { contentBlocks } = messageAccumulator.getPartialContent(request.agentId);
            finalContentBlocks = contentBlocks;
            logger.debug('Backend: Falling back to messageAccumulator.getPartialContent', {
              agentId: request.agentId,
              blockCount: finalContentBlocks.length,
              blockTypes: finalContentBlocks.map((b) => b.type),
              hasTextBlock: finalContentBlocks.some((b) => b.type === 'text'),
              textBlockPreview: finalContentBlocks
                .find((b) => b.type === 'text')
                ?.text?.substring(0, 100),
            });
          }

          // AUTO-CONTINUE: Detect empty end_turn responses and retry automatically.
          // The LLM sometimes returns end_turn with only whitespace text content (e.g., "\n\n"),
          // causing the agent to go idle prematurely. Users then have to manually prompt
          // "please continue" to get the agent working again. This detects the pattern and
          // auto-continues instead of going idle.
          const MAX_EMPTY_RESPONSE_RETRIES = 3;
          if (finishReason === 'end_turn') {
            const allTextContent = finalContentBlocks
              .filter((b: ContentBlock) => b.type === 'text')
              .map((b: ContentBlock) => b.text || '')
              .join('')
              .trim();

            // Only consider the response "empty" if there are no meaningful content blocks.
            // Responses with tool_use, tool_result, code, image, etc. are NOT empty even
            // if they have no text — the LLM legitimately ended after tool execution.
            const hasNonTextContent = finalContentBlocks.some(
              (b: ContentBlock) =>
                b.type === 'tool_use' ||
                b.type === 'tool_result' ||
                b.type === 'code' ||
                b.type === 'image' ||
                b.type === 'file' ||
                b.type === 'audio',
            );

            if (!allTextContent && !hasNonTextContent) {
              const retryCount = this.emptyResponseRetries.get(request.agentId) || 0;
              if (retryCount < MAX_EMPTY_RESPONSE_RETRIES) {
                this.emptyResponseRetries.set(request.agentId, retryCount + 1);
                logger.warn('Empty end_turn response detected - auto-continuing agent', {
                  agentId: request.agentId,
                  streamId: request.streamId,
                  retryCount: retryCount + 1,
                  maxRetries: MAX_EMPTY_RESPONSE_RETRIES,
                  contentBlockCount: finalContentBlocks.length,
                  contentBlockTypes: finalContentBlocks.map((b: ContentBlock) => b.type),
                });

                // Clean up current stream resources so a new stream can start
                this.cleanupStreamResources(request.agentId, streamGeneration);
                this.completedStreams.delete(request.agentId);

                // Remove the empty streaming message from backend session to avoid
                // polluting conversation history with empty assistant messages
                try {
                  const backend = await this.getBackend();
                  const backendSession = backend.getSession(request.agentId);
                  if (backendSession) {
                    const streamingIdx = backendSession.messages.findIndex(
                      (m: any) => m.role === 'assistant' && m.isStreaming,
                    );
                    if (streamingIdx >= 0) {
                      backendSession.messages.splice(streamingIdx, 1);
                    }
                  }
                } catch {
                  // Ignore cleanup errors - the auto-continue is more important
                }

                // Capture agentId for the closure — avoid referencing `request` after return
                const autoContinueAgentId = request.agentId;
                const autoContinueWorkspaceId = request.workspaceId;

                // Auto-continue by sending a system-initiated message after a brief delay
                // to allow the current stream to fully tear down
                setTimeout(() => {
                  // Guard: If the agent was stopped/deleted during the delay, abort.
                  // Check that the provider still exists and the agent wasn't interrupted.
                  if (
                    !this.providers.has(autoContinueAgentId) ||
                    this.interruptedAgents.has(autoContinueAgentId)
                  ) {
                    logger.info('Auto-continue aborted - agent was stopped or interrupted', {
                      agentId: autoContinueAgentId,
                      hasProvider: this.providers.has(autoContinueAgentId),
                      wasInterrupted: this.interruptedAgents.has(autoContinueAgentId),
                    });
                    this.emptyResponseRetries.delete(autoContinueAgentId);
                    return;
                  }

                  this.handleBackendStreamMessage(null as any, {
                    agentId: autoContinueAgentId,
                    sessionId: autoContinueAgentId,
                    streamId: autoContinueAgentId,
                    content:
                      'Continue with your current task. You stopped without producing output.',
                    workspaceId: autoContinueWorkspaceId,
                    skipUserMessage: true,
                    agentName,
                  }).catch((err) => {
                    logger.error('Auto-continue failed, emitting idle to prevent stuck state', {
                      agentId: autoContinueAgentId,
                      error: err instanceof Error ? err.message : String(err),
                    });
                    this.emptyResponseRetries.delete(autoContinueAgentId);

                    // CRITICAL: Clean up resources and advance the queue BEFORE emitting idle.
                    // The auto-continue skipped finalizeStream (intentionally), but now that
                    // auto-continue itself failed, we must advance the queue so queued messages
                    // aren't stuck. finalizeStream also sets pendingQueueProcessing to prevent
                    // the idle event from racing with queue processing.
                    this.finalizeStream(
                      autoContinueAgentId,
                      autoContinueWorkspaceId,
                      'auto-continue-failed',
                      streamGeneration,
                    );

                    // Emit agent:idle so the agent doesn't stay permanently stuck
                    // in "responding" state. Without this, a failed auto-continue would leave
                    // no one to transition the agent out of "responding", causing the exact
                    // stuck-agent bug we're trying to fix.
                    this.emitAgentIdleEvent(
                      autoContinueAgentId,
                      autoContinueWorkspaceId,
                      agentName,
                      undefined,
                      'error',
                    );
                  });
                }, 100);
                return; // Skip normal completion flow (don't persist empty message, don't go idle)
              } else {
                logger.warn('Max empty response retries reached - allowing agent to go idle', {
                  agentId: request.agentId,
                  retryCount,
                });
                this.emptyResponseRetries.delete(request.agentId);
              }
            } else {
              // Non-empty response (has text or non-text content) - reset retry counter
              this.emptyResponseRetries.delete(request.agentId);
            }
          } else {
            // Non-end_turn finish reason (e.g., cancelled, error) - reset retry counter
            this.emptyResponseRetries.delete(request.agentId);
          }

          // Build the final assistant message
          // Include metadata from provider message (e.g., modelUnavailable info)
          // Also set interrupted: true when stopReason is 'cancelled' for persistence
          const wasInterrupted = finishReason === 'cancelled';
          const assistantMessage = {
            id: providerMessage?.id || `msg_${uuidv4()}`, // Use provider's ID if available
            role: 'assistant' as const,
            contentBlocks: finalContentBlocks,
            timestamp: new Date().toISOString(),
            metadata: {
              ...providerMessage?.metadata,
              // Store the model used for this response so the UI can pre-select it when editing
              model: provider?.getConfig?.()?.model || request.model,
              // Include interrupted flag for persistence so UI shows "Stopped" after refresh
              ...(wasInterrupted ? { interrupted: true } : {}),
            },
          };

          // Finalize assistant message to backend session and persist
          try {
            const backend = await this.getBackend();
            const backendSession = backend.getSession(request.agentId);
            if (backendSession) {
              if (!backendSession.messages) {
                backendSession.messages = [];
              }

              // Find and replace the streaming message, or add new one
              const existingStreamingMsgIndex = backendSession.messages.findIndex(
                (m: any) => m.role === 'assistant' && m.isStreaming,
              );

              if (existingStreamingMsgIndex >= 0) {
                // Use the same ID from the streaming message
                assistantMessage.id = backendSession.messages[existingStreamingMsgIndex].id;
                // Replace the streaming message with final version
                backendSession.messages[existingStreamingMsgIndex] = assistantMessage;
              } else {
                // No streaming message found, add new one
                backendSession.messages.push(assistantMessage);
              }
              backendSession.updatedAt = new Date();

              logger.debug('Backend: Finalized assistant message in backend session', {
                agentId: request.agentId,
                messageCount: backendSession.messages.length,
                replacedStreaming: existingStreamingMsgIndex >= 0,
              });

              // Update status before persisting so the on-disk JSON reflects idle state
              const { AgentStatus } = await import('../../../shared/types/agent.types.js');
              backendSession.status = AgentStatus.Idle;
              backendSession.isStreaming = false;

              // Persist the session to disk
              const saveResult = await agentPersistence.saveAgent(backendSession);
              if (saveResult.success) {
                logger.debug('Backend: Session persisted after stream complete', {
                  agentId: request.agentId,
                  path: saveResult.path,
                });
              } else {
                logger.error('Backend: Failed to persist session', {
                  agentId: request.agentId,
                  error: saveResult.error,
                });
              }
            } else {
              logger.warn('Backend: No backend session found for persistence', {
                agentId: request.agentId,
              });
            }
          } catch (persistError) {
            logger.error('Backend: Error persisting session', {
              agentId: request.agentId,
              error: persistError instanceof Error ? persistError.message : String(persistError),
            });
          }

          // Memory instrumentation: agent turn complete (before cleanup)
          // Calculate content size estimate for memory analysis
          const contentSizeKB = this.estimateContentSizeKB(assistantMessage?.contentBlocks);
          const backend = await this.getBackend();
          const sessionForMetrics = backend.getSession(request.agentId);
          const totalMessagesKB = sessionForMetrics
            ? this.estimateSessionSizeKB(sessionForMetrics.messages)
            : 0;

          memEvents.agentTurnComplete(request.agentId, {
            contentBlockCount: assistantMessage?.contentBlocks?.length ?? 0,
            contentSizeKB,
            messageCount: sessionForMetrics?.messages?.length ?? 0,
            totalMessagesKB,
            activeProviders: this.providers.size,
            activeStreams: this.streamStartTimes.size,
            finishReason,
          });

          // Send complete event with the final message
          const queuedCount = this.messageQueues.get(request.agentId)?.length ?? 0;
          logger.debug('Sending stream complete to renderer', {
            agentId: request.agentId,
            finishReason,
            hasQueuedMessages: queuedCount > 0,
            queuedCount,
            willProcessQueueIn100ms: queuedCount > 0,
            timestamp: Date.now(),
          });

          this.sendStreamToRenderer(request.agentId, `agent:stream:${request.agentId}`, {
            type: 'complete',
            streamId: request.streamId,
            sessionId: request.agentId,
            message: assistantMessage,
            finishReason,
          });

          // Memory instrumentation: cleanup starting
          memEvents.cleanupStart(request.agentId, {
            hasHealthCheck: this.streamHealthChecks.has(request.agentId),
            hasStreamStartTime: this.streamStartTimes.has(request.agentId),
          });

          // Cleanup after completion + advance the queue
          // IMPORTANT: finalizeStream MUST run BEFORE emitAgentIdleEvent.
          // emitAgentIdleEvent can trigger event subscription delivery which starts
          // a new stream via sendBackendInitiatedMessage. If that happens before
          // processNextQueuedMessage fires, the queued message gets deferred
          // ("Stream already active") and may never be sent. By finalizing first,
          // the queue gets priority over event-triggered streams.
          this.finalizeStream(request.agentId, request.workspaceId, 'complete', streamGeneration);

          // Track definitive agent outcome (backend ground truth)
          trackMain('Agent Outcome', {
            agent_id: request.agentId,
            workspace_id: request.workspaceId,
            outcome: wasInterrupted || ['provider_stopped', 'workspace_deleted', 'process_died', 'process_null'].includes(finishReason) ? 'stopped' : 'completed',
            finish_reason: finishReason,
            agent_name: agentName,
            agent_model: provider?.getConfig?.()?.model || request.model,
            is_background: !!(request as any).isBackground,
            source: 'backend',
          });

          // Emit agent:idle event for agent-to-agent coordination
          // Use the agentName from the outer scope (loaded from persistence at line 643)
          // Pass assistantMessage to ensure lastResponseSummary includes the final message
          //
          this.emitAgentIdleEvent(
            request.agentId,
            request.workspaceId,
            agentName,
            assistantMessage,
            finishReason,
          );

          // Background check: see if agent's task note should be marked as complete
          // This is fire-and-forget - errors are logged but don't affect the main flow
          // Skip if provider was force-stopped (e.g., workspace deletion) - no point checking notes
          // for a workspace that's being deleted, and this avoids spawning new agent processes
          if (finishReason !== 'provider_stopped') {
            logger.info('Triggering background note status check', {
              agentId: request.agentId,
              workspaceId: request.workspaceId,
              finishReason,
            });

            // Extract the final assistant message text to pass as context,
            // avoiding a redundant re-load from persistence inside the checker
            let lastMessageText: string | undefined;
            if (assistantMessage?.contentBlocks) {
              lastMessageText = assistantMessage.contentBlocks
                .filter((b: ContentBlock) => b.type === 'text')
                .map((b: ContentBlock) => (b as any).text || '')
                .join('\n');
            }

            import('./note-status-checker')
              .then(({ checkAndUpdateNoteStatus }) => {
                checkAndUpdateNoteStatus(request.agentId, request.workspaceId, undefined, {
                  finishReason,
                  lastMessageText,
                  hasQueuedMessages: queuedCount > 0,
                }).catch((err) => {
                  logger.info('Background note status check failed', {
                    agentId: request.agentId,
                    error: err,
                  });
                });
              })
              .catch((err) => {
                logger.info('Failed to import note-status-checker', { error: err });
              });
          } else {
            logger.info('Skipping background note status check - provider was force-stopped', {
              agentId: request.agentId,
              workspaceId: request.workspaceId,
              finishReason,
            });
          }

          // Memory instrumentation: cleanup complete
          memEvents.cleanupComplete(request.agentId, {
            activeProviders: this.providers.size,
            activeStreams: this.streamStartTimes.size,
          });

          // NOTE: We no longer force GC after every agent turn - this fights V8's heuristics
          // and can cause UI jank. Instead, GC is only forced on critical memory pressure
          // (see main/index.ts memoryMonitor.onPressure handler)
        },
        onError: async (error: Error) => {
          // Check if this is an expected interruption (user sent a new message)
          const isInterruption = error.message === 'Agent interrupted';

          if (isInterruption) {
            logger.info('Backend: Agent was interrupted (user sent new message)', {
              agentId: request.agentId,
            });
          } else {
            logger.error('Backend: onError callback called', {
              agentId: request.agentId,
              error: error.message,
            });
          }

          // CRITICAL FIX: Persist any accumulated content before cleanup
          // This ensures tool calls and partial content are saved even when errors occur
          try {
            await persistStreamingState(isInterruption ? 'interruption' : 'error-recovery');
            logger.info('Backend: Persisted streaming state on error/interruption', {
              agentId: request.agentId,
              isInterruption,
            });
          } catch (persistError) {
            logger.warn('Backend: Failed to persist streaming state on error', {
              agentId: request.agentId,
              error: persistError instanceof Error ? persistError.message : String(persistError),
            });
          }

          // For interruptions, send a 'complete' event instead of 'error'
          // This prevents the UI from showing an error message
          if (isInterruption) {
            this.sendStreamToRenderer(request.agentId, `agent:stream:${request.agentId}`, {
              type: 'complete',
              data: null,
              streamId: request.streamId,
              sessionId: request.agentId,
            });
          } else {
            this.sendStreamToRenderer(request.agentId, `agent:stream:${request.agentId}`, {
              type: 'error',
              error: error.message,
              streamId: request.streamId,
              sessionId: request.agentId,
            });
          }

          // Only emit agent:failed for real errors, not interruptions.
          // Interruptions mean a new message was sent — the agent stays in "responding"
          // and a new stream takes over. Emitting agent:idle here would incorrectly
          // trigger delegation subscriptions (oneShot), causing parent agents to think
          // the child completed when it's actually about to process a new message.
          if (isInterruption) {
            // Interruption: just clean up resources. The new message's stream takes over;
            // queue advancement is not needed (and would be harmful).
            this.cleanupStreamResources(request.agentId, streamGeneration);
          } else {
            // Real error: clean up resources AND advance the queue.
            // Mark that onError handled the failure so the outer catch doesn't double-emit.
            // ACP provider's onError calls rejectStream(), which causes await provider.streamMessage()
            // to throw, hitting the outer catch. Without this guard, agent:failed fires twice.
            onErrorHandled = true;
            // Track definitive agent outcome (backend ground truth)
            trackMain('Agent Outcome', {
              agent_id: request.agentId,
              workspace_id: request.workspaceId,
              outcome: 'errored',
              finish_reason: 'error',
              agent_name: agentName,
              agent_model: provider?.getConfig?.()?.model || request.model,
              is_background: !!(request as any).isBackground,
              source: 'backend',
            });
            // IMPORTANT: finalizeStream MUST run BEFORE emitAgentFailedEvent (same as onComplete).
            // emitAgentFailedEvent can trigger event subscription delivery which starts
            // a new stream, racing with queued message processing.
            this.finalizeStream(request.agentId, request.workspaceId, 'error', streamGeneration);
            // emitAgentFailedEvent coordinates setAgentStatus('failed') + event emission
            // in a single async chain for guaranteed ordering.
            this.emitAgentFailedEvent(
              request.agentId,
              request.workspaceId,
              agentName,
              error.message,
            );
          }
        },
      });

      logger.debug('Backend: provider.streamMessage completed', {
        agentId: request.agentId,
      });

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isInterruption = errorMessage === 'Agent interrupted';

      // Handle interruption as expected behavior, not an error
      if (isInterruption) {
        logger.info('Backend: Stream interrupted by user (new message)', {
          agentId: request.agentId,
        });
        // Return success for interruptions - this is expected behavior
        return { success: true };
      }

      logger.error('Failed to send message', {
        agentId: request.agentId,
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      });

      // CRITICAL FIX: Emit agent:failed event so delegation subscriptions are triggered.
      // Without this, if an error occurs before the stream callbacks (onComplete/onError)
      // are registered — or if the provider crashes in a way that doesn't trigger onError —
      // the parent coordinator is never notified and hangs indefinitely.
      // NOTE: Skip "not found" errors because handleBackendStreamMessage has a recovery path
      // that loads the agent from persistence and retries. Emitting agent:failed here would
      // prematurely trigger the parent's subscription before the recovery attempt.
      // NOTE: Skip if onError already handled it — ACP provider's onError calls rejectStream(),
      // which causes this catch to fire AFTER onError already emitted agent:failed.
      const isRecoverableNotFound = errorMessage.includes('not found');
      if (request.workspaceId && !isRecoverableNotFound && !onErrorHandled) {
        // Clean up stream resources and advance the queue. onError didn't fire,
        // so streamStartTimes may be stale and the queue would never advance.
        this.finalizeStream(request.agentId, request.workspaceId, 'outer-catch-error');
        const failedAgentName = (request as any).agentName || 'Agent';
        // Track definitive agent outcome (backend ground truth)
        trackMain('Agent Outcome', {
          agent_id: request.agentId,
          workspace_id: request.workspaceId,
          outcome: 'errored',
          finish_reason: 'error',
          agent_name: failedAgentName,
          is_background: !!(request as any).isBackground,
          source: 'backend',
        });
        this.emitAgentFailedEvent(
          request.agentId,
          request.workspaceId,
          failedAgentName,
          errorMessage,
        );
      } else if (!onErrorHandled && this.streamStartTimes.has(request.agentId)) {
        // Even if we can't emit the failed event (no workspaceId or recoverable error),
        // still clean up stale stream resources to prevent the agent from being stuck
        this.cleanupStreamResources(request.agentId);
      }

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Handle backend stream message request (used by frontend)
   */
  private async handleBackendStreamMessage(
    _event: IpcMainInvokeEvent,
    validated: any,
  ): Promise<{ success: boolean; error?: string }> {
    const request = validated;
    try {
      logger.info('Backend: handleBackendStreamMessage called', {
        agentId: request.agentId,
        sessionId: request.sessionId,
        workspaceId: request.workspaceId,
        contentLength: request.content?.length,
      });

      // Pass all the extended properties through
      // CRITICAL: Copy messages from request if provided - this is essential for edit-and-regenerate
      // The frontend passes truncated messages after an edit, and we MUST use them
      const extendedRequest: any = {
        agentId: request.agentId,
        sessionId: request.sessionId,
        streamId: `${request.sessionId}:${Date.now()}`, // Unique per message turn so frontend can detect new streams
        content: request.content,
        workspaceId: request.workspaceId,
        contextReferences: request.contextReferences,
        model: request.model,
        noteIds: request.noteIds,
        personality: request.personality,
        stdinContext: request.stdinContext,
        agentName: request.agentName,
        systemPrompt: request.systemPrompt,
        messageMetadata: request.messageMetadata, // Include metadata for event_notification, etc.
        workspacePath: undefined, // Will be set if loading from persistence
        // Use messages from request if provided (edit/regenerate flow), otherwise empty
        messages: request.messages || [],
        // Reset ACP session for edit/regenerate flows - clears internal history
        resetHistory: request.resetHistory,
        // CRITICAL: Include image and file blocks from the request
        imageBlocks: request.imageBlocks,
        fileBlocks: request.fileBlocks,
        // CRITICAL: Include specialist metadata from the request
        // This is passed from frontend when user selects a specialist before sending first message
        behaviorPrompt: request.behaviorPrompt,
        specialist: request.specialist,
        // CRITICAL: Pass through skipUserMessage so auto-continue and wake handler callers
        // don't inject phantom user messages into the conversation history
        skipUserMessage: request.skipUserMessage,
        // Pass through queuedMessageId for queued message consistency
        queuedMessageId: request.queuedMessageId,
      };

      // Try to send the message first
      const sendResult = await this.handleSendMessage(_event, extendedRequest as any);

      // If the agent doesn't exist, try to load it from persistence
      if (!sendResult.success && sendResult.error?.includes('not found')) {
        logger.info('Agent not found in backend, attempting to load from persistence', {
          agentId: request.agentId,
        });

        // First, try to load the agent from persistence
        // DON'T pass workspacePath - let loadAgent use the correct metadata path internally
        const loadResult = await agentPersistence.loadAgent(
          request.agentId as AgentId,
          request.workspaceId as WorkspaceId,
        );

        if (!loadResult.success || !loadResult.data) {
          // If loading fails, we can't recreate with the same ID
          logger.error('Failed to load agent from persistence', {
            agentId: request.agentId,
            error: loadResult.error,
          });

          return {
            success: false,
            error: `Agent ${request.agentId} not found and could not be loaded from persistence`,
          };
        }

        logger.info('Agent loaded from persistence successfully, retrying message send', {
          agentId: request.agentId,
          messageCount: loadResult.data.messages?.length || 0,
        });

        // For backend-initiated agents (wake handler, etc), we need to ensure the frontend
        // has set up its stream handler BEFORE we start streaming. This is a 3-step handshake:
        // 1. agent:prepare-handler - tell frontend to prepare stream handler
        // 2. agent:handler-ready - frontend signals it's ready (we wait for this)
        // 3. agent:created - add to dock/session store (semantic: agent exists now)
        const backend = await this.getBackend();
        const { AgentStatus } = await import('../../../shared/types/agent.types.js');
        const agentSession: AgentSession = {
          id: request.agentId as AgentId,
          workspaceId: request.workspaceId as WorkspaceId,
          name: loadResult.data.name || 'Restored Agent',
          status: AgentStatus.Idle,
          model: loadResult.data.model || 'default',
          systemPrompt: loadResult.data.systemPrompt,
          messages: loadResult.data.messages || [],
          createdAt: loadResult.data.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          metadata: loadResult.data.metadata || {},
          backendSessionId: loadResult.data.backendSessionId,
        };

        // Step 1 & 2: Request frontend to prepare handler and wait for ready signal
        // Non-fatal: If the frontend isn't ready (e.g., coordinator's chat panel not visible,
        // or ACP workspace agent with no UI window), continue anyway. The agent:stream-starting
        // safety net on the frontend will register handlers when streaming begins.
        try {
          await this.requestFrontendHandler(request.agentId, request.workspaceId, {
            name: agentSession.name,
            model: agentSession.model,
          });
        } catch (handshakeError) {
          logger.warn(
            'Backend stream recovery: frontend handshake failed (non-fatal), continuing without UI',
            {
              agentId: request.agentId,
              workspaceId: request.workspaceId,
              error:
                handshakeError instanceof Error
                  ? handshakeError.message
                  : String(handshakeError),
            },
          );
        }

        // Step 3: Emit agent:created to add to dock/session store
        backend.emit('agent:created', {
          agentId: request.agentId,
          workspaceId: request.workspaceId,
          agent: agentSession,
        });

        logger.info('Backend-initiated agent restore complete, frontend handler ready', {
          agentId: request.agentId,
          workspaceId: request.workspaceId,
        });

        // Get the worktree path for loading user rules
        // Priority: workspace.worktreePath > workspace.repositoryPath > metadata path
        let worktreePath: string | undefined;
        try {
          const workspaceResult = await workspaceService.getWorkspace(
            request.workspaceId as WorkspaceId,
          );
          if (workspaceResult.ok && workspaceResult.data) {
            worktreePath = workspaceResult.data.worktreePath || workspaceResult.data.repositoryPath;
          }
        } catch (error) {
          logger.warn('Failed to get workspace for worktree path', { error });
        }
        if (!worktreePath) {
          worktreePath = WorkspaceConfig.paths.workspace(request.workspaceId || 'default');
        }

        // Retry sending the message with the loaded agent's data
        extendedRequest.messages = loadResult.data.messages || [];
        extendedRequest.systemPrompt = loadResult.data.systemPrompt || request.systemPrompt;
        extendedRequest.workspacePath = worktreePath;

        return await this.handleSendMessage(_event, extendedRequest as any);
      }

      return sendResult;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to stream message', {
        agentId: request.agentId,
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      });

      // CRITICAL FIX: Emit agent:failed event so delegation subscriptions are triggered.
      // Without this, if handleBackendStreamMessage fails (e.g., persistence load error,
      // frontend handshake failure), the parent coordinator is never notified and hangs.
      if (request.workspaceId) {
        const agentName = request.agentName || 'Agent';
        this.emitAgentFailedEvent(request.agentId, request.workspaceId, agentName, errorMessage);
      }

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Handle get agent request
   */
  private async handleGetAgent(
    _event: IpcMainInvokeEvent,
    validated: any,
  ): Promise<AgentSession | null> {
    const agentId = validated;
    const backend = await this.getBackend();
    return backend.getSession(agentId) || null;
  }

  /**
   * Handle list agents request
   */
  private async handleListAgents(
    _event: IpcMainInvokeEvent,
    validated: any,
  ): Promise<AgentSession[]> {
    const workspaceId = validated;
    const backend = await this.getBackend();
    return backend.getWorkspaceSessions(workspaceId);
  }

  /**
   * Handle stop session request
   */
  private async handleStopSession(
    _event: IpcMainInvokeEvent,
    validated: any,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Handle both string and object parameter formats
      const agentId = typeof validated === 'string' ? validated : validated.agentId;

      // Determine cancellation trigger for diagnostics.
      // _stopTrigger is set by internal callers (lifecycle, programmatic stop, workspace deletion).
      // When absent, the call came from the renderer IPC (user action).
      const trigger: string =
        (typeof validated === 'object' && validated?._stopTrigger) || 'user_action';
      const triggerReason: string | undefined =
        typeof validated === 'object' ? validated?._stopReason : undefined;

      // Look up workspaceId and sessionId from tracking maps for correlation
      const workspaceId = this.streamWorkspaceIds.get(agentId);
      const sessionId = this.streamSessionIds.get(agentId);

      // Structured cancellation-origin log: identifies WHO triggered the stop and WHY.
      // This is the single chokepoint for all session stops that produce finishReason="cancelled".
      logger.info('[cancellation-origin] Stopping session', {
        trigger,
        triggerReason: triggerReason || 'none',
        agentId,
        workspaceId: workspaceId || 'unknown',
        sessionId: sessionId || 'unknown',
        hasActiveStream: this.streamStartTimes.has(agentId),
        hasProvider: this.providers.has(agentId),
      });

      // Mark the agent as intentionally interrupted to skip automatic queue processing
      // This prevents the race condition where processNextQueuedMessage picks up the wrong message
      // when the user clicks "Send now" on a specific queued message
      this.interruptedAgents.add(agentId);

      // First, interrupt the ACP provider directly (it's stored in this.providers, not in ConsolidatedBackend)
      const provider = this.providers.get(agentId);
      if (provider && typeof provider.interrupt === 'function') {
        logger.info('Interrupting ACP provider directly', { agentId, hasProvider: true });
        try {
          await provider.interrupt();
          logger.info('ACP provider interrupted successfully', { agentId });
        } catch (interruptError) {
          logger.error('Error interrupting ACP provider', { agentId, error: interruptError });
        }
      } else {
        logger.warn('No provider found to interrupt', {
          agentId,
          hasProvider: !!provider,
          hasInterrupt: provider ? typeof provider.interrupt === 'function' : false,
        });
        // CRITICAL FIX: When there's no provider to interrupt, we must still clean up stream resources.
        // This can happen when:
        // 1. The stream completed before the page was refreshed
        // 2. The stream was interrupted in a previous session
        // Without this cleanup, streamStartTimes retains the agent ID, causing getActiveStreams()
        // to incorrectly report the agent as still streaming after page reload.
        this.cleanupStreamResources(agentId);
      }

      // Clean up auto-continue retry counter so a pending setTimeout doesn't fire
      this.emptyResponseRetries.delete(agentId);

      // Then call backendStop to clean up streaming state
      const backend = await this.getBackend();
      const result = await backend.backendStop({
        agentId,
        _stopTrigger: trigger,
        _stopReason: triggerReason || 'handleStopSession_cleanup',
      });

      // Clean up any active session tracking
      this.activeSessions.delete(agentId);

      // NOTE: We do NOT send a 'complete' event here anymore.
      // The provider.interrupt() call above already triggers handleStreamCompletion
      // which sends a proper 'complete' event with the message metadata including stopReason.
      // Sending a duplicate 'complete' event here with data:null would race with the proper
      // completion event and cause the frontend to receive an empty message, losing the
      // stopReason metadata needed for the "Stopped" indicator.

      return result;
    } catch (error) {
      logger.error('Failed to stop session', error as Error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Handle delete agent request
   */
  private async handleDeleteAgent(
    _event: IpcMainInvokeEvent,
    validated: any,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      logger.info('[AgentBackendHandler] handleDeleteAgent called', { params: validated });

      // Handle multiple parameter formats
      let agentId: string;
      let workspaceId: string | undefined;

      if (typeof validated === 'string') {
        agentId = validated;
      } else if ('agentId' in validated) {
        agentId = validated.agentId;
        workspaceId = validated.workspaceId;
      } else if ('sessionId' in validated) {
        agentId = validated.sessionId;
        workspaceId = validated.workspaceId;
      } else {
        throw new Error('Invalid parameters: missing agentId or sessionId');
      }

      logger.info('[AgentBackendHandler] Deleting agent', { agentId, workspaceId });

      // Get agent info before deletion for the event
      // Default to workspace title if agent name is not available
      let agentName = 'Agent';
      let taskNoteId: string | undefined;
      let isBackground: boolean | undefined;
      let parentAgentId: string | undefined;
      try {
        const workspaceResult = await workspaceService.getWorkspace(workspaceId as any);
        if (workspaceResult.ok && workspaceResult.data?.title) {
          agentName = workspaceResult.data.title;
        }
      } catch {
        // Ignore - use default name
      }
      try {
        const backend = await this.getBackend();
        const agent = await backend.getAgent(agentId);
        if (agent) {
          agentName = agent.name || agentName;
          taskNoteId = agent.taskNoteId?.toString();
          isBackground = agent.isBackground;
          parentAgentId = agent.metadata?.createdByAgentId as string | undefined;
        }
      } catch {
        // Ignore - use fallback name
      }
      // Fallback: load from persistence if backend session didn't have isBackground
      // (agent may already be stopped but still persisted on disk)
      if (isBackground === undefined && workspaceId) {
        try {
          const loadResult = await agentPersistence.loadAgent(
            agentId as AgentId,
            workspaceId as WorkspaceId,
          );
          if (loadResult.success && loadResult.data) {
            isBackground = loadResult.data.isBackground === true;
            parentAgentId = parentAgentId || (loadResult.data.metadata?.createdByAgentId as string | undefined);
          }
        } catch {
          // Ignore - metadata enrichment is best-effort
        }
      }

      // CRITICAL: Mark agent as deleted in subscription service FIRST, before any cleanup.
      // This closes the race window where events could be delivered to the agent between
      // cleanup and the emitAgentDeletedEvent call. Also adds to local deletedAgentIds
      // to guard sendBackendInitiatedMessage against resurrection.
      await this.markAgentAsDeleted(agentId, workspaceId);

      // Clean up the ACP provider and its session
      // This is the proper place to clean up the provider (not in cleanupStreamResources)
      if (this.providers.has(agentId)) {
        // Memory instrumentation: provider cleanup starting
        memEvents.providerCleanup(agentId, {
          phase: 'start',
          providersBeforeCleanup: this.providers.size,
        });

        const provider = this.providers.get(agentId);
        if (provider && typeof provider.cleanup === 'function') {
          try {
            provider.cleanup();
            logger.info('[AgentBackendHandler] Cleaned up ACP provider', { agentId });
          } catch (error) {
            logger.error('[AgentBackendHandler] Error cleaning up provider', { agentId, error });
          }
        }

        // Memory instrumentation: provider cleanup complete
        memEvents.providerCleanup(agentId, {
          phase: 'complete',
          providersAfterCleanup: this.providers.size,
        });
      }

      // Clean up ALL per-agent tracking maps (providers, streams, queues, heartbeats, etc.)
      this.cleanupAllAgentTrackingMaps(agentId);

      // Clean up agent references from task notes
      if (workspaceId) {
        try {
          const { notesService } = await import('../../notes/main/notes.service');
          const { WorkspaceId: createWorkspaceId, AgentId: createAgentId } =
            await import('$shared/types/branded-ids');
          const cleanupResult = await notesService.removeAgentFromAllTasks(
            createWorkspaceId(workspaceId),
            createAgentId(agentId),
          );
          if (cleanupResult.ok) {
            logger.info('[AgentBackendHandler] Cleaned up agent references from tasks', {
              agentId,
              workspaceId,
              tasksUpdated: cleanupResult.data,
            });
          } else {
            logger.warn('[AgentBackendHandler] Failed to clean up agent references', {
              agentId,
              workspaceId,
              error: cleanupResult.error,
            });
          }
        } catch (cleanupError) {
          // Don't fail the deletion if cleanup fails
          logger.warn('[AgentBackendHandler] Error during agent reference cleanup', {
            agentId,
            workspaceId,
            error: cleanupError,
          });
        }
      }

      const backend = await this.getBackend();
      const result = await backend.deleteAgent(agentId, workspaceId);
      logger.info('[AgentBackendHandler] Delete result', { agentId, result });

      // Emit agent:deleted event so delegation subscriptions can wake up
      if (result.success && workspaceId) {
        this.emitAgentDeletedEvent(agentId, workspaceId, agentName, taskNoteId, isBackground, parentAgentId);
      }

      // Invalidate the persistence list cache since we deleted an agent
      if (workspaceId) {
        this.invalidatePersistenceListCache(workspaceId);
      }

      return result;
    } catch (error) {
      logger.error('[AgentBackendHandler] Error in handleDeleteAgent', { error, validated });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Handle persistence save
   */
  private async handlePersistenceSave(
    _event: IpcMainInvokeEvent,
    validated: any,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { agent } = validated;
      // Do NOT pass workspacePath - let it use the correct metadata directory
      const result = await agentPersistence.saveAgent(agent);
      return result;
    } catch (error) {
      logger.error('Failed to save agent', error as Error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Handle persistence load
   */
  private async handlePersistenceLoad(
    _event: IpcMainInvokeEvent,
    validated: any,
  ): Promise<{ success: boolean; data?: AgentSession; error?: string }> {
    try {
      const { agentId, workspaceId, workspacePath } = validated;
      const result = await agentPersistence.loadAgent(
        agentId as AgentId,
        workspaceId as WorkspaceId,
        workspacePath,
      );
      return result;
    } catch (error) {
      logger.error('Failed to load agent', error as Error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Handle persistence delete
   */
  private async handlePersistenceDelete(
    _event: IpcMainInvokeEvent,
    validated: any,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { agentId, workspaceId } = validated;
      await agentPersistence.deleteAgent(agentId, workspaceId);
      // Invalidate the persistence list cache since we deleted an agent
      if (workspaceId) {
        this.invalidatePersistenceListCache(workspaceId);
      }
      return { success: true };
    } catch (error) {
      logger.error('Failed to delete agent', error as Error);
      return { success: false, error: String(error) };
    }
  }

  // OPTIMIZATION: Cache for persistence list to avoid repeated disk reads
  // This cache persists across page refreshes since it's in the main process
  private persistenceListCache = new Map<
    string,
    { agents: any[]; timestamp: number; loadPromise?: Promise<any[]> }
  >();
  private static PERSISTENCE_LIST_CACHE_TTL_MS = 30000; // 30 second cache - 5s was too short for rapid workspace switching

  /**
   * Invalidate the persistence list cache for a workspace
   * Call this when agents are created, deleted, or modified
   */
  public invalidatePersistenceListCache(workspaceId: string): void {
    this.persistenceListCache.delete(workspaceId);
    logger.debug('Invalidated persistence list cache', { workspaceId });
  }

  /**
   * Handle persistence list with caching
   * This is the main optimization for agent loading - caches results in the main process
   * so page refreshes don't require re-reading all agent files from disk
   */
  private async handlePersistenceList(
    _event: IpcMainInvokeEvent,
    validated: any,
  ): Promise<{ success: boolean; data?: any[]; error?: string }> {
    const { workspaceId } = validated;
    const startTime = performance.now();

    try {
      // OPTIMIZATION: Check cache first
      const cached = this.persistenceListCache.get(workspaceId);
      if (cached) {
        const cacheAge = Date.now() - cached.timestamp;
        if (cacheAge < AgentBackendHandler.PERSISTENCE_LIST_CACHE_TTL_MS) {
          // If there's an in-flight request, wait for it
          if (cached.loadPromise) {
            logger.debug('Waiting for in-flight persistence list', { workspaceId });
            const agents = await cached.loadPromise;
            return { success: true, data: agents };
          }
          // Return cached result
          logger.debug('Returning cached persistence list', {
            workspaceId,
            count: cached.agents.length,
            cacheAge: `${cacheAge}ms`,
          });
          return { success: true, data: cached.agents };
        }
      }

      // Create a promise for this load operation to dedupe concurrent requests
      const loadPromise = (async (): Promise<any[]> => {
        // Get list of agent IDs
        // Do NOT pass workspacePath - let it use the correct metadata directory
        const agentIds = await agentPersistence.listAgents(workspaceId);

        // Load full agent data for each ID in parallel for better performance
        const loadResults = await Promise.all(
          agentIds.map(async (agentId) => {
            try {
              const result = await agentPersistence.loadAgent(
                agentId as AgentId,
                workspaceId as WorkspaceId,
              );
              return result.success && result.data ? result.data : null;
            } catch (error) {
              logger.warn(`Failed to load agent ${agentId}`, { error: (error as Error).message });
              return null;
            }
          }),
        );

        // Filter out nulls
        return loadResults.filter((agent): agent is NonNullable<typeof agent> => agent !== null);
      })();

      // Store the promise in cache so concurrent calls can wait for it
      this.persistenceListCache.set(workspaceId, {
        agents: cached?.agents || [],
        timestamp: Date.now(),
        loadPromise,
      });

      const agents = await loadPromise;

      // Update cache with loaded agents
      this.persistenceListCache.set(workspaceId, {
        agents,
        timestamp: Date.now(),
        loadPromise: undefined,
      });

      logger.info('Loaded persistence list', {
        workspaceId,
        count: agents.length,
        duration: `${(performance.now() - startTime).toFixed(1)}ms`,
      });

      return { success: true, data: agents };
    } catch (error) {
      logger.error('Failed to list agents', error as Error);
      // Clear cache on error so next call will retry
      this.persistenceListCache.delete(workspaceId);
      return { success: false, error: String(error), data: [] };
    }
  }

  /**
   * Handle persistence save message
   */
  private async handlePersistenceSaveMessage(
    _event: IpcMainInvokeEvent,
    validated: any,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { agentId, workspaceId, message } = validated;
      await agentPersistence.saveMessage(agentId, workspaceId, message);
      return { success: true };
    } catch (error) {
      logger.error('Failed to save message', error as Error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Handle persistence batch operations
   */
  private async handlePersistenceBatch(
    _event: IpcMainInvokeEvent,
    validated: any,
  ): Promise<{ success: boolean; results?: any[]; error?: string }> {
    const { operations } = validated;
    try {
      const results = [];
      for (const op of operations) {
        switch (op.type) {
          case 'save':
            const saveResult = await agentPersistence.saveAgent(
              op.params.session,
              op.params.workspacePath,
            );
            results.push(saveResult);
            break;
          case 'load':
            const loadResult = await agentPersistence.loadAgent(
              op.params.agentId,
              op.params.workspaceId,
              op.params.workspacePath,
            );
            results.push(loadResult);
            break;
          case 'delete':
            const deleteResult = await agentPersistence.deleteAgent(
              op.params.agentId,
              op.params.workspaceId,
              op.params.workspacePath,
            );
            results.push(deleteResult);
            break;
          default:
            results.push({ success: false, error: `Unknown operation: ${op.type}` });
        }
      }
      return { success: true, results };
    } catch (error) {
      logger.error('Failed to execute batch operations', error as Error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Handle persistence metrics
   */
  private async handlePersistenceMetrics(): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      // Get metrics from persistence layer
      // Note: These methods don't exist in UnifiedPersistence yet, returning placeholder data
      const metrics = {
        totalSessions: 0,
        totalMessages: 0,
        storageSize: 0,
        lastCleanup: null,
      };
      return { success: true, data: metrics };
    } catch (error) {
      logger.error('Failed to get persistence metrics', error as Error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Handle persistence clear
   */
  private async handlePersistenceClear(
    _event: IpcMainInvokeEvent,
    validated: any,
  ): Promise<{ success: boolean; error?: string }> {
    const { workspaceId } = validated;
    try {
      // Note: clearWorkspace and clearAll not yet implemented in UnifiedPersistence
      logger.info('Persistence clear requested', { workspaceId });
      return { success: true };
    } catch (error) {
      logger.error('Failed to clear persistence', error as Error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Handle activate agent - Resume an existing agent session
   */
  private async handleActivateAgent(
    _event: IpcMainInvokeEvent,
    validated: any,
  ): Promise<{ success: boolean; error?: string; backendSessionId?: string; agent?: any }> {
    const { agentId, workspaceId } = validated;

    logger.info('handleActivateAgent called - resuming existing session', {
      agentId,
      workspaceId,
      hasWorkspaceId: !!workspaceId,
      workspaceIdType: typeof workspaceId,
      validatedKeys: Object.keys(validated),
    });

    try {
      const backend = await this.getBackend();

      // First check if agent is already in memory (active session)
      let agent = await backend.getAgent(agentId);

      if (!agent) {
        // Agent not in memory, load from persistence and restore session
        const wsId = workspaceId || this.getWorkspaceIdForAgent();

        logger.info('Agent not in memory, loading from persistence to resume', {
          agentId,
          workspaceId,
          wsId,
          hasWsId: !!wsId,
        });

        if (wsId) {
          const workspace = {
            id: wsId,
            path: WorkspaceConfig.paths.workspace(wsId),
            title: 'Workspace',
          };

          // Load the agent from disk
          const loadResult = await backend.loadAgent(agentId, workspace);
          if (!loadResult.success || !loadResult.agent) {
            return { success: false, error: 'Agent not found' };
          }

          const loadedAgent = loadResult.agent;
          logger.info('Loaded agent from disk, resuming session', {
            agentId,
            hasSystemPrompt: !!loadedAgent.systemPrompt,
            systemPromptLength: loadedAgent.systemPrompt?.length || 0,
            name: loadedAgent.name,
            messageCount: loadedAgent.messages?.length || 0,
            hasBackendSessionId: !!loadedAgent.backendSessionId,
          });

          // Resume the session by restoring it to memory
          // The loaded agent already has all its messages and state
          agent = await this.resumeAgentSession(loadedAgent);

          if (!agent) {
            logger.error('Failed to resume agent session', {
              agentId,
              providedWorkspaceId: workspaceId,
              fallbackResult: this.getWorkspaceIdForAgent(),
            });
            return { success: false, error: 'Workspace not found for agent' };
          }
        } else {
          logger.error('No workspace ID found for agent', {
            agentId,
          });
          return { success: false, error: 'No workspace ID found' };
        }
      } else {
        logger.info('Agent already active in memory', {
          agentId: agent.id,
          backendSessionId: agent.backendSessionId,
        });
      }

      // Log what we're returning to debug message preservation
      logger.info('Returning activated agent', {
        agentId: agent.id,
        backendSessionId: agent.backendSessionId || agent.id,
        messageCount: agent.messages?.length || 0,
        hasMessages: !!agent.messages,
        messagesArray: Array.isArray(agent.messages),
      });

      return {
        success: true,
        backendSessionId: agent.backendSessionId || agent.id,
        agent,
      };
    } catch (error) {
      logger.error('Failed to activate agent', error as Error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Resume an agent session by restoring it to memory
   * This is used when an agent exists on disk but not in memory
   */
  private async resumeAgentSession(
    loadedAgent: AgentSession,
  ): Promise<AgentSession | null> {
    try {
      const backend = await this.getBackend();

      logger.info('Resuming agent session in memory', {
        agentId: loadedAgent.id,
        sessionId: loadedAgent.backendSessionId || loadedAgent.id,
        workspaceId: loadedAgent.workspaceId,
        messageCount: loadedAgent.messages?.length || 0,
        hasBackendSessionId: !!loadedAgent.backendSessionId,
      });

      // Use the backend's resumeSession method to properly restore the session
      const result = await backend.resumeSession(loadedAgent);

      if (!result.success) {
        logger.error('Backend failed to resume session', {
          agentId: loadedAgent.id,
          error: result.error,
        });
        return null;
      }

      // Mark as active
      this.activeSessions.set(loadedAgent.id, {
        status: 'active',
        activatedAt: Date.now(),
      });

      return result.agent || loadedAgent;
    } catch (error) {
      logger.error('Failed to resume agent session', error as Error);
      return null;
    }
  }

  /**
   * Get workspace ID for an agent (helper method)
   * Note: Currently returns null as agent-workspace relationships are tracked externally.
   * The caller should always provide workspaceId when available.
   */
  private getWorkspaceIdForAgent(): string | null {
    // Agent-workspace relationships are tracked in the frontend state and persistence layer
    // This method is kept as a fallback but callers should always provide workspaceId when available
    return null;
  }

  /**
   * Handle lifecycle start
   */
  private async handleLifecycleStart(
    _event: IpcMainInvokeEvent,
    validated: any,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { agentId } = validated;
      // Mark agent as active/started
      this.activeSessions.set(agentId, { status: 'active', startedAt: Date.now() });
      logger.info('Agent lifecycle started', { agentId });
      return { success: true };
    } catch (error) {
      logger.error('Failed to start agent lifecycle', error as Error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Handle lifecycle stop
   */
  private async handleLifecycleStop(
    _event: IpcMainInvokeEvent,
    validated: any,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { agentId } = validated;
      // Similar to handleStopSession but for lifecycle management
      return await this.handleStopSession(_event, {
        agentId,
        _stopTrigger: 'lifecycle_stop',
        _stopReason: 'lifecycle_management',
      });
    } catch (error) {
      logger.error('Failed to stop agent lifecycle', error as Error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Handle messaging send
   */
  private async handleMessagingSend(
    _event: IpcMainInvokeEvent,
    validated: any,
  ): Promise<{ success: boolean; error?: string }> {
    const { agentId, message } = validated;
    try {
      // Forward to the regular send message handler
      return await this.handleSendMessage(_event, {
        agentId,
        sessionId: agentId,
        streamId: `${agentId}:${Date.now()}`, // Unique per message turn
        content: message.content || message,
        workspaceId: message.workspaceId,
      });
    } catch (error) {
      logger.error('Failed to send message via messaging channel', error as Error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Handle messaging receive
   */
  private async handleMessagingReceive(
    _event: IpcMainInvokeEvent,
    validated: any,
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      const { agentId } = validated;
      // Get the latest message or messages for the agent
      const messages = await agentPersistence.getMessages(agentId);
      return { success: true, data: messages };
    } catch (error) {
      logger.error('Failed to receive messages', error as Error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Start health check for a stream
   */
  private startStreamHealthCheck(agentId: string): void {
    // Clear any existing health check for this agent
    const existing = this.streamHealthChecks.get(agentId);
    if (existing) {
      clearInterval(existing);
    }

    // Initialize pong tracking for this agent
    this.lastPongTimes.set(agentId, Date.now());
    this.lastPingSentTimes.delete(agentId);

    // Counter to track health check iterations (send ping every 2nd iteration = 10 seconds)
    let healthCheckCount = 0;

    // Health check every 5 seconds
    const healthCheck = setInterval(() => {
      healthCheckCount++;
      const windows = BrowserWindow.getAllWindows();

      // If no windows exist, cleanup the stream and advance the queue
      if (windows.length === 0) {
        logger.warn('No renderer windows found, cleaning up stream', { agentId });
        // Capture workspaceId before cleanup deletes it from streamWorkspaceIds
        const wsId = this.streamWorkspaceIds.get(agentId);
        if (wsId) {
          this.finalizeStream(agentId, wsId, 'window-closed');
        } else {
          this.cleanupStreamResources(agentId);
        }
        return;
      }

      // IPC Heartbeat: Check for missed pongs before sending new ping
      const lastPingSent = this.lastPingSentTimes.get(agentId);
      const lastPongReceived = this.lastPongTimes.get(agentId);
      if (lastPingSent && lastPongReceived && lastPingSent > lastPongReceived) {
        const timeSincePing = Date.now() - lastPingSent;
        // If no pong received within 5 seconds of ping, log warning
        if (timeSincePing > 5000) {
          logger.warn('IPC heartbeat: missed pong from renderer', {
            agentId,
            timeSincePingMs: timeSincePing,
            lastPingSent: new Date(lastPingSent).toISOString(),
            lastPongReceived: new Date(lastPongReceived).toISOString(),
          });
        }
      }

      // Send ping every 10 seconds (every 2nd health check iteration)
      if (healthCheckCount % 2 === 0 && this.streamStartTimes.has(agentId)) {
        const pingChannel = `agent:stream:ping:${agentId}`;
        this.sendStreamToRenderer(agentId, pingChannel, { agentId, timestamp: Date.now() });
        this.lastPingSentTimes.set(agentId, Date.now());
        logger.debug('IPC heartbeat: sent ping to renderer', { agentId, pingChannel });
      }

      // Check if stream has been running too long (use maxStreamDuration from config)
      const startTime = this.streamStartTimes.get(agentId);
      const maxDuration = resolveStreamingConfig(DEFAULT_PROFILE).maxStreamDuration;
      if (startTime && Date.now() - startTime > maxDuration) {
        const duration = Date.now() - startTime;
        logger.warn('Stream timeout, attempting graceful completion', {
          agentId,
          duration,
          maxDuration,
        });

        // Try to get accumulated content before cleanup
        let finalContentBlocks: ContentBlock[] = [];
        try {
          const { contentBlocks } = messageAccumulator.getPartialContent(agentId);
          finalContentBlocks = contentBlocks;
          logger.info('Stream timeout: recovered partial content', {
            agentId,
            blockCount: finalContentBlocks.length,
          });
        } catch (error) {
          logger.warn('Stream timeout: could not recover partial content', { agentId, error });
        }

        const timeoutMinutes = Math.round(maxDuration / 60000);
        const workspaceId = this.streamWorkspaceIds.get(agentId);

        // If we have content, send a completion with the partial content
        if (finalContentBlocks.length > 0) {
          const partialMessage = {
            id: `msg_timeout_${Date.now()}`,
            role: 'assistant' as const,
            contentBlocks: finalContentBlocks,
            timestamp: new Date().toISOString(),
            metadata: { timedOut: true, duration },
          };

          this.sendStreamToRenderer(agentId, `agent:stream:${agentId}`, {
            type: 'complete',
            streamId: agentId,
            sessionId: agentId,
            message: partialMessage,
            finishReason: 'timeout',
          });
        } else {
          // No content recovered, send error
          this.sendStreamToRenderer(agentId, `agent:stream:${agentId}`, {
            type: 'error',
            error: `Stream timeout after ${timeoutMinutes} minutes`,
            sessionId: agentId,
          });
        }

        // IMPORTANT: finalizeStream MUST run BEFORE emitAgentFailedEvent (same pattern
        // as onComplete/onError). emitAgentFailedEvent can trigger event subscription
        // delivery which races with queued message processing.
        if (workspaceId) {
          this.finalizeStream(agentId, workspaceId, 'timeout');
        } else {
          this.cleanupStreamResources(agentId);
        }

        // CRITICAL FIX: Always emit agent:failed event on timeout, regardless of whether
        // partial content was recovered. This ensures delegation subscriptions are triggered
        // so the parent orchestrator can be notified when delegated agents timeout.
        // emitAgentFailedEvent now coordinates setAgentStatus('failed') + event emission
        // in a single async chain for guaranteed ordering.
        // Track definitive agent outcome for timeout (backend ground truth)
        trackMain('Agent Outcome', {
          agent_id: agentId,
          workspace_id: workspaceId || 'unknown',
          outcome: 'errored',
          finish_reason: 'timeout',
          is_background: false,
          source: 'backend',
        });

        if (workspaceId) {
          this.getBackend()
            .then(async (backend) => {
              const agent = await backend.getAgent(agentId);
              const agentName = agent?.name || 'Agent';
              this.emitAgentFailedEvent(
                agentId,
                workspaceId,
                agentName,
                `Stream timeout after ${timeoutMinutes} minutes`,
              );
            })
            .catch((err) => {
              logger.warn('Failed to emit agent:failed event on timeout', {
                agentId,
                error: err,
              });
            });
        }
      }
    }, 5000);

    this.streamHealthChecks.set(agentId, healthCheck);
    logger.debug('Started health check for stream', { agentId });
  }

  /**
   * Get list of active streaming agent IDs with accumulated content
   * Used by frontend to re-register IPC handlers after page refresh/HMR
   * Includes the accumulated content so the frontend can restore without losing chunks
   */
  public getActiveStreams(): {
    agentId: string;
    sessionId: string;
    workspaceId: string;
    startTime: number;
    accumulatedContent?: { content: string; contentBlocks: ContentBlock[] };
  }[] {
    const activeStreams: {
      agentId: string;
      sessionId: string;
      workspaceId: string;
      startTime: number;
      accumulatedContent?: { content: string; contentBlocks: ContentBlock[] };
    }[] = [];

    // Log all active session IDs in the messageAccumulator for debugging
    const accumulatorSessionIds = messageAccumulator.getActiveSessionIds();
    logger.debug('getActiveStreams: checking messageAccumulator state', {
      streamStartTimesCount: this.streamStartTimes.size,
      streamStartTimesAgentIds: Array.from(this.streamStartTimes.keys()),
      accumulatorSessionIds,
    });

    // Collect stale stream IDs to clean up after iteration
    const staleStreamIds: string[] = [];

    for (const [agentId, startTime] of this.streamStartTimes) {
      const sessionId = this.streamSessionIds.get(agentId) || agentId;
      const workspaceId = this.streamWorkspaceIds.get(agentId) || '';

      // Check if this is a stale stream entry:
      // - No provider exists (stream not actually running)
      // - No accumulated content (nothing was received)
      // These are likely leftover entries from streams that ended but weren't cleaned up properly.
      const hasProvider = this.providers.has(agentId);

      // Get accumulated content from messageAccumulator (single source of truth for backend)
      // This includes all chunks received, even those the frontend missed during reload
      let accumulatedContent: { content: string; contentBlocks: ContentBlock[] } | undefined;
      try {
        const partial = messageAccumulator.getPartialContent(agentId);
        logger.debug('getActiveStreams: got partial content from accumulator', {
          agentId,
          workspaceId,
          hasContent: !!partial.content,
          contentLength: partial.content?.length || 0,
          contentBlocksCount: partial.contentBlocks?.length || 0,
          hasProvider,
        });
        if (partial.content || partial.contentBlocks.length > 0) {
          accumulatedContent = partial;
        }
      } catch (error) {
        logger.warn('getActiveStreams: could not get accumulated content for agent', {
          agentId,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // If there's no provider AND no accumulated content, this is a stale stream entry.
      // Don't report it as active - instead mark for cleanup.
      if (!hasProvider && !accumulatedContent) {
        logger.warn(
          'getActiveStreams: detected stale stream entry (no provider, no content), marking for cleanup',
          {
            agentId,
            workspaceId,
            startTime,
            streamAgeSeconds: Math.floor((Date.now() - startTime) / 1000),
          },
        );
        staleStreamIds.push(agentId);
        continue; // Don't include in activeStreams
      }

      activeStreams.push({ agentId, sessionId, workspaceId, startTime, accumulatedContent });
    }

    // Clean up stale streams after iteration to avoid modifying the map during iteration
    for (const staleAgentId of staleStreamIds) {
      logger.info('getActiveStreams: cleaning up stale stream entry', { agentId: staleAgentId });
      this.cleanupStreamResources(staleAgentId);
    }

    logger.debug('getActiveStreams: returning active streams', {
      count: activeStreams.length,
      agentIds: activeStreams.map((s) => s.agentId),
      workspaceIds: activeStreams.map((s) => s.workspaceId),
      withAccumulatedContent: activeStreams.filter((s) => s.accumulatedContent).length,
    });
    return activeStreams;
  }

  /**
   * Finalize a stream: clean up resources AND advance the message queue.
   *
   * This is the single, centralized method for terminal stream outcomes
   * (success, error, timeout, window closure). It enforces the invariant:
   *   "every terminated stream must attempt to process the next queued message."
   *
   * For non-terminal cleanup (auto-continue retries, interruptions, explicit stops,
   * stale-entry housekeeping) use `cleanupStreamResources` directly — those cases
   * intentionally skip queue advancement.
   *
   * @param agentId  - The agent whose stream just ended
   * @param workspaceId - Must be captured BEFORE cleanup (cleanup deletes it from streamWorkspaceIds)
   * @param reason   - Human-readable label for logging (e.g. 'complete', 'error', 'timeout')
   * @param generation - Optional stream generation token (passed through to cleanupStreamResources)
   */
  private finalizeStream(agentId: string, workspaceId: string, reason: string, generation?: number): void {
    this.cleanupStreamResources(agentId, generation);

    // CRITICAL: Clear pendingBackendDeliveries BEFORE any async work that could trigger
    // a new delivery (e.g., emitAgentIdleEvent → watchAgentIdleForDelivery → requestDeliverQueuedEvents
    // → sendBackendInitiatedMessage). If we leave this to the finally block in
    // sendBackendInitiatedMessage, the second delivery sees pendingBackendDeliveries still set
    // and returns DELIVERY_IN_FLIGHT, blocking the coordinator's wake-up.
    if (this.pendingBackendDeliveries.has(agentId)) {
      this.pendingBackendDeliveries.delete(agentId);
      const timeout = this.pendingBackendDeliveryTimeouts.get(agentId);
      if (timeout) {
        clearTimeout(timeout);
        this.pendingBackendDeliveryTimeouts.delete(agentId);
      }
      logger.info('Cleared pendingBackendDeliveries in finalizeStream (before idle event)', {
        agentId,
        reason,
      });
    }

    // DETERMINISTIC QUEUE PRIORITY: If there are queued messages, set a synchronous
    // reservation flag BEFORE any async work. sendBackendInitiatedMessage checks this
    // flag and defers if set, preventing event-triggered streams from racing ahead of
    // queued messages. Without this, emitAgentIdleEvent's async chain could call
    // sendBackendInitiatedMessage and start a new stream before processNextQueuedMessage
    // reaches the streamStartTimes.set() call (which is ~37 awaits deep in
    // handleBackendStreamMessage), causing queued messages to be indefinitely deferred.
    const queue = this.messageQueues.get(agentId);
    if (queue && queue.length > 0) {
      this.pendingQueueProcessing.add(agentId);
      logger.info('Set pendingQueueProcessing reservation for queued messages', {
        agentId,
        queueLength: queue.length,
        reason,
      });
    }

    // Advance the queue asynchronously so the current stack unwinds first
    setTimeout(() => {
      this.processNextQueuedMessage(agentId, workspaceId)
        .catch((queueError) => {
          logger.error(`Error processing next queued message after stream ${reason}`, {
            agentId,
            error: queueError instanceof Error ? queueError.message : String(queueError),
          });
        })
        .finally(() => {
          // Always clear the reservation flag when queue processing completes (success or failure)
          if (this.pendingQueueProcessing.has(agentId)) {
            this.pendingQueueProcessing.delete(agentId);
            logger.info('Cleared pendingQueueProcessing reservation', { agentId, reason });
          }
        });
    }, 0);
  }

  /**
   * Cleanup stream resources (low-level — does NOT advance the queue).
   *
   * Use `finalizeStream` instead for terminal stream outcomes (success, error,
   * timeout, window closure) so the queue invariant is enforced automatically.
   *
   * @param agentId - The agent whose stream resources to clean up
   * @param generation - Optional stream generation token. When provided, cleanup is
   *   skipped if a newer stream has started (prevents stale interrupted-stream cleanup
   *   from erasing a newer stream's tracking state).
   */
  private cleanupStreamResources(agentId: string, generation?: number): void {
    // Generation guard: if a newer stream has started, this cleanup belongs to a stale
    // stream. Skip it to avoid erasing the newer stream's tracking maps.
    if (generation !== undefined) {
      const currentGeneration = this.streamGenerations.get(agentId) || 0;
      if (generation < currentGeneration) {
        logger.info('Skipping stale stream cleanup (generation mismatch)', {
          agentId,
          cleanupGeneration: generation,
          currentGeneration,
        });
        return;
      }
    }

    logger.debug('Cleaning up stream resources', { agentId, generation });

    // Clear health check interval
    const healthCheck = this.streamHealthChecks.get(agentId);
    if (healthCheck) {
      clearInterval(healthCheck);
      this.streamHealthChecks.delete(agentId);
    }

    // Clear stream start time, sessionId, workspaceId, and window ID
    this.streamStartTimes.delete(agentId);
    this.streamSessionIds.delete(agentId);
    this.streamWorkspaceIds.delete(agentId);
    this.streamWindowIds.delete(agentId);

    // Clear IPC heartbeat tracking
    this.lastPongTimes.delete(agentId);
    this.lastPingSentTimes.delete(agentId);

    // Clear completed streams tracking for this agent
    this.completedStreams.delete(agentId);

    // CRITICAL: Clear the messageAccumulator for this agent
    // This prevents content blocks from accumulating across multiple messages.
    // The accumulator must be cleared AFTER onComplete has read the content,
    // which is guaranteed because cleanupStreamResources is called after onComplete.
    try {
      messageAccumulator.clear(agentId);
      logger.debug('Cleared messageAccumulator for agent', { agentId });
    } catch (error) {
      logger.warn('Failed to clear messageAccumulator', {
        agentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // IMPORTANT: Do NOT delete the provider here!
    // The provider maintains the ACP session with auggie, which holds the conversation history.
    // If we delete the provider after each message, auggie will lose all context when we
    // send the next message (because a new session is created).
    //
    // The provider should only be cleaned up when:
    // 1. The agent is explicitly deleted (via deleteAgent)
    // 2. The workspace is closed
    // 3. There's an unrecoverable error
    //
    // Previously this code was deleting the provider, which caused auggie to lose
    // conversation history between messages.
    logger.debug('Stream resources cleaned up (provider preserved for session continuity)', {
      agentId,
      hasProvider: this.providers.has(agentId),
    });
  }

  /**
   * Clean up ALL per-agent tracking maps for a given agent.
   * Use this when an agent is fully stopped, deleted, or its workspace is closed.
   * This is the single source of truth for per-agent cleanup to prevent memory leaks
   * from orphaned map entries.
   *
   * NOTE: This does NOT call provider.cleanup()/provider.stop() — callers must handle
   * provider lifecycle separately before calling this method.
   */
  private cleanupAllAgentTrackingMaps(agentId: string): void {
    // Provider tracking
    this.providers.delete(agentId);
    this.providerLastUsed.delete(agentId);

    // Stream tracking
    this.streamStartTimes.delete(agentId);
    this.streamSessionIds.delete(agentId);
    this.streamWorkspaceIds.delete(agentId);
    this.streamWindowIds.delete(agentId);
    this.streamGenerations.delete(agentId);

    // Health check interval
    const healthCheck = this.streamHealthChecks.get(agentId);
    if (healthCheck) {
      clearInterval(healthCheck);
      this.streamHealthChecks.delete(agentId);
    }

    // IPC heartbeat tracking
    this.lastPongTimes.delete(agentId);
    this.lastPingSentTimes.delete(agentId);

    // Message queue tracking
    this.messageQueues.delete(agentId);
    this.processingQueue.delete(agentId);
    this.pendingQueueProcessing.delete(agentId);

    // Backend delivery tracking
    this.pendingBackendDeliveries.delete(agentId);
    const deliveryTimeout = this.pendingBackendDeliveryTimeouts.get(agentId);
    if (deliveryTimeout) {
      clearTimeout(deliveryTimeout);
      this.pendingBackendDeliveryTimeouts.delete(agentId);
    }

    // Agent state tracking
    this.activeSessions.delete(agentId);
    this.interruptedAgents.delete(agentId);
    this.completedStreams.delete(agentId);
    this.pendingHandlerReady.delete(agentId);
    this.emptyResponseRetries.delete(agentId);

    // Clear message accumulator
    try {
      messageAccumulator.clear(agentId);
    } catch {
      // Ignore - best effort cleanup
    }
  }

  /**
   * Send stream-related event to ALL windows viewing the agent's workspace.
   * This ensures that if multiple windows are open for the same workspace,
   * all of them receive streaming updates (not just the window that initiated the stream).
   * Falls back to broadcast if no workspace ID is tracked.
   * @param agentId - The agent ID to look up the target workspace for
   * @param channel - The IPC channel to send on
   * @param data - The data to send
   * @returns true if the message was sent successfully
   */
  private sendStreamToRenderer(agentId: string, channel: string, data: any): boolean {
    const workspaceId = this.streamWorkspaceIds.get(agentId);
    if (workspaceId) {
      // Send to ALL windows viewing this workspace
      const targetWindowIds = getWindowIdsForWorkspace(workspaceId);
      if (targetWindowIds.length > 0) {
        return this.sendToRenderer(channel, data, targetWindowIds);
      }
      // No windows found for workspace - fall back to broadcast
      logger.warn('sendStreamToRenderer: no windows found for workspace, broadcasting', {
        agentId,
        workspaceId,
        channel,
      });
    } else {
      // No workspace tracked - fall back to broadcast
      logger.warn('sendStreamToRenderer: no workspace tracked, broadcasting', {
        agentId,
        channel,
      });
    }
    return this.sendToRenderer(channel, data);
  }

  /**
   * Get workspace-scoped window IDs for an agent.
   * Used for non-streaming events (like queue updates) that should only go to
   * windows viewing the agent's workspace.
   * Returns undefined to broadcast to all windows if workspace is unknown.
   */
  private getWorkspaceWindowsForAgent(agentId: string): number[] | undefined {
    const workspaceId = this.streamWorkspaceIds.get(agentId);
    if (workspaceId) {
      const windowIds = getWindowIdsForWorkspace(workspaceId);
      if (windowIds.length > 0) {
        return windowIds;
      }
    }
    return undefined;
  }

  /**
   * Send event to renderer
   * @param channel - The IPC channel to send on
   * @param data - The data to send
   * @param targetWindowIds - Optional window ID(s) to target. If provided, only those windows receive the message.
   *                          Can be a single number or an array for multi-window workspace targeting.
   * @returns true if at least one window received the message
   */
  private sendToRenderer(channel: string, data: any, targetWindowIds?: number | number[]): boolean {
    const windows = BrowserWindow.getAllWindows();

    // Normalize target IDs to a Set for O(1) lookup
    const targetSet: Set<number> | undefined =
      targetWindowIds !== undefined
        ? new Set(Array.isArray(targetWindowIds) ? targetWindowIds : [targetWindowIds])
        : undefined;

    // Use debug level for streaming channels to reduce log noise
    // Streaming can generate hundreds of chunks per response
    if (channel.startsWith('agent:stream:')) {
      logger.debug('sendToRenderer called for streaming channel', {
        channel,
        windowCount: windows.length,
        dataType: data?.type,
        targetWindowIds: targetSet ? Array.from(targetSet) : undefined,
      });
    }

    let sentToAtLeastOne = false;

    windows.forEach((window, index) => {
      // Skip destroyed windows to avoid Electron errors
      if (window.isDestroyed()) {
        logger.debug('Skipping destroyed window', {
          channel,
          windowIndex: index,
          windowId: window.id,
        });
        return;
      }

      // If target windows are specified, only send to those windows
      if (targetSet && !targetSet.has(window.id)) {
        return;
      }

      try {
        window.webContents.send(channel, data);
        sentToAtLeastOne = true;
        // Only log non-chunk streaming events at info level
        // Chunk events are too frequent and should be debug level
        if (channel.startsWith('agent:stream:') && data?.type !== 'chunk') {
          logger.debug('Sent to window', {
            channel,
            windowId: window.id,
            dataType: data?.type,
            targeted: targetSet !== undefined,
          });
        }
      } catch (error) {
        logger.error('Failed to send to window', {
          channel,
          windowIndex: index,
          windowId: window.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    // Also broadcast to browser-mode WebSocket clients (HTTP bridge)
    // This allows the browser (non-Electron) renderer to receive streaming events
    const broadcast = (global as any).__browserIpcBroadcast;
    if (typeof broadcast === 'function') {
      broadcast(channel, data);
      sentToAtLeastOne = true;
    }

    // Log when no window received a streaming message (potential data loss)
    if (!sentToAtLeastOne && channel.startsWith('agent:stream:')) {
      logger.warn('Stream data not delivered - no window received message', {
        channel,
        dataType: data?.type,
        windowCount: windows.length,
        targetWindowIds: targetSet ? Array.from(targetSet) : undefined,
        timestamp: Date.now(),
      });
    }

    return sentToAtLeastOne;
  }

  /**
   * Public wrapper methods for AgentBackendAdapter
   * These methods delegate to the private handler methods
   */

  /**
   * Create a new agent
   */
  public async createAgent(
    workspaceId: string,
    name?: string,
    config?: any,
    agentId?: string,
  ): Promise<AgentSession | null> {
    try {
      const result = await this.handleCreateAgent(null as any, {
        workspaceId,
        workspacePath: config?.workspacePath || '',
        name,
        agentId,
        model: config?.model,
        provider: config?.provider, // Forward provider for correct agent attribution & delegated agents
        agentType: config?.agentType, // Pass agentType at top level for system prompt building
        behaviorPrompt: config?.behaviorPrompt, // Pass custom behavior instructions
        specialistName: config?.specialistName, // Pass specialist display name
        roleReminder: config?.roleReminder, // Pass role reminder for specialist
        systemPrompt: config?.systemPrompt,
        initialMessage: config?.initialMessage,
        contextReferences: config?.contextReferences,
        metadata: config?.metadata,
        onBeforeStart: config?.onBeforeStart, // Pass pre-start hook for subscription setup
      });
      if (!result.success) {
        logger.error('Failed to create agent', {
          workspaceId,
          name,
          error: result.error,
          agentType: config?.agentType,
        });
        return null;
      }
      return result.agent || null;
    } catch (error) {
      logger.error('Error creating agent (exception)', error as Error);
      return null;
    }
  }

  /**
   * Resume an existing agent session
   * This is used when an agent with messages needs to be activated
   */
  public async resumeAgent(
    agentId: string,
    workspaceId: string,
    existingAgent: AgentSession,
  ): Promise<AgentSession | null> {
    try {
      logger.info('Resuming agent session', {
        agentId,
        workspaceId,
        messageCount: existingAgent.messages?.length || 0,
        hasBackendSessionId: !!existingAgent.backendSessionId,
      });

      const backend = await this.getBackend();

      // Check if agent is already in memory
      let agent = await backend.getAgent(agentId);
      if (agent) {
        logger.info('Agent already in memory, returning existing session', {
          agentId,
          backendSessionId: agent.backendSessionId,
        });
        return agent;
      }

      // Agent not in memory, restore it
      // Resume the session by restoring it to memory
      agent = await this.resumeAgentSession(existingAgent);

      if (!agent) {
        logger.error('Failed to resume agent session', {
          agentId,
          workspaceId,
        });
        return null;
      }

      logger.info('Agent session resumed successfully', {
        agentId: agent.id,
        backendSessionId: agent.backendSessionId,
        messageCount: agent.messages?.length || 0,
      });

      return agent;
    } catch (error) {
      logger.error('Error resuming agent', error as Error);
      return null;
    }
  }

  /**
   * List agents for a workspace (in-memory only)
   */
  public async listAgents(workspaceId?: string): Promise<AgentSession[]> {
    try {
      if (workspaceId) {
        return await this.handleListAgents(null as any, workspaceId);
      } else {
        // Get all agents across all workspaces
        return await this.getAllAgents();
      }
    } catch (error) {
      logger.error('Error listing agents', error as Error);
      return [];
    }
  }

  /**
   * List all agents for a workspace, merging in-memory sessions with disk-persisted agents.
   * This ensures agents remain visible across app restarts even if they haven't been
   * resumed into memory. In-memory sessions take precedence over disk data for the same
   * agent ID since they reflect the most current state.
   */
  public async listAllAgents(workspaceId: string): Promise<AgentSession[]> {
    try {
      // 1. Get in-memory sessions (most up-to-date state)
      const inMemorySessions = await this.handleListAgents(null as any, workspaceId);

      // 2. Get persisted agents from disk (cached via handlePersistenceList)
      let persistedAgents: AgentSession[] = [];
      try {
        const persistedResult = await this.handlePersistenceList(null as any, { workspaceId });
        if (persistedResult.success && persistedResult.data) {
          persistedAgents = persistedResult.data as AgentSession[];
        }
      } catch (error) {
        // If disk read fails, fall back to in-memory only
        logger.warn('Failed to load persisted agents, using in-memory only', {
          workspaceId,
          error: (error as Error).message,
        });
      }

      // 3. Merge: disk-persisted as base, in-memory overrides (more current)
      const agentMap = new Map<string, AgentSession>();
      for (const persisted of persistedAgents) {
        if (persisted.id) {
          agentMap.set(String(persisted.id), persisted);
        }
      }
      for (const session of inMemorySessions) {
        agentMap.set(String(session.id), session);
      }

      return Array.from(agentMap.values());
    } catch (error) {
      logger.error('Error listing all agents', error as Error);
      // Fall back to in-memory only on unexpected errors
      return this.listAgents(workspaceId);
    }
  }

  /**
   * Get all agents across all workspaces
   */
  public async getAllAgents(): Promise<AgentSession[]> {
    try {
      const backend = await this.getBackend();
      return await backend.getAllAgents();
    } catch (error) {
      logger.error('Error getting all agents', error as Error);
      return [];
    }
  }

  /**
   * Get a specific agent
   */
  public async getAgent(sessionId: string): Promise<AgentSession | null> {
    try {
      return await this.handleGetAgent(null as any, sessionId);
    } catch (error) {
      logger.error('Error getting agent', error as Error);
      return null;
    }
  }

  /**
   * Check if an agent is resumable/wakeable
   *
   * This is a system-wide method to determine the state of an agent:
   * - 'running': Provider exists and process is alive - can send messages directly
   * - 'resumable': No provider but data exists on disk - can restore and then send
   * - 'not_found': No provider and no persisted data - need to create new agent
   *
   * @param agentId The agent ID to check
   * @param workspaceId The workspace ID the agent belongs to
   * @returns Resumability information
   */
  public async getAgentResumability(
    agentId: string,
    workspaceId: string,
  ): Promise<AgentResumabilityResult> {
    try {
      // Check if provider exists in memory
      const provider = this.providers.get(agentId);
      const hasProvider = !!provider;

      // Check if process is alive (if provider exists)
      // Use the public isHealthy() method (available on BaseAgentProvider and overridden in ACPProvider)
      let processAlive = false;
      if (provider && typeof provider.isHealthy === 'function') {
        processAlive = provider.isHealthy();
      }

      // Check if persisted data exists on disk
      let hasPersistedData = false;
      let agentData: any = undefined;

      // DON'T pass workspacePath - let loadAgent use the correct metadata path internally
      // Using WorkspaceConfig.paths.agents(workspaceId) is the canonical way to get the agents directory
      const loadResult = await agentPersistence.loadAgent(
        agentId as AgentId,
        workspaceId as WorkspaceId,
      );

      if (loadResult.success && loadResult.data) {
        hasPersistedData = true;
        agentData = loadResult.data;
      }

      // Determine status
      let status: 'running' | 'resumable' | 'not_found';
      if (hasProvider && processAlive) {
        status = 'running';
      } else if (hasPersistedData) {
        status = 'resumable';
      } else {
        status = 'not_found';
      }

      const canWake = status === 'running' || status === 'resumable';

      logger.info('Agent resumability check', {
        agentId,
        workspaceId,
        status,
        canWake,
        hasProvider,
        hasPersistedData,
        processAlive,
      });

      return {
        canWake,
        status,
        hasProvider,
        hasPersistedData,
        processAlive,
        agentData,
      };
    } catch (error) {
      logger.error('Error checking agent resumability', { agentId, workspaceId, error });
      return {
        canWake: false,
        status: 'not_found',
        hasProvider: false,
        hasPersistedData: false,
        processAlive: false,
      };
    }
  }

  /**
   * Stream a message to an agent
   */
  public async streamMessage(
    sessionId: string,
    message: string,
    streamId?: string,
    options?: any,
  ): Promise<void> {
    try {
      await this.handleBackendStreamMessage(null as any, {
        agentId: sessionId,
        sessionId,
        streamId: streamId || sessionId,
        content: message,
        workspaceId: options?.workspaceId,
        contextReferences: options?.contextReferences,
        imageBlocks: options?.imageBlocks,
        model: options?.model,
        noteIds: options?.noteIds,
        personality: options?.personality,
        stdinContext: options?.stdinContext,
      });
    } catch (error) {
      logger.error('Error streaming message', error as Error);
      throw error;
    }
  }

  /**
   * Stop an agent
   */
  public async stopAgent(sessionId: string, trigger?: string): Promise<void> {
    try {
      await this.handleStopSession(null as any, {
        agentId: sessionId,
        _stopTrigger: trigger || 'programmatic_stop',
        _stopReason: trigger || 'stopAgent_call',
      });
    } catch (error) {
      logger.error('Error stopping agent', error as Error);
      throw error;
    }
  }

  /**
   * Clear the interruptedAgents flag for an agent.
   * Call this after successfully queueing a fallback message during interrupt delivery,
   * so that processNextQueuedMessage can pick up the queued message on the next cycle.
   */
  public clearInterruptedFlag(agentId: string): void {
    if (this.interruptedAgents.has(agentId)) {
      logger.info('Clearing interruptedAgents flag via clearInterruptedFlag', { agentId });
      this.interruptedAgents.delete(agentId);
    }
  }

  /**
   * Check if an agent has been marked as deleted.
   * Also runs eviction to keep the set bounded.
   */
  public isAgentDeleted(agentId: string): boolean {
    this.evictStaleDeletedAgents();
    return this.deletedAgentIds.has(agentId);
  }

  /**
   * Evict entries from deletedAgentIds that are older than DELETED_AGENT_EVICTION_MS.
   * Also enforces MAX_DELETED_AGENTS hard cap by removing oldest entries.
   */
  private evictStaleDeletedAgents(): void {
    const now = Date.now();
    for (const [id, deletedAt] of this.deletedAgentIds) {
      if (now - deletedAt > AgentBackendHandler.DELETED_AGENT_EVICTION_MS) {
        this.deletedAgentIds.delete(id);
      }
    }

    // Hard cap: if still over limit, remove oldest entries
    if (this.deletedAgentIds.size > AgentBackendHandler.MAX_DELETED_AGENTS) {
      const entries = [...this.deletedAgentIds.entries()].sort((a, b) => a[1] - b[1]);
      const toRemove = entries.slice(0, entries.length - AgentBackendHandler.MAX_DELETED_AGENTS);
      for (const [id] of toRemove) {
        this.deletedAgentIds.delete(id);
      }
    }
  }

  /**
   * Mark an agent as deleted in both the local guard set and the subscription service.
   * Called at the very start of handleDeleteAgent to close race windows.
   */
  private async markAgentAsDeleted(agentId: string, workspaceId?: string): Promise<void> {
    // Evict stale entries from local set
    this.evictStaleDeletedAgents();

    // Add to local guard set
    this.deletedAgentIds.set(agentId, Date.now());

    // Mark in subscription service (removes all subscriptions + prevents new ones)
    if (workspaceId) {
      try {
        const { markAgentAsDeleted } =
          await import('../../events/main/agent-subscription-ops');
        markAgentAsDeleted(workspaceId, agentId);
      } catch (err) {
        logger.error(
          '[AgentBackendHandler] Failed to mark agent as deleted in subscription service',
          {
            agentId,
            workspaceId,
            error: err,
          },
        );
      }
    }

    logger.info('[AgentBackendHandler] Agent marked as deleted', {
      agentId,
      workspaceId,
      deletedAgentIdsCount: this.deletedAgentIds.size,
    });
  }

  /**
   * Delete an agent
   */
  public async deleteAgent(sessionId: string, workspaceId?: string): Promise<void> {
    try {
      await this.handleDeleteAgent(null as any, {
        agentId: sessionId,
        sessionId,
        workspaceId,
        deleteMessages: true,
      });
    } catch (error) {
      logger.error('Error deleting agent', error as Error);
      throw error;
    }
  }

  /**
   * Public wrapper for handleDeleteSession
   */
  public async handleDeleteSession(
    event: any,
    params: { sessionId: string; deleteMessages?: boolean },
  ): Promise<{ success: boolean; error?: string }> {
    return await this.handleDeleteAgent(event, {
      agentId: params.sessionId,
      sessionId: params.sessionId,
      deleteMessages: params.deleteMessages,
    });
  }

  /**
   * Public wrapper for sending messages
   * Named differently to avoid conflict with private handleSendMessage
   */
  public async sendMessage(
    event: any,
    params: { sessionId: string; message: string; [key: string]: any },
  ): Promise<{ success: boolean; error?: string }> {
    const { sessionId, message, ...otherParams } = params;
    return await this.handleBackendStreamMessage(event, {
      agentId: sessionId,
      sessionId,
      streamId: sessionId,
      content: message,
      ...otherParams,
    });
  }

  /**
   * Send a message from a backend-initiated context (wake handler, system events, etc.)
   * This handles the frontend handshake to ensure stream handlers are registered
   * before streaming begins, and emits agent:created so the agent appears in the dock.
   *
   * Use this instead of sendMessage() when the message originates from the backend
   * (not from a user action in the frontend).
   */
  public async sendBackendInitiatedMessage(params: {
    sessionId: string;
    message: string;
    workspaceId: string;
    messageMetadata?: any;
    [key: string]: any;
  }): Promise<{ success: boolean; error?: string; errorCode?: string }> {
    const { sessionId, message, workspaceId, messageMetadata, ...otherParams } = params;

    // Diagnostic state dump: log all guard-relevant state so we can trace which guard
    // blocks delivery (especially for second wake-up delivery to coordinators).
    logger.info('Backend-initiated message: guard state dump', {
      agentId: sessionId,
      workspaceId,
      isDeleted: this.isAgentDeleted(sessionId),
      hasActiveStream: this.streamStartTimes.has(sessionId),
      streamAgeMs: this.streamStartTimes.has(sessionId) ? Date.now() - (this.streamStartTimes.get(sessionId) || 0) : null,
      hasPendingQueueProcessing: this.pendingQueueProcessing.has(sessionId),
      hasPendingBackendDelivery: this.pendingBackendDeliveries.has(sessionId),
      queueLength: this.messageQueues.get(sessionId)?.length || 0,
      hasProvider: this.providers.has(sessionId),
    });

    // CRITICAL GUARD: Reject messages for deleted agents FIRST, before any other checks.
    // This prevents resurrection of deleted agents from persistence backup.
    // Must be checked before provider health, streaming, and queue checks — a dead
    // provider for a deleted agent should not trigger cleanup or resurrection logic.
    if (this.isAgentDeleted(sessionId)) {
      logger.warn('Backend-initiated message: agent has been deleted, rejecting delivery', {
        agentId: sessionId,
        workspaceId,
      });
      return {
        success: false,
        error: 'Agent has been deleted',
        errorCode: 'AGENT_DELETED',
      };
    }

    logger.info('Backend-initiated message: checking if frontend handshake needed', {
      agentId: sessionId,
      workspaceId,
      hasMessageMetadata: !!messageMetadata,
      messageMetadataType: messageMetadata?.type,
    });

    // Check if we already have a provider for this agent
    let existingProvider = this.providers.get(sessionId);

    // RESILIENCE: If the provider exists but its ACP process has died (e.g., crash, SSH disconnect),
    // remove the dead provider so the "no provider" path below creates a fresh one.
    // Without this, all retries would fail against the dead provider and the parent agent
    // would hang indefinitely waiting for a wake-up message that can never be delivered.
    if (
      existingProvider &&
      typeof existingProvider.isHealthy === 'function' &&
      !existingProvider.isHealthy()
    ) {
      logger.warn(
        'Backend-initiated message: existing provider process is dead, removing stale provider',
        {
          agentId: sessionId,
          workspaceId,
        },
      );
      try {
        if (typeof existingProvider.cleanup === 'function') {
          await existingProvider.cleanup();
        }
      } catch (cleanupError) {
        logger.warn('Error cleaning up dead provider', { agentId: sessionId, error: cleanupError });
      }
      this.providers.delete(sessionId);
      this.providerLastUsed.delete(sessionId);
      // Clean up all stream tracking state (consistent with cleanupStreamResources)
      this.streamStartTimes.delete(sessionId);
      this.streamSessionIds.delete(sessionId);
      this.streamWorkspaceIds.delete(sessionId);
      this.streamWindowIds.delete(sessionId);
      this.streamGenerations.delete(sessionId);
      existingProvider = undefined;
    }

    // CRITICAL GUARD: If the agent is already streaming, do NOT start a new stream.
    // Starting a new stream while one is in progress corrupts the existing stream by
    // orphaning its onComplete callback, leaving the agent permanently stuck in
    // isStreaming=true. This happens when event delivery retries fire while the agent
    // is still processing the first delivery.
    if (this.streamStartTimes.has(sessionId)) {
      const streamAge = Date.now() - (this.streamStartTimes.get(sessionId) || 0);
      logger.warn('Backend-initiated message: agent is already streaming, rejecting delivery', {
        agentId: sessionId,
        workspaceId,
        streamAgeMs: streamAge,
      });
      return {
        success: false,
        error: `Agent is already streaming (started ${Math.round(streamAge / 1000)}s ago). Message not delivered to avoid corrupting the in-progress stream.`,
        errorCode: 'ALREADY_STREAMING',
      };
    }

    // QUEUE PRIORITY GUARD: If queued messages are pending processing (set synchronously
    // by finalizeStream), defer event delivery so queued messages go first.
    // handleBackendStreamMessage has ~37 await points before setting streamStartTimes,
    // so the streamStartTimes guard above can't catch this race. The event subscription
    // service will retry delivery after the queued message stream completes.
    if (this.pendingQueueProcessing.has(sessionId)) {
      logger.info('Backend-initiated message: queued messages pending, deferring event delivery', {
        agentId: sessionId,
        workspaceId,
        queueLength: this.messageQueues.get(sessionId)?.length || 0,
      });
      return {
        success: false,
        error:
          'Queued messages are pending processing. Event delivery deferred until queue is drained.',
        errorCode: 'QUEUE_PENDING',
      };
    }

    // CONCURRENT DELIVERY GUARD: If a backend-initiated delivery is already in flight
    // for this agent, reject the duplicate. This happens when multiple subscriptions
    // (e.g., oneShot from send_message_to_task_agent + non-oneShot from wake_or_create)
    // match the same event simultaneously, causing two concurrent deliverEvents calls.
    // Both pass the streamStartTimes guard (neither has started streaming yet) and both
    // create wake messages, resulting in duplicate wake-up notifications in the UI.
    if (this.pendingBackendDeliveries.has(sessionId)) {
      logger.info('Backend-initiated message: delivery already in flight, rejecting duplicate', {
        agentId: sessionId,
        workspaceId,
      });
      return {
        success: false,
        error: 'A backend-initiated delivery is already in flight for this agent.',
        errorCode: 'DELIVERY_IN_FLIGHT',
      };
    }

    // Mark delivery as in-flight BEFORE any async work
    this.pendingBackendDeliveries.add(sessionId);

    // Safety timeout: force-clear the pending delivery flag after 5 minutes.
    // If handleBackendStreamMessage hangs, the finally block never runs and
    // the agent becomes permanently unreachable for backend-initiated messages.
    const deliveryTimeout = setTimeout(() => {
      if (this.pendingBackendDeliveries.has(sessionId)) {
        logger.warn('Backend-initiated delivery safety timeout expired, force-clearing pending flag', {
          agentId: sessionId,
          workspaceId,
          timeoutMs: AgentBackendHandler.PENDING_DELIVERY_TIMEOUT_MS,
        });
        this.pendingBackendDeliveries.delete(sessionId);
        this.pendingBackendDeliveryTimeouts.delete(sessionId);
      }
    }, AgentBackendHandler.PENDING_DELIVERY_TIMEOUT_MS);
    this.pendingBackendDeliveryTimeouts.set(sessionId, deliveryTimeout);

    try {
    if (!existingProvider) {
      // No provider exists - we need to do the frontend handshake before streaming
      // Load agent from persistence to get agent info for the handshake
      // DON'T pass workspacePath - let loadAgent use the correct metadata path internally
      const loadResult = await agentPersistence.loadAgent(
        sessionId as AgentId,
        workspaceId as WorkspaceId,
      );

      if (loadResult.success && loadResult.data) {
        logger.info('Backend-initiated message: performing frontend handshake', {
          agentId: sessionId,
          workspaceId,
          agentName: loadResult.data.name,
        });

        // Step 1 & 2: Request frontend to prepare handler and wait for ready signal
        // Non-fatal: If the frontend isn't ready (e.g., coordinator's chat panel not visible),
        // continue anyway. The agent:stream-starting safety net on the frontend will register
        // handlers when streaming begins, and agent:created will add the agent to the dock.
        try {
          await this.requestFrontendHandler(sessionId, workspaceId, {
            name: loadResult.data.name,
            model: loadResult.data.model,
          });
          logger.info('Backend-initiated message: frontend handshake completed (no provider path)', {
            agentId: sessionId,
            workspaceId,
            note: 'requestFrontendHandler returns early with no error when no windows exist for the workspace',
          });
        } catch (handshakeError) {
          logger.warn(
            'Backend-initiated message: frontend handshake failed (non-fatal), continuing without UI',
            {
              agentId: sessionId,
              workspaceId,
              error:
                handshakeError instanceof Error ? handshakeError.message : String(handshakeError),
            },
          );
        }

        // Step 3: Emit agent:created to add to dock/session store
        // IMPORTANT: Include the wake message in the session so frontend has it from the start
        // This fixes the issue where backend-initiated messages weren't showing in the UI
        // because agent:created fired before the message was added to backend session
        const backend = await this.getBackend();
        const { AgentStatus } = await import('../../../shared/types/agent.types.js');

        // Construct the wake message to include in agent:created
        // This ensures the frontend sessionStore has the message from the beginning
        const wakeMessageId = `msg_${uuidv4()}`;
        const wakeMessage = {
          id: wakeMessageId,
          role: 'user' as const,
          contentBlocks: [{ type: 'text' as const, text: message }],
          timestamp: new Date().toISOString(),
          ...(messageMetadata && { metadata: messageMetadata }),
        };

        // Include the wake message in the messages array
        const messagesWithWake = [...(loadResult.data.messages || []), wakeMessage];

        // Resolve model with provider-aware fallback (only for non-default providers)
        // Note: loadResult.data may have config from persistence even though AgentSession type doesn't include it
        const loadedData = loadResult.data as any;
        let sessionModel = loadedData.model || loadedData.config?.model || DEFAULT_AGENT_MODEL;
        const sessionProvider = loadedData.config?.provider || loadedData.metadata?.provider;
        if (sessionModel === DEFAULT_AGENT_MODEL && sessionProvider) {
          const { getDefaultModelForProvider, getDefaultProviderId, PROVIDER_MODEL_TIERS } =
            await import('$shared/config/provider-config');
          const defaultProviderId = getDefaultProviderId();
          // Only resolve for providers with known tier mappings
          if (sessionProvider !== defaultProviderId && sessionProvider in PROVIDER_MODEL_TIERS) {
            const baseModel = getDefaultModelForProvider(sessionProvider, 'balanced');
            sessionModel = `${sessionProvider}:${baseModel}`;
          } else if (sessionProvider !== defaultProviderId) {
            // Provider has dynamic models not in PROVIDER_MODEL_TIERS (e.g., opencode).
            // Use 'default' to let the provider pick its own default model.
            sessionModel = 'default';
            logger.info('Using provider default model for provider without tier mappings', {
              agentId: sessionId,
              provider: sessionProvider,
            });
          }
        }

        const agentSession: AgentSession = {
          id: sessionId as AgentId,
          workspaceId: workspaceId as WorkspaceId,
          name: loadedData.name || 'Agent',
          status: AgentStatus.Idle,
          model: sessionModel,
          systemPrompt: loadedData.systemPrompt,
          messages: messagesWithWake,
          createdAt: loadedData.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          metadata: loadedData.metadata || {},
          backendSessionId: loadedData.backendSessionId,
          provider:
            loadedData.provider ?? loadedData.config?.provider ?? loadedData.metadata?.provider,
        };

        logger.info('Backend-initiated message: emitting agent:created event', {
          agentId: sessionId,
          workspaceId,
          agentName: agentSession.name,
          messageCount: messagesWithWake.length,
          wakeMessageId,
        });

        // CRITICAL: Resume the session in backend memory BEFORE streaming
        // This ensures backend.getSession() returns the session during onComplete
        // so the wake message and assistant response get persisted to disk
        const resumeResult = await backend.resumeSession(agentSession);
        if (!resumeResult.success) {
          logger.warn('Backend-initiated message: failed to resume session in memory', {
            agentId: sessionId,
            error: resumeResult.error,
          });
        } else {
          logger.info('Backend-initiated message: session resumed in memory', {
            agentId: sessionId,
            messageCount: messagesWithWake.length,
          });
        }

        backend.emit('agent:created', {
          agentId: sessionId,
          workspaceId,
          agent: agentSession,
        });

        logger.info(
          'Backend-initiated message: agent:created emitted, frontend handler registered',
          {
            agentId: sessionId,
            includesWakeMessage: true,
          },
        );

        // Tell handleBackendStreamMessage to skip adding the user message since we already included it
        // Pass the same message ID so the backend uses it for persistence
        // CRITICAL: Pass agentName so handleSendMessage doesn't fall back to 'Agent'
        return await this.handleBackendStreamMessage(null as any, {
          agentId: sessionId,
          sessionId,
          streamId: sessionId,
          content: message,
          workspaceId,
          skipUserMessage: true,
          queuedMessageId: wakeMessageId, // Use same ID for consistency
          agentName: agentSession.name,
          messages: messagesWithWake, // Pass in-memory messages so handleSendMessage uses them instead of reloading from disk
          ...otherParams,
        });
      } else {
        logger.warn('Backend-initiated message: could not load agent from persistence', {
          agentId: sessionId,
          error: loadResult.error,
        });
        // Continue anyway - handleSendMessage will try to load it too
      }
    } else {
      // Provider exists, but we still need to ensure the frontend has stream handlers set up
      // The frontend may have cleaned up handlers after the previous stream completed,
      // or the ChatPanel may not be mounted (agent is in dock but not selected)
      logger.info('Backend-initiated message: provider exists, requesting frontend handler', {
        agentId: sessionId,
      });

      // Get agent info from the existing provider or persistence
      // Default to workspace title if agent name is not available
      let agentName = 'Agent';
      let agentModel: string | undefined = undefined; // Will be resolved with provider-aware fallback

      // Try to get workspace title for fallback name
      try {
        const workspaceResult = await workspaceService.getWorkspace(workspaceId as any);
        if (workspaceResult.ok && workspaceResult.data?.title) {
          agentName = workspaceResult.data.title;
        }
      } catch {
        // Ignore - use default name
      }

      // Try to get info from the backend session
      const backend = await this.getBackend();
      let existingSession = backend.getSession(sessionId);

      // If no session in memory but provider exists, load from persistence and resume
      // This handles the case where the session was evicted from memory but the provider is still alive
      if (!existingSession) {
        logger.info(
          'Backend-initiated message: provider exists but no session in memory, loading from persistence',
          {
            agentId: sessionId,
            workspaceId,
          },
        );

        const loadResult = await agentPersistence.loadAgent(
          sessionId as AgentId,
          workspaceId as WorkspaceId,
        );

        if (loadResult.success && loadResult.data) {
          // Note: loadResult.data may have config from persistence even though AgentSession type doesn't include it
          const loadedData = loadResult.data as any;
          agentName = loadedData.name || agentName;

          // Resolve model with provider-aware fallback (only for non-default providers)
          let sessionModel = loadedData.model || loadedData.config?.model || DEFAULT_AGENT_MODEL;
          const sessionProvider = loadedData.config?.provider || loadedData.metadata?.provider;
          if (sessionModel === DEFAULT_AGENT_MODEL && sessionProvider) {
            const { getDefaultModelForProvider, getDefaultProviderId, PROVIDER_MODEL_TIERS } =
              await import('$shared/config/provider-config');
            const defaultProviderId = getDefaultProviderId();
            // Only resolve for providers with known tier mappings
            if (sessionProvider !== defaultProviderId && sessionProvider in PROVIDER_MODEL_TIERS) {
              const baseModel = getDefaultModelForProvider(sessionProvider, 'balanced');
              sessionModel = `${sessionProvider}:${baseModel}`;
            } else if (sessionProvider !== defaultProviderId) {
              // Provider has dynamic models not in PROVIDER_MODEL_TIERS (e.g., opencode).
              // Use 'default' to let the provider pick its own default model.
              sessionModel = 'default';
              logger.info('Using provider default model for provider without tier mappings', {
                agentId: sessionId,
                provider: sessionProvider,
              });
            }
          }
          agentModel = sessionModel;

          // Resume the session in memory so the wake message can be persisted
          const { AgentStatus } = await import('../../../shared/types/agent.types.js');
          const resumeSession: AgentSession = {
            id: sessionId as AgentId,
            workspaceId: workspaceId as WorkspaceId,
            name: loadedData.name || agentName,
            status: AgentStatus.Idle,
            model: sessionModel,
            systemPrompt: loadedData.systemPrompt,
            messages: loadedData.messages || [],
            createdAt: loadedData.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            metadata: loadedData.metadata || {},
            backendSessionId: loadedData.backendSessionId,
            provider:
              loadedData.provider ?? loadedData.config?.provider ?? loadedData.metadata?.provider,
          };

          const resumeResult = await backend.resumeSession(resumeSession);
          if (resumeResult.success) {
            existingSession = backend.getSession(sessionId);
            logger.info('Backend-initiated message: resumed session from persistence', {
              agentId: sessionId,
              messageCount: existingSession?.messages?.length || 0,
            });
          } else {
            logger.warn('Backend-initiated message: failed to resume session from persistence', {
              agentId: sessionId,
              error: resumeResult.error,
            });
          }
        }
      } else {
        agentName = existingSession.name || agentName;
        agentModel = existingSession.model || agentModel;
      }

      // Create the wake message with metadata so frontend can display it
      // This is critical for showing the EventWakeupBanner in the chat history
      const wakeMessageId = `msg_${uuidv4()}`;
      const wakeMessage = {
        id: wakeMessageId,
        role: 'user' as const,
        contentBlocks: [{ type: 'text' as const, text: message }],
        timestamp: new Date().toISOString(),
        ...(messageMetadata && { metadata: messageMetadata }),
      };

      logger.info('Backend-initiated message: created wake message for existing provider', {
        agentId: sessionId,
        wakeMessageId,
        hasMetadata: !!messageMetadata,
        metadataType: messageMetadata?.type,
        eventTypes: messageMetadata?.eventTypes,
        eventCount: messageMetadata?.eventCount,
        wakeMessageMetadata: wakeMessage.metadata,
      });

      // Add the wake message to the backend session for persistence
      // This ensures the message is saved when the agent completes
      if (existingSession) {
        if (!existingSession.messages) {
          existingSession.messages = [];
        }
        existingSession.messages.push(wakeMessage);
        logger.info('Backend-initiated message: added wake message to backend session', {
          agentId: sessionId,
          wakeMessageId,
          messageCount: existingSession.messages.length,
        });
      } else {
        logger.warn('Backend-initiated message: no session available to add wake message', {
          agentId: sessionId,
          workspaceId,
        });
      }

      // Request frontend to prepare handler and wait for ready signal
      // This ensures the frontend has stream handlers set up before we start streaming
      // Include the wake message so frontend can add it to the session
      try {
        await this.requestFrontendHandler(
          sessionId,
          workspaceId,
          {
            name: agentName,
            model: agentModel,
          },
          10000,
          wakeMessage,
        );
        logger.info('Backend-initiated message: frontend handler ready (provider existed)', {
          agentId: sessionId,
          wakeMessageIncluded: true,
        });
      } catch (error) {
        // Non-fatal: Continue delivery even if the frontend isn't ready.
        // The agent:stream-starting safety net will register stream handlers when streaming
        // begins, so the frontend will catch up if it's running but wasn't ready in time.
        //
        // Previously this returned { success: false } which prevented subscription wake-up
        // delivery when the coordinator's chat panel wasn't visible (no UI to respond to
        // the agent:prepare-handler handshake). The actual streaming and persistence work
        // happens entirely in the main process and doesn't require frontend cooperation.
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn(
          'Backend-initiated message: frontend handshake failed (non-fatal), continuing without UI',
          {
            agentId: sessionId,
            workspaceId,
            error: errorMessage,
          },
        );
      }

      // Send the message, skipping user message creation since we already sent it to frontend
      // Use the same message ID for consistency between frontend and backend
      // CRITICAL: Pass agentName so handleSendMessage doesn't fall back to 'Agent'
      return await this.handleBackendStreamMessage(null as any, {
        agentId: sessionId,
        sessionId,
        streamId: sessionId,
        content: message,
        workspaceId,
        skipUserMessage: true,
        queuedMessageId: wakeMessageId,
        agentName,
        messages: existingSession?.messages ? [...existingSession.messages] : [], // Pass in-memory messages (includes wake message) so handleSendMessage uses them instead of reloading from disk
        ...otherParams,
      });
    }

    // Fallback: send the message using the regular path (shouldn't normally reach here)
    return await this.handleBackendStreamMessage(null as any, {
      agentId: sessionId,
      sessionId,
      streamId: sessionId,
      content: message,
      workspaceId,
      ...otherParams,
    });
    } finally {
      // Safety net: finalizeStream should have already cleared pendingBackendDeliveries
      // before emitAgentIdleEvent fires. If it's still set here, it means finalizeStream
      // didn't run (e.g., early return, exception before streaming started). Clean up to
      // prevent the agent from becoming permanently unreachable.
      if (this.pendingBackendDeliveries.has(sessionId)) {
        logger.info('Backend-initiated message finally: clearing pendingBackendDeliveries (safety net)', {
          agentId: sessionId,
        });
        this.pendingBackendDeliveries.delete(sessionId);
      }
      const timeout = this.pendingBackendDeliveryTimeouts.get(sessionId);
      if (timeout) {
        clearTimeout(timeout);
        this.pendingBackendDeliveryTimeouts.delete(sessionId);
      }
    }
  }

  /**
   * Set the agent's model by restarting the auggie process with the new model.
   *
   * IMPORTANT: Auggie's session/set_model ACP call returns success but doesn't actually
   * change the model for an existing session. The model is only set via the --model flag
   * when spawning the auggie process. Therefore, we must restart the auggie process
   * with the new model to actually change it.
   */
  public async handleSetModel(
    _event: any,
    params: { agentId: string; modelId: string; workspaceId: string },
  ): Promise<{ success: boolean; modelId?: string; error?: string }> {
    const { agentId, modelId, workspaceId } = params;
    logger.info('Setting agent model', { agentId, modelId, workspaceId });

    // Parse compound model ID to determine provider (e.g., "opencode:anthropic/claude-sonnet-4" -> opencode)
    const { providerId, modelId: rawModelId } = parseCompoundModelId(modelId);
    const providerConfig = getProviderConfig(providerId);

    try {
      // Determine the agent's current provider before making any changes.
      // Provider changes are allowed only before the agent has handled any real prompt.
      const backend = this.unifiedBackend;
      const agent = backend ? await backend.getAgent(agentId) : undefined;
      const runtimeProvider = this.providers.get(agentId);
      const currentModel = (runtimeProvider as any)?.config?.model as string | undefined;
      const { UnifiedPersistence } = await import('./agent-persistence');
      const persistence = UnifiedPersistence.getInstance();
      const persistedAgentResult =
        agent || !workspaceId
          ? undefined
          : await persistence.loadAgent(agentId as any, workspaceId as any);
      const persistedAgent = agent || persistedAgentResult?.data;

      const agentProvider =
        persistedAgent?.provider ??
        persistedAgent?.metadata?.provider ??
        (persistedAgent?.model ? parseCompoundModelId(persistedAgent.model).providerId : undefined) ??
        (currentModel ? parseCompoundModelId(currentModel).providerId : undefined) ??
        ((runtimeProvider as any)?.config?._providerConfig?.id as string | undefined);

      // A blank agent may already have backend/runtime state before the first prompt.
      // Provider changes should lock only after a real user message exists.
      const hasRealSessionUse =
        persistedAgent?.messages?.some((message: any) => message?.role === 'user') ?? false;

      // Existing agents may switch provider only before their first real prompt.
      if (agentProvider && agentProvider !== providerId && hasRealSessionUse) {
        logger.warn('Rejected cross-provider model change after first use', {
          agentId,
          fromProvider: agentProvider,
          toProvider: providerId,
        });
        return {
          success: false,
          error: `Cannot change provider after an agent has handled its first prompt. This agent already uses ${agentProvider}. Create a new agent to use ${providerConfig?.displayName || providerId}.`,
        };
      }

      // Persist the model/provider mutation before touching any live runtime.
      if (backend) {
        if (agent) {
          const timestamp = new Date().toISOString();
          agent.model = modelId;
          agent.provider = providerId;
          agent.updatedAt = timestamp;
          agent.metadata = {
            ...(agent.metadata || {}),
            provider: providerId,
          };
          await backend.saveAgent(agentId);
          logger.debug('Updated in-memory agent model/provider', { agentId, modelId, providerId });
        } else if (persistedAgentResult?.success && persistedAgentResult.data) {
          const updatedData = {
            ...persistedAgentResult.data,
            model: modelId,
            provider: providerId,
            updatedAt: new Date().toISOString(),
            metadata: {
              ...(persistedAgentResult.data.metadata || {}),
              provider: providerId,
            },
          };
          await persistence.saveAgent(updatedData);
          logger.info('Persisted model/provider change to agent', {
            agentId,
            modelId,
            providerId,
            workspaceId,
          });
        }
      }

      // Get the ACP provider from our providers map
      const provider = runtimeProvider;
      if (!provider) {
        logger.debug('Provider not found - model saved for later', {
          agentId,
        });
        // Still return success - model is persisted and will be used when provider is created
        return { success: true, modelId };
      }

      // Check if the model is actually different from the current one
      if (currentModel === modelId) {
        logger.debug('Model unchanged, no restart needed', { agentId, modelId });
        return { success: true, modelId };
      }

      // Update the provider's config with the new model
      if ((provider as any).config) {
        (provider as any).config.model = modelId;
        // Update provider-specific environment (e.g., OPENCODE_CONFIG_CONTENT)
        const providerEnv = buildProviderEnv(providerId, rawModelId, providerConfig.defaultAgent);
        (provider as any).config.env = {
          ...((provider as any).config.env || {}),
          ...providerEnv,
        };
      }

      // Claude Code / OpenCode: switch the active session model via ACP, no restart required.
      // Claude Code exposes unstable_setSessionModel; OpenCode supports session/set_model.
      if (
        (providerId === 'claude-code' || providerId === 'opencode') &&
        typeof (provider as any).setModel === 'function'
      ) {
        if (!rawModelId || rawModelId === 'default') {
          logger.info(
            `${providerId} model set requested but model is default/empty; skipping ACP setModel`,
            {
              agentId,
              modelId,
              rawModelId,
            },
          );
          return { success: true, modelId };
        }

        const setResult = await (provider as any).setModel(rawModelId);
        if (setResult?.success) {
          logger.info(`${providerId} model updated via ACP without restart`, {
            agentId,
            modelId,
            rawModelId,
          });
          return { success: true, modelId };
        }

        // For Claude Code, fail immediately. For OpenCode, fall through to restart
        // since session/set_model may not be reliably supported across OpenCode versions.
        if (providerId === 'claude-code') {
          logger.warn('Failed to set Claude Code model via ACP', {
            agentId,
            modelId,
            rawModelId,
            error: setResult?.error,
          });
          return {
            success: false,
            error: setResult?.error || 'Failed to set Claude Code model',
          };
        }

        logger.info('OpenCode session/set_model failed; falling back to process restart', {
          agentId,
          modelId,
          rawModelId,
          error: setResult?.error,
        });
      }

      // Restart the agent process with the new model
      // This is necessary because session/set_model doesn't apply reliably across all providers;
      // models are typically configured via CLI args or environment at startup.
      logger.info('Restarting agent process with new model', {
        agentId,
        oldModel: currentModel,
        newModel: modelId,
        providerId,
      });

      try {
        // Stop the current provider (kills the auggie process)
        // Use forceCleanup: true since we're restarting with a new model and old streams won't be valid
        if (typeof provider.stop === 'function') {
          await provider.stop({ forceCleanup: true });
        }

        // CRITICAL: Update config.model BEFORE re-initializing.
        // Providers read config.model at session creation time for:
        // - OpenCode: session/set_model ACP call after session creation
        // - Cortex: sessionMetadata.model in session/new request
        // - Claude Code: deferred model application after sessionUpdate
        // Without this, the provider restarts with the OLD model.
        if ((provider as any).config) {
          (provider as any).config.model = modelId;
          logger.debug('Updated provider config.model for restart', { modelId });
        }

        // Update provider-specific environment variables (e.g., OPENCODE_CONFIG_CONTENT).
        // Providers like OpenCode pass model config via env vars at spawn time.
        // Without this, the restarted process inherits stale env with the old model.
        const providerEnv = buildProviderEnv(providerId, rawModelId, providerConfig.defaultAgent);
        if (Object.keys(providerEnv).length > 0 && (provider as any).config) {
          (provider as any).config.env = {
            ...((provider as any).config.env || {}),
            ...providerEnv,
          };
          logger.debug('Updated provider config.env for restart', {
            envKeys: Object.keys(providerEnv),
          });
        }

        // Update the args to include the new model when the provider uses a model flag
        if (providerConfig.modelFlag && (provider as any).config?.args) {
          const args = (provider as any).config.args as string[];
          const modelIndex = args.indexOf(providerConfig.modelFlag);
          if (modelIndex !== -1 && modelIndex + 1 < args.length) {
            // Update existing model arg
            args[modelIndex + 1] = rawModelId;
          } else {
            // Add model arg
            args.push(providerConfig.modelFlag, rawModelId);
          }
        }

        // codex-acp uses `-c model="<slug>"` instead of `--model`.
        // Keep it aligned with ProviderRegistry so restarts honor the selected model.
        if (providerId === 'codex' && (provider as any).config?.args) {
          let args = (provider as any).config.args as string[];

          const { baseModel, effort } = parseCodexReasoningEffort(rawModelId);
          if (baseModel && baseModel !== 'default') {
            args = upsertCodexConfigArgs(args, 'model', baseModel);
          }
          if (effort) {
            args = upsertCodexConfigArgs(args, 'model_reasoning_effort', effort);
          } else {
            const envEffort =
              process.env.CODEX_REASONING_EFFORT || process.env.CODEX_MODEL_REASONING_EFFORT;
            if (envEffort) {
              args = upsertCodexConfigArgs(args, 'model_reasoning_effort', envEffort);
            }
          }

          (provider as any).config.args = args;
        }

        // Re-initialize the provider (launches auggie with new model)
        if (typeof provider.initialize === 'function') {
          await provider.initialize();
        }

        // Mark the session as recreated so full history will be sent
        if (typeof (provider as any).markSessionRecreated === 'function') {
          (provider as any).markSessionRecreated();
        }

        logger.info('Agent process restarted with new model', {
          agentId,
          modelId,
          newSessionId: (provider as any).sessionId,
          providerId,
        });

        return { success: true, modelId };
      } catch (restartError) {
        logger.error('Failed to restart auggie with new model', {
          agentId,
          modelId,
          error: (restartError as Error).message,
        });
        return {
          success: false,
          error: `Failed to restart agent with new model: ${(restartError as Error).message}`,
        };
      }
    } catch (error) {
      logger.error('Failed to set agent model', {
        agentId,
        modelId,
        error: (error as Error).message,
      });
      return { success: false, error: (error as Error).message };
    }
  }

  // ========== Message Queue Management ==========

  /**
   * Add a message to the queue for an agent.
   * Messages are processed in order when the agent finishes its current response.
   */
  public async handleQueueMessage(
    _event: any,
    params: {
      agentId: string;
      content: string;
      contextItems?: any[];
      imageBlocks?: Array<{ type: 'image'; data: string; mimeType: string }>;
    },
  ): Promise<{ success: boolean; queuedMessage?: QueuedMessage; error?: string }> {
    const { agentId, content, contextItems, imageBlocks } = params;

    try {
      const queue = this.messageQueues.get(agentId) || [];
      // Use msg_ prefix for message IDs to match MessageIdSchema validation
      // The schema requires either 'msg_' prefix OR a valid UUID, but using
      // the prefix is more consistent with the rest of the codebase
      const queuedMessage: QueuedMessage = {
        id: `msg_${uuidv4()}`,
        content,
        queuedAt: new Date().toISOString(),
        contextItems,
        imageBlocks,
        position: queue.length,
      };

      queue.push(queuedMessage);
      this.messageQueues.set(agentId, queue);

      logger.info('Message queued', {
        agentId,
        messageId: queuedMessage.id,
        position: queuedMessage.position,
        hasImageBlocks: !!imageBlocks?.length,
        imageCount: imageBlocks?.length || 0,
      });

      // Notify frontend of queue update (workspace-scoped)
      this.sendToRenderer(
        'agent:queue:updated',
        { agentId, queue },
        this.getWorkspaceWindowsForAgent(agentId),
      );

      return { success: true, queuedMessage };
    } catch (error) {
      logger.error('Failed to queue message', { agentId, error });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Edit a queued message.
   */
  public async handleEditQueuedMessage(
    _event: any,
    params: { agentId: string; messageId: string; content: string },
  ): Promise<{ success: boolean; error?: string }> {
    const { agentId, messageId, content } = params;

    try {
      const queue = this.messageQueues.get(agentId);
      if (!queue) {
        return { success: false, error: 'No queue found for agent' };
      }

      const messageIndex = queue.findIndex((m) => m.id === messageId);
      if (messageIndex === -1) {
        return { success: false, error: 'Message not found in queue' };
      }

      queue[messageIndex].content = content;
      logger.info('Queued message edited', { agentId, messageId });

      // Notify frontend of queue update (workspace-scoped)
      this.sendToRenderer(
        'agent:queue:updated',
        { agentId, queue },
        this.getWorkspaceWindowsForAgent(agentId),
      );

      return { success: true };
    } catch (error) {
      logger.error('Failed to edit queued message', { agentId, messageId, error });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Remove a message from the queue.
   */
  public async handleRemoveQueuedMessage(
    _event: any,
    params: { agentId: string; messageId: string },
  ): Promise<{ success: boolean; error?: string }> {
    const { agentId, messageId } = params;

    try {
      const queue = this.messageQueues.get(agentId);
      if (!queue) {
        return { success: false, error: 'No queue found for agent' };
      }

      const messageIndex = queue.findIndex((m) => m.id === messageId);
      if (messageIndex === -1) {
        return { success: false, error: 'Message not found in queue' };
      }

      queue.splice(messageIndex, 1);

      // Update positions for remaining messages
      queue.forEach((m, i) => {
        m.position = i;
      });

      logger.info('Queued message removed', { agentId, messageId });

      // Notify frontend of queue update (workspace-scoped)
      this.sendToRenderer(
        'agent:queue:updated',
        { agentId, queue },
        this.getWorkspaceWindowsForAgent(agentId),
      );

      return { success: true };
    } catch (error) {
      logger.error('Failed to remove queued message', { agentId, messageId, error });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Get the current queue for an agent.
   */
  public async handleGetQueue(
    _event: any,
    params: { agentId: string },
  ): Promise<{ success: boolean; queue?: QueuedMessage[]; error?: string }> {
    const { agentId } = params;

    try {
      const queue = this.messageQueues.get(agentId) || [];
      const response = { success: true, queue };
      logger.info('[handleGetQueue] Returning response', {
        agentId,
        queueLength: queue.length,
        response: JSON.stringify(response),
      });
      return response;
    } catch (error) {
      logger.error('Failed to get queue', { agentId, error });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Process the next message in the queue.
   * Called automatically when a stream completes.
   */
  private async processNextQueuedMessage(agentId: string, workspaceId: string): Promise<void> {
    // Check if the agent was intentionally interrupted (e.g., user clicked "Send now" on a specific message)
    // In this case, skip automatic queue processing - the frontend will send the specific message directly.
    // NOTE: We do NOT delete the flag here. The flag is cleared in handleSendMessage when the
    // interrupt message is actually delivered. This prevents a race where another event triggers
    // processNextQueuedMessage again before the interrupt message is sent — without the flag,
    // it would proceed with normal queue processing instead of waiting.
    if (this.interruptedAgents.has(agentId)) {
      logger.info('Skipping automatic queue processing - agent was intentionally interrupted', {
        agentId,
      });
      return;
    }

    // Prevent concurrent processing
    if (this.processingQueue.has(agentId)) {
      logger.info('Already processing queue for agent, skipping', { agentId });
      return;
    }

    // GUARD: If a stream is already active for this agent, skip queue processing.
    // This handles the race where a new direct message starts streaming between
    // the onComplete callback and this setTimeout firing. The queued message will
    // be picked up by the next onComplete cycle.
    if (this.streamStartTimes.has(agentId)) {
      logger.info(
        'Stream already active for agent, deferring queue processing to next onComplete',
        {
          agentId,
          streamStartTime: this.streamStartTimes.get(agentId),
        },
      );
      return;
    }

    const queue = this.messageQueues.get(agentId);
    if (!queue || queue.length === 0) {
      logger.debug('No queued messages to process', { agentId });
      return;
    }

    // Check if the workspace is currently being viewed by any window.
    // Queue processing continues regardless — the backend persists all messages to disk,
    // so when the user returns to the workspace they'll see the completed responses.
    // We only use this flag to skip the frontend handler handshake (which would time out
    // wastefully if no window is available).
    const hasActiveWindow = !!getWindowIdForWorkspace(workspaceId);
    if (!hasActiveWindow) {
      logger.info(
        'Workspace not currently active - processing queue anyway (backend will persist results)',
        {
          agentId,
          workspaceId,
          queueLength: queue.length,
        },
      );
    }

    this.processingQueue.add(agentId);

    // Declare nextMessage outside the try block so it's accessible in the catch block
    let nextMessage: QueuedMessage | undefined;

    // CRITICAL FIX: Peek at the next message WITHOUT removing it from the queue.
    // We only remove it after handleBackendStreamMessage succeeds.
    // Previously, queue.shift() was called here, which meant the message was
    // permanently lost if the send failed or was preempted by a concurrent message.
    nextMessage = queue[0];
    if (!nextMessage) {
      this.processingQueue.delete(agentId);
      return;
    }

    try {
      // ROBUSTNESS: Check for stale messages (queued more than 1 hour ago)
      // Warn but still process - the user may still want the message sent
      const queuedAt = new Date(nextMessage.queuedAt).getTime();
      const ageMs = Date.now() - queuedAt;
      const staleThresholdMs = 60 * 60 * 1000; // 1 hour
      const isStale = ageMs > staleThresholdMs;

      if (isStale) {
        const ageMinutes = Math.round(ageMs / 60000);
        logger.warn('Processing stale queued message', {
          agentId,
          messageId: nextMessage.id,
          queuedAt: nextMessage.queuedAt,
          ageMinutes,
        });
        // Notify frontend about stale message so it can optionally show a warning (workspace-scoped)
        const wsWindows = getWindowIdsForWorkspace(workspaceId);
        this.sendToRenderer(
          'agent:queue:stale-message',
          {
            agentId,
            messageId: nextMessage.id,
            ageMinutes,
            queuedAt: nextMessage.queuedAt,
          },
          wsWindows,
        );
      }

      logger.info('Processing queued message - starting new stream turn', {
        agentId,
        messageId: nextMessage.id,
        queueLength: queue.length,
        ageMs,
        isStale,
      });

      // Notify frontend that we're processing a queued message
      // Include the message content so frontend can show the user message immediately
      // CRITICAL: Frontend uses this event to re-register the stream handler
      logger.info('Sending agent:queue:processing to frontend', {
        agentId,
        messageId: nextMessage.id,
        hasActiveWindow,
      });
      const queueTargetWindows = getWindowIdsForWorkspace(workspaceId);
      this.sendToRenderer(
        'agent:queue:processing',
        {
          agentId,
          messageId: nextMessage.id,
          content: nextMessage.content,
          contextItems: nextMessage.contextItems,
          imageBlocks: nextMessage.imageBlocks,
        },
        queueTargetWindows,
      );
      // Don't send queue:updated yet — message is still in the queue until send succeeds

      // Wait for frontend to re-register stream handler before starting new stream.
      // Skip the handshake if no window is viewing this workspace — the frontend can't
      // respond, so waiting would just burn the 5s timeout. The message will still be
      // processed and persisted; the user will see the result when they return.
      if (hasActiveWindow) {
        try {
          await this.waitForFrontendHandlerReady(agentId, 5000);
          logger.info('Frontend handler ready for queued message', {
            agentId,
            messageId: nextMessage.id,
          });
        } catch (handlerError) {
          // If frontend doesn't respond, log a warning but continue anyway
          // The message will still be processed and persisted, user can refresh to see it
          logger.warn('Frontend handler not ready for queued message, continuing anyway', {
            agentId,
            messageId: nextMessage.id,
            error: handlerError instanceof Error ? handlerError.message : String(handlerError),
          });
        }
      } else {
        logger.info('Skipping frontend handler handshake - no active window for workspace', {
          agentId,
          workspaceId,
          messageId: nextMessage.id,
        });
      }

      // GUARD: Re-check if a stream started while we were waiting for the frontend handler.
      // A concurrent handleBackendStreamMessage call from a direct user message could have
      // started a stream during the waitForFrontendHandlerReady period.
      if (this.streamStartTimes.has(agentId)) {
        logger.warn(
          'Stream started while waiting for frontend handler, aborting queue processing',
          {
            agentId,
            messageId: nextMessage.id,
            note: 'Message remains in queue and will be processed after the current stream completes',
          },
        );
        // Notify frontend to clean up the orphaned handler from agent:queue:processing
        this.sendToRenderer(
          'agent:queue:processing-cancelled',
          {
            agentId,
            messageId: nextMessage.id,
          },
          queueTargetWindows,
        );
        return;
      }

      // EARLY UI UPDATE: Actually remove the message from the internal queue NOW.
      // This fixes the race condition where the message stays visible in the UI during
      // streaming because the queue:updated event was only sending a filtered copy.
      // By removing the message from the source-of-truth queue immediately, the UI
      // stays in sync. If send fails, we re-add the message in the catch block.
      queue.shift(); // Remove nextMessage from the internal queue
      queue.forEach((m, i) => {
        m.position = i;
      });
      this.sendToRenderer('agent:queue:updated', { agentId, queue }, queueTargetWindows);
      logger.info('Removed message from internal queue and sent queue:updated to frontend', {
        agentId,
        messageId: nextMessage.id,
        remainingInQueue: queue.length,
      });

      // Send the message using the existing handler
      // Pass the queue message ID so the backend uses the same ID as the frontend
      await this.handleBackendStreamMessage(null as any, {
        agentId,
        sessionId: agentId,
        streamId: agentId,
        content: nextMessage.content,
        workspaceId,
        contextReferences: nextMessage.contextItems,
        imageBlocks: nextMessage.imageBlocks,
        queuedMessageId: nextMessage.id,
      });

      // SUCCESS: Message was already removed from the queue above.
      // Just log success — no additional removal needed.
      logger.info('Queued message sent successfully', {
        agentId,
        messageId: nextMessage.id,
        remainingInQueue: queue.length,
      });
    } catch (error) {
      // FIX: Re-add the message to the front of the queue so it can be retried.
      // The message was removed above before attempting to send, so we must restore it.
      const currentQueue = this.messageQueues.get(agentId);
      if (currentQueue) {
        // Re-add to front of queue for retry on next onComplete cycle
        currentQueue.unshift(nextMessage);
        currentQueue.forEach((m, i) => {
          m.position = i;
        });
        // Emit queue:updated so the UI shows the message back in the queue
        const wsWindows = getWindowIdsForWorkspace(workspaceId);
        this.sendToRenderer('agent:queue:updated', { agentId, queue: currentQueue }, wsWindows);
        logger.info('Re-added message to queue after send failure', {
          agentId,
          messageId: nextMessage.id,
          queueLength: currentQueue.length,
        });
      }

      // SAFETY: Clean up streamStartTimes if it was set during the failed
      // handleBackendStreamMessage call. If left stale, the streamStartTimes guard
      // at the top of this function would permanently block queue processing.
      if (this.streamStartTimes.has(agentId) && !this.providers.has(agentId)) {
        logger.warn('Cleaning up stale streamStartTimes after failed queue send', { agentId });
        this.cleanupStreamResources(agentId);
      }
      logger.error('Failed to process queued message (message re-added to queue for retry)', {
        agentId,
        error,
        queueLength: this.messageQueues.get(agentId)?.length ?? 0,
      });
    } finally {
      this.processingQueue.delete(agentId);
    }
  }

  /**
   * Emit agent:idle event for agent-to-agent coordination.
   * This is called when an agent finishes streaming a response.
   * @param finalMessage - The final assistant message from this turn (used for lastResponseSummary)
   * @param finishReason - The finish reason from the LLM (e.g., 'end_turn', 'cancelled', 'error')
   */
  private emitAgentIdleEvent(
    agentId: string,
    workspaceId: string,
    agentName: string,
    finalMessage?: AgentMessage,
    finishReason?: string,
  ): void {
    // CRITICAL: Do NOT emit agent:idle when the agent was interrupted and is about to
    // resume processing. This prevents premature wake-ups of parent agents.
    // When an agent is interrupted, it will immediately receive the interrupt message
    // and start streaming again. The parent should not be woken until the child is
    // truly done (i.e., completes a turn without being interrupted).
    if (this.interruptedAgents.has(agentId)) {
      logger.info('Suppressing agent:idle event — agent was interrupted and will resume', {
        agentId,
        workspaceId,
        finishReason,
      });
      return;
    }

    // Use a single coordinated async chain instead of three separate
    // fire-and-forget import().then() chains. Previously each operation
    // ran independently, which meant:
    // 1. If the event emission chain failed, the parent was never notified
    // 2. setAgentStatus and event emission had no guaranteed ordering
    // 3. Errors in one chain couldn't influence others
    this._emitAgentIdleEventAsync(
      agentId,
      workspaceId,
      agentName,
      finalMessage,
      finishReason,
    ).catch((err) => {
      logger.warn('Failed in emitAgentIdleEvent async chain', { agentId, error: err });
    });
  }

  private async _emitAgentIdleEventAsync(
    agentId: string,
    workspaceId: string,
    agentName: string,
    finalMessage?: AgentMessage,
    finishReason?: string,
  ): Promise<void> {
    // Step 1: Clear delegation group (non-critical, don't block on failure)
    try {
      const { DelegateTaskTool } = await import('../../mcp/main/mcp/agent-interaction-tools');
      DelegateTaskTool.clearDelegationGroup(workspaceId, agentId);
    } catch {
      // Ignore - tool may not be loaded
    }

    // Step 2: Set agent status to idle BEFORE emitting the event.
    // This ensures queued events for this agent are delivered first,
    // and the agent's status is correct when event handlers run.
    try {
      const { updateAgentStatus } =
        await import('../../events/main/agent-subscription-ops');
      updateAgentStatus(workspaceId, agentId, 'idle');
    } catch (err) {
      logger.warn('Failed to update agent subscription status', { agentId, error: err });
    }

    // Step 3: Build event data and emit the agent:idle event
    try {
      const { mainDispatch } = await import('../../../store/main/redux-store-bridge');
      const { emitWorkspaceEvent: reduxEmitWorkspaceEvent } = await import('../../../store/main/slices/workspace-events/workspace-events-slice');
      // Fetch agent's last response summary for delegation notifications
      let lastResponseSummary: string | undefined;
      let messageCount: number | undefined;
      let taskNoteId: string | undefined;
      let taskTitle: string | undefined;
      let specialist: string | undefined;
      let isBackground: boolean | undefined;
      let completionReport: string | undefined;
      let parentAgentId: string | undefined;

      // First, extract summary from the passed finalMessage (most reliable source)
      if (finalMessage && finalMessage.contentBlocks && finalMessage.contentBlocks.length > 0) {
        const textContent = finalMessage.contentBlocks
          .filter((block: ContentBlock) => block.type === 'text')
          .map((block: ContentBlock) => (block as any).text || (block as any).content || '')
          .join(' ');

        logger.debug('emitAgentIdleEvent: Extracting lastResponseSummary from finalMessage', {
          agentId,
          blockCount: finalMessage.contentBlocks.length,
          textBlockCount: finalMessage.contentBlocks.filter((b: ContentBlock) => b.type === 'text')
            .length,
          textContentLength: textContent.length,
          textContentPreview: textContent.substring(0, 100),
        });

        // Use the LAST portion of the text for the summary - it's more likely to be
        // a meaningful completion/summary than the beginning ("I'll start by reading...")
        if (textContent.length > 500) {
          lastResponseSummary = `...${textContent.substring(textContent.length - 500)}`;
        } else if (textContent.length > 0) {
          lastResponseSummary = textContent;
        }
      } else {
        logger.debug('emitAgentIdleEvent: No finalMessage or empty contentBlocks', {
          agentId,
          hasFinalMessage: !!finalMessage,
          hasContentBlocks: !!finalMessage?.contentBlocks,
          contentBlocksLength: finalMessage?.contentBlocks?.length ?? 0,
        });
      }

      try {
        const loadResult = await agentPersistence.loadAgent(
          agentId as AgentId,
          workspaceId as WorkspaceId,
        );
        if (loadResult.success && loadResult.data) {
          const agent = loadResult.data;
          messageCount = agent.messages?.length;
          taskNoteId = agent.metadata?.taskNoteId as string | undefined;
          isBackground = agent.isBackground === true;

          // Get specialist type from agent metadata
          specialist = agent.metadata?.specialist as string | undefined;

          // Get completion report if set via report_to_parent tool
          completionReport = agent.metadata?.completionReport as string | undefined;

          logger.debug('emitAgentIdleEvent: Loaded from persistence', {
            agentId,
            hasCompletionReport: !!completionReport,
            completionReportPreview: completionReport?.substring(0, 100),
            messageCount,
            taskNoteId,
            specialist,
            metadataKeys: Object.keys(agent.metadata || {}),
          });

          // Get parent agent ID if this is a delegated agent
          parentAgentId = agent.metadata?.createdByAgentId as string | undefined;

          // Get task title if agent has a task note
          if (taskNoteId) {
            try {
              const { notesService } = await import('../../notes/main/notes.service');
              const noteResult = await notesService.getNote(
                workspaceId as WorkspaceId,
                taskNoteId as any,
              );
              if (noteResult.ok && noteResult.data) {
                taskTitle = noteResult.data.title;
              }
            } catch (noteErr) {
              logger.debug('Could not fetch task note title', { taskNoteId, error: noteErr });
            }
          }

          // Only extract from persisted messages if we don't already have a summary from finalMessage
          if (!lastResponseSummary && agent.messages && agent.messages.length > 0) {
            for (let i = agent.messages.length - 1; i >= 0; i--) {
              const msg = agent.messages[i];
              if (msg.role === 'assistant') {
                // Extract text from contentBlocks - handle both text and content fields
                let textContent = '';
                if (msg.contentBlocks && Array.isArray(msg.contentBlocks)) {
                  textContent = msg.contentBlocks
                    .filter((block: ContentBlock) => block.type === 'text')
                    .map(
                      (block: ContentBlock) => (block as any).text || (block as any).content || '',
                    )
                    .join(' ');
                }
                // Truncate to first 500 chars for summary
                if (textContent.length > 500) {
                  lastResponseSummary = `${textContent.substring(0, 500)}...`;
                } else if (textContent.length > 0) {
                  lastResponseSummary = textContent;
                }
                break;
              }
            }
          }
        }
      } catch (err) {
        logger.debug('Could not fetch agent summary for idle event', { agentId, error: err });
      }

      // Emit the agent:idle event with summary data via Redux
      mainDispatch(reduxEmitWorkspaceEvent({
        id: `agent-idle-${agentId}-${uuidv4()}`,
        type: 'agent:idle',
        timestamp: new Date().toISOString(),
        workspaceId,
        actor: {
          type: 'agent',
          id: agentId,
          name: agentName,
        },
        data: {
          agentId,
          agentName,
          reason: 'stream_complete',
          finishReason,
          messageCount,
          lastResponseSummary,
          taskNoteId,
          taskTitle,
          specialist,
          isBackground,
          completionReport,
          parentAgentId,
        },
      }));

      logger.info('Emitted agent:idle event via Redux', {
        agentId,
        workspaceId,
        finishReason,
        hasSummary: !!lastResponseSummary,
        hasCompletionReport: !!completionReport,
        specialist,
        taskTitle,
        parentAgentId,
      });

      // Update workspace lastActivity so the workspace list shows fresh timestamps.
      // Emit directly to avoid the heavy getWorkspace() read in updateWorkspace().
      // This updates the renderer's local store; the value is not persisted to disk
      // but updatedAt serves as a reasonable fallback after restart.
      try {
        const { mainDispatch } = await import('../../../store/main/redux-store-bridge');
        const { workspaceUpdated } = await import('../../../store/main/slices/workspace-lifecycle-events/workspace-lifecycle-events-slice');
        mainDispatch(workspaceUpdated({
          workspaceId: workspaceId as WorkspaceId,
          changes: { lastActivity: new Date().toISOString() },
        }));
      } catch (updateErr) {
        logger.debug('Failed to emit workspace lastActivity update', {
          workspaceId,
          error: updateErr,
        });
      }
    } catch (err) {
      logger.warn('Failed to emit agent:idle event', { agentId, error: err });
    }
  }

  /**
   * Emit agent:created event for activity log.
   * This is called when a new agent is created.
   */
  private emitAgentCreatedEvent(
    agentId: string,
    workspaceId: string,
    agentName: string,
    model?: string,
  ): void {
    try {
      // Emit through Redux (which handles persistence and broadcast via sagas)
      import('../../../store/main/redux-store-bridge')
        .then(({ mainDispatch }) => {
          import('../../../store/main/slices/workspace-events/workspace-events-slice')
            .then(({ emitWorkspaceEvent: reduxEmit }) => {
              mainDispatch(reduxEmit({
                id: `agent-created-${agentId}-${uuidv4()}`,
                type: 'agent:created',
                timestamp: new Date().toISOString(),
                workspaceId,
                actor: {
                  type: 'user',
                  name: 'User',
                },
                data: {
                  agentId,
                  agentName,
                  model,
                },
              }));
              logger.debug('Emitted agent:created event via Redux', {
                agentId,
                workspaceId,
                agentName,
              });
            });

          // Update workspace lastActivity so the workspace list shows fresh timestamps.
          // Emit directly to avoid the heavy getWorkspace() in updateWorkspace().
          import('../../../store/main/slices/workspace-lifecycle-events/workspace-lifecycle-events-slice')
            .then(({ workspaceUpdated }) => {
              mainDispatch(workspaceUpdated({
                workspaceId: workspaceId as WorkspaceId,
                changes: { lastActivity: new Date().toISOString() },
              }));
            })
            .catch((updateErr) => {
              logger.debug('Failed to emit workspace lastActivity update on agent create', {
                workspaceId,
                error: updateErr,
              });
            });
        })
        .catch((err) => {
          logger.warn('Failed to emit agent:created event', { agentId, error: err });
        });
    } catch (error) {
      logger.warn('Error emitting agent:created event', { agentId, error });
    }
  }

  /**
   * Emit agent:deleted event to notify delegation subscriptions.
   * Uses a coordinated async chain like _emitAgentIdleEventAsync and
   * _emitAgentFailedEventAsync to avoid fire-and-forget import().then() patterns.
   */
  private emitAgentDeletedEvent(
    agentId: string,
    workspaceId: string,
    agentName: string,
    taskNoteId?: string,
    isBackground?: boolean,
    parentAgentId?: string,
  ): void {
    this._emitAgentDeletedEventAsync(agentId, workspaceId, agentName, taskNoteId, isBackground, parentAgentId).catch((err) => {
      logger.warn('Failed in emitAgentDeletedEvent async chain', { agentId, error: err });
    });
  }

  private async _emitAgentDeletedEventAsync(
    agentId: string,
    workspaceId: string,
    agentName: string,
    taskNoteId?: string,
    isBackground?: boolean,
    parentAgentId?: string,
  ): Promise<void> {
    // Step 1: Clear delegation group (non-critical, don't block on failure)
    // Without this, if an agent is deleted without going idle first,
    // the DelegateTaskTool static Map leaks the workspaceId:agentId entry.
    try {
      const { DelegateTaskTool } = await import('../../mcp/main/mcp/agent-interaction-tools');
      DelegateTaskTool.clearDelegationGroup(workspaceId, agentId);
    } catch {
      // Ignore - tool may not be loaded
    }

    // Step 2: Emit the agent:deleted event
    // NOTE: isBackground and parentAgentId are pre-captured by the caller (handleDeleteAgent)
    // BEFORE persistence deletion, since the agent file is already gone by the time this runs.
    try {
      const { mainDispatch } = await import('../../../store/main/redux-store-bridge');
      const { emitWorkspaceEvent: reduxEmitWorkspaceEvent } = await import('../../../store/main/slices/workspace-events/workspace-events-slice');
      mainDispatch(reduxEmitWorkspaceEvent({
        id: `agent-deleted-${agentId}-${uuidv4()}`,
        type: 'agent:deleted',
        timestamp: new Date().toISOString(),
        workspaceId,
        actor: {
          // CRITICAL: Use the deleted agent as the actor so that
          // subscription filters with actorIds: [agentId] will match.
          type: 'agent',
          id: agentId,
          name: agentName,
        },
        data: {
          agentId,
          agentName,
          taskNoteId,
          reason: 'user_action',
          isBackground,
          parentAgentId,
        },
      }));
      logger.info('Emitted agent:deleted event via Redux', {
        agentId,
        workspaceId,
        agentName,
        isBackground,
        parentAgentId,
      });
    } catch (err) {
      logger.warn('Failed to emit agent:deleted event', { agentId, error: err });
    }
  }

  /**
   * Emit agent:started event for activity log.
   * This is called when an agent starts responding to a message.
   */
  private emitAgentStartedEvent(
    agentId: string,
    workspaceId: string,
    agentName: string,
    model?: string,
  ): void {
    try {
      // Emit through Redux (which handles persistence and broadcast via sagas)
      import('../../../store/main/redux-store-bridge')
        .then(({ mainDispatch }) => {
          import('../../../store/main/slices/workspace-events/workspace-events-slice')
            .then(({ emitWorkspaceEvent: reduxEmit }) => {
              mainDispatch(reduxEmit({
                id: `agent-started-${agentId}-${uuidv4()}`,
                type: 'agent:started',
                timestamp: new Date().toISOString(),
                workspaceId,
                actor: {
                  type: 'agent',
                  id: agentId,
                  name: agentName,
                },
                data: {
                  agentId,
                  agentName,
                  model,
                  reason: 'message_received',
                },
              }));
              logger.debug('Emitted agent:started event via Redux', {
                agentId,
                workspaceId,
                agentName,
              });
            });
        })
        .catch((err) => {
          logger.warn('Failed to emit agent:started event', { agentId, error: err });
        });
    } catch (error) {
      logger.warn('Error emitting agent:started event', { agentId, error });
    }
  }

  /**
   * Emit agent:failed event for activity log and delegation subscriptions.
   * Uses a coordinated async chain like _emitAgentIdleEventAsync to ensure
   * setAgentStatus('failed') happens BEFORE the event is emitted, guaranteeing
   * correct ordering for subscription delivery.
   */
  private emitAgentFailedEvent(
    agentId: string,
    workspaceId: string,
    agentName: string,
    error: string,
  ): void {
    this._emitAgentFailedEventAsync(agentId, workspaceId, agentName, error).catch((err) => {
      logger.warn('Failed in emitAgentFailedEvent async chain', { agentId, error: err });
    });
  }

  private async _emitAgentFailedEventAsync(
    agentId: string,
    workspaceId: string,
    agentName: string,
    error: string,
  ): Promise<void> {
    // Step 0: Clear delegation group (non-critical, don't block on failure)
    // Without this, if an agent fails without going idle first,
    // the DelegateTaskTool static Map leaks the workspaceId:agentId entry.
    try {
      const { DelegateTaskTool } = await import('../../mcp/main/mcp/agent-interaction-tools');
      DelegateTaskTool.clearDelegationGroup(workspaceId, agentId);
    } catch {
      // Ignore - tool may not be loaded
    }

    // Step 1: Set agent status to failed BEFORE emitting the event.
    // This ensures correct ordering for subscription delivery.
    try {
      const { updateAgentStatus } =
        await import('../../events/main/agent-subscription-ops');
      updateAgentStatus(workspaceId, agentId, 'failed');
    } catch (err) {
      logger.warn('Failed to set agent status to failed', { agentId, error: err });
    }

    // Step 2: Load agent metadata for event enrichment (isBackground, parentAgentId)
    let isBackground: boolean | undefined;
    let parentAgentId: string | undefined;
    try {
      const loadResult = await agentPersistence.loadAgent(
        agentId as AgentId,
        workspaceId as WorkspaceId,
      );
      if (loadResult.success && loadResult.data) {
        isBackground = loadResult.data.isBackground === true;
        parentAgentId = loadResult.data.metadata?.createdByAgentId as string | undefined;
      }
    } catch (err) {
      logger.debug('Could not load agent metadata for failed event', { agentId, error: err });
    }

    // Step 3: Emit the agent:failed event
    try {
      const { mainDispatch } = await import('../../../store/main/redux-store-bridge');
      const { emitWorkspaceEvent: reduxEmitWorkspaceEvent } = await import('../../../store/main/slices/workspace-events/workspace-events-slice');
      mainDispatch(reduxEmitWorkspaceEvent({
        id: `agent-failed-${agentId}-${uuidv4()}`,
        type: 'agent:failed',
        timestamp: new Date().toISOString(),
        workspaceId,
        actor: {
          type: 'agent',
          id: agentId,
          name: agentName,
        },
        data: {
          agentId,
          agentName,
          error,
          isBackground,
          parentAgentId,
        },
      }));
      logger.debug('Emitted agent:failed event via Redux', {
        agentId,
        workspaceId,
        agentName,
        error,
        isBackground,
        parentAgentId,
      });
    } catch (err) {
      logger.warn('Failed to emit agent:failed event', { agentId, error: err });
    }
  }

  /**
   * Cleanup method to be called on shutdown
   */
  public cleanup(): void {
    logger.info('Cleaning up AgentBackendHandler');
    this.cleanupAllListeners();

    // Clear message queues and processing state
    this.messageQueues.clear();
    this.processingQueue.clear();
    this.interruptedAgents.clear();

    // Clear stream tracking maps
    this.streamStartTimes.clear();
    this.streamSessionIds.clear();
    this.streamWorkspaceIds.clear();
    this.streamWindowIds.clear();
    this.streamGenerations.clear();

    // Clear IPC heartbeat tracking
    this.lastPongTimes.clear();
    this.lastPingSentTimes.clear();

    // Clear health checks
    for (const healthCheck of this.streamHealthChecks.values()) {
      clearInterval(healthCheck);
    }
    this.streamHealthChecks.clear();

    // Clear auto-continue retry tracking
    this.emptyResponseRetries.clear();

    // Clear completion and handler tracking
    this.completedStreams.clear();
    this.pendingHandlerReady.clear();

    // Clear session tracking
    this.activeSessions.clear();

    // Clean up providers
    for (const [agentId, provider] of this.providers) {
      if (provider && typeof provider.cleanup === 'function') {
        try {
          provider.cleanup();
        } catch (error) {
          logger.warn('Error cleaning up provider during shutdown', { agentId, error });
        }
      }
    }
    this.providers.clear();

    // Stop provider cleanup interval
    if (this.providerCleanupInterval) {
      clearInterval(this.providerCleanupInterval);
      this.providerCleanupInterval = null;
    }
    this.providerLastUsed.clear();

    // Clear any other resources
    if (this.unifiedBackend) {
      // If backend has cleanup method, call it
      if (typeof this.unifiedBackend.cleanup === 'function') {
        this.unifiedBackend.cleanup();
      }
      this.unifiedBackend = null;
    }
  }
}

// Export singleton instance
export const agentBackendHandler = AgentBackendHandler.getInstance();
