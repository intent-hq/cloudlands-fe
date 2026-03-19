/**
 * Agent Service
 *
 * Manages agent lifecycle and interactions using modular services.
 * Delegates specialized responsibilities to:
 * - UnifiedAgentFactory: Agent creation
 * - SessionStore: Session state management
 * - PersistenceService: Disk persistence
 * - ErrorRecovery: Error handling and retry logic
 */

import { v4 as uuidv4 } from 'uuid';
import { createMessageId, WorkspaceId } from '$shared/types/branded-ids';
import { get, writable, Writable } from 'svelte/store';
import { invoke } from '$lib/electron-bridge';
import { AGENT_BACKEND_CHANNELS } from '$shared/ipc/channels';
import { createLogger } from '$lib/utils/client-logger';
import { EventEmitter } from '$lib/utils/browser-event-emitter';
import type {
  Workspace,
  CommandResponse,
  ContentBlock,
  AgentMessage,
  AgentSession,
} from '$shared/types';
import { AgentStatus, normalizeContentBlocks } from '$shared/types';
import { AgentActivationState } from '$shared/types/agent-session';
import { DEFAULT_AGENT_MODEL } from '$shared/constants/agent-services';

// Import services
import { unifiedStateStore } from '$features/agent/services/unified-state-store';
import { performanceOptimizer } from '$features/agent/services/performance-optimizer';

// Import the unified agent factory for agent creation (with full logic)
import { agentFactory } from '$features/agent/services/agent-factory';

// Import browser-safe proxy services
// Note: agentIpcProxy is used for activateAgent/deleteAgent IPC calls
import {
  agentIpcProxy,
  configCache,
  errorBoundary,
  persistenceService,
  sessionStore,
} from './browser';

import { errorRecovery, DEFAULT_STRATEGIES } from './browser/services/error-recovery.service';
import { AGENT_STREAMING_CONFIG } from '$shared/constants/agent-streaming';
import { compareMessageCompleteness } from '$shared/utils/message-comparator';
import { PendingEventQueue } from './utils/pending-event-queue';
import { assertStreamingInvariant } from './utils/streaming-invariants';
import type { StreamingHealthSummary } from './utils/streaming-invariants';
import {
  requestDeduplicator,
  generateMessageKey,
} from './browser/services/request-deduplicator.service';
import { unreadTrackingService } from './services/unread-tracking.service';
import { track } from '$lib/services/analytics';

// Import unified error handler
import {
  errorHandler,
  AgentError,
  ErrorCode,
  ErrorCategory,
  ErrorSeverity,
} from '$features/agent/services/error-handler';

const logger = createLogger('AgentService');

import { eventCollector, AgentEventType } from '../observability/event-collector-client';
import { workspaceMetrics } from '../workspace/workspace-metrics';
import { agentFileTracker } from './agent-file-tracker';

// Re-export types
export type { AgentSession, AgentStatus, AgentMessage } from '$shared/types';

// Key for persisting AgentService listener references on `window` across HMR reloads.
// During HMR, Vite re-evaluates this module and creates a new singleton, but IPC listeners
// registered by the previous instance survive in the Electron preload's listener registry.
// Without cleanup, each HMR cycle adds duplicate listeners, causing stream data to be
// delivered multiple times (e.g., tripled text in the chat).
const HMR_CLEANUP_KEY = '__agentService_hmr';

/**
 * Per-agent analytics tracking state used to compute turn duration and
 * tool-call deltas.  Stored in a module-level Map (keyed by agentId) instead
 * of on `session.metadata` so we don't need `as any` type assertions and
 * avoid polluting the persisted metadata object.
 */
interface AgentAnalyticsState {
  turnStartTime: number;
  prevToolCallCount: number;
}

const agentAnalyticsState = new Map<string, AgentAnalyticsState>();

/**
 * Options for ensureStreamHandler
 */
interface EnsureStreamHandlerOpts {
  existingMessage?: AgentMessage;
  workspaceId?: string;
  forceReregister?: boolean; // For queue:processing which needs fresh handler
}

/**
 * Refactored Agent Service for managing agent lifecycle and interactions.
 * Provides a unified interface for creating, managing, and communicating with AI agents.
 * Delegates specialized responsibilities to modular services.
 *
 * @extends EventEmitter
 * @example
 * ```typescript
 * const service = new RefactoredAgentService();
 * const agentId = await this.createAgent(config);
 * await this.sendMessage(agentId, 'Hello, agent!');
 * ```
 */
class RefactoredAgentService extends EventEmitter {
  private initializationStatus = new Map<string, any>();
  private initializationStatusStore = writable<Map<string, any>>(new Map());
  private store = sessionStore.getStore();

  // Track stream timeouts to ensure they're properly cleared
  private streamTimeouts = new Map<string, NodeJS.Timeout>();
  // Track active stream handlers to ensure proper cleanup
  // We need to store both the original handler AND any wrapper the preload might create
  private activeStreamHandlers = new Map<
    string,
    {
      channel: string;
      handler: (data: any) => void;
      wrappedHandler?: any; // Store the wrapped handler if preload creates one
      workspaceId?: string; // Track which workspace this handler belongs to
      listenerId?: string; // Unique ID from preload for offById() cleanup
      registeredAt?: number; // Timestamp when this handler was registered
    }
  >();
  // Track pending stream handler registrations to prevent race conditions
  // when multiple agent:created events arrive in quick succession
  private pendingStreamRegistrations = new Set<string>();

  // Mutex for agent activation - prevents duplicate concurrent activations for the same agentId.
  // When a second caller arrives while activation is in progress, it awaits the first caller's promise.
  private activationMutex = new Map<string, Promise<AgentSession | null>>();

  // Deduplication for agent:created events - same agentId can arrive multiple times
  // from different IPC channels within milliseconds
  private recentAgentCreatedEvents = new Map<string, number>();

  // Deduplication for createSession calls - prevents two concurrent createSession calls
  // for the same agentId from both proceeding to agentFactory.createAgent()
  private pendingSessionCreations = new Map<string, Promise<AgentSession>>();
  private readonly AGENT_CREATED_DEDUP_WINDOW = 500; // ms

  // Lock for initial agent activation - prevents duplicate coordinator creation
  // when multiple code paths (restoreSession, resumeSession, createSession) race
  // during workspace creation. Key: `${workspaceId}:${agentId}`
  private initialAgentActivationLocks = new Map<string, Promise<AgentSession | null>>();

  // Track the message count from disk for each agent session.
  // This prevents beforeunload from overwriting a complete session on disk
  // with a stale in-memory session that has fewer messages.
  private diskMessageCounts = new Map<string, number>();

  // Track ping handlers for IPC heartbeat per agent
  private activePingHandlers = new Map<
    string,
    { channel: string; handler: (data: any) => void; listenerId?: string }
  >();

  // Track global IPC listener cleanup functions for proper disposal
  private globalIpcListenerCleanup: (() => void)[] = [];

  // FIX: Pending event queue to prevent dropped events when handlers are not registered
  // Events are queued when no handler exists and replayed when a handler is registered
  // This fixes the "agent stops responding" issue caused by completion events being
  // dropped during navigation, HMR, or component remount timing issues
  private pendingEventQueue = new PendingEventQueue();

  // FIX: Track DOM event handlers registered by ChatService
  // This allows hasActiveStreamListener to correctly detect when handlers exist
  private registeredDomHandlers = new Set<string>();

  // Track if the service has been disposed to prevent operations after cleanup
  // and to allow re-initialization if needed
  private isDisposed = false;

  // Debounce timer for scheduling reconnectToBackendStreams after disk load
  private reconnectDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  // Safety timeout to force-clear stale streaming indicators
  private streamingSafetyTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super();
    // Initialize services
    this.setupEventListeners();
    // Reconnect to any active streams after initialization
    this.reconnectActiveStreams();
    // Set up beforeunload handler to save streaming state
    this.setupBeforeUnloadHandler();

    // Start periodic cleanup for the pending event queue to prevent memory leaks
    this.pendingEventQueue.startPeriodicCleanup();

    // Persist references on window so the next HMR cycle can clean up our listeners.
    // This is safe in production: the first evaluation stores the references, and no
    // previous state exists to clean up (see module-level cleanup code below).
    (window as any)[HMR_CLEANUP_KEY] = {
      activeStreamHandlers: this.activeStreamHandlers,
      globalIpcListenerCleanup: this.globalIpcListenerCleanup,
      activePingHandlers: this.activePingHandlers,
    };
  }

  /**
   * Reinitialize the service after disposal.
   * This is called automatically when methods are invoked after disposal,
   * which can happen after HMR or cancelled navigation events.
   */
  private reinitialize(): void {
    if (!this.isDisposed) return;

    logger.info('Reinitializing AgentService after disposal');
    this.isDisposed = false;

    // Re-setup event listeners
    this.setupEventListeners();

    // Reconnect to any active streams
    this.reconnectActiveStreams();

    // Re-persist references on window after reinitialize.
    // dispose() reassigns globalIpcListenerCleanup to a new array, breaking the
    // reference stored on window. Update it so the next HMR cycle can still clean up.
    (window as any)[HMR_CLEANUP_KEY] = {
      activeStreamHandlers: this.activeStreamHandlers,
      globalIpcListenerCleanup: this.globalIpcListenerCleanup,
      activePingHandlers: this.activePingHandlers,
    };
  }

  /**
   * Ensure the service is initialized before performing operations.
   * Automatically reinitializes if the service was disposed.
   */
  private ensureInitialized(): void {
    if (this.isDisposed) {
      this.reinitialize();
    }
  }

  /**
   * Update session helper
   */
  private updateSession(agentId: string, session: AgentSession): void {
    // Direct update
    sessionStore.addSession(session);
  }

  /**
   * FIX: Dispatch a stream event with queuing support
   * If no handler is registered for this session, the event is queued and will be
   * replayed when a handler is registered. This prevents the "agent stops responding"
   * issue caused by events being dropped during navigation/HMR.
   *
   * BEHAVIOR:
   * - If handler exists: dispatch immediately, don't queue
   * - If no handler: queue for later replay, still dispatch (in case of untracked handlers)
   *
   * When a handler registers via registerDomHandler(), it should call replayPendingEvents()
   * to receive any queued events, then those events are cleared to prevent duplicates.
   */
  private dispatchStreamEvent(sessionId: string, eventType: string, detail: any): void {
    // Invariant: sessionId must not be empty
    assertStreamingInvariant(
      !!sessionId && sessionId.length > 0,
      'dispatchStreamEvent called with empty sessionId',
      { eventType },
    );

    const eventName = `agent:stream:${sessionId}`;
    const event = new CustomEvent(eventName, { detail });

    // Check if there's an active DOM listener for this event
    // We use a tracking approach: if ChatService has registered a handler,
    // the event will be received. If not, we queue it.
    const hasHandler = this.hasActiveStreamListener(sessionId);

    if (hasHandler) {
      // Handler exists - dispatch directly, no need to queue
      window.dispatchEvent(event);
      logger.debug('Dispatched stream event to registered handler', { sessionId, eventType });

      // Invariant: event was dispatched, so it must NOT also be queued
      assertStreamingInvariant(
        !this.pendingEventQueue.has(sessionId) ||
          this.pendingEventQueue.getQueueSize(sessionId) ===
            (this._preDispatchQueueSize ?? 0),
        'Event was both dispatched AND queued — dual delivery detected',
        { sessionId, eventType, queueSize: this.pendingEventQueue.getQueueSize(sessionId) },
      );
    } else {
      // No known handler - queue for later replay
      // FIX: Queue OR dispatch, never both. The previous "defensive dispatch" caused
      // dual delivery when a DOM handler existed but wasn't tracked, leading to
      // duplicate events. With fix 1a ensuring hasActiveStreamListener only checks
      // DOM handlers, queueing alone is correct — events will be replayed when
      // ChatService calls setupStreaming() → replayPendingEvents().
      this.queuePendingEvent(sessionId, eventType, detail);
      logger.info('Queued stream event (no handler registered)', { sessionId, eventType });
    }
  }

  // Internal bookkeeping for dual-delivery invariant check
  private _preDispatchQueueSize: number | undefined;

  /**
   * Check if there's an active stream listener for a session
   * This checks DOM handlers only (not IPC handlers)
   */
  private hasActiveStreamListener(sessionId: string): boolean {
    // FIX: Only check DOM handlers, not IPC handlers.
    // The IPC handler (activeStreamHandlers) means the IPC→DOM bridge is ready,
    // but NOT that a DOM consumer (ChatService) exists to receive CustomEvents.
    // Checking activeStreamHandlers here caused events to be dispatched into the void
    // instead of being queued for later replay.
    const result = this.registeredDomHandlers.has(sessionId);

    // Invariant: result must match registeredDomHandlers, NOT activeStreamHandlers
    // This guards against accidental regression to the old (buggy) check
    assertStreamingInvariant(
      result === this.registeredDomHandlers.has(sessionId),
      'hasActiveStreamListener result does not match registeredDomHandlers',
      { sessionId, result, domHandlers: this.registeredDomHandlers.size },
    );

    return result;
  }

  /**
   * Register a DOM event handler for a session
   * Called by ChatService when it sets up streaming to enable proper event queuing
   */
  registerDomHandler(sessionId: string): void {
    this.registeredDomHandlers.add(sessionId);
    logger.debug('Registered DOM handler', { sessionId });
  }

  /**
   * Unregister a DOM event handler for a session
   * Called by ChatService when it cleans up streaming
   */
  unregisterDomHandler(sessionId: string): void {
    this.registeredDomHandlers.delete(sessionId);
    logger.debug('Unregistered DOM handler', { sessionId });
  }

  /**
   * Queue a pending event for a session
   */
  private queuePendingEvent(sessionId: string, eventType: string, detail: any): void {
    this.pendingEventQueue.queue(sessionId, eventType, detail);
  }

  /**
   * Replay any pending events for a session
   * Called when a handler is registered to ensure no events were missed
   *
   * FIX: Uses a snapshot approach (inside PendingEventQueue.replay()) to avoid
   * race condition where events added during replay could be lost.
   */
  replayPendingEvents(sessionId: string): void {
    // Snapshot queue size before replay to detect growth during replay
    const preReplaySize = this.pendingEventQueue.getQueueSize(sessionId);

    const events = this.pendingEventQueue.replay(sessionId);
    if (events.length === 0) {
      return;
    }

    // Invariant: replayed events should not exceed pre-replay queue size
    assertStreamingInvariant(
      events.length <= preReplaySize,
      'More events replayed than were in the queue — possible corruption',
      { sessionId, preReplaySize, replayedCount: events.length },
    );

    logger.info('Replaying pending stream events', {
      sessionId,
      eventCount: events.length,
    });

    const eventName = `agent:stream:${sessionId}`;

    // Dispatch events in order (oldest first)
    for (const pendingEvent of events) {
      const event = new CustomEvent(eventName, { detail: pendingEvent.detail });
      window.dispatchEvent(event);
      logger.debug('Replayed pending event', { sessionId, type: pendingEvent.type });
    }
  }

  /**
   * Clear pending events for a session (called on cleanup)
   */
  clearPendingEvents(sessionId: string): void {
    this.pendingEventQueue.clear(sessionId);
  }

  /**
   * Get a diagnostic snapshot of the current streaming state.
   * Useful for debugging in dev tools and for future monitoring.
   */
  getStreamingDiagnostics(): {
    activeIpcHandlers: Array<{ agentId: string; channel: string; hasTimeout: boolean }>;
    registeredDomHandlers: string[];
    pendingQueues: Array<{ sessionId: string; eventCount: number; oldestEventAge: number }>;
    streamTimeouts: string[];
    orphanedHandlers: string[];
    health: {
      totalActiveStreams: number;
      totalPendingEvents: number;
      hasOrphanedHandlers: boolean;
      oldestPendingEventAge: number | null;
    };
  } {
    const now = Date.now();

    // 1. IPC handler info
    const activeIpcHandlers = Array.from(this.activeStreamHandlers.entries()).map(
      ([agentId, info]) => ({
        agentId,
        channel: info.channel,
        hasTimeout: this.streamTimeouts.has(agentId),
      }),
    );

    // 2. DOM handler list
    const registeredDomHandlers = Array.from(this.registeredDomHandlers);

    // 3. Pending queue stats
    const queueStats = this.pendingEventQueue.getAllSessionStats();
    const pendingQueues = queueStats.map((s) => ({
      sessionId: s.sessionId,
      eventCount: s.eventCount,
      oldestEventAge: now - s.oldestTimestamp,
    }));

    // 4. Stream timeouts
    const streamTimeouts = Array.from(this.streamTimeouts.keys());

    // 5. Orphaned handlers: IPC handlers with no matching DOM handler
    const ipcAgentIds = new Set(this.activeStreamHandlers.keys());
    const domHandlerSet = this.registeredDomHandlers;
    const orphanedHandlers = Array.from(ipcAgentIds).filter((id) => !domHandlerSet.has(id));

    // 6. Health summary
    const totalPendingEvents = pendingQueues.reduce((sum, q) => sum + q.eventCount, 0);
    const oldestAge = pendingQueues.length > 0
      ? Math.max(...pendingQueues.map((q) => q.oldestEventAge))
      : null;

    return {
      activeIpcHandlers,
      registeredDomHandlers,
      pendingQueues,
      streamTimeouts,
      orphanedHandlers,
      health: {
        totalActiveStreams: this.activeStreamHandlers.size,
        totalPendingEvents,
        hasOrphanedHandlers: orphanedHandlers.length > 0,
        oldestPendingEventAge: oldestAge,
      },
    };
  }

  /**
   * Reconnect to active streams after page refresh
   */
  private reconnectActiveStreams() {
    // Check all sessions for incomplete streaming messages
    const allSessions = sessionStore.getAllSessions();

    if (!allSessions || allSessions.length === 0) {
      logger.debug('No sessions found in store for stream recovery');
      return;
    }

    // Collect all sessions with streaming messages first (avoid repeated logging in loop)
    const sessionsToReconnect: Array<{ session: (typeof allSessions)[0]; message: any }> = [];

    for (const session of allSessions) {
      if (!session.messages) continue;

      // Find any assistant messages that are still marked as streaming
      const streamingMessage = session.messages.find(
        (m: any) => m.role === 'assistant' && m.isStreaming === true,
      );

      if (streamingMessage) {
        sessionsToReconnect.push({ session, message: streamingMessage });
      }
    }

    // Log a single summary instead of per-agent logging
    if (sessionsToReconnect.length > 0) {
      logger.info('Reconnecting stream handlers for incomplete streaming sessions', {
        count: sessionsToReconnect.length,
        agentIds: sessionsToReconnect.map((s) => s.session.id),
      });

      // Register all handlers (synchronous, but batched for clarity)
      for (const { session, message } of sessionsToReconnect) {
        this.ensureStreamHandler(session.id, { existingMessage: message });
      }

      // Schedule reconnectToBackendStreams with a 500ms debounce.
      // This verifies streaming states with the backend and clears stale indicators
      // promptly after sessions with isStreaming=true are loaded from disk.
      this.scheduleBackendStreamReconnect();
    }
  }

  /**
   * Schedule reconnectToBackendStreams() with a 500ms debounce.
   * Multiple calls within the debounce window are coalesced into one.
   */
  private scheduleBackendStreamReconnect(): void {
    if (this.reconnectDebounceTimer) {
      clearTimeout(this.reconnectDebounceTimer);
    }

    this.reconnectDebounceTimer = setTimeout(() => {
      this.reconnectDebounceTimer = null;
      logger.info('Debounced reconnectToBackendStreams triggered after disk load');
      this.reconnectToBackendStreams().catch((error) => {
        logger.error('Failed to reconnect to backend streams after disk load', error as Error);
      });
    }, 500);
  }

  /**
   * Re-register IPC stream handlers for agents in a specific workspace that
   * have isStreaming === true.  This is the workspace-scoped equivalent of
   * the private reconnectActiveStreams() and should be called every time the
   * user navigates (back) to a workspace so that the frontend IPC layer is
   * wired up to receive session updates from the backend.
   *
   * registerStreamHandlerForSession() is idempotent — it returns early if a
   * handler already exists — so calling this on every workspace visit is safe.
   */
  reconnectStreamHandlersForWorkspace(workspaceId: string): void {
    const sessions = this.getSessionsForWorkspace(workspaceId);
    if (!sessions || sessions.length === 0) return;

    const sessionsToReconnect: Array<{ session: AgentSession; message: AgentMessage }> = [];

    for (const session of sessions) {
      if (!session.messages) continue;

      const streamingMessage = session.messages.find(
        (m: AgentMessage) => m.role === 'assistant' && m.isStreaming === true,
      );

      if (streamingMessage) {
        sessionsToReconnect.push({ session, message: streamingMessage });
      }
    }

    if (sessionsToReconnect.length > 0) {
      logger.info('Re-registering stream handlers on workspace re-visit', {
        workspaceId,
        count: sessionsToReconnect.length,
        agentIds: sessionsToReconnect.map((s) => s.session.id),
      });

      for (const { session, message } of sessionsToReconnect) {
        this.ensureStreamHandler(session.id, {
          existingMessage: message,
          workspaceId,
        });
      }
    }
  }

  /**
   * Query backend for active streams and re-register IPC handlers.
   * This should be called after loading agents from disk to reconnect to any
   * streams that were active when the page was refreshed/HMR occurred.
   *
   * @returns Array of agent IDs that have active streams on the backend
   */
  async reconnectToBackendStreams(): Promise<string[]> {
    if (!window.electronAPI) {
      logger.warn('electronAPI not available for reconnecting to backend streams');
      return [];
    }

    try {
      logger.info('Querying backend for active streams...');
      const result = await window.electronAPI.invoke('agent:get-active-streams');

      // Get the set of agent IDs that have active streams on the backend
      const activeStreamAgentIds = new Set<string>(
        result.success && result.data ? result.data.map((s: any) => s.agentId) : [],
      );

      // Clear stale streaming states for sessions that are marked as streaming
      // but don't have an active stream on the backend.
      // CRITICAL: Use getAllSessionsAcrossWorkspaces to check ALL workspaces, not just the current one.
      // This ensures we can handle streams that complete in other workspaces while the user is
      // viewing a different workspace.
      const allSessions = sessionStore.getAllSessionsAcrossWorkspaces();
      logger.info('Checking sessions for stale streaming states (all workspaces)', {
        sessionCount: allSessions.length,
        sessionsWithStreaming: allSessions.filter((s) => s.isStreaming).length,
        activeBackendStreams: activeStreamAgentIds.size,
      });

      // Grace period for newly created agents - don't clear streaming state if agent was created recently
      // This prevents race conditions where the backend stream hasn't started yet but the frontend
      // has already set isStreaming=true in anticipation
      const STREAMING_GRACE_PERIOD_MS = 15000; // 15 seconds

      for (const session of allSessions) {
        if (session.isStreaming && !activeStreamAgentIds.has(session.id)) {
          // Check if the session was created recently - if so, skip clearing its streaming state
          const sessionCreatedAt = session.createdAt ? new Date(session.createdAt).getTime() : 0;
          const sessionAge = Date.now() - sessionCreatedAt;

          // Also check when streaming started, not just when the agent was created.
          // For existing agents that start a new stream, createdAt is old but streaming just began.
          const streamHandler = this.activeStreamHandlers.get(session.id);
          const streamRegisteredAt = streamHandler?.registeredAt || 0;
          const streamAge = streamRegisteredAt > 0 ? Date.now() - streamRegisteredAt : Infinity;

          if (sessionAge < STREAMING_GRACE_PERIOD_MS || streamAge < STREAMING_GRACE_PERIOD_MS) {
            logger.debug(
              'Skipping stale streaming state check (within grace period)',
              {
                agentId: session.id,
                sessionAgeMs: sessionAge,
                streamAgeMs: streamAge,
                gracePeriodMs: STREAMING_GRACE_PERIOD_MS,
              },
            );
            continue;
          }

          logger.info('Clearing stale streaming state for agent (no active backend stream)', {
            agentId: session.id,
          });

          // Clean up any stale stream handler that was registered by loadAgentsFromDisk
          // before we queried the backend. This handler has stale state and would cause issues
          // if a new message is sent later.
          const staleHandler = this.activeStreamHandlers.get(session.id);
          if (staleHandler) {
            logger.info('Cleaning up stale stream handler (no active backend stream)', {
              agentId: session.id,
              channel: staleHandler.channel,
            });
            // Use offById for targeted cleanup - avoids removing other listeners on the same channel
            // (e.g., AgentSubscriptions.svelte listens on agent:stream:${agentId} for content-blocks)
            if (staleHandler.listenerId) {
              window.electronAPI.offById(staleHandler.channel, staleHandler.listenerId);
            } else {
              window.electronAPI.removeAllListeners(staleHandler.channel);
            }
            this.activeStreamHandlers.delete(session.id);

            // Clear any pending timeout
            const existingTimeout = this.streamTimeouts.get(session.id);
            if (existingTimeout) {
              clearTimeout(existingTimeout);
              this.streamTimeouts.delete(session.id);
            }
          }

          // Explicitly clear streaming.active in unifiedStateStore via setStreaming().
          // This is necessary because setAgent() (called by addSession) preserves
          // streaming.active=true to prevent stale disk data from resetting an active stream.
          // Since the backend confirmed this agent is NOT streaming, we must explicitly
          // clear it here so streaming.active doesn't get stuck as true.
          if (session.workspaceId) {
            sessionStore.setStreamingForWorkspace(session.workspaceId, session.id, false);
          } else {
            sessionStore.setStreaming(session.id, false);
          }

          // When the stream completed while the user was viewing another workspace,
          // the backend persisted the complete response to disk. The frontend's in-memory session
          // is stale and doesn't have this response. We must:
          // 1. Load the session from disk (which has the backend's complete data)
          // 2. Clear isStreaming flags on that loaded data
          // 3. Update our in-memory store with the loaded data
          // 4. Persist the updated session (with cleared streaming flags)
          //
          // Previously, we were persisting the frontend's stale session which would OVERWRITE
          // the backend's complete response, causing the user to lose the agent's reply.
          try {
            // Load the session from disk to get the backend's complete data
            const loadResult = await invoke<{
              success: boolean;
              data?: AgentSession;
              error?: string;
            }>('agent:persistence:load', {
              agentId: session.id,
              workspaceId: session.workspaceId,
            });

            if (loadResult?.success && loadResult.data) {
              const diskSession = loadResult.data;
              logger.info('Loaded session from disk for stale streaming cleanup', {
                agentId: session.id,
                diskMessageCount: diskSession.messages?.length || 0,
                memoryMessageCount: session.messages?.length || 0,
              });

              // Ensure workspaceId is set on the loaded session
              // This field might be missing from older persisted sessions
              if (!diskSession.workspaceId && session.workspaceId) {
                logger.debug('Adding missing workspaceId to loaded session', {
                  agentId: session.id,
                  workspaceId: session.workspaceId,
                });
                diskSession.workspaceId = session.workspaceId;
              }

              // Defensive: ensure critical fields exist on the loaded session
              // This prevents saveSession from silently dropping the save
              if (!diskSession.status) {
                logger.warn('Loaded disk session missing status, defaulting to Idle', {
                  agentId: session.id,
                });
                diskSession.status = AgentStatus.Idle;
              }
              if (!diskSession.messages) {
                diskSession.messages = session.messages || [];
              }

              // Clear streaming flags on the disk session
              diskSession.isStreaming = false;
              if (diskSession.messages) {
                for (const message of diskSession.messages) {
                  if (message.isStreaming) {
                    logger.info('Clearing stale streaming state for message (from disk)', {
                      agentId: session.id,
                      messageId: message.id,
                    });
                    message.isStreaming = false;
                  }
                }
              }

              // Update the frontend's in-memory store with the loaded data
              sessionStore.addSession(diskSession);

              // Persist the updated session (with cleared streaming flags)
              await persistenceService.saveSession(diskSession, diskSession.workspaceId, {
                immediate: true,
              });
              logger.info(
                'Persisted session after clearing stale streaming state (preserved disk data)',
                {
                  agentId: session.id,
                  messageCount: diskSession.messages?.length || 0,
                },
              );
            } else {
              // Fallback: if we can't load from disk, just clear streaming state in memory
              // This is the old behavior which may lose data, but at least unblocks the UI
              logger.warn('Could not load session from disk, falling back to memory-only cleanup', {
                agentId: session.id,
                error: loadResult?.error,
              });

              session.isStreaming = false;
              sessionStore.addSession(session);

              if (session.messages) {
                for (const message of session.messages) {
                  if (message.isStreaming) {
                    logger.info('Clearing stale streaming state for message', {
                      agentId: session.id,
                      messageId: message.id,
                    });
                    sessionStore.updateMessage(session.id, message.id, {
                      isStreaming: false,
                    });
                  }
                }
              }

              await persistenceService.saveSession(session, session.workspaceId, {
                immediate: true,
              });
            }
          } catch (loadError) {
            logger.warn('Failed to load session from disk during stale streaming cleanup', {
              agentId: session.id,
              error: loadError,
            });

            // Fallback: clear streaming state in memory only
            session.isStreaming = false;
            sessionStore.addSession(session);
          }

          // Dispatch session-updated event so ChatService syncs its streaming state
          // This is critical - without this event, ChatService continues to think
          // the agent is streaming and queues new messages instead of sending them
          // Defer dispatch so initializeChat()/setupStreaming() has time
          // to register the sessionUpdatedHandler. initializeChat is async and may not
          // have finished calling setupStreaming() when reconnectToBackendStreams runs.
          const staleSessionId = session.id;
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent(`agent:session-updated:${staleSessionId}`));
          }, 100);
        }
      }

      if (activeStreamAgentIds.size === 0) {
        logger.debug('No active streams found on backend', { result });
        return [];
      }

      logger.info('Found active streams on backend', {
        count: activeStreamAgentIds.size,
        agentIds: Array.from(activeStreamAgentIds),
      });

      // Re-register handlers for each active stream
      for (const stream of result.data) {
        const { agentId, accumulatedContent, workspaceId: streamWorkspaceId } = stream;

        // Check if we already have a handler for this agent
        // Use let instead of const because we may update this after calling ensureStreamHandler
        let handlerAlreadyExists = this.activeStreamHandlers.has(agentId);

        // Get the session from the store - use workspace-aware lookup since the streaming agent
        // might be in a different workspace than the one currently being viewed
        // This is critical for cross-workspace streaming scenarios
        let session: AgentSession | undefined;
        if (streamWorkspaceId) {
          session = sessionStore.getSessionForWorkspace(streamWorkspaceId, agentId);
          logger.info('Got session using workspace-aware lookup', {
            agentId,
            streamWorkspaceId,
            hasSession: !!session,
          });
        }
        // Fallback to current workspace lookup if no workspace ID provided
        if (!session) {
          session = sessionStore.getSession(agentId);
        }

        // Find the streaming message if it exists, or fall back to the last assistant message
        // The message might not have isStreaming=true if the page refreshed before beforeunload could save
        let existingMessage: AgentMessage | undefined;
        if (session?.messages) {
          // First try to find a message explicitly marked as streaming
          existingMessage = session.messages.find(
            (m: any) => m.role === 'assistant' && m.isStreaming === true,
          );

          // If no streaming message found, use the last assistant message
          // This is the message that was being streamed when the refresh happened
          if (!existingMessage) {
            const assistantMessages = session.messages.filter((m: any) => m.role === 'assistant');
            if (assistantMessages.length > 0) {
              existingMessage = assistantMessages[assistantMessages.length - 1];
              logger.info(
                'Using last assistant message as streaming message (not marked as streaming)',
                {
                  agentId,
                  messageId: existingMessage?.id,
                  contentBlocksCount: existingMessage?.contentBlocks?.length || 0,
                },
              );
            }
          }
        }

        // If the backend has accumulated content, use it instead of the on-disk content
        // This ensures we don't lose chunks that were sent between page unload and handler re-registration
        if (accumulatedContent && existingMessage) {
          const backendContentBlocksCount = accumulatedContent.contentBlocks?.length || 0;
          const existingContentBlocksCount = existingMessage.contentBlocks?.length || 0;

          // Calculate total text length across ALL text blocks in existing message
          const existingTextLength =
            existingMessage.contentBlocks
              ?.filter((b: ContentBlock) => b.type === 'text')
              .reduce((sum: number, b: ContentBlock) => sum + ((b as any).text?.length || 0), 0) ||
            0;
          const backendContentLength = accumulatedContent.content?.length || 0;

          logger.info('Comparing backend accumulated content with existing message', {
            agentId,
            backendContentBlocksCount,
            existingContentBlocksCount,
            backendContentLength,
            existingTextLength,
          });

          // Use backend content ONLY if it clearly has more content than the frontend.
          // This prevents replacing good frontend content with stale backend data when switching tabs.
          //
          // The backend should be used when:
          // 1. It has more blocks AND more/equal text (clearly newer)
          // 2. It has equal blocks AND more text (text grew)
          // 3. It has more blocks AND equal text (new blocks added)
          //
          // The frontend should be kept when:
          // 1. Backend has fewer blocks (backend is stale or different message)
          // 2. Backend has fewer text chars AND fewer/equal blocks (backend is stale)
          const backendHasMoreBlocks = backendContentBlocksCount > existingContentBlocksCount;
          const backendHasMoreText = backendContentLength > existingTextLength;
          const backendHasFewerBlocks = backendContentBlocksCount < existingContentBlocksCount;

          // Only use backend if it has more blocks OR more text, AND doesn't have fewer blocks
          // Having fewer blocks is a strong signal the backend data is stale or from a different message
          const shouldUseBackend =
            (backendHasMoreBlocks || backendHasMoreText) && !backendHasFewerBlocks;

          if (shouldUseBackend) {
            logger.info('Using backend accumulated content (has more content than frontend)', {
              agentId,
              streamWorkspaceId,
              backendContentBlocksCount,
              existingContentBlocksCount,
              backendContentLength,
              existingTextLength,
              backendHasMoreBlocks,
              backendHasMoreText,
              backendHasFewerBlocks,
            });

            // Update the existing message with the backend's accumulated content
            // Normalize to merge adjacent text blocks that the backend may have fragmented
            existingMessage = {
              ...existingMessage,
              contentBlocks: normalizeContentBlocks(accumulatedContent.contentBlocks),
              isStreaming: true,
            };

            // Also update the session store so the UI reflects this immediately
            // Use workspace-aware update since the streaming agent might be in a different workspace
            if (streamWorkspaceId) {
              sessionStore.updateMessageForWorkspace(
                streamWorkspaceId,
                agentId,
                existingMessage.id,
                {
                  contentBlocks: accumulatedContent.contentBlocks,
                  isStreaming: true,
                },
              );
            } else {
              sessionStore.updateMessage(agentId, existingMessage.id, {
                contentBlocks: accumulatedContent.contentBlocks,
                isStreaming: true,
              });
            }

            // Note: session-updated event is dispatched once at the end of this loop iteration
            // (after all state updates are complete) to ensure ChatService syncs its state.
          } else {
            logger.info('Keeping existing content (backend has fewer blocks or less content)', {
              agentId,
              backendContentBlocksCount,
              existingContentBlocksCount,
              backendContentLength,
              existingTextLength,
              backendHasMoreBlocks,
              backendHasMoreText,
              backendHasFewerBlocks,
            });
          }
        }

        // Only register handler and mark messages if handler doesn't already exist.
        // But ALWAYS sync accumulated content and streaming state (below) to ensure
        // the frontend has the full response after workspace switches.
        if (!handlerAlreadyExists) {
          logger.info('Re-registering stream handler for backend active stream', {
            agentId,
            hasSession: !!session,
            hasExistingMessage: !!existingMessage,
            existingMessageId: existingMessage?.id,
            existingContentBlocksCount: existingMessage?.contentBlocks?.length || 0,
            hasBackendAccumulatedContent: !!accumulatedContent,
          });

          // Mark the existing message as streaming if it isn't already
          // This is important so that the stream handler updates the existing message
          // instead of creating a new one
          if (existingMessage && !existingMessage.isStreaming && session) {
            logger.info('Marking existing message as streaming for reconnection', {
              agentId,
              messageId: existingMessage.id,
            });
            sessionStore.updateMessage(agentId, existingMessage.id, {
              isStreaming: true,
            });
          }

          // Register the stream handler with the workspace ID for cross-workspace handling
          // CRITICAL: Prefer streamWorkspaceId from the backend's active stream info over session.workspaceId
          // The session might not be loaded if the user switched workspaces, but the backend
          // always knows which workspace the stream belongs to. This fixes the issue where
          // completing streams would fail to load/update the session because workspaceId was undefined.
          const result = this.ensureStreamHandler(agentId, {
            existingMessage,
            workspaceId: streamWorkspaceId || (session?.workspaceId ? String(session.workspaceId) : undefined),
          });
          handlerAlreadyExists = !result.created;
        } else {
          logger.info('Stream handler already exists, syncing accumulated content only', {
            agentId,
            hasAccumulatedContent: !!accumulatedContent,
            streamWorkspaceId,
          });

          // Even when the handler already exists, we must ensure the unified
          // state store reflects isStreaming: true. The handler may have been pre-registered
          // by restoreSession() (with workspaceId: undefined), and the store never got updated.
          // Without this, ChatPanel mounts and finds isStreaming: false in the store.
          if (streamWorkspaceId) {
            sessionStore.setStreamingForWorkspace(streamWorkspaceId, agentId, true);
          } else {
            sessionStore.setStreaming(agentId, true);
          }
        }

        // Only update session object for new handlers.
        // For existing handlers, the streaming store state is now always set above.
        if (!handlerAlreadyExists) {
          // Explicitly set streaming.active via setStreaming/setStreamingForWorkspace.
          // sessionStore.addSession() calls setAgent() which PRESERVES existing streaming.active
          // to prevent stale disk data from resetting active streams. Since the backend confirmed
          // this agent IS actively streaming, we must explicitly set streaming.active. Without this,
          // streaming.active stays false after HMR/page refresh, allowing the user to send a new
          // message that bypasses the isStreaming guard and clears the in-progress streaming response.
          if (streamWorkspaceId) {
            sessionStore.setStreamingForWorkspace(streamWorkspaceId, agentId, true);
          } else {
            sessionStore.setStreaming(agentId, true);
          }

          // Update the session to mark it as streaming if not already
          if (session && !session.isStreaming) {
            // Re-read session from store to pick up any message updates
            // made by updateMessageForWorkspace above. The local `session` variable was
            // read before those updates and has stale message content blocks.
            const freshSession = streamWorkspaceId
              ? sessionStore.getSessionForWorkspace(streamWorkspaceId, agentId)
              : sessionStore.getSession(agentId);
            const sessionToUpdate = freshSession || session;
            sessionToUpdate.isStreaming = true;
            sessionStore.addSession(sessionToUpdate);
          }
        }

        // Always dispatch session-updated event so ChatService syncs its state.
        // For new handlers: this was previously only dispatched when !session.isStreaming.
        // For existing handlers: this is the key fix for workspace switching.
        // When switching workspaces, the ChatService may have been initialized with stale
        // messages from disk. This event triggers sessionUpdatedHandler which syncs
        // the ChatService's localStreamingContent with the latest sessionStore data,
        // ensuring the full response is displayed instead of just the tail end.
        logger.info('Dispatching session-updated event for active backend stream', {
          agentId,
          handlerAlreadyExists,
        });
        // Note: ensureStreamHandler already dispatches session-updated, but we dispatch again here
        // to ensure it's sent after the streaming state updates above.
        // Defer dispatch so initializeChat()/setupStreaming() has time
        // to register the sessionUpdatedHandler. initializeChat is async and may not
        // have finished calling setupStreaming() when reconnectToBackendStreams runs.
        const activeAgentId = agentId;
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent(`agent:session-updated:${activeAgentId}`));
        }, 100);
      }

      // Start a 10-second safety timeout to force-clear any remaining stale
      // streaming indicators. If reconnectToBackendStreams didn't clear isStreaming
      // for some sessions (e.g., due to timing issues), this ensures the UI
      // doesn't show a false "thinking" state indefinitely.
      this.startStreamingSafetyTimeout(activeStreamAgentIds);

      // Return the list of agent IDs with active streams
      return Array.from(activeStreamAgentIds);
    } catch (error) {
      logger.error('Failed to reconnect to backend streams', error as Error);
      return [];
    }
  }

  /**
   * Safety timeout: 10 seconds after reconnectToBackendStreams(), re-check all
   * sessions. If any still have isStreaming=true but the backend confirms no
   * active stream, force-clear isStreaming to prevent stuck indicators.
   */
  private startStreamingSafetyTimeout(confirmedActiveIds: Set<string>): void {
    // Clear any existing safety timeout
    if (this.streamingSafetyTimeout) {
      clearTimeout(this.streamingSafetyTimeout);
    }

    this.streamingSafetyTimeout = setTimeout(async () => {
      this.streamingSafetyTimeout = null;

      try {
        // Re-query the backend for currently active streams
        const result = await window.electronAPI?.invoke('agent:get-active-streams');
        const currentlyActive = new Set<string>(
          result?.success && result?.data ? result.data.map((s: any) => s.agentId) : [],
        );

        // Check all sessions across workspaces for stale streaming state
        const allSessions = sessionStore.getAllSessionsAcrossWorkspaces();
        let clearedCount = 0;

        for (const session of allSessions) {
          if (session.isStreaming && !currentlyActive.has(session.id)) {
            logger.info('Safety timeout: force-clearing stale streaming state', {
              agentId: session.id,
              workspaceId: session.workspaceId,
            });

            // Clear streaming state
            if (session.workspaceId) {
              sessionStore.setStreamingForWorkspace(session.workspaceId, session.id, false);
            } else {
              sessionStore.setStreaming(session.id, false);
            }

            // Clear streaming flag on session object
            session.isStreaming = false;
            sessionStore.addSession(session);

            // Dispatch session-updated event so UI components sync
            window.dispatchEvent(new CustomEvent(`agent:session-updated:${session.id}`));
            clearedCount++;
          }
        }

        if (clearedCount > 0) {
          logger.info('Safety timeout: cleared stale streaming states', {
            clearedCount,
            activeStreamCount: currentlyActive.size,
          });
        }
      } catch (error) {
        logger.error('Safety timeout: failed to check streaming states', error as Error);
      }
    }, 10_000);
  }

  /**
   * Idempotent method to ensure a stream handler is registered for an agent.
   * This is the primary entry point for all stream handler registration.
   *
   * Consolidates common logic from 10 call sites:
   * - Checks if handler already exists (idempotent)
   * - Resolves workspaceId from opts or sessionStore
   * - Registers the IPC handler
   * - Dispatches agent:session-updated event
   *
   * @param agentId - The agent ID to register the handler for
   * @param opts - Optional configuration
   * @returns Object with created flag and channel name
   */
  ensureStreamHandler(
    agentId: string,
    opts?: EnsureStreamHandlerOpts,
  ): { created: boolean; channel: string } {
    const { existingMessage, workspaceId: providedWorkspaceId, forceReregister } = opts || {};

    // Validate agentId
    if (!agentId) {
      logger.warn('Attempted to ensure stream handler with undefined agentId, ignoring');
      return { created: false, channel: '' };
    }

    const streamChannel = `agent:stream:${agentId}`;

    // Check if handler already exists (idempotent)
    if (this.activeStreamHandlers.has(agentId) && !forceReregister) {
      logger.debug('Stream handler already exists for agent', { agentId, streamChannel });
      return { created: false, channel: streamChannel };
    }

    // If forceReregister, clear the stale entry first
    if (forceReregister && this.activeStreamHandlers.has(agentId)) {
      logger.debug('Force-reregistering stream handler, clearing stale entry', { agentId });
      this.activeStreamHandlers.delete(agentId);
      this.pendingStreamRegistrations.delete(agentId);
    }

    // Resolve workspace ID
    const resolvedWorkspaceId = providedWorkspaceId || sessionStore.getSession(agentId)?.workspaceId;

    // Call the core registration logic
    this.registerStreamHandlerForSession(agentId, existingMessage, resolvedWorkspaceId);

    // Defer dispatch so initializeChat()/setupStreaming() has time
    // to register the sessionUpdatedHandler. initializeChat is async and may not
    // have finished calling setupStreaming() when ensureStreamHandler runs.
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent(`agent:session-updated:${agentId}`));
    }, 100);

    return { created: true, channel: streamChannel };
  }

  /**
   * Register a stream handler for a session that was streaming when the page reloaded.
   * This allows the frontend to continue receiving chunks from the backend.
   *
   * DEPRECATED: Use ensureStreamHandler() instead. This method is kept for backward compatibility.
   *
   * @param agentId - The agent ID to register the handler for
   * @param existingMessage - Optional existing message to continue streaming into
   * @param workspaceId - Optional workspace ID for cross-workspace stream handling
   */
  registerStreamHandlerForSession(
    agentId: string,
    existingMessage?: AgentMessage,
    workspaceId?: string,
  ): void {
    // Validate agentId before proceeding - this prevents registering handlers for undefined agents
    if (!agentId) {
      logger.warn('Attempted to register stream handler with undefined agentId, ignoring');
      return;
    }

    // Resolve workspace ID for cross-workspace stream handling
    const resolvedWorkspaceId = workspaceId || sessionStore.getSession(agentId)?.workspaceId;
    const streamChannel = `agent:stream:${agentId}`;

    logger.debug('Registering stream handler for restored session', {
      agentId,
      streamChannel,
      hasExistingMessage: !!existingMessage,
      existingContentBlocksCount: existingMessage?.contentBlocks?.length || 0,
      providedWorkspaceId: workspaceId,
      resolvedWorkspaceId,
    });

    // Check if we already have a handler for this agent
    if (this.activeStreamHandlers.has(agentId)) {
      logger.debug('Stream handler already exists for agent', { agentId });
      return;
    }

    // Check if registration is already in progress (prevents race conditions when
    // multiple agent:created events arrive in quick succession)
    if (this.pendingStreamRegistrations.has(agentId)) {
      logger.debug('Stream handler registration already in progress for agent', { agentId });
      return;
    }

    // Mark registration as in progress
    this.pendingStreamRegistrations.add(agentId);

    // Check if electronAPI is available
    if (!window.electronAPI) {
      logger.error('window.electronAPI is not available for stream handler registration', {
        agentId,
      });
      this.pendingStreamRegistrations.delete(agentId);
      return;
    }

    // NOTE: We intentionally do NOT call removeAllListeners(streamChannel) here.
    // In production, page refresh resets the preload listener registry, so there are no
    // orphaned IPC listeners to clean up. In dev/HMR the registry persists, but that's
    // a dev-only concern. Using removeAllListeners here would nuke any listener that
    // AgentSubscriptions.svelte already registered on the same channel.
    logger.debug('Registering new stream handler (no existing handler in Map)', {
      agentId,
      streamChannel,
    });

    // Initialize state from existing message if available
    let textBuffer = '';
    let orderedItems: any[] = [];

    // If we have an existing message, extract its content to initialize state
    if (existingMessage?.contentBlocks) {
      for (const block of existingMessage.contentBlocks) {
        if (block.type === 'text') {
          orderedItems.push({
            type: 'text',
            content: block.text || '',
            sequence: orderedItems.length,
          });
        } else {
          orderedItems.push({
            type: 'block',
            content: block,
            sequence: orderedItems.length,
          });
        }
      }
    }

    let chunkCount = 0;
    // Track the current streamId to detect when a NEW stream starts.
    // If we receive chunks with a different streamId, it means a new message response
    // is streaming and we need to reset orderedItems/textBuffer to avoid appending
    // new content to old content (which causes response duplication).
    let currentStreamId: string | undefined = undefined;

    const handlerSessionId = agentId;

    // Helper function to build ordered content blocks (same as in sendMessage)
    const buildOrderedContentBlocks = (items: any[], buffer: string): ContentBlock[] => {
      const blocks: ContentBlock[] = [];
      let accumulatedText = '';

      for (const item of items) {
        if (item.type === 'text') {
          accumulatedText += item.content;
        } else if (item.type === 'block') {
          if (accumulatedText) {
            blocks.push({ type: 'text' as const, text: accumulatedText });
            accumulatedText = '';
          }
          blocks.push(item.content);
        }
      }

      if (accumulatedText) {
        blocks.push({ type: 'text' as const, text: accumulatedText });
      }

      if (buffer) {
        const lastBlock = blocks[blocks.length - 1];
        if (lastBlock && lastBlock.type === 'text') {
          lastBlock.text += buffer;
        } else {
          blocks.push({ type: 'text' as const, text: buffer });
        }
      }

      return blocks;
    };

    const streamHandler = (data: any) => {
      chunkCount++;
      // Log first chunk at INFO level to confirm handler is receiving data
      if (chunkCount === 1) {
        logger.info('Restored stream handler - first chunk received', {
          callNumber: chunkCount,
          dataType: data?.type,
          agentId,
          dataLength: data?.data?.length,
          workspaceId: resolvedWorkspaceId,
        });
      } else {
        logger.debug('Restored stream handler called', {
          callNumber: chunkCount,
          dataType: data?.type,
          agentId,
        });
      }

      // Detect when a new stream starts and reset accumulated state.
      // This prevents response duplication when this handler (registered for reconnection
      // with existingMessage content) receives chunks from a NEW message's stream.
      // Without this reset, new response content would be appended to old content.
      if (data.streamId && data.streamId !== currentStreamId) {
        if (currentStreamId !== undefined) {
          logger.info('Stream ID changed - resetting accumulated state for new message', {
            agentId,
            oldStreamId: currentStreamId,
            newStreamId: data.streamId,
            oldOrderedItemsCount: orderedItems.length,
            oldTextBufferLength: textBuffer.length,
          });
          // Reset all accumulated state for the new stream
          textBuffer = '';
          orderedItems = [];
          chunkCount = 1; // Reset chunk count for the new stream

          // Clear isStreaming flag on ALL old assistant messages.
          // Without this, the chunk/content-blocks handlers find the OLD message via
          // `isStreaming === true` and write new stream content into the PREVIOUS response
          // instead of creating a fresh message for the current response.
          const resetSession = resolvedWorkspaceId
            ? sessionStore.getSessionForWorkspace(resolvedWorkspaceId, agentId)
            : sessionStore.getSession(agentId);
          if (resetSession?.messages) {
            for (const msg of resetSession.messages) {
              if (msg.role === 'assistant' && msg.isStreaming) {
                logger.info('Clearing stale isStreaming flag on old assistant message', {
                  agentId,
                  messageId: msg.id,
                  reason: 'new_stream_id_detected',
                });
                if (resolvedWorkspaceId) {
                  sessionStore.updateMessageForWorkspace(resolvedWorkspaceId, agentId, msg.id, {
                    isStreaming: false,
                  });
                } else {
                  sessionStore.updateMessage(agentId, msg.id, {
                    isStreaming: false,
                  });
                }
              }
            }
          }
        }
        currentStreamId = data.streamId;
      }

      // Helper to get session in a workspace-aware way
      // This is critical for cross-workspace streaming - when user switches workspaces,
      // getSession() returns undefined because it only looks in the current workspace.
      // getSessionForWorkspace() looks in the correct workspace.
      const getStreamSession = () =>
        resolvedWorkspaceId
          ? sessionStore.getSessionForWorkspace(resolvedWorkspaceId, agentId)
          : sessionStore.getSession(agentId);

      try {
        if (data.type === 'chunk') {
          // Accumulate text
          textBuffer += data.data || '';

          // Update sessionStore BEFORE dispatching DOM event to ChatService.
          // Previously, the DOM event was dispatched first, causing ChatService's
          // flushChunkUpdate() to read stale sessionStore data and create a streaming
          // message with a different ID than what AgentService creates here.
          let streamSession = getStreamSession();

          // If no session exists, create a minimal one so stream data
          // isn't silently lost. This happens when the agent:created event didn't
          // successfully create a session in the frontend store (e.g., for delegated
          // agents where IPC delivery via mainWindow may fail silently).
          // Without this, textBuffer accumulates data in the closure but the
          // sessionStore is never updated, so the UI shows nothing until refresh.
          if (!streamSession && resolvedWorkspaceId) {
            // Preserve existing messages from unified state store
            // before creating minimal session. Without this, creating a session with
            // messages: [] destroys the full message history (DATA LOSS).
            let existingMessages: AgentMessage[] = [];
            let existingName = 'Task Agent';
            try {
              const existingAgents = unifiedStateStore.getAgentsForWorkspace(
                WorkspaceId(resolvedWorkspaceId),
              );
              const existingAgent = existingAgents.find((a) => String(a.id) === agentId);
              if (existingAgent?.messages?.length) {
                existingMessages = existingAgent.messages;
                existingName = existingAgent.name || existingName;
                logger.info(
                  'Preserved existing messages for minimal session from unified state store',
                  {
                    agentId,
                    messageCount: existingMessages.length,
                  },
                );
              }
            } catch (err) {
              logger.warn('Could not load existing messages for minimal session', {
                agentId,
                error: err,
              });
            }

            logger.warn(
              'No session found for streaming agent on chunk, creating minimal session',
              {
                agentId,
                resolvedWorkspaceId,
                preservedMessageCount: existingMessages.length,
              },
            );
            const minimalSession: AgentSession = {
              id: agentId as any,
              backendSessionId: agentId as any,
              workspaceId: WorkspaceId(resolvedWorkspaceId),
              name: existingName,
              status: AgentStatus.Active,
              messages: existingMessages,
              createdAt: new Date(),
              updatedAt: new Date(),
              isStreaming: true,
            };
            sessionStore.addSession(minimalSession);
            streamSession = getStreamSession();
          }

          if (streamSession && streamSession.messages) {
            const hasStreamingMessage = streamSession.messages.some(
              (m) => m.role === 'assistant' && m.isStreaming,
            );

            if (!hasStreamingMessage) {
              // Create new streaming message
              const assistantMessage: AgentMessage = {
                id: createMessageId(uuidv4()),
                role: 'assistant' as const,
                contentBlocks: buildOrderedContentBlocks(orderedItems, textBuffer),
                timestamp: new Date().toISOString(),
                isStreaming: true,
              };

              const updatedSession = {
                ...streamSession,
                messages: [...streamSession.messages, assistantMessage],
              };

              logger.info('Updated session messages', {
                agentId,
                updatedMessageCount: updatedSession.messages.length,
                updatedMessageRoles: updatedSession.messages.map((m) => m.role),
              });

              sessionStore.addSession(updatedSession);
            } else {
              // Update existing streaming message
              // Use workspace-aware update to handle cross-workspace streaming
              // Without this, updates fail when user switches away from the chat
              // Find the actively streaming assistant message by isStreaming flag
              // instead of blindly taking the last message (which could be wrong if ordering changes)
              const streamingMsg = streamSession.messages.find(
                (m) => m.role === 'assistant' && m.isStreaming,
              );
              const lastMessage =
                streamingMsg || streamSession.messages[streamSession.messages.length - 1];
              if (lastMessage && lastMessage.role === 'assistant') {
                if (resolvedWorkspaceId) {
                  sessionStore.updateMessageForWorkspace(
                    resolvedWorkspaceId,
                    agentId,
                    lastMessage.id,
                    {
                      contentBlocks: buildOrderedContentBlocks(orderedItems, textBuffer),
                    },
                  );
                } else {
                  sessionStore.updateMessage(agentId, lastMessage.id, {
                    contentBlocks: buildOrderedContentBlocks(orderedItems, textBuffer),
                  });
                }
              }
            }
          }

          // Forward to ChatService AFTER sessionStore is updated
          // This ensures ChatService reads correct data when flushChunkUpdate() runs
          const streamEvent = new CustomEvent(`agent:stream:${handlerSessionId}`, {
            detail: { type: 'chunk', content: data.data, sessionId: handlerSessionId },
          });
          window.dispatchEvent(streamEvent);
        } else if (data.type === 'content-blocks' && Array.isArray(data.data)) {
          // Flush text buffer first
          if (textBuffer) {
            orderedItems.push({ type: 'text', content: textBuffer, sequence: orderedItems.length });
            textBuffer = '';
          }

          // Add new blocks
          for (const newBlock of data.data) {
            if (newBlock.type === 'tool_use') {
              // For tool_use blocks, check by 'id' field
              const existingBlock = orderedItems.find(
                (item) =>
                  item.type === 'block' &&
                  item.content.type === 'tool_use' &&
                  (item.content as any).id === newBlock.id,
              );
              if (!existingBlock) {
                orderedItems.push({
                  type: 'block',
                  content: newBlock,
                  sequence: orderedItems.length,
                });
              } else {
                // Update existing block with follow-up data (skeleton → descriptive)
                existingBlock.content = newBlock;
              }
            } else if (newBlock.type === 'tool_result') {
              // For tool_result blocks, check by 'tool_use_id' field
              const existingBlock = orderedItems.find(
                (item) =>
                  item.type === 'block' &&
                  item.content.type === 'tool_result' &&
                  (item.content as any).tool_use_id === newBlock.tool_use_id,
              );
              if (!existingBlock) {
                orderedItems.push({
                  type: 'block',
                  content: newBlock,
                  sequence: orderedItems.length,
                });
              }
            } else if (newBlock.type === 'text') {
              // IMPORTANT: Text blocks should NOT be added via content-blocks events.
              // Text is accumulated via 'chunk' events and stored in textBuffer.
              // Adding text blocks here would duplicate text already in textBuffer.
              // This matches the behavior in sendMessage's content-blocks handler.
              logger.warn(
                'Received unexpected text block in content-blocks event (registerStreamHandler) - ignoring to prevent duplication',
                {
                  textLength: (newBlock.text || '').length,
                  orderedItemsCount: orderedItems.length,
                },
              );
            } else {
              orderedItems.push({
                type: 'block',
                content: newBlock,
                sequence: orderedItems.length,
              });
            }
          }

          // Update session using workspace-aware method
          // Use updateMessageForWorkspace instead of addSession
          // addSession goes through setAgent's preserveStreamingMessages logic which
          // compares message counts. Since adding a tool doesn't change the count
          // (just updates contentBlocks), setAgent would preserve OLD messages without the tool.
          // updateMessageForWorkspace directly updates the message, avoiding this issue.
          const streamSession = getStreamSession();
          if (streamSession && streamSession.messages) {
            const msgIndex = streamSession.messages.findIndex(
              (m: any) => m.role === 'assistant' && m.isStreaming,
            );
            if (msgIndex >= 0) {
              const lastMessage = streamSession.messages[msgIndex];
              if (resolvedWorkspaceId) {
                sessionStore.updateMessageForWorkspace(
                  resolvedWorkspaceId,
                  agentId,
                  lastMessage.id,
                  {
                    contentBlocks: buildOrderedContentBlocks(orderedItems, textBuffer),
                  },
                );
              } else {
                sessionStore.updateMessage(agentId, lastMessage.id, {
                  contentBlocks: buildOrderedContentBlocks(orderedItems, textBuffer),
                });
              }
            }
          }

          // Forward to ChatService
          const contentBlocksEvent = new CustomEvent(`agent:stream:${handlerSessionId}`, {
            detail: { type: 'content-blocks', data: data.data },
          });
          window.dispatchEvent(contentBlocksEvent);
        } else if (data.type === 'complete') {
          logger.info('Stream complete - using backend message', {
            agentId,
            streamChannel,
            hasBackendMessage: !!data.message,
            backendMessageId: data.message?.id,
            orderedItemsCount: orderedItems.length,
            textBufferLength: textBuffer.length,
            workspaceId: resolvedWorkspaceId,
          });

          // Use the backend's authoritative message instead of building our own
          // The backend has already persisted this message, so we just update the UI state
          const backendMessage = data.message;

          // Mark streaming as complete in sessionStore using workspace-aware method
          const streamSession = getStreamSession();
          if (streamSession && streamSession.messages && streamSession.messages.length > 0) {
            const updatedSession = { ...streamSession, messages: [...streamSession.messages] };
            // Find the streaming assistant message by isStreaming flag (consistent with
            // content-blocks handler and sendMessage complete handler). Falls back to
            // position-based check if no streaming message found (e.g., if already marked complete).
            let msgIndex = updatedSession.messages.findIndex(
              (m) => m.role === 'assistant' && m.isStreaming,
            );
            if (msgIndex < 0) {
              msgIndex = updatedSession.messages.findIndex(
                (m, idx) => m.role === 'assistant' && idx === updatedSession.messages.length - 1,
              );
            }

            if (msgIndex >= 0) {
              if (backendMessage) {
                // Compare backend message with existing content - use whichever has more
                // The backend message may be incomplete if the accumulator was cleared or had issues
                const existingBlocks = updatedSession.messages[msgIndex].contentBlocks || [];
                const backendBlocks = backendMessage.contentBlocks || [];

                // Calculate content length for comparison (more accurate than block count)
                const getContentLength = (blocks: ContentBlock[]) =>
                  blocks.reduce((total, block) => {
                    if (block.type === 'text' && 'text' in block) {
                      return total + (block.text?.length || 0);
                    }
                    return total + 1; // Count non-text blocks as 1
                  }, 0);

                const existingLength = getContentLength(existingBlocks);
                const backendLength = getContentLength(backendBlocks);

                // Use backend content if it has more, otherwise keep existing
                const useBackendContent =
                  backendLength >= existingLength && backendBlocks.length > 0;

                logger.info('Stream complete - comparing content sources', {
                  agentId,
                  existingBlockCount: existingBlocks.length,
                  existingContentLength: existingLength,
                  backendBlockCount: backendBlocks.length,
                  backendContentLength: backendLength,
                  useBackendContent,
                });

                updatedSession.messages[msgIndex] = {
                  ...updatedSession.messages[msgIndex],
                  id: backendMessage.id || updatedSession.messages[msgIndex].id,
                  isStreaming: false,
                  contentBlocks: useBackendContent
                    ? normalizeContentBlocks(backendBlocks)
                    : existingBlocks,
                  // Merge metadata from backend message (includes stopReason for interrupted streams)
                  metadata: {
                    ...updatedSession.messages[msgIndex].metadata,
                    ...backendMessage.metadata,
                  },
                };
              } else {
                // No backend message (stream was interrupted) - preserve accumulated content
                // Build content blocks from orderedItems + textBuffer
                const preservedContentBlocks = buildOrderedContentBlocks(orderedItems, textBuffer);
                logger.info('Stream interrupted - preserving accumulated content', {
                  agentId,
                  orderedItemsCount: orderedItems.length,
                  textBufferLength: textBuffer.length,
                  preservedBlocksCount: preservedContentBlocks.length,
                  existingBlocksCount: updatedSession.messages[msgIndex].contentBlocks?.length || 0,
                });

                // Only update if we have accumulated content, otherwise keep existing
                if (preservedContentBlocks.length > 0) {
                  updatedSession.messages[msgIndex] = {
                    ...updatedSession.messages[msgIndex],
                    isStreaming: false,
                    contentBlocks: preservedContentBlocks,
                  };
                } else {
                  // No accumulated content - just mark as not streaming, keep existing content
                  updatedSession.messages[msgIndex] = {
                    ...updatedSession.messages[msgIndex],
                    isStreaming: false,
                  };
                }
              }
              // CRITICAL: Set streaming to false BEFORE calling addSession
              // Otherwise, unifiedStateStore.setAgent's preserveStreamingMessages logic
              // will preserve old streaming messages instead of using our updated messages
              // Use workspace-aware method for cross-workspace stream completion
              if (resolvedWorkspaceId) {
                sessionStore.setStreamingForWorkspace(resolvedWorkspaceId, agentId, false);
              } else {
                sessionStore.setStreaming(agentId, false);
              }
              // Also set isStreaming on the session object itself
              // Otherwise, setAgent will see session.isStreaming as true and
              // overwrite the streaming.active state we just set to false
              updatedSession.isStreaming = false;
              // Ensure the session has the correct workspaceId for addSession to work correctly
              if (resolvedWorkspaceId && !updatedSession.workspaceId) {
                updatedSession.workspaceId = WorkspaceId(resolvedWorkspaceId);
              }
              sessionStore.addSession(updatedSession);

              // Update unified state store so BackgroundAgentExecutor subscriptions fire
              if (resolvedWorkspaceId) {
                unifiedStateStore.setAgent(WorkspaceId(resolvedWorkspaceId), updatedSession);
              }

              // Persist completed session to frontend disk so it survives refresh
              // The backend has also persisted, but restoreWithoutBackend loads from frontend persistence
              if (resolvedWorkspaceId) {
                persistenceService.saveSession(updatedSession, resolvedWorkspaceId, { immediate: true })
                  .catch((err) => logger.error('Failed to persist completed session', { agentId, error: err }));
              }
            } else if (backendMessage) {
              // No existing assistant message at the end, but we have a backend message
              // This can happen when the user switches away before any chunks were processed
              // Add the backend message to the session
              logger.info('No existing assistant message - adding backend message to session', {
                agentId,
                backendMessageId: backendMessage.id,
                existingMessageCount: updatedSession.messages.length,
                lastMessageRole: updatedSession.messages[updatedSession.messages.length - 1]?.role,
              });

              const newAssistantMessage: AgentMessage = {
                id: backendMessage.id || createMessageId(uuidv4()),
                role: 'assistant' as const,
                contentBlocks: backendMessage.contentBlocks || [],
                timestamp: backendMessage.timestamp || new Date().toISOString(),
                isStreaming: false,
              };

              updatedSession.messages.push(newAssistantMessage);
              // Use workspace-aware method for cross-workspace stream completion
              if (resolvedWorkspaceId) {
                sessionStore.setStreamingForWorkspace(resolvedWorkspaceId, agentId, false);
              } else {
                sessionStore.setStreaming(agentId, false);
              }
              updatedSession.isStreaming = false;
              // Ensure the session has the correct workspaceId for addSession to work correctly
              if (resolvedWorkspaceId && !updatedSession.workspaceId) {
                updatedSession.workspaceId = WorkspaceId(resolvedWorkspaceId);
              }
              sessionStore.addSession(updatedSession);

              // Update unified state store so BackgroundAgentExecutor subscriptions fire
              if (resolvedWorkspaceId) {
                unifiedStateStore.setAgent(WorkspaceId(resolvedWorkspaceId), updatedSession);
              }

              // Persist completed session to frontend disk so it survives refresh
              if (resolvedWorkspaceId) {
                persistenceService.saveSession(updatedSession, resolvedWorkspaceId, { immediate: true })
                  .catch((err) => logger.error('Failed to persist completed session (no existing msg path)', { agentId, error: err }));
              }
            } else {
              // Use workspace-aware method for cross-workspace stream completion
              if (resolvedWorkspaceId) {
                sessionStore.setStreamingForWorkspace(resolvedWorkspaceId, agentId, false);
              } else {
                sessionStore.setStreaming(agentId, false);
              }

              // Update unified state store so BackgroundAgentExecutor subscriptions fire
              // Get the session from the store to sync the unified state
              if (resolvedWorkspaceId) {
                const sessionForUnifiedSync = sessionStore.getSessionForWorkspace(
                  resolvedWorkspaceId,
                  agentId,
                );
                if (sessionForUnifiedSync) {
                  unifiedStateStore.setAgent(WorkspaceId(resolvedWorkspaceId), sessionForUnifiedSync);
                }
              }
            }

            // NOTE: Persistence is now handled in each branch above to ensure
            // frontend disk has the completed session for restoreWithoutBackend
          } else if (backendMessage) {
            // Session doesn't exist or has no messages, but we have a backend message
            // This can happen when user switches workspaces during streaming
            // Try to load the session from the backend and add the message
            logger.info('Stream complete but session missing - attempting to load from backend', {
              agentId,
              hasSession: !!streamSession,
              messageCount: streamSession?.messages?.length || 0,
              backendMessageId: backendMessage.id,
              workspaceId: resolvedWorkspaceId,
            });

            // Try to load the session from the backend (async, but we're in a sync handler)
            persistenceService
              .loadSession(agentId, resolvedWorkspaceId)
              .then((loadedSession) => {
                if (loadedSession) {
                  // Validate loaded session has required fields before adding to store
                  if (
                    !loadedSession.id ||
                    !Array.isArray(loadedSession.messages) ||
                    !loadedSession.status
                  ) {
                    logger.warn('Loaded session is missing required fields, skipping', {
                      agentId,
                      hasId: !!loadedSession.id,
                      hasMessages: Array.isArray(loadedSession.messages),
                      hasStatus: !!loadedSession.status,
                      workspaceId: resolvedWorkspaceId,
                    });
                    return;
                  }

                  // Session loaded from backend - add it to the store
                  logger.info('Session loaded from backend after stream complete', {
                    agentId,
                    loadedMessageCount: loadedSession.messages?.length || 0,
                    workspaceId: resolvedWorkspaceId,
                  });

                  // Ensure the session has the correct workspaceId
                  if (resolvedWorkspaceId && !loadedSession.workspaceId) {
                    loadedSession.workspaceId = WorkspaceId(resolvedWorkspaceId);
                  }

                  // Mark as not streaming
                  loadedSession.isStreaming = false;

                  // Add to the store
                  sessionStore.addSession(loadedSession);

                  // Update unified state store so BackgroundAgentExecutor subscriptions fire
                  if (resolvedWorkspaceId) {
                    unifiedStateStore.setAgent(WorkspaceId(resolvedWorkspaceId), loadedSession);
                  }

                  // Persist loaded session to frontend disk so it survives refresh
                  if (resolvedWorkspaceId) {
                    persistenceService.saveSession(loadedSession, resolvedWorkspaceId, { immediate: true })
                      .catch((err) => logger.error('Failed to persist session loaded from backend', { agentId, error: err }));
                  }
                } else {
                  logger.warn('Stream complete but session could not be loaded from backend', {
                    agentId,
                    backendMessageId: backendMessage.id,
                    workspaceId: resolvedWorkspaceId,
                  });
                }
              })
              .catch((loadError) => {
                logger.error('Failed to load session from backend after stream complete', {
                  agentId,
                  error: loadError,
                  workspaceId: resolvedWorkspaceId,
                });
              });

            // Still set streaming to false - use workspace-aware method
            if (resolvedWorkspaceId) {
              sessionStore.setStreamingForWorkspace(resolvedWorkspaceId, agentId, false);

              // Update unified state store so BackgroundAgentExecutor subscriptions fire
              // Get the session from the store to sync the unified state
              const sessionForUnifiedSync = sessionStore.getSessionForWorkspace(
                resolvedWorkspaceId,
                agentId,
              );
              if (sessionForUnifiedSync) {
                unifiedStateStore.setAgent(WorkspaceId(resolvedWorkspaceId), sessionForUnifiedSync);
              }
            } else {
              sessionStore.setStreaming(agentId, false);
            }
          }

          // Mark agent as having unread messages (if user isn't currently viewing it)
          // Pass workspaceId to enable cross-workspace tab indicators
          // Pass isBackground to skip unread tracking for background agents
          const streamSessionForUnread = getStreamSession();
          const isBackgroundAgent =
            streamSessionForUnread?.isBackground ||
            streamSessionForUnread?.metadata?.isBackground ||
            false;
          unreadTrackingService.onNewAssistantMessage(
            agentId,
            resolvedWorkspaceId,
            isBackgroundAgent,
          );

          // Forward to ChatService WITH the backend's message (or undefined if interrupted)
          // FIX: Use dispatchStreamEvent which queues events if no handler registered
          this.dispatchStreamEvent(handlerSessionId, 'end', {
            type: 'end',
            message: backendMessage,
          });

          // Also dispatch session-updated event as a fallback
          // This ensures ChatService's sessionUpdatedHandler syncs isProcessing
          window.dispatchEvent(new CustomEvent(`agent:session-updated:${handlerSessionId}`));

          // Cleanup
          this.cleanupStreamHandler(agentId);
        } else if (data.type === 'error') {
          logger.error('Restored stream error', { agentId, error: data.data });

          // Use workspace-aware method for cross-workspace stream completion
          if (resolvedWorkspaceId) {
            sessionStore.setStreamingForWorkspace(resolvedWorkspaceId, agentId, false);
          } else {
            sessionStore.setStreaming(agentId, false);
          }

          // Forward to ChatService
          // FIX: Use dispatchStreamEvent which queues events if no handler registered
          this.dispatchStreamEvent(handlerSessionId, 'error', {
            type: 'error',
            error: data.data?.message || 'The response was interrupted. Please try again.',
          });

          // Also dispatch session-updated event as a fallback
          window.dispatchEvent(new CustomEvent(`agent:session-updated:${handlerSessionId}`));

          // Cleanup
          this.cleanupStreamHandler(agentId);
        }
      } catch (error) {
        logger.error('Error in restored stream handler', error as Error, {
          dataType: data?.type,
          agentId,
        });
      }
    };

    // Register the handler -- capture listener ID for targeted cleanup via offById().
    // Using offById() instead of removeAllListeners() prevents collateral removal of
    // other listeners on the same channel (e.g., AgentSubscriptions.svelte).
    const streamListenerId = window.electronAPI.on(streamChannel, streamHandler);

    // Store handler reference with workspace ID for cross-workspace stream handling
    const wrappedHandler = (streamHandler as any).__ipcWrapper;
    this.activeStreamHandlers.set(agentId, {
      channel: streamChannel,
      handler: streamHandler,
      wrappedHandler: wrappedHandler || undefined,
      workspaceId: resolvedWorkspaceId,
      listenerId: streamListenerId,
      registeredAt: Date.now(),
    });

    // Register IPC heartbeat ping handler - responds with pong to verify IPC liveness
    const pingChannel = `agent:stream:ping:${agentId}`;
    const pingHandler = (data: { agentId: string; timestamp: number }) => {
      logger.debug('IPC heartbeat: received ping, sending pong', {
        agentId,
        timestamp: data.timestamp,
      });
      window.electronAPI.send('agent:stream:pong', { agentId });
    };
    const pingListenerId = window.electronAPI.on(pingChannel, pingHandler);
    this.activePingHandlers.set(agentId, {
      channel: pingChannel,
      handler: pingHandler,
      listenerId: pingListenerId,
    });

    // Clear pending registration now that it's complete
    this.pendingStreamRegistrations.delete(agentId);

    logger.info('Stream handler registered for restored session', {
      agentId,
      streamChannel,
      pingChannel,
      activeHandlersCount: this.activeStreamHandlers.size,
      workspaceId: resolvedWorkspaceId,
    });
  }

  /**
   * Clean up stream handler for an agent
   */
  private cleanupStreamHandler(agentId: string): void {
    const storedHandler = this.activeStreamHandlers.get(agentId);
    if (storedHandler) {
      logger.info('Cleaning up stream handler', { agentId, channel: storedHandler.channel });

      // Use offById for targeted cleanup - avoids removing other listeners on the same channel
      if (storedHandler.listenerId) {
        window.electronAPI.offById(storedHandler.channel, storedHandler.listenerId);
      } else {
        window.electronAPI.removeAllListeners(storedHandler.channel);
      }
      this.activeStreamHandlers.delete(agentId);
    }

    // Clean up IPC heartbeat ping handler
    const pingHandler = this.activePingHandlers.get(agentId);
    if (pingHandler) {
      logger.debug('Cleaning up ping handler', { agentId, channel: pingHandler.channel });
      if (pingHandler.listenerId) {
        window.electronAPI.offById(pingHandler.channel, pingHandler.listenerId);
      } else {
        window.electronAPI.removeAllListeners(pingHandler.channel);
      }
      this.activePingHandlers.delete(agentId);
    }

    // Also clean up any pending registration
    this.pendingStreamRegistrations.delete(agentId);

    // FIX: Clear any pending events for this session to prevent stale replays
    // This is important when stream cleanup happens after successful completion
    this.clearPendingEvents(agentId);

    const timeout = this.streamTimeouts.get(agentId);
    if (timeout) {
      clearTimeout(timeout);
      this.streamTimeouts.delete(agentId);
    }
  }

  /**
   * Set up IPC event listeners
   *
   * All streaming events are sent via 'agent:stream:${agentId}' channel with types:
   * 'chunk', 'content-blocks', 'complete', 'error' - handled by agent-factory.ts
   */
  private setupEventListeners() {
    // Set up unread tracking cleanup callback to prune stale agent IDs from localStorage
    unreadTrackingService.setAgentExistsCallback(
      (agentId: string) => sessionStore.getSession(agentId) !== null,
    );

    if (typeof window !== 'undefined' && window.electronAPI) {
      // Helper to register global IPC listeners with cleanup tracking
      // IMPORTANT: under Electron context isolation + HMR, function identity across the
      // bridge is unreliable and stale cleanup can run after a new listener is registered.
      // Using removeAllListeners(channel) here can inadvertently remove the *new* listener.
      // Use listener-ID based cleanup via offById() instead.
      const registerGlobalListener = (channel: string, handler: (data: any) => void) => {
        const listenerId = window.electronAPI.on(channel, handler);
        this.globalIpcListenerCleanup.push(() => {
          window.electronAPI.offById(channel, listenerId);
        });
      };

      registerGlobalListener('agent:stream:disconnected', (data: any) => {
        logger.warn('Stream disconnected', { agentId: data.agentId });
        const eventSession = sessionStore.getSession(data.agentId);
        if (eventSession) {
          sessionStore.setStreaming(eventSession.id, false);
        }
      });

      // SAFETY NET: Listen for backend notification that a stream is about to start.
      // This catches the race condition where:
      // 1. Workspace is recreated with the same ID
      // 2. reconnectToBackendStreams() runs before the backend sets streamStartTimes
      // 3. Frontend never registers a handler for the new agent
      // 4. Chunks are sent on agent:stream:<agentId> but silently dropped
      // When we receive this notification, we register a handler if one doesn't exist.
      // The backend sends this BEFORE the first chunk, so we have time to register.
      registerGlobalListener('agent:stream-starting', (data: any) => {
        const { agentId, workspaceId } = data;
        logger.info('Backend stream starting notification received', { agentId, workspaceId });

        // ensureStreamHandler is idempotent - it returns early if handler already exists
        const result = this.ensureStreamHandler(agentId, { workspaceId });
        if (result.created) {
          logger.info('Stream handler registered for starting stream', {
            agentId,
            workspaceId,
            channel: result.channel,
          });
        } else {
          logger.debug('Stream handler already exists, no action needed', {
            agentId,
            existingChannel: result.channel,
          });
        }

        // SAFETY NET: Ensure a session exists for this agent BEFORE the first chunk arrives.
        // If the agent:created event didn't create a session (e.g., for delegated agents
        // where IPC delivery via mainWindow may fail silently), the chunk handler would
        // silently drop all stream data because getStreamSession() returns null.
        // Try loading from persistence first (has full agent data with name, metadata, etc.),
        // falling back to a minimal session if persistence load fails.
        const existingSession = workspaceId
          ? sessionStore.getSessionForWorkspace(workspaceId, agentId)
          : sessionStore.getSession(agentId);

        if (!existingSession && workspaceId) {
          logger.warn(
            'No session found for streaming agent at stream-starting, loading from persistence',
            { agentId, workspaceId },
          );
          persistenceService
            .loadSession(agentId, workspaceId)
            .then((loadedSession) => {
              // Check again - session might have been created while we were loading
              const currentSession = workspaceId
                ? sessionStore.getSessionForWorkspace(workspaceId, agentId)
                : sessionStore.getSession(agentId);
              if (currentSession) {
                logger.debug(
                  'Session appeared while loading from persistence at stream-starting, skipping',
                  { agentId },
                );
                return;
              }

              if (loadedSession) {
                if (workspaceId && !loadedSession.workspaceId) {
                  loadedSession.workspaceId = WorkspaceId(workspaceId);
                }
                // Create the session first (with isStreaming: false by default),
                // then set streaming via the canonical setStreamingForWorkspace path.
                // This avoids relying on the confusing dual-layer isStreaming behavior
                // in setAgent where session.isStreaming and streaming.active diverge.
                sessionStore.addSession(loadedSession);
                if (workspaceId) {
                  sessionStore.setStreamingForWorkspace(workspaceId, agentId, true);
                } else {
                  sessionStore.setStreaming(agentId, true);
                }
                logger.info('Created session from persistence for streaming agent (stream-starting)', {
                  agentId,
                  sessionName: loadedSession.name,
                  workspaceId,
                });
              }
            })
            .catch((err) => {
              logger.error('Failed to load session from persistence at stream-starting', {
                agentId,
                error: err,
                workspaceId,
              });
            });
        }
      });

      // Listen for backend request to prepare stream handler (backend-initiated agents)
      // This is the first step of the handshake for backend-initiated agents (e.g., wake handler).
      // We register the stream handler here, then signal back that we're ready.
      // The backend will then emit agent:created and start streaming.
      registerGlobalListener('agent:prepare-handler', (data: any) => {
        const { agentId, workspaceId, agentInfo, wakeMessage } = data;
        logger.info('Backend requested stream handler preparation', {
          agentId,
          workspaceId,
          agentName: agentInfo?.name,
          hasWakeMessage: !!wakeMessage,
        });

        try {
          // Register stream handler FIRST - this is the critical part
          // We do this before signaling ready to ensure no race condition
          // Pass workspaceId so stream completion updates the correct workspace's streaming state
          this.ensureStreamHandler(agentId, { workspaceId });
          logger.info('Stream handler registered for backend-initiated agent', {
            agentId,
            workspaceId,
          });

          // CRITICAL: Set streaming state immediately so UI shows streaming indicator
          // This is especially important for woken-up agents where the session already exists
          const existingSession = sessionStore.getSession(agentId);
          if (existingSession) {
            // If we have a wake message (e.g., from event subscription), add it to the session
            // This is critical for showing the EventWakeupBanner in the chat history
            if (wakeMessage) {
              logger.info('Adding wake message to session from agent:prepare-handler', {
                agentId,
                wakeMessageId: wakeMessage.id,
                hasMetadata: !!wakeMessage.metadata,
                metadataType: wakeMessage.metadata?.type,
                eventTypes: wakeMessage.metadata?.eventTypes,
                eventCount: wakeMessage.metadata?.eventCount,
                fullMetadata: wakeMessage.metadata,
                workspaceId,
              });
              // Use workspace-aware method to ensure message is added even if user is viewing
              // a different workspace when the wake event occurs
              if (workspaceId) {
                sessionStore.addMessageForWorkspace(workspaceId, agentId, wakeMessage);
              } else {
                sessionStore.addMessage(agentId, wakeMessage);
              }

              // Verify the message was added correctly
              const updatedSession = sessionStore.getSession(agentId);
              const addedMessage = updatedSession?.messages?.find(
                (m: any) => m.id === wakeMessage.id,
              );
              logger.info('Verified wake message in session after adding', {
                agentId,
                wakeMessageId: wakeMessage.id,
                wasFound: !!addedMessage,
                addedMessageMetadata: addedMessage?.metadata,
                sessionMessageCount: updatedSession?.messages?.length,
              });
            }

            // Use workspace-aware method for cross-workspace streaming state
            if (workspaceId) {
              sessionStore.setStreamingForWorkspace(workspaceId, agentId, true);
            } else {
              sessionStore.setStreaming(agentId, true);
            }
            logger.info('Set streaming state for woken-up agent', { agentId, workspaceId });

            // Dispatch session-updated event so UI components (like WorkspaceDock) update
            const eventName = `agent:session-updated:${agentId}`;
            logger.info('Dispatching session-updated event for woken-up agent', {
              agentId,
              eventName,
            });
            window.dispatchEvent(new CustomEvent(eventName));
          }
        } catch (error) {
          // Log the error but do NOT re-throw — we MUST always send agent:handler-ready
          // below to prevent the backend from hanging on a handshake timeout.
          logger.error('Error preparing stream handler for backend-initiated agent', {
            agentId,
            workspaceId,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          });
        }

        // Signal back to backend that we're ready to receive streaming data.
        // IMPORTANT: This MUST execute unconditionally — if it doesn't, the backend's
        // requestFrontendHandler() will time out after 3 retries × 10s, blocking event
        // delivery for this agent (e.g., wake-on-child-idle).
        window.electronAPI.send('agent:handler-ready', { agentId });
        logger.info('Sent agent:handler-ready to backend', { agentId });
      });

      // Listen for backend-created agents (e.g., from createPrerequisiteNote)
      // This ensures we register stream handlers for agents created outside the frontend flow
      registerGlobalListener('agent:created', (data: any) => {
        // DIAG: Trace agent:created IPC arrival in renderer
        console.warn('[DIAG agent:created] IPC event received in renderer', {
          dataKeys: data ? Object.keys(data) : [],
          hasType: !!data?.type,
          hasAgent: !!data?.agent || !!data?.data?.agent,
          timestamp: Date.now(),
        });

        // Handle two event formats:
        // 1. Direct from backend.emit(): { agentId, workspaceId, agent }
        // 2. From WorkspaceEventBus.emitEvent(): { type, workspaceId, data: { agentId, agentName, ... } }
        const isWorkspaceEvent = data?.type === 'agent:created' && data?.data;
        const agentId = isWorkspaceEvent ? data.data.agentId : data?.agentId;
        const workspaceId = isWorkspaceEvent ? data.workspaceId : data?.workspaceId;
        const agent = isWorkspaceEvent ? data.data.agent : data?.agent;
        const agentName = isWorkspaceEvent ? data.data.agentName : agent?.name;

        // Validate that we have a valid agentId before proceeding
        if (!agentId) {
          // For WorkspaceEventBus events without full agent data, this is expected (activity log only)
          // Only log as debug since this is not an error for activity-log-only events
          if (isWorkspaceEvent) {
            logger.debug('Received agent:created activity event (no session data)', {
              workspaceId,
              agentName,
              eventId: data?.id,
            });
          } else {
            logger.warn('Received agent:created event with undefined agentId, ignoring', {
              workspaceId,
              agentName: agent?.name,
              dataKeys: Object.keys(data || {}),
            });
          }
          return;
        }

        // Deduplicate agent:created events - the same agentId arrives from multiple
        // IPC channels (workspace:event, event:broadcast, events:new) within milliseconds
        const now = Date.now();
        const lastSeen = this.recentAgentCreatedEvents.get(agentId);
        if (lastSeen && now - lastSeen < this.AGENT_CREATED_DEDUP_WINDOW) {
          logger.debug('Skipping duplicate agent:created event', { agentId, msSinceLast: now - lastSeen });
          return;
        }
        this.recentAgentCreatedEvents.set(agentId, now);

        // Clean up old entries periodically to prevent unbounded growth
        if (this.recentAgentCreatedEvents.size > 50) {
          for (const [id, ts] of this.recentAgentCreatedEvents) {
            if (now - ts > this.AGENT_CREATED_DEDUP_WINDOW * 2) {
              this.recentAgentCreatedEvents.delete(id);
            }
          }
        }

        logger.debug('Backend-created agent detected', {
          agentId,
          workspaceId,
          agentName: agentName || agent?.name,
          isWorkspaceEvent,
          hasAgent: !!agent,
        });

        // Check if we already have a session for this agent
        const existingSession = sessionStore.getSession(agentId);
        if (existingSession) {
          logger.debug('Session already exists for backend-created agent', { agentId });

          // Update session metadata from the full agent data if available.
          // This upgrades minimal sessions (created by the chunk handler safety net
          // with placeholder name "Task Agent") with the real agent name, model,
          // metadata, etc. from the authoritative agent:created event.
          if (agent) {
            const updatedSession: AgentSession = {
              ...existingSession,
              name: agent.name || existingSession.name,
              model: agent.model || existingSession.model,
              provider: agent.provider || existingSession.provider,
              systemPrompt: agent.systemPrompt || existingSession.systemPrompt,
              isBackground: agent.isBackground || agent.metadata?.isBackground || existingSession.isBackground || false,
              metadata: {
                ...existingSession.metadata,
                ...agent.metadata,
              },
              // Explicitly preserve streaming state — this is a metadata-only update.
              // Without this, the spread from existingSession carries whatever isStreaming
              // getSession() returned, which could be stale. Be explicit to avoid
              // accidentally toggling streaming state during a metadata update.
              isStreaming: existingSession.isStreaming,
            };
            sessionStore.addSession(updatedSession);
            logger.debug('Updated existing session with agent:created metadata', {
              agentId,
              oldName: existingSession.name,
              newName: updatedSession.name,
            });
          }

          // Check if the agent payload has new messages (e.g., wake message from event subscription)
          // This happens when an agent is woken up - the backend sends the wake message with metadata
          if (agent?.messages) {
            const existingMessageIds = new Set(existingSession.messages.map((m: any) => m.id));
            const newMessages = agent.messages.filter((m: any) => !existingMessageIds.has(m.id));

            if (newMessages.length > 0) {
              logger.info('Adding new messages from backend to existing session', {
                agentId,
                newMessageCount: newMessages.length,
                firstNewMessageRole: newMessages[0]?.role,
                hasEventNotificationMetadata:
                  newMessages[0]?.metadata?.type === 'event_notification',
              });

              // Add each new message to the session
              for (const message of newMessages) {
                sessionStore.addMessage(agentId, message);
              }
            }
          }

          // Still register stream handler in case it's missing
          // Pass workspaceId so stream completion updates the correct workspace's streaming state
          // ensureStreamHandler is idempotent, so this is safe to call unconditionally
          this.ensureStreamHandler(agentId, { workspaceId });
          return;
        }

        // Create a session from the agent data so the UI knows about it
        if (agent) {
          const newSession: AgentSession = {
            id: agentId,
            backendSessionId: agentId,
            workspaceId,
            name: agent.name || 'Task Agent',
            status: 'active' as AgentStatus,
            messages: agent.messages || [],
            model: agent.model || DEFAULT_AGENT_MODEL,
            provider: agent.provider,
            systemPrompt: agent.systemPrompt,
            createdAt: new Date(agent.createdAt || Date.now()),
            updatedAt: new Date(agent.updatedAt || Date.now()),
            isStreaming: this.activeStreamHandlers.has(agentId), // Only streaming if handler was pre-registered (backend-initiated agent)
            isBackground: agent.isBackground || agent.metadata?.isBackground || false,
            metadata: agent.metadata,
          };

          console.warn('[DIAG agent:created] Calling sessionStore.addSession', {
            agentId,
            workspaceId: newSession.workspaceId,
            name: newSession.name,
            isBackground: newSession.isBackground,
          });
          sessionStore.addSession(newSession);
          logger.debug('Created session for backend-created agent', {
            agentId,
            sessionName: newSession.name,
            isBackground: newSession.isBackground,
            isStreaming: newSession.isStreaming,
          });
        }

        // Register stream handler so we receive streaming events via the IPC→DOM bridge
        // Pass workspaceId so stream completion updates the correct workspace's streaming state
        // ensureStreamHandler dispatches session-updated internally, so we don't need to do it again
        this.ensureStreamHandler(agentId, { workspaceId });
        logger.debug('Stream handler registered for backend-created agent', {
          agentId,
          workspaceId,
        });
      });

      // Listen for queued message processing - add user message and re-register stream handler
      // This is needed because the stream handler is cleaned up after each stream completes,
      // but when a queued message is processed, we need to receive the streaming data
      registerGlobalListener('agent:queue:processing', async (data: any) => {
        const { agentId, messageId, content, contextItems } = data;
        logger.debug('Queue processing event received from backend', {
          agentId,
          messageId,
          hasContent: !!content,
          hasExistingHandler: this.activeStreamHandlers.has(agentId),
          existingHandlerChannel: this.activeStreamHandlers.get(agentId)?.channel,
          timestamp: Date.now(),
        });

        // Get the session
        let session = sessionStore.getSession(agentId);
        if (!session) {
          logger.warn('No session found for queued message processing', { agentId });
          return;
        }

        // Add the user message to the session so it appears in the UI immediately
        const userMessage: AgentMessage = {
          id: messageId,
          role: 'user',
          contentBlocks: [{ type: 'text', text: content }],
          timestamp: new Date().toISOString(),
          metadata: {
            contextItems: contextItems || [],
          },
        };
        sessionStore.addMessage(agentId, userMessage);

        // Re-get the session AFTER adding the message since getSession returns a snapshot
        session = sessionStore.getSession(agentId);

        if (session) {
          session.isStreaming = true;
          sessionStore.addSession(session);

          // Dispatch session-updated event so ChatService syncs its messages
          window.dispatchEvent(new CustomEvent(`agent:session-updated:${agentId}`));

          // Persist the queued user message immediately so it survives workspace switches.
          // Await the save instead of fire-and-forget to ensure the user
          // message is on disk before the user can navigate away.
          try {
            await this.saveSession(agentId, session.workspaceId, true);
          } catch (error) {
            logger.error('Failed to persist queued user message', {
              agentId,
              messageId,
              error,
            });
          }
        }

        // Re-register the stream handler with forceReregister flag
        // This clears stale entries and creates a fresh handler for the queued message
        logger.debug('Re-registering stream handler for queued message', {
          agentId,
          timestamp: Date.now(),
        });
        const result = this.ensureStreamHandler(agentId, { forceReregister: true });
        logger.debug('Stream handler re-registered successfully', {
          agentId,
          newHandlerChannel: result.channel,
          timestamp: Date.now(),
        });

        // FIX: Signal back to backend that we're ready to receive streaming data
        // This completes the handshake - backend waits for this before starting the stream
        // for the queued message, preventing the race condition where chunks arrive
        // before the handler is registered.
        window.electronAPI.send('agent:handler-ready', { agentId });
        logger.debug('Sent agent:handler-ready to backend for queued message', {
          agentId,
          timestamp: Date.now(),
        });
      });

      // Listen for queue processing cancellation - undo the effects of agent:queue:processing
      // This fires when the backend's re-check guard detects that a concurrent stream started
      // while waiting for the frontend handler, so it aborts queue processing. We need to
      // remove the phantom user message that was optimistically added.
      //
      // IMPORTANT: Do NOT call addSession() here. sessionStore.getSession() returns a copy,
      // and addSession() runs setAgent(), which has message-preservation logic that compares
      // message counts. During active streaming, setAgent() would choose the stale snapshot's
      // messages (which still contain the phantom) over the store's filtered set, re-adding
      // the phantom message we just removed.
      //
      // IMPORTANT: Do NOT set isStreaming = false. The cancellation fires specifically because
      // a concurrent stream IS active (that's the re-check guard trigger). The isStreaming = true
      // set by agent:queue:processing is correct for the concurrent stream.
      registerGlobalListener('agent:queue:processing-cancelled', (data: any) => {
        const { agentId, messageId } = data;
        logger.warn('Queue processing cancelled by backend, cleaning up frontend state', {
          agentId,
          messageId,
          timestamp: Date.now(),
        });

        // 1. Remove the phantom user message that was added by agent:queue:processing
        // Use updateMessages which directly sets agent.messages in the store without
        // going through setAgent's message-preservation logic.
        const session = sessionStore.getSession(agentId);
        if (session) {
          const filteredMessages = (session.messages || []).filter((m: any) => m.id !== messageId);
          // Only update if we actually removed a message
          if (filteredMessages.length !== (session.messages || []).length) {
            sessionStore.updateMessages(agentId, filteredMessages);
            logger.debug('Removed phantom user message from session', {
              agentId,
              messageId,
              messagesBeforeRemoval: (session.messages || []).length,
              messagesAfterRemoval: filteredMessages.length,
            });

            // Keep on-disk session state in sync with the UI when the queued
            // phantom message is removed.
            void this.saveSession(agentId, session.workspaceId, true).catch((error) => {
              logger.error('Failed to persist queued message cancellation cleanup', {
                agentId,
                messageId,
                error,
              });
            });
          }

          // 2. Dispatch session-updated event so ChatService re-syncs
          window.dispatchEvent(new CustomEvent(`agent:session-updated:${agentId}`));
        }

        // 3. Do NOT call cleanupStreamHandler here!
        // The cancellation fires because a concurrent stream IS active (that's what
        // triggered the re-check guard). The handler registered by agent:queue:processing
        // is now being used by the concurrent stream. Removing it would silently drop
        // all remaining chunks for the active stream. The handler will be naturally
        // cleaned up when the concurrent stream completes via the onComplete flow.
        this.pendingStreamRegistrations.delete(agentId);

        logger.info('Queue processing cancellation cleanup complete', {
          agentId,
          messageId,
        });
      });
    }
  }

  /**
   * Set up beforeunload handler to save streaming state
   * This ensures that partial messages being streamed are saved to disk
   * before the page unloads, so they can be recovered on page refresh
   */
  private setupBeforeUnloadHandler() {
    if (typeof window === 'undefined') {
      return;
    }

    window.addEventListener('beforeunload', () => {
      logger.info('Page unloading - saving all streaming sessions to disk');

      // Get all sessions from the store
      const allSessions = sessionStore.getAllSessions();

      if (!allSessions || allSessions.length === 0) {
        logger.debug('No sessions to save on page unload');
        return;
      }

      // Also check unified state store for active streaming buffers
      const workspace = unifiedStateStore.currentWorkspace;
      const streamingAgents = workspace
        ? Array.from(workspace.agents.entries()).filter(
            ([_, agent]) => agent.streaming.active && agent.streaming.buffer,
          )
        : [];

      logger.info('Checking for streaming agents on page unload', {
        sessionCount: allSessions.length,
        streamingAgentCount: streamingAgents.length,
      });

      // Save all sessions that have messages or active streaming
      // Note: We use fire-and-forget here because beforeunload doesn't wait for async operations
      for (const session of allSessions) {
        // Check if this session has active streaming in unified state
        const streamingAgent = streamingAgents.find(([agentId]) => agentId === session.id);
        const hasStreamingBuffer = streamingAgent && streamingAgent[1].streaming.buffer;

        // Skip sessions without messages and without streaming
        if ((!session.messages || session.messages.length === 0) && !hasStreamingBuffer) {
          continue;
        }

        // If there's a streaming buffer but no streaming message, create one
        if (hasStreamingBuffer && streamingAgent) {
          const agentState = streamingAgent[1];
          let streamingMessage = session.messages?.find(
            (m: any) => m.role === 'assistant' && m.isStreaming,
          );

          if (!streamingMessage) {
            // Create a new streaming message with the accumulated buffer
            streamingMessage = {
              id: createMessageId(uuidv4()),
              role: 'assistant' as const,
              contentBlocks:
                agentState.streaming.contentBlocks.length > 0
                  ? agentState.streaming.contentBlocks
                  : [{ type: 'text' as const, text: agentState.streaming.buffer }],
              timestamp: new Date().toISOString(),
              isStreaming: true,
              metadata: {
                partial: true,
                savedDuringUnload: true,
              },
            } as AgentMessage;

            // Add the message to the session
            if (!session.messages) {
              session.messages = [];
            }
            session.messages.push(streamingMessage);

            logger.info('Created streaming message from buffer on page unload', {
              agentId: session.id,
              bufferLength: agentState.streaming.buffer.length,
              contentBlocksCount: agentState.streaming.contentBlocks.length,
            });
          } else if (streamingMessage) {
            // Update existing streaming message with the latest buffer content
            // Ensure we have the latest content in contentBlocks
            if (!streamingMessage.contentBlocks || streamingMessage.contentBlocks.length === 0) {
              streamingMessage.contentBlocks = [
                { type: 'text' as const, text: agentState.streaming.buffer },
              ];
            } else {
              // Update the text content block with the latest buffer
              const textBlock = streamingMessage.contentBlocks.find((b: any) => b.type === 'text');
              if (textBlock) {
                textBlock.text = agentState.streaming.buffer;
              }
            }
            logger.info('Updated streaming message with buffer on page unload', {
              agentId: session.id,
              bufferLength: agentState.streaming.buffer.length,
            });
          }
        }

        // Check if there are any streaming messages
        const hasStreamingMessage = session.messages?.some(
          (m: any) => m.role === 'assistant' && m.isStreaming,
        );

        // Check if the agent is ACTUALLY streaming (streaming.active === true),
        // not just whether a message has a stale isStreaming flag.
        // When a stream completes, the backend saves the complete session to disk.
        // If we save based on a stale isStreaming flag, we may overwrite the backend's
        // complete session with a stale in-memory version that has fewer messages.
        const unifiedAgent = workspace?.agents.get(session.id as any);
        const isActuallyStreaming = unifiedAgent?.streaming?.active === true;

        // Only save if:
        // 1. Agent has active streaming buffer (content to preserve), OR
        // 2. Agent is actually streaming AND has streaming messages
        // Don't save based solely on stale isStreaming flags on messages
        const shouldSave =
          (hasStreamingBuffer || (hasStreamingMessage && isActuallyStreaming)) &&
          session.workspaceId;

        if (shouldSave) {
          // Don't overwrite disk with fewer messages than what was loaded.
          // This prevents a stale in-memory session (e.g., from a minimal session created
          // by the stream handler) from overwriting the complete conversation history on disk.
          const currentMessageCount = session.messages?.length ?? 0;
          const diskMessageCount = this.diskMessageCounts.get(session.id as string) ?? 0;

          if (diskMessageCount > 0 && currentMessageCount < diskMessageCount) {
            logger.warn(
              'Skipping save on page unload - in-memory session has fewer messages than disk',
              {
                agentId: session.id,
                currentMessageCount,
                diskMessageCount,
                workspaceId: session.workspaceId,
              },
            );
            continue;
          }

          logger.info('Saving streaming session on page unload', {
            agentId: session.id,
            messageCount: currentMessageCount,
            workspaceId: session.workspaceId,
            hasStreamingBuffer,
            hasStreamingMessage,
            isActuallyStreaming,
            diskMessageCount,
          });

          // Fire and forget - don't await because beforeunload doesn't wait for async operations
          persistenceService
            .saveSession(session, session.workspaceId, {
              immediate: true,
            })
            .catch((error) => {
              logger.warn('Failed to save streaming session on page unload', {
                agentId: session.id,
                error: (error as Error)?.message || error,
              });
            });
        }
      }

      // Flush pending undo-able deletions so they don't come back after refresh.
      // Fire-and-forget: the main process stays alive during renderer refresh and
      // will process the IPC calls even after the renderer has reloaded.
      if (this.pendingDeletions.size > 0) {
        logger.info('Flushing pending agent deletions on page unload', {
          count: this.pendingDeletions.size,
        });
        const entries = [...this.pendingDeletions.entries()];
        this.pendingDeletions.clear();

        for (const [agentId, { timeoutId, workspaceId }] of entries) {
          clearTimeout(timeoutId);
          // Fire and forget - main process will handle the IPC even after renderer reloads
          this.deleteSession(agentId, workspaceId).catch((err) => {
            logger.warn('Failed to flush pending deletion on page unload', {
              agentId,
              error: (err as Error)?.message || err,
            });
          });
        }
      }

      // NOTE: We intentionally do NOT call dispose() here.
      // The beforeunload event fires for HMR, cancelled navigations, and other
      // scenarios where the page doesn't actually unload. Calling dispose() would
      // leave the singleton in a broken state with no IPC listeners.
      // Instead, we use the pagehide event with persisted check for actual unload.
    });

    // Use pagehide event for actual page unload cleanup
    // pagehide is more reliable than unload and provides the persisted property
    // to distinguish between bfcache (back-forward cache) and actual unload
    window.addEventListener('pagehide', (event) => {
      // If the page is being cached (bfcache), don't dispose - we might come back
      if (event.persisted) {
        logger.info('Page hidden but persisted (bfcache) - not disposing');
        return;
      }

      // Actual page unload - safe to dispose
      logger.info('Page unloading (pagehide, not persisted) - disposing AgentService');
      this.dispose();
    });
  }

  /**
   * Get the session store for reactive subscriptions
   */
  getStore(): Writable<any> {
    return sessionStore.getStore();
  }

  /**
   * Get the current state (for compatibility)
   */
  getState(): any {
    return get(sessionStore.getStore());
  }

  /**
   * Get initialization status store
   */
  getInitializationStatusStore() {
    return this.initializationStatusStore;
  }

  /**
   * Check if an agent exists
   */
  hasAgent(agentId: string): boolean {
    const workspace = unifiedStateStore.currentWorkspace;
    if (!workspace) return false;
    const agent = workspace.agents.get(agentId as any);
    return !!agent;
  }

  /**
   * Lock-based deduplication for initial agent activation.
   * Multiple code paths (restoreSession, resumeSession, createSession) can race
   * during workspace creation. This ensures only one activation proceeds;
   * subsequent callers await the first caller's promise.
   */
  async activateInitialAgent(
    agentId: string,
    workspace: Workspace,
    createFn: () => Promise<AgentSession | null>,
  ): Promise<AgentSession | null> {
    const key = `${workspace.id}:${agentId}`;

    // If already activated, return existing session
    const existing = sessionStore.getSession(agentId);
    if (existing?.backendSessionId) {
      logger.info('activateInitialAgent: already activated', { agentId, workspaceId: workspace.id });
      return existing;
    }

    // If activation in progress, await it
    const pending = this.initialAgentActivationLocks.get(key);
    if (pending) {
      logger.info('activateInitialAgent: awaiting existing activation', { agentId, workspaceId: workspace.id });
      return pending;
    }

    // Start activation with timeout guard
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const promise = Promise.race([
      createFn(),
      new Promise<null>((resolve) => {
        timeoutId = setTimeout(() => {
          logger.warn('activateInitialAgent: timeout after 60s, releasing lock', { key });
          resolve(null);
        }, 60_000);
      }),
    ]).finally(() => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
      this.initialAgentActivationLocks.delete(key);
    });
    this.initialAgentActivationLocks.set(key, promise);
    return promise;
  }

  /**
   * Activate a pending agent on the backend
   */
  async activateAgent(agentId: string, workspaceId: string): Promise<AgentSession | null> {
    // Get current session to check if already active
    const currentSession = sessionStore.getSession(agentId);
    if (currentSession?.backendSessionId && currentSession.status === 'active') {
      logger.info('Agent already active, returning existing session', {
        agentId,
        backendSessionId: currentSession.backendSessionId,
      });
      return currentSession;
    }

    // Mutex: if activation is already in progress for this agentId, await the existing promise
    const pendingActivation = this.activationMutex.get(agentId);
    if (pendingActivation) {
      logger.warn('Duplicate activateAgent call detected, awaiting existing activation promise', {
        agentId,
        workspaceId,
        codePath: 'AgentService.activateAgent',
      });
      return pendingActivation;
    }

    // Create the activation promise and store it in the mutex map
    const activationPromise = this._doActivateAgent(agentId, workspaceId, currentSession);
    this.activationMutex.set(agentId, activationPromise);

    try {
      return await activationPromise;
    } finally {
      this.activationMutex.delete(agentId);
    }
  }

  /**
   * Internal implementation of agent activation (called under mutex)
   */
  private async _doActivateAgent(
    agentId: string,
    workspaceId: string,
    currentSession: AgentSession | undefined,
  ): Promise<AgentSession | null> {
    const maxRetries = 3;
    let lastError: Error | null = null;

    // Mark as activating
    if (currentSession) {
      sessionStore.addSession({
        ...currentSession,
        activationState: AgentActivationState.ACTIVATING,
        activationAttempts: (currentSession.activationAttempts || 0) + 1,
      });
    }

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Get the workspace using IPC
        const response = (await invoke('workspace:get', { id: workspaceId })) as any;

        // Extract workspace from response (IPC wraps it in { success, data })
        let workspace: Workspace | null = null;
        if (response?.data) {
          workspace = response.data as Workspace;
        } else if (response?.id) {
          // Fallback: if response is the workspace directly
          workspace = response as Workspace;
        }

        if (!workspace) {
          logger.error('Cannot activate agent - workspace not found', { agentId, workspaceId });
          // Mark as error
          if (currentSession) {
            sessionStore.addSession({
              ...currentSession,
              activationState: AgentActivationState.ERROR,
              lastActivationError: 'Space not found',
            });
          }
          return null;
        }

        // Use the agentIpcProxy from browser index to activate
        const { agentIpcProxy: proxy } = await import('./browser/index');
        const activatedSession = (await proxy.activateAgent(
          agentId,
          workspace,
        )) as AgentSession | null;

        if (activatedSession) {
          // Mark as active - ensure both status and activationState are set
          const finalSession = {
            ...activatedSession,
            status: AgentStatus.Active, // Ensure status is set to active
            activationState: AgentActivationState.ACTIVE,
            lastActivationError: undefined,
          };

          logger.info('Activated session received from backend', {
            agentId: activatedSession.id,
            messageCount: activatedSession.messages?.length || 0,
            hasMessages: !!activatedSession.messages,
            messagesArray: Array.isArray(activatedSession.messages),
            status: finalSession.status,
            activationState: finalSession.activationState,
          });

          // Update the session in stores
          sessionStore.addSession(finalSession);

          // Also update unified state store
          const { unifiedStateStore } = await import('./services/unified-state-store');
          unifiedStateStore.setAgent(workspace.id as any, finalSession);

          // Persist the activated session to disk to ensure status is saved
          try {
            await persistenceService.saveSession(finalSession, workspace.id, { immediate: true });
            logger.info('Persisted activated session to disk', {
              agentId: finalSession.id,
              status: finalSession.status,
            });
          } catch (persistError) {
            logger.warn('Failed to persist activated session to disk', {
              agentId: finalSession.id,
              error: persistError instanceof Error ? persistError.message : String(persistError),
            });
          }

          logger.info('Successfully activated agent', {
            agentId: finalSession.id,
            backendSessionId: finalSession.backendSessionId,
            workspaceId: workspace.id,
            messageCount: finalSession.messages?.length || 0,
            status: finalSession.status,
          });

          return finalSession;
        }

        return activatedSession;
      } catch (error) {
        lastError = error as Error;
        logger.warn(`Failed to activate agent (attempt ${attempt + 1}/${maxRetries})`, {
          agentId,
          workspaceId,
          error: lastError.message,
          attempt: attempt + 1,
        });

        // Retry with exponential backoff
        if (attempt < maxRetries - 1) {
          const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    // Mark as error
    if (currentSession) {
      sessionStore.addSession({
        ...currentSession,
        activationState: AgentActivationState.ERROR,
        lastActivationError: lastError?.message || 'Unknown error',
      });
    }

    logger.error(`Failed to activate agent after ${maxRetries} attempts`, {
      agentId,
      workspaceId,
      error: lastError?.message,
    });
    return null;
  }

  /**
   * Create a new agent session
   *
   * IMPORTANT: Use agentType (branded AgentTypeId) to let backend build system prompt.
   * Import createAgentTypeId from '$shared/types/agent.types' and use it to create the branded type.
   *
   * DO NOT pass systemPrompt or rules - these are DEPRECATED and ignored.
   * The backend builds the complete system prompt from agentType via InstructionService.
   */
  async createSession(
    workspace: Workspace,
    options: {
      agentId?: string;
      name?: string;
      model?: string;
      provider?: string; // ACP provider ID (e.g., 'auggie', 'claude-code', 'codex')
      agentType?: import('$shared/types/agent.types').AgentTypeId;
      initialMessage?: string;
      contextReferences?: any[]; // Context references (e.g., Linear issues, GitHub PRs, files)
      behaviorPrompt?: string; // Custom behavior instructions from specialist
      metadata?: any;
      isPending?: boolean;
    } = {},
  ): Promise<AgentSession> {
    // Wrap with performance tracking
    return performanceOptimizer.track(
      `createSession:${workspace.id}`,
      async () => {
        // Validate workspace
        if (!workspace) {
          throw new Error('Cannot create session without space');
        }

        // Validate workspace ID
        if (!workspace.id) {
          logger.error('Cannot create session with workspace missing id', {
            workspace,
            workspaceKeys: Object.keys(workspace),
            options,
          });
          throw new Error('Cannot create session with space missing id');
        }

        // Debug logging
        logger.info('createSession called', {
          workspaceId: workspace.id,
          errorBoundaryType: typeof errorBoundary,
          hasWrap: errorBoundary && typeof errorBoundary.wrap,
          errorBoundaryKeys: errorBoundary ? Object.keys(errorBoundary) : null,
        });

        // Deduplication guard: if an agentId is provided, check for existing session or in-flight creation
        if (options.agentId) {
          // Part 1: Check if a session already exists with a backendSessionId
          const existingSession = sessionStore.getSession(options.agentId);
          if (existingSession?.backendSessionId) {
            logger.warn('createSession dedup: session already exists for agentId, returning existing', {
              agentId: options.agentId,
              workspaceId: workspace.id,
              backendSessionId: existingSession.backendSessionId,
            });
            return existingSession;
          }

          // Part 2: Check if there's already a pending creation for this agentId
          const pendingCreation = this.pendingSessionCreations.get(options.agentId);
          if (pendingCreation) {
            logger.warn('createSession dedup: creation already in progress for agentId, awaiting existing promise', {
              agentId: options.agentId,
              workspaceId: workspace.id,
            });
            return pendingCreation;
          }
        }

        // If we have an agentId, wrap the actual creation in a deduplication promise
        const creationPromise = this._executeCreateSession(workspace, options);

        if (options.agentId) {
          this.pendingSessionCreations.set(options.agentId, creationPromise);
          creationPromise.finally(() => {
            this.pendingSessionCreations.delete(options.agentId!);
          });
        }

        return creationPromise;
      },
      {
        memoize: false, // Don't memoize session creation
        coalesce: false, // Don't coalesce session creation
        priority: 'high',
        // No timeout - agent creation can take a long time, especially for background agents
        // that create PRs or perform other complex operations
      },
    );
  }

  /**
   * Internal execution of createSession, separated for deduplication guard.
   */
  private async _executeCreateSession(
    workspace: Workspace,
    options: {
      agentId?: string;
      name?: string;
      model?: string;
      provider?: string;
      agentType?: import('$shared/types/agent.types').AgentTypeId;
      initialMessage?: string;
      contextReferences?: any[];
      behaviorPrompt?: string;
      metadata?: any;
      isPending?: boolean;
    } = {},
  ): Promise<AgentSession> {
    if (!errorBoundary || typeof errorBoundary.wrap !== 'function') {
      logger.error('errorBoundary.wrap is not available', {
        errorBoundary,
        type: typeof errorBoundary,
      });
      // Fallback to direct execution
      return this.createSessionInternal(workspace, options);
    }

    return errorBoundary.wrap(
          async () => {
            // Skip initialization status tracking - user doesn't want the loader

            // Use agent factory for consistent agent creation
            const { agentFactory } = await import('./services/agent-factory');

            // Direct factory call - no intermediate layers
            const createdSession = await agentFactory.createAgent(workspace, {
              // CRITICAL: Pass the agentId if provided to avoid creating duplicate agents
              id: options.agentId,
              name: options.name || 'Agent',
              workspaceId: WorkspaceId(workspace.id),
              model: options.model, // Let factory handle provider-aware default
              provider: options.provider, // ACP provider ID
              agentType: options.agentType,
              initialMessage: options.initialMessage,
              behaviorPrompt: options.behaviorPrompt, // Pass specialist behavior instructions for system prompt
              isBackground: options.metadata?.isBackground, // Propagate background flag for lifecycle event filtering
              metadata: {
                ...options.metadata,
                // Preserve isInitialAgent flag if present
                isInitialAgent: options.metadata?.isInitialAgent || false,
              },
            });

            // Check if creation was successful - use the actual error message if available
            if (!createdSession.success) {
              throw new Error(createdSession.error || 'Failed to create agent');
            }

            const agentId = createdSession.agent?.id;
            if (!agentId) {
              throw new Error('Failed to create agent - no ID returned');
            }

            // Activate if not pending OR if we're converting from pending (has agentId)

            logger.info('createSession: Checking if should activate', {
              agentId,
              isPending: options.isPending,
              shouldActivate: !options.isPending,
            });
            // Use the created session directly
            if (!createdSession.agent) {
              throw new Error('Failed to create agent');
            }
            const session = createdSession.agent;

            // Ensure the session has the workspaceId field
            // This is essential for drawer validation to work correctly
            if (!session.workspaceId) {
              logger.warn('Created session missing workspaceId, adding it now', {
                agentId: session.id,
                workspaceId: workspace.id,
              });
              session.workspaceId = workspace.id;
            }

            // Ensure isInitialAgent flag is preserved
            if (options.metadata?.isInitialAgent && !session.isInitialAgent) {
              session.isInitialAgent = true;
              if (!session.metadata) {
                session.metadata = {};
              }
              (session.metadata as any).isInitialAgent = true;
            }

            // Add to store
            logger.info('createSession: Adding session to store', {
              agentId,
              sessionId: session.id,
              workspaceId: session.workspaceId,
              isInitialAgent: session.isInitialAgent,
              hasMetadataFlag: (session.metadata as any)?.isInitialAgent,
              isPending: !session.id,
            });
            sessionStore.addSession(session);
            sessionStore.setActiveSession(agentId);

            // CRITICAL: Also add to unified state store so background agents can be found
            const { unifiedStateStore } = await import('./services/unified-state-store');
            unifiedStateStore.setAgent(workspace.id as any, session);

            // Skip cleanup since we're not tracking initialization status

            // Track event
            eventCollector.track(AgentEventType.SESSION_CREATED, {
              agentId,
              workspaceId: workspace.id,
              model: session.model,
              hasSystemPrompt: !!session.systemPrompt,
              isPending: !session.id,
            });

            // Track metrics
            workspaceMetrics.incrementAgentCreated(workspace.id);

            return session;
          },
          'create session',
          {
            retries: 2,
            notify: true,
            context: { workspace: workspace.id, options },
          },
        );
  }

  /**
   * Internal method to create a session without error boundary
   *
   * IMPORTANT: Use agentType (branded AgentTypeId) to let backend build system prompt.
   */
  private async createSessionInternal(
    workspace: Workspace,
    options: {
      agentId?: string;
      name?: string;
      model?: string;
      provider?: string; // ACP provider ID (e.g., 'auggie', 'claude-code', 'codex')
      agentType?: import('$shared/types/agent.types').AgentTypeId;
      initialMessage?: string;
      contextReferences?: any[]; // Context references (e.g., Linear issues, GitHub PRs, files)
      behaviorPrompt?: string; // Custom behavior instructions from specialist
      metadata?: any;
      isPending?: boolean;
    } = {},
  ): Promise<AgentSession> {
    // Validate workspace
    if (!workspace?.id) {
      throw new Error(
        `Cannot create session internal with invalid workspace: ${JSON.stringify(workspace)}`,
      );
    }

    // Skip initialization status tracking - user doesn't want the loader

    // Use agent factory for consistent agent creation
    const { agentFactory } = await import('./services/agent-factory');

    // Direct factory call - no intermediate layers
    const createdSession = await agentFactory.createAgent(workspace, {
      name: options.name || 'Agent',
      workspaceId: WorkspaceId(workspace.id),
      model: options.model, // Let factory handle provider-aware default
      provider: options.provider, // ACP provider ID
      agentType: options.agentType,
      initialMessage: options.initialMessage,
      contextReferences: options.contextReferences, // Pass context references for initial message
      behaviorPrompt: options.behaviorPrompt, // Pass specialist behavior instructions
      isBackground: options.metadata?.isBackground, // Propagate background flag for lifecycle event filtering
      metadata: options.metadata,
    });

    // Check if creation was successful - use the actual error message if available
    if (!createdSession.success) {
      throw new Error(createdSession.error || 'Failed to create agent');
    }

    const agentId = createdSession.agent?.id;
    if (!agentId) {
      throw new Error('Failed to create agent - no ID returned');
    }

    const activatedSession = createdSession.agent;
    if (!activatedSession) {
      throw new Error('Failed to create agent - no session returned');
    }

    // Add to store
    sessionStore.addSession(activatedSession);
    sessionStore.setActiveSession(agentId);

    // CRITICAL: Also add to unified state store so background agents can be found
    const { unifiedStateStore } = await import('./services/unified-state-store');
    unifiedStateStore.setAgent(workspace.id as any, activatedSession);

    // Skip cleanup since we're not tracking initialization status

    // Track event
    eventCollector.track(AgentEventType.SESSION_CREATED, {
      agentId,
      workspaceId: workspace.id,
      model: activatedSession.model,
      hasSystemPrompt: !!activatedSession.systemPrompt,
      isPending: !activatedSession.id,
    });

    // Track metrics
    workspaceMetrics.incrementAgentCreated(workspace.id);

    return activatedSession;
  }

  /**
   * Resume an existing session
   */
  async resumeSession(agentId: string, workspace: Workspace): Promise<AgentSession | null> {
    return errorBoundary.wrap(
      async () => {
        // Ensure agentId is a plain string (not a Proxy)
        const plainAgentId = agentId ? String(agentId) : '';

        // Validate workspace
        if (!workspace) {
          logger.error('Cannot resume session without workspace', {
            agentId: plainAgentId,
            stack: new Error().stack,
          });
          return null;
        }

        // Validate workspace ID
        if (!workspace.id) {
          logger.error('Cannot resume session with workspace missing id', {
            agentId: plainAgentId,
            workspace,
            workspaceKeys: Object.keys(workspace),
            stack: new Error().stack,
          });
          return null;
        }

        // Try to load from disk
        let session = await persistenceService.loadSession(plainAgentId, workspace.id);

        // Ensure the loaded session has the workspaceId field
        // This field might be missing from older persisted sessions
        if (session && !session.workspaceId) {
          logger.info('Adding missing workspaceId to loaded session', {
            agentId: plainAgentId,
            workspaceId: workspace.id,
          });
          session.workspaceId = workspace.id;
        }

        // Track the message count from disk so beforeunload doesn't overwrite
        // a complete session with a stale in-memory version that has fewer messages
        if (session?.messages) {
          this.diskMessageCounts.set(plainAgentId, session.messages.length);
        }

        // Handle streaming state when loading from disk
        // If the session was streaming, re-register the stream handler to continue receiving chunks
        if (session) {
          // Check for streaming messages and re-register handler if needed
          let foundStreamingMessage: AgentMessage | undefined;
          if (session.messages) {
            foundStreamingMessage = session.messages.find((msg: any) => msg.isStreaming);
            if (foundStreamingMessage) {
              const wasSavedDuringUnload =
                foundStreamingMessage.metadata?.savedDuringUnload === true;
              const isPartialMessage = foundStreamingMessage.metadata?.partial === true;

              logger.info(
                'Found incomplete streaming message after page refresh - re-registering handler',
                {
                  agentId: plainAgentId,
                  messageId: foundStreamingMessage.id,
                  hasContentBlocks: !!foundStreamingMessage.contentBlocks?.length,
                  contentBlocksCount: foundStreamingMessage.contentBlocks?.length || 0,
                  wasSavedDuringUnload,
                  isPartialMessage,
                },
              );

              // Re-register stream handler to continue receiving chunks from backend
              // Keep isStreaming=true so the UI shows the streaming state
              // Pass workspaceId so the handler knows which workspace this stream
              // belongs to. Without this, the handler is registered with workspaceId: undefined,
              // and reconnectToBackendStreams can't properly set streaming state in the store.
              this.ensureStreamHandler(plainAgentId, {
                existingMessage: foundStreamingMessage,
                workspaceId: session.workspaceId ? String(session.workspaceId) : workspace.id,
              });
            }
          }

          // Only set session.isStreaming to false if we didn't find a streaming message
          // If we found one, keep it true so the UI shows streaming state
          if (!foundStreamingMessage) {
            session.isStreaming = false;
          }

          // If session has messages but status is 'pending', update to 'active'
          // This prevents re-activation which would lose messages
          if (session.messages && session.messages.length > 0 && session.status === 'pending') {
            logger.info('Fixing status for session with messages', {
              agentId: plainAgentId,
              messageCount: session.messages.length,
              oldStatus: session.status,
            });
            session.status = 'active' as AgentStatus;
            // Also ensure it has a backendSessionId
            if (!session.backendSessionId) {
              session.backendSessionId = session.id;
            }
          }
        }

        if (!session) {
          // Session not found on disk - fall back to loading just the config
          try {
            const config = await persistenceService.loadAgentConfig(plainAgentId, workspace.id);
            if (config) {
              // Check if this is an optimistic workspace or workspace is not ready
              const isOptimisticWorkspace = workspace.id.startsWith('optimistic-');
              const hasWorkspacePath =
                workspace.worktreePath || workspace.repositoryPath || workspace.path;

              if (!isOptimisticWorkspace && hasWorkspacePath) {
                // Activate the pending agent for real workspaces with paths
                session = await agentIpcProxy.activateAgent(plainAgentId, workspace);
                // If activateAgent returns null, create a pending session from config
                // This prevents agents from disappearing when activation fails
                if (!session) {
                  logger.warn(
                    'activateAgent returned null for config-only agent, creating pending session',
                    {
                      agentId: plainAgentId,
                      workspaceId: workspace.id,
                    },
                  );
                  session = {
                    id: plainAgentId,
                    sessionId: null,
                    workspaceId: workspace.id,
                    name: config.name || 'Agent',
                    status: 'pending' as AgentStatus,
                    messages: [],
                    model: config.model || DEFAULT_AGENT_MODEL,
                    systemPrompt: config.systemPrompt,
                    createdAt: new Date(config.createdAt || Date.now()),
                    updatedAt: new Date(config.updatedAt || Date.now()),
                    metadata: config.metadata,
                    isInitialAgent: config.metadata?.isInitialAgent || false,
                    isPending: true,
                  } as any;
                }
              } else {
                // Create a pending session that will be activated later
                logger.info(
                  'Workspace not ready for activation, creating pending session from config',
                  {
                    agentId: plainAgentId,
                    workspaceId: workspace.id,
                    isOptimistic: isOptimisticWorkspace,
                    hasPath: hasWorkspacePath,
                  },
                );

                session = {
                  id: plainAgentId,
                  sessionId: null,
                  workspaceId: workspace.id,
                  name: config.name || 'Agent',
                  status: 'pending' as AgentStatus,
                  messages: [],
                  model: config.model || DEFAULT_AGENT_MODEL,
                  systemPrompt: config.systemPrompt,
                  createdAt: new Date(config.createdAt || Date.now()),
                  updatedAt: new Date(config.updatedAt || Date.now()),
                  metadata: config.metadata,
                  isInitialAgent: config.metadata?.isInitialAgent || false,
                  isPending: true,
                } as any;
              }
            } else {
              return null;
            }
          } catch (error) {
            logger.error('Failed to load session from disk', error as Error, {
              agentId: plainAgentId,
            });
            return null;
          }
        }

        // FIX: Before adding to store, check if existing session has richer data.
        // This prevents resumeSession from overwriting good in-memory data with stale disk data.
        // Uses shared comparator to also catch equal-count but truncated messages.
        const existingSession = sessionStore.getSession(plainAgentId);
        if (existingSession?.messages && session?.messages) {
          const cmp = compareMessageCompleteness(
            { messages: existingSession.messages },
            { messages: session.messages },
          );
          if (cmp > 0) {
            // Existing session is richer — merge disk metadata but keep existing messages
            logger.info('resumeSession: preserving existing session messages over stale disk data', {
              agentId: plainAgentId,
              existingCount: existingSession.messages.length,
              diskCount: session.messages.length,
            });
            session.messages = existingSession.messages;
          }
        }

        // Add to store
        sessionStore.addSession(session);
        sessionStore.setActiveSession(plainAgentId);

        // Track event
        eventCollector.track(AgentEventType.SESSION_RESUMED, {
          agentId: plainAgentId,
          workspaceId: workspace.id,
          messageCount: session?.messages?.length || 0,
        });

        return session;
      },
      'resume session',
      {
        notify: false,
        fallback: null,
        context: { agentId, workspace: workspace?.id },
      },
    );
  }

  /**
   * Send a message to an agent
   */
  async sendMessage(
    agentId: string,
    content: string,
    workspace: Workspace,
    options: {
      contextReferences?: any[];
      imageBlocks?: Array<{ type: 'image'; data: string; mimeType: string }>;
      fileBlocks?: Array<{ type: 'file'; data: string; mimeType: string; fileName: string }>;
      model?: string;
      modelId?: string;
      noteIds?: string[];
      personality?: string;
      stdinContext?: string;
      /**
       * When true, the backend will reset the ACP session before sending the message.
       * This is used for edit/regenerate flows where we need to clear the session's
       * internal history so it only sees the truncated messages.
       */
      resetHistory?: boolean;
    } = {},
  ): Promise<void> {
    this.ensureInitialized();

    // Wrap entire sendMessage operation with performance tracking
    return performanceOptimizer.track(
      `sendMessage:${agentId}`,
      async () => {
        logger.debug(`Sending message to agent ${agentId}`, {
          contentLength: content.length,
          hasContextReferences: !!options.contextReferences?.length,
          model: options.model,
        });

        // Track message sent (privacy-safe: only length, not content)
        const existingSession = sessionStore.getSession(agentId);
        track('Sent Agent Message', {
          agent_id: agentId,
          workspace_id: workspace.id,
          message_length: content.length,
          agent_name: existingSession?.name,
          agent_model: existingSession?.model,
        });

        // Store turn start time and current tool call count for duration/delta tracking
        if (existingSession) {
          // Count current total tool calls before the turn starts
          let prevToolCallCount = 0;
          if (existingSession.messages) {
            for (const msg of existingSession.messages) {
              if (msg.role === 'assistant' && msg.toolCalls) {
                prevToolCallCount += msg.toolCalls.length;
              }
            }
          }
          agentAnalyticsState.set(agentId, {
            turnStartTime: Date.now(),
            prevToolCallCount,
          });
          sessionStore.addSession(existingSession);
        }

        // Generate deduplication key for this message
        const dedupeKey = generateMessageKey(agentId, content, options.contextReferences);

        // Clear dedup cache for regenerate/edit flows to prevent stale cached results
        // from blocking the new request (the same message content produces the same key,
        // so a regenerate within the TTL window would silently return the cached void result
        // without actually sending to the backend, leaving the UI stuck on "thinking")
        if (options.resetHistory) {
          requestDeduplicator.clearKey(dedupeKey);
        }

        // Use request deduplicator to prevent duplicate messages
        await requestDeduplicator.deduplicate(
          dedupeKey,
          async () => {
            // Use error recovery for message sending
            const result = await errorRecovery.executeWithRecovery(
              async () =>
                errorBoundary.wrap(
                  async () => {
                    // Get or activate session
                    let session = sessionStore.getSession(agentId);

                    if (!session) {
                      const resumedSession = await this.resumeSession(agentId, workspace);
                      if (!resumedSession) {
                        throw new Error(`Session not found: ${agentId}`);
                      }
                      // Ensure isStreaming has a default value
                      session = {
                        ...resumedSession,
                        isStreaming: resumedSession.isStreaming ?? false,
                      };
                    } else {
                      // Ensure isStreaming has a default value for existing session
                      if (session.isStreaming === undefined) {
                        session = { ...session, isStreaming: false };
                      }
                    }

                    // Activate pending session if needed
                    // Skip activation if agent already has a backendSessionId or is already active
                    const needsActivation =
                      session &&
                      (session.status === 'pending' || !session.id) &&
                      !session.backendSessionId &&
                      session.activationState !== AgentActivationState.ACTIVE &&
                      session.activationState !== AgentActivationState.ACTIVATING;

                    if (needsActivation) {
                      // Check if this is an optimistic workspace or workspace is not ready
                      const isOptimisticWorkspace = workspace.id.startsWith('optimistic-');
                      const hasWorkspacePath =
                        workspace.worktreePath || workspace.repositoryPath || workspace.path;

                      if (!isOptimisticWorkspace && hasWorkspacePath) {
                        logger.info('Activating pending session in sendMessage', {
                          agentId,
                          status: session.status,
                          activationState: session.activationState,
                          hasBackendSessionId: !!session.backendSessionId,
                        });
                        // Activate for real workspaces with paths
                        const activatedSession = await agentIpcProxy.activateAgent(
                          agentId,
                          workspace,
                        );
                        if (activatedSession) {
                          session = activatedSession;
                        }
                      } else {
                        logger.warn('Cannot activate agent - workspace not ready', {
                          agentId,
                          workspaceId: workspace.id,
                          isOptimistic: isOptimisticWorkspace,
                          hasWorktreePath: !!workspace.worktreePath,
                          hasRepositoryPath: !!workspace.repositoryPath,
                          hasPath: !!workspace.path,
                        });
                        throw new Error(
                          'Space not ready for agent activation. Please wait for space to load.',
                        );
                      }
                    } else if (
                      session &&
                      session.status === 'pending' &&
                      session.backendSessionId
                    ) {
                      // Agent was already activated but status wasn't updated - fix it
                      logger.info('Fixing status for already-activated session', {
                        agentId,
                        backendSessionId: session.backendSessionId,
                        activationState: session.activationState,
                      });
                      session = {
                        ...session,
                        status: AgentStatus.Active,
                        activationState: AgentActivationState.ACTIVE,
                      };
                      sessionStore.addSession(session);
                    }

                    if (!session) {
                      throw new Error(`Failed to get or create session for agent ${agentId}`);
                    }

                    // Add to store after validation
                    sessionStore.addSession(session);

                    // Check if this user message already exists in recent messages
                    // Look through all messages (not just the last one) because an assistant
                    // message may have been added after the user message during streaming
                    const recentMessages = session.messages?.slice(-5) || [];
                    const incomingImageCount = options.imageBlocks?.length || 0;
                    const incomingFileCount = options.fileBlocks?.length || 0;
                    const existingUserMessage = recentMessages.find((msg: AgentMessage) => {
                      if (msg.role !== 'user') return false;
                      const msgText = msg.contentBlocks?.find((b: any) => b.type === 'text')?.text;
                      // Compare both text AND attachment counts to avoid false dedup
                      // of different image-only messages (where text is both "")
                      const msgImageCount = msg.contentBlocks?.filter((b: any) => b.type === 'image')?.length || 0;
                      const msgFileCount = msg.contentBlocks?.filter((b: any) => b.type === 'file')?.length || 0;
                      return msgText === content && msgImageCount === incomingImageCount && msgFileCount === incomingFileCount;
                    });

                    if (!existingUserMessage) {
                      // Add user message only if not already present
                      // Include image and file blocks alongside text so the UI shows attachments
                      const userContentBlocks: ContentBlock[] = [{ type: 'text' as const, text: content }];
                      if (options.imageBlocks) {
                        for (const img of options.imageBlocks) {
                          userContentBlocks.push({ type: 'image' as const, data: img.data, mimeType: img.mimeType });
                        }
                      }
                      if (options.fileBlocks) {
                        for (const file of options.fileBlocks) {
                          userContentBlocks.push({ type: 'file' as const, data: file.data, mimeType: file.mimeType, fileName: file.fileName });
                        }
                      }
                      const userMessage: AgentMessage = {
                        id: createMessageId(uuidv4()),
                        role: 'user',
                        contentBlocks: userContentBlocks,
                        timestamp: new Date().toISOString(),
                        metadata: {},
                      };

                      sessionStore.addMessage(session.id, userMessage);

                      // Save the session immediately after adding the user message
                      // This ensures the message persists even if the app crashes or refreshes
                      // For edit/regenerate flows (resetHistory), allow truncation since messages
                      // were intentionally removed before this save
                      await this.saveSession(agentId, workspace.id, true, {
                        allowTruncation: options.resetHistory,
                      });
                    } else {
                      // Remove the optimistic flag from the existing message if present
                      if (existingUserMessage.metadata) {
                        delete (existingUserMessage.metadata as any).optimistic;
                      }
                    }

                    // Clear isStreaming flag on ALL old assistant messages
                    // before starting a new stream. Without this, old messages with stale
                    // isStreaming: true cause new stream content to be written into them.
                    const preStreamSession = sessionStore.getSession(agentId);
                    if (preStreamSession?.messages) {
                      for (const msg of preStreamSession.messages) {
                        if (msg.role === 'assistant' && msg.isStreaming) {
                          logger.info('Clearing stale isStreaming flag before new message', {
                            agentId,
                            messageId: msg.id,
                            reason: 'sendMessage_new_stream',
                          });
                          sessionStore.updateMessageForWorkspace(workspace.id, agentId, msg.id, {
                            isStreaming: false,
                          });
                        }
                      }
                    }

                    // Mark as streaming
                    sessionStore.setStreaming(session.id, true);

                    // Add an empty assistant message with isStreaming: true
                    // This ensures the UI shows the streaming indicator immediately
                    // Check if this is the first message (no assistant messages yet)
                    const currentSession = sessionStore.getSession(agentId);
                    const hasAssistantMessage = currentSession?.messages?.some(
                      (m: any) => m.role === 'assistant',
                    );

                    // Only add the empty streaming message for the first interaction
                    // For follow-up messages, the streaming indicator will appear when the first chunk arrives
                    if (!hasAssistantMessage) {
                      const assistantMessage: AgentMessage = {
                        id: createMessageId(uuidv4()),
                        role: 'assistant',
                        contentBlocks: [{ type: 'text' as const, text: '' }], // Add empty text block
                        timestamp: new Date().toISOString(),
                        isStreaming: true,
                        metadata: {},
                      };
                      sessionStore.addMessage(session.id, assistantMessage);
                    }

                    // Subscribe to session-specific stream events
                    // Use the session.id for streaming
                    const streamChannel = `agent:stream:${session.id}`;

                    logger.info('Setting up stream handler', {
                      agentId,
                      streamChannel,
                      sessionId: session.id,
                    });

                    // Store the sessionId for use in the handler
                    const handlerSessionId = session.id;

                    // Store reference to the service for use in callbacks

                    // Set up a timeout to clean up the handler if no response is received
                    const streamTimeout = setTimeout(() => {
                      logger.warn('Stream timeout - cleaning up handler', {
                        agentId,
                        sessionId: session.id,
                      });

                      // CRITICAL: Flush any pending batched updates first
                      // No batching needed - updates are immediate

                      // CRITICAL: Save the current session state before marking streaming as false
                      // This ensures the messages are preserved when the UI reacts to the streaming state change
                      // Use workspace-aware lookup for cross-workspace streaming
                      const currentSession = sessionStore.getSessionForWorkspace(
                        workspace.id,
                        agentId,
                      );
                      if (
                        currentSession &&
                        currentSession.messages &&
                        currentSession.messages.length > 0
                      ) {
                        logger.info(
                          'Stream timeout - preserving session with messages before cleanup',
                          {
                            agentId,
                            messageCount: currentSession.messages.length,
                            messageRoles: currentSession.messages.map((m: any) => m.role),
                          },
                        );

                        // Ensure the session is properly saved in the store
                        sessionStore.addSession(currentSession);
                        // Note: Backend handles persistence - no need to save from frontend
                      }

                      // Use the stored handler reference for cleanup
                      logger.info('Stream timeout - cleaning up stream handler', {
                        agentId,
                        hasStoredHandler: this.activeStreamHandlers.has(agentId),
                      });
                      const storedHandler = this.activeStreamHandlers.get(agentId);
                      if (storedHandler) {
                        // Use offById for targeted cleanup - avoids removing AgentSubscriptions listener
                        if (storedHandler.listenerId) {
                          window.electronAPI.offById(
                            storedHandler.channel,
                            storedHandler.listenerId,
                          );
                        } else {
                          window.electronAPI.removeAllListeners(storedHandler.channel);
                        }
                        // FIX: Delete from the Map so a new handler can be registered
                        // when the agent is woken up or sends a new message
                        this.activeStreamHandlers.delete(agentId);
                      } else {
                        // No stored handler -- skip removeAllListeners to avoid nuking
                        // AgentSubscriptions.svelte's listener on the same channel.
                        logger.warn(
                          'No stored handler found in timeout -- cannot do targeted cleanup',
                          {
                            agentId,
                          },
                        );
                      }

                      // Use workspace-aware method for cross-workspace stream completion
                      sessionStore.setStreamingForWorkspace(workspace.id, agentId, false);

                      // Dispatch stream end event and session-updated event
                      // to ensure ChatService clears isProcessing flag on timeout
                      // FIX: Use dispatchStreamEvent which queues events if no handler registered
                      const handlerSessionId = session.id;
                      this.dispatchStreamEvent(handlerSessionId, 'end', {
                        type: 'end',
                        message: null,
                      });
                      window.dispatchEvent(
                        new CustomEvent(`agent:session-updated:${handlerSessionId}`),
                      );

                      // Remove from the map after timeout fires
                      this.streamTimeouts.delete(agentId);
                    }, AGENT_STREAMING_CONFIG.BACKEND_STREAM_TIMEOUT_MS + AGENT_STREAMING_CONFIG.FRONTEND_STREAM_CLEANUP_GRACE_MS); // Use shared config: backend timeout + grace period

                    // Store the timeout in the map so it can be cleared later
                    this.streamTimeouts.set(agentId, streamTimeout);

                    // Track text buffer and ordered items for proper interleaving
                    let textBuffer = '';
                    const orderedItems: any[] = [];
                    let hasReceivedFirstChunk = false; // Track if we've received the first text chunk
                    let chunkCount = 0; // Track total number of handler calls

                    // Helper function to build ordered content blocks
                    const buildOrderedContentBlocks = (items: any[], buffer: string) => {
                      const blocks: ContentBlock[] = [];
                      let accumulatedText = '';

                      // Process all ordered items
                      for (const item of items) {
                        if (item.type === 'text') {
                          accumulatedText += item.content;
                        } else if (item.type === 'block') {
                          // If we have accumulated text, add it as a text block first
                          if (accumulatedText) {
                            blocks.push({ type: 'text' as const, text: accumulatedText });
                            accumulatedText = '';
                          }
                          // Add the tool/other block
                          blocks.push(item.content);
                        }
                      }

                      // Add any remaining accumulated text
                      if (accumulatedText) {
                        blocks.push({ type: 'text' as const, text: accumulatedText });
                      }

                      // Add current buffer as final text if present
                      // This is for any text that hasn't been flushed to orderedItems yet
                      if (buffer) {
                        // If last block is text, append to it
                        const lastBlock = blocks[blocks.length - 1];
                        if (lastBlock && lastBlock.type === 'text') {
                          lastBlock.text += buffer;
                        } else {
                          blocks.push({ type: 'text' as const, text: buffer });
                        }
                      }

                      return blocks;
                    };

                    const streamHandler = (data: any) => {
                      chunkCount++;

                      try {
                        // Log first chunk at info level, subsequent at debug
                        if (data.type === 'chunk') {
                          if (!hasReceivedFirstChunk) {
                            hasReceivedFirstChunk = true;
                            logger.debug('Frontend received first chunk - handler is working', {
                              agentId,
                              dataLength: data.data?.length,
                              streamChannel,
                              timestamp: Date.now(),
                            });
                          }
                        }

                        // Forward the stream event to ChatService
                        // This ensures ChatService can track streaming state properly
                        if (data.type === 'chunk') {
                          // Debug level only - INFO logging here tanks performance
                          logger.debug('Dispatching chunk event to ChatService', {
                            agentId,
                            handlerSessionId,
                            eventName: `agent:stream:${handlerSessionId}`,
                            chunkLength: data.data?.length,
                          });

                          // Accumulate text in buffer
                          textBuffer += data.data || '';

                          // Update sessionStore BEFORE dispatching DOM event to ChatService.
                          // Previously, the DOM event was dispatched first, causing ChatService's
                          // flushChunkUpdate() to read stale sessionStore data.
                          // OPTIMIZED: Use efficient streaming text append without deep copying
                          // Use workspace-aware session lookup to handle cross-workspace streaming
                          // This ensures streaming continues even when user switches to a different workspace
                          const streamSession = sessionStore.getSessionForWorkspace(
                            workspace.id,
                            agentId,
                          );
                          if (!streamSession) {
                            // Session not found even with workspace-aware lookup - this is unexpected
                            logger.error(
                              'Stream session not found in workspace - this should not happen',
                              {
                                agentId,
                                workspaceId: workspace.id,
                                chunkCount,
                              },
                            );
                            return;
                          } else if (!streamSession.messages) {
                            logger.error(
                              'CRITICAL: streamSession.messages is undefined - chunks will be dropped!',
                              {
                                agentId,
                                chunkCount,
                                textBufferLength: textBuffer.length,
                                sessionKeys: Object.keys(streamSession),
                              },
                            );
                          }
                          if (streamSession && streamSession.messages) {
                            const hasStreamingMessage = streamSession.messages.some(
                              (m) => m.role === 'assistant' && m.isStreaming,
                            );

                            if (!hasStreamingMessage) {
                              // Only create initial message structure once
                              const assistantMessage: AgentMessage = {
                                id: createMessageId(uuidv4()),
                                role: 'assistant' as const,
                                contentBlocks: buildOrderedContentBlocks(orderedItems, textBuffer),
                                timestamp: new Date().toISOString(),
                                isStreaming: true,
                              };

                              // Create initial session with the message
                              const updatedSession = {
                                ...streamSession,
                                messages: [...streamSession.messages, assistantMessage],
                              };
                              sessionStore.addSession(updatedSession);
                            } else {
                              // Update the message with the full accumulated buffer
                              // Use workspace-aware update for cross-workspace streaming
                              if (streamSession.messages.length > 0) {
                                // Find the actively streaming assistant message by isStreaming flag
                                const streamingMsg = streamSession.messages.find(
                                  (m) => m.role === 'assistant' && m.isStreaming,
                                );
                                const lastMessage =
                                  streamingMsg ||
                                  streamSession.messages[streamSession.messages.length - 1];
                                if (lastMessage && lastMessage.role === 'assistant') {
                                  sessionStore.updateMessageForWorkspace(
                                    workspace.id,
                                    agentId,
                                    lastMessage.id,
                                    {
                                      contentBlocks: buildOrderedContentBlocks(
                                        orderedItems,
                                        textBuffer,
                                      ), // Use buildOrderedContentBlocks to preserve tool blocks
                                    },
                                  );
                                }
                              }
                            }
                          }

                          // Forward to ChatService AFTER sessionStore is updated
                          // This ensures ChatService reads correct data when flushChunkUpdate() runs
                          const streamEvent = new CustomEvent(`agent:stream:${handlerSessionId}`, {
                            detail: {
                              type: 'chunk',
                              content: data.data,
                              sessionId: handlerSessionId,
                            },
                          });
                          window.dispatchEvent(streamEvent);
                        } else if (data.type === 'content-blocks' && Array.isArray(data.data)) {
                          // When blocks arrive, we need to flush any accumulated text first
                          // to preserve the correct ordering of content

                          // IMPORTANT: Flush textBuffer to orderedItems BEFORE adding tool blocks
                          // This ensures text that came before the tool blocks is ordered correctly
                          if (textBuffer) {
                            orderedItems.push({
                              type: 'text',
                              content: textBuffer,
                              sequence: orderedItems.length,
                            });
                            textBuffer = ''; // Clear the buffer after flushing
                          }

                          // Handle content blocks (tool calls, etc.)
                          // Use workspace-aware session lookup for cross-workspace streaming
                          const streamSession = sessionStore.getSessionForWorkspace(
                            workspace.id,
                            agentId,
                          );
                          if (streamSession && streamSession.messages) {
                            // Create a deep copy to avoid mutation issues
                            const updatedSession = {
                              ...streamSession,
                              messages: [...streamSession.messages],
                            };

                            let assistantMessage: AgentMessage | undefined =
                              updatedSession.messages.find(
                                (m: any) => m.role === 'assistant' && m.isStreaming,
                              );

                            // Track if we're creating a new message vs updating existing
                            const isNewMessage = !assistantMessage;

                            if (!assistantMessage) {
                              // Create new assistant message with only contentBlocks
                              assistantMessage = {
                                id: createMessageId(uuidv4()),
                                role: 'assistant' as const,
                                contentBlocks: [], // Initialize contentBlocks array
                                timestamp: new Date().toISOString(),
                                isStreaming: true,
                              } as AgentMessage;
                              updatedSession.messages.push(assistantMessage);
                            }

                            // Process incoming blocks and add to ordered items
                            // IMPORTANT: Check for duplicates before adding tool blocks
                            for (const newBlock of data.data) {
                              // For tool_use blocks, check by 'id' field
                              if (newBlock.type === 'tool_use') {
                                const existingToolBlock = orderedItems.find(
                                  (item) =>
                                    item.type === 'block' &&
                                    item.content.type === 'tool_use' &&
                                    (item.content as any).id === newBlock.id,
                                );

                                if (!existingToolBlock) {
                                  // Only add if not already present
                                  orderedItems.push({
                                    type: 'block',
                                    content: newBlock,
                                    sequence: orderedItems.length,
                                  });
                                } else {
                                  // Update the existing block with the new data.
                                  // This handles the case where a skeleton was emitted first
                                  // (with vague labels) and the follow-up arrives later with
                                  // real input parameters for descriptive labels.
                                  existingToolBlock.content = newBlock;
                                  logger.debug('Updated existing tool_use block with follow-up data', {
                                    id: newBlock.id,
                                  });
                                }
                              } else if (newBlock.type === 'tool_result') {
                                // For tool_result blocks, check by 'tool_use_id' field
                                const existingResultBlock = orderedItems.find(
                                  (item) =>
                                    item.type === 'block' &&
                                    item.content.type === 'tool_result' &&
                                    (item.content as any).tool_use_id === newBlock.tool_use_id,
                                );

                                if (!existingResultBlock) {
                                  orderedItems.push({
                                    type: 'block',
                                    content: newBlock,
                                    sequence: orderedItems.length,
                                  });
                                } else {
                                  logger.debug('Skipping duplicate tool_result block', {
                                    tool_use_id: newBlock.tool_use_id,
                                  });
                                }
                              } else if (newBlock.type === 'text') {
                                // IMPORTANT: Text blocks should NOT arrive via content-blocks events
                                // Text is accumulated via 'chunk' events and stored in textBuffer
                                // If we receive text blocks here, it would cause duplication
                                // Log a warning but do NOT add to orderedItems
                                logger.warn(
                                  'Received unexpected text block in content-blocks event - ignoring to prevent duplication',
                                  {
                                    textLength: (newBlock.text || '').length,
                                    orderedItemsCount: orderedItems.length,
                                  },
                                );
                              } else {
                                // Add any other block types
                                orderedItems.push({
                                  type: 'block',
                                  content: newBlock,
                                  sequence: orderedItems.length,
                                });
                              }
                            }

                            // Find the index and update the message
                            const msgIndex = updatedSession.messages.findIndex(
                              (m: any) => m.role === 'assistant' && m.isStreaming,
                            );

                            // Use updateMessageForWorkspace instead of addSession
                            // when updating an existing message. addSession goes through setAgent's
                            // preserveStreamingMessages logic which compares message counts.
                            // Since adding a tool doesn't change the count (just updates contentBlocks),
                            // setAgent would preserve OLD messages without the tool.
                            // updateMessageForWorkspace directly updates the message, avoiding this issue.
                            if (msgIndex >= 0) {
                              const messageToUpdate = updatedSession.messages[msgIndex];
                              if (isNewMessage) {
                                // New message was created above - need to use addSession to add it
                                updatedSession.messages[msgIndex] = {
                                  ...messageToUpdate,
                                  contentBlocks: buildOrderedContentBlocks(
                                    orderedItems,
                                    textBuffer,
                                  ),
                                };
                                sessionStore.addSession(updatedSession);
                              } else {
                                // Existing message - use direct update to avoid preserveStreamingMessages issue
                                sessionStore.updateMessageForWorkspace(
                                  workspace.id,
                                  agentId,
                                  messageToUpdate.id,
                                  {
                                    contentBlocks: buildOrderedContentBlocks(
                                      orderedItems,
                                      textBuffer,
                                    ),
                                  },
                                );
                              }
                            }

                            // Dispatch content-blocks event to ChatService
                            const contentBlocksEvent = new CustomEvent(
                              `agent:stream:${handlerSessionId}`,
                              {
                                detail: {
                                  type: 'content-blocks',
                                  data: data.data,
                                },
                              },
                            );
                            window.dispatchEvent(contentBlocksEvent);
                          }
                        } else if (data.type === 'complete') {
                          try {
                            logger.debug('Stream complete - cleaning up', {
                              agentId,
                              sessionId: data.sessionId,
                              streamChannel,
                            });

                            // No batching in refactored service - updates are direct

                            // Flush any remaining text buffer
                            if (textBuffer) {
                              orderedItems.push({
                                type: 'text',
                                content: textBuffer,
                                sequence: orderedItems.length,
                              });
                              textBuffer = '';
                            }

                            // Mark streaming as complete
                            // Use workspace-aware session lookup for cross-workspace streaming
                            const streamSession = sessionStore.getSessionForWorkspace(
                              workspace.id,
                              agentId,
                            );
                            if (
                              streamSession &&
                              streamSession.messages &&
                              streamSession.messages.length > 0
                            ) {
                              // Create a deep copy to avoid mutation issues
                              const updatedSession = {
                                ...streamSession,
                                messages: [...streamSession.messages],
                              };

                              // Find the last assistant message (it should be the streaming one)
                              // We can't rely on isStreaming flag as it might be lost during persistence
                              const msgIndex = updatedSession.messages.findIndex(
                                (m, idx) =>
                                  m.role === 'assistant' &&
                                  idx === updatedSession.messages.length - 1,
                              );

                              if (msgIndex >= 0) {
                                const assistantMessage = updatedSession.messages[msgIndex];

                                // Create a new message object with isStreaming set to false
                                updatedSession.messages[msgIndex] = {
                                  ...assistantMessage,
                                  isStreaming: false,
                                };

                                // If the complete event includes final message data, update it
                                // The backend sends { type: 'complete', streamId, message: finalMessage }
                                const completeMessageData = data.message || data.data;
                                logger.info('Stream complete - checking for final message data', {
                                  agentId,
                                  hasMessage: !!data.message,
                                  hasData: !!data.data,
                                  completeMessageDataKeys: completeMessageData
                                    ? Object.keys(completeMessageData)
                                    : [],
                                  contentBlocksCount:
                                    completeMessageData?.contentBlocks?.length || 0,
                                  orderedItemsCount: orderedItems.length,
                                });

                                // IMPORTANT: Always rebuild contentBlocks from orderedItems when complete
                                // This ensures we have all accumulated text and tool blocks in the correct order
                                // The orderedItems contains the complete history of all chunks and blocks received during streaming
                                // This is critical for preserving content when the stream is interrupted

                                // Rebuild contentBlocks from orderedItems to ensure we have everything
                                const finalContentBlocks = buildOrderedContentBlocks(
                                  orderedItems,
                                  '',
                                );

                                // Use accumulated content if we have it, otherwise fall back to existing
                                if (finalContentBlocks.length > 0) {
                                  updatedSession.messages[msgIndex].contentBlocks =
                                    finalContentBlocks;
                                } else if (
                                  completeMessageData?.contentBlocks &&
                                  completeMessageData.contentBlocks.length > 0
                                ) {
                                  // Fall back to backend content blocks if orderedItems is empty
                                  // Normalize to merge adjacent text blocks from backend
                                  updatedSession.messages[msgIndex].contentBlocks =
                                    normalizeContentBlocks(completeMessageData.contentBlocks);
                                }
                                // If both are empty, keep existing contentBlocks (from streaming updates)

                                // Update metadata if provided
                                if (completeMessageData?.metadata) {
                                  updatedSession.messages[msgIndex].metadata = {
                                    ...updatedSession.messages[msgIndex].metadata,
                                    ...completeMessageData.metadata,
                                  };
                                }
                              }

                              // Always update the session to persist the final state
                              // But verify we have messages first
                              if (updatedSession.messages && updatedSession.messages.length > 0) {
                                logger.debug('Updating session after stream complete', {
                                  agentId,
                                  messageCount: updatedSession.messages.length,
                                  messageRoles: updatedSession.messages.map((m: any) => m.role),
                                });
                                // CRITICAL: Set streaming to false BEFORE calling addSession
                                // Otherwise, unifiedStateStore.setAgent's preserveStreamingMessages logic
                                // will preserve old streaming messages instead of using our updated messages
                                // Use workspace-aware method for cross-workspace stream completion
                                sessionStore.setStreamingForWorkspace(workspace.id, agentId, false);
                                // Also set isStreaming on the session object itself
                                // Otherwise, setAgent will see session.isStreaming as true and
                                // overwrite the streaming.active state we just set to false
                                updatedSession.isStreaming = false;
                                sessionStore.addSession(updatedSession);

                                // Update unified state store so BackgroundAgentExecutor subscriptions fire
                                unifiedStateStore.setAgent(workspace.id as WorkspaceId, updatedSession);

                                // Dispatch stream end event to ChatService
                                // This is critical for clearing the isProcessing flag
                                // FIX: Use dispatchStreamEvent which queues events if no handler registered
                                this.dispatchStreamEvent(handlerSessionId, 'end', {
                                  type: 'end',
                                  message: updatedSession.messages[msgIndex],
                                });
                                logger.debug('Dispatched stream end event to ChatService', {
                                  agentId,
                                  sessionId: handlerSessionId,
                                });

                                // Also dispatch session-updated event as a fallback
                                // This ensures ChatService's sessionUpdatedHandler syncs isProcessing
                                // even if the stream end event is not received
                                window.dispatchEvent(
                                  new CustomEvent(`agent:session-updated:${handlerSessionId}`),
                                );
                                logger.debug('Dispatched session-updated event as fallback', {
                                  agentId,
                                  sessionId: handlerSessionId,
                                });
                                // Note: Backend handles persistence - no need to save from frontend

                                // Track agent turn completed event
                                try {
                                  // Calculate duration from turn start time (or fall back to session creation time)
                                  let durationMs: number | undefined;
                                  const analyticsState = agentAnalyticsState.get(agentId);
                                  const turnStartTime = analyticsState?.turnStartTime;
                                  if (turnStartTime) {
                                    durationMs = Date.now() - turnStartTime;
                                  } else if (updatedSession.createdAt) {
                                    // Fallback to session creation time if turnStartTime not available
                                    const createdTime =
                                      typeof updatedSession.createdAt === 'string'
                                        ? new Date(updatedSession.createdAt).getTime()
                                        : updatedSession.createdAt.getTime();
                                    durationMs = Date.now() - createdTime;
                                  }

                                  // Count tool calls from current turn only (delta from previous count)
                                  let toolCallCount = 0;
                                  const prevToolCallCount =
                                    analyticsState?.prevToolCallCount ?? 0;
                                  if (updatedSession.messages) {
                                    let totalToolCalls = 0;
                                    for (const msg of updatedSession.messages) {
                                      if (msg.role === 'assistant' && msg.toolCalls) {
                                        totalToolCalls += msg.toolCalls.length;
                                      }
                                    }
                                    toolCallCount = totalToolCalls - prevToolCallCount;
                                  }

                                  track('Agent Turn Completed', {
                                    agent_id: agentId,
                                    agent_name: updatedSession.name,
                                    agent_model: updatedSession.model,
                                    duration_ms: durationMs,
                                    tool_call_count: toolCallCount,
                                  });
                                } catch (trackingError) {
                                  logger.warn('Failed to track Agent Turn Completed event', {
                                    error: trackingError,
                                    agentId,
                                  });
                                }
                              } else {
                                logger.error(
                                  'Stream complete but updated session has no messages!',
                                  {
                                    agentId,
                                    hasSession: !!updatedSession,
                                  },
                                );
                                // Just mark streaming as complete without updating
                                // Use workspace-aware method for cross-workspace stream completion
                                sessionStore.setStreamingForWorkspace(workspace.id, agentId, false);

                                // Update unified state store so BackgroundAgentExecutor subscriptions fire
                                // Get the session from the store to sync the unified state
                                const sessionForUnifiedSync = sessionStore.getSessionForWorkspace(
                                  workspace.id,
                                  agentId,
                                );
                                if (sessionForUnifiedSync) {
                                  unifiedStateStore.setAgent(
                                    workspace.id as WorkspaceId,
                                    sessionForUnifiedSync,
                                  );
                                }

                                // Still dispatch stream end event to clear isProcessing flag
                                // FIX: Use dispatchStreamEvent which queues events if no handler registered
                                this.dispatchStreamEvent(handlerSessionId, 'end', {
                                  type: 'end',
                                  message: null,
                                });

                                // Also dispatch session-updated event as a fallback
                                window.dispatchEvent(
                                  new CustomEvent(`agent:session-updated:${handlerSessionId}`),
                                );
                              }
                            } else {
                              // Just mark streaming as complete without updating session
                              logger.debug('Stream complete but no messages to update', {
                                agentId,
                              });
                              // Use workspace-aware method for cross-workspace stream completion
                              sessionStore.setStreamingForWorkspace(workspace.id, agentId, false);

                              // Update unified state store so BackgroundAgentExecutor subscriptions fire
                              // Get the session from the store to sync the unified state
                              const sessionForUnifiedSync = sessionStore.getSessionForWorkspace(
                                workspace.id,
                                agentId,
                              );
                              if (sessionForUnifiedSync) {
                                unifiedStateStore.setAgent(
                                  workspace.id as WorkspaceId,
                                  sessionForUnifiedSync,
                                );
                              }

                              // Still dispatch stream end event to clear isProcessing flag
                              // FIX: Use dispatchStreamEvent which queues events if no handler registered
                              this.dispatchStreamEvent(handlerSessionId, 'end', {
                                type: 'end',
                                message: null,
                              });

                              // Also dispatch session-updated event as a fallback
                              window.dispatchEvent(
                                new CustomEvent(`agent:session-updated:${handlerSessionId}`),
                              );
                            }

                            // Mark agent as having unread messages (if user isn't currently viewing it)
                            // Pass workspaceId to enable cross-workspace tab indicators
                            // Pass isBackground to skip unread tracking for background agents
                            const sessionForUnread = sessionStore.getSessionForWorkspace(
                              workspace.id,
                              agentId,
                            );
                            const isBackgroundAgent =
                              sessionForUnread?.isBackground ||
                              sessionForUnread?.metadata?.isBackground ||
                              false;
                            unreadTrackingService.onNewAssistantMessage(
                              agentId,
                              workspace.id,
                              isBackgroundAgent,
                            );

                            // Clean up the stream listener and timeout
                            clearTimeout(streamTimeout);
                            this.streamTimeouts.delete(agentId); // Remove from map using service reference

                            // Use the stored handler reference for cleanup
                            // This is a critical point - we're about to remove the handler
                            // If a queued message is processed, it needs to re-register the handler
                            logger.debug('Cleaning up stream handler after complete event', {
                              agentId,
                              hasStoredHandler: this.activeStreamHandlers.has(agentId),
                              channel: this.activeStreamHandlers.get(agentId)?.channel,
                              timestamp: Date.now(),
                              note: 'If queued messages exist, backend will send agent:queue:processing to re-register',
                            });
                            const storedHandler = this.activeStreamHandlers.get(agentId);
                            if (storedHandler) {
                              // Use offById for targeted cleanup - avoids removing AgentSubscriptions listener
                              if (storedHandler.listenerId) {
                                window.electronAPI.offById(
                                  storedHandler.channel,
                                  storedHandler.listenerId,
                                );
                              } else {
                                window.electronAPI.removeAllListeners(storedHandler.channel);
                              }
                              // FIX: Delete from the Map so a new handler can be registered
                              // when the agent is woken up or sends a new message
                              this.activeStreamHandlers.delete(agentId);
                              logger.debug('Stream handler removed from activeStreamHandlers', {
                                agentId,
                                removedChannel: storedHandler.channel,
                                remainingHandlers: this.activeStreamHandlers.size,
                              });
                            } else {
                              // No stored handler -- skip removeAllListeners to avoid nuking
                              // AgentSubscriptions.svelte's listener on the same channel.
                              logger.warn('No stored handler found -- cannot do targeted cleanup', {
                                agentId,
                                streamChannel,
                              });
                            }
                          } catch (error) {
                            logger.error('Error in streamHandler for complete processing', {
                              error,
                              agentId,
                              streamChannel,
                            });
                          }
                        } else if (data.type === 'error') {
                          // Handle error
                          const error = new AgentError(data.data?.message || 'The response was interrupted. Please try again.', {
                            code: ErrorCode.MESSAGE_SEND_FAILED,
                            category: ErrorCategory.COMMUNICATION,
                            severity: ErrorSeverity.HIGH,
                            context: { agentId, originalError: data.data },
                          });
                          errorHandler.track(error);
                          logger.error('Stream error', { agentId, error: data.data });

                          // Dispatch error event to ChatService to clear isProcessing flag
                          // FIX: Use dispatchStreamEvent which queues events if no handler registered
                          this.dispatchStreamEvent(handlerSessionId, 'error', {
                            type: 'error',
                            error: data.data?.message || 'The response was interrupted. Please try again.',
                          });

                          // Also dispatch session-updated event as a fallback
                          window.dispatchEvent(
                            new CustomEvent(`agent:session-updated:${handlerSessionId}`),
                          );

                          // Use workspace-aware method for cross-workspace stream completion
                          sessionStore.setStreamingForWorkspace(workspace.id, agentId, false);
                          // Clean up the stream listener and timeout
                          clearTimeout(streamTimeout);
                          this.streamTimeouts.delete(agentId); // Remove from map using service reference

                          // Use the stored handler reference for cleanup
                          logger.info('Stream error - cleaning up stream handler', {
                            agentId,
                            hasStoredHandler: this.activeStreamHandlers.has(agentId),
                          });
                          const storedHandler = this.activeStreamHandlers.get(agentId);
                          if (storedHandler) {
                            // Use offById for targeted cleanup - avoids removing AgentSubscriptions listener
                            if (storedHandler.listenerId) {
                              window.electronAPI.offById(
                                storedHandler.channel,
                                storedHandler.listenerId,
                              );
                            } else {
                              window.electronAPI.removeAllListeners(storedHandler.channel);
                            }
                            // FIX: Delete from the Map so a new handler can be registered
                            // when the agent is woken up or sends a new message
                            this.activeStreamHandlers.delete(agentId);
                          } else {
                            // No stored handler -- skip removeAllListeners to avoid nuking
                            // AgentSubscriptions.svelte's listener on the same channel.
                            logger.warn('No stored handler found -- cannot do targeted cleanup', {
                              agentId,
                            });
                          }
                        }
                      } catch (error) {
                        logger.error('Error in streamHandler', {
                          error,
                          dataType: data?.type,
                          agentId,
                          streamChannel,
                        });
                      }
                    };

                    // Check if electronAPI is available
                    if (!window.electronAPI) {
                      logger.error('window.electronAPI is not available!', {
                        agentId,
                        streamChannel,
                      });
                      throw new Error('Electron API not available');
                    }

                    // Clean up any existing handler for this agent before registering a new one
                    logger.info('Checking for existing stream handler', {
                      agentId,
                      activeHandlersCount: this.activeStreamHandlers.size,
                      hasHandler: this.activeStreamHandlers.has(agentId),
                      allHandlerKeys: Array.from(this.activeStreamHandlers.keys()),
                    });

                    const existingHandler = this.activeStreamHandlers.get(agentId);

                    if (existingHandler) {
                      // Always clean up existing handler when sending a NEW message.
                      // The old handler has stale state (orderedItems, textBuffer) that would cause
                      // the new response content to be incorrectly appended to old content.
                      // This commonly happens when:
                      // 1. Page refresh during streaming -> handler registered via registerStreamHandlerForSession
                      // 2. User sends new message -> old handler with old content state is reused
                      // 3. New response is APPENDED to old content instead of REPLACING it
                      logger.info(
                        'Cleaning up existing stream handler before sending new message',
                        {
                          agentId,
                          existingChannel: existingHandler.channel,
                          newChannel: streamChannel,
                          reason: 'new_message_requires_fresh_handler_state',
                        },
                      );

                      // Clear map entry for existing handler
                      this.activeStreamHandlers.delete(agentId);

                      // Also clear pending stream registrations to prevent
                      // a concurrent registerStreamHandlerForSession from completing after
                      // this cleanup and re-registering a stale handler with old state.
                      this.pendingStreamRegistrations.delete(agentId);

                      // Clear any pending timeout for the old handler
                      const existingTimeout = this.streamTimeouts.get(agentId);
                      if (existingTimeout) {
                        clearTimeout(existingTimeout);
                        this.streamTimeouts.delete(agentId);
                      }
                    }

                    // Clean up the existing handler's IPC listener if we have one.
                    // Use offById for targeted cleanup to avoid nuking other listeners on the
                    // same channel (e.g., AgentSubscriptions.svelte's content-blocks listener).
                    if (existingHandler) {
                      if (existingHandler.listenerId) {
                        window.electronAPI.offById(streamChannel, existingHandler.listenerId);
                      } else {
                        // Legacy fallback -- handler was registered before offById support
                        window.electronAPI.removeAllListeners(streamChannel);
                      }
                    }
                    logger.debug('Cleaned up IPC listeners before registering new handler', {
                      agentId,
                      streamChannel,
                      hadExistingHandler: !!existingHandler,
                    });

                    // Log when registering the handler
                    logger.info('Registering stream handler', {
                      agentId,
                      streamChannel,
                      timestamp: new Date().toISOString(),
                      hasElectronAPI: !!window.electronAPI,
                      hasOnMethod: !!(window.electronAPI && window.electronAPI.on),
                    });

                    // Subscribe to the stream channel -- capture listener ID for targeted
                    // cleanup via offById() to avoid nuking other listeners on the same channel.
                    const streamListenerId = window.electronAPI.on(streamChannel, streamHandler);

                    // Store the handler reference for proper cleanup
                    // Check if the preload script added a wrapper
                    const wrappedHandler = (streamHandler as any).__ipcWrapper;

                    this.activeStreamHandlers.set(agentId, {
                      channel: streamChannel,
                      handler: streamHandler,
                      wrappedHandler: wrappedHandler || undefined,
                      workspaceId: workspace.id,
                      listenerId: streamListenerId,
                      registeredAt: Date.now(),
                    });

                    // Register IPC heartbeat ping handler - responds with pong to verify IPC liveness
                    const pingChannel = `agent:stream:ping:${agentId}`;
                    const pingHandler = (data: { agentId: string; timestamp: number }) => {
                      logger.debug('IPC heartbeat: received ping, sending pong', {
                        agentId,
                        timestamp: data.timestamp,
                      });
                      window.electronAPI.send('agent:stream:pong', { agentId });
                    };
                    const pingListenerId = window.electronAPI.on(pingChannel, pingHandler);
                    this.activePingHandlers.set(agentId, {
                      channel: pingChannel,
                      handler: pingHandler,
                      listenerId: pingListenerId,
                    });

                    logger.info('Stream handler registered successfully', {
                      agentId,
                      streamChannel,
                      pingChannel,
                      workspaceId: workspace.id,
                      activeHandlersCount: this.activeStreamHandlers.size,
                      hasStoredHandler: this.activeStreamHandlers.has(agentId),
                      hasWrappedHandler: !!wrappedHandler,
                    });

                    try {
                      // IMPORTANT: Only pass messages to backend for edit/regenerate flows.
                      // In normal message flows, the backend loads messages from persistence,
                      // which doesn't include the streaming placeholder assistant message.
                      //
                      // Previously, we always passed currentMessages from sessionStore, which
                      // caused issues when:
                      // 1. User sends message
                      // 2. Empty assistant message is added to sessionStore for streaming UI
                      // 3. Messages are sent to backend (user + empty assistant)
                      // 4. ACP rejects because last message is not from user
                      //
                      // For edit/regenerate flows (resetHistory=true), we need to pass the
                      // truncated messages so the backend uses them instead of stale history.
                      let messagesToSend: any[] | undefined = undefined;

                      if (options.resetHistory) {
                        // Edit/regenerate flow: pass truncated messages from sessionStore
                        const currentSession = sessionStore.getSession(agentId);
                        const currentMessages = currentSession?.messages || [];

                        // Filter out empty streaming placeholder assistant messages.
                        // These are added for UI purposes but shouldn't be sent to the backend.
                        // IMPORTANT: Only filter out messages that are actively streaming AND have
                        // no real content. Non-streaming assistant messages (even those without a
                        // text block, e.g. tool-call-only responses) must be preserved so that
                        // conversation history stays intact during edit/regenerate flows.
                        messagesToSend = currentMessages.filter((m: any) => {
                          // Keep all non-assistant messages
                          if (m.role !== 'assistant') return true;

                          // For non-streaming assistant messages, always keep them
                          if (m.isStreaming !== true) return true;

                          // For streaming assistant messages, keep only if they have real content
                          const hasAnyContent = m.contentBlocks?.some((b: any) => {
                            if (b.type === 'text') return b.text && b.text.trim().length > 0;
                            // Non-text blocks (tool_call, image, etc.) count as real content
                            return true;
                          });
                          return !!hasAnyContent;
                        });

                        logger.info(
                          'Frontend: Edit/regenerate flow - sending filtered messages from sessionStore',
                          {
                            agentId,
                            sessionId: session.id,
                            originalMessageCount: currentMessages.length,
                            filteredMessageCount: messagesToSend.length,
                            messageRoles: messagesToSend.map((m: any) => m.role),
                            resetHistory: options.resetHistory,
                          },
                        );
                      } else {
                        logger.info(
                          'Frontend: Normal message flow - backend will load messages from persistence',
                          {
                            agentId,
                            sessionId: session.id,
                          },
                        );
                      }

                      // Send message to backend
                      logger.info(
                        'Agent Service: Sending message to backend with image and file blocks',
                        {
                          agentId,
                          sessionId: session.id,
                          hasImageBlocks: !!options.imageBlocks,
                          imageBlocksCount: options.imageBlocks?.length || 0,
                          imageBlockDetails:
                            options.imageBlocks?.map((b) => ({
                              type: b.type,
                              mimeType: b.mimeType,
                              dataLength: b.data?.length || 0,
                            })) || [],
                          hasFileBlocks: !!options.fileBlocks,
                          fileBlocksCount: options.fileBlocks?.length || 0,
                          fileBlockDetails:
                            options.fileBlocks?.map((b) => ({
                              type: b.type,
                              fileName: b.fileName,
                              mimeType: b.mimeType,
                              dataLength: b.data?.length || 0,
                            })) || [],
                          // Debug: specialist metadata being sent
                          hasBehaviorPrompt: !!session.metadata?.behaviorPrompt,
                          behaviorPromptLength:
                            typeof session.metadata?.behaviorPrompt === 'string'
                              ? session.metadata.behaviorPrompt.length
                              : 0,
                          specialist: session.metadata?.specialist,
                        },
                      );

                      const response = await invoke<any>(AGENT_BACKEND_CHANNELS.STREAM_MESSAGE, {
                        agentId,
                        sessionId: session.id,
                        content,
                        workspaceId: workspace.id,
                        model: options.model || options.modelId || session.model,
                        contextReferences: options.contextReferences,
                        imageBlocks: options.imageBlocks,
                        fileBlocks: options.fileBlocks,
                        noteIds: options.noteIds,
                        personality: options.personality,
                        stdinContext: options.stdinContext,
                        // Only pass messages for edit/regenerate flows
                        // For normal flows, backend loads from persistence (avoids streaming placeholder issue)
                        messages: messagesToSend,
                        // Reset ACP session for edit/regenerate flows
                        // This clears the session's internal history so it only sees the truncated messages
                        resetHistory: options.resetHistory,
                        // Pass specialist metadata from session for first message (before persistence has it)
                        // This handles the case where user selects specialist before sending any messages
                        behaviorPrompt: session.metadata?.behaviorPrompt,
                        specialist: session.metadata?.specialist,
                      });

                      // Check if the response is in IpcResponse format
                      if (response && typeof response === 'object' && 'success' in response) {
                        if (!response.success) {
                          throw new Error(
                            response.error?.message || 'Failed to send message to backend',
                          );
                        }
                      }

                      // Track event
                      eventCollector.track(AgentEventType.MESSAGE_SENT, {
                        agentId,
                        workspaceId: workspace.id,
                        messageLength: content.length,
                        hasContext: !!options.contextReferences?.length,
                      });

                      // Track metrics
                      workspaceMetrics.incrementMessageSent(workspace.id);
                    } catch (error) {
                      // NOTE: Do NOT dispatch error events here — this catch block fires on
                      // EVERY error-boundary retry attempt. Dispatching here would cause
                      // isStreaming to flash false→true→false on each retry, creating a
                      // visible UI flicker. Instead, the error dispatch happens AFTER all
                      // retries are exhausted (see the !result.success block below).

                      // Clean up the stream listener on error
                      logger.info('Catch block - cleaning up stream handler', {
                        agentId,
                        hasStoredHandler: this.activeStreamHandlers.has(agentId),
                      });
                      const storedHandler = this.activeStreamHandlers.get(agentId);
                      if (storedHandler) {
                        // Use offById for targeted cleanup - avoids removing AgentSubscriptions listener
                        if (storedHandler.listenerId) {
                          window.electronAPI.offById(
                            storedHandler.channel,
                            storedHandler.listenerId,
                          );
                        } else {
                          window.electronAPI.removeAllListeners(storedHandler.channel);
                        }
                        // FIX: Delete from the Map so a new handler can be registered
                        // when the agent is woken up or sends a new message
                        this.activeStreamHandlers.delete(agentId);
                      } else {
                        // No stored handler -- skip removeAllListeners to avoid nuking
                        // AgentSubscriptions.svelte's listener on the same channel.
                        logger.warn(
                          'No stored handler found in catch block -- cannot do targeted cleanup',
                          {
                            agentId,
                          },
                        );
                      }
                      throw error;
                    }
                  },
                  'send message',
                  {
                    retries: 2,
                    notify: false,
                    context: { agentId, workspace: workspace.id },
                  },
                ),
              DEFAULT_STRATEGIES.streaming,
              `send-message-${agentId}`,
            );

            if (!result.success) {
              // Dispatch error event to ChatService AFTER all retries are
              // exhausted. This ensures ChatService receives the error and clears
              // isStreaming/isProcessing even if the backend's stream error event
              // (sent via one-way IPC) was dropped due to handler cleanup.
              // This is done here (not in the inner catch block) to avoid state flashing
              // during intermediate retry attempts.
              const finalErrorMsg = result.error instanceof Error ? result.error.message : 'Something went wrong';
              this.dispatchStreamEvent(agentId, 'error', {
                type: 'error',
                error: finalErrorMsg,
              });
              window.dispatchEvent(
                new CustomEvent(`agent:session-updated:${agentId}`),
              );

              // Don't re-wrap - the error already has a clean user-facing message
              // from the error boundary service
              throw result.error || new Error('Something went wrong. Please try again.');
            }
          },
          { ttl: 3000 }, // Cache for 3 seconds to prevent rapid duplicate messages
        );
      },
      {
        memoize: false, // Don't memoize message sending
        coalesce: true, // Coalesce duplicate requests
        priority: 'high',
        // No timeout - let the agent take as long as it needs
      },
    );
  }

  /**
   * Add an optimistic message to the session
   * This is used to immediately show user messages in the UI before backend processing
   */
  addOptimisticMessage(agentId: string, message: AgentMessage): void {
    sessionStore.addMessage(agentId, message);
  }

  /**
   * Save a session to disk (explicit save)
   *
   * NOTE: This is generally not needed - the backend automatically persists
   * sessions after streaming completes. Use this only for explicit saves
   * outside of the normal streaming flow (e.g., manual metadata updates).
   */
  async saveSession(agentId: string, workspaceId: string, immediate = false, options?: { allowTruncation?: boolean }): Promise<void> {
    const session = sessionStore.getSession(agentId);
    if (!session) {
      logger.warn('Cannot save session - session not found', { agentId });
      return;
    }

    // Safety check: Don't save if messages are missing when they shouldn't be
    if (!session.messages || session.messages.length === 0) {
      logger.warn('Session has no messages, checking if this is expected', {
        agentId,
        isProcessing: session.isProcessing,
        isStreaming: session.isStreaming,
      });

      // If the session is processing or was recently active, this might be a bug
      // Don't save to avoid overwriting good data with bad
      if (session.isProcessing || session.isStreaming) {
        logger.error('Refusing to save session with no messages while processing/streaming', {
          agentId,
        });
        return;
      }
    }

    await persistenceService.saveSession(session, workspaceId, { immediate, allowTruncation: options?.allowTruncation });
  }

  /**
   * Stop a streaming session
   */
  async stopSession(agentId: string): Promise<void> {
    // CRITICAL: Clear the request deduplication cache for this agent
    // This ensures that if the user sends the same message again after stopping,
    // it won't be deduplicated against the interrupted request.
    // Without this, sending the same message within 5 seconds of stopping
    // would return the cached result instead of executing a new request.
    requestDeduplicator.clearKeysForAgent(agentId);

    // Streaming is handled by ConsolidatedBackendService
    const tempSession = sessionStore.getSession(agentId);
    if (tempSession) {
      sessionStore.setStreaming(tempSession.id, false);
    }

    // Stop backend
    const session = sessionStore.getSession(agentId);
    if (session?.id) {
      const response = await invoke<any>(AGENT_BACKEND_CHANNELS.STOP, {
        agentId,
        sessionId: session.id,
      });

      // Check if the response is in IpcResponse format
      if (response && typeof response === 'object' && 'success' in response) {
        if (!response.success) {
          throw new Error(response.error?.message || 'Failed to stop session');
        }
      }

      // Track agent stopped
      track('Stopped Agent', {
        agent_id: agentId,
        workspace_id: session.workspaceId || '',
        agent_name: session.name,
        agent_model: session.model,
      });
    }
  }

  /**
   * Soft delete a session (for undo functionality).
   * NOTE: Prefer deleteSessionWithUndo() which handles the full lifecycle.
   * This is kept for internal use only.
   */
  async softDeleteSession(agentId: string): Promise<AgentSession | null> {
    const session = sessionStore.getSession(agentId);
    if (!session) return null;

    // Stop streaming if active
    await this.stopSession(agentId);

    // No state machine cleanup needed with new architecture

    // Remove from store but keep the session object for undo
    sessionStore.removeSession(agentId);

    // Clean up analytics tracking state
    agentAnalyticsState.delete(agentId);

    // Clear unread status for deleted agent
    unreadTrackingService.clearUnread(agentId);

    // Track event
    eventCollector.track(AgentEventType.SESSION_DELETED, {
      agentId,
      workspaceId: session.workspaceId,
      isSoftDelete: true,
    });

    return session;
  }

  // Track pending undo-able deletions so they can be flushed on cleanup.
  // Stores the timeout handle AND the workspaceId so beforeunload can pass the
  // workspace context to deleteSession (the session is already removed from
  // sessionStore after soft delete, so we can't look it up there).
  private pendingDeletions = new Map<
    string,
    { timeoutId: ReturnType<typeof setTimeout>; workspaceId?: string }
  >();

  /**
   * Delete a session with undo support.
   * Immediately removes from UI, shows a toast with undo, then permanently deletes after timeout.
   * Returns the saved session if soft delete succeeded (null if no session existed).
   *
   * This is the primary deletion method for user-initiated deletes. It prevents the bug where
   * softDeleteSession is called without a follow-up permanent deleteSession.
   */
  async deleteSessionWithUndo({
    agentId,
    workspaceId,
    agentName,
  }: {
    agentId: string;
    workspaceId?: string;
    agentName?: string;
  }): Promise<AgentSession | null> {
    const savedSession = await this.softDeleteSession(agentId);

    if (!savedSession) {
      // No session found in memory - fall back to immediate permanent delete
      await this.deleteSession(agentId, workspaceId);
      return null;
    }

    const effectiveWorkspaceId = workspaceId || savedSession.workspaceId;
    let undoClicked = false;

    const { toast } = await import('svelte-sonner');
    const displayName = agentName || savedSession.name || '';
    const toastId = toast.warning(
      displayName ? `Deleted "${displayName}"` : 'Agent deleted',
      {
        duration: 15000,
        action: {
          label: 'Undo',
          onClick: () => {
            undoClicked = true;
            this.pendingDeletions.delete(agentId);
            sessionStore.addSession(savedSession);
            toast.dismiss(toastId);
          },
        },
      },
    );

    // Schedule permanent deletion after undo window
    const timeoutId = setTimeout(async () => {
      this.pendingDeletions.delete(agentId);
      if (!undoClicked) {
        try {
          await this.deleteSession(agentId, effectiveWorkspaceId);
          logger.info('Agent permanently deleted after undo window', { agentId });
        } catch (err) {
          logger.error('Failed to permanently delete agent', { agentId, error: err });
        }
      }
    }, 15000);

    this.pendingDeletions.set(agentId, { timeoutId, workspaceId: effectiveWorkspaceId });

    return savedSession;
  }

  /**
   * Flush all pending undo-able deletions immediately (e.g., on page unmount).
   * This ensures agents that were soft-deleted but not yet permanently deleted
   * don't come back when the Space is reopened.
   */
  async flushPendingDeletions(workspaceId?: string): Promise<void> {
    if (this.pendingDeletions.size === 0) return;

    logger.info('Flushing pending agent deletions', { count: this.pendingDeletions.size });
    const entries = [...this.pendingDeletions.entries()];
    this.pendingDeletions.clear();

    for (const [agentId, { timeoutId, workspaceId: storedWorkspaceId }] of entries) {
      clearTimeout(timeoutId);
      try {
        await this.deleteSession(agentId, workspaceId || storedWorkspaceId);
        logger.info('Agent deleted during flush', { agentId });
      } catch (error) {
        logger.error('Failed to delete agent during flush', { agentId, error });
      }
    }
  }

  /**
   * Delete a session
   */
  async deleteSession(agentId: string, workspaceId?: string): Promise<void> {
    const session = sessionStore.getSession(agentId);

    // Even if session is not found in memory, we should still try to delete from disk
    // This can happen if the agent was already soft-deleted but needs permanent deletion

    if (session) {
      // Stop streaming if active
      await this.stopSession(agentId);
    }

    // Delete from factory - pass workspace if available for proper deletion
    // The browser proxy will handle the workspace-aware deletion
    const effectiveWorkspaceId = workspaceId || session?.workspaceId;
    if (effectiveWorkspaceId) {
      // Create a minimal workspace object with required fields
      const workspace = {
        id: effectiveWorkspaceId,
        title: '',
        branch: '',
        status: 'active',
        changesets: [],
        timeline: [],
        conversationInfo: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as unknown as Workspace;
      await agentIpcProxy.deleteAgent(agentId, workspace);

      // Note: Agent cleanup from task notes is handled by the backend during deleteAgent IPC call
      // The main process agent.this.ts handles removeAgentFromAllTasks
    } else {
      // Fallback to simple deletion without workspace
      // This should rarely happen but we still attempt deletion
      logger.warn('Deleting agent without workspace context', { agentId });
      await agentIpcProxy.deleteAgent(agentId);
    }

    // No state machine cleanup needed with new architecture

    // Remove from store if session exists
    if (session) {
      sessionStore.removeSession(agentId);
    }

    // Clean up analytics tracking state
    agentAnalyticsState.delete(agentId);

    // Clear unread status for deleted agent
    unreadTrackingService.clearUnread(agentId);

    // Track event
    eventCollector.track(AgentEventType.SESSION_DELETED, {
      agentId,
      workspaceId: effectiveWorkspaceId || 'unknown',
    });
  }

  /**
   * Get a session by ID
   * Uses clean agent service for retrieval
   */
  getSession(agentId: string): AgentSession | null {
    this.ensureInitialized();

    // Ensure agentId is a plain string (not a Proxy)
    const plainAgentId = agentId ? String(agentId) : '';

    // Try to get agent from state
    const workspace = unifiedStateStore.currentWorkspace;
    const agentStateValue = workspace?.agents.get(plainAgentId as any);
    if (agentStateValue) {
      const session = agentStateValue.session;

      // Ensure the session has workspaceId
      // This can be missing if the session was created without proper workspace context
      if (session && !session.workspaceId) {
        // Try to infer workspaceId from other sessions or current context
        const allSessions = this.getAllSessions();
        const otherSessionWithWorkspace = allSessions.find((s) => s.workspaceId);
        if (otherSessionWithWorkspace) {
          logger.warn('Session missing workspaceId, inferring from other sessions', {
            agentId: plainAgentId,
            inferredWorkspaceId: otherSessionWithWorkspace.workspaceId,
          });
          session.workspaceId = otherSessionWithWorkspace.workspaceId;
        }
      }

      return session;
    }

    // Fall back to sessionStore (secondary source)
    const session = sessionStore.getSession(plainAgentId);

    // Ensure the session has workspaceId
    if (session && !session.workspaceId) {
      // Try to infer workspaceId from other sessions or current context
      const allSessions = this.getAllSessions();
      const otherSessionWithWorkspace = allSessions.find((s) => s.workspaceId);
      if (otherSessionWithWorkspace) {
        logger.warn(
          'Session missing workspaceId (from sessionStore), inferring from other sessions',
          {
            agentId: plainAgentId,
            inferredWorkspaceId: otherSessionWithWorkspace.workspaceId,
          },
        );
        session.workspaceId = otherSessionWithWorkspace.workspaceId;
      }
    }

    return session ?? null;
  }

  /**
   * Get all sessions
   */
  getAllSessions(): AgentSession[] {
    return sessionStore.getAllSessions();
  }

  /**
   * Get sessions for a workspace (excluding background agents)
   */
  getSessionsForWorkspace(workspaceId: string): AgentSession[] {
    // Use unifiedStateStore.getAgentsForWorkspace to directly query by workspace ID
    // This avoids relying on currentWorkspaceId being set correctly
    const allSessions = unifiedStateStore.getAgentsForWorkspace(workspaceId as any);

    logger.debug('getSessionsForWorkspace - checking all sessions', {
      requestedWorkspaceId: workspaceId,
      totalSessions: allSessions.length,
      sessionsWithWorkspace: allSessions.map((s) => ({
        id: s.id,
        workspaceId: s.workspaceId,
        workspaceIdType: typeof s.workspaceId,
        isBackground: !!(s as any).isBackground || !!(s.metadata as any)?.isBackground,
      })),
    });

    // Filter out background agents
    const filtered = allSessions.filter((s: any) => {
      const isBackground = !!(s as any).isBackground || !!(s.metadata as any)?.isBackground;
      return !isBackground;
    });

    logger.debug('getSessionsForWorkspace - filtered results', {
      requestedWorkspaceId: workspaceId,
      filteredCount: filtered.length,
      filteredIds: filtered.map((s: any) => s.id),
    });

    return filtered;
  }

  /**
   * Set active session
   */
  setActiveSession(agentId: string | null): void {
    if (agentId) {
      sessionStore.setActiveSession(agentId);
    }
  }

  /**
   * Get active session
   */
  getActiveSession(): AgentSession | null {
    return sessionStore.getActiveSession() ?? null;
  }

  /**
   * Track file changes for an agent
   */
  trackFileChanges(agentId: string, fileChanges: any[]): void {
    agentFileTracker.trackChanges(agentId, fileChanges);
  }

  /**
   * Get file changes for an agent
   */
  getFileChanges(agentId: string): any[] {
    return agentFileTracker.getChanges(agentId);
  }

  /**
   * Enhance a prompt using AI
   */
  async enhancePrompt(prompt: string, workspace: Workspace, modelId?: string): Promise<string> {
    try {
      const result = (await invoke<CommandResponse<{ enhanced: string }>>('agent:enhance-prompt', {
        prompt,
        workspaceId: workspace.id,
        modelId: modelId || DEFAULT_AGENT_MODEL,
      })) as CommandResponse<{ enhanced: string }>;

      if (result?.success && result?.data?.enhanced) {
        return result.data.enhanced;
      }

      return prompt;
    } catch (error) {
      logger.error('Failed to enhance prompt', error as Error, { promptLength: prompt.length });
      return prompt;
    }
  }

  /**
   * Get agents list for a workspace (alias for listSessions)
   */
  async getAgentsList(workspaceId: string): Promise<AgentSession[]> {
    return this.listSessions(workspaceId);
  }

  /**
   * Create a new agent using clean services
   * Delegates to cleanAgentService for actual creation
   *
   * IMPORTANT: Use agentType (branded AgentTypeId) to let backend build system prompt.
   * Import createAgentTypeId from '$shared/types/agent.types' and use it to create the branded type.
   */
  async createAgent(workspace: Workspace, options?: any): Promise<AgentSession | null> {
    this.ensureInitialized();

    // Validate workspace
    if (!workspace) {
      logger.error('Cannot create agent without workspace');
      return null;
    }

    // Validate workspace ID
    if (!workspace.id) {
      logger.error('Cannot create agent with workspace missing id', {
        workspace,
        workspaceKeys: Object.keys(workspace),
        options,
      });
      return null;
    }

    logger.info(`Creating agent via clean services for workspace ${workspace.id}`, {
      workspaceName: workspace.name,
      options,
    });

    try {
      // Use agent service for creation
      const session = await agentService.createSession(workspace, {
        name: options?.name,
        model: options?.model,
        provider: options?.provider,
        agentType: options?.agentType,
        initialMessage: options?.initialMessage,
        behaviorPrompt: options?.behaviorPrompt,
        metadata: {
          ...options?.metadata,
          agentType: options?.agentType,
          originalAgentId: options?.agentId,
          contextReferences: options?.contextReferences,
        },
      });

      if (session) {
        logger.info('Successfully created agent via clean services', {
          agentId: session.id,
          workspaceId: session.workspaceId,
          name: session.name,
        });

        // Add to sessionStore (secondary source)
        sessionStore.addSession(session);
        sessionStore.setActiveSession(session.id);

        // Track agent creation
        track('Created Agent', {
          agent_id: session.id,
          workspace_id: session.workspaceId || workspace.id,
          agent_name: session.name,
          agent_model: session.model,
          source: 'background-agent',
        });
      }

      return session;
    } catch (error) {
      logger.error('Failed to create agent for workspace', error as Error, {
        workspaceId: workspace.id,
      });
      throw error;
    }
  }

  /**
   * Subscribe to agent store changes
   */
  subscribe(callback: (state: any) => void): () => void {
    return sessionStore.getStore().subscribe(callback);
  }

  /**
   * Add a session to the store
   */
  addSession(session: AgentSession): void {
    sessionStore.addSession(session);
  }

  /**
   * Restore a session from disk (alias for resumeSession)
   */
  async restoreSession(
    agentId: string,
    workspace: Workspace,
    _existingSessionId?: string,
  ): Promise<AgentSession | null> {
    // Ensure agentId is a plain string (not a Proxy)
    const plainAgentId = agentId ? String(agentId) : '';
    return this.resumeSession(plainAgentId, workspace);
  }

  /**
   * Restore a session without backend (for loading from disk only)
   */
  async restoreSessionWithoutBackend(
    agentId: string,
    workspace: Workspace,
  ): Promise<AgentSession | null> {
    try {
      // Validate inputs
      if (!agentId) {
        logger.warn('restoreSessionWithoutBackend called with empty agentId');
        return null;
      }
      if (!workspace) {
        logger.warn('restoreSessionWithoutBackend called without workspace');
        return null;
      }

      // Ensure agentId is a plain string (not a Proxy)
      const plainAgentId = agentId ? String(agentId) : '';
      // Try to load session first
      let session = await persistenceService.loadSession(plainAgentId, workspace?.id);

      // Check if the unified state store has richer data (e.g., from a background
      // agent stream that completed after the last disk persist).
      // Uses shared comparator to also catch equal-count but truncated messages.
      const inMemoryAgents = unifiedStateStore.getAgentsForWorkspace(workspace.id);
      const inMemoryAgent = inMemoryAgents.find((a) => String(a.id) === plainAgentId);
      if (inMemoryAgent && inMemoryAgent.messages && inMemoryAgent.messages.length > 0) {
        const diskMessages = session?.messages || [];
        const cmp = compareMessageCompleteness(
          { messages: inMemoryAgent.messages },
          { messages: diskMessages },
        );
        if (cmp > 0) {
          logger.info('Using in-memory agent data (richer than disk)', {
            agentId: plainAgentId,
            inMemoryMessages: inMemoryAgent.messages.length,
            diskMessages: diskMessages.length,
          });
          session = inMemoryAgent;
        }
      }

      // Ensure the loaded session has the workspaceId field
      // This field might be missing from older persisted sessions
      if (session && !session.workspaceId) {
        logger.info('Adding missing workspaceId to loaded session (restoreWithoutBackend)', {
          agentId: plainAgentId,
          workspaceId: workspace.id,
        });
        session.workspaceId = workspace.id;
      }

      // Track the message count from disk so beforeunload doesn't overwrite
      // a complete session with a stale in-memory version that has fewer messages
      if (session?.messages) {
        this.diskMessageCounts.set(plainAgentId, session.messages.length);
      }

      // Handle streaming state when loading from disk
      // If the session was streaming, re-register the stream handler to continue receiving chunks
      let foundStreamingMessage: AgentMessage | undefined;
      if (session) {
        // Check for streaming messages and re-register handler if needed
        if (session.messages) {
          foundStreamingMessage = session.messages.find((msg: any) => msg.isStreaming);
          if (foundStreamingMessage) {
            const wasSavedDuringUnload = foundStreamingMessage.metadata?.savedDuringUnload === true;
            const isPartialMessage = foundStreamingMessage.metadata?.partial === true;

            logger.info(
              'Found incomplete streaming message after page refresh (restoreWithoutBackend) - re-registering handler',
              {
                agentId: plainAgentId,
                messageId: foundStreamingMessage.id,
                hasContentBlocks: !!foundStreamingMessage.contentBlocks?.length,
                contentBlocksCount: foundStreamingMessage.contentBlocks?.length || 0,
                wasSavedDuringUnload,
                isPartialMessage,
              },
            );

            // Re-register stream handler to continue receiving chunks from backend
            // Keep isStreaming=true so the UI shows the streaming state
            // Pass workspaceId so the handler knows which workspace this stream
            // belongs to. Without this, the handler is registered with workspaceId: undefined.
            this.ensureStreamHandler(plainAgentId, {
              existingMessage: foundStreamingMessage,
              workspaceId: session.workspaceId ? String(session.workspaceId) : workspace.id,
            });
          }
        }

        // Only set session.isStreaming to false if we didn't find a streaming message
        // If we found one, keep it true so the UI shows streaming state
        if (!foundStreamingMessage) {
          session.isStreaming = false;
        }
      }

      // If no session, try to load config (for initial agents)
      if (!session) {
        const config = await persistenceService.loadAgentConfig(agentId, workspace.id);
        if (config) {
          // Create a pending session from config
          session = {
            id: plainAgentId,
            backendSessionId: null,
            workspaceId: workspace.id,
            name: config.name || 'Agent',
            status: 'pending' as AgentStatus,
            messages: [],
            model: config.model || DEFAULT_AGENT_MODEL,
            systemPrompt: config.systemPrompt,
            createdAt: new Date(config.createdAt || Date.now()),
            updatedAt: new Date(config.updatedAt || Date.now()),
            isStreaming: false, // Initialize as not streaming
            metadata: config.metadata,
            isInitialAgent: config.metadata?.isInitialAgent || false,
          };
        }
      } else {
        // Session was loaded from disk - ensure isInitialAgent flag is set
        // The flag should be in the session object from deserialization, but ensure it's there
        if (!session.isInitialAgent && session.metadata?.isInitialAgent) {
          session.isInitialAgent = true;
        }
      }
      if (session) {
        // Normalize stale "active"/"Processing" status when restoring from disk without a backend.
        // If the session was persisted as active but there is no streaming message in progress,
        // the backend process is gone and the agent is actually idle.
        // FIX: Also skip normalization if an IPC stream handler is already registered for this
        // agent (e.g. from ensureStreamHandler above). This prevents a race condition on workspace
        // switch where we normalize Active→Idle before reconnectToBackendStreams() can discover
        // that the agent IS actively streaming on the backend (~50ms later).
        // reconnectToBackendStreams() will clean up any stale streaming states for agents that
        // are NOT actually streaming on the backend.
        if (
          (session.status === AgentStatus.Active || session.status === AgentStatus.Processing) &&
          !foundStreamingMessage &&
          !this.activeStreamHandlers.has(plainAgentId)
        ) {
          logger.warn(
            'Normalizing stale active status to Idle on restore from disk (no active stream)',
            {
              agentId: session.id,
              previousStatus: session.status,
              newStatus: AgentStatus.Idle,
              hasStreamHandler: false,
            },
          );
          session.status = AgentStatus.Idle;
        }

        // Add to sessionStore - but we need to ensure the workspace is set
        // Since addSession relies on currentWorkspace being set, we need to add it directly
        // to the unified state store with the workspace ID
        const { unifiedStateStore } = await import('./services/unified-state-store');
        unifiedStateStore.setAgent(workspace.id as any, session);

        // Also add to sessionStore (secondary source)
        sessionStore.addSession(session);

        logger.debug('Session restored to stores', {
          agentId: session.id,
          workspaceId: session.workspaceId,
          addedToUnifiedStore: true,
        });

        return session;
      }
      return null;
    } catch (error) {
      logger.error('Failed to restore session without backend', error as Error, {
        agentId,
        workspaceId: workspace?.id,
      });
      return null;
    }
  }

  /**
   * Restore a deleted session
   */
  async restoreDeletedSession(
    sessionOrId: AgentSession | string,
    workspaceId?: string,
  ): Promise<AgentSession | null> {
    if (typeof sessionOrId === 'string') {
      // Try to load from disk
      const session = await persistenceService.loadSession(sessionOrId, workspaceId);

      // Ensure the loaded session has the workspaceId field
      // This field might be missing from older persisted sessions
      if (session && !session.workspaceId && workspaceId) {
        logger.info('Adding missing workspaceId to restored deleted session', {
          agentId: sessionOrId,
          workspaceId,
        });
        session.workspaceId = workspaceId;
      }

      if (session) {
        sessionStore.addSession(session);
      }
      return session;
    } else {
      // Restore the provided session object
      sessionStore.addSession(sessionOrId);
      return sessionOrId;
    }
  }

  /**
   * Get active agents for a workspace
   */
  getActiveAgents(workspaceId: string): AgentSession[] {
    const state = sessionStore.getStore();
    const storeValue = get(state) as any;
    const sessions = storeValue.sessions || [];
    return sessions.filter(
      (s: AgentSession) => s.workspaceId === workspaceId && s.status === AgentStatus.Active,
    );
  }

  /**
   * List all sessions for a workspace
   */
  async listSessions(workspaceId: string): Promise<AgentSession[]> {
    try {
      const result = (await invoke<CommandResponse<any[]>>('agent:list-sessions', {
        workspaceId,
      })) as CommandResponse<any[]>;

      if (result?.success && Array.isArray(result.data)) {
        const sessions: AgentSession[] = [];

        for (const sessionData of result.data) {
          const session = await this.resumeSession(sessionData.id, {
            id: workspaceId,
          } as Workspace);
          if (session) {
            sessions.push(session);
          }
        }

        return sessions;
      }

      return [];
    } catch (error) {
      logger.error('Failed to list sessions', error as Error, { workspaceId });
      return [];
    }
  }

  /**
   * Get statistics
   */
  async getStats() {
    const cacheStats = await configCache.getStats();

    return {
      sessions: sessionStore.getStats(),
      cache: cacheStats,
      activeStreamHandlers: this.activeStreamHandlers.size,
      streamTimeouts: this.streamTimeouts.size,
    };
  }

  /**
   * Get streaming health summary for debugging and monitoring.
   * Returns a snapshot of handler/queue state to detect orphaned handlers,
   * stuck queues, or mismatched IPC/DOM handler counts.
   */
  getStreamingHealth(): StreamingHealthSummary {
    const ipcHandlerKeys = Array.from(this.activeStreamHandlers.keys());
    const domHandlerKeys = Array.from(this.registeredDomHandlers);

    // Orphaned = IPC handler exists but no matching DOM handler
    const orphanedHandlers = ipcHandlerKeys.filter(
      (key) => !this.registeredDomHandlers.has(key),
    );

    return {
      activeIpcHandlers: this.activeStreamHandlers.size,
      activeDomHandlers: this.registeredDomHandlers.size,
      pendingQueueSessions: this.pendingEventQueue.getSessionCount(),
      totalPendingEvents: this.pendingEventQueue.getTotalEventCount(),
      orphanedHandlers,
    };
  }

  /**
   * Get memory diagnostics for debugging
   */
  getMemoryDiagnostics() {
    const memory = (performance as any).memory;
    return {
      activeStreamHandlers: this.activeStreamHandlers.size,
      activeStreamHandlerKeys: Array.from(this.activeStreamHandlers.keys()),
      streamTimeouts: this.streamTimeouts.size,
      streamTimeoutKeys: Array.from(this.streamTimeouts.keys()),
      heapUsed: memory?.usedJSHeapSize
        ? `${(memory.usedJSHeapSize / 1024 / 1024).toFixed(2)} MB`
        : 'N/A',
      heapTotal: memory?.totalJSHeapSize
        ? `${(memory.totalJSHeapSize / 1024 / 1024).toFixed(2)} MB`
        : 'N/A',
    };
  }

  /**
   * Force clear all caches and free memory
   * Call this from console: agentService.forceClearCaches()
   */
  async forceClearCaches() {
    logger.warn('Force clearing all caches...');

    // 1. Clear stream handlers - use offById for targeted cleanup
    for (const [agentId, handler] of this.activeStreamHandlers.entries()) {
      try {
        if (handler.listenerId) {
          window.electronAPI.offById(handler.channel, handler.listenerId);
        } else {
          window.electronAPI.removeAllListeners(handler.channel);
        }
      } catch (e) {
        logger.debug('Error removing handler', { agentId, error: e });
      }
    }
    this.activeStreamHandlers.clear();
    logger.info('Cleared stream handlers');

    // 2. Clear stream timeouts
    for (const timeout of this.streamTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.streamTimeouts.clear();
    logger.info('Cleared stream timeouts');

    // 3. Clear config cache via IPC
    try {
      await window.electronAPI.invoke('config:clear-cache', {});
      logger.info('Cleared config cache');
    } catch (e) {
      logger.debug('Error clearing config cache', { error: e });
    }

    // 4. Clear session store (optional - uncomment if needed)
    // sessionStore.clear();
    // logger.info('Cleared session store');

    // 5. Request garbage collection if available
    if ((window as any).gc) {
      (window as any).gc();
      logger.info('Triggered garbage collection');
    }

    const diagnostics = this.getMemoryDiagnostics();
    logger.info('Cache clear complete', diagnostics);
    return diagnostics;
  }

  /**
   * Dispose of the service and clean up resources.
   * After disposal, the service can be reinitialized by calling any public method.
   */
  dispose() {
    if (this.isDisposed) {
      logger.debug('AgentService already disposed, skipping');
      return;
    }

    this.isDisposed = true;

    // Clean up global IPC listeners registered in setupEventListeners
    logger.info('Cleaning up global IPC listeners', {
      count: this.globalIpcListenerCleanup.length,
    });
    for (const cleanup of this.globalIpcListenerCleanup) {
      try {
        cleanup();
      } catch (error) {
        logger.debug('Error cleaning up global IPC listener', { error });
      }
    }
    this.globalIpcListenerCleanup = [];

    // Clean up all active stream handlers - use offById for targeted cleanup
    for (const [agentId, handler] of this.activeStreamHandlers.entries()) {
      logger.info('Cleaning up stream handler on dispose', {
        agentId,
        channel: handler.channel,
      });
      if (handler.listenerId) {
        window.electronAPI.offById(handler.channel, handler.listenerId);
      } else {
        window.electronAPI.removeAllListeners(handler.channel);
      }
    }
    this.activeStreamHandlers.clear();

    // Clear stream timeouts
    for (const [, timeout] of this.streamTimeouts.entries()) {
      clearTimeout(timeout);
    }
    this.streamTimeouts.clear();

    // No batching in refactored service - nothing to clean up

    // IMPORTANT: Do NOT clear the session store on dispose!
    // The session store contains valuable data that should persist across page refreshes.
    // Sessions are persisted to disk and should be restored when the page reloads.
    // Only clear sessions when explicitly deleting them, not on page unload.

    // Clean up IPC heartbeat ping handlers
    for (const [agentId, pingHandler] of this.activePingHandlers.entries()) {
      logger.debug('Cleaning up ping handler on dispose', {
        agentId,
        channel: pingHandler.channel,
      });
      if (pingHandler.listenerId) {
        window.electronAPI.offById(pingHandler.channel, pingHandler.listenerId);
      } else {
        window.electronAPI.removeAllListeners(pingHandler.channel);
      }
    }
    this.activePingHandlers.clear();

    // Stop periodic cleanup and clear pending event queue and DOM handler registry
    this.pendingEventQueue.stopPeriodicCleanup();
    this.pendingEventQueue.clearAll();
    this.registeredDomHandlers.clear();

    // Clear analytics tracking state
    agentAnalyticsState.clear();

    // Clear reconnect debounce and safety timeout timers
    if (this.reconnectDebounceTimer) {
      clearTimeout(this.reconnectDebounceTimer);
      this.reconnectDebounceTimer = null;
    }
    if (this.streamingSafetyTimeout) {
      clearTimeout(this.streamingSafetyTimeout);
      this.streamingSafetyTimeout = null;
    }

    // Clear activation and deduplication maps
    this.initialAgentActivationLocks.clear();
    this.pendingSessionCreations.clear();
    this.activationMutex.clear();
    this.recentAgentCreatedEvents.clear();
    this.diskMessageCounts.clear();

    // Only clear initialization status as it's temporary state
    this.initializationStatus.clear();
    logger.info('Agent service disposed');
  }

  /**
   * Alias for dispose()
   */
  cleanup() {
    this.dispose();
  }

  /**
   * Clean up stream handlers for agents not in the current workspace.
   * Call this when switching workspaces to prevent orphaned stream handlers.
   */
  cleanupOrphanedStreamHandlers(): void {
    const currentWorkspace = unifiedStateStore.currentWorkspace;
    if (!currentWorkspace) {
      logger.debug('No current workspace, skipping orphaned stream handler cleanup');
      return;
    }

    const currentAgentIds = new Set(currentWorkspace.agents.keys());
    const orphanedAgentIds: string[] = [];

    for (const agentId of this.activeStreamHandlers.keys()) {
      if (!currentAgentIds.has(agentId as any)) {
        orphanedAgentIds.push(agentId);
      }
    }

    if (orphanedAgentIds.length > 0) {
      logger.info('Cleaning up orphaned stream handlers', {
        count: orphanedAgentIds.length,
        agentIds: orphanedAgentIds,
      });

      for (const agentId of orphanedAgentIds) {
        this.cleanupStreamHandler(agentId);
      }
    }
  }

  /**
   * Handle streaming chunk for a session
   */
  async handleStreamChunk(agentId: string, chunk: { type: string; data: string }): Promise<void> {
    const session = this.getSession(agentId);
    if (!session) return;

    // Find or create the last assistant message
    let lastMessage = session.messages[session.messages.length - 1];
    if (!lastMessage || lastMessage.role !== 'assistant') {
      lastMessage = {
        id: createMessageId(uuidv4()),
        role: 'assistant',
        contentBlocks: [{ type: 'text' as const, text: '' }],
        timestamp: new Date().toISOString(),
      };
      session.messages.push(lastMessage);
    }

    // Append chunk data to contentBlocks
    if (!lastMessage.contentBlocks) {
      lastMessage.contentBlocks = [{ type: 'text' as const, text: chunk.data }];
    } else {
      const textBlock = lastMessage.contentBlocks.find((b) => b.type === 'text');
      if (textBlock) {
        textBlock.text = (textBlock.text || '') + chunk.data;
      } else {
        lastMessage.contentBlocks.push({ type: 'text' as const, text: chunk.data });
      }
    }

    // Update session
    sessionStore.updateSession(agentId, session);
  }

  /**
   * Private helper to handle agent errors with a specific error type
   */
  private _handleAgentError(params: { agentId: string; error: string; errorType: string }): void {
    const session = this.getSession(params.agentId);
    if (!session) return;

    session.status = AgentStatus.Error;
    // Store error and streaming state in metadata
    session.metadata = {
      ...session.metadata,
      lastError: params.error,
      isStreaming: false,
    };

    sessionStore.updateSession(params.agentId, session);

    // Track agent errored event
    track('Agent Errored', {
      agent_id: params.agentId,
      agent_name: session.name,
      error_type: params.errorType,
    });
  }

  /**
   * Handle streaming error
   */
  async handleStreamError(params: { agentId: string; error: string }): Promise<void> {
    this._handleAgentError({ ...params, errorType: 'stream_error' });
  }

  /**
   * Handle message error
   */
  async handleMessageError(params: { agentId: string; error: string }): Promise<void> {
    this._handleAgentError({ ...params, errorType: 'message_error' });
  }

  /**
   * Check if session is streaming
   */
  isStreaming(agentId: string): boolean {
    const session = this.getSession(agentId);
    return session?.isStreaming === true;
  }

  /**
   * Check if session is soft deleted
   */
  isSoftDeleted(agentId: string): boolean {
    const session = this.getSession(agentId);
    return session?.metadata?.softDeleted === true;
  }

  /**
   * Clean up old sessions from memory
   */
  cleanupOldSessions(): void {
    const MAX_SESSIONS = 5;
    const allSessions = this.getAllSessions();

    if (allSessions.length <= MAX_SESSIONS) return;

    // Sort by last updated time
    const sorted = allSessions.sort((a, b) => {
      const timeA = new Date(a.updatedAt ?? a.createdAt ?? new Date()).getTime();
      const timeB = new Date(b.updatedAt ?? b.createdAt ?? new Date()).getTime();
      return timeB - timeA; // Most recent first
    });

    // Keep only the most recent MAX_SESSIONS
    const toRemove = sorted.slice(MAX_SESSIONS);

    for (const session of toRemove) {
      agentAnalyticsState.delete(session.id);
      sessionStore.removeAgent(session.id);
    }
  }
}

// HMR cleanup: Remove orphaned IPC listeners from the previous AgentService instance.
// When Vite hot-reloads this module, a new singleton is created below. The old instance's
// Maps/arrays are lost, but IPC listeners it registered persist in the preload registry.
// We use the window-persisted references (stored in the constructor) to clean them up.
const _previousHmrState = (window as any)[HMR_CLEANUP_KEY] as
  | {
      activeStreamHandlers?: Map<string, { channel: string; listenerId?: string }>;
      globalIpcListenerCleanup?: (() => void)[];
      activePingHandlers?: Map<string, { channel: string; listenerId?: string }>;
    }
  | undefined;

if (_previousHmrState && typeof window !== 'undefined' && window.electronAPI) {
  // Clean up orphaned stream handlers (the source of the tripled-text bug)
  if (_previousHmrState.activeStreamHandlers?.size) {
    logger.info('HMR cleanup: removing orphaned stream handlers', {
      count: _previousHmrState.activeStreamHandlers.size,
    });
    for (const [, handler] of _previousHmrState.activeStreamHandlers.entries()) {
      if (handler.listenerId) {
        window.electronAPI.offById(handler.channel, handler.listenerId);
      }
    }
    _previousHmrState.activeStreamHandlers.clear();
  }

  // Clean up orphaned global IPC listeners (agent:stream-starting, agent:created, etc.)
  if (_previousHmrState.globalIpcListenerCleanup?.length) {
    logger.info('HMR cleanup: removing orphaned global IPC listeners', {
      count: _previousHmrState.globalIpcListenerCleanup.length,
    });
    for (const cleanup of _previousHmrState.globalIpcListenerCleanup) {
      try {
        cleanup();
      } catch (_) {
        // Ignore errors from already-removed listeners
      }
    }
    _previousHmrState.globalIpcListenerCleanup.length = 0;
  }

  // Clean up orphaned ping handlers
  if (_previousHmrState.activePingHandlers?.size) {
    logger.info('HMR cleanup: removing orphaned ping handlers', {
      count: _previousHmrState.activePingHandlers.size,
    });
    for (const [, handler] of _previousHmrState.activePingHandlers.entries()) {
      if (handler.listenerId) {
        window.electronAPI.offById(handler.channel, handler.listenerId);
      }
    }
    _previousHmrState.activePingHandlers.clear();
  }
}

// Export singleton instance
export const agentService = new RefactoredAgentService();
