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
import { activeProviderStore } from '$lib/stores/active-provider.store.svelte';
import { getProviderConfig } from '$shared/config/provider-config';
import { cleanErrorMessage } from '$shared/errors/messages';

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
  private connectionHandler: ((e: Event) => void) | null = null;
  private disposed = false;

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
      this.state.update((s) => {
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
            const storeSession = sessionStore.getSession(sessionId);
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
      if (!currentState.isStreaming || !currentState.lastChunkTime) {
        return;
      }

      const timeSinceLastChunk = Date.now() - currentState.lastChunkTime;

      if (timeSinceLastChunk >= this.STALL_DETECTION_MS && !currentState.isStalled) {
        logger.warn('Stream appears stalled - no chunks received', {
          timeSinceLastChunk,
          threshold: this.STALL_DETECTION_MS,
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
            // UI thinks we're processing, but backend has no active stream
            this.stateReconciliationFailureCount++;

            logger.warn('State reconciliation: potential stuck state detected', {
              sessionId: currentSessionId,
              failureCount: this.stateReconciliationFailureCount,
              threshold: this.STATE_RECONCILIATION_FAILURE_THRESHOLD,
              isProcessing: stateAfterCheck.isProcessing,
              isStreaming: stateAfterCheck.isStreaming,
              backendActiveStreams: activeStreams.length,
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
    this.state.update((s) => ({
      ...s,
      lastChunkTime: Date.now(),
      isStalled: false,
    }));
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
    logger.info('Initializing chat', { workspaceId: workspace.id, agentId });

    try {
      // Get or create session
      const currentWorkspace = unifiedStateStore.currentWorkspace;
      const agentState = currentWorkspace?.agents.get(agentId);
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
        // Only create new session if agentId is provided and no session exists
        // This prevents duplicate agent creation
        logger.info('No existing session found, creating new one', { agentId });

        const newSession = await agentService.createSession(workspace, {
          agentId, // Pass the agentId to ensure we use the same ID
          name: options?.agentName || 'Chat',
          model: options?.agentModel,
          agentType: options?.agentType,
          metadata: {
            isInitialWorkspaceAgent: options?.isInitialWorkspaceAgent,
          },
        });
        if (newSession) {
          session = { ...newSession, isStreaming: newSession.isStreaming ?? false };
        }
      }

      // Ensure session exists before proceeding
      if (!session) {
        throw new Error('Failed to create or retrieve session');
      }

      // Get messages for this session
      // During HMR/remount, if this instance is already streaming, prefer its own
      // state.messages because sessionStore is only synced periodically and may be stale.
      let messages: AgentMessage[] = [];
      try {
        const currentState = get(this.state);
        const hasActiveStream =
          currentState.isStreaming &&
          currentState.messages.length > 0;

        if (hasActiveStream) {
          // Use this instance's messages - they're the most up-to-date during streaming
          messages = currentState.messages;
          logger.info('Using instance state messages during active stream (HMR recovery)', {
            agentId,
            count: messages.length,
            lastMessageBlocks: messages[messages.length - 1]?.contentBlocks?.length || 0,
          });
        } else {
          // Normal case: check sessionStore first for latest state
          const sessionStoreSession = sessionStore.getSession(agentId);
          if (
            sessionStoreSession &&
            sessionStoreSession.messages &&
            Array.isArray(sessionStoreSession.messages)
          ) {
            messages = sessionStoreSession.messages;
            logger.debug('Got messages from sessionStore', { agentId, count: messages.length });
          } else if (session.messages && Array.isArray(session.messages)) {
            // Fall back to messages from session
            messages = session.messages;
            logger.debug('Got messages from session', { agentId, count: messages.length });
          } else {
            // Try to get from unified state store
            const currentWorkspace = unifiedStateStore.currentWorkspace;
            const agent = currentWorkspace?.agents.get(agentId);
            if (agent?.messages) {
              messages = agent.messages;
              logger.debug('Got messages from unified state store', {
                agentId,
                count: messages.length,
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

      logger.info('Initializing chat - streaming state check', {
        agentId,
        sessionIsStreaming: session?.isStreaming,
        storeStreamingActive: agentFromStore?.streaming?.active,
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
        // Initialize local accumulator with existing content (if streaming)
        this.localStreamingContent = existingStreamingContent;
      }

      // CRITICAL FIX: Deduplicate messages loaded from disk to prevent Svelte "duplicate key" error
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

      // Update state - ensure isStreaming has a default value
      this.state.update((s) => ({
        ...s,
        session: session ? { ...session, isStreaming: session.isStreaming ?? false } : null,
        messages: deduplicatedMessages,
        isStreaming: isCurrentlyStreaming,
        isProcessing: isCurrentlyStreaming,
        streamingContent: existingStreamingContent, // Use existing content instead of empty string
        error: null,
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
    // Validate inputs - allow empty text if there are images attached
    const hasImages = options?.contextItems?.some((item) => item.imageData && item.imageMimeType);
    if (!message?.trim() && !hasImages) {
      throw new Error('Message cannot be empty');
    }

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

    // CRITICAL FIX: ALWAYS fetch the session from sessionStore to get fresh isStreaming state.
    // The internal state copy can become stale. The sessionStore reflects the true state from
    // unifiedStateStore, which is updated when setStreamingForWorkspace() is called on stream
    // completion. Without always refreshing, we might check a stale isStreaming=true and block sends.
    const agentId = options?.agentId || currentState.session.id;
    let session = sessionStore.getSession(agentId);

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
    // We check the per-session isStreaming property from sessionStore as the source of truth
    // for whether this specific agent is processing.
    if (session.isStreaming) {
      logger.warn('Already processing a message for this agent, ignoring new send request', {
        agentId: session.id,
        sessionIsStreaming: session.isStreaming,
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

    logger.info('Sending message', {
      sessionId: session.id,
      messageLength: message.length,
      hasContext: !!options?.contextItems?.length,
    });

    // Lazy activation: if agent is pending, activate it now on first message
    if (session.status === 'pending' || !session.backendSessionId) {
      logger.info('Agent is pending, activating on first message', {
        agentId: session.id,
        status: session.status,
      });

      try {
        const activatedAgent = await agentService.activateAgent(session.id, workspace.id);
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

    // Add optimistic user message with unique ID
    const userMessage: AgentMessage = {
      id: createMessageId(`msg_${uuidv4()}`),
      role: 'user',
      contentBlocks,
      timestamp: new Date().toISOString(),
      // Store context references in metadata for display in ChatMessage
      metadata: options?.contextReferences?.length
        ? { contextReferences: options.contextReferences }
        : undefined,
    };

    // Reset local accumulator when sending a new message
    this.localStreamingContent = '';

    this.state.update((s) => {
      // CRITICAL FIX: Check for duplicate message ID before adding
      // This prevents the Svelte "duplicate key" error in keyed each blocks
      const isDuplicate = s.messages.some((m) => m.id === userMessage.id);
      if (isDuplicate) {
        logger.debug('Skipping duplicate user message in ChatService state', {
          messageId: userMessage.id,
        });
        return {
          ...s,
          isProcessing: true,
          isStreaming: true,
          streamingContent: '',
          error: null,
          streamingStartTime: Date.now(),
          lastAttemptedMessage: { text: message, options },
        };
      }
      return {
        ...s,
        messages: [...s.messages, userMessage],
        isProcessing: true,
        isStreaming: true, // Set streaming immediately when sending
        streamingContent: '',
        error: null,
        streamingStartTime: Date.now(), // Track when streaming started for debug info
        // Store message for retry functionality
        lastAttemptedMessage: { text: message, options },
      };
    });

    // CRITICAL FIX: Sync user message to sessionStore IMMEDIATELY after adding to local state
    // This prevents duplicate messages. AgentService.sendMessage() checks sessionStore for
    // existing messages with the same content (content-based deduplication). Without this sync,
    // there's a race condition where AgentService doesn't see the optimistic message and adds
    // another user message with a different ID, resulting in duplicates.
    sessionStore.addMessage(session.id, userMessage);

    // Dispatch event so UI components can show running state immediately
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent(`agent:message-sent:${session.id}`, {
          detail: { agentId: session.id },
        }),
      );
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
      await agentService.sendMessage(session.id, message, workspace, {
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
        // Agent was interrupted (user pressed stop) - don't remove the user message
        // The message was sent and there may be partial response, just clear streaming state
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
        // Real error - remove optimistic message
        this.state.update((s) => ({
          ...s,
          messages: s.messages.filter((m) => m.id !== userMessage.id),
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
      agentService.saveSession(sessionId, workspace.id).catch((err) => {
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
    const imageContextItems: ContextItem[] = [];
    if (lastUserMessage.contentBlocks && Array.isArray(lastUserMessage.contentBlocks)) {
      for (const block of lastUserMessage.contentBlocks) {
        if (block.type === 'image' && block.data && block.mimeType) {
          imageContextItems.push({
            id: `regen-image-${imageContextItems.length}`,
            type: 'file',
            label: `Image ${imageContextItems.length + 1}`,
            imageData: block.data,
            imageMimeType: block.mimeType,
          });
        }
      }
    }

    const hasAttachments = imageContextItems.length > 0;

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
      agentService.saveSession(sessionId, workspace.id).catch((err) => {
        logger.warn('Failed to persist truncated messages after regenerate', {
          sessionId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    // Resend the user message with resetHistory flag to clear ACP session history
    // Include original image blocks as context items so they are preserved
    const regenerateOptions: SendMessageOptions = { ...options, resetHistory: true };
    if (imageContextItems.length > 0) {
      regenerateOptions.contextItems = [
        ...(regenerateOptions.contextItems || []),
        ...imageContextItems,
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
    const imageContextItems: ContextItem[] = [];
    if (userMessage.contentBlocks && Array.isArray(userMessage.contentBlocks)) {
      for (const block of userMessage.contentBlocks) {
        if (block.type === 'image' && block.data && block.mimeType) {
          imageContextItems.push({
            id: `regen-image-${imageContextItems.length}`,
            type: 'file',
            label: `Image ${imageContextItems.length + 1}`,
            imageData: block.data,
            imageMimeType: block.mimeType,
          });
        }
      }
    }

    const hasAttachments = imageContextItems.length > 0;

    if (!userText.trim() && !hasAttachments) {
      throw new Error('Could not extract text from user message');
    }

    logger.info('Regenerating from specific message', {
      assistantMessageId,
      userMessageIndex,
      totalMessages: messages.length,
      messagesAfterTruncation: messagesBeforeRegenerate.length,
      hasImageBlocks: hasAttachments,
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
      agentService.saveSession(sessionId, workspace.id).catch((err) => {
        logger.warn('Failed to persist truncated messages after regenerate from message', {
          sessionId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    // Resend the user message with resetHistory flag to clear ACP session history
    // Include original image blocks as context items so they are preserved
    const regenerateOptions: SendMessageOptions = { ...options, resetHistory: true };
    if (imageContextItems.length > 0) {
      regenerateOptions.contextItems = [
        ...(regenerateOptions.contextItems || []),
        ...imageContextItems,
      ];
    }
    await this.sendMessage(userText, workspace, regenerateOptions);
  }

  /**
   * Retry the last failed message.
   * This clears the error and resends the stored message.
   */
  async retryLastMessage(workspace: Workspace): Promise<void> {
    const currentState = get(this.state);

    if (!currentState.lastAttemptedMessage) {
      logger.warn('No message to retry');
      return;
    }

    if (!currentState.session) {
      throw new Error('No active chat session');
    }

    // Prevent retry while already streaming/processing
    if (currentState.isStreaming || currentState.isProcessing) {
      logger.warn('Cannot retry while streaming/processing');
      return;
    }

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
  }

  /**
   * Retry the last message with a different model.
   * Used when the original model was unavailable.
   */
  async retryWithModel(workspace: Workspace, model: string): Promise<void> {
    const currentState = get(this.state);

    if (!currentState.lastAttemptedMessage) {
      logger.warn('No message to retry with new model');
      return;
    }

    if (!currentState.session) {
      throw new Error('No active chat session');
    }

    // Prevent retry while already streaming/processing
    if (currentState.isStreaming || currentState.isProcessing) {
      logger.warn('Cannot retry while streaming/processing');
      return;
    }

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
    logger.debug('[ChatService] setupStreaming called', {
      sessionId,
      eventName: `agent:stream:${sessionId}`,
    });

    // Clean up any existing handler
    this.cleanupStream(sessionId);

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

    // Also listen for session-updated events to sync after agent-factory updates
    // This is especially important for queued messages that start streaming from the backend
    const sessionUpdatedHandler = () => {
      logger.debug('[ChatService] sessionUpdatedHandler called', { sessionId });
      const session = sessionStore.getSession(sessionId);
      if (session && session.messages) {
        const currentState = get(this.state);
        const newIsStreaming = session.isStreaming ?? currentState.isStreaming;

        // CRITICAL FIX: Don't overwrite ChatService messages with stale data during active streaming.
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

          // Don't overwrite with fewer content blocks on the last message during streaming
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

        // CRITICAL FIX: If streaming and the session has messages with content,
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

        this.state.update((s) => {
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
            isStreaming: newIsStreaming,
            isProcessing: newIsStreaming,
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
      sessionStore.setStreaming(sessionId, true);
      const session = sessionStore.getSession(sessionId);
      if (session) {
        sessionStore.addSession({
          ...session,
          isStreaming: true,
        });
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

      // Get messages from sessionStore (source of truth)
      const session = sessionStore.getSession(sessionId);
      const existingMessages = session?.messages ?? [];
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
      this.state.update((s) => ({
        ...s,
        messages: updatedMessages,
        isStreaming: true,
        streamingContent: hasNewToolUse ? '' : s.streamingContent,
      }));
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
      const existingMessages = session?.messages ?? [];
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
      if (session) {
        sessionStore.addSession({
          ...session,
          messages: updatedMessages,
          isStreaming: false,
        });

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
      this.state.update((s) => ({
        ...s,
        messages: updatedMessages,
        isStreaming: false,
        isProcessing: false,
        streamingContent: '',
        streamingStartTime: null,
        lastAttemptedMessage: null,
      }));
    } else if (data.type === 'error') {
      // Stop stall detection on error
      this.stopStallDetection();
      // Stop state reconciliation on error
      this.stopStateReconciliation();

      // Reset local accumulator on error to prevent stale data in next stream
      this.localStreamingContent = '';
      this.pendingStreamingContent = null;

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
   * Clean up stream handlers
   */
  private cleanupStream(sessionId: string): void {
    const handler = this.streamHandlers.get(sessionId);
    if (handler) {
      // Clean up DOM event listener (we only listen to DOM events now)
      window.removeEventListener(`agent:stream:${sessionId}`, handler);

      // FIX: Unregister DOM handler with agentService so it knows we no longer have a listener
      // This enables proper event queuing for future events that arrive after cleanup
      agentService.unregisterDomHandler(sessionId);

      // FIX: Clear any pending events since the stream has completed/cleaned up
      // This prevents stale events from being replayed on a future stream
      agentService.clearPendingEvents(sessionId);

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

    // Reset per-instance accumulator
    this.localStreamingContent = '';
    this.pendingStreamingContent = null;
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
   * Update messages directly (for optimistic updates, etc.)
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
    const clonedMessages: AgentMessage[] = JSON.parse(JSON.stringify(messagesToFork));

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
      await persistenceService.saveSession(forkedSessionWithHistory, forkedSession.workspaceId);

      if (parentSession) {
        const updatedParentSession: AgentSession = {
          ...parentSession,
          childSessionIds: [...(parentSession.childSessionIds || []), forkedSession.id],
        };
        await persistenceService.saveSession(updatedParentSession, sourceSession.workspaceId);
      }
    } catch (err) {
      logger.warn('Failed to persist forked session', { error: err });
    }

    logger.info('Session forked successfully', {
      parentSessionId: sourceSession.id,
      forkedSessionId: forkedSession.id,
      messageCount: clonedMessages.length,
    });

    // Switch to the forked session if requested (default: true)
    if (options?.switchToForked !== false) {
      await this.initializeChat(workspace, forkedSession.id, {
        agentName: forkName,
        agentModel: options?.model || sourceSession.model,
      });
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