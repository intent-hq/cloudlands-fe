/**
 * Chat send service — the sanctioned post-saga consumer for ChatPanel send
 * triggers, sibling to `chat-read-service.ts`.
 *
 * ChatPanel dispatches `sendMessage(agentId, { wsId, text, ... })` (and the
 * activation fallback dispatches `sendInitialMessageRequested(agentId, { wsId,
 * message, ... })`) but their sagas were removed when the saga runtime went
 * away — so Send became a no-op and pressing Send produced no user message
 * and no streamed reply. This restores the send path WITHOUT re-adding a saga
 * and WITHOUT changing any dispatch site: `createChatSendMiddleware()`
 * observes dispatched actions and, after the reducer runs, resolves the
 * target `Workspace` via the workspace selector and invokes
 * `agent-stream-lifecycle.sendMessage()` — which already owns the optimistic
 * user message, the streaming flag, and the stream-handler lifecycle.
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
  chatSendStarted,
  sendInitialMessageRequested,
  sendMessage,
} from "$store/renderer/slices/chat-state/chat-state-slice";
import { clearChatDraft } from "$store/renderer/slices/transient-ui/transient-ui-slice";
import { replaceAgentQueue } from "$store/renderer/slices/agent-queue/agent-queue-slice";
import type {
  InitialMessagePayload,
  SendMessagePayload,
} from "$store/renderer/slices/chat-state/chat-state-types";
import { createLogger } from "$lib/utils/client-logger";

const logger = createLogger("ChatSendService");

type LifecycleSendOptions = {
  imageBlocks?: SendMessagePayload["imageBlocks"];
  noteIds?: string[];
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
): Promise<void> {
  let deps: SendDeps;
  try {
    deps = await loadSendDeps();
  } catch (error) {
    logger.error("Failed to load chat send deps", error);
    return;
  }

  const workspace = deps.selectWorkspaceById.select(appStore.state, wsId);
  if (!workspace) {
    logger.warn("Cannot send: workspace not found", { agentId, wsId });
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
  if (deps.selectAgentIsResponding.select(appStore.state, agentId)) {
    appStore.dispatch(clearChatDraft(wsId, agentId));
    try {
      const result = await appClient.agents.queue(agentId, content);
      if (!result.success) {
        logger.warn("agent.queueMessage rejected by daemon", {
          agentId,
          wsId,
          error: result.error,
        });
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
      logger.error("agent.queueMessage threw", error);
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
    });
  } catch (error) {
    logger.error("lifecycle.sendMessage threw", error);
  }
}

/**
 * Middleware that gives `sendMessage` and `sendInitialMessageRequested` a real
 * consumer. Fire-and-forget — dispatch stays synchronous and never throws.
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
    } else if ((action as { type?: unknown }).type === sendInitialMessageRequested.type) {
      const payload = (action as { payload?: unknown }).payload as
        | { agentId?: unknown; payload?: InitialMessagePayload }
        | undefined;
      const agentId = payload?.agentId;
      const inner = payload?.payload;
      if (
        typeof agentId === "string" &&
        agentId.length > 0 &&
        inner &&
        !inner.alreadySent &&
        typeof inner.wsId === "string" &&
        inner.wsId.length > 0 &&
        typeof inner.message === "string" &&
        inner.message.length > 0
      ) {
        void dispatchToLifecycle(agentId, inner.wsId, inner.message, undefined, {
          imageBlocks: inner.imageBlocks ?? undefined,
        });
      }
    }

    return result;
  };
}
