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
 * UI, clear the chat draft so the input doesn't echo the just-sent text, and
 * guard against double-send while a stream is already active. Every other
 * edge case (rebind, workspace-change reinit, queueing, force-submit, rate
 * limit) is intentionally NOT re-homed — those are out of scope per the task
 * note and will be addressed in follow-ups.
 *
 * Dependency-light per src/store AGENTS.md: top-level imports are limited to
 * the configured store, slice actions, store-free types, and the logger.
 * Selectors and the lifecycle module (which evaluate `store.createSelector`
 * at import) are dynamically imported inside the handler so they are never
 * evaluated while the store is still initializing through the middleware
 * chain.
 */
import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";
import { store as appStore } from "$store/renderer/store";
import {
  chatSendStarted,
  sendInitialMessageRequested,
  sendMessage,
} from "$store/renderer/slices/chat-state/chat-state-slice";
import { clearChatDraft } from "$store/renderer/slices/transient-ui/transient-ui-slice";
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
  const [wsSel, asSel, lifecycle] = await Promise.all([
    import("$store/renderer/slices/workspace/workspace-selectors"),
    import("$store/renderer/slices/agent-session/agent-session-selectors"),
    import("$features/agent/agent-stream-lifecycle"),
  ]);
  return {
    selectWorkspaceById: wsSel.selectWorkspaceById,
    selectAgentIsResponding: asSel.selectAgentIsResponding,
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

  // Double-send guard: a fresh send while the agent is mid-turn would race
  // the active stream handler. The old saga routed this case through the
  // queue; for now we drop it (queueing is out of scope for this task).
  if (deps.selectAgentIsResponding.select(appStore.state, agentId)) {
    logger.info("Skipping send: agent is currently responding", { agentId, wsId });
    return;
  }

  // Immediate loading-state dispatch so the UI doesn't have to wait for the
  // first lifecycle dispatch to surface the spinner / streaming indicator.
  appStore.dispatch(chatSendStarted(agentId, wsId));
  appStore.dispatch(clearChatDraft(wsId, agentId));

  const content = workspaceContextStr
    ? `${workspaceContextStr}\n\n${text.trim()}`
    : text.trim();

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
