/**
 * Agent Stream Lifecycle
 *
 * Module-level functions for the sendMessage pipeline. Streaming and
 * terminal state arrive via the daemon events bridge (events.subscribe → Redux).
 *
 * Extracted from RefactoredAgentService class to enable deletion of agent.service.ts.
 * All `this` references have been replaced by module-level state or imported functions.
 */

import { v4 as uuidv4 } from 'uuid';
import { createMessageId } from '$shared/types/branded-ids';
import { backendRequest } from '$lib/client/live/backend-transport';
import { createLogger } from '$lib/utils/client-logger';
import type { Workspace, ContentBlock, AgentMessage, AgentSession, QueuedMessage } from '$shared/types';
import { AgentStatus } from '$shared/types';
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
import {
  errorRecovery,
  DEFAULT_STRATEGIES,
} from './browser/services/error-recovery.service';
import { IN_FLIGHT_PROMPT_DROPPED_ERROR } from '$shared/constants/agent-streaming';
import { chatQueuedRetryRecordParked } from '$store/renderer/slices/chat-state/chat-state-slice';
import type { LastAttemptedMessage } from '$store/renderer/slices/chat-state/chat-state-types';
import { replaceAgentQueue } from '$store/renderer/slices/agent-queue/agent-queue-slice';
import { selectAgentQueueMessages } from '$store/renderer/slices/agent-queue/agent-queue-selectors';
import { workspaceMetrics } from '$store/renderer/slices/workspace/utils/workspace-metrics';
import { store as appStore } from '$store/renderer/store';

const logger = createLogger('AgentStreamLifecycle');

type ReduxAction = { type: string; payload?: unknown };

function dispatchRedux(action: ReduxAction): void {
  appStore.dispatch(action as any);
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

function getStreamErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (isRecord(error) && typeof error.message === 'string') return error.message;
  return undefined;
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
                  // stream, and no client-side stall detection remains (the former
                  // chat-state stall saga was removed). The daemon (intentd) owns
                  // turn lifetime and will emit a terminal event (complete with
                  // finishReason, or error) when the turn ends.

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
                        // #1011: the daemon echoed a stable id for the queued
                        // entry, so park the retry payload under it (turn-scoped
                        // records, #999) instead of leaving it in the caller's
                        // mid-turn `lastAttemptedMessage` overwrite — the park
                        // action also undoes that overwrite when the slot still
                        // holds this payload. Mirror the caller's recorded shape
                        // (chat-send-service `recordedAttempt`) so the structural
                        // match holds. Park BEFORE seeding the queue slice so an
                        // immediate drain snapshot can already promote it.
                        const recordedOptions = {
                          ...(options.noteIds !== undefined ? { noteIds: options.noteIds } : {}),
                          ...(options.model !== undefined ? { model: options.model } : {}),
                          ...(options.imageBlocks !== undefined
                            ? { imageBlocks: options.imageBlocks }
                            : {}),
                        };
                        const recordedAttempt: LastAttemptedMessage = {
                          text: content,
                          ...(Object.keys(recordedOptions).length > 0
                            ? { options: recordedOptions }
                            : {}),
                        };
                        dispatchRedux(
                          chatQueuedRetryRecordParked(agentId, queuedMessage.id, recordedAttempt),
                        );
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
