/**
 * Agent Stream Lifecycle
 *
 * Module-level functions for stream handler registration, event dispatch,
 * reconnection, and the sendMessage pipeline.
 *
 * Extracted from RefactoredAgentService class to enable deletion of agent.service.ts.
 * All `this` references have been replaced by module-level state or imported functions.
 */

import flatstr from 'flatstr';
import { v4 as uuidv4 } from 'uuid';
import { createMessageId } from '$shared/types/branded-ids';
import { backendRequest } from '$lib/client/live/backend-transport';
import { createLogger } from '$lib/utils/client-logger';
import type { Workspace, ContentBlock, AgentMessage, AgentSession, QueuedMessage } from '$shared/types';
import { AgentStatus } from '$shared/types';
import {
  buildOrderedContentBlocks,
  type StreamOrderedItem,
} from '$shared/utils/content-block-utils';
import { createAppMessageId } from '$shared/utils/app-message-id';
import { AgentActivationState } from '$shared/types/agent-session';
import { performanceOptimizer } from '$features/agent/services/performance-optimizer';
import { errorBoundary } from './browser';
import {
  activateAgentRequested,
  saveAgentSessionRequested,
  agentStreamResetStreamingMessagesRequested,
  agentStreamUpdateReceived,
  restoreAgentSessionRequested,
} from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import {
  addMessage as addAgentSessionMessage,
  removeMessage,
  setAgentStreaming,
  upsertSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { streamStatusReceived } from '$store/renderer/slices/chat-state/chat-state-slice';
import type { StatusEvent } from '$store/renderer/slices/chat-state/chat-state-types';
import {
  errorRecovery,
  DEFAULT_STRATEGIES,
} from './browser/services/error-recovery.service';
import { IN_FLIGHT_PROMPT_DROPPED_ERROR } from '$shared/constants/agent-streaming';
import { assertStreamingInvariant } from './utils/streaming-invariants';
import { replaceAgentQueue } from '$store/renderer/slices/agent-queue/agent-queue-slice';
import { selectAgentQueueMessages } from '$store/renderer/slices/agent-queue/agent-queue-selectors';

import * as streamRegistry from './utils/stream-handler-registry';
import { workspaceMetrics } from '$store/renderer/slices/workspace/utils/workspace-metrics';
import { store as appStore } from '$store/renderer/store';

const logger = createLogger('AgentStreamLifecycle');

type ReduxAction = { type: string; payload?: unknown };

type ScheduledFrame =
  | { type: 'raf'; id: number }
  | { type: 'timeout'; id: ReturnType<typeof setTimeout> };

type StreamStatusData = {
  phase: string;
  message: string;
  level?: StatusEvent['level'];
  timestamp?: number;
};

function dispatchRedux(action: ReduxAction): void {
  appStore.dispatch(action as any);
}

function scheduleNextFrame(callback: () => void): ScheduledFrame {
  const requestFrame =
    typeof globalThis.requestAnimationFrame === 'function'
      ? globalThis.requestAnimationFrame.bind(globalThis)
      : typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame.bind(window)
        : undefined;

  if (requestFrame) {
    return { type: 'raf', id: requestFrame(() => callback()) };
  }

  return { type: 'timeout', id: setTimeout(callback, 0) };
}

function cancelScheduledFrame(frame: ScheduledFrame): void {
  if (frame.type === 'raf') {
    const cancelFrame =
      typeof globalThis.cancelAnimationFrame === 'function'
        ? globalThis.cancelAnimationFrame.bind(globalThis)
        : typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function'
          ? window.cancelAnimationFrame.bind(window)
          : undefined;

    cancelFrame?.(frame.id);
    return;
  }

  clearTimeout(frame.id);
}

function createChunkUpdateCoalescer(emitChunkUpdate: (data: StreamHandlerData) => void): {
  schedule: (data: StreamHandlerData) => void;
  flush: () => void;
  cancel: () => void;
} {
  let pendingFrame: ScheduledFrame | undefined;
  let pendingChunkText = '';
  let latestChunkData: StreamHandlerData | undefined;

  const flush = () => {
    if (pendingFrame) {
      cancelScheduledFrame(pendingFrame);
      pendingFrame = undefined;
    }
    if (!latestChunkData) return;

    const data = { ...latestChunkData, data: pendingChunkText };
    pendingChunkText = '';
    latestChunkData = undefined;
    emitChunkUpdate(data);
  };

  const cancel = () => {
    if (pendingFrame) {
      cancelScheduledFrame(pendingFrame);
      pendingFrame = undefined;
    }
    pendingChunkText = '';
    latestChunkData = undefined;
  };

  return {
    schedule(data) {
      pendingChunkText += data.data || '';
      latestChunkData = data;
      if (!pendingFrame) {
        pendingFrame = scheduleNextFrame(flush);
      }
    },
    flush,
    cancel,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInFlightPromptDedupResponse(response: unknown): boolean {
  const candidate =
    isRecord(response) && response.success === true && 'data' in response ? response.data : response;

  if (!isRecord(candidate) || candidate.success !== false) {
    return false;
  }

  return (
    typeof candidate.error === 'string' &&
    candidate.error.includes(IN_FLIGHT_PROMPT_DROPPED_ERROR)
  );
}

function getStreamStatusData(value: unknown): StreamStatusData | undefined {
  if (!isRecord(value) || typeof value.phase !== 'string' || typeof value.message !== 'string') {
    return undefined;
  }
  return value as StreamStatusData;
}

function dispatchStreamStatusEvent(params: {
  workspaceId?: string;
  agentId: string;
  sessionId: string;
  source: 'restored' | 'sendMessage';
  data: unknown;
}): void {
  const { workspaceId, agentId, sessionId, source, data } = params;
  assertStreamingInvariant(
    !!sessionId && sessionId.length > 0,
    'dispatchStreamStatusEvent called with empty sessionId',
    { agentId, source },
  );

  const statusData = getStreamStatusData(data);
  if (statusData) {
    const resetFirstChunk = statusData.phase === 'tool-call' || statusData.phase === 'tool-waiting';
    dispatchRedux(streamStatusReceived(agentId, statusData, resetFirstChunk, { sessionId }));
  }

  logger.debug('Dispatched stream status Redux event', {
    sessionId,
    agentId,
    source,
    workspaceId,
    hasStatusData: !!statusData,
  });
}

// ---------------------------------------------------------------------------
// Module-level state (non-serializable, NOT in Redux)
// ---------------------------------------------------------------------------

// Persist stream handler references for HMR
streamRegistry.persistForHmr();

// ---------------------------------------------------------------------------
// Stream handler delegation to registry
// ---------------------------------------------------------------------------

export function isSendMessageSettingUpStream(agentId: string): boolean {
  return streamRegistry.isSendMessageSettingUpStream(agentId);
}

export function hasActiveStreamHandler(agentId: string): boolean {
  return streamRegistry.hasStreamHandler(agentId);
}

export function clearPendingStreamRegistration(agentId: string): void {
  streamRegistry.deletePendingRegistration(agentId);
}

// ---------------------------------------------------------------------------
// ensureStreamHandler
// ---------------------------------------------------------------------------

interface EnsureStreamHandlerOpts {
  existingMessage?: AgentMessage;
  workspaceId?: string;
  forceReregister?: boolean;
  assistantAppMessageId?: string;
}

export function ensureStreamHandler(
  agentId: string,
  opts?: EnsureStreamHandlerOpts,
): { created: boolean; channel: string } {
  const {
    existingMessage,
    workspaceId: providedWorkspaceId,
    forceReregister,
    assistantAppMessageId,
  } = opts || {};

  if (!agentId) {
    logger.warn('Attempted to ensure stream handler with undefined agentId, ignoring');
    return { created: false, channel: '' };
  }

  const streamChannel = `agent:stream:${agentId}`;

  if (streamRegistry.hasStreamHandler(agentId) && !forceReregister) {
    logger.debug('Stream handler already exists for agent', { agentId, streamChannel });
    return { created: false, channel: streamChannel };
  }

  if (forceReregister && streamRegistry.hasStreamHandler(agentId)) {
    logger.info('Force-reregistering stream handler, cleaning up old handler first', { agentId });
    streamRegistry.cleanupStreamHandler(agentId);
  }

  const resolvedWorkspaceId = providedWorkspaceId;

  registerStreamHandlerForSession(
    agentId,
    existingMessage,
    resolvedWorkspaceId,
    assistantAppMessageId,
  );

  return { created: true, channel: streamChannel };
}

/**
 * Data shape received by IPC stream handlers.
 *
 * The `data` field is polymorphic — its concrete shape depends on
 * `type` (chunk → string, content-blocks → ContentBlock[], etc.).
 * We use a loose union here because the handler checks `type` at
 * runtime before accessing type-specific fields.
 */
interface StreamHandlerData {
  type: 'chunk' | 'content-blocks' | 'complete' | 'error' | 'status';

  data?: any;
  streamId?: string;
  sessionId?: string;
  assistantAppMessageId?: string;
  finishReason?: string;
  message?: Partial<AgentMessage> & {
    contentBlocks?: ContentBlock[];
    metadata?: Record<string, unknown>;
  };
  metadata?: Record<string, unknown>;
  error?: string | Error;
}

function getAssistantAppMessageIdFromStreamData(data: StreamHandlerData): string | undefined {
  if (typeof data.assistantAppMessageId === 'string') return data.assistantAppMessageId;
  if (typeof data.metadata?.assistantAppMessageId === 'string') {
    return data.metadata.assistantAppMessageId;
  }
  if (typeof data.message?.appMessageId === 'string') return data.message.appMessageId;
  if (
    data.data &&
    typeof data.data === 'object' &&
    typeof data.data.assistantAppMessageId === 'string'
  ) {
    return data.data.assistantAppMessageId;
  }
  if (data.data && typeof data.data === 'object' && typeof data.data.appMessageId === 'string') {
    return data.data.appMessageId;
  }
  return undefined;
}

function getStreamErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (isRecord(error) && typeof error.message === 'string') return error.message;
  return undefined;
}

// ---------------------------------------------------------------------------
// registerPingHandler
// ---------------------------------------------------------------------------

/**
 * Register the IPC heartbeat ping handler for an agent: responds with a pong
 * so the main process can verify renderer IPC liveness during active streams.
 *
 * Must be registered alongside EVERY stream handler registration. Backend-initiated
 * streams (delegated agents, queued messages) register their stream handler via
 * ensureStreamHandler/registerStreamHandlerForSession — previously only the
 * sendMessage flow registered a ping handler, so delegated agents never ponged
 * and the main process logged "missed pong" for their entire turn.
 *
 * Idempotent: skips registration when a ping handler already exists for the
 * agent (setPingHandler would otherwise overwrite the entry and leak the old
 * IPC listener). cleanupStreamHandler removes the stream and ping handlers
 * together, so they cannot drift apart.
 */
function registerPingHandler(agentId: string): void {
  if (streamRegistry.getPingHandler(agentId)) {
    return;
  }
  const pingChannel = `agent:stream:ping:${agentId}`;
  const pingHandler = (data: { agentId: string; timestamp: number }) => {
    logger.debug('IPC heartbeat: received ping, sending pong', {
      agentId,
      timestamp: data.timestamp,
    });
    window.electronAPI.send('agent:stream:pong', { agentId });
  };
  const pingListenerId = window.electronAPI.on(pingChannel, pingHandler);
  streamRegistry.setPingHandler(agentId, {
    channel: pingChannel,
    handler: pingHandler,
    listenerId: pingListenerId,
  });
}

// ---------------------------------------------------------------------------
// registerStreamHandlerForSession
// ---------------------------------------------------------------------------

function registerStreamHandlerForSession(
  agentId: string,
  existingMessage?: AgentMessage,
  workspaceId?: string,
  assistantAppMessageId?: string,
): void {
  if (!agentId) {
    logger.warn('Attempted to register stream handler with undefined agentId, ignoring');
    return;
  }

  const resolvedWorkspaceId = workspaceId;
  const streamChannel = `agent:stream:${agentId}`;

  logger.debug('Registering stream handler for restored session', {
    agentId,
    streamChannel,
    hasExistingMessage: !!existingMessage,
    existingContentBlocksCount: existingMessage?.contentBlocks?.length || 0,
    providedWorkspaceId: workspaceId,
    resolvedWorkspaceId,
  });

  if (streamRegistry.hasStreamHandler(agentId)) {
    logger.debug('Stream handler already exists for agent', { agentId });
    return;
  }

  if (streamRegistry.hasPendingRegistration(agentId)) {
    logger.debug('Stream handler registration already in progress for agent', { agentId });
    return;
  }

  streamRegistry.addPendingRegistration(agentId);

  if (!window.electronAPI) {
    logger.error('window.electronAPI is not available for stream handler registration', {
      agentId,
    });
    streamRegistry.deletePendingRegistration(agentId);
    return;
  }

  logger.debug('Registering new stream handler (no existing handler in Map)', {
    agentId,
    streamChannel,
  });

  // Initialize state from existing message
  let textBuffer = '';
  let orderedItems: StreamOrderedItem[] = [];

  if (existingMessage?.contentBlocks) {
    for (const block of existingMessage.contentBlocks) {
      if (block.type === 'text') {
        orderedItems.push({
          type: 'text',
          content: block.text || '',
          sequence: orderedItems.length,
        });
      } else {
        orderedItems.push({ type: 'block', content: block, sequence: orderedItems.length });
      }
    }
  }

  // Only reuse the existing message's ID when it is actively streaming AND has
  // a canonical backend `msg_` prefix. Reusing a non-streaming (finalized)
  // message's ID would collide with its finalized entry during session dedup,
  // and reusing a legacy non-`msg_` ID would persist a stale format that the
  // backend will never produce for new messages.
  //
  // NOTE: this is a snapshot taken at handler-registration time. Sagas re-check
  // current Redux state before deciding whether this can be reused.
  const reusableExistingMessageId =
    existingMessage?.isStreaming &&
    typeof existingMessage.id === 'string' &&
    existingMessage.id.startsWith('msg_')
      ? existingMessage.id
      : undefined;
  // Only reuse the existing app message ID when the existing message is still a
  // valid streaming target. A finalized previous assistant message can share the
  // handler registration path but must not become this stream's canonical target.
  let streamAppMessageId =
    assistantAppMessageId ??
    (existingMessage?.isStreaming && existingMessage.appMessageId
      ? existingMessage.appMessageId
      : undefined) ??
    createAppMessageId();

  let chunkCount = 0;
  let currentStreamId: string | undefined = undefined;
  const handlerSessionId = agentId;

  const emitStreamUpdate = (
    eventType: 'chunk' | 'content-blocks' | 'complete' | 'error',
    data: StreamHandlerData,
  ) => {
    dispatchRedux(
      agentStreamUpdateReceived({
        workspaceId: resolvedWorkspaceId,
        agentId,
        handlerSessionId,
        source: 'restored',
        eventType,
        assistantMessageId: reusableExistingMessageId,
        assistantAppMessageId: streamAppMessageId,
        contentBlocks: buildOrderedContentBlocks(orderedItems, flatstr(textBuffer)),
        rawContentBlocks: Array.isArray(data.data) ? data.data : undefined,
        chunk: eventType === 'chunk' ? data.data : undefined,
        completeMessage: data.message || data.data,
        finishReason: data.finishReason,
        error: eventType === 'error' ? getStreamErrorMessage(data.error ?? data.data) : undefined,
        streamId: data.streamId,
      }),
    );
  };
  const chunkUpdateCoalescer = createChunkUpdateCoalescer((data) =>
    emitStreamUpdate('chunk', data),
  );

  const streamHandler = (data: StreamHandlerData) => {
    chunkCount++;
    if (chunkCount === 1) {
      logger.info('Restored stream handler - first chunk received', {
        callNumber: chunkCount,
        dataType: data?.type,
        agentId,
        dataLength: data?.data?.length,
        workspaceId: resolvedWorkspaceId,
      });
    }

    const backendAssistantAppMessageId = getAssistantAppMessageIdFromStreamData(data);

    // Detect new stream ID and reset state
    if (data.streamId && data.streamId !== currentStreamId) {
      if (currentStreamId !== undefined) {
        chunkUpdateCoalescer.flush();
        logger.info('Stream ID changed - resetting accumulated state', {
          agentId,
          oldStreamId: currentStreamId,
          newStreamId: data.streamId,
        });
        textBuffer = '';
        orderedItems = [];
        streamAppMessageId = backendAssistantAppMessageId ?? createAppMessageId();
        chunkCount = 1;
        dispatchRedux(
          agentStreamResetStreamingMessagesRequested({
            workspaceId: resolvedWorkspaceId,
            agentId,
            reason: 'restored_stream_id_changed',
          }),
        );
      }
      currentStreamId = data.streamId;
    }
    if (backendAssistantAppMessageId) {
      streamAppMessageId = backendAssistantAppMessageId;
    }
    try {
      if (data.type === 'chunk') {
        textBuffer += data.data || '';
        chunkUpdateCoalescer.schedule(data);
      } else if (data.type === 'content-blocks' && Array.isArray(data.data)) {
        chunkUpdateCoalescer.flush();
        if (textBuffer) {
          orderedItems.push({ type: 'text', content: textBuffer, sequence: orderedItems.length });
          textBuffer = '';
        }

        for (const newBlock of data.data) {
          if (newBlock.type === 'tool_use') {
            const existing = orderedItems.find(
              (item) =>
                item.type === 'block' &&
                (item.content as ContentBlock).type === 'tool_use' &&
                (item.content as ContentBlock).id === newBlock.id,
            );
            if (!existing) {
              orderedItems.push({
                type: 'block',
                content: newBlock,
                sequence: orderedItems.length,
              });
            } else {
              existing.content = newBlock;
            }
          } else if (newBlock.type === 'tool_result') {
            const existing = orderedItems.find(
              (item) =>
                item.type === 'block' &&
                (item.content as ContentBlock).type === 'tool_result' &&
                (item.content as ContentBlock).tool_use_id === newBlock.tool_use_id,
            );
            if (!existing) {
              orderedItems.push({
                type: 'block',
                content: newBlock,
                sequence: orderedItems.length,
              });
            }
          } else if (newBlock.type === 'text') {
            logger.warn('Received unexpected text block in content-blocks event - ignoring');
          } else {
            orderedItems.push({ type: 'block', content: newBlock, sequence: orderedItems.length });
          }
        }

        emitStreamUpdate('content-blocks', data);
      } else if (data.type === 'complete') {
        chunkUpdateCoalescer.flush();
        if (textBuffer) {
          orderedItems.push({ type: 'text', content: textBuffer, sequence: orderedItems.length });
          textBuffer = '';
        }

        emitStreamUpdate('complete', data);

        // Reset accumulated state after stream completion so that if this
        // handler is reused for a subsequent stream (e.g., wake-up after
        // delegation), old content does not leak into the new response.
        textBuffer = '';
        orderedItems = [];
      } else if (data.type === 'status') {
        dispatchStreamStatusEvent({
          workspaceId: resolvedWorkspaceId,
          agentId,
          sessionId: handlerSessionId,
          source: 'restored',
          data: data.data,
        });
      } else if (data.type === 'error') {
        logger.error('Stream error from restored handler', { agentId, error: data.data });
        chunkUpdateCoalescer.flush();
        emitStreamUpdate('error', data);
        streamRegistry.cleanupStreamHandler(agentId);
      }
    } catch (error) {
      logger.error('Error in restored streamHandler', { error, dataType: data?.type, agentId });
    }
  };

  const streamListenerId = window.electronAPI.on(streamChannel, streamHandler);
  const wrappedHandler = (streamHandler as any).__ipcWrapper;

  streamRegistry.setStreamHandler(agentId, {
    channel: streamChannel,
    handler: streamHandler,
    wrappedHandler: wrappedHandler || undefined,
    workspaceId: resolvedWorkspaceId ? String(resolvedWorkspaceId) : undefined,
    listenerId: streamListenerId,
    registeredAt: Date.now(),
    cleanup: chunkUpdateCoalescer.cancel,
  });

  // Register the IPC heartbeat ping handler so backend-initiated streams
  // (delegated agents, queued messages) respond to pings — without this the
  // main process logs "missed pong" for their entire turn.
  registerPingHandler(agentId);

  streamRegistry.deletePendingRegistration(agentId);

  logger.info('Stream handler registered for restored session', {
    agentId,
    streamChannel,
    hasExistingMessage: !!existingMessage,
  });
}

// ---------------------------------------------------------------------------
// sendMessage
// ---------------------------------------------------------------------------

export async function sendMessage(
  agentId: string,
  content: string,
  workspace: Workspace,
  options: {
    contextReferences?: Array<{
      type: string;
      filePath?: string;
      noteId?: string;
      selectedText?: string;
      [key: string]: unknown;
    }>;
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
    /**
     * Pre-generated logical app message ID for the user message. The send path
     * stages an optimistic user message with this ID so the canonical message
     * dispatched here merges with it via appMessageId dedup.
     */
    userAppMessageId?: string;
    /**
     * Message priority for interrupt semantics. When "interrupt", preempts an
     * in-flight turn (PROTOCOL.md §5.5: cancels the turn keep-alive and delivers
     * immediately instead of queueing). Used by force-send (⌘Enter).
     */
    priority?: 'interrupt';
  } = {},
): Promise<void> {
  // Wrap entire sendMessage operation with performance tracking
  return performanceOptimizer.track(
    `sendMessage:${agentId}`,
    async () => {
      logger.debug(`Sending message to agent ${agentId}`, {
        contentLength: content.length,
        hasContextReferences: !!options.contextReferences?.length,
        model: options.model,
      });

      // --- Session load/activate (runs once, outside retry boundary) ---
      const restoreAction = restoreAgentSessionRequested(workspace.id, agentId);
      dispatchRedux(restoreAction);
      let session = await restoreAction.promise;
      if (!session) {
        throw new Error(`Session not found: ${agentId}`);
      }
      session = { ...session, isStreaming: session.isStreaming ?? false };

      {
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
            const activateAction = activateAgentRequested(workspace.id, agentId);
            dispatchRedux(activateAction);
            const activatedSession = await activateAction.promise;
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
            throw new Error('Space not ready for agent activation. Please wait for space to load.');
          }
        } else if (session && session.status === 'pending' && session.backendSessionId) {
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
          dispatchRedux(
            upsertSession({
              ...session,
              workspaceId: workspace.id as AgentSession['workspaceId'],
            }),
          );
        }

        if (!session) {
          throw new Error(`Failed to get or create session for agent ${agentId}`);
        }

        // Add to store after validation
        dispatchRedux(
          upsertSession({
            ...session,
            workspaceId: workspace.id as AgentSession['workspaceId'],
          }),
        );

        // --- User message dispatch (runs once, outside retry boundary) ---
        // This ensures user message appears exactly once regardless of retries.
        const userContentBlocks: ContentBlock[] = [{ type: 'text' as const, text: content }];
        if (options.imageBlocks) {
          for (const img of options.imageBlocks) {
            userContentBlocks.push({
              type: 'image' as const,
              data: img.data,
              mimeType: img.mimeType,
            });
          }
        }
        if (options.fileBlocks) {
          for (const file of options.fileBlocks) {
            userContentBlocks.push({
              type: 'file' as const,
              data: file.data,
              mimeType: file.mimeType,
              fileName: file.fileName,
            });
          }
        }
        const userAppMessageId = options.userAppMessageId ?? createAppMessageId();
        const userMessage: AgentMessage = {
          id: createMessageId(uuidv4()),
          appMessageId: userAppMessageId,
          role: 'user',
          contentBlocks: userContentBlocks,
          timestamp: new Date().toISOString(),
          metadata: options.contextReferences?.length
            ? { contextReferences: options.contextReferences }
            : {},
        };

        dispatchRedux(addAgentSessionMessage(session.id, userMessage));
        dispatchRedux(setAgentStreaming(session.id, true));

        try {
          // Save the session immediately after adding the user message
          // This ensures the message persists even if the app crashes or refreshes
          // For edit/regenerate flows (resetHistory), allow truncation since messages
          // were intentionally removed before this save
          const saveAction = saveAgentSessionRequested(workspace.id, agentId, true, {
            allowTruncation: options.resetHistory,
          });
          dispatchRedux(saveAction);
          await saveAction.promise;

          // Pre-assign the assistant message ID BEFORE the retry boundary
          // so that retries reuse the same ID instead of minting a new one.
          // This keeps the renderer's placeholder message and the backend in sync.
          const assistantMessageId = createMessageId(`msg_${uuidv4()}`);
          const assistantAppMessageId = createAppMessageId();

          // --- Retry boundary: only wraps stream setup + backend send ---
          const result = await errorRecovery.executeWithRecovery(
            async () =>
              errorBoundary.wrap(
                async () => {
                  dispatchRedux(
                    agentStreamResetStreamingMessagesRequested({
                      workspaceId: workspace.id,
                      agentId,
                      reason: 'sendMessage_new_stream',
                    }),
                  );

                  dispatchRedux(
                    agentStreamUpdateReceived({
                      workspaceId: workspace.id,
                      agentId,
                      handlerSessionId: session.id,
                      source: 'sendMessage',
                      eventType: 'started',
                      assistantMessageId,
                      assistantAppMessageId,
                      contentBlocks: [{ type: 'text' as const, text: '' }],
                      createInitialPlaceholder: true,
                    }),
                  );

                  // Streaming and terminal state for this turn arrive via the
                  // daemon events bridge (events.subscribe → agent:stream:* /
                  // agent:idle, PROTOCOL §7), which dispatches straight into
                  // Redux — no per-agent stream listener is registered here.
                  //
                  // NOTE: The frontend no longer imposes a wall-clock timeout on the
                  // stream. The daemon (intentd) owns turn lifetime and will emit a
                  // terminal event (complete with finishReason, or error) when the
                  // turn ends. Informational stall detection (chat-state stall saga)
                  // remains and continues to surface UI warnings without terminating
                  // the stream.

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
                    },
                  );

                  const wireModel = (options.model ?? options.modelId ?? session.model) ?? undefined;
                  // PROTOCOL.md §5.5 `agent.sendMessage` — one direct daemon call over
                  // the BackendTransport seam. History is daemon-owned (loaded from
                  // persistence); legacy-only fields (messages, resetHistory,
                  // behaviorPrompt, specialist, personality) are no longer sent —
                  // edit/regenerate flows go through `agent.editAndRegenerate`.
                  const response = await backendRequest<Record<string, unknown>>(
                    'agent.sendMessage',
                    {
                      agentId,
                      workspaceId: workspace.id,
                      content,
                      model: wireModel,
                      contextReferences: options.contextReferences,
                      imageBlocks: options.imageBlocks,
                      fileBlocks: options.fileBlocks,
                      noteIds: options.noteIds,
                      stdinContext: options.stdinContext,
                      // Pre-assigned assistant message ID so backend uses the same ID as the renderer
                      assistantMessageId,
                      userAppMessageId,
                      assistantAppMessageId,
                      // Message priority for force-send interrupt (PROTOCOL.md §5.5)
                      priority: options.priority,
                    },
                  );

                  if (isInFlightPromptDedupResponse(response)) {
                    logger.info('Backend dropped duplicate in-flight prompt', {
                      agentId,
                      sessionId: session.id,
                    });
                    return;
                  }

                  // Raw daemon envelope (PROTOCOL.md §5.5): { success, queued, messageId? }
                  if (response && typeof response === 'object' && 'success' in response) {
                    if (!response.success) {
                      // The daemon surfaces errors as a plain string; legacy
                      // IpcResponse envelopes use { message }.
                      const rawError = (response as { error?: unknown }).error;
                      const errorMessage =
                        typeof rawError === 'string'
                          ? rawError
                          : (rawError as { message?: string } | undefined)?.message;
                      throw new Error(errorMessage || 'Failed to send message to backend');
                    }

                    // Handle queued responses (agent mid-turn, or the auto-queue race
                    // when priority: "interrupt" arrives during turn startup). The
                    // daemon returns { success: true, queued: true, messageId? }
                    // instead of preempting. Clear the optimistic placeholder and
                    // streaming flag so the UI doesn't stay in "Thinking", and seed
                    // the local queue when the daemon echoes the queued entry
                    // (agent:queue:updated reconciles either way).
                    if ('queued' in response && response.queued === true) {
                      logger.info('sendMessage auto-queued by daemon (mid-turn or turn-startup race)', {
                        agentId,
                        sessionId: session.id,
                        queuedMessageId: (response.queuedMessage as QueuedMessage | undefined)?.id,
                      });

                      // Remove the optimistic streaming placeholder so no stale
                      // assistant message remains in the transcript. The
                      // placeholder was added by the stream middleware under the
                      // pre-assigned assistantMessageId on the 'started' event.
                      dispatchRedux(removeMessage(agentId, assistantMessageId));

                      // Reset streaming flag so UI doesn't stay in "Thinking"
                      dispatchRedux(setAgentStreaming(session.id, false));

                      // Seed the local queue from queuedMessage (like chat-send-service
                      // queue-on-send path does) so the UI immediately shows queued state
                      const queuedMessage = response.queuedMessage as QueuedMessage | undefined;
                      if (queuedMessage) {
                        const existing = selectAgentQueueMessages.select(appStore.state, agentId);
                        const next = existing.some((m) => m.id === queuedMessage.id)
                          ? existing
                          : [...existing, queuedMessage];
                        dispatchRedux(replaceAgentQueue(agentId, next));
                      }

                      // Exit early — no stream is starting
                      return;
                    }
                  }
                  // NOTE: Do NOT dispatch error events for send failures here — a
                  // backendRequest error propagates to the retry boundary, and a
                  // per-attempt dispatch would flash isStreaming false→true→false
                  // on each retry. The error dispatch happens AFTER all retries are
                  // exhausted (see the !result.success block below).

                  // Track metrics
                  workspaceMetrics.incrementMessageSent(workspace.id);
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
            // Don't re-wrap - the error already has a clean user-facing message
            // from the error boundary service
            throw result.error || new Error('Something went wrong. Please try again.');
          }
        } catch (streamingError) {
          // If saveSession or any pre-retry-boundary code throws after
          // setAgentStreaming(true), reset the streaming flag so the UI
          // doesn't stay stuck on "Thinking…" until the safety detector fires.
          dispatchRedux(
            agentStreamUpdateReceived({
              workspaceId: workspace.id,
              agentId,
              handlerSessionId: session.id,
              source: 'sendMessage',
              eventType: 'error',
              finishReason: 'sendMessage_setup_error',
              error: getStreamErrorMessage(streamingError) || 'Something went wrong',
            }),
          );
          throw streamingError;
        }
      }
    },
    {
      memoize: false, // Don't memoize message sending
      coalesce: true, // Coalesce duplicate requests
      priority: 'high',
      // No timeout - let the agent take as long as it needs
    },
  );
}
