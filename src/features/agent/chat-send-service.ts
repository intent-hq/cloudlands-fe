/**
 * Chat send service — the sanctioned post-saga consumer for ChatPanel send
 * triggers, sibling to `chat-read-service.ts`.
 *
 * ChatPanel dispatches `sendMessage(agentId, { wsId, text, ... })` but its
 * saga was removed when the saga runtime went away — so Send became a no-op
 * and pressing Send produced no user message and no streamed reply. This
 * restores the send path WITHOUT re-adding a saga and WITHOUT changing any
 * dispatch site: `createChatSendMiddleware()` observes dispatched actions
 * and, after the reducer runs, resolves the target `Workspace` via the
 * workspace selector and invokes `agent-stream-lifecycle.sendMessage()` —
 * which already owns the optimistic user message, the streaming flag, and
 * the stream-handler lifecycle.
 *
 * Re-homed pre-send essentials (ported minimally from the deleted
 * `send-message-saga.ts`): dispatch `chatSendStarted` for immediate loading
 * UI, and clear the chat draft so the input doesn't echo the just-sent text.
 *
 * Queue-on-send: when the daemon snapshot reports the agent is currently
 * in-flight (`selectAgentIsResponding` true — driven entirely by BE-returned
 * `isStreaming` / `isResponding` / status), the composer text is routed
 * through `agent.queueMessage` (seam `appClient.agents.queue`) instead of the
 * normal lifecycle send, and the returned `queuedMessage` seeds the local
 * agent-queue slice so the queued-UI surfaces immediately. The BE remains the
 * single source of truth — the FE never second-guesses the streaming flags.
 *
 * Stop: ChatPanel's Stop button dispatches `agentSessionStopChatRequested`
 * (another orphaned `*Requested` trigger — its saga consumer was removed with
 * the saga runtime, so Stop was a dead button). The handler mirrors the
 * reference saga minimally: flag `chatStopInitiated` (isInterrupting UI),
 * call `agent.stop` via the seam (`appClient.agents.stop`, §5.5 — the daemon
 * cancels the in-flight stream and emits the terminal `agent:stream:end`,
 * which is the real convergence signal), then `chatStopCompleted` and settle
 * the action's promise. A non-success stop is logged but still completes —
 * matching the reference, the UI must not stay stuck in "interrupting".
 *
 * Dependency-light per src/store AGENTS.md: top-level imports are limited to
 * the configured store, slice actions, store-free types, and the logger.
 * Selectors and the lifecycle module (which evaluate `store.createSelector`
 * at import) are dynamically imported inside the handler so they are never
 * evaluated while the store is still initializing through the middleware
 * chain.
 */
import type { StoreMiddleware } from "$lib/store-shim/types";
import { appClient } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
import {
  chatLastAttemptedMessageSet,
  chatSendFailed,
  chatSendStarted,
  chatStopCompleted,
  chatStopInitiated,
  sendMessage,
} from "$store/renderer/slices/chat-state/chat-state-slice";
import {
  agentSessionRetryLastMessageRequested,
  agentSessionRetryWithModelRequested,
  agentSessionStopChatRequested,
} from "$store/renderer/slices/agent-session/agent-session-slice";
import { clearChatDraft } from "$store/renderer/slices/transient-ui/transient-ui-slice";
import {
  removeQueuedMessageFromAgentQueue,
  removeQueuedMessageRequested,
  replaceAgentQueue,
} from "$store/renderer/slices/agent-queue/agent-queue-slice";
import type {
  LastAttemptedMessage,
  SendMessagePayload,
} from "$store/renderer/slices/chat-state/chat-state-types";
import { CHIEF_WORKSPACE_ID } from "$store/renderer/slices/sidebar-nav/sidebar-nav-types";
import {
  getChiefThreadTitle,
  isPlaceholderChiefThreadName,
} from "$store/renderer/slices/sidebar-nav/chief-thread-title";
import type { AgentSession } from "$shared/types";
import { loadChatTranscript } from "$features/agent/chat-read-service";
import { createLogger } from "$lib/utils/client-logger";

const logger = createLogger("ChatSendService");

type LifecycleSendOptions = {
  imageBlocks?: SendMessagePayload["imageBlocks"];
  noteIds?: string[];
  model?: string;
  priority?: "interrupt";
};

/**
 * Dynamically load the lifecycle send fn + selectors. Imported lazily so the
 * `store.createSelector` calls in the selector modules never run during the
 * middleware-chain construction.
 */
async function loadSendDeps() {
  const [wsSel, asSel, queueSel, lifecycle] = await Promise.all([
    import("$store/renderer/slices/workspace/workspace-selectors"),
    import("$store/renderer/slices/agent-session/agent-session-selectors"),
    import("$store/renderer/slices/agent-queue/agent-queue-selectors"),
    import("$features/agent/agent-stream-lifecycle"),
  ]);
  return {
    selectWorkspaceById: wsSel.selectWorkspaceById,
    selectAgentIsResponding: asSel.selectAgentIsResponding,
    selectAgentQueueMessages: queueSel.selectAgentQueueMessages,
    sendMessage: lifecycle.sendMessage,
  };
}
type SendDeps = Awaited<ReturnType<typeof loadSendDeps>>;

async function dispatchToLifecycle(
  agentId: string,
  wsId: string,
  text: string,
  workspaceContextStr: string | undefined,
  options: LifecycleSendOptions,
  forceSubmit: boolean,
): Promise<void> {
  let deps: SendDeps;
  try {
    deps = await loadSendDeps();
  } catch (error) {
    // AUDIT-P0-2: surface the failure through `chatSendFailed` so the UI
    // renders an error state instead of silently dropping the message.
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Failed to load chat send deps", error);
    appStore.dispatch(chatSendFailed(agentId, `Failed to load chat dependencies: ${message}`));
    return;
  }

  const workspace = deps.selectWorkspaceById.select(appStore.state, wsId);
  if (!workspace) {
    logger.warn("Cannot send: workspace not found", { agentId, wsId });
    appStore.dispatch(chatSendFailed(agentId, `Workspace not found: ${wsId}`));
    return;
  }

  const content = workspaceContextStr
    ? `${workspaceContextStr}\n\n${text.trim()}`
    : text.trim();

  // STAB-55: sending to a NON-HYDRATED agent (no session in the store, or a
  // session whose transcript was never loaded — e.g. the workspace was already
  // selected before a daemon restart, so ChatPanel never re-dispatched
  // initializeChatRequested) must hydrate FIRST. Without this, the send path's
  // restore (`agent.get` → AgentLite, messages normalized to []) seeds an
  // empty transcript and the queue-on-send decision below reads stale
  // pre-restart streaming flags — the chat renders blank while the daemon
  // processes normally. `loadChatTranscript` fetches the session + the real
  // transcript (chat.subscribe seq-0 snapshot) and refreshes the BE-owned
  // streaming flags; it is coalesced per agent and swallows errors, so a
  // failed hydration degrades to the previous behavior instead of blocking
  // the send.
  const sessionsState = appStore.state as {
    agentSessions?: { byAgentId: Record<string, { messages?: unknown[] }> };
  };
  const existingSession = sessionsState.agentSessions?.byAgentId[agentId];
  if (!existingSession || (existingSession.messages?.length ?? 0) === 0) {
    try {
      await loadChatTranscript(agentId);
    } catch (error) {
      // loadChatTranscript swallows its own errors; this guard only covers an
      // unexpected throw so hydration failure can never block the send.
      logger.warn("Pre-send transcript hydration threw; proceeding with send", {
        agentId,
        error,
      });
    }
  }

  // Queue-on-send: derive in-flight status SOLELY from BE-returned session
  // state (selectAgentIsResponding reads `isResponding`/`isStreaming`/status
  // off the daemon snapshot). When the daemon reports the agent is busy,
  // route the message through `agent.queueMessage` instead of dropping it,
  // and seed the local queue from the returned `queuedMessage` so the UI
  // immediately shows the queued-message state (no extra hydration round
  // trip required).
  //
  // EXCEPTION: forceSubmit bypasses queue-on-send (STAB-38 fix). Force-send
  // (⌘Enter) must interrupt the active turn, not queue behind it — that's
  // the entire point of force-send. The lifecycle send will pass
  // `priority: "interrupt"` to the daemon, which preempts the in-flight turn
  // keep-alive per PROTOCOL.md §5.5.
  if (!forceSubmit && deps.selectAgentIsResponding.select(appStore.state, agentId)) {
    appStore.dispatch(clearChatDraft(wsId, agentId));
    try {
      // Image attachments must survive queue-on-send: forward them on the
      // seam (only when present, mirroring the force-send path) so the
      // daemon persists them on the QueuedMessage per PROTOCOL §5.5.
      const result =
        options.imageBlocks !== undefined
          ? await appClient.agents.queue(agentId, content, { imageBlocks: options.imageBlocks })
          : await appClient.agents.queue(agentId, content);
      if (!result.success) {
        // AUDIT-P0-2: surface the daemon-rejected queue attempt so the UI
        // can render the error instead of silently dropping the message.
        const errMsg = result.error ?? "queueMessage rejected";
        logger.warn("agent.queueMessage rejected by daemon", {
          agentId,
          wsId,
          error: errMsg,
        });
        appStore.dispatch(chatSendFailed(agentId, errMsg));
        return;
      }
      const queuedMessage = result.queuedMessage;
      if (queuedMessage) {
        const existing = deps.selectAgentQueueMessages.select(appStore.state, agentId);
        const next = existing.some((m) => m.id === queuedMessage.id)
          ? existing
          : [...existing, queuedMessage];
        appStore.dispatch(replaceAgentQueue(agentId, next));
      }
      // Chief rename must also fire on the queue path (monorepo#745): when
      // the very FIRST user message is queued, the transcript has no user
      // message yet, so the queued content — which becomes that first user
      // message — is passed as the title candidate.
      if (wsId === CHIEF_WORKSPACE_ID) {
        await renameChiefThreadIfPlaceholder(agentId, content);
      }
    } catch (error) {
      // AUDIT-P0-2: a queue-on-send failure must surface to the UI; do not
      // silently drop the message.
      const message = error instanceof Error ? error.message : String(error);
      logger.error("agent.queueMessage threw", error);
      appStore.dispatch(chatSendFailed(agentId, `Failed to queue message: ${message}`));
    }
    return;
  }

  // Immediate loading-state dispatch so the UI doesn't have to wait for the
  // first lifecycle dispatch to surface the spinner / streaming indicator.
  appStore.dispatch(chatSendStarted(agentId, wsId));
  // Record the exact content this attempt carries so the error banner's
  // "Try again" resends it verbatim if the turn fails (#941). `content`
  // already includes the workspace-context prefix, so a retry must not
  // re-prefix it. A model override (retry-with-model, #964) is recorded too,
  // so a subsequent "Try again" keeps using the suggested model.
  const recordedOptions = {
    ...(options.noteIds !== undefined ? { noteIds: options.noteIds } : {}),
    ...(options.model !== undefined ? { model: options.model } : {}),
  };
  appStore.dispatch(
    chatLastAttemptedMessageSet(agentId, {
      text: content,
      ...(Object.keys(recordedOptions).length > 0 ? { options: recordedOptions } : {}),
    }),
  );
  appStore.dispatch(clearChatDraft(wsId, agentId));

  try {
    await deps.sendMessage(agentId, content, workspace, {
      imageBlocks: options.imageBlocks,
      noteIds: options.noteIds,
      // One-shot model override (retry-with-model, #964): the lifecycle send
      // resolves the wire model as options.model ?? session.model.
      model: options.model,
      // Pass priority: "interrupt" when force-send is active (STAB-38 fix).
      // The daemon will preempt the in-flight turn instead of queueing.
      priority: options.priority,
    });
    if (wsId === CHIEF_WORKSPACE_ID) {
      await renameChiefThreadIfPlaceholder(agentId);
    }
  } catch (error) {
    // AUDIT-P0-2: dispatch chatSendFailed so the error appears in the UI
    // instead of being swallowed in a fire-and-forget background promise.
    const message = error instanceof Error ? error.message : String(error);
    logger.error("lifecycle.sendMessage threw", error);
    appStore.dispatch(chatSendFailed(agentId, message));
  }
}

/**
 * Chief first-message rename: after a chief-thread send (or queue-on-send),
 * rename the daemon-side agent to the sidebar-derived thread title (shared
 * derivation: `getChiefThreadTitle`) so `agent:idle` notifications carry the
 * real title instead of the creation placeholder. Sent with
 * `skipIfExplicitlySet: true` (PROTOCOL §5.5) so a user-chosen name is never
 * clobbered — chief threads are created with `nameExplicitlySet: false`, so
 * the guard passes for them. Failures are logged, never surfaced: the rename
 * is cosmetic and must not fail the send.
 *
 * Hardened trigger (monorepo#745): instead of the strict 0 → 1 send
 * transition, fire whenever the daemon-side name is still a creation
 * placeholder — this covers a first message that took the queue path and
 * retroactively fixes threads that missed the rename on an earlier send.
 * Guards:
 * - Re-fire guard: once renamed (`agent:renamed` refreshes `session.name`),
 *   later sends bail out — even if a swallowed hydration failure left the
 *   local transcript missing earlier messages.
 * - The title always derives from the thread's FIRST user message; when the
 *   transcript has none yet (first message queued while the agent was busy),
 *   `fallbackText` — the content being queued, i.e. the future first user
 *   message — is used instead.
 * - Image-only/empty first message: a derived title that is itself a
 *   placeholder never issues the (same-name) wire rename.
 */
async function renameChiefThreadIfPlaceholder(
  agentId: string,
  fallbackText?: string,
): Promise<void> {
  const state = appStore.state as {
    agentSessions?: { byAgentId: Record<string, AgentSession | undefined> };
  };
  const session = state.agentSessions?.byAgentId[agentId];
  if (!session) return;
  if (!isPlaceholderChiefThreadName(session.name)) return;
  const hasUserMessage = session.messages.some((message) => message.role === "user");
  const name = hasUserMessage ? getChiefThreadTitle(session) : (fallbackText?.trim() ?? "");
  if (isPlaceholderChiefThreadName(name)) return;
  try {
    const result = await appClient.agents.rename(agentId, name, undefined, {
      skipIfExplicitlySet: true,
    });
    if (!result.success) {
      logger.warn("agent.rename (chief first-message) reported a non-success result", {
        agentId,
        error: result.error,
      });
    }
  } catch (error) {
    logger.warn("agent.rename (chief first-message) threw", { agentId, error });
  }
}

/**
 * Optimistically remove a queued message and ask the daemon to remove its
 * persisted entry. The BE has been made **idempotent** on
 * `agent.removeQueuedMessage` (PROTOCOL §5.5) — it returns `{ success: true }`
 * regardless of whether the messageId was actually in the queue — so we do NOT
 * roll the optimistic delete back on any response. A thrown error is treated
 * as a transport failure: the FE-side delete already added a tombstone via
 * `removeQueuedMessageFromAgentQueue`, so a stale `agent:queue:updated`
 * snapshot that still includes the entry will be suppressed by the reducer
 * until the BE catches up.
 */
async function dispatchQueueRemoval(agentId: string, messageId: string): Promise<void> {
  // Optimistic UI first: drop the message locally and record the tombstone so
  // a late BE snapshot cannot resurrect it before self-drain catches up.
  appStore.dispatch(removeQueuedMessageFromAgentQueue(agentId, messageId));
  try {
    const result = await appClient.agents.removeQueued(agentId, messageId);
    // The daemon is idempotent: a "not found" / queue-empty response is
    // surfaced as `success: true`. A non-success here can only mean a
    // transport-level failure (the seam folds RPC throws into MutationResult);
    // in either case we deliberately keep the optimistic delete in place — the
    // BE's next `agent:queue:updated` snapshot will reconcile.
    if (!result.success) {
      logger.warn("agent.removeQueuedMessage reported a non-success result; keeping optimistic delete in place", {
        agentId,
        messageId,
        error: result.error,
      });
    }
  } catch (error) {
    // The seam should not throw, but if it does we still do NOT roll back —
    // matches the §5.5 idempotency contract and the §6.5 invariant that the
    // BE's next queue snapshot is the source of truth.
    logger.error("agent.removeQueuedMessage threw; keeping optimistic delete in place", {
      agentId,
      messageId,
      error,
    });
  }
}

/**
 * Service the error banner's "Try again": resend the recorded
 * `lastAttemptedMessage` through the normal lifecycle send path (#941). The
 * recorded text already carries the workspace-context prefix from the
 * original attempt, so it is passed WITHOUT a `workspaceContextStr` to avoid
 * double-prefixing. When nothing was recorded (e.g. a fresh window after the
 * failure), the action resolves as a no-op with user feedback instead of
 * silently doing nothing.
 */
async function dispatchRetryLastMessage(
  action: ReturnType<typeof agentSessionRetryLastMessageRequested>,
): Promise<void> {
  const [agentId, wsId] = action.payload;
  const state = appStore.state as {
    chatState?: {
      byAgentId: Record<string, { lastAttemptedMessage: LastAttemptedMessage | null }>;
    };
  };
  const lastAttempted = state.chatState?.byAgentId[agentId]?.lastAttemptedMessage;
  if (!lastAttempted || lastAttempted.text.trim().length === 0) {
    logger.warn("Retry requested but no lastAttemptedMessage is recorded", { agentId, wsId });
    try {
      const { toast } = await import("svelte-sonner");
      toast.info("Nothing to retry — send a message to start a new turn.");
    } catch (error) {
      logger.error("Failed to surface retry no-op feedback", error);
    }
    appStore.dispatch(action.success(undefined as void));
    return;
  }
  try {
    await dispatchToLifecycle(
      agentId,
      wsId,
      lastAttempted.text,
      undefined,
      { noteIds: lastAttempted.options?.noteIds, model: lastAttempted.options?.model },
      false,
    );
    appStore.dispatch(action.success(undefined as void));
  } catch (error) {
    // dispatchToLifecycle surfaces its own failures via chatSendFailed and
    // should not throw; reject the promise if it unexpectedly does.
    logger.error("Retry-last-message dispatch threw", error);
    appStore.dispatch(
      action.failure(error instanceof Error ? error : new Error(String(error))),
    );
  }
}

/**
 * Service the model-unavailable banner's "Retry with <model>": resend the
 * recorded `lastAttemptedMessage` through the normal lifecycle send path with
 * the suggested model as a one-shot send-option override (#964) — the
 * lifecycle send resolves the wire model as `options.model ?? session.model`,
 * so no session mutation is needed. Mirrors `dispatchRetryLastMessage`
 * otherwise: no `workspaceContextStr` (the recorded text already carries the
 * prefix), and a no-op with user feedback when nothing was recorded.
 */
async function dispatchRetryWithModel(
  action: ReturnType<typeof agentSessionRetryWithModelRequested>,
): Promise<void> {
  const [agentId, wsId, model] = action.payload;
  const state = appStore.state as {
    chatState?: {
      byAgentId: Record<string, { lastAttemptedMessage: LastAttemptedMessage | null }>;
    };
  };
  const lastAttempted = state.chatState?.byAgentId[agentId]?.lastAttemptedMessage;
  if (!lastAttempted || lastAttempted.text.trim().length === 0) {
    logger.warn("Retry-with-model requested but no lastAttemptedMessage is recorded", {
      agentId,
      wsId,
      model,
    });
    try {
      const { toast } = await import("svelte-sonner");
      toast.info("Nothing to retry — send a message to start a new turn.");
    } catch (error) {
      logger.error("Failed to surface retry no-op feedback", error);
    }
    appStore.dispatch(action.success(undefined as void));
    return;
  }
  try {
    await dispatchToLifecycle(
      agentId,
      wsId,
      lastAttempted.text,
      undefined,
      { noteIds: lastAttempted.options?.noteIds, model },
      false,
    );
    appStore.dispatch(action.success(undefined as void));
  } catch (error) {
    // dispatchToLifecycle surfaces its own failures via chatSendFailed and
    // should not throw; reject the promise if it unexpectedly does.
    logger.error("Retry-with-model dispatch threw", error);
    appStore.dispatch(
      action.failure(error instanceof Error ? error : new Error(String(error))),
    );
  }
}

/**
 * Service the Stop button: cancel the agent's in-flight stream via
 * `agent.stop` (§5.5) and settle the async action's promise. A missing
 * session resolves immediately (nothing to stop). A non-success stop result
 * is a transport-level failure (the seam folds RPC throws into
 * MutationResult); it is logged but the stop flow still completes — the
 * daemon's terminal `agent:stream:end` is the authoritative convergence
 * signal, and the UI must not stay stuck in the "interrupting" state.
 */
async function dispatchStopChat(
  action: ReturnType<typeof agentSessionStopChatRequested>,
): Promise<void> {
  const [agentId] = action.payload;
  // Direct one-time session-existence read, dependency-light (no selector
  // import) — mirrors agent-mutation-service's readSession.
  const state = appStore.state as { agentSessions?: { byAgentId: Record<string, unknown> } };
  if (!state.agentSessions?.byAgentId[agentId]) {
    appStore.dispatch(action.success(undefined as void));
    return;
  }
  appStore.dispatch(chatStopInitiated(agentId));
  try {
    const result = await appClient.agents.stop(agentId);
    if (!result.success) {
      logger.warn("agent.stop reported a non-success result", {
        agentId,
        error: result.error,
      });
    }
    appStore.dispatch(chatStopCompleted(agentId));
    appStore.dispatch(action.success(undefined as void));
  } catch (error) {
    // The seam should not throw; if it does, still clear the interrupting
    // flag so the Stop button doesn't wedge, then reject the promise.
    logger.error("agent.stop threw", error);
    appStore.dispatch(chatStopCompleted(agentId));
    appStore.dispatch(
      action.failure(error instanceof Error ? error : new Error(String(error))),
    );
  }
}

/**
 * Middleware that gives `sendMessage`, `removeQueuedMessageRequested`,
 * `agentSessionStopChatRequested`, `agentSessionRetryLastMessageRequested`,
 * and `agentSessionRetryWithModelRequested` a real consumer. Fire-and-forget —
 * dispatch stays synchronous and never throws.
 */
export function createChatSendMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    const result = next(action);
    if (!action || typeof action !== "object") return result;

    if ((action as { type?: unknown }).type === sendMessage.type) {
      const payload = (action as { payload?: unknown }).payload as
        | { agentId?: unknown; payload?: SendMessagePayload & { wsId?: string } }
        | undefined;
      const agentId = payload?.agentId;
      const inner = payload?.payload;
      if (
        typeof agentId === "string" &&
        agentId.length > 0 &&
        inner &&
        typeof inner.wsId === "string" &&
        inner.wsId.length > 0 &&
        typeof inner.text === "string" &&
        inner.text.length > 0
      ) {
        // Capture strings upfront so TypeScript knows they're definitely strings
        // inside the async closure below.
        const agentIdStr = agentId;
        const wsIdStr = inner.wsId;
        const textStr = inner.text;
        const forceSubmit = inner.forceSubmit === true;
        const queuedMessageId = inner.queuedMessageId;
        const workspaceContextStr = inner.workspaceContextStr;
        const imageBlocks = inner.imageBlocks;
        const noteIds = inner.noteIds;

        // STAB-68 fix: when queuedMessageId is present (user clicked "Send now"
        // on a queued message), remove the queued entry BEFORE dispatching the
        // lifecycle send, so the daemon queue can't re-deliver the same message
        // after the interrupt turn. The removal is idempotent (PROTOCOL §5.5),
        // so failures are logged but do not block the send.
        void (async () => {
          if (typeof queuedMessageId === "string" && queuedMessageId.length > 0) {
            try {
              await dispatchQueueRemoval(agentIdStr, queuedMessageId);
            } catch (error) {
              logger.warn("Queue removal failed; proceeding with send (removal is idempotent)", {
                agentId: agentIdStr,
                queuedMessageId,
                error,
              });
            }
          }

          await dispatchToLifecycle(
            agentIdStr,
            wsIdStr,
            textStr,
            workspaceContextStr,
            {
              imageBlocks,
              noteIds,
              // STAB-38 fix: set priority: "interrupt" when force-send is active.
              // The daemon will preempt the in-flight turn per PROTOCOL.md §5.5.
              priority: forceSubmit ? "interrupt" : undefined,
            },
            forceSubmit,
          );
        })();
      }
    } else if ((action as { type?: unknown }).type === removeQueuedMessageRequested.type) {
      const payload = (action as { payload?: unknown }).payload as
        | [agentId?: unknown, messageId?: unknown]
        | undefined;
      const agentId = payload?.[0];
      const messageId = payload?.[1];
      if (
        typeof agentId === "string" &&
        agentId.length > 0 &&
        typeof messageId === "string" &&
        messageId.length > 0
      ) {
        void dispatchQueueRemoval(agentId, messageId);
      }
    } else if ((action as { type?: unknown }).type === agentSessionStopChatRequested.type) {
      const stopAction = action as ReturnType<typeof agentSessionStopChatRequested>;
      const [agentId] = stopAction.payload ?? [];
      if (typeof agentId === "string" && agentId.length > 0) {
        void dispatchStopChat(stopAction);
      }
    } else if (
      (action as { type?: unknown }).type === agentSessionRetryLastMessageRequested.type
    ) {
      const retryAction = action as ReturnType<typeof agentSessionRetryLastMessageRequested>;
      const [agentId, wsId] = retryAction.payload ?? [];
      if (
        typeof agentId === "string" &&
        agentId.length > 0 &&
        typeof wsId === "string" &&
        wsId.length > 0
      ) {
        void dispatchRetryLastMessage(retryAction);
      }
    } else if (
      (action as { type?: unknown }).type === agentSessionRetryWithModelRequested.type
    ) {
      const retryAction = action as ReturnType<typeof agentSessionRetryWithModelRequested>;
      const [agentId, wsId, model] = retryAction.payload ?? [];
      if (
        typeof agentId === "string" &&
        agentId.length > 0 &&
        typeof wsId === "string" &&
        wsId.length > 0 &&
        typeof model === "string" &&
        model.length > 0
      ) {
        void dispatchRetryWithModel(retryAction);
      }
    }

    return result;
  };
}
