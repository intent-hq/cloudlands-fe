/**
 * Agent Stream Lifecycle
 *
 * Module-level functions for stream handler registration, event dispatch/queue,
 * reconnection, and the sendMessage pipeline.
 *
 * Extracted from RefactoredAgentService class to enable deletion of agent.service.ts.
 * All `this` references have been replaced by module-level state or imported functions.
 */

import { v4 as uuidv4 } from 'uuid';
import { createMessageId, WorkspaceId } from '$shared/types/branded-ids';
import { invoke } from '$lib/electron-bridge';
import { AGENT_BACKEND_CHANNELS } from '$shared/ipc/channels';
import { createLogger } from '$lib/utils/client-logger';
import type {
  Workspace,
  ContentBlock,
  AgentMessage,
  AgentSession,
} from '$shared/types';
import { AgentStatus, normalizeContentBlocks } from '$shared/types';
import { buildOrderedContentBlocks, type StreamOrderedItem } from '$shared/utils/content-block-utils';
import { createAppMessageId } from '$shared/utils/app-message-id';
import { AgentActivationState } from '$shared/types/agent-session';
import { performanceOptimizer } from '$features/agent/services/performance-optimizer';
import {
  agentIpcProxy,
  errorBoundary,
  persistenceService,
} from './browser';
import {
  upsertAgentSession,
  setAgentStreaming,
  addAgentMessage,
  updateAgentMessage,
  triggerStreamingSafetyCheck,
} from '$lib/store/slices/workspace-agents/workspace-agents-slice';
import {
  selectAgentById,
  selectAllWorkspaceAgents,
} from '$lib/store/slices/workspace-agents/workspace-agents-selectors';
import {
  selectActiveWorkspaceId,
} from '$lib/store/slices/workspace/workspace-selectors';
import { errorRecovery, DEFAULT_STRATEGIES } from './browser/services/error-recovery.service';
import { AGENT_STREAMING_CONFIG } from '$shared/constants/agent-streaming';
import { PendingEventQueue } from './utils/pending-event-queue';
import { pickPlaceholderId } from './utils/pick-placeholder-id';
import { assertStreamingInvariant } from './utils/streaming-invariants';

import { getReduxStore } from '$lib/store/redux-dispatch-bridge';
import { newAssistantMessage } from '$lib/store/slices/unread-tracking/unread-tracking-slice';
import * as streamRegistry from './utils/stream-handler-registry';
import { track } from '$lib/services/analytics';
import { logger as rendererLogger, LogCategory } from '$lib/logging/logger.svelte';
import {
  errorHandler,
  AgentError,
  ErrorCode,
  ErrorCategory,
  ErrorSeverity,
} from '$features/agent/services/error-handler';
import { eventCollector, AgentEventType } from '../observability/event-collector-client';
import { workspaceMetrics } from '$lib/store/slices/workspace/utils/workspace-metrics';

// Import bridge functions needed by sendMessage
import { resumeSession, saveSession } from './agent-ipc-bridge';

import {
  dispatchAgentStream,
  dispatchAgentSessionUpdated,
  type AgentStreamDetail,
} from '$lib/utils/window-events';

const logger = createLogger('AgentStreamLifecycle');

// ---------------------------------------------------------------------------
// Module-level state (non-serializable, NOT in Redux)
// ---------------------------------------------------------------------------

/** DOM event handlers registered by ChatService */
const registeredDomHandlers = new Set<string>();

/** Pending event queue for stream events */
const pendingEventQueue = new PendingEventQueue();

// Start periodic cleanup
pendingEventQueue.startPeriodicCleanup();

// Persist stream handler references for HMR
streamRegistry.persistForHmr();

// ---------------------------------------------------------------------------
// Per-agent analytics tracking state
// ---------------------------------------------------------------------------

interface AgentAnalyticsState {
  turnStartTime: number;
  prevToolCallCount: number;
}

const agentAnalyticsState = new Map<string, AgentAnalyticsState>();

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function getActiveWsId(): string | undefined {
  return selectActiveWorkspaceId.select(getReduxStore().getState()) as string | undefined;
}

function requireWorkspaceId(context: string): string {
  const wsId = getActiveWsId();
  if (!wsId) {
    throw new Error(`[AgentStreamLifecycle] workspaceId required but not available: ${context}`);
  }
  return wsId;
}

function getAgentSession(wsId: string, agentId: string): AgentSession | undefined {
  return selectAgentById.select(getReduxStore().getState(), agentId);
}

function getWorkspaceAgents(wsId: string): AgentSession[] {
  return selectAllWorkspaceAgents.select(getReduxStore().getState(), wsId);
}

function getAllSessionsAcrossWorkspaces(): AgentSession[] {
  const state = getReduxStore().getState();
  const result: AgentSession[] = [];
  for (const wsId of Object.keys(state.workspaceAgents.byWorkspaceId)) {
    const agents = selectAllWorkspaceAgents.select(state, wsId);
    result.push(...agents);
  }
  return result;
}

// ---------------------------------------------------------------------------
// DOM handler management
// ---------------------------------------------------------------------------

export function registerDomHandler(sessionId: string): void {
  registeredDomHandlers.add(sessionId);
  logger.debug('Registered DOM handler', { sessionId });
}

export function unregisterDomHandler(sessionId: string): void {
  registeredDomHandlers.delete(sessionId);
  logger.debug('Unregistered DOM handler', { sessionId });
}

function hasActiveStreamListener(sessionId: string): boolean {
  return registeredDomHandlers.has(sessionId);
}

// ---------------------------------------------------------------------------
// Pending event queue management
// ---------------------------------------------------------------------------

export function replayPendingEvents(sessionId: string): void {
  const preReplaySize = pendingEventQueue.getQueueSize(sessionId);
  const events = pendingEventQueue.replay(sessionId);
  if (events.length === 0) return;

  assertStreamingInvariant(
    events.length <= preReplaySize,
    'More events replayed than were in the queue',
    { sessionId, preReplaySize, replayedCount: events.length },
  );

  logger.info('Replaying pending stream events', { sessionId, eventCount: events.length });
  for (const pendingEvent of events) {
    dispatchAgentStream(sessionId, pendingEvent.detail as AgentStreamDetail);
  }
}

export function clearPendingEvents(sessionId: string): void {
  pendingEventQueue.clear(sessionId);
}

// ---------------------------------------------------------------------------
// Stream event dispatch with queuing
// ---------------------------------------------------------------------------

export function dispatchStreamEvent(sessionId: string, eventType: string, detail: Record<string, unknown>): void {
  assertStreamingInvariant(
    !!sessionId && sessionId.length > 0,
    'dispatchStreamEvent called with empty sessionId',
    { eventType },
  );

  const hasHandler = hasActiveStreamListener(sessionId);

  if (hasHandler) {
    dispatchAgentStream(sessionId, detail as AgentStreamDetail);
    logger.debug('Dispatched stream event to registered handler', { sessionId, eventType });
  } else {
    pendingEventQueue.queue(sessionId, eventType, detail);
    logger.info('Queued stream event (no handler registered)', { sessionId, eventType });
  }
}

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
  const { existingMessage, workspaceId: providedWorkspaceId, forceReregister, assistantAppMessageId } = opts || {};

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

  const resolvedWorkspaceId = providedWorkspaceId || getAgentSession(requireWorkspaceId('ensureStreamHandler:resolve'), agentId)?.workspaceId;

  registerStreamHandlerForSession(agentId, existingMessage, resolvedWorkspaceId, assistantAppMessageId);

  setTimeout(() => {
    dispatchAgentSessionUpdated(agentId);
  }, 100);

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
  finishReason?: string;
  message?: Partial<AgentMessage> & { contentBlocks?: ContentBlock[]; metadata?: Record<string, unknown> };
  metadata?: Record<string, unknown>;
  error?: string | Error;
}

// ---------------------------------------------------------------------------
// registerStreamHandlerForSession
// ---------------------------------------------------------------------------

export function registerStreamHandlerForSession(
  agentId: string,
  existingMessage?: AgentMessage,
  workspaceId?: string,
  assistantAppMessageId?: string,
): void {
  if (!agentId) {
    logger.warn('Attempted to register stream handler with undefined agentId, ignoring');
    return;
  }

  const resolvedWorkspaceId = workspaceId || getAgentSession(requireWorkspaceId('registerStreamHandler:resolve'), agentId)?.workspaceId;
  const streamChannel = `agent:stream:${agentId}`;

  logger.debug('Registering stream handler for restored session', {
    agentId, streamChannel, hasExistingMessage: !!existingMessage,
    existingContentBlocksCount: existingMessage?.contentBlocks?.length || 0,
    providedWorkspaceId: workspaceId, resolvedWorkspaceId,
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
    logger.error('window.electronAPI is not available for stream handler registration', { agentId });
    streamRegistry.deletePendingRegistration(agentId);
    return;
  }

  logger.debug('Registering new stream handler (no existing handler in Map)', { agentId, streamChannel });

  // Initialize state from existing message
  let textBuffer = '';
  let orderedItems: StreamOrderedItem[] = [];

  if (existingMessage?.contentBlocks) {
    for (const block of existingMessage.contentBlocks) {
      if (block.type === 'text') {
        orderedItems.push({ type: 'text', content: block.text || '', sequence: orderedItems.length });
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
  // NOTE: this is a snapshot taken at handler-registration time.  Session state
  // may change before the first placeholder is created (e.g. the message gets
  // finalized via another code path).  `pickPlaceholderId` re-validates against
  // the current messages list at placeholder creation time to prevent reusing
  // an ID that now refers to a finalized entry.
  const reusableExistingMessageId =
    existingMessage?.isStreaming &&
    typeof existingMessage.id === 'string' &&
    existingMessage.id.startsWith('msg_')
      ? existingMessage.id
      : undefined;
  let streamAppMessageId = existingMessage?.appMessageId ?? assistantAppMessageId ?? createAppMessageId();

  let chunkCount = 0;
  let currentStreamId: string | undefined = undefined;
  const handlerSessionId = agentId;

  const streamHandler = (data: StreamHandlerData) => {
    chunkCount++;
    if (chunkCount === 1) {
      logger.info('Restored stream handler - first chunk received', {
        callNumber: chunkCount, dataType: data?.type, agentId, dataLength: data?.data?.length,
        workspaceId: resolvedWorkspaceId,
      });
    }

    // Detect new stream ID and reset state
    if (data.streamId && data.streamId !== currentStreamId) {
      if (currentStreamId !== undefined) {
        logger.info('Stream ID changed - resetting accumulated state', {
          agentId, oldStreamId: currentStreamId, newStreamId: data.streamId,
        });
        textBuffer = '';
        orderedItems = [];
        streamAppMessageId = createAppMessageId();
        chunkCount = 1;

        const resetSession = resolvedWorkspaceId
          ? getAgentSession(resolvedWorkspaceId, agentId)
          : getAgentSession(requireWorkspaceId('resetStreamingMessages'), agentId);
        if (resetSession?.messages) {
          for (const msg of resetSession.messages) {
            if (msg.role === 'assistant' && msg.isStreaming) {
              const wsForReset = resolvedWorkspaceId || requireWorkspaceId('clearMessageStreaming');
              getReduxStore().dispatch(updateAgentMessage(wsForReset, agentId, msg.id, { isStreaming: false }));
            }
          }
        }
      }
      currentStreamId = data.streamId;
    }

    const getStreamSession = () =>
      resolvedWorkspaceId
        ? getAgentSession(resolvedWorkspaceId, agentId)
        : getAgentSession(requireWorkspaceId('getStreamSession'), agentId);

    try {
      if (data.type === 'chunk') {
        textBuffer += data.data || '';
        let streamSession = getStreamSession();

        if (!streamSession && resolvedWorkspaceId) {
          // Create minimal session to avoid losing data.
          // selectAgentById (used by getStreamSession/getAgentSession) already delegates
          // to selectAgentSession which is the canonical source — no need for a secondary
          // getWorkspaceAgents().find() lookup.
          const minimalSession: AgentSession = {
            id: agentId as any,
            backendSessionId: agentId as any,
            workspaceId: WorkspaceId(resolvedWorkspaceId),
            name: 'Task Agent',
            status: AgentStatus.Active,
            messages: [],
            createdAt: new Date(),
            updatedAt: new Date(),
            isStreaming: true,
          };
          getReduxStore().dispatch(upsertAgentSession(resolvedWorkspaceId, minimalSession));
          streamSession = getStreamSession();
        }

        if (streamSession?.messages) {
          const hasStreamingMessage = streamSession.messages.some(
            (m) => m.role === 'assistant' && m.isStreaming,
          );
          if (!hasStreamingMessage) {
            const assistantMessage: AgentMessage = {
              // Reuse the existing streaming message's ID only when it is still
              // streaming and canonical (`msg_` prefix) AND no current message
              // already carries that ID; otherwise mint a fresh `msg_*` ID to
              // avoid colliding with a finalized or legacy-ID entry in the
              // session.
              id: pickPlaceholderId(reusableExistingMessageId, streamSession.messages),
              appMessageId: streamAppMessageId,
              role: 'assistant' as const,
              contentBlocks: buildOrderedContentBlocks(orderedItems, textBuffer),
              timestamp: new Date().toISOString(),
              isStreaming: true,
            };
            const wsId = resolvedWorkspaceId || streamSession.workspaceId;
            if (wsId) {
              getReduxStore().dispatch(upsertAgentSession(wsId, { ...streamSession, messages: [...streamSession.messages, assistantMessage] }));
            }
          } else {
            const streamingMsg = streamSession.messages.find(
              (m) => m.role === 'assistant' && m.isStreaming,
            );
            const lastMessage = streamingMsg || streamSession.messages[streamSession.messages.length - 1];
            if (lastMessage?.role === 'assistant') {
              const wsId = resolvedWorkspaceId || requireWorkspaceId('updateContentBlocks:text');
              getReduxStore().dispatch(updateAgentMessage(wsId, agentId, lastMessage.id, {
                contentBlocks: buildOrderedContentBlocks(orderedItems, textBuffer),
              }));
            }
          }
        }

        dispatchAgentStream(handlerSessionId, {
          type: 'chunk',
          content: data.data,
          sessionId: handlerSessionId,
        });
      } else if (data.type === 'content-blocks' && Array.isArray(data.data)) {
        if (textBuffer) {
          orderedItems.push({ type: 'text', content: textBuffer, sequence: orderedItems.length });
          textBuffer = '';
        }

        const streamSession = getStreamSession();
        if (streamSession?.messages) {
          const updatedSession = { ...streamSession, messages: [...streamSession.messages] };
          let assistantMessage: AgentMessage | undefined = updatedSession.messages.find(
            (m) => m.role === 'assistant' && m.isStreaming,
          );
          const isNewMessage = !assistantMessage;

          if (!assistantMessage) {
            assistantMessage = {
              // Reuse the existing streaming message's ID only when it is still
              // streaming and canonical (`msg_` prefix) AND no current message
              // already carries that ID; otherwise mint a fresh `msg_*` ID to
              // avoid colliding with a finalized or legacy-ID entry in the
              // session.
              id: pickPlaceholderId(reusableExistingMessageId, updatedSession.messages),
              appMessageId: streamAppMessageId,
              role: 'assistant' as const,
              contentBlocks: [],
              timestamp: new Date().toISOString(),
              isStreaming: true,
            } as AgentMessage;
            updatedSession.messages.push(assistantMessage);
          }

          for (const newBlock of data.data) {
            if (newBlock.type === 'tool_use') {
              const existing = orderedItems.find(
                (item) => item.type === 'block' && (item.content as ContentBlock).type === 'tool_use' && (item.content as ContentBlock).id === newBlock.id,
              );
              if (!existing) {
                orderedItems.push({ type: 'block', content: newBlock, sequence: orderedItems.length });
              } else {
                existing.content = newBlock;
              }
            } else if (newBlock.type === 'tool_result') {
              const existing = orderedItems.find(
                (item) => item.type === 'block' && (item.content as ContentBlock).type === 'tool_result' && (item.content as ContentBlock).tool_use_id === newBlock.tool_use_id,
              );
              if (!existing) {
                orderedItems.push({ type: 'block', content: newBlock, sequence: orderedItems.length });
              }
            } else if (newBlock.type === 'text') {
              logger.warn('Received unexpected text block in content-blocks event - ignoring');
            } else {
              orderedItems.push({ type: 'block', content: newBlock, sequence: orderedItems.length });
            }
          }

          const msgIndex = updatedSession.messages.findIndex(
            (m) => m.role === 'assistant' && m.isStreaming,
          );
          if (msgIndex >= 0) {
            const messageToUpdate = updatedSession.messages[msgIndex];
            const wsId = resolvedWorkspaceId || requireWorkspaceId('updateContentBlocks:blocks');
            if (isNewMessage) {
              updatedSession.messages[msgIndex] = { ...messageToUpdate, contentBlocks: buildOrderedContentBlocks(orderedItems, textBuffer) };
              getReduxStore().dispatch(upsertAgentSession(wsId, updatedSession));
            } else {
              getReduxStore().dispatch(updateAgentMessage(wsId, agentId, messageToUpdate.id, {
                contentBlocks: buildOrderedContentBlocks(orderedItems, textBuffer),
              }));
            }
          }

          dispatchAgentStream(handlerSessionId, {
            type: 'content-blocks',
            data: data.data,
          });
        }
      } else if (data.type === 'complete') {
        if (textBuffer) {
          orderedItems.push({ type: 'text', content: textBuffer, sequence: orderedItems.length });
          textBuffer = '';
        }

        const streamSession = getStreamSession();
        if (streamSession?.messages?.length) {
          const updatedSession = { ...streamSession, messages: [...streamSession.messages] };
          const msgIndex = updatedSession.messages.findIndex(
            (m, idx) => m.role === 'assistant' && idx === updatedSession.messages.length - 1,
          );

          if (msgIndex >= 0) {
            updatedSession.messages[msgIndex] = { ...updatedSession.messages[msgIndex], isStreaming: false };
            const completeMessageData = data.message || data.data;
            updatedSession.messages[msgIndex].appMessageId =
              completeMessageData?.appMessageId ?? updatedSession.messages[msgIndex].appMessageId ?? streamAppMessageId;
            const finalContentBlocks = buildOrderedContentBlocks(orderedItems, '');
            if (finalContentBlocks.length > 0) {
              updatedSession.messages[msgIndex].contentBlocks = finalContentBlocks;
            } else if (completeMessageData?.contentBlocks?.length > 0) {
              updatedSession.messages[msgIndex].contentBlocks = normalizeContentBlocks(completeMessageData.contentBlocks);
            }
            if (completeMessageData?.metadata) {
              updatedSession.messages[msgIndex].metadata = { ...updatedSession.messages[msgIndex].metadata, ...completeMessageData.metadata };
            }
          }

          if (updatedSession.messages?.length > 0) {
            const wsId = resolvedWorkspaceId || requireWorkspaceId('stream:complete');
            getReduxStore().dispatch(setAgentStreaming(wsId, agentId, false));
            updatedSession.isStreaming = false;
            getReduxStore().dispatch(upsertAgentSession(wsId, updatedSession));

            dispatchStreamEvent(handlerSessionId, 'end', {
              type: 'end',
              message: msgIndex >= 0 ? updatedSession.messages[msgIndex] : null,
            });
            dispatchAgentSessionUpdated(handlerSessionId);

            // Track unread
            const sessionForUnread = getStreamSession();
            const isBackgroundAgent = sessionForUnread?.isBackground || sessionForUnread?.metadata?.isBackground || false;
            getReduxStore().dispatch(newAssistantMessage(agentId, wsId, isBackgroundAgent));
          } else {
            const wsId = resolvedWorkspaceId || requireWorkspaceId('stream:complete:noMsg');
            getReduxStore().dispatch(setAgentStreaming(wsId, agentId, false));
            dispatchStreamEvent(handlerSessionId, 'end', { type: 'end', message: null });
            dispatchAgentSessionUpdated(handlerSessionId);
          }
        } else {
          const wsId = resolvedWorkspaceId || getActiveWsId();
          if (wsId) getReduxStore().dispatch(setAgentStreaming(wsId, agentId, false));
          dispatchStreamEvent(handlerSessionId, 'end', { type: 'end', message: null });
          dispatchAgentSessionUpdated(handlerSessionId);
        }

        // Reset accumulated state after stream completion so that if this
        // handler is reused for a subsequent stream (e.g., wake-up after
        // delegation), old content does not leak into the new response.
        textBuffer = '';
        orderedItems = [];
      } else if (data.type === 'status') {
        dispatchStreamEvent(handlerSessionId, 'status', {
          type: 'status', statusData: data.data, streamId: data.streamId, sessionId: handlerSessionId,
        });
      } else if (data.type === 'error') {
        logger.error('Stream error from restored handler', { agentId, error: data.data });
        dispatchStreamEvent(handlerSessionId, 'error', {
          type: 'error', error: data.data?.message || 'The response was interrupted. Please try again.',
        });
        const wsId = resolvedWorkspaceId || getActiveWsId();
        if (wsId) getReduxStore().dispatch(setAgentStreaming(wsId, agentId, false));
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
  });

  streamRegistry.deletePendingRegistration(agentId);

  logger.info('Stream handler registered for restored session', {
    agentId, streamChannel, hasExistingMessage: !!existingMessage,
  });
}



// ---------------------------------------------------------------------------
// reconnectStreamHandlersForWorkspace
// ---------------------------------------------------------------------------

export function reconnectStreamHandlersForWorkspace(workspaceId: string): void {
  const sessions = getWorkspaceAgents(workspaceId);
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
      ensureStreamHandler(session.id as string, {
        existingMessage: message,
        workspaceId,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// startStreamingSafetyTimeout (private helper)
// ---------------------------------------------------------------------------

function startStreamingSafetyTimeout(confirmedActiveIds: Set<string>): void {
  getReduxStore().dispatch(triggerStreamingSafetyCheck(Array.from(confirmedActiveIds)));
}

// ---------------------------------------------------------------------------
// reconnectToBackendStreams
// ---------------------------------------------------------------------------

export async function reconnectToBackendStreams(): Promise<string[]> {
  if (!window.electronAPI) {
    logger.warn('electronAPI not available for reconnecting to backend streams');
    return [];
  }

  try {
    logger.info('Querying backend for active streams...');
    const result = await window.electronAPI.invoke('agent:get-active-streams');

    const activeStreamAgentIds = new Set<string>(
      result.success && result.data ? result.data.map((s: { agentId: string }) => s.agentId) : [],
    );

    const allSessions = getAllSessionsAcrossWorkspaces();
    logger.info('Checking sessions for stale streaming states (all workspaces)', {
      sessionCount: allSessions.length,
      sessionsWithStreaming: allSessions.filter((s) => s.isStreaming).length,
      activeBackendStreams: activeStreamAgentIds.size,
    });

    rendererLogger.info(LogCategory.AGENT, 'reconnectToBackendStreams: queried backend', {
      totalSessions: allSessions.length,
      sessionsWithStreaming: allSessions.filter((s) => s.isStreaming).map((s) => s.id),
      activeBackendStreams: Array.from(activeStreamAgentIds),
    });

    const STREAMING_GRACE_PERIOD_MS = 15000;

    for (const session of allSessions) {
      if (session.isStreaming && !activeStreamAgentIds.has(session.id)) {
        const sessionCreatedAt = session.createdAt ? new Date(session.createdAt).getTime() : 0;
        const sessionAge = Date.now() - sessionCreatedAt;
        const streamHandler = streamRegistry.getStreamHandler(session.id);
        const streamRegisteredAt = streamHandler?.registeredAt || 0;
        const streamAge = streamRegisteredAt > 0 ? Date.now() - streamRegisteredAt : Infinity;

        if (sessionAge < STREAMING_GRACE_PERIOD_MS || streamAge < STREAMING_GRACE_PERIOD_MS) {
          logger.debug('Skipping stale streaming state check (within grace period)', {
            agentId: session.id, sessionAgeMs: sessionAge, streamAgeMs: streamAge,
          });
          continue;
        }

        logger.info('Clearing stale streaming state for agent (no active backend stream)', { agentId: session.id });
        rendererLogger.warn(LogCategory.AGENT, 'Stale stream cleanup: clearing streaming state', {
          agentId: session.id, previousStatus: session.status, previousIsStreaming: session.isStreaming, workspaceId: session.workspaceId,
        });

        const staleHandler = streamRegistry.getStreamHandler(session.id);
        if (staleHandler) {
          logger.info('Cleaning up stale stream handler (no active backend stream)', { agentId: session.id, channel: staleHandler.channel });
          streamRegistry.cleanupStreamHandler(session.id);
        }

        if (session.workspaceId) {
          getReduxStore().dispatch(setAgentStreaming(session.workspaceId, session.id, false));
        } else {
          const fallbackWsId = getActiveWsId();
          if (fallbackWsId) {
            getReduxStore().dispatch(setAgentStreaming(fallbackWsId, session.id, false));
          } else {
            logger.warn('Cannot clear streaming state: no workspaceId available', { agentId: session.id });
          }
        }

        try {
          const loadResult = await invoke<{ success: boolean; data?: AgentSession; error?: string }>('agent:persistence:load', {
            agentId: session.id, workspaceId: session.workspaceId,
          });

          if (loadResult?.success && loadResult.data) {
            const diskSession = loadResult.data;
            if (!diskSession.workspaceId && session.workspaceId) diskSession.workspaceId = session.workspaceId;
            if (!diskSession.status) diskSession.status = AgentStatus.Idle;
            if (!diskSession.messages) diskSession.messages = session.messages || [];

            diskSession.isStreaming = false;
            if (diskSession.messages) {
              for (const message of diskSession.messages) {
                if (message.isStreaming) message.isStreaming = false;
              }
            }

            const wsIdForDiskSession = diskSession.workspaceId || session.workspaceId;
            if (!wsIdForDiskSession) throw new Error(`Cannot add disk session without workspaceId: ${session.id}`);
            getReduxStore().dispatch(upsertAgentSession(wsIdForDiskSession, diskSession));
            await persistenceService.saveSession(diskSession, diskSession.workspaceId, { immediate: true });
          } else {
            session.isStreaming = false;
            if (!session.workspaceId) throw new Error(`Cannot update session without workspaceId: ${session.id}`);
            getReduxStore().dispatch(upsertAgentSession(session.workspaceId, session));
            if (session.messages) {
              for (const message of session.messages) {
                if (message.isStreaming) {
                  getReduxStore().dispatch(updateAgentMessage(session.workspaceId, session.id, message.id, { isStreaming: false }));
                }
              }
            }
            await persistenceService.saveSession(session, session.workspaceId, { immediate: true });
          }
        } catch (loadError) {
          logger.warn('Failed to load session from disk during stale streaming cleanup', { agentId: session.id, error: loadError });
          session.isStreaming = false;
          if (!session.workspaceId) throw new Error(`Cannot update session without workspaceId: ${session.id}`);
          getReduxStore().dispatch(upsertAgentSession(session.workspaceId, session));
        }

        const staleSessionId = session.id;
        setTimeout(() => { dispatchAgentSessionUpdated(staleSessionId); }, 100);
      }
    }

    if (activeStreamAgentIds.size === 0) {
      logger.debug('No active streams found on backend', { result });
      return [];
    }

    logger.info('Found active streams on backend', { count: activeStreamAgentIds.size, agentIds: Array.from(activeStreamAgentIds) });

    // Re-register handlers for each active stream
    for (const stream of result.data) {
      const { agentId, accumulatedContent, workspaceId: streamWorkspaceId } = stream;
      let handlerAlreadyExists = streamRegistry.hasStreamHandler(agentId);

      let session: AgentSession | undefined;
      if (streamWorkspaceId) {
        session = getAgentSession(streamWorkspaceId, agentId);
      }
      if (!session) {
        const allSess = getAllSessionsAcrossWorkspaces();
        session = allSess.find(s => s.id === agentId);
      }

      let existingMessage: AgentMessage | undefined = session?.messages?.find(
        (m) => m.role === 'assistant' && m.isStreaming === true,
      );

      if (accumulatedContent && !existingMessage && session) {
        const wsIdForRestore = streamWorkspaceId || session.workspaceId;
        if (!wsIdForRestore) throw new Error(`Cannot restore active stream without workspaceId: ${agentId}`);

        const restoredContentBlocks: ContentBlock[] = accumulatedContent.contentBlocks?.length
          ? normalizeContentBlocks(accumulatedContent.contentBlocks)
          : accumulatedContent.content
            ? [{ type: 'text' as const, text: accumulatedContent.content }]
            : [];

        const restoredStreamingMessage: AgentMessage = {
          id: createMessageId(`msg_${uuidv4()}`),
          role: 'assistant' as const,
          contentBlocks: restoredContentBlocks,
          timestamp: new Date().toISOString(),
          isStreaming: true,
        };

        session = {
          ...session,
          messages: [...(session.messages || []), restoredStreamingMessage],
          isStreaming: true,
        };
        existingMessage = restoredStreamingMessage;
        getReduxStore().dispatch(upsertAgentSession(wsIdForRestore, session));
      }

      if (accumulatedContent && existingMessage) {
        const backendContentBlocksCount = accumulatedContent.contentBlocks?.length || 0;
        const existingContentBlocksCount = existingMessage.contentBlocks?.length || 0;
        const existingTextLength = existingMessage.contentBlocks?.filter((b: ContentBlock) => b.type === 'text').reduce((sum: number, b: ContentBlock) => sum + ((b as any).text?.length || 0), 0) || 0;
        const backendContentLength = accumulatedContent.content?.length || 0;
        const backendHasMoreBlocks = backendContentBlocksCount > existingContentBlocksCount;
        const backendHasMoreText = backendContentLength > existingTextLength;
        const backendHasFewerBlocks = backendContentBlocksCount < existingContentBlocksCount;
        const shouldUseBackend = (backendHasMoreBlocks || backendHasMoreText) && !backendHasFewerBlocks;

        if (shouldUseBackend) {
          existingMessage = { ...existingMessage, contentBlocks: normalizeContentBlocks(accumulatedContent.contentBlocks), isStreaming: true };
          if (streamWorkspaceId) {
            getReduxStore().dispatch(updateAgentMessage(streamWorkspaceId, agentId, existingMessage.id, { contentBlocks: accumulatedContent.contentBlocks, isStreaming: true }));
          } else {
            const wsIdForUpdate = session?.workspaceId || streamWorkspaceId;
            if (!wsIdForUpdate) throw new Error(`Cannot update message without workspaceId: ${agentId}`);
            getReduxStore().dispatch(updateAgentMessage(wsIdForUpdate, agentId, existingMessage.id, { contentBlocks: accumulatedContent.contentBlocks, isStreaming: true }));
          }
        }
      }

      if (!handlerAlreadyExists) {
        const ensureResult = ensureStreamHandler(agentId, {
          existingMessage,
          workspaceId: streamWorkspaceId || (session?.workspaceId ? String(session.workspaceId) : undefined),
        });
        handlerAlreadyExists = !ensureResult.created;
      } else {
        if (streamWorkspaceId) {
          getReduxStore().dispatch(setAgentStreaming(streamWorkspaceId, agentId, true));
        } else {
          getReduxStore().dispatch(setAgentStreaming(requireWorkspaceId('setStreaming:existingHandler'), agentId, true));
        }
      }

      if (!handlerAlreadyExists) {
        if (streamWorkspaceId) {
          getReduxStore().dispatch(setAgentStreaming(streamWorkspaceId, agentId, true));
        } else {
          const wsIdForStreaming = streamWorkspaceId || session?.workspaceId;
          if (!wsIdForStreaming) throw new Error(`Cannot set streaming without workspaceId: ${agentId}`);
          getReduxStore().dispatch(setAgentStreaming(wsIdForStreaming, agentId, true));
        }

        if (session && !session.isStreaming) {
          const wsIdForFresh = streamWorkspaceId || session?.workspaceId;
          if (!wsIdForFresh) throw new Error(`Cannot update session streaming without workspaceId: ${agentId}`);
          const freshSession = getAgentSession(wsIdForFresh, agentId);
          const sessionToUpdate = freshSession || session;
          sessionToUpdate.isStreaming = true;
          getReduxStore().dispatch(upsertAgentSession(wsIdForFresh, sessionToUpdate));
        }
      }

      const activeAgentId = agentId;
      setTimeout(() => { dispatchAgentSessionUpdated(activeAgentId); }, 100);
    }

    startStreamingSafetyTimeout(activeStreamAgentIds);
    return Array.from(activeStreamAgentIds);
  } catch (error) {
    logger.error('Failed to reconnect to backend streams', error as Error);
    return [];
  }
}



// ---------------------------------------------------------------------------
// sendMessage
// ---------------------------------------------------------------------------

export async function sendMessage(
    agentId: string,
    content: string,
    workspace: Workspace,
    options: {
      contextReferences?: Array<{ type: string; filePath?: string; noteId?: string; selectedText?: string; [key: string]: unknown }>;
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
        const existingSession = getAgentSession(workspace.id, agentId);
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
          getReduxStore().dispatch(upsertAgentSession(workspace.id, existingSession));
        }

        {
            // --- Session get/activate (runs once, outside retry boundary) ---
            let session = getAgentSession(workspace.id, agentId);

            if (!session) {
              const resumedSession = await resumeSession(agentId, workspace);
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
              getReduxStore().dispatch(upsertAgentSession(workspace.id, session));
            }

            if (!session) {
              throw new Error(`Failed to get or create session for agent ${agentId}`);
            }

            // Add to store after validation
            getReduxStore().dispatch(upsertAgentSession(workspace.id, session));

            // --- User message dispatch (runs once, outside retry boundary) ---
            // This ensures user message appears exactly once regardless of retries.
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
            const userAppMessageId = createAppMessageId();
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

            getReduxStore().dispatch(addAgentMessage(workspace.id, session.id, userMessage));
            // Set streaming flag BEFORE dispatching session-updated event so handlers see isStreaming=true
            getReduxStore().dispatch(setAgentStreaming(workspace.id, session.id, true));
            dispatchAgentSessionUpdated(session.id);

            try {

            // Save the session immediately after adding the user message
            // This ensures the message persists even if the app crashes or refreshes
            // For edit/regenerate flows (resetHistory), allow truncation since messages
            // were intentionally removed before this save
            await saveSession(agentId, workspace.id, true, {
              allowTruncation: options.resetHistory,
            });

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
                    // Re-read session from store (guaranteed to exist after activation above)
                    const session = getAgentSession(workspace.id, agentId);
                    if (!session) {
                      throw new Error(`Failed to get session for agent ${agentId}`);
                    }

                    // Clear isStreaming flag on ALL old assistant messages
                    // before starting a new stream. Without this, old messages with stale
                    // isStreaming: true cause new stream content to be written into them.
                    const preStreamSession = getAgentSession(workspace.id, agentId);
                    if (preStreamSession?.messages) {
                      for (const msg of preStreamSession.messages) {
                        if (msg.role === 'assistant' && msg.isStreaming) {
                          logger.info('Clearing stale isStreaming flag before new message', {
                            agentId,
                            messageId: msg.id,
                            reason: 'sendMessage_new_stream',
                          });
                          getReduxStore().dispatch(updateAgentMessage(workspace.id, agentId, msg.id, {
                            isStreaming: false,
                          }));
                        }
                      }
                    }

                    // Mark as streaming
                    getReduxStore().dispatch(setAgentStreaming(workspace.id, session.id, true));

                    // Add an empty assistant message with isStreaming: true
                    // This ensures the UI shows the streaming indicator immediately
                    // Check if this is the first message (no assistant messages yet)
                    const currentSession = getAgentSession(workspace.id, agentId);
                    const hasAssistantMessage = currentSession?.messages?.some(
                      (m) => m.role === 'assistant',
                    );

                    // Only add the empty streaming message for the first interaction
                    // For follow-up messages, the streaming indicator will appear when the first chunk arrives
                    if (!hasAssistantMessage) {
                      const assistantMessage: AgentMessage = {
                        id: assistantMessageId,
                        appMessageId: assistantAppMessageId,
                        role: 'assistant',
                        contentBlocks: [{ type: 'text' as const, text: '' }], // Add empty text block
                        timestamp: new Date().toISOString(),
                        isStreaming: true,
                        metadata: {},
                      };
                      getReduxStore().dispatch(addAgentMessage(workspace.id, session.id, assistantMessage));
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
                      const currentSession = getAgentSession(
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
                            messageRoles: currentSession.messages.map((m) => m.role),
                          },
                        );

                        // Ensure the session is properly saved in the store
                        getReduxStore().dispatch(upsertAgentSession(workspace.id, currentSession));
                        // Note: Backend handles persistence - no need to save from frontend
                      }

                      // Use registry for targeted IPC cleanup
                      logger.info('Stream timeout - cleaning up stream handler', {
                        agentId,
                        hasStoredHandler: streamRegistry.hasStreamHandler(agentId),
                      });
                      streamRegistry.cleanupStreamHandler(agentId);

                      // Use workspace-aware method for cross-workspace stream completion
                      getReduxStore().dispatch(setAgentStreaming(workspace.id, agentId, false));

                      // Dispatch stream end event and session-updated event
                      // to ensure ChatService clears isProcessing flag on timeout
                      // FIX: Use dispatchStreamEvent which queues events if no handler registered
                      const handlerSessionId = session.id;
                      dispatchStreamEvent(handlerSessionId, 'end', {
                        type: 'end',
                        message: null,
                      });
                      dispatchAgentSessionUpdated(handlerSessionId);

                      // Remove from the map after timeout fires
                      streamRegistry.deleteStreamTimeout(agentId);
                    }, AGENT_STREAMING_CONFIG.BACKEND_STREAM_TIMEOUT_MS + AGENT_STREAMING_CONFIG.FRONTEND_STREAM_CLEANUP_GRACE_MS); // Use shared config: backend timeout + grace period

                    // Store the timeout in the map so it can be cleared later
                    streamRegistry.setStreamTimeout(agentId, streamTimeout);

                    // Track text buffer and ordered items for proper interleaving
                    let textBuffer = '';
                    const orderedItems: StreamOrderedItem[] = [];
                    let hasReceivedFirstChunk = false; // Track if we've received the first text chunk
                    let chunkCount = 0; // Track total number of handler calls

                    const streamHandler = (data: StreamHandlerData) => {
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

                          // Update Redux state BEFORE dispatching DOM event to ChatService.
                          // Previously, the DOM event was dispatched first, causing ChatService's
                          // flushChunkUpdate() to read stale Redux state.
                          // OPTIMIZED: Use efficient streaming text append without deep copying
                          // Use workspace-aware session lookup to handle cross-workspace streaming
                          // This ensures streaming continues even when user switches to a different workspace
                          const streamSession = getAgentSession(
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
                              // Reuse the pre-assigned assistantMessageId so renderer
                              // and backend share the same message identity.
                              const assistantMessage: AgentMessage = {
                                id: assistantMessageId,
                                appMessageId: assistantAppMessageId,
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
                              getReduxStore().dispatch(upsertAgentSession(workspace.id, updatedSession));
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
                                  getReduxStore().dispatch(updateAgentMessage(
                                    workspace.id,
                                    agentId,
                                    lastMessage.id,
                                    {
                                      contentBlocks: buildOrderedContentBlocks(
                                        orderedItems,
                                        textBuffer,
                                      ), // Use buildOrderedContentBlocks to preserve tool blocks
                                    },
                                  ));
                                }
                              }
                            }
                          }

                          // Forward to ChatService AFTER Redux state is updated
                          // This ensures ChatService reads correct data when flushChunkUpdate() runs
                          dispatchAgentStream(handlerSessionId, {
                            type: 'chunk',
                            content: data.data,
                            sessionId: handlerSessionId,
                          });
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
                          const streamSession = getAgentSession(
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
                                (m) => m.role === 'assistant' && m.isStreaming,
                              );

                            // Track if we're creating a new message vs updating existing
                            const isNewMessage = !assistantMessage;

                            if (!assistantMessage) {
                              // Create new assistant message with only contentBlocks
                              // Reuse the pre-assigned assistantMessageId for consistency.
                              assistantMessage = {
                                id: assistantMessageId,
                                appMessageId: assistantAppMessageId,
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
                                    (item.content as ContentBlock).type === 'tool_use' &&
                                    (item.content as ContentBlock).id === newBlock.id,
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
                                    (item.content as ContentBlock).type === 'tool_result' &&
                                    (item.content as ContentBlock).tool_use_id === newBlock.tool_use_id,
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
                              (m) => m.role === 'assistant' && m.isStreaming,
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
                                getReduxStore().dispatch(upsertAgentSession(workspace.id, updatedSession));
                              } else {
                                // Existing message - use direct update to avoid preserveStreamingMessages issue
                                getReduxStore().dispatch(updateAgentMessage(
                                  workspace.id,
                                  agentId,
                                  messageToUpdate.id,
                                  {
                                    contentBlocks: buildOrderedContentBlocks(
                                      orderedItems,
                                      textBuffer,
                                    ),
                                  },
                                ));
                              }
                            }

                            // Dispatch content-blocks event to ChatService
                            dispatchAgentStream(handlerSessionId, {
                              type: 'content-blocks',
                              data: data.data,
                            });
                          }
                        } else if (data.type === 'complete') {
                          try {
                            // GUARD: Skip stale 'complete' events from interrupted streams.
                            // When a stream is interrupted (user sends a new message), the backend
                            // sends a 'complete' with data: null and no message/finishReason.
                            // If this arrives at the handler set up by the NEW sendMessage call
                            // (before any chunks from the new stream), it would prematurely clean
                            // up the new handler, causing all subsequent chunks to be dropped.
                            // Real completions ALWAYS include a `message` or `finishReason` field.
                            if (!hasReceivedFirstChunk && chunkCount <= 1 && !data.message && !data.finishReason) {
                              logger.info('Skipping stale complete event from interrupted stream', {
                                agentId,
                                streamId: data.streamId,
                                reason: 'no_chunks_received_and_no_message_data',
                              });
                              return;
                            }

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
                            const streamSession = getAgentSession(
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

                                // If the complete event includes final message data, update it
                                // The backend sends { type: 'complete', streamId, message: finalMessage }
                                const completeMessageData = data.message || data.data;

                                // Create a new message object with isStreaming set to false
                                updatedSession.messages[msgIndex] = {
                                  ...assistantMessage,
                                  appMessageId: completeMessageData?.appMessageId ?? assistantMessage.appMessageId ?? assistantAppMessageId,
                                  isStreaming: false,
                                };

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
                                  messageRoles: updatedSession.messages.map((m) => m.role),
                                });
                                // CRITICAL: Set streaming to false BEFORE calling addSession
                                // Otherwise, Redux upsertAgentSession's preserveStreamingMessages logic
                                // will preserve old streaming messages instead of using our updated messages
                                // Use workspace-aware method for cross-workspace stream completion
                                getReduxStore().dispatch(setAgentStreaming(workspace.id, agentId, false));
                                // Also set isStreaming on the session object itself
                                // Otherwise, setAgent will see session.isStreaming as true and
                                // overwrite the streaming.active state we just set to false
                                updatedSession.isStreaming = false;
                                getReduxStore().dispatch(upsertAgentSession(workspace.id, updatedSession));

                                // Dispatch stream end event to ChatService
                                // This is critical for clearing the isProcessing flag
                                // FIX: Use dispatchStreamEvent which queues events if no handler registered
                                dispatchStreamEvent(handlerSessionId, 'end', {
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
                                dispatchAgentSessionUpdated(handlerSessionId);
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
                                  // Track that renderer received the agent outcome
                                  const sendMsgOutcomeReason = data.finishReason || 'unknown';
                                  const sendMsgIsStop = ['cancelled', 'provider_stopped', 'workspace_deleted', 'process_died', 'process_null'].includes(sendMsgOutcomeReason);
                                  const sendMsgIsError = sendMsgOutcomeReason === 'timeout' || sendMsgOutcomeReason === 'error';
                                  track('Agent Outcome Received', {
                                    agent_id: agentId,
                                    workspace_id: workspace.id,
                                    outcome: sendMsgIsStop ? 'stopped' : sendMsgIsError ? 'errored' : 'completed',
                                    finish_reason: sendMsgOutcomeReason,
                                    agent_name: updatedSession.name,
                                    agent_model: updatedSession.model,
                                    source: 'renderer',
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
                                getReduxStore().dispatch(setAgentStreaming(workspace.id, agentId, false));

                                // Update unified state store so BackgroundAgentExecutor subscriptions fire
                                // Get the session from the store to sync the unified state
                                const sessionForUnifiedSync = getAgentSession(
                                  workspace.id,
                                  agentId,
                                );
                                if (sessionForUnifiedSync) {
                                  getReduxStore().dispatch(upsertAgentSession(workspace.id, sessionForUnifiedSync,));
                                }

                                // Still dispatch stream end event to clear isProcessing flag
                                // FIX: Use dispatchStreamEvent which queues events if no handler registered
                                dispatchStreamEvent(handlerSessionId, 'end', {
                                  type: 'end',
                                  message: null,
                                });
                                // Track renderer outcome for error/empty case
                                const emptyMsgReason = data.finishReason || 'unknown';
                                track('Agent Outcome Received', {
                                  agent_id: agentId,
                                  workspace_id: workspace.id,
                                  outcome: ['cancelled', 'provider_stopped', 'workspace_deleted', 'process_died', 'process_null'].includes(emptyMsgReason) ? 'stopped' : (emptyMsgReason === 'timeout' || emptyMsgReason === 'error') ? 'errored' : 'completed',
                                  finish_reason: emptyMsgReason,
                                  source: 'renderer',
                                });

                                // Also dispatch session-updated event as a fallback
                                dispatchAgentSessionUpdated(handlerSessionId);
                              }
                            } else {
                              // Just mark streaming as complete without updating session
                              logger.debug('Stream complete but no messages to update', {
                                agentId,
                              });
                              // Use workspace-aware method for cross-workspace stream completion
                              getReduxStore().dispatch(setAgentStreaming(workspace.id, agentId, false));

                              // Update unified state store so BackgroundAgentExecutor subscriptions fire
                              // Get the session from the store to sync the unified state
                              const sessionForUnifiedSync = getAgentSession(
                                workspace.id,
                                agentId,
                              );
                              if (sessionForUnifiedSync) {
                                getReduxStore().dispatch(upsertAgentSession(workspace.id, sessionForUnifiedSync,));
                              }

                              // Still dispatch stream end event to clear isProcessing flag
                              // FIX: Use dispatchStreamEvent which queues events if no handler registered
                              dispatchStreamEvent(handlerSessionId, 'end', {
                                type: 'end',
                                message: null,
                              });
                              // Track renderer outcome for no-messages case
                              const noMsgReason = data.finishReason || 'unknown';
                              track('Agent Outcome Received', {
                                agent_id: agentId,
                                workspace_id: workspace.id,
                                outcome: ['cancelled', 'provider_stopped', 'workspace_deleted', 'process_died', 'process_null'].includes(noMsgReason) ? 'stopped' : (noMsgReason === 'timeout' || noMsgReason === 'error') ? 'errored' : 'completed',
                                finish_reason: noMsgReason,
                                source: 'renderer',
                              });

                              // Also dispatch session-updated event as a fallback
                              dispatchAgentSessionUpdated(handlerSessionId);
                            }

                            // Mark agent as having unread messages (if user isn't currently viewing it)
                            // Pass workspaceId to enable cross-workspace tab indicators
                            // Pass isBackground to skip unread tracking for background agents
                            const sessionForUnread = getAgentSession(
                              workspace.id,
                              agentId,
                            );
                            const isBackgroundAgent =
                              sessionForUnread?.isBackground ||
                              sessionForUnread?.metadata?.isBackground ||
                              false;
                            getReduxStore().dispatch(newAssistantMessage(
                              agentId,
                              workspace.id,
                              isBackgroundAgent,
                            ));

                            // Clean up the stream listener and timeout
                            clearTimeout(streamTimeout);
                            streamRegistry.deleteStreamTimeout(agentId);

                            // Use registry for targeted IPC cleanup
                            logger.debug('Cleaning up stream handler after complete event', {
                              agentId,
                              hasStoredHandler: streamRegistry.hasStreamHandler(agentId),
                              channel: streamRegistry.getStreamHandler(agentId)?.channel,
                              timestamp: Date.now(),
                              note: 'If queued messages exist, backend will send agent:queue:processing to re-register',
                            });
                            streamRegistry.cleanupStreamHandler(agentId);
                          } catch (error) {
                            logger.error('Error in streamHandler for complete processing', {
                              error,
                              agentId,
                              streamChannel,
                            });
                          }
                        } else if (data.type === 'status') {
                          // Use dispatchStreamEvent() so status events go through the queuing/replay
                          // mechanism. If ChatService is temporarily unavailable (HMR, tab switch,
                          // workspace rebind), the events will be replayed when it reconnects.
                          dispatchStreamEvent(handlerSessionId, 'status', {
                            type: 'status',
                            statusData: data.data,
                            streamId: data.streamId,
                            sessionId: handlerSessionId,
                          });
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
                          dispatchStreamEvent(handlerSessionId, 'error', {
                            type: 'error',
                            error: data.data?.message || 'The response was interrupted. Please try again.',
                          });

                          // Track that renderer received the agent error outcome
                          track('Agent Outcome Received', {
                            agent_id: agentId,
                            workspace_id: workspace.id,
                            outcome: 'errored',
                            finish_reason: 'error',
                            source: 'renderer',
                          });

                          // Also dispatch session-updated event as a fallback
                          dispatchAgentSessionUpdated(handlerSessionId);

                          // Use workspace-aware method for cross-workspace stream completion
                          getReduxStore().dispatch(setAgentStreaming(workspace.id, agentId, false));
                          // Clean up the stream listener and timeout
                          clearTimeout(streamTimeout);
                          streamRegistry.deleteStreamTimeout(agentId);

                          // Use registry for targeted IPC cleanup
                          logger.info('Stream error - cleaning up stream handler', {
                            agentId,
                            hasStoredHandler: streamRegistry.hasStreamHandler(agentId),
                          });
                          streamRegistry.cleanupStreamHandler(agentId);
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

                    // FIX: Mark this agent as being set up by sendMessage so the global
                    // `agent:stream-starting` listener skips ensureStreamHandler() and
                    // doesn't create a duplicate IPC listener (which would double chunks).
                    streamRegistry.markSendMessageStreamSetup(agentId);

                    // Clean up any existing handler for this agent before registering a new one
                    logger.info('Checking for existing stream handler', {
                      agentId,
                      activeHandlersCount: streamRegistry.getStreamHandlerCount(),
                      hasHandler: streamRegistry.hasStreamHandler(agentId),
                      allHandlerKeys: streamRegistry.getStreamHandlerKeys(),
                    });

                    const existingHandler = streamRegistry.getStreamHandler(agentId);

                    if (existingHandler) {
                      // Always clean up existing handler when sending a NEW message.
                      logger.info(
                        'Cleaning up existing stream handler before sending new message',
                        {
                          agentId,
                          existingChannel: existingHandler.channel,
                          newChannel: streamChannel,
                          reason: 'new_message_requires_fresh_handler_state',
                        },
                      );

                      // Use registry to clean up everything (IPC handler, pending reg, timeout)
                      streamRegistry.cleanupStreamHandler(agentId);
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

                    streamRegistry.setStreamHandler(agentId, {
                      channel: streamChannel,
                      handler: streamHandler,
                      wrappedHandler: wrappedHandler || undefined,
                      workspaceId: workspace.id,
                      listenerId: streamListenerId,
                      registeredAt: Date.now(),
                    });

                    // FIX: sendMessage's handler is now registered — allow the global
                    // `agent:stream-starting` listener to act normally again for this agent.
                    streamRegistry.clearSendMessageStreamSetup(agentId);

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
                    streamRegistry.setPingHandler(agentId, {
                      channel: pingChannel,
                      handler: pingHandler,
                      listenerId: pingListenerId,
                    });

                    logger.info('Stream handler registered successfully', {
                      agentId,
                      streamChannel,
                      pingChannel,
                      workspaceId: workspace.id,
                      activeHandlersCount: streamRegistry.getStreamHandlerCount(),
                      hasStoredHandler: streamRegistry.hasStreamHandler(agentId),
                      hasWrappedHandler: !!wrappedHandler,
                    });

                    try {
                      // IMPORTANT: Only pass messages to backend for edit/regenerate flows.
                      // In normal message flows, the backend loads messages from persistence,
                      // which doesn't include the streaming placeholder assistant message.
                      //
                      // Previously, we always passed currentMessages from Redux state, which
                      // caused issues when:
                      // 1. User sends message
                      // 2. Empty assistant message is added to Redux state for streaming UI
                      // 3. Messages are sent to backend (user + empty assistant)
                      // 4. ACP rejects because last message is not from user
                      //
                      // For edit/regenerate flows (resetHistory=true), we need to pass the
                      // truncated messages so the backend uses them instead of stale history.
                      let messagesToSend: AgentMessage[] | undefined = undefined;

                      if (options.resetHistory) {
                        // Edit/regenerate flow: pass truncated messages from Redux state
                        const currentSession = getAgentSession(workspace.id, agentId);
                        const currentMessages = currentSession?.messages || [];

                        // Filter out empty streaming placeholder assistant messages.
                        // These are added for UI purposes but shouldn't be sent to the backend.
                        // IMPORTANT: Only filter out messages that are actively streaming AND have
                        // no real content. Non-streaming assistant messages (even those without a
                        // text block, e.g. tool-call-only responses) must be preserved so that
                        // conversation history stays intact during edit/regenerate flows.
                        messagesToSend = currentMessages.filter((m) => {
                          // Keep all non-assistant messages
                          if (m.role !== 'assistant') return true;

                          // For non-streaming assistant messages, always keep them
                          if (m.isStreaming !== true) return true;

                          // For streaming assistant messages, keep only if they have real content
                          const hasAnyContent = m.contentBlocks?.some((b) => {
                            if (b.type === 'text') return b.text && b.text.trim().length > 0;
                            // Non-text blocks (tool_call, image, etc.) count as real content
                            return true;
                          });
                          return !!hasAnyContent;
                        });

                        logger.info(
                          'Frontend: Edit/regenerate flow - sending filtered messages from Redux state',
                          {
                            agentId,
                            sessionId: session.id,
                            originalMessageCount: currentMessages.length,
                            filteredMessageCount: messagesToSend.length,
                            messageRoles: messagesToSend.map((m) => m.role),
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
                        // Pre-assigned assistant message ID so backend uses the same ID as the renderer
                        assistantMessageId,
                        userAppMessageId,
                        assistantAppMessageId,
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
                      // FIX: Ensure the guard flag is cleared on error so the global
                      // `agent:stream-starting` listener isn't permanently blocked.
                      streamRegistry.clearSendMessageStreamSetup(agentId);

                      // NOTE: Do NOT dispatch error events here — this catch block fires on
                      // EVERY error-boundary retry attempt. Dispatching here would cause
                      // isStreaming to flash false→true→false on each retry, creating a
                      // visible UI flicker. Instead, the error dispatch happens AFTER all
                      // retries are exhausted (see the !result.success block below).

                      // Clean up the stream listener on error
                      logger.info('Catch block - cleaning up stream handler', {
                        agentId,
                        hasStoredHandler: streamRegistry.hasStreamHandler(agentId),
                      });
                      streamRegistry.cleanupStreamHandler(agentId);
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
              dispatchStreamEvent(agentId, 'error', {
                type: 'error',
                error: finalErrorMsg,
              });
              dispatchAgentSessionUpdated(agentId);

              // Don't re-wrap - the error already has a clean user-facing message
              // from the error boundary service
              throw result.error || new Error('Something went wrong. Please try again.');
            }
            } catch (streamingError) {
              // If saveSession or any pre-retry-boundary code throws after
              // setAgentStreaming(true), reset the streaming flag so the UI
              // doesn't stay stuck on "Thinking…" until the safety detector fires.
              getReduxStore().dispatch(setAgentStreaming(workspace.id, session.id, false));
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

