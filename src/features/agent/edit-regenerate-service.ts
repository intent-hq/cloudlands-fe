/**
 * Edit-and-regenerate service — the post-saga consumer for the orphaned
 * `agentSessions/editAndRegenerateRequested` async-action trigger, sibling to
 * `agent-mutation-service.ts` / `chat-send-service.ts`.
 *
 * ChatPanel's `handleEditMessage` dispatches the trigger when the user edits a
 * past user message, but its saga consumer was removed with the saga runtime —
 * so the edit UI silently did nothing. This restores the path WITHOUT
 * re-adding a saga and WITHOUT changing the dispatch site:
 * `createEditRegenerateMiddleware()` observes dispatched actions and, after
 * the reducer runs, forwards to `agent.editAndRegenerate` (PROTOCOL §5.5
 * catalog-parity extension) via the `AppClient` seam.
 *
 * On success the transcript is optimistically truncated locally (the daemon
 * drops the edited message and everything after it — destructive, per the
 * contract), then the daemon's own events converge the real state: the fresh
 * user message arrives via `agent:message` (which triggers a transcript
 * refetch in the events bridge because its messageId is unknown locally) and
 * the regenerated turn streams via the normal `agent:stream:*` lifecycle. On
 * failure a toast is surfaced and the action's promise rejects so the caller
 * can react.
 *
 * `options.model` passes through as the per-request model override (the edit
 * UI has a model picker); the daemon switches the session model before the
 * regenerated turn (same semantics as `agent.setModel`).
 *
 * Dependency-light per src/store AGENTS.md: imports only the AppClient seam,
 * the configured store, slice actions, and the logger — no selector modules
 * (they evaluate `store.createSelector` during middleware-chain construction);
 * state is read directly off `appStore.state.agentSessions.byAgentId` and the
 * toast lib is imported lazily inside the handler.
 */
import type { StoreMiddleware } from "$lib/store-shim/types";
import type { AgentSession } from "$shared/types";
import { appClient } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
import {
  agentSessionEditAndRegenerateRequested,
  replaceMessages,
} from "$store/renderer/slices/agent-session/agent-session-slice";
import {
  chatLastAttemptedMessageSet,
  chatSendStarted,
} from "$store/renderer/slices/chat-state/chat-state-slice";
import { createLogger } from "$lib/utils/client-logger";

const logger = createLogger("EditRegenerateService");

/** Direct one-time session read, dependency-light (no selector import). */
function readSession(agentId: string): AgentSession | undefined {
  const state = appStore.state as { agentSessions?: { byAgentId: Record<string, AgentSession> } };
  return state.agentSessions?.byAgentId[agentId];
}

/** Surface an edit failure to the user (best-effort; never throws). */
async function showEditError(message: string): Promise<void> {
  try {
    const { toast } = await import("svelte-sonner");
    toast.error(message);
  } catch (error) {
    logger.error("Failed to surface edit-and-regenerate error", error);
  }
}

function toError(error: unknown, fallback: string): Error {
  if (error instanceof Error) return error;
  return new Error(error ? String(error) : fallback);
}

/**
 * Optimistically truncate the local transcript to just BEFORE the edited
 * message — mirroring the daemon-side truncation (`agent.editAndRegenerate`
 * drops the edited message and everything after it). The daemon's
 * `agent:message` event for the fresh user message then triggers a full
 * transcript refetch in the events bridge, converging on BE state.
 */
function truncateLocalTranscript(agentId: string, messageId: string): void {
  const session = readSession(agentId);
  if (!session) return;
  const index = session.messages.findIndex((message) => message.id === messageId);
  if (index === -1) return;
  appStore.dispatch(replaceMessages(agentId, session.messages.slice(0, index)));
}

async function handleEditAndRegenerate(
  action: ReturnType<typeof agentSessionEditAndRegenerateRequested>,
): Promise<void> {
  const [agentId, wsId, messageId, newText, options] = action.payload;
  try {
    const result = await appClient.agents.editAndRegenerate({
      agentId,
      workspaceId: wsId,
      messageId,
      content: newText,
      ...(options?.model !== undefined ? { model: options.model } : {}),
    });
    if (!result.success) {
      const message = result.error || "Failed to edit message";
      logger.error("agent.editAndRegenerate failed", message);
      await showEditError(message);
      appStore.dispatch(action.failure(new Error(message)));
      return;
    }
    truncateLocalTranscript(agentId, messageId);
    // Reset chat-state like a normal send (clears any stale error banner and
    // starts the thinking indicator immediately). Dispatched only AFTER the
    // wire call succeeds — on failure the transcript and any prior error stay
    // untouched (a toast is already surfaced above).
    appStore.dispatch(chatSendStarted(agentId, wsId));
    // Record the EDITED content as the retry payload (#941): if the
    // regenerated turn itself fails, the error banner's "Try again" must
    // resend the edited text, not a stale pre-edit lastAttemptedMessage.
    appStore.dispatch(chatLastAttemptedMessageSet(agentId, { text: newText }));
    appStore.dispatch(action.success(undefined as never));
  } catch (error) {
    logger.error("Failed to edit and regenerate", error);
    await showEditError(error instanceof Error ? error.message : "Failed to edit message");
    appStore.dispatch(action.failure(toError(error, "Failed to edit message")));
  }
}

/**
 * Middleware that gives `agentSessionEditAndRegenerateRequested` a real
 * handler: after the action passes through the (no-op) reducer, forward it to
 * the daemon and settle the action's promise. Errors inside the handler are
 * caught and surfaced via `action.failure` so the dispatch chain never throws.
 */
export function createEditRegenerateMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    const result = next(action);
    if (!action || typeof action !== "object") return result;
    if (
      (action as { type?: unknown }).type === agentSessionEditAndRegenerateRequested.type
    ) {
      void handleEditAndRegenerate(
        action as ReturnType<typeof agentSessionEditAndRegenerateRequested>,
      );
    }
    return result;
  };
}
