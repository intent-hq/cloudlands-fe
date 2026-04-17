/**
 * Chat Service
 *
 * A clean, consolidated service that handles all chat-related logic in one place.
 * This replaces the complex scattered logic across multiple services.
 */

import { v4 as uuidv4 } from 'uuid';
import { createMessageId } from '$shared/types/branded-ids';
import type { Readable } from 'svelte/store';
import { createLogger } from '$lib/utils/client-logger';
import { logger as rendererLogger, LogCategory } from '$lib/logging/logger.svelte';
import type { Workspace, AgentMessage, AgentSession, ContentBlock, WorkspaceId } from '$shared/types';
import { normalizeContentBlocks } from '$shared/types';
import type { IDisposable } from '$shared/types/disposable';
import { memoryManager } from './memory-manager';
import type { ContextItem } from '$lib/components/chat/input/context-api';
import { agentService } from '../agent-ipc-bridge';
import { notifyAgentSubscribers } from '$features/agent/browser';
import {
  upsertAgentSession,
  setAgentStreaming,
  replaceAgentMessages,
} from '$lib/store/slices/workspace-agents/workspace-agents-slice';
import {
  selectAgentById,
} from '$lib/store/slices/workspace-agents/workspace-agents-selectors';
import {
  selectActiveWorkspaceId,
  selectWorkspaceById,
  selectWorkspaceItems,
} from '$lib/store/slices/workspace/workspace-selectors';
import { AGENT_STREAMING_CONFIG } from '$shared/constants/agent-streaming';
import { cleanErrorMessage } from '$shared/errors/messages';
import { assertStreamingInvariant } from '../utils/streaming-invariants';
import { shouldAppendStreamingEvent } from '$lib/components/chat/streaming-status-utils';
import { track } from '$lib/services/analytics';
import { getReduxStore } from '$lib/store/redux-dispatch-bridge';
import { selectChatAgentState } from '$lib/store/slices/chat-state/chat-state-selectors';

import type { ChatAgentState } from '$lib/store/slices/chat-state/chat-state-types';
import {
  chatInitialized,
  chatInitFailed,
  chatSendFailed,
  chatInterrupted,
  chatModelUnavailableSet,
  chatModelUnavailableCleared,
  chatErrorCleared,
  chatStopInitiated,
  chatStopCompleted,
  chatReset,
  streamStarted,
  streamChunkFlushed,
  streamChunkReceived,
  streamCompleted,
  streamErrored,
  streamStatusReceived,
  streamTimedOut,
  chatStallDetected,
  chatStuckStateCleared,
} from '$lib/store/slices/chat-state/chat-state-slice';
import { selectAgentSession, selectAgentMessages } from '$lib/store/slices/agent-session/agent-session-selectors';
import { upsertSession as upsertAgentSessionData, replaceMessages as replaceAgentSessionMessages, addMessage as addAgentSessionMessage } from '$lib/store/slices/agent-session/agent-session-slice';
import { resizeImageForAgent } from '$lib/utils/image-resize';

const logger = createLogger('ChatService');

/**
 * Error thrown by sendMessage's internal guards (rate limiter, idempotency check).
 * Distinguished from real errors so the saga can clear streaming state without
 * showing an error toast — these are expected double-click/rapid-fire protections.
 */
export class MessageGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MessageGuardError';
  }
}

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

/**
 * ChatState composes ChatAgentState (streaming/UI flags) with session and messages
 * from the agent-session slice. This preserves backward compatibility for consumers.
 */
export type ChatState = ChatAgentState & {
  session: AgentSession | null;
  messages: AgentMessage[];
  /** Streaming flag — sourced from agent-session slice (single source of truth) */
  isStreaming: boolean;
  /** Processing flag — sourced from agent-session slice (single source of truth) */
  isProcessing: boolean;
};

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
  private streamHandlers = new Map<string, (data: any) => void>();
  private sessionUpdatedCleanups = new Map<string, () => void>();
  private streamTimeouts = new Map<string, { cleanup: () => void }>();
  // Use shared constant for stream timeout - reduced from 20 minutes to 2 minutes
  // to prevent agents from appearing stuck when backend stops responding
  private readonly STREAM_TIMEOUT_MS = AGENT_STREAMING_CONFIG.BACKEND_STREAM_TIMEOUT_MS;
  private lastMessageTime = 0; // Track last message send time for rate limiting

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

  constructor() {
    // No-arg constructor. All identity (agentId, workspaceId) is passed
    // explicitly to each method. Visibility handler is registered in
    // initializeChat when agentId is known.
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Redux helpers
  // ─────────────────────────────────────────────────────────────────────────────


  /** Dispatch an action to the Redux store */
  private reduxDispatch(action: any): void {
    try {
      getReduxStore().dispatch(action);
    } catch {
      // Store may not be initialized during tests or early startup
      logger.warn('ChatService: Redux dispatch failed (store not ready)');
    }
  }

  /**
   * Read current agent chat state from Redux via selector.
   * Composes ChatAgentState (streaming/UI flags) with session and messages
   * from the agent-session slice.
   */
  private getChatState(agentId: string): ChatState {
    const state = getReduxStore().getState();
    const chatAgentState = selectChatAgentState.select(state, agentId);
    const session = selectAgentSession.select(state, agentId) ?? null;
    const messages = selectAgentMessages.select(state, agentId);
    return {
      ...chatAgentState,
      session,
      messages,
      // isStreaming/isProcessing come from agent-session (single source of truth)
      isStreaming: session?.isStreaming ?? false,
      isProcessing: session?.isProcessing ?? false,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Status Events Storage Helpers
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Load status events and streamingStartTime from localStorage.
   * Used during construction to restore state across HMR reloads and tab switches.
   */
  private loadStatusEventsFromStorage(agentId: string): { events: ChatState['statusEvents']; streamingStartTime: number | null } {
    const key = this.getStatusEventsStorageKey(agentId);
    if (!key) {
      return { events: [], streamingStartTime: null };
    }
    try {
      const stored = localStorage.getItem(key);
      if (stored) {
        const parsed = JSON.parse(stored);
        return {
          events: Array.isArray(parsed.events) ? parsed.events : [],
          streamingStartTime: typeof parsed.streamingStartTime === 'number' ? parsed.streamingStartTime : null,
        };
      }
    } catch (e: unknown) {
      logger.debug('[ChatService] Failed to load status events from localStorage', { error: e });
    }
    return { events: [], streamingStartTime: null };
  }

  /**
   * Generate localStorage key for status events.
   * Uses agentId to scope storage per agent.
   * Returns null if agentId is not available to avoid shared 'default' key collisions.
   */
  private getStatusEventsStorageKey(agentId: string): string | null {
    if (!agentId) {
      return null;
    }
    return `intent:statusEvents:${agentId}`;
  }

  /**
   * Save status events to localStorage so they survive tab switches and HMR reloads.
   * No-ops if agentId is not available (to avoid shared key collisions).
   */
  private saveStatusEventsToStorage(statusEvents: ChatState['statusEvents'], agentId: string): void {
    const key = this.getStatusEventsStorageKey(agentId);
    if (!key) {
      return; // Skip persistence when agentId is not available
    }
    try {
      const currentState = this.getChatState(agentId);
      localStorage.setItem(key, JSON.stringify({
        events: statusEvents,
        streamingStartTime: currentState.streamingStartTime,
      }));
    } catch (e) {
      // Ignore storage errors (e.g., quota exceeded)
      logger.debug('[ChatService] Failed to save status events to localStorage', { error: e });
    }
  }


  /**
   * Clear status events from localStorage.
   * Called when a stream ends (end/error) or chat is cleared.
   * No-ops if agentId is not available (to avoid shared key collisions).
   */
  private clearStatusEventsStorage(agentId: string): void {
    const key = this.getStatusEventsStorageKey(agentId);
    if (!key) {
      return; // Skip clearing when agentId is not available
    }
    try {
      localStorage.removeItem(key);
    } catch (e) {
      // Ignore storage errors
      logger.debug('[ChatService] Failed to clear status events from localStorage', { error: e });
    }
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
  /**
   * Apply monotonicity guards to messages during streaming.
   * Prevents message count or contentBlocks regressions during active streaming.
   * Returns guarded messages that are safe to dispatch to Redux.
   */
  private guardStreamingMessages(
    currentState: ChatState,
    incomingMessages: AgentMessage[],
    nextIsStreaming: boolean,
  ): AgentMessage[] {
    // Only enforce monotonicity while actively streaming.
    // Skip guards when stream is finalizing (isStreaming true→false).
    if (!currentState.isStreaming || !nextIsStreaming) return incomingMessages;

    let guarded = incomingMessages;

    // Guard 1: never reduce message count during streaming
    if (guarded.length < currentState.messages.length) {
      logger.warn('[ChatService] guardStreamingMessages: prevented message count regression during streaming', {
        currentCount: currentState.messages.length,
        incomingCount: guarded.length,
        currentLastId: currentState.messages[currentState.messages.length - 1]?.id,
        incomingLastId: guarded[guarded.length - 1]?.id,
      });
      guarded = currentState.messages;
    }

    // Guard 2: never reduce contentBlocks count on the last message during streaming
    if (guarded.length > 0 && currentState.messages.length > 0) {
      const lastCurrent = currentState.messages[currentState.messages.length - 1];
      const lastNext = guarded[guarded.length - 1];
      if (
        lastCurrent?.id === lastNext?.id &&
        (lastNext?.contentBlocks?.length || 0) < (lastCurrent?.contentBlocks?.length || 0) &&
        (lastCurrent?.contentBlocks?.length || 0) > 0
      ) {
        logger.warn('[ChatService] guardStreamingMessages: prevented contentBlocks regression during streaming', {
          messageId: lastCurrent?.id,
          currentBlockCount: lastCurrent?.contentBlocks?.length || 0,
          incomingBlockCount: lastNext?.contentBlocks?.length || 0,
          currentBlockTypes: lastCurrent?.contentBlocks?.map((b) => b.type) || [],
          incomingBlockTypes: lastNext?.contentBlocks?.map((b) => b.type) || [],
        });
        const fixedLastMessage = { ...lastNext, contentBlocks: lastCurrent.contentBlocks };
        guarded = [...guarded.slice(0, -1), fixedLastMessage];
      }
    }

    return guarded;
  }


  /**
   * PERFORMANCE: Flush pending chunk updates using requestAnimationFrame
   * FIX: Read current messages from state to avoid overwriting content-block updates
   */
  private flushChunkUpdate(agentId: string): void {
    if (this.pendingStreamingContent !== null) {
      const newStreamingContent = this.pendingStreamingContent;
      this.pendingStreamingContent = null;

      // Only log at debug level to avoid excessive logging during streaming
      logger.debug('[ChatService] flushChunkUpdate called', {
        contentLength: newStreamingContent.length,
      });

      // Compute updated messages from CURRENT state, not cached messages
      // This prevents race conditions where content-blocks updates are overwritten
      const s = this.getChatState(agentId);
      const existingMessages = s.messages;
      const lastMessage = existingMessages[existingMessages.length - 1];
      const hasStreamingAssistantMessage =
        lastMessage?.role === 'assistant' && lastMessage?.isStreaming === true;

      let updatedMessages = existingMessages;

      if (!hasStreamingAssistantMessage) {
        // Create a new streaming assistant message
        // IMPORTANT: Message IDs must start with 'msg_' for Zod validation
        // Reuse the streaming message ID from Redux state if one exists,
        // to prevent divergence between this instance and Redux state that causes
        // the streaming response to appear in the wrong conversation turn.
        let streamingMessageId: ReturnType<typeof createMessageId> | undefined;
        const sessionId = s.session?.id;
        const sessionWorkspaceId = s.session?.workspaceId;
        if (sessionId && sessionWorkspaceId) {
          const storeSession = selectAgentById.select(getReduxStore().getState(), sessionId);
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

      // Apply monotonicity guards
      updatedMessages = this.guardStreamingMessages(s, updatedMessages, true);

      // Only log at debug level to avoid excessive logging during streaming
      logger.debug('[ChatService] flushChunkUpdate updating state', {
        messageCount: updatedMessages.length,
        streamingContentLength: newStreamingContent.length,
      });

      // Dispatch to Redux — streaming content to chat-state, messages to agent-session
      this.reduxDispatch(streamChunkFlushed(agentId, newStreamingContent));
      this.reduxDispatch(replaceAgentSessionMessages(agentId, updatedMessages));
    }
  }

  /**
   * PERFORMANCE: Schedule a throttled chunk update
   * FIX: Only store streamingContent, not full messages array
   */
  private scheduleChunkUpdate(content: string, agentId: string): void {
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
      this.flushChunkUpdate(agentId);
    } else if (this.chunkUpdateRafId === null) {
      // Schedule update for next frame
      this.chunkUpdateRafId = requestAnimationFrame(() => {
        this.chunkUpdateRafId = null;
        this.lastChunkUpdateTime = performance.now();
        this.flushChunkUpdate(agentId);
      });
    }
    // If RAF is already scheduled, the pending update will be used
  }

  /**
   * Start stall detection timer
   * Checks every 10 seconds if we've received chunks recently
   */
  private startStallDetection(agentId: string): void {
    this.stopStallDetection();

    this.stallCheckTimer = setInterval(() => {
      const currentState = this.getChatState(agentId);

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

        this.reduxDispatch(chatStallDetected(agentId));
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
  private startStateReconciliation(_initialSessionId: string, agentId: string): void {
    this.stopStateReconciliation();

    // Reset failure counter when starting fresh
    this.stateReconciliationFailureCount = 0;

    this.stateReconciliationTimer = setInterval(async () => {
      const currentState = this.getChatState(agentId);

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
      // AND the session is not streaming according to Redux state, auto-clear the stuck state.
      // This catches permanently stuck states that the normal reconciliation might miss.
      if (currentState.streamingStartTime) {
        const processingDuration = Date.now() - currentState.streamingStartTime;
        const hasRecentChunks = currentState.lastChunkTime
          && (Date.now() - currentState.lastChunkTime) < this.STUCK_PROCESSING_TIMEOUT_MS;
        const reconcileWorkspaceId = currentState.session?.workspaceId;
        const sessionData = reconcileWorkspaceId
          ? selectAgentById.select(getReduxStore().getState(), currentSessionId)
          : undefined;
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

          this.reduxDispatch(chatStuckStateCleared(agentId));
          this.stateReconciliationFailureCount = 0;
          this.stopStateReconciliation();
          return;
        }
      }

      // Query the backend to check if there's actually an active stream
      try {
        if (window.electronAPI) {
          const result = await window.electronAPI.invoke('agent:get-active-streams');
          if (!result?.success || !Array.isArray(result?.data)) {
            logger.debug('State reconciliation: skipping - IPC call did not return success', {
              sessionId: currentSessionId,
              success: result?.success,
            });
            return;
          }
          const activeStreams = result.data;

          // Check if our session is in the active streams list
          const hasActiveStream = activeStreams.some(
            (stream: { agentId: string }) => stream.agentId === currentSessionId,
          );

          // Re-check isProcessing since state may have changed during IPC call
          const stateAfterCheck = this.getChatState(agentId);
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

              this.reduxDispatch(chatStuckStateCleared(agentId));

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
   * Record that a chunk was received (resets stall detection).
   *
   * @param isTextChunk - true for actual text/content chunks, false for
   *   content-blocks (tool-use updates). When false, the method still updates
   *   stall-detection timestamps but does NOT flip `receivedFirstChunk` or
   *   append the synthetic "Streaming response…" status event. This prevents
   *   a tool-use content block from consuming the first-chunk marker and
   *   blocking the streaming phase event from ever being appended when real
   *   text arrives later.
   */
  private recordChunkReceived(agentId: string, isTextChunk: boolean = true): void {
    // Track chunk receipt time on the instance for reconciliation checks
    this.lastChunkReceivedAt = Date.now();
    const now = Date.now();

    // Dispatch to Redux for stall detection saga
    this.reduxDispatch(streamChunkReceived(agentId, isTextChunk));

    // Persist status events to localStorage if this is a text chunk and first chunk
    if (isTextChunk) {
      const currentState = this.getChatState(agentId);
      const shouldAppend = shouldAppendStreamingEvent(currentState.receivedFirstChunk, currentState.statusEvents);
      if (shouldAppend) {
        const newStatusEvents = [
          ...currentState.statusEvents,
          { phase: 'streaming', message: 'Streaming response…', level: 'info' as const, timestamp: now },
        ];
        this.saveStatusEventsToStorage(newStatusEvents, agentId);
      }
    }
  }

  /**
   * Public method to flush any pending streaming content to Redux.
   * Called by sagas (e.g., visibility restore) that need to force-flush
   * accumulated streaming content that hasn't been dispatched yet.
   */
  public flushPendingStreamingContent(agentId: string): void {
    this.flushChunkUpdate(agentId);
  }

  /**
   * Public method to set up streaming DOM handlers for a session.
   * Called by the initialize-chat saga after dispatching chatInitialized.
   */
  public setupStreamingForSession(agentId: string, sessionId: string): void {
    this.setupStreaming(sessionId, agentId);
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
    logger.debug('Background timers paused (ChatPanel unmounted)');
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
   * Set up DOM event listeners and stream handlers for a session.
   * Must be called after the session exists in Redux state.
   * @param workspaceId - The workspace ID to scope Redux state lookups
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

    // Register visibility handler if not already registered (deferred from constructor)
    if (!this.visibilityChangeHandler) {
      this.visibilityChangeHandler = () => {
        if (document.visibilityState === 'visible' && this.getChatState(agentId).isProcessing) {
          this.flushChunkUpdate(agentId);
        }
      };
      document.addEventListener('visibilitychange', this.visibilityChangeHandler);
    }

    try {
      // Get or create session
      // CROSS-WORKSPACE FIX: Use workspace-scoped lookup instead of currentWorkspace,
      // which reflects the UI's active workspace and may differ from the workspace
      // that owns this agent (e.g., background init, restore, or rebind scenarios).
      const targetWorkspace = selectWorkspaceById.select(getReduxStore().getState(), workspace.id as string);
      let session = selectAgentById.select(getReduxStore().getState(), agentId);

      // Diagnostic: log Redux state lookup outcome
      logger.info('initializeChat: Redux state lookup', {
        agentId,
        workspaceId: workspace.id,
        hasTargetWorkspace: !!targetWorkspace,
        hasSession: !!session,
      });
      rendererLogger.info(LogCategory.AGENT, 'initializeChat: Redux state lookup', {
        agentId,
        workspaceId: workspace.id,
        hasTargetWorkspace: !!targetWorkspace,
        hasSession: !!session,
      });

      // Track what was tried for the "gave up" summary
      let agentServiceGetSessionResult: boolean | undefined;
      let restoreSessionAttempted = false;
      let restoreSessionResult: 'session' | 'null' | 'error' | undefined;
      let retryCount = 0;

      if (!session) {
        // Try to get from agent service first (it might be in memory there)
        const tempSession = agentService.getSession(agentId);
        agentServiceGetSessionResult = !!tempSession;
        logger.info('initializeChat: agentService.getSession fallback', {
          agentId,
          workspaceId: workspace.id,
          found: !!tempSession,
        });
        rendererLogger.info(LogCategory.AGENT, 'initializeChat: agentService.getSession fallback', {
          agentId,
          workspaceId: workspace.id,
          found: !!tempSession,
        });
        if (tempSession) {
          session = tempSession;
        }
      }

      if (!session) {
        // Try to restore from disk
        restoreSessionAttempted = true;
        try {
          const restoredSession = await agentService.restoreSession(agentId, workspace);
          restoreSessionResult = restoredSession ? 'session' : 'null';
          if (restoredSession) {
            session = { ...restoredSession, isStreaming: restoredSession.isStreaming ?? false };
            logger.info('Restored session from disk', {
              agentId,
              workspaceId: workspace.id,
              sessionId: restoredSession.id,
              status: restoredSession.status,
              messageCount: restoredSession.messages?.length ?? 0,
            });
            rendererLogger.info(LogCategory.AGENT, 'initializeChat: restoreSession returned session', {
              agentId,
              workspaceId: workspace.id,
              sessionId: restoredSession.id,
              status: restoredSession.status,
              messageCount: restoredSession.messages?.length ?? 0,
            });

            // Note: Pending agents will be activated lazily on first message
            // This is more efficient and safer than activating immediately
            if (restoredSession.status === 'pending' || !restoredSession.backendSessionId) {
              logger.info('Restored agent is pending, will activate on first message', {
                agentId,
                status: restoredSession.status,
              });
            }
          } else {
            logger.info('initializeChat: restoreSession returned null (no session on disk)', {
              agentId,
              workspaceId: workspace.id,
            });
            rendererLogger.info(LogCategory.AGENT, 'initializeChat: restoreSession returned null', {
              agentId,
              workspaceId: workspace.id,
            });
          }
        } catch (err) {
          restoreSessionResult = 'error';
          const errorMessage = err instanceof Error ? err.message : String(err);
          const errorStack = err instanceof Error ? err.stack : undefined;
          logger.warn('Could not restore session from disk', {
            agentId,
            workspaceId: workspace.id,
            error: errorMessage,
            errorStack,
            rawError: err instanceof Error ? undefined : err,
          });
          rendererLogger.error(LogCategory.AGENT, 'initializeChat: restoreSession error', {
            agentId,
            workspaceId: workspace.id,
            error: errorMessage,
          });
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
          retryCount++;
          logger.info('initializeChat: retry iteration', {
            agentId,
            workspaceId: workspace.id,
            retryDelayMs: delay,
            retryNumber: retryCount,
          });
          await new Promise((resolve) => setTimeout(resolve, delay));

          // Check Redux state first — use workspace-scoped lookup
          session = selectAgentById.select(getReduxStore().getState(), agentId);

          logger.info('initializeChat: retry Redux state check', {
            agentId,
            workspaceId: workspace.id,
            retryNumber: retryCount,
            hasSession: !!session,
          });

          // Fall back to agent service
          if (!session) {
            const tempSession = agentService.getSession(agentId);
            logger.info('initializeChat: retry agentService.getSession check', {
              agentId,
              workspaceId: workspace.id,
              retryNumber: retryCount,
              found: !!tempSession,
            });
            if (tempSession) {
              session = tempSession;
            }
          }

          if (session) {
            logger.info('Session found after retry', {
              agentId,
              workspaceId: workspace.id,
              retryDelayMs: delay,
              retryNumber: retryCount,
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
        logger.warn('Session not found after all attempts, registering deferred handler', {
          agentId,
          workspaceId: workspace.id,
          reduxHadWorkspace: !!targetWorkspace,
          agentServiceGetSessionResult: agentServiceGetSessionResult ?? 'not attempted',
          restoreSessionAttempted,
          restoreSessionResult: restoreSessionResult ?? 'not attempted',
          retriesAttempted: retryCount,
        });
        rendererLogger.warn(LogCategory.AGENT, 'initializeChat: gave up — session not found after all attempts', {
          agentId,
          workspaceId: workspace.id,
          reduxHadWorkspace: !!targetWorkspace,
          agentServiceGetSessionResult: agentServiceGetSessionResult ?? 'not attempted',
          restoreSessionAttempted,
          restoreSessionResult: restoreSessionResult ?? 'not attempted',
          retriesAttempted: retryCount,
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

          const newSession = selectAgentById.select(getReduxStore().getState(), agentId);
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
      // state.messages because Redux state is only synced periodically and may be stale.
      let messages: AgentMessage[] = [];
      let hasActiveStream = false;
      try {
        const currentState = this.getChatState(agentId);
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
          const reduxSession = selectAgentById.select(getReduxStore().getState(), agentId);
          const reduxMessages =
            reduxSession?.messages && Array.isArray(reduxSession.messages)
              ? reduxSession.messages
              : [];

          // If instance state has more messages than Redux state,
          // prefer instance state. This happens when a stream completes while the user
          // is on a different workspace — the instance processed the end event and has
          // the completed response, but Redux state may have been overwritten by
          // restoreSessionWithoutBackend with stale disk data.
          if (
            currentState.messages.length > 0 &&
            currentState.messages.length > reduxMessages.length
          ) {
            messages = currentState.messages;
            logger.info('Using instance state messages (more complete than Redux state)', {
              agentId,
              instanceCount: currentState.messages.length,
              reduxCount: reduxMessages.length,
            });
          } else if (
            currentState.messages.length > 0 &&
            currentState.messages.length === reduxMessages.length &&
            reduxMessages.length > 0
          ) {
            // Content-richness tiebreaker: same message count, prefer richer final message
            const currentLast = currentState.messages[currentState.messages.length - 1];
            const sessionLast = reduxMessages[reduxMessages.length - 1];
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
                messages = reduxMessages;
                logger.debug('Got messages from Redux state', {
                  agentId,
                  count: messages.length,
                });
              }
            } else {
              // Different last message IDs — fall through to Redux state
              messages = reduxMessages;
              logger.debug('Got messages from Redux state', { agentId, count: messages.length });
            }
          } else if (reduxMessages.length > 0) {
            messages = reduxMessages;
            logger.debug('Got messages from Redux state', { agentId, count: messages.length });
          } else if (session.messages && Array.isArray(session.messages)) {
            // Fall back to messages from session
            messages = session.messages;
            logger.debug('Got messages from session', { agentId, count: messages.length });
          } else {
            // Try to get from Redux state using the workspace passed to
            // initializeChat (not currentWorkspace, which reflects the UI and can
            // differ during restore/rebind/background init).
            const agent = selectAgentById.select(getReduxStore().getState(), agentId);
            if (agent?.messages) {
              messages = agent.messages;
              logger.debug('Got messages from Redux state (workspace-aware)', {
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
      // Also check Redux state for the most up-to-date streaming state
      let isCurrentlyStreaming = session?.isStreaming || false;

      // Double-check with Redux state - it's the source of truth for streaming state
      const agentFromStore = selectAgentById.select(getReduxStore().getState(), agentId);
      if (agentFromStore?.isStreaming) {
        isCurrentlyStreaming = true;
        logger.info('Detected active streaming from Redux state', {
          agentId,
          sessionIsStreaming: session?.isStreaming,
          storeStreamingActive: agentFromStore.isStreaming,
        });
      }

      // During HMR, the session and Redux state may be reset while
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
          storeStreamingActive: agentFromStore?.isStreaming,
        });
      }

      logger.info('Initializing chat - streaming state check', {
        agentId,
        sessionIsStreaming: session?.isStreaming,
        storeStreamingActive: agentFromStore?.isStreaming,
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
      const freshState = this.getChatState(agentId);
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

      // Update state via Redux — session/messages to agent-session, flags to chat-state
      const normalizedSession = session ? { ...session, isStreaming: session.isStreaming ?? false, messages: deduplicatedMessages } : null;
      const effectiveLastAttempted = restoredLastAttemptedMessage ?? this.getChatState(agentId).lastAttemptedMessage;
      if (normalizedSession) {
        this.reduxDispatch(upsertAgentSessionData(normalizedSession));
      } else if (deduplicatedMessages.length > 0) {
        this.reduxDispatch(replaceAgentSessionMessages(agentId, deduplicatedMessages));
      }
      this.reduxDispatch(chatInitialized(agentId, {
        isStreaming: isCurrentlyStreaming,
        streamingContent: existingStreamingContent,
        lastAttemptedMessage: effectiveLastAttempted,
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
      this.setupStreaming(streamSessionId, agentId);
    } catch (error) {
      logger.error('Failed to initialize chat', error as Error);
      const errorMsg = error instanceof Error ? error.message : 'Failed to initialize chat';
      this.reduxDispatch(chatInitFailed(agentId, errorMsg));
      throw error;
    }
  }

  /**
   * Send a message in the active chat
   */
  async sendMessage(
    message: string,
    workspace: Workspace,
    agentId: string,
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

    // Normalize: trim whitespace/newlines so that the downstream
    // agentService.sendMessage uses a canonical form.
    message = message?.trim() ?? '';

    // Check message length (only if message is provided)
    if (message && message.length > MAX_MESSAGE_LENGTH) {
      throw new Error(`Message too long. Maximum length is ${MAX_MESSAGE_LENGTH} characters`);
    }

    if (!workspace) {
      throw new Error('Workspace is required');
    }

    let currentState = this.getChatState(agentId);

    if (!currentState.session) {
      throw new Error('No active chat session');
    }
    let session = selectAgentById.select(getReduxStore().getState(), agentId);

    if (!session) {
      // Fallback to the cached state if Redux state doesn't have it (shouldn't happen normally)
      logger.warn('Session not found in Redux state, using cached state', {
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
        currentState = this.getChatState(agentId);
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

    // NOTE: Concurrency control for sendMessage is handled by the saga layer:
    // - The saga's `activeSends` Set prevents concurrent sends for the same agent
    // - The saga checks streaming state for queue-vs-send decisions
    // - The saga dispatches `chatSendStarted` (which sets isStreaming/isProcessing=true
    //   in Redux) BEFORE calling this method, so any guard reading those Redux flags
    //   here would block every send, including legitimate ones.

    // Rate limiting
    // FIX: Throw instead of silently returning. The saga dispatches chatSendStarted
    // BEFORE calling sendMessage, so a silent return leaves the UI in a stuck
    // "processing" state (streamingStartTime set, no stream events to clear it).
    // Throwing lets the saga catch and dispatch chatSendFailed to clean up.
    const now = Date.now();
    if (now - this.lastMessageTime < MIN_MESSAGE_SEND_INTERVAL) {
      logger.warn('Message sent too quickly, rejecting');
      throw new MessageGuardError('Message sent too quickly, please wait a moment');
    }
    this.lastMessageTime = now;

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
          // Resize image for optimal token usage
          const resized = await resizeImageForAgent(data, mimeType);
          logger.info('Resized user-attached image file', {
            fileName: item.label,
            originalSizeKb: Math.round((data.length * 3) / 4 / 1024),
            resizedSizeKb: Math.round((resized.base64.length * 3) / 4 / 1024),
            mimeTypeChanged: mimeType !== resized.mimeType,
            originalMimeType: mimeType,
            resizedMimeType: resized.mimeType,
          });
          return {
            type: 'image' as const,
            data: resized.base64,
            mimeType: resized.mimeType,
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

    // Add image blocks from base64 data (already converted) — resize for optimal token usage
    for (const item of base64ImageItems) {
      try {
        const resized = await resizeImageForAgent(item.imageData!, item.imageMimeType!);
        logger.info('Resized base64 image attachment', {
          fileName: item.label,
          originalSizeKb: Math.round((item.imageData!.length * 3) / 4 / 1024),
          resizedSizeKb: Math.round((resized.base64.length * 3) / 4 / 1024),
          mimeTypeChanged: item.imageMimeType !== resized.mimeType,
          originalMimeType: item.imageMimeType,
          resizedMimeType: resized.mimeType,
        });
        contentBlocks.push({
          type: 'image' as const,
          data: resized.base64,
          mimeType: resized.mimeType,
        });
      } catch (error) {
        logger.warn('Failed to resize base64 image, using original', { fileName: item.label, error });
        contentBlocks.push({
          type: 'image' as const,
          data: item.imageData!,
          mimeType: item.imageMimeType!,
        });
      }
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

    // chatSendStarted is dispatched by the send-message saga before calling sendMessage(),
    // so we do NOT dispatch it here to avoid a double-dispatch.

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

        // Update session in agent-session slice
        this.reduxDispatch(upsertAgentSessionData(activatedAgent));
      } catch (error) {
        logger.error('Failed to activate agent on first message', error as Error);

        const errorMsg = error instanceof Error ? error.message : 'Failed to activate agent';
        this.reduxDispatch(chatSendFailed(agentId, errorMsg));
        throw error;
      }
    }

    // CRITICAL: Ensure stream handler is set up before sending
    // This is needed because stopChat() removes the handler, and when sending
    // a queued message after stopping, we need to re-register the handler
    const streamSessionId = session.id;
    if (!this.streamHandlers.has(streamSessionId) || !this.sessionUpdatedCleanups.has(streamSessionId)) {
      logger.info('[ChatService] Re-setting up stream handler before sendMessage', {
        sessionId: streamSessionId,
        missingStreamHandler: !this.streamHandlers.has(streamSessionId),
        missingSessionUpdatedHandler: !this.sessionUpdatedCleanups.has(streamSessionId),
      });
      this.setupStreaming(streamSessionId, agentId);
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
      // Exclude attachment-style items (inline images/files) — they are already
      // represented as image/file content blocks and must not produce duplicate
      // pills from metadata.contextReferences (which would render as a bare
      // "File" pill when no path/title is present).
      const contextItemRefs =
        options?.contextItems
          ?.filter((item) => {
            const asAny = item as any;
            return !asAny.imageData && !asAny.fileData && !asAny.file;
          })
          .map((item) => ({
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
      // METADATA FIX: Look up the full workspace from Redux state instead of
      // spreading the UI workspace with an overridden ID. Spreading keeps stale metadata
      // (worktreePath, repositoryPath, etc.) from the UI workspace, which can mis-target
      // activation or workspace-ready checks in agentService.sendMessage().
      let sendWorkspace = workspace;
      if (sessionWorkspaceId !== workspace.id) {
        const targetWs = selectWorkspaceById.select(getReduxStore().getState(), sessionWorkspaceId as string);
        sendWorkspace = targetWs ?? { ...workspace, id: sessionWorkspaceId as WorkspaceId };
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

      const errorMessage = error instanceof Error ? error.message : 'Failed to send message';
      const isInterrupted = errorMessage.includes('Agent interrupted');

      if (isInterrupted) {
        // Agent was interrupted (user pressed stop) - just clear streaming state
        logger.debug(
          '[ChatService] Agent interrupted - keeping messages, clearing streaming state',
        );
        this.reduxDispatch(chatInterrupted(agentId));
      } else {
        // Real error - clear streaming state and set error
        this.reduxDispatch(chatSendFailed(agentId, cleanErrorMessage(errorMessage)));
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
    agentId: string,
    options?: SendMessageOptions,
  ): Promise<void> {
    let currentState = this.getChatState(agentId);
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
      await this.stopChat(agentId);

      // Re-fetch state after stopping - messages may have changed
      currentState = this.getChatState(agentId);

      // Re-find the message index after state change
      // CRITICAL: Use the updated index for truncation, not the stale one
      messageIndex = currentState.messages.findIndex((m) => m.id === messageId);
      if (messageIndex === -1) {
        throw new Error('Message not found after stopping stream');
      }
    }

    // Remove all messages from this point onwards
    const messagesBeforeEdit = currentState.messages.slice(0, messageIndex);

    // CRITICAL: Update both ChatService state AND Redux state
    // If we only update ChatService state, the session-updated event handler
    // will overwrite our truncated messages with the old messages from Redux state
    this.reduxDispatch(replaceAgentSessionMessages(agentId, messagesBeforeEdit));

    // Sync the truncated messages to Redux state so they persist in memory
    const sessionId = currentState.session?.id;
    if (sessionId) {
      getReduxStore().dispatch(replaceAgentMessages(workspace.id, sessionId, messagesBeforeEdit));

      // Persist truncated messages to disk immediately so they survive page refresh.
      // Fire-and-forget: the subsequent sendMessage will also persist on stream complete.
      agentService.saveSession(sessionId, workspace.id, false, { allowTruncation: true }).catch((err: unknown) => {
        logger.warn('Failed to persist truncated messages after edit', {
          sessionId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    // Send the new message with resetHistory flag to clear ACP session history
    await this.sendMessage(newText, workspace, agentId, { ...options, resetHistory: true });
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
    agentId: string,
    options?: SendMessageOptions,
  ): Promise<void> {
    let currentState = this.getChatState(agentId);
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
      await this.stopChat(agentId);

      // Re-fetch state after stopping
      currentState = this.getChatState(agentId);
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
    // CRITICAL: Update both Redux state AND Redux state
    this.reduxDispatch(replaceAgentSessionMessages(agentId, messagesBeforeRegenerate));

    // Sync the truncated messages to Redux state so they persist in memory
    const sessionId = currentState.session?.id;
    if (sessionId) {
      getReduxStore().dispatch(replaceAgentMessages(workspace.id, sessionId, messagesBeforeRegenerate));

      // Persist truncated messages to disk immediately so they survive page refresh.
      agentService.saveSession(sessionId, workspace.id, false, { allowTruncation: true }).catch((err: unknown) => {
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
    await this.sendMessage(userText, workspace, agentId, regenerateOptions);
  }

  /**
   * Retry the last failed message.
   * This clears the error and resends the stored message.
   *
   * If lastAttemptedMessage is not available (e.g., for background/delegated agents
   * whose initial message was sent through the backend), falls back to extracting
   * the last user message from the conversation history and resending it.
   */
  async retryLastMessage(workspace: Workspace, agentId: string): Promise<void> {
    const currentState = this.getChatState(agentId);

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

      // Clear error state before retrying via Redux
      this.reduxDispatch(chatErrorCleared(agentId));

      logger.info('Retrying last message', { messageLength: text.length });

      // Resend the message
      await this.sendMessage(text, workspace, agentId, options);
    } else {
      // Fallback path: extract last user message from conversation history.
      // This handles background/delegated agents whose initial message was sent
      // through the backend (bypassing chatService.sendMessage), so
      // lastAttemptedMessage was never set.
      await this.retryFromConversationHistory(workspace, agentId);
    }
  }

  /**
   * Retry the last message with a different model.
   * Used when the original model was unavailable.
   */
  async retryWithModel(workspace: Workspace, agentId: string, model: string): Promise<void> {
    const currentState = this.getChatState(agentId);

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

      // Clear error and modelUnavailable state before retrying via Redux
      this.reduxDispatch(chatErrorCleared(agentId));
      this.reduxDispatch(chatModelUnavailableCleared(agentId));

      logger.info('Retrying last message with different model', {
        messageLength: text.length,
        newModel: model,
      });

      // Resend the message with the new model
      await this.sendMessage(text, workspace, agentId, {
        ...options,
        model,
      });
    } else {
      // Fallback path: extract last user message from conversation history
      await this.retryFromConversationHistory(workspace, agentId, { model });
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
    agentId: string,
    options?: SendMessageOptions,
  ): Promise<void> {
    const currentState = this.getChatState(agentId);
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

    // Update state: truncate messages and clear error via Redux
    this.reduxDispatch(replaceAgentSessionMessages(agentId, messagesBeforeRetry));
    this.reduxDispatch(chatErrorCleared(agentId));
    this.reduxDispatch(chatModelUnavailableCleared(agentId));

    // Sync truncated messages to Redux state so they persist
    // FIX: Use workspace-aware write path so cleanup targets the correct
    // workspace even if the user switched workspaces before retrying.
    const sessionId = currentState.session?.id;
    if (sessionId) {
      const workspaceId = (currentState.session?.workspaceId ?? workspace.id) as string;
      getReduxStore().dispatch(replaceAgentMessages(workspaceId, sessionId, messagesBeforeRetry));

      // Persist truncated messages to disk
      agentService.saveSession(sessionId, workspaceId, false, { allowTruncation: true }).catch((err: unknown) => {
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

    await this.sendMessage(userText, workspace, agentId, retryOptions);
  }

  /**
   * Clear the modelUnavailable state
   */
  clearModelUnavailable(agentId: string): void {
    this.reduxDispatch(chatModelUnavailableCleared(agentId));
  }

  /**
   * Clear the current error state
   */
  clearError(agentId: string): void {
    this.reduxDispatch(chatErrorCleared(agentId));
  }

  /**
   * Set up streaming for a session
   */
  private setupStreaming(sessionId: string, agentId: string): void {
    // Invariant: sessionId must exist (session must be initialized before streaming)
    assertStreamingInvariant(
      !!sessionId && sessionId.length > 0,
      'setupStreaming called with empty sessionId',
      { agentId },
    );

    // Invariant: session should exist in the store
    const setupStreamingWsId = this.getChatState(agentId).session?.workspaceId || (selectActiveWorkspaceId.select(getReduxStore().getState()) as string | undefined);
    const sessionCheck = setupStreamingWsId
      ? selectAgentById.select(getReduxStore().getState(), sessionId)
      : undefined;
    assertStreamingInvariant(
      !!sessionCheck,
      'setupStreaming called but session not found in store',
      { sessionId, agentId },
    );

    logger.debug('[ChatService] setupStreaming called', {
      sessionId,
      eventName: `agent:stream:${sessionId}`,
    });

    // Clean up any existing handler, but preserve accumulated content.
    // setupStreaming is about re-registering event handlers, not discarding content.
    this.cleanupStream(sessionId, /* preserveContent */ true);

    // Create stream handler — capture agentId in closure
    const handler = (data: any) => {
      this.handleStreamEvent(sessionId, data, agentId);
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
    const syntheticStartWsId = this.getChatState(agentId).session?.workspaceId || (selectActiveWorkspaceId.select(getReduxStore().getState()) as string | undefined);
    const session = syntheticStartWsId
      ? selectAgentById.select(getReduxStore().getState(), sessionId)
      : undefined;
    if (session?.isStreaming) {
      logger.info('[ChatService] Dispatching synthetic start event for backend-initiated stream', {
        sessionId,
      });
      this.handleStreamEvent(sessionId, new CustomEvent('synthetic', { detail: { type: 'start' } }), agentId);
    }

    // Also listen for session-updated events to sync after agent-factory updates
    // This is especially important for queued messages that start streaming from the backend
    const sessionUpdatedHandler = () => {
      logger.debug('[ChatService] sessionUpdatedHandler called', { sessionId });
      // CROSS-WORKSPACE FIX: Use workspace-aware lookup so session-updated events
      // are correctly processed even when the user has switched workspaces.
      // If no workspace ID is available from instance state or currentWorkspace,
      // search all workspaces to avoid silently dropping the event.
      const updatedHandlerWsId = this.getChatState(agentId).session?.workspaceId || (selectActiveWorkspaceId.select(getReduxStore().getState()) as string | undefined);
      let session = updatedHandlerWsId
        ? selectAgentById.select(getReduxStore().getState(), sessionId)
        : undefined;
      if (!session) {
        // Search all workspaces for this session
        const allWorkspaces = selectWorkspaceItems.select(getReduxStore().getState());
        for (const ws of allWorkspaces) {
          const wsId = ws.id as string;
          if (wsId) {
            session = selectAgentById.select(getReduxStore().getState(), sessionId) ?? undefined;
            if (session) {
              logger.warn('[ChatService] sessionUpdatedHandler: session found via cross-workspace lookup', {
                sessionId,
                foundInWorkspaceId: wsId,
              });
              break;
            }
          }
        }
      }
      const currentState = this.getChatState(agentId);
      if (session && session.messages) {
        const newIsStreaming = session.isStreaming ?? currentState.isStreaming;

        // GUARD: Prevent stale session data from dropping user messages during streaming transitions.
        // When currentState.isStreaming=true but newIsStreaming=false (stale disk data from
        // restoreSessionWithoutBackend), neither the non-streaming guard below NOR the streaming
        // guard further down applies. This gap allows stale data to overwrite user messages.
        //
        // We detect this by checking: if we're currently streaming AND message count would
        // decrease AND the current state's last message is a user message (indicating a
        // just-sent message), reject the update. This only applies during streaming transitions
        // since the non-streaming case is already covered by the guard at line ~2686.
        // This is safe because:
        // - Edit/regenerate goes through resetHistory, not sessionUpdatedHandler
        // - Backend message consolidation (legitimate count reduction) always ends with an
        //   assistant message, not a user message
        // - Stale restore data from disk will be missing the user's recently-sent message
        if (currentState.isStreaming && currentState.messages.length > 0 && session.messages.length < currentState.messages.length) {
          const lastMessage = currentState.messages[currentState.messages.length - 1];
          if (lastMessage?.role === 'user') {
            logger.info(
              '[ChatService] sessionUpdatedHandler: skipping - would drop user message',
              {
                sessionId,
                currentMessageCount: currentState.messages.length,
                sessionMessageCount: session.messages.length,
                lastMessageRole: lastMessage.role,
                lastMessageId: lastMessage.id,
                currentIsStreaming: currentState.isStreaming,
                newIsStreaming,
              },
            );
            track('Blocked Stale Session Update', {
              agent_id: agentId || '',
              workspace_id: session.workspaceId || '',
              current_message_count: currentState.messages.length,
              incoming_message_count: session.messages.length,
              is_streaming: currentState.isStreaming,
            });
            return;
          }
        }

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
        // When switching workspaces, resumeSession() loads stale disk data into Redux state,
        // then reconnectToBackendStreams() dispatches agent:session-updated which triggers this handler.
        // The Redux state data is stale because flushChunkUpdate() (the streaming content accumulator)
        // never writes to Redux state — the ChatService instance has the correct, up-to-date messages.
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
          logger.debug('Session streaming state synced from Redux state', {
            sessionId,
            newIsStreaming,
          });
        }

        // If streaming and the session has messages with content,
        // sync the localStreamingContent from the last assistant message.
        // This handles the case where page refresh happens during streaming:
        // AgentService fetches accumulated content from backend and updates Redux state,
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

        // Deduplicate messages to prevent Svelte "duplicate key" error
        const seen = new Set<string>();
        const deduplicatedMessages = session.messages.filter((m: any) => {
          if (seen.has(m.id)) {
            logger.debug('Removing duplicate message during session sync', { messageId: m.id });
            return false;
          }
          seen.add(m.id);
          return true;
        });

        // Apply streaming monotonicity guards and dispatch to Redux
        const latestState = this.getChatState(agentId);
        const guardedMessages = this.guardStreamingMessages(latestState, deduplicatedMessages, newIsStreaming);
        this.reduxDispatch(streamChunkFlushed(agentId, newStreamingContent));
        this.reduxDispatch(replaceAgentSessionMessages(agentId, guardedMessages));

        // CRITICAL: Re-setup stream listener if session is streaming but we don't have a handler
        // This happens when stopChat() was called (which removes the handler) and then
        // a queued message starts streaming from the backend
        if (newIsStreaming && !this.streamHandlers.has(sessionId)) {
          logger.info('[ChatService] Re-setting up stream listener for queued message', {
            sessionId,
          });
          this.setupStreaming(sessionId, agentId);
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
  private handleStreamEvent(sessionId: string, event: CustomEvent | Event, agentId: string): void {
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

      // Clear status events storage for new turn, but preserve restored events on reconnection
      // (same pattern as streaming content preservation above)
      const currentState = this.getChatState(agentId);
      const hasRestoredStatusEvents = currentState.statusEvents.length > 0;
      if (!hasRestoredStatusEvents) {
        this.clearStatusEventsStorage(agentId);
      } else {
        logger.info('Preserving restored status events on start event', {
          sessionId,
          preservedEventCount: currentState.statusEvents.length,
        });
      }

      // Start stall detection for unresponsive streams
      this.startStallDetection(agentId);
      // Start state reconciliation to detect and recover from stuck states
      this.startStateReconciliation(sessionId, agentId);

      // Update Redux state streaming state
      // Use setStreaming() to explicitly set streaming.active = true.
      // addSession() calls setAgent() which PRESERVES existing streaming.active, so calling
      // addSession({...session, isStreaming: true}) does NOT actually turn on streaming.active.
      // After HMR/page refresh, streaming.active is initialized to false from disk data,
      // and without this explicit setStreaming call, it stays false even though the backend
      // is actively streaming. This allows users to bypass the isStreaming guard in sendMessage().
      // CROSS-WORKSPACE FIX: Search all workspaces to find the session owner, so the
      // correct session is updated even when the user has switched workspaces.
      // First try the fast path (instance state or currentWorkspace), then search all.
      const candidateWsId = this.getChatState(agentId).session?.workspaceId || (selectActiveWorkspaceId.select(getReduxStore().getState()) as string | undefined);
      let startWsId: string | undefined;
      let startSession = candidateWsId
        ? selectAgentById.select(getReduxStore().getState(), sessionId)
        : undefined;
      if (startSession) {
        startWsId = candidateWsId;
      } else {
        // Search all workspaces for this session (handles cross-workspace switches
        // and cases where candidateWsId is falsy or points to the wrong workspace).
        const allWorkspaces = selectWorkspaceItems.select(getReduxStore().getState());
        for (const ws of allWorkspaces) {
          const wsId = ws.id as string;
          if (wsId) {
            startSession = selectAgentById.select(getReduxStore().getState(), sessionId) ?? undefined;
            if (startSession) {
              logger.warn('[ChatService] handleStreamEvent start: session found via cross-workspace lookup', {
                sessionId,
                foundInWorkspaceId: wsId,
              });
              startWsId = wsId;
              break;
            }
          }
        }
      }
      if (startWsId) {
        getReduxStore().dispatch(setAgentStreaming(startWsId, sessionId, true));
        if (startSession) {
          getReduxStore().dispatch(upsertAgentSession(startWsId, {
            ...startSession,
            isStreaming: true,
          }));
        }
      }

      // Dispatch to Redux
      this.reduxDispatch(streamStarted(agentId, {
        hasRestoredContent,
        existingContent,
      }));
    } else if (data.type === 'chunk') {
      // Record chunk received for stall detection
      this.recordChunkReceived(agentId);

      // Accumulate text in per-instance accumulator
      const currentContent = this.localStreamingContent;
      const newStreamingContent = currentContent + (data.content || '');
      this.localStreamingContent = newStreamingContent;

      // NOTE: Do NOT read from or write to Redux state here. AgentService is the sole
      // writer to Redux state during streaming (via updateMessageForWorkspace). Having
      // ChatService also call addSession() creates a race condition where stale snapshots
      // overwrite AgentService's correctly accumulated contentBlocks. ChatService only
      // updates its own instance state (for UI rendering).

      this.scheduleChunkUpdate(newStreamingContent, agentId);
    } else if (data.type === 'content-blocks') {
      // Handle content blocks (tool calls, etc.)
      // Add the content blocks to the current streaming message

      // Record chunk received for stall detection (but NOT as a text chunk —
      // tool-use content blocks must not flip receivedFirstChunk or append the
      // synthetic "Streaming response…" event, so the marker is still available
      // when the first real text chunk arrives later).
      this.recordChunkReceived(agentId, /* isTextChunk */ false);

      // Cancel pending chunk update.
      // IMPORTANT: Do NOT call flushChunkUpdate() here. flushChunkUpdate() reads from
      // ChatService's own state (s.messages) which may not yet include tool blocks from
      // previous content-blocks events. Flushing stale state triggers ChatPanel's Path A
      // subscription with fewer contentBlocks, causing tool calls to briefly disappear.
      // Instead, just cancel the pending RAF and clear the pending content. The content-blocks
      // handler below will update state with the correct messages from Redux state.
      if (this.chunkUpdateRafId !== null) {
        cancelAnimationFrame(this.chunkUpdateRafId);
        this.chunkUpdateRafId = null;
        // Carry forward the pending streaming text so it's not lost.
        // The content-blocks handler reads localStreamingContent and
        // Redux state messages, so we just need to make sure the accumulated text is
        // preserved in localStreamingContent (it already is — chunk handler appends to it).
        this.pendingStreamingContent = null;
      }

      // Get messages from Redux state (source of truth)
      // FIX: Fall back to ChatService instance state if Redux state doesn't have the session.
      // This prevents wiping optimistic user messages when getSessionForWorkspace() returns
      // undefined due to workspace context mismatches or timing issues during force-submit.
      const cbCurrentState = this.getChatState(agentId);
      const contentBlocksWsId = cbCurrentState.session?.workspaceId;
      const session = contentBlocksWsId
        ? selectAgentById.select(getReduxStore().getState(), sessionId)
        : undefined;
      const currentInstanceMessages = cbCurrentState.messages;
      // COUNT MISMATCH PROTECTION: If Redux state has fewer messages than instance state,
      // prefer instance messages to avoid losing optimistic user messages or streamed content.
      // This handles the case where Redux state has a stale/shorter snapshot (e.g., during
      // workspace switches or when optimistic messages haven't been persisted yet).
      const existingMessages =
        session?.messages && session.messages.length >= currentInstanceMessages.length
          ? session.messages
          : currentInstanceMessages;
      if (!session) {
        // Downgrade from WARN to DEBUG. This is expected behavior for
        // cross-workspace agents — the session doesn't exist in the store for the
        // other workspace. The fallback to instance messages handles it correctly.
        logger.debug('[ChatService] content-blocks: getSessionForWorkspace returned undefined — using instance messages as fallback', {
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

      // NOTE: Do NOT update Redux state here. AgentService is the sole writer to
      // Redux state during streaming (via updateMessageForWorkspace). See chunk handler
      // comment above for full explanation of the race condition this prevents.

      // Update via Redux with streaming monotonicity guards
      const cbState = this.getChatState(agentId);
      if (!cbState.isStreaming || !cbState.isProcessing) {
        logger.warn('[ChatService] content-blocks: streaming flags were incorrect during active content-blocks processing — forcing back to true (stale sessionUpdatedHandler likely set them)', {
          sessionId,
          wasStreaming: cbState.isStreaming,
          wasProcessing: cbState.isProcessing,
          messageCount: updatedMessages.length,
        });
      }
      const guardedMessages = this.guardStreamingMessages(cbState, updatedMessages, true);
      this.reduxDispatch(streamChunkFlushed(agentId, hasNewToolUse ? '' : cbState.streamingContent));
      this.reduxDispatch(replaceAgentSessionMessages(agentId, guardedMessages));

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
        this.reduxDispatch(chatModelUnavailableSet(agentId, {
          failedModel: messageMetadata.failedModel,
          nextAvailableModel: messageMetadata.nextAvailableModel,
        }));
      } else {
        this.reduxDispatch(chatModelUnavailableCleared(agentId));
      }

      // Stop stall detection and state reconciliation
      this.stopStallDetection();
      this.stopStateReconciliation();

      // Flush any pending chunk updates before finalizing
      if (this.chunkUpdateRafId !== null) {
        cancelAnimationFrame(this.chunkUpdateRafId);
        this.chunkUpdateRafId = null;
      }
      this.flushChunkUpdate(agentId);

      // MULTI-AGENT FIX: Get messages from Redux state (source of truth)
      // CROSS-WORKSPACE FIX: Try instance workspace first, then search all workspaces.
      const endWsId = this.getChatState(agentId).session?.workspaceId;
      let session = endWsId
        ? selectAgentById.select(getReduxStore().getState(), sessionId)
        : undefined;
      if (!session) {
        // Search all workspaces for this session
        const allWorkspaces = selectWorkspaceItems.select(getReduxStore().getState());
        for (const ws of allWorkspaces) {
          const wsId = ws.id as string;
          if (wsId) {
            session = selectAgentById.select(getReduxStore().getState(), sessionId) ?? undefined;
            if (session) {
              logger.warn('[ChatService] Session found via cross-workspace lookup (user switched workspaces during streaming)', {
                sessionId,
                foundInWorkspaceId: wsId,
                currentWorkspaceId: (selectActiveWorkspaceId.select(getReduxStore().getState()) as string | undefined),
              });
              break;
            }
          }
        }
      }
      // FIX: Fall back to ChatService instance state if no session found anywhere.
      // This prevents wiping user messages when the session can't be
      // found in any workspace (e.g., during force-submit timing edge cases).
      const currentInstanceMessages = this.getChatState(agentId).messages;
      const existingMessages = session?.messages ?? currentInstanceMessages;
      if (!session) {
        logger.warn('[ChatService] end: Session not found in any workspace — using instance messages as fallback', {
          sessionId,
          instanceMessageCount: currentInstanceMessages.length,
        });
      }
      const lastMessage = existingMessages[existingMessages.length - 1];

      // Clear streaming state in Redux state for this session
      const endClearWsId = session?.workspaceId || endWsId;
      if (endClearWsId) {
        logger.info('[ChatService] Clearing streaming state in Redux state', {
          sessionId,
          workspaceId: endClearWsId,
        });
        getReduxStore().dispatch(setAgentStreaming(endClearWsId, sessionId, false));
      }

      // Clean up per-instance accumulator
      this.localStreamingContent = '';
      this.pendingStreamingContent = null;

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

      // ALWAYS sync finalized messages to Redux state
      const endSyncWsId = session?.workspaceId || endWsId;
      if (session && endSyncWsId) {
        getReduxStore().dispatch(upsertAgentSession(endSyncWsId, {
          ...session,
          messages: updatedMessages,
          isStreaming: false,
        }));

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

      // Clear status events storage on stream end - events are transient per-stream
      this.clearStatusEventsStorage(agentId);

      // Dispatch messages to agent-session, flags to chat-state
      this.reduxDispatch(replaceAgentSessionMessages(agentId, updatedMessages));
      this.reduxDispatch(streamCompleted(agentId, {
        lastAttemptedMessage: null,
        modelUnavailable: null,
      }));

    } else if (data.type === 'error') {
      // Stop stall detection on error
      this.stopStallDetection();
      // Stop state reconciliation on error
      this.stopStateReconciliation();

      // Reset local accumulator on error to prevent stale data in next stream
      this.localStreamingContent = '';
      this.pendingStreamingContent = null;

      // Clear status events storage on error - events are transient per-stream
      this.clearStatusEventsStorage(agentId);

      // Clear streaming state in Redux state on error
      const errorState = this.getChatState(agentId);
      const errorWsId = errorState.session?.workspaceId;
      if (errorWsId) {
        getReduxStore().dispatch(setAgentStreaming(
          errorWsId,
          errorState.session!.id,
          false,
        ));
      }

      // Save any partial content before clearing
      const partialContent = this.getState(agentId).streamingContent;
      const cleanedError = cleanErrorMessage(data.error || 'The response was interrupted. Please try again.');

      // If we have partial content, save it as a message with an error indicator
      if (partialContent && partialContent.trim()) {
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

        // Dispatch error message to agent-session, error flag to chat-state
        this.reduxDispatch(addAgentSessionMessage(agentId, errorMessage));
        this.reduxDispatch(streamErrored(agentId, {
          error: cleanedError,
        }));
      } else {
        // Dispatch to Redux
        this.reduxDispatch(streamErrored(agentId, {
          error: cleanedError,
        }));
      }
    } else if (data.type === 'status') {
      const statusData = data.statusData || data.data;
      logger.info('[ChatService] Received status event', {
        sessionId,
        phase: statusData?.phase,
        message: statusData?.message,
      });
      if (statusData) {
        const statusEvent = { ...statusData, timestamp: statusData.timestamp || Date.now() };
        const resetFirstChunk = statusData.phase === 'tool-call' || statusData.phase === 'tool-waiting';
        // Persist to localStorage so events survive tab switches and HMR reloads
        const currentState = this.getChatState(agentId);
        const newStatusEvents = [...currentState.statusEvents, statusEvent];
        this.saveStatusEventsToStorage(newStatusEvents, agentId);
        this.reduxDispatch(streamStatusReceived(agentId, statusEvent, resetFirstChunk));
      }
    }

    // Set timeout to clean up stale streams (existing timeout was already cleared at start of handleStreamEvent)
    const cleanup = memoryManager.registerTimer(
      () => {
        const currentState = this.getChatState(agentId);
        if (currentState.isStreaming) {
          logger.warn('Stream timeout - cleaning up', { sessionId });
          // Reset per-instance accumulator for the timed-out session
          this.localStreamingContent = '';
          this.pendingStreamingContent = null;

          // Clear streaming state in Redux state on timeout
          const timeoutWsId = currentState.session?.workspaceId;
          if (timeoutWsId) {
            getReduxStore().dispatch(setAgentStreaming(
              timeoutWsId,
              currentState.session!.id,
              false,
            ));
          }

          this.reduxDispatch(streamTimedOut(agentId));
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
  async stopChat(agentId: string): Promise<void> {
    const currentState = this.getState(agentId);

    if (currentState.session) {
      // Set isInterrupting flag to block new sends during cleanup
      this.reduxDispatch(chatStopInitiated(agentId));

      // Stop any ongoing streaming
      try {
        await agentService.stopSession(currentState.session.id);
      } catch (err) {
        logger.warn('Could not stop session', err);
      }

      // FIX: Wait for the backend to fully clean up pending requests BEFORE removing handlers
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Clean up stream handlers AFTER the wait period
      const streamSessionId = currentState.session.id;
      this.cleanupStream(streamSessionId);

      // Update state - clear isInterrupting after cleanup is complete
      this.reduxDispatch(chatStopCompleted(agentId));
    }
  }

  /**
   * Clear the current chat session
   */
  clearChat(agentId: string): void {
    const currentState = this.getState(agentId);

    if (currentState.session) {
      // Clean up streaming
      const streamSessionId = currentState.session.id;
      this.cleanupStream(streamSessionId);
    }

    // Stop stall detection when clearing
    this.stopStallDetection();
    this.stopStateReconciliation();

    // Clear status events from localStorage
    this.clearStatusEventsStorage(agentId);

    // Reset via Redux
    this.reduxDispatch(chatReset(agentId));
  }

  /**
   * Get a Svelte-compatible readable store backed by Redux state.
   * Subscribers receive updates whenever the Redux chat-state slice changes.
   */
  getStore(agentId: string): Readable<ChatState> {
    return {
      subscribe: (run: (value: ChatState) => void) => {
        // Emit initial value
        run(this.getChatState(agentId));

        // Subscribe to Redux store changes
        let prev = this.getChatState(agentId);
        const store = getReduxStore();
        const unsubscribe = store.subscribe(() => {
          const next = this.getChatState(agentId);
          if (next !== prev) {
            prev = next;
            run(next);
          }
        });

        return unsubscribe;
      },
    };
  }

  /**
   * Get current state snapshot from Redux (preferred) or local fallback.
   */
  getState(agentId: string): ChatState {
    return this.getChatState(agentId);
  }

  /**
   * Update messages directly.
   */
  updateMessages(agentId: string, messages: AgentMessage[]): void {
    this.reduxDispatch(replaceAgentSessionMessages(agentId, messages));
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
    agentId: string,
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
    const currentState = this.getChatState(agentId);
    if (!currentState.session) {
      throw new Error('No active chat session to fork');
    }

    const sourceSession = currentState.session;
    const sourceMessages = currentState.messages;

    // If streaming, stop it first
    if (currentState.isStreaming || currentState.isProcessing) {
      logger.info('Stopping current stream before forking session');
      await this.stopChat(agentId);
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
      } catch {
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
    const { persistenceService } = await import('$features/agent/browser');

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
    const existingSession = selectAgentById.select(getReduxStore().getState(), forkedSession.id);
    if (existingSession) {
      getReduxStore().dispatch(upsertAgentSession(workspace.id, {
        ...existingSession,
        messages: clonedMessages,
        parentSessionId: sourceSession.id,
        forkedAt: new Date().toISOString(),
        forkPoint,
        forkMetadata: {
          selectedText: options?.selectedText,
          selectedModel: options?.model,
        },
      }));
    }

    // Update parent session's childSessionIds
    const parentSession = selectAgentById.select(getReduxStore().getState(), sourceSession.id);
    if (parentSession) {
      const childSessionIds = parentSession.childSessionIds || [];
      getReduxStore().dispatch(upsertAgentSession(workspace.id, {
        ...parentSession,
        childSessionIds: [...childSessionIds, forkedSession.id],
      }));
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

    // Note: Redux state cleanup (chatReset) is the responsibility of the
    // caller (ChatServiceManager) which knows the agentId.
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
 *   // Calling getChatService(agentId) again returns the same instance
 */
const CHAT_SERVICE_HMR_KEY = '__chatServiceManager_hmr';

export class ChatServiceManager {
  private static managerInstance: ChatServiceManager;
  private services = new Map<string, ChatService>();

  static getInstance(): ChatServiceManager {
    // Survive HMR: reuse instance stored on window if available
    if (typeof window !== 'undefined' && (window as any)[CHAT_SERVICE_HMR_KEY]) {
      this.managerInstance = (window as any)[CHAT_SERVICE_HMR_KEY];
      return this.managerInstance;
    }
    if (!this.managerInstance) {
      this.managerInstance = new ChatServiceManager();
      if (typeof window !== 'undefined') {
        (window as any)[CHAT_SERVICE_HMR_KEY] = this.managerInstance;
      }
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
      service = new ChatService();
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
      // Clean up Redux chat-state for this agent
      getReduxStore().dispatch(chatReset(agentId));
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