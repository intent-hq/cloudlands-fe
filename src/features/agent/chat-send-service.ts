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
import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";
import { appClient } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
import {
  chatSendFailed,
  chatSendStarted,
  chatStopCompleted,
  chatStopInitiated,
  sendMessage,
} from "$store/renderer/slices/chat-state/chat-state-slice";
import { agentSessionStopChatRequested } from "$store/renderer/slices/agent-session/agent-session-slice";
import { clearChatDraft } from "$store/renderer/slices/transient-ui/transient-ui-slice";
import {
  removeQueuedMessageFromAgentQueue,
  removeQueuedMessageRequested,
  replaceAgentQueue,
} from "$store/renderer/slices/agent-queue/agent-queue-slice";
import type { SendMessagePayload } from "$store/renderer/slices/chat-state/chat-state-types";
import { createLogger } from "$lib/utils/client-logger";

const logger = createLogger("ChatSendService");

type LifecycleSendOptions = {
  imageBlocks?: SendMessagePayload["imageBlocks"];
  noteIds?: string[];
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
      const result = await appClient.agents.queue(agentId, content);
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
  appStore.dispatch(clearChatDraft(wsId, agentId));

  try {
    await deps.sendMessage(agentId, content, workspace, {
      imageBlocks: options.imageBlocks,
      noteIds: options.noteIds,
      // Pass priority: "interrupt" when force-send is active (STAB-38 fix).
      // The daemon will preempt the in-flight turn instead of queueing.
      priority: options.priority,
    });
  } catch (error) {
    // AUDIT-P0-2: dispatch chatSendFailed so the error appears in the UI
    // instead of being swallowed in a fire-and-forget background promise.
    const message = error instanceof Error ? error.message : String(error);
    logger.error("lifecycle.sendMessage threw", error);
    appStore.dispatch(chatSendFailed(agentId, message));
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
 * Middleware that gives `sendMessage`, `removeQueuedMessageRequested`, and
 * `agentSessionStopChatRequested` a real consumer. Fire-and-forget — dispatch
 * stays synchronous and never throws.
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
        void dispatchToLifecycle(agentId, inner.wsId, inner.text, inner.workspaceContextStr, {
          imageBlocks: inner.imageBlocks,
          noteIds: inner.noteIds,
        });
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
    }

    return result;
  };
}
