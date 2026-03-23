/**
 * Chat Service
 *
 * A clean, consolidated service that handles all chat-related logic in one place.
 * This replaces the complex scattered logic across multiple services.
 */

import { v4 as uuidv4 } from 'uuid';
import { createMessageId } from '$shared/types/branded-ids';
import { writable, get, type Writable } from 'svelte/store';
import { createLogger } from '$lib/utils/client-logger';
import type { Workspace, AgentMessage, AgentSession, ContentBlock, WorkspaceId } from '$shared/types';
import { normalizeContentBlocks } from '$shared/types';
import type { IDisposable } from '$shared/types/disposable';
import { memoryManager } from './memory-manager';
import type { ContextItem } from '$lib/components/chat/input/context-api';
import { agentService } from '../agent.service';
import { unifiedStateStore, sessionStore, notifyAgentSubscribers } from '$features/agent/browser';
import { AGENT_STREAMING_CONFIG } from '$shared/constants/agent-streaming';
import { getAgentProvider } from '$shared/types/agent-session';
import { getProviderConfig } from '$shared/config/provider-config';
import { cleanErrorMessage } from '$shared/errors/messages';
import { assertStreamingInvariant } from '../utils/streaming-invariants';

const logger = createLogger('ChatService');

// Constants
const MAX_MESSAGE_LENGTH = 500000; // Maximum message length in characters (500k chars ~= 125k tokens)
const MIN_MESSAGE_SEND_INTERVAL = 100; // Minimum time between messages in ms

/**
 * Convert a File object to base64 data URL
 */
async function fileToBase64(file: File): Promise<{ data: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Extract base64 data from data URL (remove "data:image/png;base64," prefix)
      const base64Data = result.split(',')[1] || result;
      resolve({
        data: base64Data,
        mimeType: file.type || 'image/png',
      });
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Check if a file is an image based on MIME type
 */
function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

export interface ChatState {
  session: AgentSession | null;
  messages: AgentMessage[];
  isStreaming: boolean;
  isProcessing: boolean;
  isInterrupting: boolean; // True while an interrupt is in progress
  streamingContent: string;
  error: string | null;
  /** Timestamp when streaming/processing started (for long-running debug info) */
  /** Timestamp of the last received chunk (for stall detection) */
  lastChunkTime: number | null;
  /** Whether the stream appears stalled (no chunks for STALL_DETECTION_MS) */
  isStalled: boolean;
  streamingStartTime: number | null;
  /** Last attempted message for retry functionality */
  lastAttemptedMessage: {
    text: string;
    options?: SendMessageOptions;
  } | null;
  /** Model unavailable info - set when a model fails and user can retry with another */
  modelUnavailable: {
    failedModel: string;
    nextAvailableModel: string;
  } | null;
}

export interface SendMessageOptions {
  contextItems?: ContextItem[];
  noteIds?: string[];
  personality?: string;
  /**
   * When true, the backend will reset the ACP session before sending the message.
   * This is used for edit/regenerate flows where we need to clear the session's
   * internal history so it only sees the truncated messages.
   */
  resetHistory?: boolean;
  /**
   * Override the model to use for this message.
   * Used when retrying with a different model after the original model was unavailable.
   */
  model?: string;
  /**
   * The agent ID to send the message to.
   */
  agentId?: string;
  /**
   * Context references to pass directly to the agent.
   * These are structured references like Linear issues, GitHub issues, Sentry issues, etc.
   * Unlike contextItems which are converted to a simpler format, these are passed through as-is.
   */
  contextReferences?: any[];
}

export class ChatService implements IDisposable {
  private state: Writable<ChatState>;

  /**
   * The agent ID this instance is permanently bound to.
   * This instance only handles events for this specific agent.
   */
  public readonly agentId: string | undefined;
  private streamHandlers = new Map<string, (data: any) => void>();
  private sessionUpdatedCleanups = new Map<string, () => void>();
  private streamTimeouts = new Map<string, { cleanup: () => void }>();
  // Use shared constant for stream timeout - reduced from 20 minutes to 2 minutes
  // to prevent agents from appearing stuck when backend stops responding
  private readonly STREAM_TIMEOUT_MS = AGENT_STREAMING_CONFIG.BACKEND_STREAM_TIMEOUT_MS;
  private lastMessageTime = 0; // Track last message send time for rate limiting
  // Idempotency: prevent duplicate sends from double-clicks or rapid retries
  private recentSendKeys = new Set<string>();
  private sendKeyTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private static readonly SEND_KEY_TTL_MS = 5000; // Auto-expire keys after 5 seconds
  private connectionHandler: ((e: Event) => void) | null = null;
  private disposed = false;

  // PERFORMANCE: When the tab is backgrounded, RAF callbacks are paused by the browser.
  // This handler force-flushes any accumulated streaming content when the user returns.
  private visibilityChangeHandler: (() => void) | null = null;

  // PERFORMANCE: Throttle streaming chunk updates to reduce re-renders
  // FIX: Only store streamingContent, not messages - messages are computed fresh during flush
  // to avoid race conditions with content-block updates
  private pendingStreamingContent: string | null = null;
  private chunkUpdateRafId: number | null = null;
  private readonly CHUNK_THROTTLE_MS = 16; // ~60fps
  private lastChunkUpdateTime = 0;

  // Per-instance accumulator to track true streaming content
  // This prevents race conditions where chunks arrive faster than RAF can flush updates
  // Without this, reading from the store would return stale values
  // Each ChatService instance handles exactly one agent, so a simple string suffices
  private localStreamingContent = '';

  // Stall detection: if no chunks received for this duration, mark as stalled
  // This is more aggressive than the backend's 5-minute timeout for better UX
  private readonly STALL_DETECTION_MS = 90_000; // 90 seconds
  private stallCheckTimer: ReturnType<typeof setInterval> | null = null;

  // FIX: State reconciliation timer to detect and recover from stuck states
  // Periodically checks if isProcessing=true but no active stream exists on the backend
  // This catches any missed completion events and resets the UI state
  private stateReconciliationTimer: ReturnType<typeof setInterval> | null = null;
  private readonly STATE_RECONCILIATION_INTERVAL_MS = 10_000; // Check every 10 seconds
  // FIX: Require consecutive checks showing no active stream before resetting
  // This prevents false positives from transient IPC delays or backend timing issues
  private stateReconciliationFailureCount = 0;
  private readonly STATE_RECONCILIATION_FAILURE_THRESHOLD = 2; // Reset after 2 consecutive failures (20 seconds)
  // Safety timeout: if isProcessing has been true for this long without any chunks
  // AND the session is not streaming, auto-clear the stuck state
  private readonly STUCK_PROCESSING_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

  // Track when this instance was last destroyed/paused (ChatPanel unmount).
  // Used to distinguish layout-driven remounts from actual HMR reloads.
  // HMR does NOT call destroy/pauseBackgroundTimers before re-init, so if
  // lastDestroyTimestamp is recent, this is a layout remount, not HMR.
  // IMPORTANT: Always use isRecentRemount() instead of checking `> 0` directly,
  // because the timestamp becomes permanently non-zero after the first unmount.
  private lastDestroyTimestamp = 0;
  private static readonly RECENT_REMOUNT_THRESHOLD_MS = 5000;

  // Track when the last chunk was received for reconciliation.
  // If chunks were received recently, the stream is alive and reconciliation
  // should not count failures even if getActiveStreams doesn't find it.
  private lastChunkReceivedAt = 0;

  // Generation counter for initializeChat calls. Each call increments this and
  // captures the value; before mutating shared state the call checks whether it
  // is still the latest generation, preventing a slower/older initializeChat
  // from overwriting the store with stale data during rapid workspace switches.
  private _initGeneration = 0;

  constructor(agentId?: string) {
    this.agentId = agentId;
    this.state = writable<ChatState>({
      session: null,
      messages: [],
      isStreaming: false,
      isProcessing: false,
      isInterrupting: false,
      streamingContent: '',
      error: null,
      streamingStartTime: null,
      lastAttemptedMessage: null,
      lastChunkTime: null,
      isStalled: false,
      modelUnavailable: null,
    });

    // PERFORMANCE: When the browser tab is backgrounded, RAF callbacks are paused.
    // This means streaming content accumulates in pendingStreamingContent but never
    // gets flushed to the UI. When the user returns, force-flush so content appears immediately.
    this.visibilityChangeHandler = () => {
      if (document.visibilityState === 'visible' && get(this.state).isProcessing) {
        this.flushChunkUpdate();
      }
    };
    document.addEventListener('visibilitychange', this.visibilityChangeHandler);
  }

  /**
   * Monotonicity-safe state update wrapper.
   *
   * During active streaming, this prevents regressions where an update would
   * reduce `messages.length` or reduce `contentBlocks.length` on the last
   * message. These regressions cause ChatPanel to permanently freeze when
   * multiple agents stream concurrently.
   *
   * Use this for any state update that touches `messages` during streaming.
   */
  private safeStateUpdate(updater: (s: ChatState) => ChatState): void {
    this.state.update((s) => {
      const next = updater(s);

      // Only enforce monotonicity while actively streaming.
      // Skip guards when stream is finalizing (isStreaming true→false) so that
      // legitimate message/block count reductions from stream completion go through.
      if (!s.isStreaming || !next.isStreaming) return next;

      // Guard 1: never reduce message count during streaming
      if (next.messages.length < s.messages.length) {
        logger.warn('[ChatService] safeStateUpdate: prevented message count regression during streaming', {
          agentId: this.agentId,
          currentCount: s.messages.length,
          incomingCount: next.messages.length,
          currentLastId: s.messages[s.messages.length - 1]?.id,
          incomingLastId: next.messages[next.messages.length - 1]?.id,
        });
        return { ...next, messages: s.messages };
      }

      // Guard 2: never reduce contentBlocks count on the last message during streaming
      if (next.messages.length > 0 && s.messages.length > 0) {
        const lastCurrent = s.messages[s.messages.length - 1];
        const lastNext = next.messages[next.messages.length - 1];
        if (
          lastCurrent?.id === lastNext?.id &&
          (lastNext?.contentBlocks?.length || 0) < (lastCurrent?.contentBlocks?.length || 0) &&
          (lastCurrent?.contentBlocks?.length || 0) > 0
        ) {
          logger.warn('[ChatService] safeStateUpdate: prevented contentBlocks regression during streaming', {
            agentId: this.agentId,
            messageId: lastCurrent?.id,
            currentBlockCount: lastCurrent?.contentBlocks?.length || 0,
            incomingBlockCount: lastNext?.contentBlocks?.length || 0,
            currentBlockTypes: lastCurrent?.contentBlocks?.map((b) => b.type) || [],
            incomingBlockTypes: lastNext?.contentBlocks?.map((b) => b.type) || [],
          });
          const fixedLastMessage = { ...lastNext, contentBlocks: lastCurrent.contentBlocks };
          const fixedMessages = [...next.messages.slice(0, -1), fixedLastMessage];
          return { ...next, messages: fixedMessages };
        }
      }

      return next;
    });
  }


  /**
   * PERFORMANCE: Flush pending chunk updates using requestAnimationFrame
   * FIX: Read current messages from state to avoid overwriting content-block updates
   */
  private flushChunkUpdate(): void {
    if (this.pendingStreamingContent !== null) {
      const newStreamingContent = this.pendingStreamingContent;
      this.pendingStreamingContent = null;

      // Only log at debug level to avoid excessive logging during streaming
      logger.debug('[ChatService] flushChunkUpdate called', {
        contentLength: newStreamingContent.length,
      });

      // Compute updated messages from CURRENT state, not cached messages
      // This prevents race conditions where content-blocks updates are overwritten
      this.safeStateUpdate((s) => {
        const existingMessages = s.messages;
        const lastMessage = existingMessages[existingMessages.length - 1];
        const hasStreamingAssistantMessage =
          lastMessage?.role === 'assistant' && lastMessage?.isStreaming === true;

        let updatedMessages = existingMessages;

        if (!hasStreamingAssistantMessage) {
          // Create a new streaming assistant message
          // IMPORTANT: Message IDs must start with 'msg_' for Zod validation
          // Reuse the streaming message ID from sessionStore if one exists,
          // to prevent divergence between this instance and sessionStore that causes
          // the streaming response to appear in the wrong conversation turn.
          let streamingMessageId: ReturnType<typeof createMessageId> | undefined;
          const sessionId = s.session?.id;
          if (sessionId) {
            // FIX: Use workspace-aware session lookup instead of the deprecated
            // sessionStore.getSession() which depends on currentWorkspace. For
            // background/cross-workspace streaming, currentWorkspace may point to a
            // different workspace, causing the lookup to return the wrong session.
            const instanceWsId = s.session?.workspaceId;
            const storeSession = instanceWsId
              ? sessionStore.getSessionForWorkspace(instanceWsId as string, sessionId)
              : sessionStore.getSession(sessionId);
            const storeLastMsg = storeSession?.messages?.[storeSession.messages.length - 1];
            if (storeLastMsg?.role === 'assistant' && storeLastMsg?.isStreaming) {
              streamingMessageId = createMessageId(storeLastMsg.id);
            }
          }
          const streamingMessage: AgentMessage = {
            id: streamingMessageId ?? createMessageId(`msg_${uuidv4()}`),
            role: 'assistant' as const,
            contentBlocks: [{ type: 'text' as const, text: newStreamingContent }],
            timestamp: new Date().toISOString(),
            isStreaming: true,
          };
          updatedMessages = [...existingMessages, streamingMessage];
        } else {
          // Update the existing streaming message's text content
          const existingBlocks = lastMessage.contentBlocks || [];

          // Find the last block - if it's a text block, update it; otherwise append a new text block
          const lastBlock = existingBlocks[existingBlocks.length - 1];
          let updatedBlocks: ContentBlock[];

          if (lastBlock?.type === 'text') {
            // Update the last text block
            // FIX: Don't replace with empty content - this would delete visible text
            if (newStreamingContent.length === 0) {
              logger.debug(
                'flushChunkUpdate: Skipping empty content update to preserve existing text',
                {
                  existingTextLength: ((lastBlock as any).text || '').length,
                  existingTextPreview: ((lastBlock as any).text || '').slice(0, 50),
                },
              );
              updatedBlocks = existingBlocks; // Keep existing blocks unchanged
            } else {
              updatedBlocks = [
                ...existingBlocks.slice(0, -1),
                { type: 'text' as const, text: newStreamingContent },
              ];
            }
          } else {
            // Last block is not text (it's a tool block) - append new text block
            // FIX: Don't append empty text blocks
            if (newStreamingContent.length === 0) {
              logger.debug('flushChunkUpdate: Skipping empty text block append');
              updatedBlocks = existingBlocks; // Keep existing blocks unchanged
            } else {
              updatedBlocks = [
                ...existingBlocks,
                { type: 'text' as const, text: newStreamingContent },
              ];
            }
          }

          const updatedLastMessage = {
            ...lastMessage,
            contentBlocks: updatedBlocks,
          };
          updatedMessages = [...existingMessages.slice(0, -1), updatedLastMessage];
        }

        // Only log at debug level to avoid excessive logging during streaming
        logger.debug('[ChatService] flushChunkUpdate updating state', {
          messageCount: updatedMessages.length,
          streamingContentLength: newStreamingContent.length,
        });

        return {
          ...s,
          isStreaming: true,
          streamingContent: newStreamingContent,
          messages: updatedMessages,
        };
      });
    }
  }

  /**
   * PERFORMANCE: Schedule a throttled chunk update
   * FIX: Only store streamingContent, not full messages array
   */
  private scheduleChunkUpdate(content: string): void {
    // FIX: Only store the streaming content - messages will be computed fresh during flush
    this.pendingStreamingContent = content;

    const now = performance.now();
    const timeSinceLastUpdate = now - this.lastChunkUpdateTime;

    // Only log at debug level to avoid excessive logging during streaming
    logger.debug('[ChatService] scheduleChunkUpdate', {
      contentLength: content.length,
      timeSinceLastUpdate,
    });

    // If enough time has passed, update immediately
    if (timeSinceLastUpdate >= this.CHUNK_THROTTLE_MS) {
      this.lastChunkUpdateTime = now;
      this.flushChunkUpdate();
    } else if (this.chunkUpdateRafId === null) {
      // Schedule update for next frame
      this.chunkUpdateRafId = requestAnimationFrame(() => {
        this.chunkUpdateRafId = null;
        this.lastChunkUpdateTime = performance.now();
        this.flushChunkUpdate();
      });
    }
    // If RAF is already scheduled, the pending update will be used
  }

  /**
   * Start stall detection timer
   * Checks every 10 seconds if we've received chunks recently
   */
  private startStallDetection(): void {
    this.stopStallDetection();

    this.stallCheckTimer = setInterval(() => {
      const currentState = get(this.state);

      // Only check if we're actively streaming
      if (!currentState.isStreaming) {
        return;
      }

      // Don't flag as stalled while an MCP tool is actively executing.
      // If the last content block is a tool_use, the tool hasn't returned yet.
      const lastMsg = currentState.messages[currentState.messages.length - 1];
      if (lastMsg?.role === 'assistant' && lastMsg?.contentBlocks?.length) {
        const lastBlock = lastMsg.contentBlocks[lastMsg.contentBlocks.length - 1];
        if (lastBlock.type === 'tool_use') {
          return; // Tool is executing — not stalled
        }
      }

      // Determine how long we've been silent.
      // If we've received chunks, measure from last chunk. Otherwise from stream start.
      const referenceTime = currentState.lastChunkTime ?? currentState.streamingStartTime;
      if (!referenceTime) {
        return;
      }

      const silenceMs = Date.now() - referenceTime;

      if (silenceMs >= this.STALL_DETECTION_MS && !currentState.isStalled) {
        logger.warn('Stream appears stalled', {
          silenceMs,
          threshold: this.STALL_DETECTION_MS,
          hasReceivedData: currentState.lastChunkTime !== null,
          lastChunkTime: currentState.lastChunkTime,
        });

        this.state.update((s) => ({
          ...s,
          isStalled: true,
        }));
      }
    }, 10_000); // Check every 10 seconds
  }

  /**
   * Stop stall detection timer
   */
  private stopStallDetection(): void {
    if (this.stallCheckTimer) {
      clearInterval(this.stallCheckTimer);
      this.stallCheckTimer = null;
    }
  }

  /**
   * FIX: Start periodic state reconciliation to detect and recover from stuck states
   * This periodically checks if the UI shows isProcessing=true but the backend
   * has no active stream, which would indicate a missed completion event.
   * If detected after consecutive failures, it resets the UI state to prevent
   * the "agent stuck" issue.
   *
   * IMPROVEMENTS:
   * - Uses current session from state instead of captured sessionId to handle session changes
   * - Requires consecutive failures before resetting to avoid false positives from transient issues
   * - Resets failure count on IPC errors to be conservative
   */
  private startStateReconciliation(_initialSessionId: string): void {
    this.stopStateReconciliation();

    // Reset failure counter when starting fresh
    this.stateReconciliationFailureCount = 0;

    this.stateReconciliationTimer = setInterval(async () => {
      const currentState = get(this.state);

      // Only reconcile if we think we're processing
      if (!currentState.isProcessing) {
        // Reset failure count since we're not in a stuck state
        this.stateReconciliationFailureCount = 0;
        return;
      }

      // FIX: Get current session dynamically instead of using captured sessionId
      // This handles the case where session changes during streaming
      const currentSessionId = currentState.session?.id;
      if (!currentSessionId) {
        // No session, reset failure count and skip
        this.stateReconciliationFailureCount = 0;
        return;
      }

      // Safety timeout: if isProcessing has been true for > 5 minutes without any chunks
      // AND the session is not streaming according to sessionStore, auto-clear the stuck state.
      // This catches permanently stuck states that the normal reconciliation might miss.
      if (currentState.streamingStartTime) {
        const processingDuration = Date.now() - currentState.streamingStartTime;
        const hasRecentChunks = currentState.lastChunkTime
          && (Date.now() - currentState.lastChunkTime) < this.STUCK_PROCESSING_TIMEOUT_MS;
        const sessionData = sessionStore.getSession(currentSessionId);
        const sessionSaysStreaming = sessionData?.isStreaming ?? false;

        if (
          processingDuration >= this.STUCK_PROCESSING_TIMEOUT_MS
          && !hasRecentChunks
          && !sessionSaysStreaming
        ) {
          logger.warn('State reconciliation: permanently stuck isProcessing detected (>5 min, no chunks, session not streaming)', {
            sessionId: currentSessionId,
            processingDurationMs: processingDuration,
            lastChunkTime: currentState.lastChunkTime,
            streamingStartTime: currentState.streamingStartTime,
          });

          this.state.update((s) => ({
            ...s,
            isProcessing: false,
            isStreaming: false,
            isStalled: false,
            streamingStartTime: null,
            lastChunkTime: null,
          }));

          this.stateReconciliationFailureCount = 0;
          this.stopStateReconciliation();
          return;
        }
      }

      // Query the backend to check if there's actually an active stream
      try {
        if (window.electronAPI) {
          const result = await window.electronAPI.invoke('agent:get-active-streams');
          const activeStreams = result?.streams || [];

          // Check if our session is in the active streams list
          const hasActiveStream = activeStreams.some(
            (stream: { agentId: string }) => stream.agentId === currentSessionId,
          );

          // Re-check isProcessing since state may have changed during IPC call
          const stateAfterCheck = get(this.state);
          if (!stateAfterCheck.isProcessing) {
            // State was updated while we were checking, reset and skip
            this.stateReconciliationFailureCount = 0;
            return;
          }

          if (hasActiveStream) {
            // Backend confirms stream is active, reset failure count
            this.stateReconciliationFailureCount = 0;
            logger.debug('State reconciliation: backend confirms active stream', {
              sessionId: currentSessionId,
              activeStreams: activeStreams.length,
            });
          } else {
            // If chunks were received recently (< 30s), the stream is alive
            // even if getActiveStreams doesn't list it (transient IPC timing).
            // Skip the failure count to avoid false resets.
            const timeSinceLastChunk = this.lastChunkReceivedAt ? Date.now() - this.lastChunkReceivedAt : Infinity;
            if (timeSinceLastChunk < 30_000) {
              logger.debug('State reconciliation: skipping failure count - chunks received recently', {
                sessionId: currentSessionId,
                timeSinceLastChunkMs: timeSinceLastChunk,
              });
              this.stateReconciliationFailureCount = 0;
            } else {
            // UI thinks we're processing, but backend has no active stream
            this.stateReconciliationFailureCount++;

            logger.warn('State reconciliation: potential stuck state detected', {
              sessionId: currentSessionId,
              failureCount: this.stateReconciliationFailureCount,
              threshold: this.STATE_RECONCILIATION_FAILURE_THRESHOLD,
              isProcessing: stateAfterCheck.isProcessing,
              isStreaming: stateAfterCheck.isStreaming,
              backendActiveStreams: activeStreams.length,
              timeSinceLastChunkMs: timeSinceLastChunk,
            });

            // Only reset after consecutive failures to avoid false positives
            if (
              this.stateReconciliationFailureCount >= this.STATE_RECONCILIATION_FAILURE_THRESHOLD
            ) {
              logger.warn('State reconciliation: resetting stuck state after threshold', {
                sessionId: currentSessionId,
                failureCount: this.stateReconciliationFailureCount,
              });

              this.state.update((s) => ({
                ...s,
                isProcessing: false,
                isStreaming: false,
                isStalled: false,
                streamingStartTime: null,
                lastChunkTime: null,
              }));

              // Reset counter and stop the reconciliation since we've recovered
              this.stateReconciliationFailureCount = 0;
              this.stopStateReconciliation();
            }
            } // end: timeSinceLastChunk >= 30s
          }
        }
      } catch (error) {
        // On IPC error, be conservative - reset failure count to avoid false positives
        // The error might be a transient network/IPC issue, not a real stuck state
        this.stateReconciliationFailureCount = 0;
        logger.debug('State reconciliation check failed, resetting failure count', { error });
      }
    }, this.STATE_RECONCILIATION_INTERVAL_MS);
  }

  /**
   * Stop periodic state reconciliation
   */
  private stopStateReconciliation(): void {
    if (this.stateReconciliationTimer) {
      clearInterval(this.stateReconciliationTimer);
      this.stateReconciliationTimer = null;
    }
    // Reset failure count when stopping
    this.stateReconciliationFailureCount = 0;
  }

  /**
   * Record that a chunk was received (resets stall detection)
   */
  private recordChunkReceived(): void {
    // Track chunk receipt time on the instance for reconciliation checks
    this.lastChunkReceivedAt = Date.now();
    this.state.update((s) => ({
      ...s,
      lastChunkTime: Date.now(),
      isStalled: false,
    }));
  }

  /**
   * Public method to pause background timers (state reconciliation, stall detection).
   * Called when ChatPanel unmounts (e.g., workspace switch) to prevent the reconciliation
   * timer from falsely resetting streaming state while the panel is not visible.
   * Timers are restarted when streaming resumes via setupStreaming().
   */
  public pauseBackgroundTimers(): void {
    this.stopStateReconciliation();
    this.stopStallDetection();
    // Record destroy timestamp so initializeChat() can distinguish
    // layout remounts (recent destroy) from HMR (no destroy before re-init)
    this.lastDestroyTimestamp = Date.now();
    logger.debug('Background timers paused (ChatPanel unmounted)', { agentId: this.agentId });
  }

  /**
   * Check if the last destroy/unmount was recent (within threshold).
   * Returns false if pauseBackgroundTimers was never called or was called long ago.
   * Use this instead of `lastDestroyTimestamp > 0` which becomes permanently true.
   */
  private isRecentRemount(): boolean {
    return (
      this.lastDestroyTimestamp > 0 &&
      Date.now() - this.lastDestroyTimestamp < ChatService.RECENT_REMOUNT_THRESHOLD_MS
    );
  }

  /**
   * Public method to reconcile streaming state after mount.
   *
   * When ChatPanel mounts after the backend has already started streaming,
   * the DOM handler may not be registered yet. This method checks the
   * session/unified-state stores and, if the agent is actively streaming
   * but ChatService has no handler, sets one up so chunks are displayed
   * immediately.
   *
   * @returns true if reconciliation was needed (handler was missing)
   */
  public reconcileStreamingState(sessionId: string): boolean {
    // Invariant: sessionId must be valid
    assertStreamingInvariant(
      !!sessionId && sessionId.length > 0,
      'reconcileStreamingState called with empty sessionId',
      { agentId: this.agentId },
    );

    // Invariant: session should match this ChatService instance's agentId
    assertStreamingInvariant(
      !this.agentId || sessionId === this.agentId,
      'reconcileStreamingState sessionId does not match ChatService agentId',
      { sessionId, agentId: this.agentId },
    );

    // Check if the session is currently streaming via sessionStore or unifiedStateStore
    const sessionData = sessionStore.getSession(sessionId);
    const currentState = get(this.state);

    let isActivelyStreaming = sessionData?.isStreaming ?? false;

    // Also check unified state store for the most up-to-date streaming state
    if (!isActivelyStreaming && currentState.session?.workspaceId) {
      const workspaceState = unifiedStateStore.getWorkspace(
        currentState.session.workspaceId as WorkspaceId,
      );
      const agentFromStore = workspaceState?.agents.get(sessionId);
      if (agentFromStore?.streaming?.active) {
        isActivelyStreaming = true;
      }
    }

    if (!isActivelyStreaming) {
      return false;
    }

    let reconciled = false;

    // If streaming but no DOM handler exists, set one up
    if (!this.streamHandlers.has(sessionId)) {
      logger.info('[ChatService] reconcileStreamingState: setting up missing stream handler', {
        sessionId,
        isProcessing: currentState.isProcessing,
        isStreaming: currentState.isStreaming,
      });
      this.setupStreaming(sessionId);
      reconciled = true;
    }

    // If streaming but isProcessing is false, update state to reflect streaming
    if (!currentState.isProcessing || !currentState.isStreaming) {
      logger.info('[ChatService] reconcileStreamingState: updating state to reflect active streaming', {
        sessionId,
        wasProcessing: currentState.isProcessing,
        wasStreaming: currentState.isStreaming,
      });
      this.state.update((s) => ({
        ...s,
        isProcessing: true,
        isStreaming: true,
        streamingStartTime: s.streamingStartTime ?? Date.now(),
      }));
      reconciled = true;
    }

    if (reconciled) {
      logger.info('[ChatService] reconcileStreamingState: reconciliation complete', { sessionId });
    }

    return reconciled;
  }

  /**
   * Initialize or switch to a chat session
   */
  async initializeChat(
    workspace: Workspace,
    agentId: string,
    options?: {
      agentName?: string;
      agentModel?: string;
      agentType?: import('$shared/types/agent.types').AgentTypeId;
      isInitialWorkspaceAgent?: boolean;
    },
  ): Promise<void> {
    // Bump the generation counter so any in-flight older initializeChat call
    // can detect it has been superseded and bail out before mutating state.
    const myGeneration = ++this._initGeneration;
    logger.info('Initializing chat', { workspaceId: workspace.id, agentId, initGeneration: myGeneration });

    try {
      // Get or create session
      // CROSS-WORKSPACE FIX: Use workspace-scoped lookup instead of currentWorkspace,
      // which reflects the UI's active workspace and may differ from the workspace
      // that owns this agent (e.g., background init, restore, or rebind scenarios).
      const targetWorkspace = unifiedStateStore.getWorkspace(workspace.id as any);
      const agentState = targetWorkspace?.agents.get(agentId);
      let session = agentState?.session;

      if (!session) {
        // Try to get from agent service first (it might be in memory there)
        const tempSession = agentService.getSession(agentId);
        if (tempSession) {
          session = tempSession;
        }
      }

      if (!session) {
        // Try to restore from disk
        try {
          const restoredSession = await agentService.restoreSession(agentId, workspace);
          if (restoredSession) {
            session = { ...restoredSession, isStreaming: restoredSession.isStreaming ?? false };
            logger.info('Restored session from disk', { agentId });

            // Note: Pending agents will be activated lazily on first message
            // This is more efficient and safer than activating immediately
            if (restoredSession.status === 'pending' || !restoredSession.backendSessionId) {
              logger.info('Restored agent is pending, will activate on first message', {
                agentId,
                status: restoredSession.status,
              });
            }
          }
        } catch (err) {
          logger.warn('Could not restore session from disk', { agentId, error: err });
        }
      }

      if (!session) {
        // Session not found yet — this commonly happens when ChatPanel mounts
        // before the workspace page finishes restoring agents from disk or
        // activating the initial agent. Retry a few times with backoff before
        // giving up, since the session is likely being created concurrently.
        //
        // DO NOT auto-create a new session here. Session creation is the
        // responsibility of explicit user actions (keyboard shortcut, workspace
        // creation, task delegation) — not a side effect of mounting a chat UI.
        const retryDelays = [500, 1000, 2000];
        for (const delay of retryDelays) {
          logger.debug('Session not found, retrying after delay', {
            agentId,
            workspaceId: workspace.id,
            retryDelayMs: delay,
          });
          await new Promise((resolve) => setTimeout(resolve, delay));

          // Check unified state store first — use workspace-scoped lookup
          const retryWorkspace = unifiedStateStore.getWorkspace(workspace.id as any);
          session = retryWorkspace?.agents.get(agentId)?.session ?? undefined;

          // Fall back to agent service
          if (!session) {
            const tempSession = agentService.getSession(agentId);
            if (tempSession) {
              session = tempSession;
            }
          }

          if (session) {
            logger.info('Session found after retry', {
              agentId,
              workspaceId: workspace.id,
              retryDelayMs: delay,
            });
            break;
          }
        }
      }

      if (!session) {
        // Session genuinely doesn't exist after retries — this is a stale tab
        // referencing a deleted agent, not a race condition.
        // However, we still register a sessionUpdatedHandler so that if the session
        // appears later (e.g., backend creates it asynchronously), we can pick up
        // streaming events instead of missing them entirely.
        logger.warn('No session found for agent after retries, registering deferred handler', {
          agentId,
          workspaceId: workspace.id,
        });

        // RACE GUARD: Bail out if a newer initializeChat() call has already started.
        // Without this, a slower superseded init can reach this point after a newer
        // call has registered its own deferred handler, and overwrite that handler
        // with one that re-initializes against the wrong (older) workspace.
        if (this._initGeneration !== myGeneration) {
          logger.info('[ChatService] initializeChat superseded before deferred handler registration', {
            agentId, myGeneration, currentGeneration: this._initGeneration,
          });
          return;
        }

        // Clean up any existing handler for this agent before registering a new one
        const existingCleanup = this.sessionUpdatedCleanups.get(agentId);
        if (existingCleanup) {
          existingCleanup();
          this.sessionUpdatedCleanups.delete(agentId);
        }

        // Capture the generation at registration time so the handler can detect
        // if it has been superseded by a newer initializeChat() call.
        const registeredGeneration = myGeneration;

        const deferredSessionHandler = () => {
          // RACE GUARD: If a newer initializeChat() has started since this handler
          // was registered, this handler is stale — bail out and let the newer one
          // handle the session appearance.
          if (this._initGeneration !== registeredGeneration) {
            logger.info('[ChatService] Deferred handler: superseded, skipping re-init', {
              agentId,
              registeredGeneration,
              currentGeneration: this._initGeneration,
            });
            // Clean up this stale handler
            const staleCleanup = this.sessionUpdatedCleanups.get(agentId);
            if (staleCleanup) {
              staleCleanup();
              this.sessionUpdatedCleanups.delete(agentId);
            }
            return;
          }

          // CROSS-WORKSPACE FIX: Use workspace-aware lookup so the deferred handler
          // finds the session in the correct workspace, not whichever workspace the
          // user happens to be viewing when the event fires.
          const newSession = sessionStore.getSessionForWorkspace(workspace.id as string, agentId)
            ?? sessionStore.getSession(agentId);
          if (!newSession) return;

          logger.info('[ChatService] Deferred handler: session appeared', {
            agentId,
            isStreaming: newSession.isStreaming,
          });

          // Session now exists — run full initialization
          // Remove this deferred handler first to avoid re-entry
          const cleanup = this.sessionUpdatedCleanups.get(agentId);
          if (cleanup) {
            cleanup();
            this.sessionUpdatedCleanups.delete(agentId);
          }

          // Re-initialize now that the session exists
          this.initializeChat(workspace, agentId, options).catch((err) => {
            logger.error('[ChatService] Deferred handler: re-initialization failed', err);
          });
        };

        const deferredCleanup = memoryManager.registerListener(
          window,
          `agent:session-updated:${agentId}`,
          deferredSessionHandler,
          this,
        );
        this.sessionUpdatedCleanups.set(agentId, deferredCleanup);

        return;
      }

      // Get messages for this session
      // During HMR/remount, if this instance is already streaming, prefer its own
      // state.messages because sessionStore is only synced periodically and may be stale.
      let messages: AgentMessage[] = [];
      let hasActiveStream = false;
      try {
        const currentState = get(this.state);
        hasActiveStream =
          currentState.isStreaming &&
          currentState.messages.length > 0;

        if (hasActiveStream) {
          // Use this instance's messages - they're the most up-to-date during streaming
          messages = currentState.messages;
          logger.info('Using instance state messages during active stream', {
            agentId,
            count: messages.length,
            lastMessageBlocks: messages[messages.length - 1]?.contentBlocks?.length || 0,
          });
        } else {
          // Normal case: check multiple sources for latest state
          // CROSS-WORKSPACE FIX: Use workspace-aware lookup so we hydrate from
          // the correct workspace's session, not whichever the user is viewing.
          const sessionStoreSession = sessionStore.getSessionForWorkspace(
            workspace.id as string, agentId,
          ) ?? sessionStore.getSession(agentId);
          const sessionStoreMessages =
            sessionStoreSession?.messages && Array.isArray(sessionStoreSession.messages)
              ? sessionStoreSession.messages
              : [];

          // If instance state has more messages than sessionStore,
          // prefer instance state. This happens when a stream completes while the user
          // is on a different workspace — the instance processed the end event and has
          // the completed response, but sessionStore may have been overwritten by
          // restoreSessionWithoutBackend with stale disk data.
          if (
            currentState.messages.length > 0 &&
            currentState.messages.length > sessionStoreMessages.length
          ) {
            messages = currentState.messages;
            logger.info('Using instance state messages (more complete than sessionStore)', {
              agentId,
              instanceCount: currentState.messages.length,
              sessionStoreCount: sessionStoreMessages.length,
            });
          } else if (
            currentState.messages.length > 0 &&
            currentState.messages.length === sessionStoreMessages.length &&
            sessionStoreMessages.length > 0
          ) {
            // Content-richness tiebreaker: same message count, prefer richer final message
            const currentLast = currentState.messages[currentState.messages.length - 1];
            const sessionLast = sessionStoreMessages[sessionStoreMessages.length - 1];
            if (currentLast?.id === sessionLast?.id) {
              const getTextLength = (blocks: ContentBlock[]) =>
                blocks?.reduce((sum: number, b: ContentBlock) => {
                  if (b.type === 'text' && 'text' in b) return sum + ((b as any).text?.length || 0);
                  return sum;
                }, 0) || 0;
              const currentTextLength = getTextLength(currentLast?.contentBlocks || []);
              const sessionTextLength = getTextLength(sessionLast?.contentBlocks || []);
              if (currentTextLength > sessionTextLength) {
                messages = currentState.messages;
                logger.info(
                  '[ChatService] initializeChat: preferring instance state (richer final message content)',
                  {
                    currentTextLength,
                    sessionTextLength,
                    messageCount: currentState.messages.length,
                  },
                );
              } else {
                messages = sessionStoreMessages;
                logger.debug('Got messages from sessionStore', {
                  agentId,
                  count: messages.length,
                });
              }
            } else {
              // Different last message IDs — fall through to sessionStore
              messages = sessionStoreMessages;
              logger.debug('Got messages from sessionStore', { agentId, count: messages.length });
            }
          } else if (sessionStoreMessages.length > 0) {
            messages = sessionStoreMessages;
            logger.debug('Got messages from sessionStore', { agentId, count: messages.length });
          } else if (session.messages && Array.isArray(session.messages)) {
            // Fall back to messages from session
            messages = session.messages;
            logger.debug('Got messages from session', { agentId, count: messages.length });
          } else {
            // Try to get from unified state store using the workspace passed to
            // initializeChat (not currentWorkspace, which reflects the UI and can
            // differ during restore/rebind/background init).
            const allWorkspaces = unifiedStateStore.getAllWorkspaces();
            const targetWs = allWorkspaces.find((w) => w.workspace?.id === workspace.id);
            const agent = targetWs?.agents.get(agentId);
            if (agent?.messages) {
              messages = agent.messages;
              logger.debug('Got messages from unified state store (workspace-aware)', {
                agentId,
                count: messages.length,
                workspaceId: workspace.id,
              });
            }
          }
        }

        // If we still have no messages but session exists, try to reload from disk
        if (messages.length === 0 && session) {
          logger.info('No messages found in memory, attempting to reload from disk', { agentId });
          try {
            const restoredSession = await agentService.restoreSession(agentId, workspace);
            if (
              restoredSession &&
              restoredSession.messages &&
              restoredSession.messages.length > 0
            ) {
              messages = restoredSession.messages;
              // Guard: bail if a newer initializeChat started while we were doing disk I/O
              if (this._initGeneration !== myGeneration) {
                logger.info('[ChatService] initializeChat superseded before session.messages mutation', {
                  agentId, myGeneration, currentGeneration: this._initGeneration,
                });
                return;
              }
              // Update the session with restored messages
              session.messages = messages;
              logger.info('Successfully restored messages from disk', {
                agentId,
                count: messages.length,
              });
            }
          } catch (err) {
            logger.warn('Failed to restore messages from disk', { agentId, error: err });
          }
        }
      } catch (err) {
        logger.warn('Could not retrieve messages', err);
        messages = [];
      }

      // Note: We don't automatically resend messages here anymore.
      // The factory handles the initial message, and the backend will respond when ready.
      // Automatic resending was causing duplicate messages when the backend was just slow to respond.

      // Check if the session is currently streaming (e.g., if we're loading an agent that's already processing)
      // Also check the unified state store for the most up-to-date streaming state
      let isCurrentlyStreaming = session?.isStreaming || false;

      // Double-check with unified state store - it's the source of truth for streaming state
      const workspaceState = unifiedStateStore.getWorkspace(workspace.id);
      const agentFromStore = workspaceState?.agents.get(agentId);
      if (agentFromStore?.streaming?.active) {
        isCurrentlyStreaming = true;
        logger.info('Detected active streaming from unified state store', {
          agentId,
          sessionIsStreaming: session?.isStreaming,
          storeStreamingActive: agentFromStore.streaming.active,
        });
      }

      // During HMR, the session and unified state store may be reset while
      // the ChatService singleton's own state still correctly reflects streaming=true.
      // If we detected an active stream from the instance state (hasActiveStream above),
      // trust it — it's the most up-to-date source during HMR. Without this, isCurrentlyStreaming
      // would be false after HMR, causing the sessionUpdatedHandler guard to fail, which allows
      // stale disk data from loadAgentsFromDisk to overwrite in-memory messages (including
      // user messages that haven't been persisted to disk yet).
      if (hasActiveStream && !isCurrentlyStreaming) {
        isCurrentlyStreaming = true;
        logger.info('Preserving streaming state from instance', {
          agentId,
          sessionIsStreaming: session?.isStreaming,
          storeStreamingActive: agentFromStore?.streaming?.active,
        });
      }

      logger.info('Initializing chat - streaming state check', {
        agentId,
        sessionIsStreaming: session?.isStreaming,
        storeStreamingActive: agentFromStore?.streaming?.active,
        instanceStreamingActive: hasActiveStream,
        isCurrentlyStreaming,
      });

      // If the session is streaming, initialize localStreamingContent with existing text
      // This ensures that when new chunks arrive, they're appended to the existing content
      // rather than starting from empty (which causes the "mid-stream" display issue)
      //
      // IMPORTANT: Only use the LAST text block's content, not all text blocks joined together.
      // This is because flushChunkUpdate() only replaces the LAST text block with localStreamingContent.
      // If we join all text blocks, the first text block's content would be duplicated in the last block.
      let existingStreamingContent = '';

      // Check if we already have a valid localStreamingContent from an active stream
      // This happens during HMR - the accumulator may have content that hasn't been
      // flushed to the message yet, so we should preserve it rather than re-extracting from messages
      const freshState = get(this.state);
      const hasActiveStreamForContent =
        freshState.isStreaming &&
        this.localStreamingContent.length > 0;

      if (hasActiveStreamForContent) {
        // Preserve the current accumulator - it has unflushed content
        existingStreamingContent = this.localStreamingContent;
        logger.info('Preserving localStreamingContent during HMR', {
          agentId,
          preservedContentLength: existingStreamingContent.length,
        });
      } else if (isCurrentlyStreaming && messages.length > 0) {
        const lastMessage = messages[messages.length - 1];
        if (lastMessage?.role === 'assistant' && lastMessage?.contentBlocks) {
          // Find the LAST text block (not all text blocks) - this is what flushChunkUpdate will replace
          const textBlocks = lastMessage.contentBlocks.filter(
            (b: ContentBlock) => b.type === 'text',
          );
          const lastTextBlock = textBlocks[textBlocks.length - 1];
          if (lastTextBlock && 'text' in lastTextBlock) {
            existingStreamingContent = lastTextBlock.text || '';
          }

          logger.info('Initializing localStreamingContent with existing content', {
            agentId,
            existingContentLength: existingStreamingContent.length,
            contentBlocksCount: lastMessage.contentBlocks.length,
            textBlockCount: textBlocks.length,
            usingLastTextBlockOnly: true,
          });
        }
        // Guard: bail if a newer initializeChat started while we were doing async work
        if (this._initGeneration !== myGeneration) {
          logger.info('[ChatService] initializeChat superseded before localStreamingContent mutation', {
            agentId, myGeneration, currentGeneration: this._initGeneration,
          });
          return;
        }
        // Initialize local accumulator with existing content (if streaming)
        this.localStreamingContent = existingStreamingContent;
      }

      // Deduplicate messages loaded from disk to prevent Svelte "duplicate key" error
      // This handles cases where persisted session data already contains duplicate messages
      const seen = new Set<string>();
      const deduplicatedMessages = messages.filter((m) => {
        if (seen.has(m.id)) {
          logger.warn('Removing duplicate message during session initialization', {
            messageId: m.id,
            agentId,
          });
          return false;
        }
        seen.add(m.id);
        return true;
      });

      if (deduplicatedMessages.length !== messages.length) {
        logger.warn('Found and removed duplicate messages during initialization', {
          agentId,
          originalCount: messages.length,
          deduplicatedCount: deduplicatedMessages.length,
        });
      }

      // BUGFIX: If restoring a streaming session, populate lastAttemptedMessage from the
      // last user message so retry works if the stream errors out. Without this, retry
      // after a restored stream error shows "No message to retry" because lastAttemptedMessage
      // is not persisted across page refreshes.
      let restoredLastAttemptedMessage: ChatState['lastAttemptedMessage'] = null;
      if (isCurrentlyStreaming && deduplicatedMessages.length > 0) {
        // Find the last user message in the conversation
        for (let i = deduplicatedMessages.length - 1; i >= 0; i--) {
          const msg = deduplicatedMessages[i];
          if (msg.role === 'user') {
            const textBlock = msg.contentBlocks?.find(
              (b: ContentBlock) => b.type === 'text' && 'text' in b,
            );
            if (textBlock && 'text' in textBlock) {
              restoredLastAttemptedMessage = { text: textBlock.text || '' };
            }
            break;
          }
        }
      }

      // STALE-INIT GUARD: A newer initializeChat call has started while this one
      // was doing async work (session lookups, retries, disk restores). Bail out
      // to avoid overwriting the store with data from an older workspace.
      if (this._initGeneration !== myGeneration) {
        logger.info('[ChatService] initializeChat superseded by newer call, skipping state update', {
          agentId,
          myGeneration,
          currentGeneration: this._initGeneration,
        });
        return;
      }

      // Update state - ensure isStreaming has a default value
      this.state.update((s) => ({
        ...s,
        session: session ? { ...session, isStreaming: session.isStreaming ?? false } : null,
        messages: deduplicatedMessages,
        isStreaming: isCurrentlyStreaming,
        isProcessing: isCurrentlyStreaming,
        streamingContent: existingStreamingContent, // Use existing content instead of empty string
        error: null,
        lastAttemptedMessage: restoredLastAttemptedMessage ?? s.lastAttemptedMessage,
      }));

      // Set up streaming for this session
      // Use session.id for streaming events (this is what AgentService uses as agentId)
      const streamSessionId = session.id;
      logger.debug('[ChatService] Setting up streaming', {
        agentId,
        streamSessionId,
        sessionId: session.id,
        sessionKeys: Object.keys(session),
        existingStreamingContentLength: existingStreamingContent.length,
      });
      this.setupStreaming(streamSessionId);
    } catch (error) {
      logger.error('Failed to initialize chat', error as Error);
      this.state.update((s) => ({
        ...s,
        error: error instanceof Error ? error.message : 'Failed to initialize chat',
      }));
      throw error;
    }
  }

  /**
   * Send a message in the active chat
   */
  async sendMessage(
    message: string,
    workspace: Workspace,
    options?: SendMessageOptions,
  ): Promise<void> {
    // Validate inputs - allow empty text if there are media attachments (images or files)
    // Check all attachment forms: base64 image data, base64 file data, and File objects (uploads)
    const hasMediaAttachments = options?.contextItems?.some(
      (item) =>
        (item.imageData && item.imageMimeType) ||
        (item.fileData && item.fileMimeType) ||
        item.file,
    );
    if (!message?.trim() && !hasMediaAttachments) {
      throw new Error('Message cannot be empty');
    }

    // Normalize: trim whitespace/newlines so that sendKey and the downstream
    // agentService.sendMessage all use the same canonical form.
    message = message?.trim() ?? '';

    // Check message length (only if message is provided)
    if (message && message.length > MAX_MESSAGE_LENGTH) {
      throw new Error(`Message too long. Maximum length is ${MAX_MESSAGE_LENGTH} characters`);
    }

    if (!workspace) {
      throw new Error('Workspace is required');
    }

    let currentState = get(this.state);

    if (!currentState.session) {
      throw new Error('No active chat session');
    }

    // ALWAYS fetch the session from sessionStore to get fresh isStreaming state.
    // The internal state copy can become stale. The sessionStore reflects the true state from
    // unifiedStateStore, which is updated when setStreamingForWorkspace() is called on stream
    // completion. Without always refreshing, we might check a stale isStreaming=true and block sends.
    // CROSS-WORKSPACE FIX: Use workspace-aware lookup so the overlap guard consults the
    // correct session even when the user is viewing a different workspace.
    const agentId = options?.agentId || currentState.session.id;
    const sendWorkspaceId = currentState.session.workspaceId;
    let session = sendWorkspaceId
      ? sessionStore.getSessionForWorkspace(sendWorkspaceId as string, agentId)
      : sessionStore.getSession(agentId);

    if (!session) {
      // Fallback to the cached state if sessionStore doesn't have it (shouldn't happen normally)
      logger.warn('Session not found in sessionStore, using cached state', {
        agentId,
        cachedSessionId: currentState.session?.id,
      });
      session = currentState.session;
    }

    // Wait for any ongoing interrupt to complete before sending
    // This prevents race conditions where we send while backend is still cleaning up
    if (currentState.isInterrupting) {
      logger.debug('Waiting for interrupt to complete before sending');
      const maxWaitMs = 500;
      const pollIntervalMs = 25;
      let waited = 0;
      while (waited < maxWaitMs) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        waited += pollIntervalMs;
        currentState = get(this.state);
        if (!currentState.isInterrupting) {
          break;
        }
      }
      if (currentState.isInterrupting) {
        logger.warn('Interrupt still in progress after timeout, proceeding anyway');
      }
    }

    // Provider mismatch safety net — block sending if agent's provider ≠ active provider
    // const agentProvider = getAgentProvider(session);
    // if (agentProvider && agentProvider !== activeProviderStore.activeProviderId) {
    //   const agentProviderName = getProviderConfig(agentProvider).displayName;
    //   const activeProviderName = getProviderConfig(
    //     activeProviderStore.activeProviderId,
    //   ).displayName;
    //   throw new Error(
    //     `Cannot send message: this agent uses ${agentProviderName}, but the active provider is ${activeProviderName}. Switch to ${agentProviderName} or create a new agent.`,
    //   );
    // }

    // Prevent sending while already processing.
    // Check BOTH sessionStore (source of truth once streaming is fully set up) AND the
    // in-memory ChatService state. There is a window after the pending-agent first-send
    // where this instance has already set isProcessing/isStreaming=true but sessionStore
    // hasn't been updated yet (activation is in progress). Without checking both, a second
    // send could overlap the in-flight activation/request.
    const instanceState = get(this.state);
    if (session.isStreaming || instanceState.isProcessing || instanceState.isStreaming) {
      logger.warn('Already processing a message for this agent, ignoring new send request', {
        agentId: session.id,
        sessionIsStreaming: session.isStreaming,
        instanceIsProcessing: instanceState.isProcessing,
        instanceIsStreaming: instanceState.isStreaming,
      });
      return;
    }

    // Rate limiting
    const now = Date.now();
    if (now - this.lastMessageTime < MIN_MESSAGE_SEND_INTERVAL) {
      logger.warn('Message sent too quickly, ignoring');
      return;
    }
    this.lastMessageTime = now;

    // Idempotency check: prevent duplicate sends from double-clicks
    const sendKey = `${session.id}:${message}:${Math.floor(now / 1000)}`;
    if (this.recentSendKeys.has(sendKey)) {
      logger.warn('Duplicate message send detected (idempotency), ignoring', {
        sessionId: session.id,
        messageLength: message.length,
      });
      return;
    }
    this.recentSendKeys.add(sendKey);
    // Auto-expire the key after TTL so legitimate resends work
    const timer = setTimeout(() => {
      this.recentSendKeys.delete(sendKey);
      this.sendKeyTimers.delete(sendKey);
    }, ChatService.SEND_KEY_TTL_MS);
    this.sendKeyTimers.set(sendKey, timer);

    logger.info('Sending message', {
      sessionId: session.id,
      messageLength: message.length,
      hasContext: !!options?.contextItems?.length,
    });

    // Track whether this agent needs activation (pending/no backend session)
    const needsActivation = session.status === 'pending' || !session.backendSessionId;

    // Build content blocks for user message
    const contentBlocks: ContentBlock[] = [{ type: 'text' as const, text: message.trim() }];

    // Extract image files from context items and convert to image blocks
    const imageFileItems =
      options?.contextItems?.filter((item) => item.file && isImageFile(item.file)) || [];

    // Extract non-image files from context items
    const nonImageFileItems =
      options?.contextItems?.filter((item) => item.file && !isImageFile(item.file)) || [];

    // Also include items that already have base64 image data (from edited messages)
    const base64ImageItems =
      options?.contextItems?.filter((item) => item.imageData && item.imageMimeType) || [];

    // Also include items that already have base64 file data (from edited messages)
    const base64FileItems =
      options?.contextItems?.filter((item) => item.fileData && item.fileMimeType) || [];

    logger.info('Chat Service: Processing context items for images and files', {
      totalContextItems: options?.contextItems?.length || 0,
      imageFileItems: imageFileItems.length,
      nonImageFileItems: nonImageFileItems.length,
      base64ImageItems: base64ImageItems.length,
      base64FileItems: base64FileItems.length,
      contextItemTypes:
        options?.contextItems?.map((item) => ({
          type: item.type,
          hasFile: !!item.file,
          hasImageData: !!item.imageData,
          hasImageMimeType: !!item.imageMimeType,
          hasFileData: !!item.fileData,
          hasFileMimeType: !!item.fileMimeType,
          fileDataLength: (item as any).fileData?.length || 0,
          imageMimeType: item.imageMimeType,
          fileMimeType: item.fileMimeType,
        })) || [],
    });

    // Convert File objects to base64 and add as image blocks
    const imageBlocksFromFiles = await Promise.all(
      imageFileItems.map(async (item) => {
        try {
          const { data, mimeType } = await fileToBase64(item.file!);
          return {
            type: 'image' as const,
            data,
            mimeType,
          };
        } catch (error) {
          logger.error('Failed to convert image to base64', { fileName: item.label, error });
          return null;
        }
      }),
    );

    // Convert non-image File objects to base64 and add as file blocks
    const fileBlocksFromFiles = await Promise.all(
      nonImageFileItems.map(async (item) => {
        try {
          const { data, mimeType } = await fileToBase64(item.file!);
          return {
            type: 'file' as const,
            data,
            mimeType,
            fileName: item.label || item.file!.name,
          };
        } catch (error) {
          logger.error('Failed to convert file to base64', { fileName: item.label, error });
          return null;
        }
      }),
    );

    // Add image blocks from File objects
    for (const block of imageBlocksFromFiles) {
      if (block) {
        contentBlocks.push(block);
      }
    }

    // Add file blocks from File objects
    for (const block of fileBlocksFromFiles) {
      if (block) {
        contentBlocks.push(block);
      }
    }

    // Add image blocks from base64 data (already converted)
    for (const item of base64ImageItems) {
      contentBlocks.push({
        type: 'image' as const,
        data: item.imageData!,
        mimeType: item.imageMimeType!,
      });
    }

    // Add file blocks from base64 data (already converted)
    for (const item of base64FileItems) {
      contentBlocks.push({
        type: 'file' as const,
        data: item.fileData!,
        mimeType: item.fileMimeType!,
        fileName: item.label || 'file',
      });
    }

    // Reset local accumulator when sending a new message
    this.localStreamingContent = '';

    this.state.update((s) => ({
      ...s,
      isProcessing: true,
      isStreaming: true,
      streamingContent: '',
      error: null,
      streamingStartTime: Date.now(),
      lastChunkTime: null, // Reset so stall detection treats this as a fresh stream
      isStalled: false,
      // Store message for retry functionality
      lastAttemptedMessage: { text: message.trim(), options },
    }));

    // Resolve the workspace identity for activation and send.
    // Use the session's own workspaceId (not the passed-in workspace param which
    // reflects the *current* UI workspace) so activation targets the correct workspace.
    const sessionWorkspaceId = (currentState.session?.workspaceId ?? workspace.id) as string;

    // Dispatch event so UI components can show running state immediately
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent(`agent:message-sent:${session.id}`, {
          detail: { agentId: session.id },
        }),
      );
    }

    // Lazy activation: if agent is pending, activate it now on first message.
    if (needsActivation) {
      logger.info('Agent is pending, activating on first message', {
        agentId: session.id,
        status: session.status,
      });

      try {
        const activatedAgent = await agentService.activateAgent(session.id, sessionWorkspaceId);
        if (!activatedAgent) {
          throw new Error('Failed to activate agent');
        }

        // Update state with activated agent
        this.state.update((s) => ({
          ...s,
          session: activatedAgent,
        }));
      } catch (error) {
        logger.error('Failed to activate agent on first message', error as Error);

        // Clean up idempotency entry so an immediate retry isn't suppressed as a duplicate.
        this.recentSendKeys.delete(sendKey);
        const activationSendKeyTimer = this.sendKeyTimers.get(sendKey);
        if (activationSendKeyTimer) {
          clearTimeout(activationSendKeyTimer);
          this.sendKeyTimers.delete(sendKey);
        }

        this.state.update((s) => ({
          ...s,
          isProcessing: false,
          isStreaming: false,
          streamingStartTime: null,
          error: error instanceof Error ? error.message : 'Failed to activate agent',
        }));
        throw error;
      }
    }

    // CRITICAL: Ensure stream handler is set up before sending
    // This is needed because stopChat() removes the handler, and when sending
    // a queued message after stopping, we need to re-register the handler
    const streamSessionId = session.id;
    if (!this.streamHandlers.has(streamSessionId)) {
      logger.info('[ChatService] Re-setting up stream handler before sendMessage', {
        sessionId: streamSessionId,
      });
      this.setupStreaming(streamSessionId);
    }

    try {
      // Extract image blocks to pass to backend
      const imageBlocksForBackend = contentBlocks.filter(
        (block): block is { type: 'image'; data: string; mimeType: string } =>
          block.type === 'image' && 'data' in block && 'mimeType' in block,
      );

      // Extract file blocks to pass to backend
      const fileBlocksForBackend = contentBlocks.filter(
        (block): block is { type: 'file'; data: string; mimeType: string; fileName: string } =>
          block.type === 'file' && 'data' in block && 'mimeType' in block && 'fileName' in block,
      );

      logger.info('Chat Service: Extracted blocks for backend', {
        imageBlocksCount: imageBlocksForBackend.length,
        fileBlocksCount: fileBlocksForBackend.length,
        fileBlockDetails: fileBlocksForBackend.map((b) => ({
          fileName: b.fileName,
          mimeType: b.mimeType,
          dataLength: b.data?.length || 0,
        })),
      });

      // Build context references from contextItems (converted format)
      const contextItemRefs =
        options?.contextItems?.map((item) => ({
          type: item.type,
          path: item.path,
          content: item.content,
        })) || [];

      // Merge with any direct context references (e.g., Linear/GitHub issues from workspace creation)
      const allContextReferences = [...contextItemRefs, ...(options?.contextReferences || [])];

      // Send message through agent service
      // WORKSPACE ALIGNMENT FIX: Use the same workspace identity that was used for
      // activation. If the user switched workspaces between creating the agent and
      // sending, `workspace` (from the UI) may have a different id than
      // `sessionWorkspaceId` (from the session). Passing the wrong workspace
      // would cause agentService to activate/resume in the wrong workspace context.
      //
      // METADATA FIX: Look up the full workspace from unifiedStateStore instead of
      // spreading the UI workspace with an overridden ID. Spreading keeps stale metadata
      // (worktreePath, repositoryPath, etc.) from the UI workspace, which can mis-target
      // activation or workspace-ready checks in agentService.sendMessage().
      let sendWorkspace = workspace;
      if (sessionWorkspaceId !== workspace.id) {
        const targetWsState = unifiedStateStore.getWorkspace(sessionWorkspaceId as WorkspaceId);
        sendWorkspace = targetWsState?.workspace ?? { ...workspace, id: sessionWorkspaceId as WorkspaceId };
      }
      await agentService.sendMessage(session.id, message, sendWorkspace, {
        contextReferences: allContextReferences,
        imageBlocks: imageBlocksForBackend.length > 0 ? imageBlocksForBackend : undefined,
        fileBlocks: fileBlocksForBackend.length > 0 ? fileBlocksForBackend : undefined,
        noteIds: options?.noteIds,
        personality: options?.personality,
        resetHistory: options?.resetHistory,
        model: options?.model,
      });
    } catch (error) {
      logger.error('Failed to send message', error as Error);

      // Clear idempotency key so retries aren't silently ignored.
      // Without this, a transient failure would leave the sendKey in the set,
      // causing retries within the TTL to be dropped as "duplicates".
      this.recentSendKeys.delete(sendKey);
      const sendKeyTimer = this.sendKeyTimers.get(sendKey);
      if (sendKeyTimer) {
        clearTimeout(sendKeyTimer);
        this.sendKeyTimers.delete(sendKey);
      }

      const errorMessage = error instanceof Error ? error.message : 'Failed to send message';
      const isInterrupted = errorMessage.includes('Agent interrupted');

      if (isInterrupted) {
        // Agent was interrupted (user pressed stop) - just clear streaming state
        logger.debug(
          '[ChatService] Agent interrupted - keeping messages, clearing streaming state',
        );
        this.state.update((s) => ({
          ...s,
          isProcessing: false,
          isStreaming: false,
          streamingStartTime: null,
          // Don't set error for interruptions - it's user-initiated
        }));
      } else {
        // Real error - clear streaming state and set error
        this.state.update((s) => ({
          ...s,
          isProcessing: false,
          isStreaming: false,
          streamingStartTime: null,
          error: cleanErrorMessage(errorMessage),
        }));
      }

      throw error;
    }
  }

  /**
   * Edit a user message and regenerate from that point.
   * This removes all messages after the edited message and sends the new text.
   *
   * If streaming is in progress, this will stop the current stream first,
   * then truncate messages and send the new message.
   */
  async editAndRegenerate(
    messageId: string,
    newText: string,
    workspace: Workspace,
    options?: SendMessageOptions,
  ): Promise<void> {
    let currentState = get(this.state);
    if (!currentState.session) {
      throw new Error('No active chat session');
    }

    // Find the message index BEFORE any state modifications
    let messageIndex = currentState.messages.findIndex((m) => m.id === messageId);
    if (messageIndex === -1) {
      throw new Error('Message not found');
    }

    const message = currentState.messages[messageIndex];
    if (message.role !== 'user') {
      throw new Error('Can only edit user messages');
    }

    // If streaming or processing is in progress, stop it first
    // This ensures we can send the new message without conflicts
    if (currentState.isStreaming || currentState.isProcessing) {
      logger.info('Stopping current stream before editing message', {
        messageId,
        isStreaming: currentState.isStreaming,
        isProcessing: currentState.isProcessing,
      });
      await this.stopChat();

      // Re-fetch state after stopping - messages may have changed
      currentState = get(this.state);

      // Re-find the message index after state change
      // CRITICAL: Use the updated index for truncation, not the stale one
      messageIndex = currentState.messages.findIndex((m) => m.id === messageId);
      if (messageIndex === -1) {
        throw new Error('Message not found after stopping stream');
      }
    }

    // Remove all messages from this point onwards
    const messagesBeforeEdit = currentState.messages.slice(0, messageIndex);

    // CRITICAL: Update both ChatService state AND sessionStore
    // If we only update ChatService state, the session-updated event handler
    // will overwrite our truncated messages with the old messages from sessionStore
    this.state.update((s) => ({
      ...s,
      messages: messagesBeforeEdit,
    }));

    // Sync the truncated messages to sessionStore so they persist in memory
    const sessionId = currentState.session?.id;
    if (sessionId) {
      sessionStore.updateMessages(sessionId, messagesBeforeEdit);

      // Persist truncated messages to disk immediately so they survive page refresh.
      // Fire-and-forget: the subsequent sendMessage will also persist on stream complete.
      agentService.saveSession(sessionId, workspace.id, false, { allowTruncation: true }).catch((err) => {
        logger.warn('Failed to persist truncated messages after edit', {
          sessionId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    // Send the new message with resetHistory flag to clear ACP session history
    await this.sendMessage(newText, workspace, { ...options, resetHistory: true });
  }

  /**
   * Regenerate the last assistant response.
   * This removes the last assistant message and resends the last user message.
   *
   * If streaming is in progress, this will stop the current stream first,
   * then truncate messages and resend the last user message.
   */
  async regenerateLastResponse(workspace: Workspace, options?: SendMessageOptions): Promise<void> {
    let currentState = get(this.state);
    if (!currentState.session) {
      throw new Error('No active chat session');
    }

    // If streaming or processing is in progress, stop it first
    if (currentState.isStreaming || currentState.isProcessing) {
      logger.info('Stopping current stream before regenerating response', {
        isStreaming: currentState.isStreaming,
        isProcessing: currentState.isProcessing,
      });
      await this.stopChat();

      // Re-fetch state after stopping
      currentState = get(this.state);
    }

    const messages = currentState.messages;
    if (messages.length < 2) {
      throw new Error('Not enough messages to regenerate');
    }

    // Find the last user message and remove everything after it
    let lastUserMessageIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        lastUserMessageIndex = i;
        break;
      }
    }

    if (lastUserMessageIndex === -1) {
      throw new Error('No user message found to regenerate from');
    }

    const lastUserMessage = messages[lastUserMessageIndex];
    const messagesBeforeRegenerate = messages.slice(0, lastUserMessageIndex);

    // Get the text from the last user message
    let userText = '';
    if (lastUserMessage.contentBlocks && Array.isArray(lastUserMessage.contentBlocks)) {
      userText = lastUserMessage.contentBlocks
        .filter((block) => block.type === 'text' && block.text)
        .map((block) => block.text)
        .join('');
    }

    // Extract image and file blocks from the original message so they are preserved on regenerate
    const mediaContextItems: ContextItem[] = [];
    if (lastUserMessage.contentBlocks && Array.isArray(lastUserMessage.contentBlocks)) {
      for (const block of lastUserMessage.contentBlocks) {
        if (block.type === 'image' && block.data && block.mimeType) {
          mediaContextItems.push({
            id: `regen-image-${mediaContextItems.length}`,
            type: 'file',
            label: `Image ${mediaContextItems.length + 1}`,
            imageData: block.data,
            imageMimeType: block.mimeType,
          });
        } else if (block.type === 'file' && block.data && block.mimeType) {
          mediaContextItems.push({
            id: `regen-file-${mediaContextItems.length}`,
            type: 'file',
            label: block.fileName || 'file',
            fileData: block.data,
            fileMimeType: block.mimeType,
          });
        }
      }
    }

    const hasAttachments = mediaContextItems.length > 0;

    if (!userText.trim() && !hasAttachments) {
      throw new Error('Could not extract text from user message');
    }

    // Update state to remove messages from the user message onwards
    // CRITICAL: Update both ChatService state AND sessionStore
    // If we only update ChatService state, the session-updated event handler
    // will overwrite our truncated messages with the old messages from sessionStore
    this.state.update((s) => ({
      ...s,
      messages: messagesBeforeRegenerate,
    }));

    // Sync the truncated messages to sessionStore so they persist in memory
    const sessionId = currentState.session?.id;
    if (sessionId) {
      sessionStore.updateMessages(sessionId, messagesBeforeRegenerate);

      // Persist truncated messages to disk immediately so they survive page refresh.
      agentService.saveSession(sessionId, workspace.id, false, { allowTruncation: true }).catch((err) => {
        logger.warn('Failed to persist truncated messages after regenerate', {
          sessionId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    // Resend the user message with resetHistory flag to clear ACP session history
    // Include original media blocks as context items so they are preserved
    const regenerateOptions: SendMessageOptions = { ...options, resetHistory: true };
    if (mediaContextItems.length > 0) {
      regenerateOptions.contextItems = [
        ...(regenerateOptions.contextItems || []),
        ...mediaContextItems,
      ];
    }
    await this.sendMessage(userText, workspace, regenerateOptions);
  }

  /**
   * Regenerate the response to a specific message.
   * This finds the user message that preceded the given assistant message,
   * truncates the conversation to that point, and resends the user message.
   *
   * This allows regenerating from any point in the conversation, not just the last message.
   *
   * @param assistantMessageId - The ID of the assistant message to regenerate
   * @param workspace - The workspace containing the session
   * @param options - Optional send message options
   */
  async regenerateFromMessage(
    assistantMessageId: string,
    workspace: Workspace,
    options?: SendMessageOptions,
  ): Promise<void> {
    let currentState = get(this.state);
    if (!currentState.session) {
      throw new Error('No active chat session');
    }

    // If streaming or processing is in progress, stop it first
    if (currentState.isStreaming || currentState.isProcessing) {
      logger.info('Stopping current stream before regenerating response', {
        isStreaming: currentState.isStreaming,
        isProcessing: currentState.isProcessing,
        assistantMessageId,
      });
      await this.stopChat();

      // Re-fetch state after stopping
      currentState = get(this.state);
    }

    const messages = currentState.messages;

    // Find the assistant message
    const assistantMessageIndex = messages.findIndex((m) => m.id === assistantMessageId);
    if (assistantMessageIndex === -1) {
      throw new Error('Assistant message not found');
    }

    // Find the user message that preceded this assistant message
    let userMessageIndex = -1;
    for (let i = assistantMessageIndex - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        userMessageIndex = i;
        break;
      }
    }

    if (userMessageIndex === -1) {
      throw new Error('No user message found before the assistant message');
    }

    const userMessage = messages[userMessageIndex];
    const messagesBeforeRegenerate = messages.slice(0, userMessageIndex);

    // Get the text from the user message
    let userText = '';
    if (userMessage.contentBlocks && Array.isArray(userMessage.contentBlocks)) {
      userText = userMessage.contentBlocks
        .filter((block) => block.type === 'text' && block.text)
        .map((block) => block.text)
        .join('');
    }

    // Extract image and file blocks from the original message so they are preserved on regenerate
    const mediaContextItems: ContextItem[] = [];
    if (userMessage.contentBlocks && Array.isArray(userMessage.contentBlocks)) {
      for (const block of userMessage.contentBlocks) {
        if (block.type === 'image' && block.data && block.mimeType) {
          mediaContextItems.push({
            id: `regen-image-${mediaContextItems.length}`,
            type: 'file',
            label: `Image ${mediaContextItems.length + 1}`,
            imageData: block.data,
            imageMimeType: block.mimeType,
          });
        } else if (block.type === 'file' && block.data && block.mimeType) {
          mediaContextItems.push({
            id: `regen-file-${mediaContextItems.length}`,
            type: 'file',
            label: block.fileName || 'file',
            fileData: block.data,
            fileMimeType: block.mimeType,
          });
        }
      }
    }

    const hasAttachments = mediaContextItems.length > 0;

    if (!userText.trim() && !hasAttachments) {
      throw new Error('Could not extract text from user message');
    }

    logger.info('Regenerating from specific message', {
      assistantMessageId,
      userMessageIndex,
      totalMessages: messages.length,
      messagesAfterTruncation: messagesBeforeRegenerate.length,
      hasMediaBlocks: hasAttachments,
    });

    // Update state to remove messages from the user message onwards
    // CRITICAL: Update both ChatService state AND sessionStore
    this.state.update((s) => ({
      ...s,
      messages: messagesBeforeRegenerate,
    }));

    // Sync the truncated messages to sessionStore so they persist in memory
    const sessionId = currentState.session?.id;
    if (sessionId) {
      sessionStore.updateMessages(sessionId, messagesBeforeRegenerate);

      // Persist truncated messages to disk immediately so they survive page refresh.
      agentService.saveSession(sessionId, workspace.id, false, { allowTruncation: true }).catch((err) => {
        logger.warn('Failed to persist truncated messages after regenerate from message', {
          sessionId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    // Resend the user message with resetHistory flag to clear ACP session history
    // Include original media blocks as context items so they are preserved
    const regenerateOptions: SendMessageOptions = { ...options, resetHistory: true };
    if (mediaContextItems.length > 0) {
      regenerateOptions.contextItems = [
        ...(regenerateOptions.contextItems || []),
        ...mediaContextItems,
      ];
    }
    await this.sendMessage(userText, workspace, regenerateOptions);
  }

  /**
   * Retry the last failed message.
   * This clears the error and resends the stored message.
   *
   * If lastAttemptedMessage is not available (e.g., for background/delegated agents
   * whose initial message was sent through the backend), falls back to extracting
   * the last user message from the conversation history and resending it.
   */
  async retryLastMessage(workspace: Workspace): Promise<void> {
    const currentState = get(this.state);

    if (!currentState.session) {
      throw new Error('No active chat session');
    }

    // Prevent retry while already streaming/processing
    if (currentState.isStreaming || currentState.isProcessing) {
      logger.warn('Cannot retry while streaming/processing');
      return;
    }

    if (currentState.lastAttemptedMessage) {
      // Standard path: retry from stored message
      const { text, options } = currentState.lastAttemptedMessage;

      // Clear error state before retrying
      this.state.update((s) => ({
        ...s,
        error: null,
        lastAttemptedMessage: null,
      }));

      logger.info('Retrying last message', { messageLength: text.length });

      // Resend the message
      await this.sendMessage(text, workspace, options);
    } else {
      // Fallback path: extract last user message from conversation history.
      // This handles background/delegated agents whose initial message was sent
      // through the backend (bypassing chatService.sendMessage), so
      // lastAttemptedMessage was never set.
      await this.retryFromConversationHistory(workspace);
    }
  }

  /**
   * Retry the last message with a different model.
   * Used when the original model was unavailable.
   */
  async retryWithModel(workspace: Workspace, model: string): Promise<void> {
    const currentState = get(this.state);

    if (!currentState.session) {
      throw new Error('No active chat session');
    }

    // Prevent retry while already streaming/processing
    if (currentState.isStreaming || currentState.isProcessing) {
      logger.warn('Cannot retry while streaming/processing');
      return;
    }

    if (currentState.lastAttemptedMessage) {
      // Standard path: retry from stored message with new model
      const { text, options } = currentState.lastAttemptedMessage;

      // Clear error and modelUnavailable state before retrying
      this.state.update((s) => ({
        ...s,
        error: null,
        modelUnavailable: null,
        lastAttemptedMessage: null,
      }));

      logger.info('Retrying last message with different model', {
        messageLength: text.length,
        newModel: model,
      });

      // Resend the message with the new model
      await this.sendMessage(text, workspace, {
        ...options,
        model,
      });
    } else {
      // Fallback path: extract last user message from conversation history
      await this.retryFromConversationHistory(workspace, { model });
    }
  }

  /**
   * Fallback retry: extract the last user message from conversation history and resend it.
   * Used when lastAttemptedMessage is null (e.g., background/delegated agents whose initial
   * message was sent through the backend, bypassing chatService.sendMessage).
   *
   * This finds the last user message, removes it and any subsequent messages (error/partial
   * assistant messages), and resends via sendMessage().
   */
  private async retryFromConversationHistory(
    workspace: Workspace,
    options?: SendMessageOptions,
  ): Promise<void> {
    const currentState = get(this.state);
    const messages = currentState.messages;

    // Find the last user message
    let lastUserMessageIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        lastUserMessageIndex = i;
        break;
      }
    }

    if (lastUserMessageIndex === -1) {
      logger.warn('No user message found in conversation history to retry');
      return;
    }

    const lastUserMessage = messages[lastUserMessageIndex];

    // Extract text from content blocks
    let userText = '';
    if (lastUserMessage.contentBlocks && Array.isArray(lastUserMessage.contentBlocks)) {
      userText = lastUserMessage.contentBlocks
        .filter((block) => block.type === 'text' && block.text)
        .map((block) => block.text)
        .join('');
    }

    // Extract image and file blocks to preserve all attachments
    const mediaContextItems: ContextItem[] = [];
    if (lastUserMessage.contentBlocks && Array.isArray(lastUserMessage.contentBlocks)) {
      for (const block of lastUserMessage.contentBlocks) {
        if (block.type === 'image' && block.data && block.mimeType) {
          mediaContextItems.push({
            id: `retry-image-${mediaContextItems.length}`,
            type: 'file',
            label: `Image ${mediaContextItems.length + 1}`,
            imageData: block.data,
            imageMimeType: block.mimeType,
          });
        } else if (block.type === 'file' && block.data && block.mimeType) {
          mediaContextItems.push({
            id: `retry-file-${mediaContextItems.length}`,
            type: 'file',
            label: block.fileName || 'file',
            fileData: block.data,
            fileMimeType: block.mimeType,
          });
        }
      }
    }

    const hasAttachments = mediaContextItems.length > 0;

    if (!userText.trim() && !hasAttachments) {
      logger.warn('Could not extract content from last user message to retry');
      return;
    }

    // Remove the user message and everything after it (error/partial assistant messages)
    const messagesBeforeRetry = messages.slice(0, lastUserMessageIndex);

    logger.info('Retrying from conversation history (fallback)', {
      messageLength: userText.length,
      removedMessages: messages.length - lastUserMessageIndex,
      hasAttachments,
    });

    // Update state: truncate messages and clear error
    this.state.update((s) => ({
      ...s,
      messages: messagesBeforeRetry,
      error: null,
      modelUnavailable: null,
      lastAttemptedMessage: null,
    }));

    // Sync truncated messages to sessionStore so they persist
    // FIX: Use workspace-aware write path so cleanup targets the correct
    // workspace even if the user switched workspaces before retrying.
    const sessionId = currentState.session?.id;
    if (sessionId) {
      const workspaceId = (currentState.session?.workspaceId ?? workspace.id) as string;
      sessionStore.updateMessagesForWorkspace(workspaceId, sessionId, messagesBeforeRetry);

      // Persist truncated messages to disk
      agentService.saveSession(sessionId, workspaceId, false, { allowTruncation: true }).catch((err) => {
        logger.warn('Failed to persist truncated messages after retry fallback', {
          sessionId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    // Resend with resetHistory to clear ACP session history
    const retryOptions: SendMessageOptions = { ...options, resetHistory: true };
    if (mediaContextItems.length > 0) {
      retryOptions.contextItems = [
        ...(retryOptions.contextItems || []),
        ...mediaContextItems,
      ];
    }

    await this.sendMessage(userText, workspace, retryOptions);
  }

  /**
   * Clear the modelUnavailable state
   */
  clearModelUnavailable(): void {
    this.state.update((s) => ({
      ...s,
      modelUnavailable: null,
    }));
  }

  /**
   * Clear the current error state
   */
  clearError(): void {
    this.state.update((s) => ({
      ...s,
      error: null,
    }));
  }

  /**
   * Set up streaming for a session
   */
  private setupStreaming(sessionId: string): void {
    // Invariant: sessionId must exist (session must be initialized before streaming)
    assertStreamingInvariant(
      !!sessionId && sessionId.length > 0,
      'setupStreaming called with empty sessionId',
      { agentId: this.agentId },
    );

    // Invariant: session should exist in the store
    // CROSS-WORKSPACE FIX: Use workspace-aware lookup so the invariant doesn't
    // fail when the user has switched to a different workspace while this agent
    // streams in the background.
    const setupWorkspaceId = get(this.state).session?.workspaceId;
    const sessionCheck = setupWorkspaceId
      ? sessionStore.getSessionForWorkspace(setupWorkspaceId as string, sessionId)
      : sessionStore.getSession(sessionId);
    assertStreamingInvariant(
      !!sessionCheck,
      'setupStreaming called but session not found in store',
      { sessionId, agentId: this.agentId },
    );

    logger.debug('[ChatService] setupStreaming called', {
      sessionId,
      eventName: `agent:stream:${sessionId}`,
    });

    // Clean up any existing handler, but preserve accumulated content.
    // setupStreaming is about re-registering event handlers, not discarding content.
    this.cleanupStream(sessionId, /* preserveContent */ true);

    // Create stream handler
    const handler = (data: any) => {
      this.handleStreamEvent(sessionId, data);
    };

    // Store handler
    this.streamHandlers.set(sessionId, handler);

    // Listen for DOM events from frontend agent service
    // The agent.service.ts receives IPC events and dispatches them as DOM events
    // We only need to listen to the DOM events to avoid duplicate processing
    memoryManager.registerListener(window, `agent:stream:${sessionId}`, handler, this);

    // FIX: Register DOM handler with agentService so it knows we have an active listener
    // This enables proper event queuing decisions in dispatchStreamEvent
    agentService.registerDomHandler(sessionId);

    // FIX: Replay any pending events that were queued while we didn't have a handler
    // This catches events that arrived during navigation, HMR, or component remount timing issues
    agentService.replayPendingEvents(sessionId);

    // FIX: Dispatch synthetic 'start' event for backend-initiated streams.
    // ChatService only arms stall detection and state reconciliation in the
    // data.type === 'start' branch of handleStreamEvent. Backend-initiated streams
    // (delegated agents, woken agents) never get a 'start' event because the stream
    // was already started by the backend before ChatService mounted. Without this,
    // stall detection and reconciliation timers never activate for these streams.
    // CROSS-WORKSPACE FIX: Re-use the workspace-aware lookup from the invariant above
    // so the synthetic start fires correctly for background/cross-workspace agents.
    const session = setupWorkspaceId
      ? sessionStore.getSessionForWorkspace(setupWorkspaceId as string, sessionId)
      : sessionStore.getSession(sessionId);
    if (session?.isStreaming) {
      logger.info('[ChatService] Dispatching synthetic start event for backend-initiated stream', {
        sessionId,
      });
      this.handleStreamEvent(sessionId, new CustomEvent('synthetic', { detail: { type: 'start' } }));
    }

    // Also listen for session-updated events to sync after agent-factory updates
    // This is especially important for queued messages that start streaming from the backend
    const sessionUpdatedHandler = () => {
      logger.debug('[ChatService] sessionUpdatedHandler called', { sessionId });
      // CROSS-WORKSPACE FIX: Use workspace-aware lookup so session-updated events
      // are correctly processed even when the user has switched workspaces.
      const updHandlerWorkspaceId = get(this.state).session?.workspaceId;
      const session = updHandlerWorkspaceId
        ? sessionStore.getSessionForWorkspace(updHandlerWorkspaceId as string, sessionId)
        : sessionStore.getSession(sessionId);
      if (session && session.messages) {
        const currentState = get(this.state);
        const newIsStreaming = session.isStreaming ?? currentState.isStreaming;


        // Even when NOT streaming, don't overwrite instance state that has
        // more messages than the incoming session data. This prevents stale disk data
        // (loaded by loadAgentsFromDisk → restoreSessionWithoutBackend → setAgent)
        // from overwriting a completed response that the ChatService instance already has.
        if (!currentState.isStreaming && currentState.messages.length > 0) {
          const sessionMessageCount = session.messages.length;
          const currentMessageCount = currentState.messages.length;
          if (sessionMessageCount < currentMessageCount) {
            logger.info(
              '[ChatService] sessionUpdatedHandler: skipping - would overwrite completed response with fewer messages (not streaming)',
              {
                sessionId,
                currentMessageCount,
                sessionMessageCount,
              },
            );
            return;
          }
          // Also check: same message count but last message has less content
          if (sessionMessageCount === currentMessageCount && currentMessageCount > 0) {
            const currentLast = currentState.messages[currentMessageCount - 1];
            const sessionLast = session.messages[sessionMessageCount - 1];
            if (currentLast?.id === sessionLast?.id) {
              const getTextLength = (blocks: ContentBlock[]) =>
                blocks?.reduce((sum: number, b: ContentBlock) => {
                  if (b.type === 'text' && 'text' in b) return sum + ((b as any).text?.length || 0);
                  return sum;
                }, 0) || 0;
              const currentTextLength = getTextLength(currentLast?.contentBlocks || []);
              const sessionTextLength = getTextLength(sessionLast?.contentBlocks || []);
              if (sessionTextLength < currentTextLength) {
                logger.info(
                  '[ChatService] sessionUpdatedHandler: skipping - would overwrite completed response with less content (not streaming)',
                  {
                    sessionId,
                    currentTextLength,
                    sessionTextLength,
                  },
                );
                return;
              }
            }
          }
        }

        // Don't overwrite ChatService messages with stale data during active streaming.
        // When switching workspaces, resumeSession() loads stale disk data into sessionStore,
        // then reconnectToBackendStreams() dispatches agent:session-updated which triggers this handler.
        // The sessionStore data is stale because flushChunkUpdate() (the streaming content accumulator)
        // never writes to sessionStore — the ChatService instance has the correct, up-to-date messages.
        //
        // IMPORTANT: Only apply this guard when the session ALSO says streaming is active (newIsStreaming).
        // If the session says streaming ended (newIsStreaming=false), we must let the update through
        // so ChatService can clear its streaming state — even if it means fewer messages/blocks.
        // This handles the case where the backend reports an agent is no longer streaming.
        if (currentState.isStreaming && newIsStreaming && currentState.messages.length > 0) {
          const currentMessageCount = currentState.messages.length;
          const sessionMessageCount = session.messages.length;

          // Don't overwrite with fewer messages during streaming
          if (sessionMessageCount < currentMessageCount) {
            logger.debug(
              '[ChatService] sessionUpdatedHandler: skipping - would overwrite streaming data with fewer messages',
              {
                sessionId,
                currentMessageCount,
                sessionMessageCount,
              },
            );
            return;
          }

          // Don't overwrite with fewer content blocks or less text content on the last message during streaming
          if (sessionMessageCount === currentMessageCount && sessionMessageCount > 0) {
            const currentLast = currentState.messages[currentMessageCount - 1];
            const sessionLast = session.messages[sessionMessageCount - 1];
            if (currentLast?.id === sessionLast?.id) {
              const currentBlockCount = currentLast?.contentBlocks?.length || 0;
              const sessionBlockCount = sessionLast?.contentBlocks?.length || 0;
              if (sessionBlockCount < currentBlockCount && currentBlockCount > 0) {
                logger.debug(
                  '[ChatService] sessionUpdatedHandler: skipping - would overwrite streaming data with fewer content blocks',
                  {
                    sessionId,
                    messageId: currentLast?.id,
                    currentBlockCount,
                    sessionBlockCount,
                  },
                );
                return;
              }

              // Also check text content length to prevent stale data with same block structure
              // but less text from overwriting during workspace switches
              if (sessionBlockCount === currentBlockCount && currentBlockCount > 0) {
                const getTextLength = (blocks: ContentBlock[]) =>
                  blocks.reduce((sum: number, b: ContentBlock) => {
                    if (b.type === 'text' && 'text' in b) {
                      return sum + ((b as any).text?.length || 0);
                    }
                    return sum;
                  }, 0);
                const currentTextLength = getTextLength(currentLast?.contentBlocks || []);
                const sessionTextLength = getTextLength(sessionLast?.contentBlocks || []);
                if (sessionTextLength < currentTextLength) {
                  logger.debug(
                    '[ChatService] sessionUpdatedHandler: skipping - would overwrite streaming data with less text content',
                    {
                      sessionId,
                      messageId: currentLast?.id,
                      currentTextLength,
                      sessionTextLength,
                    },
                  );
                  return;
                }
              }
            }
          }
        }

        // Only log actual state transitions at debug level
        if (newIsStreaming !== currentState.isStreaming) {
          logger.debug('Session streaming state synced from sessionStore', {
            sessionId,
            newIsStreaming,
          });
        }

        // If streaming and the session has messages with content,
        // sync the localStreamingContent from the last assistant message.
        // This handles the case where page refresh happens during streaming:
        // AgentService fetches accumulated content from backend and updates sessionStore,
        // but ChatService's localStreamingContent was empty (initialized before backend data arrived).
        // Without this, the streaming content wouldn't display until new chunks arrive.
        let newStreamingContent = currentState.streamingContent;
        if (newIsStreaming && session.messages.length > 0) {
          const lastMessage = session.messages[session.messages.length - 1];
          if (lastMessage?.role === 'assistant' && lastMessage?.contentBlocks) {
            // Find the LAST text block - this is what streaming updates
            const textBlocks = lastMessage.contentBlocks.filter(
              (b: ContentBlock) => b.type === 'text',
            );
            const lastTextBlock = textBlocks[textBlocks.length - 1];
            if (lastTextBlock && 'text' in lastTextBlock) {
              const messageContent = lastTextBlock.text || '';
              const currentLocalContent = this.localStreamingContent;

              // Only update if the message has more content than our local accumulator
              // This prevents overwriting content that arrived via chunk events
              if (messageContent.length > currentLocalContent.length) {
                logger.info(
                  '[ChatService] sessionUpdatedHandler: syncing localStreamingContent from message',
                  {
                    sessionId,
                    previousLength: currentLocalContent.length,
                    newLength: messageContent.length,
                  },
                );
                this.localStreamingContent = messageContent;
                newStreamingContent = messageContent;
              }
            }
          }
        }

        this.safeStateUpdate((s) => {
          // Deduplicate messages to prevent Svelte "duplicate key" error
          // This handles cases where session.messages might already contain duplicates
          const seen = new Set<string>();
          const deduplicatedMessages = session.messages.filter((m) => {
            if (seen.has(m.id)) {
              logger.debug('Removing duplicate message during session sync', { messageId: m.id });
              return false;
            }
            seen.add(m.id);
            return true;
          });

          return {
            ...s,
            messages: deduplicatedMessages,
            // Sync streaming state from session - critical for queued messages
            // Use || s.isStreaming to preserve true state during race condition
            isStreaming: newIsStreaming || s.isStreaming,
            isProcessing: newIsStreaming || s.isProcessing,
            // Also sync streamingContent if we updated it
            streamingContent: newStreamingContent,
          };
        });

        // CRITICAL: Re-setup stream listener if session is streaming but we don't have a handler
        // This happens when stopChat() was called (which removes the handler) and then
        // a queued message starts streaming from the backend
        if (newIsStreaming && !this.streamHandlers.has(sessionId)) {
          logger.info('[ChatService] Re-setting up stream listener for queued message', {
            sessionId,
          });
          this.setupStreaming(sessionId);
        }
      }
    };
    const sessionUpdatedCleanup = memoryManager.registerListener(
      window,
      `agent:session-updated:${sessionId}`,
      sessionUpdatedHandler,
      this,
    );
    this.sessionUpdatedCleanups.set(sessionId, sessionUpdatedCleanup);

    // Set up connection status listener if not already set
    if (!this.connectionHandler) {
      this.connectionHandler = () => {
        const isOnline = navigator.onLine;
        this.handleConnectionChange(isOnline);
      };
      memoryManager.registerListener(window, 'online', this.connectionHandler, this);
      memoryManager.registerListener(window, 'offline', this.connectionHandler, this);
    }
  }

  /**
   * Handle connection status changes
   */
  private handleConnectionChange(isOnline: boolean): void {
    if (!isOnline) {
      logger.warn('Connection lost - streaming may be interrupted');
      // Don't immediately stop streaming - give it a chance to reconnect
    } else {
      logger.info('Connection restored');
      // If we were streaming and got disconnected, the stream will auto-recover
    }
  }

  /**
   * Handle stream events
   */
  private handleStreamEvent(sessionId: string, event: CustomEvent | Event): void {
    const data = (event as CustomEvent).detail || event;

    // Only log at debug level to avoid excessive logging during streaming
    logger.debug('[ChatService] handleStreamEvent', {
      sessionId,
      eventType: data?.type,
      contentLength: data?.content?.length,
    });

    // Verify we have an active handler for this session.
    // We check if a stream handler exists for this session - if it does, we should process it.
    if (!this.streamHandlers.has(sessionId)) {
      logger.debug('[ChatService] Ignoring stream event - no handler registered', {
        sessionId,
        registeredSessions: Array.from(this.streamHandlers.keys()),
      });
      return;
    }

    // Per-agent instance: this instance always handles its own session

    // Clear any existing timeout before processing new event
    // This prevents accumulating multiple timeouts when many chunks arrive
    const existingTimeout = this.streamTimeouts.get(sessionId);
    if (existingTimeout) {
      existingTimeout.cleanup();
      this.streamTimeouts.delete(sessionId);
    }

    if (data.type === 'start') {
      // Only reset accumulator if we don't already have restored content
      // When the frontend reconnects after HMR refresh, the backend sends a new 'start' event.
      // If we unconditionally reset, we lose all the content that was accumulated before the refresh.
      const existingContent = this.localStreamingContent;
      const hasRestoredContent = existingContent.length > 0;
      if (!hasRestoredContent) {
        this.localStreamingContent = '';
      } else {
        logger.info('Preserving restored streaming content on start event', {
          sessionId,
          preservedContentLength: existingContent.length,
        });
      }

      // Start stall detection for unresponsive streams
      this.startStallDetection();
      // Start state reconciliation to detect and recover from stuck states
      this.startStateReconciliation(sessionId);

      // Update sessionStore streaming state
      // Use setStreaming() to explicitly set streaming.active = true.
      // addSession() calls setAgent() which PRESERVES existing streaming.active, so calling
      // addSession({...session, isStreaming: true}) does NOT actually turn on streaming.active.
      // After HMR/page refresh, streaming.active is initialized to false from disk data,
      // and without this explicit setStreaming call, it stays false even though the backend
      // is actively streaming. This allows users to bypass the isStreaming guard in sendMessage().
      // CROSS-WORKSPACE FIX: Use workspace-aware streaming state update so the
      // correct session is updated even when the user has switched workspaces.
      const startWorkspaceId = get(this.state).session?.workspaceId;
      if (startWorkspaceId) {
        sessionStore.setStreamingForWorkspace(startWorkspaceId as string, sessionId, true);
        const session = sessionStore.getSessionForWorkspace(startWorkspaceId as string, sessionId);
        if (session) {
          sessionStore.addSessionForWorkspace(startWorkspaceId as string, {
            ...session,
            isStreaming: true,
          });
        }
      } else {
        sessionStore.setStreaming(sessionId, true);
        const session = sessionStore.getSession(sessionId);
        if (session) {
          sessionStore.addSession({
            ...session,
            isStreaming: true,
          });
        }
      }

      // Update instance state
      this.state.update((s) => ({
        ...s,
        isStreaming: true,
        streamingContent: hasRestoredContent ? existingContent : '',
        error: null,
        lastChunkTime: Date.now(),
        isStalled: false,
      }));
    } else if (data.type === 'chunk') {
      // Record chunk received for stall detection
      this.recordChunkReceived();

      // Accumulate text in per-instance accumulator
      const currentContent = this.localStreamingContent;
      const newStreamingContent = currentContent + (data.content || '');
      this.localStreamingContent = newStreamingContent;

      // NOTE: Do NOT read from or write to sessionStore here. AgentService is the sole
      // writer to sessionStore during streaming (via updateMessageForWorkspace). Having
      // ChatService also call addSession() creates a race condition where stale snapshots
      // overwrite AgentService's correctly accumulated contentBlocks. ChatService only
      // updates its own instance state (for UI rendering).

      this.scheduleChunkUpdate(newStreamingContent);
    } else if (data.type === 'content-blocks') {
      // Handle content blocks (tool calls, etc.)
      // Add the content blocks to the current streaming message

      // Record chunk received for stall detection
      this.recordChunkReceived();

      // Cancel pending chunk update.
      // IMPORTANT: Do NOT call flushChunkUpdate() here. flushChunkUpdate() reads from
      // ChatService's own state (s.messages) which may not yet include tool blocks from
      // previous content-blocks events. Flushing stale state triggers ChatPanel's Path A
      // subscription with fewer contentBlocks, causing tool calls to briefly disappear.
      // Instead, just cancel the pending RAF and clear the pending content. The content-blocks
      // handler below will update state with the correct messages from sessionStore.
      if (this.chunkUpdateRafId !== null) {
        cancelAnimationFrame(this.chunkUpdateRafId);
        this.chunkUpdateRafId = null;
        // Carry forward the pending streaming text so it's not lost.
        // The content-blocks handler reads localStreamingContent and
        // sessionStore messages, so we just need to make sure the accumulated text is
        // preserved in localStreamingContent (it already is — chunk handler appends to it).
        this.pendingStreamingContent = null;
      }

      // FIX: Always use instance state as the base for content-blocks processing.
      // sessionStore.getSession() uses currentWorkspace, which may point to a different
      // workspace if the user switched while this agent streams in the background.
      // The instance state is the authoritative source for THIS agent's messages.
      //
      // We only consult sessionStore to pick up any messages that may have been added
      // externally (e.g., queued message delivery), but we NEVER reduce message count.
      //
      // FIX: Prefer currentInstanceMessages unless sessionStore has strictly MORE messages.
      // Previously, sessionStore was always preferred when available, but if its snapshot is
      // stale or missing the streaming assistant message, the later merge guard
      // (updatedMessages.length < s.messages.length) would drop newly-applied tool blocks
      // because message IDs between the stale snapshot and the live instance don't overlap.
      // By basing on instance state by default, tool_use/tool_result blocks always attach
      // to the streaming assistant being rendered.
      const currentState = get(this.state);
      const currentInstanceMessages = currentState.messages;
      // FIX: Use workspace-aware session lookup instead of the deprecated
      // sessionStore.getSession() which depends on currentWorkspace. For
      // background/cross-workspace streaming, currentWorkspace may point to a
      // different workspace, causing the lookup to miss the session entirely
      // and the later write-back to be skipped or mis-targeted.
      const instanceWorkspaceId = currentState.session?.workspaceId;
      const session = instanceWorkspaceId
        ? sessionStore.getSessionForWorkspace(instanceWorkspaceId as string, sessionId)
        : sessionStore.getSession(sessionId);
      let existingMessages = currentInstanceMessages;
      if (session?.messages && session.messages.length > currentInstanceMessages.length) {
        // sessionStore has strictly more messages (e.g., queued message delivery added
        // messages externally) — use it to avoid losing those.
        existingMessages = session.messages;
      }
      if (!session) {
        // Downgrade from WARN to DEBUG. This is expected behavior for
        // cross-workspace agents — the session doesn't exist in the store for the
        // other workspace. The fallback to instance messages handles it correctly.
        logger.debug('[ChatService] content-blocks: sessionStore.getSession returned undefined — using instance messages as fallback', {
          sessionId,
          instanceMessageCount: currentInstanceMessages.length,
        });
      }
      const lastMessage = existingMessages[existingMessages.length - 1];
      const hasStreamingAssistantMessage =
        lastMessage?.role === 'assistant' && lastMessage?.isStreaming === true;

      // Get per-instance streaming content
      const sessionContent = this.localStreamingContent;

      if (!Array.isArray(data.data)) {
        logger.warn('[ChatService] content-blocks event missing data array', { sessionId });
        return;
      }

      const newBlocks = data.data;

      let updatedMessages = existingMessages;

      if (!hasStreamingAssistantMessage) {
        // No streaming message yet - create one with the content blocks
        // IMPORTANT: Filter out text blocks from newBlocks - they should NOT arrive via content-blocks events
        // Text is accumulated via 'chunk' events and stored in streamingContent
        const filteredBlocks = newBlocks.filter((b: any) => {
          if (b.type === 'text') {
            logger.warn(
              '[ChatService] Received unexpected text block in content-blocks event (initial) - ignoring to prevent duplication',
              {
                textLength: (b.text || '').length,
              },
            );
            return false;
          }
          return true;
        });

        // MULTI-AGENT FIX: Use per-session streaming content
        const initialBlocks = sessionContent
          ? [{ type: 'text' as const, text: sessionContent }, ...filteredBlocks]
          : filteredBlocks;

        // IMPORTANT: Message IDs must start with 'msg_' for Zod validation
        const streamingMessage: AgentMessage = {
          id: createMessageId(`msg_${uuidv4()}`),
          role: 'assistant' as const,
          contentBlocks: initialBlocks,
          timestamp: new Date().toISOString(),
          isStreaming: true,
        };
        updatedMessages = [...existingMessages, streamingMessage];
        logger.debug('[ChatService] Created streaming message with content blocks', {
          sessionId,
          blockCount: initialBlocks.length,
        });
      } else {
        // Merge new content blocks with existing ones
        const existingBlocks = lastMessage.contentBlocks || [];

        // Combine existing blocks with new blocks, avoiding duplicates
        const updatedBlocks = [...existingBlocks];
        for (const block of newBlocks) {
          // IMPORTANT: Skip text blocks - they should NOT arrive via content-blocks events
          // Text is accumulated via 'chunk' events and stored in streamingContent
          // If we receive text blocks here, it would cause duplication
          if (block.type === 'text') {
            logger.warn(
              '[ChatService] Received unexpected text block in content-blocks event - ignoring to prevent duplication',
              {
                textLength: ((block as any).text || '').length,
                existingBlockCount: existingBlocks.length,
              },
            );
            continue;
          }

          // Don't duplicate blocks that already exist
          const blockExists = updatedBlocks.some(
            (b) =>
              b.type === block.type &&
              (b.type === 'tool_use'
                ? (b as any).id === (block as any).id
                : b.type === 'tool_result'
                  ? (b as any).tool_use_id === (block as any).tool_use_id
                  : false),
          );
          if (!blockExists) {
            updatedBlocks.push(block);
          }
        }

        const updatedLastMessage = {
          ...lastMessage,
          contentBlocks: updatedBlocks,
        };
        updatedMessages = [...existingMessages.slice(0, -1), updatedLastMessage];

        logger.debug('[ChatService] Added content blocks to streaming message', {
          sessionId,
          newBlockCount: newBlocks.length,
          totalBlockCount: updatedBlocks.length,
        });
      }

      // Check if any of the new blocks are tool_use blocks
      // If so, reset streamingContent so subsequent text is treated as new text after tools
      const hasNewToolUse = newBlocks.some((b: any) => b.type === 'tool_use');

      // MULTI-AGENT FIX: Reset per-session accumulator when tool_use blocks arrive
      if (hasNewToolUse) {
        logger.debug('[ChatService] tool_use arrived, resetting streaming accumulators', {
          sessionId,
          previousContentLength: this.localStreamingContent.length,
          updatedBlockCount:
            updatedMessages[updatedMessages.length - 1]?.contentBlocks?.length || 0,
          updatedBlockTypes:
            updatedMessages[updatedMessages.length - 1]?.contentBlocks?.map(
              (b: ContentBlock) => b.type,
            ) || [],
        });
        // Reset per-instance accumulator so subsequent text goes into a NEW text block after the tool
        this.localStreamingContent = '';
        this.pendingStreamingContent = null;
      }

      // NOTE: Do NOT update sessionStore here. AgentService is the sole writer to
      // sessionStore during streaming (via updateMessageForWorkspace). See chunk handler
      // comment above for full explanation of the race condition this prevents.

      // Update instance state
      this.safeStateUpdate((s) => {
        if (!s.isStreaming || !s.isProcessing) {
          logger.warn('[ChatService] content-blocks: streaming flags were incorrect during active content-blocks processing — forcing back to true (stale sessionUpdatedHandler likely set them)', {
            sessionId,
            wasStreaming: s.isStreaming,
            wasProcessing: s.isProcessing,
            messageCount: updatedMessages.length,
          });
        }

        return {
          ...s,
          messages: updatedMessages,
          // SELF-HEALING: Always set isStreaming and isProcessing to true during
          // content-blocks processing. Content-blocks events only arrive during active
          // streaming, so true is always correct here. If a stale sessionUpdatedHandler
          // set either flag to false, this corrects it.
          isStreaming: true,
          isProcessing: true,
          streamingContent: hasNewToolUse ? '' : s.streamingContent,
        };
      });
    } else if (data.type === 'end' || data.type === 'complete') {
      // Handle both 'end' and 'complete' events (different sources may use different names)
      logger.info('[ChatService] Handling complete/end event', {
        sessionId,
        eventType: data.type,
        hasMessage: !!data.message,
        messageContentBlocksCount: data.message?.contentBlocks?.length || 0,
        messageMetadataKeys: data.message?.metadata ? Object.keys(data.message.metadata) : [],
        stopReason: data.message?.metadata?.stopReason,
      });

      // Handle model unavailable state
      const messageMetadata = data.message?.metadata;
      if (messageMetadata?.modelUnavailable === true && messageMetadata?.nextAvailableModel) {
        logger.info('[ChatService] Model unavailable - user can retry with different model', {
          sessionId,
          failedModel: messageMetadata.failedModel,
          nextAvailableModel: messageMetadata.nextAvailableModel,
        });
        this.state.update((s) => ({
          ...s,
          modelUnavailable: {
            failedModel: messageMetadata.failedModel,
            nextAvailableModel: messageMetadata.nextAvailableModel,
          },
        }));
      } else {
        this.state.update((s) => ({
          ...s,
          modelUnavailable: null,
        }));
      }

      // Stop stall detection and state reconciliation
      this.stopStallDetection();
      this.stopStateReconciliation();

      // Flush any pending chunk updates before finalizing
      if (this.chunkUpdateRafId !== null) {
        cancelAnimationFrame(this.chunkUpdateRafId);
        this.chunkUpdateRafId = null;
      }
      this.flushChunkUpdate();

      // MULTI-AGENT FIX: Get messages from sessionStore (source of truth)
      // CROSS-WORKSPACE FIX: Try current workspace first, then search all workspaces.
      // sessionStore.getSession() only searches the current workspace, so if the user
      // switched to a different agent/workspace while streaming was completing, the
      // session won't be found and finalization would be skipped entirely.
      let session = sessionStore.getSession(sessionId);
      if (!session) {
        // Search all workspaces for this session
        const allWorkspaces = unifiedStateStore.getAllWorkspaces();
        for (const ws of allWorkspaces) {
          const wsId = ws.workspace?.id;
          if (wsId) {
            session = sessionStore.getSessionForWorkspace(wsId, sessionId) ?? undefined;
            if (session) {
              logger.warn('[ChatService] Session found via cross-workspace lookup (user switched workspaces during streaming)', {
                sessionId,
                foundInWorkspaceId: wsId,
                currentWorkspaceId: unifiedStateStore.currentWorkspace?.workspace?.id,
              });
              break;
            }
          }
        }
      }
      // FIX: Fall back to ChatService instance state if no session found anywhere.
      // This prevents wiping user messages when the session can't be
      // found in any workspace (e.g., during force-submit timing edge cases).
      const currentInstanceMessages = get(this.state).messages;
      const existingMessages = session?.messages ?? currentInstanceMessages;
      if (!session) {
        logger.warn('[ChatService] end: Session not found in any workspace — using instance messages as fallback', {
          sessionId,
          instanceMessageCount: currentInstanceMessages.length,
        });
      }
      const lastMessage = existingMessages[existingMessages.length - 1];

      // Clear streaming state in sessionStore for this session
      if (session?.workspaceId) {
        logger.info('[ChatService] Clearing streaming state in sessionStore', {
          sessionId,
          workspaceId: session.workspaceId,
        });
        sessionStore.setStreamingForWorkspace(session.workspaceId, sessionId, false);
      } else {
        sessionStore.setStreaming(sessionId, false);
      }

      // Clean up per-instance accumulator
      this.localStreamingContent = '';
      this.pendingStreamingContent = null;

      // Clear idempotency keys so user can resend after stream completes (e.g., after error)
      this.clearSendKeys();

      // Finalize the streaming message by removing the isStreaming flag
      let updatedMessages = existingMessages;

      if (lastMessage?.role === 'assistant' && lastMessage?.isStreaming === true) {
        // Compare backend message with existing content - use whichever has more
        // The backend message may be incomplete if the user switched agents during streaming
        const existingBlocks = lastMessage.contentBlocks || [];
        const backendBlocks = data.message?.contentBlocks || [];
        let finalMessageId = lastMessage.id;

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
        const useBackendContent = backendLength >= existingLength && backendBlocks.length > 0;
        const finalContentBlocks = useBackendContent
          ? normalizeContentBlocks(backendBlocks)
          : existingBlocks;

        if (data.message?.id) {
          finalMessageId = data.message.id;
        }

        logger.info('[ChatService] Comparing content sources for finalization', {
          sessionId,
          existingBlockCount: existingBlocks.length,
          existingContentLength: existingLength,
          backendBlockCount: backendBlocks.length,
          backendContentLength: backendLength,
          useBackendContent,
        });

        // Check if the stream was cancelled/interrupted by the user
        const stopReason = data.message?.metadata?.stopReason;
        const wasInterrupted = stopReason === 'cancelled';

        const finalizedMessage = {
          ...lastMessage,
          id: finalMessageId,
          contentBlocks: finalContentBlocks,
          isStreaming: false,
          metadata: {
            ...lastMessage.metadata,
            ...data.message?.metadata,
            // Mark as interrupted if the user stopped the generation
            ...(wasInterrupted ? { interrupted: true } : {}),
          },
        };
        updatedMessages = [...existingMessages.slice(0, -1), finalizedMessage];

        logger.info('[ChatService] Finalized streaming message', {
          sessionId,
          messageId: finalizedMessage.id,
          blockCount: finalContentBlocks?.length || 0,
          usedEventMessage: !!(
            data.message?.contentBlocks && data.message.contentBlocks.length > 0
          ),
          lastMessageBlockCount: lastMessage.contentBlocks?.length || 0,
          stopReason,
          wasInterrupted,
        });
      } else if (data.message) {
        // No streaming message - use the message from the event
        const messageExists = existingMessages.some((m) => m.id === data.message.id);
        if (!messageExists) {
          logger.debug('[ChatService] Adding message from event', {
            sessionId,
            messageId: data.message.id,
          });
          updatedMessages = [...existingMessages, data.message];
        }
      }

      // ALWAYS sync finalized messages to sessionStore
      // CROSS-WORKSPACE FIX: Use workspace-aware write so the completion snapshot
      // lands in the correct workspace even if the user switched workspaces.
      if (session) {
        const endWorkspaceId = session.workspaceId as string | undefined;
        if (endWorkspaceId) {
          sessionStore.addSessionForWorkspace(endWorkspaceId, {
            ...session,
            messages: updatedMessages,
            isStreaming: false,
          });
        } else {
          sessionStore.addSession({
            ...session,
            messages: updatedMessages,
            isStreaming: false,
          });
        }

        // SAFETY NET: Force a direct notification after a short delay.
        // This catches cases where the RAF-based notification from addSession()
        // was lost due to batching, coalescing, or timing issues.
        // If the first notification already updated the UI, subscribers' change
        // detection will see "no change" and this becomes a no-op.
        const completedSessionId = sessionId;
        const completedWorkspaceId = session.workspaceId;
        setTimeout(() => {
          notifyAgentSubscribers(completedSessionId, completedWorkspaceId as WorkspaceId);
        }, 50);
      }

      // Update instance state
      this.safeStateUpdate((s) => {
        return {
          ...s,
          messages: updatedMessages,
          isStreaming: false,
          isProcessing: false,
          streamingContent: '',
          streamingStartTime: null,
          lastAttemptedMessage: null,
        };
      });

    } else if (data.type === 'error') {
      // Stop stall detection on error
      this.stopStallDetection();
      // Stop state reconciliation on error
      this.stopStateReconciliation();

      // Reset local accumulator on error to prevent stale data in next stream
      this.localStreamingContent = '';
      this.pendingStreamingContent = null;

      // Clear idempotency keys so user can resend after error
      this.clearSendKeys();

      // Clear streaming state in unifiedStateStore on error
      const errorState = get(this.state);
      if (errorState.session?.workspaceId) {
        sessionStore.setStreamingForWorkspace(
          errorState.session.workspaceId,
          errorState.session.id,
          false,
        );
      } else {
        sessionStore.setStreaming(sessionId, false);
      }

      // Save any partial content before clearing
      const partialContent = get(this.state).streamingContent;

      // If we have partial content, save it as a message with an error indicator
      if (partialContent && partialContent.trim()) {
        // IMPORTANT: Message IDs must start with 'msg_' for Zod validation
        const errorMessage: AgentMessage = {
          id: createMessageId(`msg_${uuidv4()}`),
          role: 'assistant',
          contentBlocks: [
            {
              type: 'text' as const,
              text: `${partialContent}\n\n*[Response interrupted]*`,
            },
          ],
          timestamp: new Date().toISOString(),
        };

        this.state.update((s) => {
          // Check for duplicate message ID before adding
          const isDuplicate = s.messages.some((m) => m.id === errorMessage.id);
          const newMessages = isDuplicate ? s.messages : [...s.messages, errorMessage];
          return {
            ...s,
            messages: newMessages,
            isStreaming: false,
            isProcessing: false,
            streamingContent: '',
            streamingStartTime: null,
            error: cleanErrorMessage(data.error || 'The response was interrupted. Please try again.'),
          };
        });
      } else {
        this.state.update((s) => ({
          ...s,
          isStreaming: false,
          isProcessing: false,
          streamingContent: '',
          streamingStartTime: null,
          error: cleanErrorMessage(data.error || 'The response was interrupted. Please try again.'),
        }));
      }
    }

    // Set timeout to clean up stale streams (existing timeout was already cleared at start of handleStreamEvent)
    const cleanup = memoryManager.registerTimer(
      () => {
        const currentState = get(this.state);
        if (currentState.isStreaming) {
          logger.warn('Stream timeout - cleaning up', { sessionId });
          // Reset per-instance accumulator for the timed-out session
          this.localStreamingContent = '';
          this.pendingStreamingContent = null;

          // Clear streaming state in sessionStore on timeout
          if (currentState.session?.workspaceId) {
            sessionStore.setStreamingForWorkspace(
              currentState.session.workspaceId,
              currentState.session.id,
              false,
            );
          } else {
            sessionStore.setStreaming(sessionId, false);
          }

          this.state.update((s) => ({
            ...s,
            isStreaming: false,
            isProcessing: false,
            streamingStartTime: null,
          }));
        }
      },
      this.STREAM_TIMEOUT_MS,
      'timeout',
      this,
    );

    this.streamTimeouts.set(sessionId, { cleanup });
  }

  /**
   * Clean up stream handlers.
   * @param preserveContent - If true, keeps localStreamingContent intact.
   *   Use this when re-registering handlers for an active stream (setupStreaming),
   *   NOT when terminating a stream (stopChat, clearChat, error, end).
   */
  private cleanupStream(sessionId: string, preserveContent = false): void {
    const handler = this.streamHandlers.get(sessionId);
    if (handler) {
      // Clean up DOM event listener (we only listen to DOM events now)
      window.removeEventListener(`agent:stream:${sessionId}`, handler);

      // FIX: Unregister DOM handler with agentService so it knows we no longer have a listener
      // This enables proper event queuing for future events that arrive after cleanup
      agentService.unregisterDomHandler(sessionId);

      // FIX: Only clear pending events when the stream is actually ending (preserveContent=false).
      // When preserveContent=true (called from setupStreaming for re-registration), we must NOT
      // clear the queue because replayPendingEvents() runs AFTER this cleanup and needs the
      // queued events. Previously, clearing here erased events before they could be replayed.
      if (!preserveContent) {
        agentService.clearPendingEvents(sessionId);
      }

      this.streamHandlers.delete(sessionId);
    }

    // Clean up session-updated handler to prevent listener leaks across session switches
    const sessionUpdatedCleanup = this.sessionUpdatedCleanups.get(sessionId);
    if (sessionUpdatedCleanup) {
      sessionUpdatedCleanup();
      this.sessionUpdatedCleanups.delete(sessionId);
    }

    const timeout = this.streamTimeouts.get(sessionId);
    if (timeout) {
      timeout.cleanup();
      this.streamTimeouts.delete(sessionId);
    }

    // Cancel any pending RAF to prevent stale updates
    if (this.chunkUpdateRafId !== null) {
      cancelAnimationFrame(this.chunkUpdateRafId);
      this.chunkUpdateRafId = null;
    }

    // Reset per-instance accumulator unless caller explicitly wants to preserve it.
    // setupStreaming() passes preserveContent=true because it's re-registering handlers
    // for an already-active stream, not discarding content.
    if (!preserveContent) {
      this.localStreamingContent = '';
      this.pendingStreamingContent = null;
    }
  }

  /**
   * Stop the current chat session
   */
  async stopChat(): Promise<void> {
    const currentState = get(this.state);

    if (currentState.session) {
      // Set isInterrupting flag to block new sends during cleanup
      this.state.update((s) => ({
        ...s,
        isInterrupting: true,
      }));

      // Stop any ongoing streaming
      try {
        // Stop the session using the available method
        await agentService.stopSession(currentState.session.id);
      } catch (err) {
        logger.warn('Could not stop session', err);
      }

      // FIX: Wait for the backend to fully clean up pending requests BEFORE removing handlers
      // Previously, we removed handlers first which caused a race condition where completion
      // events arriving during this window were dropped, leaving the agent stuck in "processing"
      // The ACP provider's interrupt() rejects pending requests asynchronously
      // 300ms gives enough time for the abort controller to propagate through IPC
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Clean up stream handlers AFTER the wait period
      // This ensures we can still receive any final completion events from the backend
      const streamSessionId = currentState.session.id;
      this.cleanupStream(streamSessionId);

      // Update state - clear isInterrupting after cleanup is complete
      this.state.update((s) => ({
        ...s,
        isProcessing: false,
        isStreaming: false,
        isInterrupting: false,
        streamingContent: '',
        streamingStartTime: null,
      }));
    }
  }

  /**
   * Clear the current chat session
   */
  clearChat(): void {
    const currentState = get(this.state);

    if (currentState.session) {
      // Clean up streaming
      const streamSessionId = currentState.session.id;
      this.cleanupStream(streamSessionId);
    }

    // Stop stall detection when clearing
    this.stopStallDetection();
    // FIX: Stop state reconciliation when clearing
    this.stopStateReconciliation();

    this.state.set({
      session: null,
      messages: [],
      isStreaming: false,
      isProcessing: false,
      isInterrupting: false,
      streamingContent: '',
      error: null,
      streamingStartTime: null,
      lastAttemptedMessage: null,
      lastChunkTime: null,
      isStalled: false,
      modelUnavailable: null,
    });
  }

  /**
   * Get the current state store
   */
  getStore(): Writable<ChatState> {
    return this.state;
  }

  /**
   * Get current state snapshot
   */
  getState(): ChatState {
    return get(this.state);
  }

  /**
   * Update messages directly.
   */
  updateMessages(messages: AgentMessage[]): void {
    this.state.update((s) => ({
      ...s,
      messages,
    }));
  }

  /**
   * Fork the current session to create a new agent with the same conversation history.
   *
   * This creates a deep copy of all messages up to the current point (or a specified message),
   * creates a new agent session with those messages, and optionally switches to the new session.
   *
   * @param workspace - The workspace containing the session
   * @param options - Fork configuration options
   * @returns The ID of the newly created forked session
   */
  async forkSession(
    workspace: Workspace,
    options?: {
      /** Fork from a specific message ID (includes history up to that point) */
      forkFromMessageId?: string;
      /** Whether to automatically switch to the forked session */
      switchToForked?: boolean;
      /** Custom name for the forked session */
      name?: string;
      /** Model to use for the forked session */
      model?: string;
      /** Selected text context for the fork */
      selectedText?: string;
    },
  ): Promise<string> {
    const currentState = get(this.state);
    if (!currentState.session) {
      throw new Error('No active chat session to fork');
    }

    const sourceSession = currentState.session;
    const sourceMessages = currentState.messages;

    // If streaming, stop it first
    if (currentState.isStreaming || currentState.isProcessing) {
      logger.info('Stopping current stream before forking session');
      await this.stopChat();
    }

    // Determine which messages to include in the fork
    let messagesToFork: AgentMessage[];
    let forkPoint: number;

    if (options?.forkFromMessageId) {
      const messageIndex = sourceMessages.findIndex((m) => m.id === options.forkFromMessageId);
      if (messageIndex === -1) {
        throw new Error('Fork point message not found');
      }
      // Include messages up to and including the specified message
      messagesToFork = sourceMessages.slice(0, messageIndex + 1);
      forkPoint = messageIndex + 1;
    } else {
      // Fork all messages
      messagesToFork = [...sourceMessages];
      forkPoint = sourceMessages.length;
    }

    // Deep clone messages to avoid reference issues
    // Use try-catch to handle "Maximum call stack size exceeded" errors
    // that can occur with deeply nested tool_use/tool_result content blocks
    let clonedMessages: AgentMessage[];
    try {
      clonedMessages = JSON.parse(JSON.stringify(messagesToFork));
    } catch (cloneError) {
      logger.warn('Failed to clone messages for fork, attempting truncation:', {
        messageCount: messagesToFork.length,
        error: cloneError instanceof Error ? cloneError.message : String(cloneError),
      });

      // Try with fewer messages (last 50)
      const truncatedMessages = messagesToFork.slice(-50);
      try {
        clonedMessages = JSON.parse(JSON.stringify(truncatedMessages));
        logger.info('Successfully forked with truncated messages', {
          originalCount: messagesToFork.length,
          truncatedCount: clonedMessages.length,
        });
      } catch (retryError) {
        // If even truncated version fails, start with empty messages
        logger.error('Cannot clone messages even with truncation, starting fresh fork');
        clonedMessages = [];
      }
    }

    // Generate fork name
    const baseName = sourceSession.name || 'Chat';
    const forkName =
      options?.name ||
      `${baseName} (Fork ${new Date().toLocaleString('en-US', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })})`;

    logger.info('Forking session', {
      sourceSessionId: sourceSession.id,
      messageCount: clonedMessages.length,
      forkPoint,
      forkName,
    });

    // Create the forked session using the agent factory
    const { agentFactory } = await import('./agent-factory');
    const { sessionStore, persistenceService } = await import('$features/agent/browser');

    // Create agent without initial message - we'll add the cloned messages after
    const createResult = await agentFactory.createAgent(workspace, {
      workspaceId: workspace.id,
      name: forkName,
      model: options?.model || sourceSession.model,
      // No initialMessage - we're copying history instead
      source: 'chat-panel',
      metadata: {
        // Fork metadata
        parentSessionId: sourceSession.id,
        forkedAt: new Date().toISOString(),
        forkPoint,
        forkMetadata: {
          selectedText: options?.selectedText,
          selectedModel: options?.model,
        },
      },
    });

    if (!createResult.success || !createResult.agent) {
      throw new Error(createResult.error || 'Failed to create forked session');
    }

    const forkedSession = createResult.agent;

    // Update the forked session with cloned messages
    const existingSession = sessionStore.getSession(forkedSession.id);
    if (existingSession) {
      sessionStore.addSession({
        ...existingSession,
        messages: clonedMessages,
        parentSessionId: sourceSession.id,
        forkedAt: new Date().toISOString(),
        forkPoint,
        forkMetadata: {
          selectedText: options?.selectedText,
          selectedModel: options?.model,
        },
      });
    }

    // Update parent session's childSessionIds
    const parentSession = sessionStore.getSession(sourceSession.id);
    if (parentSession) {
      const childSessionIds = parentSession.childSessionIds || [];
      sessionStore.addSession({
        ...parentSession,
        childSessionIds: [...childSessionIds, forkedSession.id],
      });
    }

    // Save both sessions to disk
    try {
      const forkedSessionWithHistory: AgentSession = {
        ...forkedSession,
        messages: clonedMessages,
        parentSessionId: sourceSession.id,
        forkedAt: new Date().toISOString(),
        forkPoint,
      };
      // Use immediate saves for fork metadata to prevent debounced saves from
      // overwriting fork metadata with stale session data that lacks these fields
      await persistenceService.saveSession(forkedSessionWithHistory, forkedSession.workspaceId, {
        immediate: true,
      });

      if (parentSession) {
        const updatedParentSession: AgentSession = {
          ...parentSession,
          childSessionIds: [...(parentSession.childSessionIds || []), forkedSession.id],
        };
        await persistenceService.saveSession(updatedParentSession, sourceSession.workspaceId, {
          immediate: true,
        });
      }
    } catch (err) {
      logger.warn('Failed to persist forked session', { error: err });
    }

    logger.info('Session forked successfully', {
      parentSessionId: sourceSession.id,
      forkedSessionId: forkedSession.id,
      messageCount: clonedMessages.length,
    });

    // Navigate to the forked session if requested (default: true)
    // IMPORTANT: We dispatch workspace:open-agent instead of calling this.initializeChat
    // to avoid corrupting this (parent) ChatService's state. The forked session will get
    // its own ChatService instance when its view/panel is created.
    // Using the workspace:open-agent event ensures the fork opens correctly in both
    // panel layout (as a new tab) and drawer layout modes.
    if (options?.switchToForked !== false) {
      window.dispatchEvent(
        new CustomEvent('workspace:open-agent', {
          detail: { agentId: forkedSession.id },
          bubbles: true,
        }),
      );
    }

    return forkedSession.id;
  }

  /**
   * Clean up all resources (for app shutdown)
   */
  destroy(): void {
    logger.info('Destroying ChatService');

    // Clean up all stream handlers
    this.streamHandlers.forEach((handler, sessionId) => {
      window.removeEventListener(`agent:stream:${sessionId}`, handler);
    });
    this.streamHandlers.clear();

    // Clean up all session-updated handlers
    this.sessionUpdatedCleanups.forEach((cleanup) => {
      cleanup();
    });
    this.sessionUpdatedCleanups.clear();

    // Clear all timeouts
    this.streamTimeouts.forEach((timeout) => {
      timeout.cleanup();
    });
    this.streamTimeouts.clear();

    // Remove connection listeners
    if (this.connectionHandler) {
      window.removeEventListener('online', this.connectionHandler);
      window.removeEventListener('offline', this.connectionHandler);
      this.connectionHandler = null;
    }

    // Stop stall detection
    this.stopStallDetection();
    // FIX: Stop state reconciliation on dispose
    this.stopStateReconciliation();

    // Reset state
    this.state.set({
      session: null,
      messages: [],
      isStreaming: false,
      isProcessing: false,
      isInterrupting: false,
      streamingContent: '',
      error: null,
      streamingStartTime: null,
      lastAttemptedMessage: null,
      lastChunkTime: null,
      isStalled: false,
      modelUnavailable: null,
    });
  }

  /**
   * Clear all idempotency send keys and their expiry timers.
   * Called on stream completion/error so the user can resend.
   */
  private clearSendKeys(): void {
    for (const timer of this.sendKeyTimers.values()) {
      clearTimeout(timer);
    }
    this.recentSendKeys.clear();
    this.sendKeyTimers.clear();
  }

  /**
   * Dispose of all resources and cleanup
   */
  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    logger.info('Disposing ChatService');

    // Reuse destroy() for shared cleanup (stream handlers, timeouts, connection listeners, stall/reconciliation)
    this.destroy();

    // PERFORMANCE: Cancel any pending chunk update RAF
    if (this.chunkUpdateRafId !== null) {
      cancelAnimationFrame(this.chunkUpdateRafId);
      this.chunkUpdateRafId = null;
    }
    this.pendingStreamingContent = null;

    // Clean up idempotency keys
    this.clearSendKeys();

    // Clean up visibility change handler
    if (this.visibilityChangeHandler) {
      document.removeEventListener('visibilitychange', this.visibilityChangeHandler);
      this.visibilityChangeHandler = null;
    }

    // Clean up with memory manager
    memoryManager.cleanup(this);

    logger.info('ChatService disposed successfully');
  }
}


/**
 * ChatServiceManager
 *
 * Maintains a Map of per-agent ChatService instances. Each agent gets its own
 * ChatService instance that is permanently bound to that agent's ID.
 *
 * Usage:
 *   const service = getChatService(agentId);
 *   // service.agentId === agentId
 *   // Calling getChatService(agentId) again returns the same instance
 */
export class ChatServiceManager {
  private static managerInstance: ChatServiceManager;
  private services = new Map<string, ChatService>();

  static getInstance(): ChatServiceManager {
    if (!this.managerInstance) {
      this.managerInstance = new ChatServiceManager();
    }
    return this.managerInstance;
  }

  /**
   * Get or create a ChatService instance for the given agent.
   * Calling this with the same agentId always returns the same instance.
   */
  getChatService(agentId: string): ChatService {
    let service = this.services.get(agentId);
    if (!service) {
      service = new ChatService(agentId);
      this.services.set(agentId, service);
      logger.info('ChatServiceManager: created per-agent ChatService', { agentId });
    }
    return service;
  }

  /**
   * Dispose and remove the ChatService instance for the given agent.
   * Call this when an agent panel is closed or an agent is removed.
   */
  disposeService(agentId: string): void {
    const service = this.services.get(agentId);
    if (service) {
      service.dispose();
      this.services.delete(agentId);
      logger.info('ChatServiceManager: disposed per-agent ChatService', { agentId });
    }
  }

  /**
   * Get all active (non-disposed) service entries.
   * Returns an array of [agentId, ChatService] tuples.
   * Useful for WorkspaceProgressCard to check streaming state across all agents.
   */
  getActiveServices(): Array<[string, ChatService]> {
    return Array.from(this.services.entries());
  }

  /**
   * Check if a service exists for the given agent.
   */
  hasService(agentId: string): boolean {
    return this.services.has(agentId);
  }

  /**
   * Dispose all managed services and reset the manager.
   * Typically called on workspace close / app shutdown.
   */
  disposeAll(): void {
    for (const [agentId, service] of this.services) {
      service.dispose();
      logger.info('ChatServiceManager: disposed per-agent ChatService', { agentId });
    }
    this.services.clear();
  }
}

/**
 * Module-level factory function for getting a per-agent ChatService.
 * This is the primary API for consumers that need a ChatService bound to a specific agent.
 *
 * @param agentId - The agent ID to get or create a ChatService for
 * @returns A ChatService instance permanently bound to the given agent
 */
export function getChatService(agentId: string): ChatService {
  return ChatServiceManager.getInstance().getChatService(agentId);
}