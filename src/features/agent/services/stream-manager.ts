/**
 * Direct Stream Manager
 *
 * Simplified streaming service with immediate character-by-character streaming.
 * No batching, no buffering, no delays - per user preference.
 *
 * Features:
 * - Direct pass-through streaming
 * - Session management with ID mapping
 * - Automatic memory cleanup
 * - Stream health monitoring
 * - No delays or throttling
 */

import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from '../../../lib/utils/browser-event-emitter';
import { unifiedIdService } from '$shared/services/unified-id.service';
import { Logger } from '../../../shared/logger';
import type { AgentMessage,
  ContentBlock,
  Workspace } from '../../../shared/types';
import { WorkspaceStatus } from '../../../shared/types';
import {
  createMessageId,
  WorkspaceId,
} from '../../../shared/types/branded-ids';
import { createAppMessageId } from '$shared/utils/app-message-id';
import { memoryManager } from './memory-manager';
import type { IDisposable } from '$shared/types/disposable';
import { AuggieTextParser } from '$lib/utils/auggie-text-parser';
import { newAssistantMessage } from '$store/renderer/slices/unread-tracking/unread-tracking-slice';
import { removeWorkspaceAgentState } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import {
  addMessage as addAgentSessionMessage,
  setAgentStreaming,
  updateAgentDigest,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import {
  setWorkspaceEntity,
  removeWorkspaceEntity,
} from '$store/renderer/slices/workspace/workspace-slice';
import { AGENT_STREAMING_CONFIG } from '$shared/constants/agent-streaming';
import { getRendererStore } from '$store/renderer/renderer-store-bridge';

/** Shorthand – keeps call-site diffs minimal after bridge migration. */
const appStore = {
  get state() { return getRendererStore().state; },
  dispatch(action: { type: string;[k: string]: any }) { return getRendererStore().dispatch(action); },
};

// ---------------------------------------------------------------------------
// Inline selector helpers.
//
// The canonical selector modules (`workspace-selectors`, `agent-session-selectors`)
// statically import the configured Store which chains to `ag-redux-toolkit/svelte-store`
// → `svelte`. Since stream-manager.ts is transitively loaded by the main process
// (where svelte is absent in packaged builds), we cannot import those modules.
// The logic below mirrors the selectors without the Store dependency.
// ---------------------------------------------------------------------------

/** Mirrors selectWorkspaceById.select(state, wsId) */
function lookupWorkspaceById(state: any, wsId: string): Workspace | undefined {
  return state.workspace?.workspaces?.map?.[wsId];
}

/** Mirrors selectAgentSession.select(state, agentId) */
function lookupAgentSession(state: any, agentId?: string) {
  if (!agentId) return undefined;
  return state.agentSessions?.byAgentId[agentId] as
    | { messages?: AgentMessage[]; isBackground?: boolean; metadata?: { isBackground?: boolean } }
    | undefined;
}

const logger = new Logger('DirectStreamManager');

// Configuration constants - no batching or delays
// Uses shared constants where appropriate for consistency
// PERF: Reduced limits to prevent GC pressure and main thread freezes
const STREAM_CONFIG = {
  // Timing - only for cleanup, not for streaming
  CLEANUP_INTERVAL: AGENT_STREAMING_CONFIG.COMPLETION_DETECTION_MS, // Use shared constant (5 minutes)
  SESSION_TIMEOUT: AGENT_STREAMING_CONFIG.BACKEND_STREAM_TIMEOUT_MS, // Use shared constant (30 minutes)
  RECOVERY_TIMEOUT: 5000, // 5 seconds - quick recovery attempts
  STALLED_TIMEOUT: 30000, // 30 seconds - health status updates (was 10 seconds, too aggressive)
  TIMEOUT: 10000, // 10 seconds - stalled stream cleanup threshold (was 1.5s, too aggressive during GC pauses)

  // Limits - PERF: Reduced from 1000/500 to prevent memory pressure
  MAX_SESSIONS: 10,
  MAX_CHUNK_SIZE: 256 * 1024, // 256KB (was 1MB) - reduce chunk size limit
  MAX_CHUNKS_BEFORE_PRUNE: 200, // Start pruning at 200 chunks (was 1000)
  MAX_CHUNKS_AFTER_PRUNE: 50, // Keep only 50 chunks after pruning (was 500)
  MAX_SESSION_BYTES: 10 * 1024 * 1024, // 10MB max per session

  // Health monitoring
  HEALTH_CHECK_INTERVAL: 30000, // 30 seconds (was 10 seconds, too aggressive)
  MEMORY_LEAK_THRESHOLD: 20 * 1024 * 1024, // 20MB (was 50MB) - trigger earlier
};

export interface StreamConfig {
  agentId: string;
  sessionId: string;
  workspaceId: WorkspaceId;
  messageId?: string;
  assistantAppMessageId?: string;
  frontendSessionId?: string;
  backendSessionId?: string;
  onComplete?: () => void;
}

export interface StreamChunk {
  type: 'text' | 'content_block' | 'tool_call' | 'error' | 'complete';
  data: any;
  timestamp: number;
  sequence?: number;
}

export interface StreamSession {
  streamId: string;
  config: StreamConfig;
  startTime: number;
  lastActivity: number;
  chunks: StreamChunk[];
  accumulatedText: string;
  contentBlocks: ContentBlock[];
  isComplete: boolean;
  error?: Error;

  // Session management
  listeners: Set<() => void>;
  timers: Set<NodeJS.Timeout>;
  isActive: boolean;
  chunksReceived: number;
  bytesReceived: number;

  // Direct streaming - no batching
  sequenceNumber: number;
  expectedSequence: number;

  // Health monitoring
  lastHealthCheck: number;
  healthStatus: 'healthy' | 'degraded' | 'stalled' | 'error' | 'recovering';
  recoveryAttempts: number;

  // Cleanup management
  markedForCleanup?: boolean;
}

export interface StreamResult {
  success: boolean;
  message?: AgentMessage;
  text?: string;
  contentBlocks?: ContentBlock[];
  error?: string;
  duration?: number;
  chunkCount?: number;
  bytesReceived?: number;
  healthStatus?: string;
}

export interface StreamCallbacks {
  onChunk?: (chunk: string) => void;
  onContentBlocks?: (blocks: ContentBlock[]) => void;
  onComplete?: (message: any) => void;
  onError?: (error: Error) => void;
}

export interface StreamMetrics {
  activeStreams: number;
  totalStreams: number;
  totalChunks: number;
  totalBytes: number;
  averageResponseTime: number;
  memoryUsage: number;
  errors: number;
  recoveries: number;
}

// BatchProcessor removed - direct streaming only, no batching or buffering

/**
 * Unified streaming manager with all consolidated features
 *
 * ARCHITECTURE NOTE: Uses agentId as the canonical key for all sessions.
 * Since only ONE stream per agent is allowed at a time (enforced by cleanupSessionByAgentId
 * at the start of startStream), we use agentId directly as the session key.
 * This eliminates the need for complex ID mapping between streamId, sessionId,
 * frontendSessionId, and backendSessionId.
 */
const STREAM_MANAGER_HMR_KEY = '__streamManager_hmr';

export class StreamManager extends EventEmitter implements IDisposable {
  private static instance: StreamManager;
  // Sessions keyed by agentId - only one stream per agent at a time
  private sessions = new Map<string, StreamSession>();
  // Callbacks keyed by agentId
  private callbacks = new Map<string, StreamCallbacks>();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private disposed = false;
  private metrics: StreamMetrics = {
    activeStreams: 0,
    totalStreams: 0,
    totalChunks: 0,
    totalBytes: 0,
    averageResponseTime: 0,
    memoryUsage: 0,
    errors: 0,
    recoveries: 0,
  };

  private constructor() {
    super();
    this.startCleanupInterval();
    this.startHealthMonitoring();
    this.loadFromSessionStorage();
  }

  static getInstance(): StreamManager {
    // Survive HMR: reuse instance stored on window if available
    if (typeof window !== 'undefined' && (window as any)[STREAM_MANAGER_HMR_KEY]) {
      const cached = (window as any)[STREAM_MANAGER_HMR_KEY] as StreamManager;
      // Guard against returning a disposed instance — create a fresh one instead
      if (!cached.disposed) {
        StreamManager.instance = cached;
        return StreamManager.instance;
      }
      // Disposed instance found; discard it and fall through to create a new one
      delete (window as any)[STREAM_MANAGER_HMR_KEY];
    }
    if (!StreamManager.instance || StreamManager.instance.disposed) {
      StreamManager.instance = new StreamManager();
      if (typeof window !== 'undefined') {
        (window as any)[STREAM_MANAGER_HMR_KEY] = StreamManager.instance;
      }
    }
    return StreamManager.instance;
  }

  /**
   * Start a new streaming session with direct streaming
   *
   * Uses agentId as the canonical key. Only one stream per agent is allowed.
   * Returns the agentId (which serves as the stream identifier).
   */
  startStream(config: StreamConfig, callbacks?: StreamCallbacks): string {
    // Clean up any existing session for this agent (enforces one stream per agent)
    this.cleanupSessionByAgentId(config.agentId);

    // Clean up if too many sessions
    if (this.sessions.size >= STREAM_CONFIG.MAX_SESSIONS) {
      this.cleanupOldestSession();
    }

    // Generate a unique streamId for logging/metadata purposes
    // But use agentId as the canonical key for lookups
    const streamId = unifiedIdService.generateStreamId();

    logger.info('Starting stream', {
      agentId: config.agentId,
      streamId, // For logging only
      sessionId: config.sessionId,
    });

    const session: StreamSession = {
      streamId, // Keep for logging/metadata
      config,
      startTime: Date.now(),
      lastActivity: Date.now(),
      chunks: [],
      accumulatedText: '',
      contentBlocks: [],
      isComplete: false,

      // Enhanced features
      listeners: new Set(),
      timers: new Set(),
      isActive: true,
      chunksReceived: 0,
      bytesReceived: 0,
      sequenceNumber: 0,
      expectedSequence: 0,
      lastHealthCheck: Date.now(),
      healthStatus: 'healthy',
      recoveryAttempts: 0,
    };

    // Use agentId as the canonical key (one stream per agent)
    this.sessions.set(config.agentId, session);

    // Store callbacks under agentId only (no duplication)
    if (callbacks) {
      this.callbacks.set(config.agentId, callbacks);
    }

    // Update metrics
    this.metrics.activeStreams++;
    this.metrics.totalStreams++;

    // Update agent state - fail fast if workspace not found
    const wsId = config.workspaceId as string;
    const workspaceEntity = lookupWorkspaceById(appStore.state, wsId);
    if (!workspaceEntity) {
      logger.error('Workspace not found, cannot start stream — aborting', {
        workspaceId: config.workspaceId,
        agentId: config.agentId,
        operation: 'startStream',
      });
      // Clean up the session we just created since the stream will be non-functional
      this.cleanupSession(config.agentId);
      this.metrics.activeStreams--;
      this.metrics.errors++;
      return config.agentId;
    }
    appStore.dispatch(setAgentStreaming(config.agentId, true));

    // Emit start event (include streamId for backward compatibility in events)
    this.emit('stream:start', { streamId, config });

    logger.info('Started stream', {
      agentId: config.agentId,
      streamId,
    });

    // Return agentId as the stream identifier (canonical key)
    return config.agentId;
  }

  /**
   * Get session by agentId (the canonical key)
   *
   * Since sessions are keyed by agentId, this is a direct lookup.
   * For backward compatibility, also checks if the id matches a session's
   * sessionId or streamId (for legacy callers).
   */
  getSession(id: string): StreamSession | null {
    // Direct lookup by agentId (the canonical key)
    const session = this.sessions.get(id);
    if (session) return session;

    // Fallback: search by sessionId or streamId for backward compatibility
    for (const s of this.sessions.values()) {
      if (s.config.sessionId === id || s.streamId === id) {
        return s;
      }
    }

    return null;
  }

  /**
   * Add a text chunk with enhanced processing
   */
  addTextChunk(id: string, text: string, sequence?: number): void {
    const session = this.getSession(id);
    if (!session || session.isComplete) {
      logger.warn('Invalid or completed stream', { id });
      return;
    }

    // Check chunk size
    if (text.length > STREAM_CONFIG.MAX_CHUNK_SIZE) {
      logger.warn('Chunk size exceeds limit', {
        id,
        size: text.length,
        limit: STREAM_CONFIG.MAX_CHUNK_SIZE,
      });
      text = text.substring(0, STREAM_CONFIG.MAX_CHUNK_SIZE);
    }

    const chunk: StreamChunk = {
      type: 'text',
      data: text,
      timestamp: Date.now(),
      sequence: sequence ?? session.sequenceNumber++,
    };

    // Direct streaming - process immediately, no buffering
    this.processChunk(session, chunk);

    // Update expected sequence if provided
    if (sequence !== undefined && sequence === session.expectedSequence) {
      session.expectedSequence++;
    }

    // Update metrics
    session.chunksReceived++;
    session.bytesReceived += text.length;
    session.lastActivity = Date.now();
    this.metrics.totalChunks++;
    this.metrics.totalBytes += text.length;

    // Periodically save to sessionStorage (every 50 chunks)
    if (session.chunksReceived % 50 === 0) {
      this.saveToSessionStorage();
    }

    // Call callbacks if present - use agentId as the canonical key
    const callbacks = this.callbacks.get(session.config.agentId);
    if (callbacks?.onChunk) {
      try {
        callbacks.onChunk(text);
      } catch (error) {
        logger.error('Error in onChunk callback', { error });
      }
    }
  }

  /**
   * Process a single chunk
   */
  private processChunk(session: StreamSession, chunk: StreamChunk): void {
    session.chunks.push(chunk);

    // PERF: Proactive pruning - don't wait for health check
    // Check every 50 chunks to avoid checking on every chunk
    if (
      session.chunks.length % 50 === 0 &&
      session.chunks.length > STREAM_CONFIG.MAX_CHUNKS_BEFORE_PRUNE
    ) {
      this.pruneOldChunks(session);
    }

    if (chunk.type === 'text') {
      session.accumulatedText += chunk.data;

      // PERF: Warn about large responses that may cause memory pressure
      // Check every 100 chunks to avoid checking on every chunk
      const LARGE_RESPONSE_THRESHOLD = 2 * 1024 * 1024; // 2MB
      if (
        session.chunks.length % 100 === 0 &&
        session.accumulatedText.length > LARGE_RESPONSE_THRESHOLD
      ) {
        logger.warn('Large streaming response detected', {
          agentId: session.config.agentId,
          accumulatedTextMB: (session.accumulatedText.length / (1024 * 1024)).toFixed(2),
          chunkCount: session.chunks.length,
        });
      }

      // Update agent state - check for digest tags in accumulated text
      {
        // Always check for agent digest tags - the tag may be split across chunks
        const { digest, cleanedText } = AuggieTextParser.extractDigest(session.accumulatedText);
        if (digest) {
          session.accumulatedText = cleanedText;
          const wsId = session.config.workspaceId as string;
          appStore.dispatch(updateAgentDigest(wsId, session.config.agentId, digest));
          logger.debug('Extracted agent digest from stream', {
            agentId: session.config.agentId,
            digest,
          });
        }
      }
    }

    // Emit events
    this.emit('stream:chunk', { streamId: session.streamId, chunk });
    this.emit(`stream:${session.streamId}:chunk`, chunk);
  }

  // processBatchedChunks removed - direct streaming only

  /**
   * Add a content block to the stream
   */
  addContentBlock(streamId: string, block: ContentBlock): void {
    // FIX: Use getSession() instead of direct sessions.get() to support
    // fallback lookup by sessionId/streamId (sessions are keyed by agentId)
    const session = this.getSession(streamId);
    if (!session || session.isComplete) {
      logger.warn('Invalid or completed stream', { streamId });
      return;
    }

    const chunk: StreamChunk = {
      type: 'content_block',
      data: block,
      timestamp: Date.now(),
    };

    session.chunks.push(chunk);
    session.contentBlocks.push(block);
    session.lastActivity = Date.now();

    // Content blocks are tracked in the local StreamSession and forwarded via events.
    // No need to update Redux here — stream sagas handle content block state.

    // Emit events
    this.emit('stream:content_block', { streamId, block });
    this.emit(`stream:${streamId}:content_block`, block);
  }

  /**
   * Add a tool call to the stream
   */
  addToolCall(streamId: string, toolCall: any): void {
    // FIX: Use getSession() instead of direct sessions.get() to support
    // fallback lookup by sessionId/streamId (sessions are keyed by agentId)
    const session = this.getSession(streamId);
    if (!session || session.isComplete) {
      return;
    }

    const chunk: StreamChunk = {
      type: 'tool_call',
      data: toolCall,
      timestamp: Date.now(),
    };

    session.chunks.push(chunk);
    session.lastActivity = Date.now();

    // Add to content blocks
    const block: ContentBlock = {
      type: 'tool_use',
      id: toolCall.id || createMessageId(uuidv4()),
      name: toolCall.name,
      input: toolCall.input,
    };
    session.contentBlocks.push(block);

    // Emit events
    this.emit('stream:tool_call', { streamId, toolCall });
    this.emit(`stream:${streamId}:tool_call`, toolCall);
  }

  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    const cleanup = memoryManager.registerTimer(
      () => this.checkStreamHealth(),
      STREAM_CONFIG.HEALTH_CHECK_INTERVAL,
      'interval',
      this,
    );
    this.healthCheckInterval = { cleanup } as any;
  }

  /**
   * Check health of all active streams
   */
  private checkStreamHealth(): void {
    const now = Date.now();

    for (const [streamId, session] of this.sessions) {
      if (session.isComplete) continue;

      const timeSinceActivity = now - session.lastActivity;
      // Update health status
      if (timeSinceActivity > STREAM_CONFIG.STALLED_TIMEOUT) {
        if (session.healthStatus !== 'stalled') {
          session.healthStatus = 'stalled';
          logger.warn('Stream stalled', {
            streamId,
            timeSinceActivity,
            agentId: session.config.agentId,
          });

          // Attempt recovery
          this.attemptStreamRecoveryInternal(streamId);
        }
      } else if (timeSinceActivity > STREAM_CONFIG.STALLED_TIMEOUT / 2) {
        session.healthStatus = 'degraded';
      } else {
        session.healthStatus = 'healthy';
      }

      session.lastHealthCheck = now;

      // PERF: Check memory usage more aggressively to prevent GC pressure
      const shouldPrune =
        session.chunks.length > STREAM_CONFIG.MAX_CHUNKS_BEFORE_PRUNE ||
        session.bytesReceived > STREAM_CONFIG.MAX_SESSION_BYTES;

      if (shouldPrune) {
        logger.warn('Stream approaching memory limits, pruning', {
          streamId,
          chunkCount: session.chunks.length,
          bytesReceived: session.bytesReceived,
          maxChunks: STREAM_CONFIG.MAX_CHUNKS_BEFORE_PRUNE,
          maxBytes: STREAM_CONFIG.MAX_SESSION_BYTES,
        });
        this.pruneOldChunks(session);
      }
    }

    // Update global metrics
    this.updateMetrics();
  }

  /**
   * Public method to attempt stream recovery
   */
  async attemptStreamRecovery(streamId: string): Promise<boolean> {
    const session = this.sessions.get(streamId);
    if (!session) return false;

    // Reset error state to allow recovery
    if (session.error) {
      session.error = undefined;
      session.isComplete = false;
      session.isActive = true;
      session.healthStatus = 'recovering';
    }

    await this.attemptStreamRecoveryInternal(streamId);

    // Check if recovery succeeded
    const recoveredSession = this.sessions.get(streamId);
    return recoveredSession
      ? recoveredSession.healthStatus !== 'stalled' &&
          recoveredSession.healthStatus !== 'error' &&
          !recoveredSession.isComplete
      : false;
  }

  /**
   * Attempt to recover a stalled stream (internal)
   */
  private async attemptStreamRecoveryInternal(streamId: string): Promise<void> {
    const session = this.sessions.get(streamId);
    if (!session || session.isComplete) return;

    session.recoveryAttempts++;

    if (session.recoveryAttempts > 3) {
      logger.error('Stream recovery failed after 3 attempts', { streamId });
      const error = new Error('Stream stalled and recovery failed');
      this.handleError(streamId, error);
      return;
    }

    logger.info('Attempting stream recovery', {
      streamId,
      attempt: session.recoveryAttempts,
    });

    // Emit recovery event
    this.emit('stream:recovery', { streamId, attempt: session.recoveryAttempts });

    // Try to flush any pending data
    // No batching - direct streaming only

    // Reset health status and wait for activity
    session.healthStatus = 'recovering';
    session.lastActivity = Date.now();

    // If recovery is immediate (for testing), mark as healthy
    if (!session.error) {
      session.healthStatus = 'healthy';
    }

    // Set a recovery timeout
    const recoveryTimer = setTimeout(() => {
      const currentSession = this.sessions.get(streamId);
      if (currentSession && currentSession.healthStatus === 'degraded') {
        // Recovery failed, try again or fail
        this.attemptStreamRecoveryInternal(streamId);
      }
    }, STREAM_CONFIG.RECOVERY_TIMEOUT);

    session.timers.add(recoveryTimer);

    this.metrics.recoveries++;
  }

  /**
   * Prune old chunks to prevent memory issues
   * PERF: Uses aggressive limits to prevent GC pressure
   */
  private pruneOldChunks(session: StreamSession): void {
    const maxChunks = STREAM_CONFIG.MAX_CHUNKS_AFTER_PRUNE;
    if (session.chunks.length > maxChunks) {
      const originalLength = session.chunks.length;
      const removed = session.chunks.splice(0, session.chunks.length - maxChunks);

      // Estimate bytes removed (approximate - we don't track per-chunk bytes)
      const bytesPerChunk = session.bytesReceived / originalLength;
      const estimatedBytesRemoved = Math.floor(bytesPerChunk * removed.length);

      // Reduce bytesReceived counter proportionally to help future pruning decisions
      session.bytesReceived = Math.max(0, session.bytesReceived - estimatedBytesRemoved);

      logger.info('Pruned old chunks to reduce memory pressure', {
        streamId: session.streamId,
        removed: removed.length,
        remaining: session.chunks.length,
        estimatedBytesFreed: estimatedBytesRemoved,
        newBytesReceived: session.bytesReceived,
      });
    }
  }

  /**
   * Complete a streaming session with enhanced cleanup
   */
  async completeStream(id: string): Promise<StreamResult> {
    const session = this.getSession(id);
    if (!session) {
      return {
        success: false,
        error: 'Stream session not found',
      };
    }

    if (session.isComplete) {
      return {
        success: false,
        error: 'Stream already completed',
      };
    }

    // No batching - direct streaming only

    session.isComplete = true;
    session.isActive = false;
    const duration = Date.now() - session.startTime;

    // Create assistant message
    const message: AgentMessage & { content?: string } = {
      id: session.config.messageId || createMessageId(uuidv4()),
      appMessageId: session.config.assistantAppMessageId || createAppMessageId(),
      role: 'assistant',
      contentBlocks:
        session.contentBlocks.length > 0
          ? session.contentBlocks
          : session.accumulatedText
            ? [{ type: 'text' as const, text: session.accumulatedText }]
            : [],
      timestamp: new Date(),
      metadata: {
        streamId: session.streamId,
        duration,
        chunkCount: session.chunks.length,
        bytesReceived: session.bytesReceived,
        healthStatus: session.healthStatus,
        recoveryAttempts: session.recoveryAttempts,
      },
    };

    // Add content property for backward compatibility
    // Extract text content from contentBlocks
    if (message.contentBlocks && message.contentBlocks.length > 0) {
      const textContent = message.contentBlocks
        .filter((block) => block.type === 'text')
        .map((block) => block.text || block.content || '')
        .join('');
      (message as any).content = textContent;
    } else {
      (message as any).content = session.accumulatedText || '';
    }

    // Update agent state
    appStore.dispatch(setAgentStreaming(session.config.agentId, false));

    // Call completion callbacks - use agentId as the canonical key
    const callbacks = this.callbacks.get(session.config.agentId);
    if (callbacks?.onComplete) {
      try {
        callbacks.onComplete(message);
      } catch (error) {
        logger.error('Error in onComplete callback', { error });
      }
    }

    // Call config onComplete callback if provided
    if (session.config.onComplete) {
      try {
        session.config.onComplete();
      } catch (error) {
        logger.error('Error in config onComplete callback', { error });
      }
    }

    // NOTE: We do NOT save the message here via PERSISTENCE_SAVE_MESSAGE
    // The streaming message already exists in the session (created when streaming started)
    // and agent stream lifecycle or agent-factory.ts will update it and save the full session
    // when handling the 'complete' event. Calling PERSISTENCE_SAVE_MESSAGE here would
    // APPEND a duplicate message to the session file.

    // Emit complete event
    this.emit('stream:complete', { streamId: session.streamId, message });
    this.emit(`stream:${session.streamId}:complete`, message);

    // Mark agent as having unread messages (if user isn't currently viewing it)
    // Pass isBackground to skip unread tracking for background agents
    const agentSession = lookupAgentSession(
      appStore.state, session.config.agentId
    );
    const isBackgroundAgent =
      agentSession?.isBackground || agentSession?.metadata?.isBackground || false;
    appStore.dispatch(newAssistantMessage(
      session.config.agentId,
      session.config.workspaceId,
      isBackgroundAgent,
    ));

    // Update metrics
    this.metrics.activeStreams--;
    const responseTime = duration;
    const currentAvg = this.metrics.averageResponseTime;
    const totalCount = this.metrics.totalStreams;
    this.metrics.averageResponseTime = (currentAvg * (totalCount - 1) + responseTime) / totalCount;

    // Capture values before clearing for return and logging
    const textLength = session.accumulatedText.length;
    const blockCount = session.contentBlocks.length;
    const chunkCount = session.chunks.length;
    const bytesReceived = session.bytesReceived;
    const healthStatus = session.healthStatus;
    const text = session.accumulatedText;
    const contentBlocks = [...session.contentBlocks]; // Copy for return

    logger.info('Completed stream', {
      streamId: session.streamId,
      duration,
      textLength,
      blockCount,
      chunkCount,
      bytesReceived,
      healthStatus,
    });

    // PERF: Clear large data immediately after message is created
    // This frees memory sooner rather than waiting for session cleanup
    session.accumulatedText = '';
    session.chunks = [];
    // Note: contentBlocks is already copied above for return value

    // Schedule cleanup - use agentId as the canonical key
    const cleanupTimer = setTimeout(() => {
      this.cleanupSession(session.config.agentId);
    }, 5000);
    session.timers.add(cleanupTimer);

    return {
      success: true,
      message,
      text,
      contentBlocks,
      duration,
      chunkCount,
      bytesReceived,
      healthStatus,
    };
  }

  /**
   * Handle stream error with enhanced cleanup
   */
  handleError(id: string, error: Error): void {
    const session = this.getSession(id);
    if (!session) {
      return;
    }

    session.error = error;
    session.isComplete = true;
    session.isActive = false;
    session.healthStatus = 'error';

    // Update agent state
    appStore.dispatch(setAgentStreaming(session.config.agentId, false));

    // Call error callbacks - use agentId as the canonical key
    const callbacks = this.callbacks.get(session.config.agentId);
    if (callbacks?.onError) {
      try {
        callbacks.onError(error);
      } catch (err) {
        logger.error('Error in onError callback', { error: err });
      }
    }

    // Emit error event
    this.emit('stream:error', { streamId: session.streamId, error });
    this.emit(`stream:${session.streamId}:error`, error);

    // Update metrics
    this.metrics.errors++;
    this.metrics.activeStreams = Math.max(0, this.metrics.activeStreams - 1);

    logger.error('Stream error', {
      streamId: session.streamId,
      error: error.message,
      agentId: session.config.agentId,
    });

    // Mark for cleanup but don't remove immediately (for testing/debugging)
    // The session will be cleaned up by the periodic cleanup or on destroy
    session.markedForCleanup = true;
  }

  /**
   * Clean up a session by stream ID
   */
  public cleanupSession(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;

    logger.info('Cleaning up stream session', {
      agentId: session.config.agentId,
      listenersCount: session.listeners.size,
      timersCount: session.timers.size,
    });

    // Clean up batch processor
    // No batching - direct streaming only

    // Clean up listeners
    session.listeners.forEach((cleanup) => {
      try {
        cleanup();
      } catch (error) {
        logger.error('Error during listener cleanup', { error });
      }
    });
    session.listeners.clear();

    // Clean up timers
    session.timers.forEach((timer) => {
      try {
        clearTimeout(timer);
      } catch (error) {
        logger.error('Error clearing timer', { error });
      }
    });
    session.timers.clear();

    // Remove callbacks (keyed by agentId)
    this.callbacks.delete(session.config.agentId);

    // Remove session (keyed by agentId)
    this.sessions.delete(session.config.agentId);
  }

  /**
   * Clean up session by agent ID
   */
  private cleanupSessionByAgentId(agentId: string): void {
    // Direct lookup since sessions are keyed by agentId
    if (this.sessions.has(agentId)) {
      this.cleanupSession(agentId);
    }
  }

  /**
   * Check if stream is active
   */
  isActive(streamId: string): boolean {
    const session = this.sessions.get(streamId);
    return session ? !session.isComplete : false;
  }

  /**
   * Get all active streams
   */
  getActiveStreams(): StreamSession[] {
    return Array.from(this.sessions.values()).filter((s) => !s.isComplete);
  }

  /**
   * Cancel a stream
   */
  cancelStream(streamId: string): void {
    const session = this.getSession(streamId);
    if (!session || session.isComplete) {
      return;
    }

    const error = new Error('Stream cancelled by user');
    this.handleError(streamId, error);
  }

  /**
   * Force close a stream (for testing)
   * @param id - The agentId (canonical key) or any ID that can be resolved to a session
   */
  forceCloseStream(id: string): void {
    const session = this.getSession(id);
    if (!session) {
      return;
    }

    // Mark as complete and clean up
    session.isComplete = true;
    session.isActive = false;

    // Clean up timers
    for (const timer of session.timers) {
      clearTimeout(timer);
    }
    session.timers.clear();

    // Clean up listeners
    session.listeners.clear();

    // Remove from sessions (keyed by agentId)
    this.sessions.delete(session.config.agentId);

    // Remove callbacks (keyed by agentId)
    this.callbacks.delete(session.config.agentId);
  }

  /**
   * Register a cleanup function for a session
   */
  registerCleanup(id: string, cleanup: () => void): void {
    const session = this.getSession(id);
    if (session) {
      session.listeners.add(cleanup);
    }
  }

  /**
   * Register a timer for a session
   */
  registerTimer(id: string, timer: NodeJS.Timeout): void {
    const session = this.getSession(id);
    if (session) {
      session.timers.add(timer);
    }
  }

  /**
   * Update session activity
   */
  updateActivity(id: string): void {
    const session = this.getSession(id);
    if (session) {
      session.lastActivity = Date.now();
    }
  }

  /**
   * Update session metrics
   */
  updateMetrics(): void {
    // Check if we're in a Node.js environment with memoryUsage available
    if (typeof process !== 'undefined' && typeof process.memoryUsage === 'function') {
      const memUsage = process.memoryUsage();
      this.metrics.memoryUsage = memUsage.heapUsed;
    } else if (
      typeof performance !== 'undefined' &&
      typeof (performance as any).memory !== 'undefined'
    ) {
      // Use Performance API in browser if available (Chrome/Edge)
      // Note: This requires the --enable-precise-memory-info flag in Chrome
      const perfMemory = (performance as any).memory;
      if (perfMemory && perfMemory.usedJSHeapSize) {
        this.metrics.memoryUsage = perfMemory.usedJSHeapSize;
      } else {
        // Fallback: estimate based on session data
        this.metrics.memoryUsage = this.estimateMemoryUsage();
      }
    } else {
      // Fallback: estimate based on session data
      this.metrics.memoryUsage = this.estimateMemoryUsage();
    }

    this.metrics.activeStreams = Array.from(this.sessions.values()).filter(
      (s) => !s.isComplete,
    ).length;
  }

  /**
   * Estimate memory usage based on session data
   */
  private estimateMemoryUsage(): number {
    let estimatedBytes = 0;
    for (const session of this.sessions.values()) {
      // Estimate based on accumulated text and chunks
      estimatedBytes += session.accumulatedText.length * 2; // UTF-16 characters
      estimatedBytes += session.chunks.length * 100; // Rough estimate per chunk object
      estimatedBytes += session.bytesReceived;
    }
    return estimatedBytes;
  }

  /**
   * Get current metrics
   */
  getMetrics(): StreamMetrics {
    this.updateMetrics();
    return { ...this.metrics };
  }

  /**
   * Get stream health status
   */
  getStreamHealth(streamId: string): { status: string; lastActivity?: number; error?: Error } {
    const session = this.getSession(streamId);
    if (!session) {
      return { status: 'not_found' };
    }

    const now = Date.now();
    const timeSinceLastActivity = now - session.lastActivity;

    // Check error first before checking isComplete
    if (session.error) {
      return { status: 'error', lastActivity: session.lastActivity, error: session.error };
    }

    if (session.isComplete) {
      return { status: 'completed', lastActivity: session.lastActivity };
    }

    if (timeSinceLastActivity > STREAM_CONFIG.TIMEOUT) {
      return { status: 'stalled', lastActivity: session.lastActivity };
    }

    if (session.isActive) {
      return { status: 'active', lastActivity: session.lastActivity };
    }

    return { status: 'idle', lastActivity: session.lastActivity };
  }

  /**
   * Start cleanup interval
   */
  private startCleanupInterval(): void {
    const cleanup = memoryManager.registerTimer(
      () => this.cleanupTimedOutSessions(),
      STREAM_CONFIG.CLEANUP_INTERVAL,
      'interval',
      this,
    );
    this.cleanupInterval = { cleanup } as any;
  }

  /**
   * Clean up stalled streams (public method for testing)
   */
  cleanupStalledStreams(): void {
    const now = Date.now();
    for (const [streamId, session] of this.sessions) {
      const timeSinceActivity = now - session.lastActivity;
      if (timeSinceActivity > STREAM_CONFIG.TIMEOUT && !session.isComplete) {
        logger.warn('Cleaning up stalled stream', {
          streamId,
          timeSinceActivity,
          agentId: session.config.agentId,
        });
        this.cleanupSession(streamId);
      }
    }
  }

  /**
   * Clean up timed out sessions
   */
  private cleanupTimedOutSessions(): void {
    const now = Date.now();
    const timeout = STREAM_CONFIG.SESSION_TIMEOUT;
    const staleThreshold = 5 * 60 * 1000; // 5 minutes for completed sessions

    for (const [streamId, session] of this.sessions) {
      if (!session.isComplete && now - session.lastActivity > timeout) {
        logger.warn('Cleaning up timed out session', {
          streamId,
          agentId: session.config.agentId,
          inactiveDuration: now - session.lastActivity,
        });
        const error = new Error('Stream timed out');
        this.handleError(streamId, error);
      } else if (session.markedForCleanup && now - session.lastActivity > 1000) {
        // Clean up marked sessions after 1 second (for testing)
        logger.info('Cleaning up marked session', {
          streamId,
          agentId: session.config.agentId,
        });
        this.cleanupSession(streamId);
      } else if (session.isComplete && now - session.lastActivity > staleThreshold) {
        // Clean up completed sessions after 5 minutes
        logger.info('Cleaning up stale completed session', {
          streamId,
          agentId: session.config.agentId,
        });
        this.cleanupSession(streamId);
      }
    }
  }

  /**
   * Clean up oldest session
   */
  private cleanupOldestSession(): void {
    let oldest: StreamSession | null = null;
    let oldestId: string | null = null;

    for (const [id, session] of this.sessions) {
      if (session.isComplete) {
        // Prefer to clean up completed sessions
        this.cleanupSession(id);
        return;
      }
      if (!oldest || session.startTime < oldest.startTime) {
        oldest = session;
        oldestId = id;
      }
    }

    if (oldestId) {
      logger.warn('Cleaning up oldest session due to limit', { streamId: oldestId });
      this.cancelStream(oldestId);
    }
  }

  /**
   * Clean up all sessions
   */
  cleanupAll(): void {
    logger.info('Cleaning up all streaming sessions', {
      count: this.sessions.size,
    });

    // Sessions are keyed by agentId
    for (const agentId of Array.from(this.sessions.keys())) {
      this.cleanupSession(agentId);
    }

    this.callbacks.clear();
  }

  /**
   * Cleanup method for external use (alias for cleanupAll)
   */
  cleanup(): void {
    this.cleanupAll();

    // Reset metrics
    this.metrics = {
      activeStreams: 0,
      totalStreams: 0,
      totalChunks: 0,
      totalBytes: 0,
      averageResponseTime: 0,
      memoryUsage: 0,
      errors: 0,
      recoveries: 0,
    };
  }

  /**
   * No-op - direct streaming doesn't need flushing
   */
  flushBatch(): void {
    // Direct streaming - no batching to flush
  }

  /**
   * Destroy the manager
   */
  destroy(): void {
    // FIX: Handle memoryManager cleanup objects (same pattern as dispose())
    // cleanupInterval and healthCheckInterval are { cleanup } objects from
    // memoryManager.registerTimer(), not raw interval IDs
    if (this.cleanupInterval) {
      if (typeof this.cleanupInterval === 'object' && 'cleanup' in this.cleanupInterval) {
        (this.cleanupInterval as any).cleanup();
      } else {
        clearInterval(this.cleanupInterval);
      }
      this.cleanupInterval = null;
    }

    if (this.healthCheckInterval) {
      if (typeof this.healthCheckInterval === 'object' && 'cleanup' in this.healthCheckInterval) {
        (this.healthCheckInterval as any).cleanup();
      } else {
        clearInterval(this.healthCheckInterval);
      }
      this.healthCheckInterval = null;
    }

    // Cancel all active streams
    for (const streamId of this.sessions.keys()) {
      this.cancelStream(streamId);
    }

    this.cleanupAll();
    this.removeAllListeners();
  }

  /**
   * Register a temporary workspace in Redux for test harness methods.
   * This is needed because startStream() validates that the workspace exists.
   */
  private registerTestWorkspace(workspaceId: string): void {
    const testWorkspace: Workspace = {
      id: WorkspaceId(workspaceId),
      title: 'Test Workspace',
      branch: 'test',
      changesets: [],
      timeline: [],
      conversationInfo: [],
      status: WorkspaceStatus.Active,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    appStore.dispatch(setWorkspaceEntity(testWorkspace));
  }

  /**
   * Test streaming functionality (for test harness)
   */
  async testStreaming(chunks: string[], options: { delay?: number } = {}): Promise<StreamResult> {
    const testWsId = 'test-workspace';
    this.registerTestWorkspace(testWsId);

    const config: StreamConfig = {
      agentId: 'test-agent',
      sessionId: 'test-session',
      workspaceId: WorkspaceId(testWsId),
    };

    try {
      const streamId = this.startStream(config);
      const delay = options.delay || 100;

      // Simulate streaming chunks
      for (const chunk of chunks) {
        this.addTextChunk(streamId, chunk);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      // Complete the stream
      return this.completeStream(streamId);
    } finally {
      appStore.dispatch(removeWorkspaceEntity(testWsId));
      appStore.dispatch(removeWorkspaceAgentState(testWsId));
    }
  }

  /**
   * Test error recovery (for test harness)
   */
  async testErrorRecovery(options: { type: string }): Promise<boolean> {
    const testWsId = 'test-workspace';
    this.registerTestWorkspace(testWsId);

    const config: StreamConfig = {
      agentId: 'test-agent-recovery',
      sessionId: 'test-session-recovery',
      workspaceId: WorkspaceId(testWsId),
    };

    try {
      const streamId = this.startStream(config);

      if (options.type === 'stream-interruption') {
        // Simulate stream interruption
        const session = this.sessions.get(streamId);
        if (session) {
          // Force stall the stream
          session.lastActivity = Date.now() - STREAM_CONFIG.STALLED_TIMEOUT - 1000;
          session.healthStatus = 'stalled';

          // Trigger recovery
          await this.attemptStreamRecovery(streamId);

          // Check if recovery succeeded
          await new Promise((resolve) => setTimeout(resolve, 1000));

          const recoveredSession = this.sessions.get(streamId);
          return recoveredSession ? recoveredSession.healthStatus !== 'stalled' : false;
        }
      }

      return false;
    } finally {
      appStore.dispatch(removeWorkspaceEntity(testWsId));
      appStore.dispatch(removeWorkspaceAgentState(testWsId));
    }
  }

  /**
   * Save stream state to sessionStorage
   */
  private saveToSessionStorage(): void {
    if (typeof sessionStorage === 'undefined') return;

    try {
      const activeStreams = Array.from(this.sessions.entries())
        .filter(([, session]) => !session.isComplete && session.isActive)
        .map(([id, session]) => ({
          streamId: id,
          config: session.config,
          startTime: session.startTime,
          lastActivity: session.lastActivity,
          accumulatedText: session.accumulatedText,
          contentBlocks: session.contentBlocks,
          chunksReceived: session.chunksReceived,
          bytesReceived: session.bytesReceived,
          sequenceNumber: session.sequenceNumber,
          healthStatus: session.healthStatus,
        }));

      if (activeStreams.length > 0) {
        sessionStorage.setItem('active-streams', JSON.stringify(activeStreams));
        logger.info('Saved active streams to sessionStorage', {
          count: activeStreams.length,
          agentIds: activeStreams.map((s) => s.config.agentId),
        });
      } else {
        sessionStorage.removeItem('active-streams');
      }
    } catch (error) {
      logger.error('Failed to save streams to sessionStorage', { error });
    }
  }

  /**
   * Load stream state from sessionStorage
   */
  private loadFromSessionStorage(): void {
    if (typeof sessionStorage === 'undefined') return;

    try {
      const stored = sessionStorage.getItem('active-streams');
      if (!stored) {
        logger.debug('No active streams found in sessionStorage');
        return;
      }

      const streamStates = JSON.parse(stored);
      logger.info('Loading streams from sessionStorage', {
        count: streamStates.length,
      });

      for (const state of streamStates) {
        // Check if stream is recent (within last 5 minutes)
        const age = Date.now() - state.lastActivity;
        if (age > 5 * 60 * 1000) {
          logger.warn('Skipping stale stream from sessionStorage', {
            agentId: state.config.agentId,
            ageMinutes: Math.round(age / 60000),
          });
          continue;
        }

        // Restore session
        const session: StreamSession = {
          streamId: state.streamId,
          config: state.config,
          startTime: state.startTime,
          lastActivity: Date.now(), // Update to now
          chunks: [], // Don't restore chunks (too large)
          accumulatedText: state.accumulatedText,
          contentBlocks: state.contentBlocks,
          isComplete: false,
          isActive: true,
          listeners: new Set(),
          timers: new Set(),
          chunksReceived: state.chunksReceived,
          bytesReceived: state.bytesReceived,
          sequenceNumber: state.sequenceNumber,
          expectedSequence: state.sequenceNumber,
          lastHealthCheck: Date.now(),
          healthStatus: 'degraded', // Mark as degraded until we verify
          recoveryAttempts: 0,
        };

        // Use agentId as the canonical key
        this.sessions.set(state.config.agentId, session);

        // Update agent state via Redux
        const store = appStore;
        store.dispatch(setAgentStreaming(state.config.agentId, true));

        // Restore content blocks to agent state
        if (state.contentBlocks.length > 0) {
          const agentData = lookupAgentSession(store.state, state.config.agentId);
          if (agentData) {
            const lastMessage = agentData.messages?.[agentData.messages.length - 1];
            if (lastMessage && lastMessage.role === 'assistant') {
              // Content blocks on existing messages are handled by the UI layer via streaming events.
              // No direct mutation needed in Redux here.
            } else {
              // Create a new assistant message with the content blocks
              store.dispatch(addAgentSessionMessage(state.config.agentId, {
                id: createMessageId(`msg_${Date.now()}`),
                appMessageId: createAppMessageId(),
                role: 'assistant',
                contentBlocks: state.contentBlocks,
                timestamp: new Date().toISOString(),
              }));
            }
          }
        }

        logger.info('Restored stream from sessionStorage', {
          streamId: state.streamId,
          agentId: state.config.agentId,
          textLength: state.accumulatedText.length,
          blocksCount: state.contentBlocks.length,
        });

        // Emit reconnecting event
        this.emit('stream:reconnecting', {
          streamId: state.streamId,
          agentId: state.config.agentId,
        });
      }

      // Clear sessionStorage after successful load
      sessionStorage.removeItem('active-streams');
    } catch (error) {
      logger.error('Failed to load streams from sessionStorage', { error });
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
    logger.info('Disposing StreamManager');

    // Save active streams before disposing
    this.saveToSessionStorage();

    // Reuse destroy() for shared cleanup:
    // - Clears intervals (cleanupInterval, healthCheckInterval)
    // - Cancels all active streams
    // - Calls cleanupAll() which cleans up each session's timers, listeners, and removes them
    // - Removes all event listeners
    this.destroy();

    // Clean up with memory manager
    memoryManager.cleanup(this);

    logger.info('StreamManager disposed successfully');
  }
}

// Export singleton instance
export const streamManager = StreamManager.getInstance();
