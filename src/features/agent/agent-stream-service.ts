/**
 * Agent stream service — the sanctioned post-saga consumer for the orphaned
 * `agentStreamUpdateReceived` action, sibling to `chat-read-service.ts` /
 * `agent-read-service.ts`.
 *
 * The agent-stream-lifecycle producer correctly forwards every streamed chunk /
 * tool block / completion as `agentStreamUpdateReceived`, but the old
 * `agent-stream-saga` that translated those payloads into agent-session message
 * mutations was deleted with the saga runtime. The dispatch therefore became a
 * no-op and a streaming agent's text/tool blocks never grew live in the chat
 * panel. This restores the append path WITHOUT a saga and WITHOUT touching the
 * producer or any call site: `createAgentStreamMiddleware()` observes every
 * dispatched action and, on `agentStreamUpdateReceived`, applies the payload
 * to the agent-session slice (placeholder on first event, in-place block update
 * on subsequent events, finalize on complete / error / timeout).
 *
 * Dependency-light per src/store AGENTS.md: imports only the agent-session
 * slice actions, the two stream utils, the configured store, the action
 * creator + payload type, and the logger. No new IPC, no selectors, no new
 * slice/state.
 */
import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";
import type { AgentMessage, AgentSession } from "$shared/types";
import { store as appStore } from "$store/renderer/store";
import {
  addMessage,
  updateMessage,
} from "$store/renderer/slices/agent-session/agent-session-slice";
import {
  agentStreamUpdateReceived,
  type AgentStreamUpdatePayload,
} from "$store/renderer/slices/workspace-agents/workspace-agents-stream-slice";
import { resolveStreamContentBlocks } from "$store/renderer/slices/agent-session/utils/stream-content-blocks";
import {
  findInFlightAssistantMessage,
  isStaleFinalizedAssistantStream,
} from "$store/renderer/slices/agent-session/utils/stream-target-state";
import { createLogger } from "$lib/utils/client-logger";

const logger = createLogger("AgentStreamService");

/** Direct one-time session read, dependency-light (no selector import). */
function readSession(agentId: string): AgentSession | undefined {
  const state = appStore.state as { agentSessions?: { byAgentId: Record<string, AgentSession> } };
  return state.agentSessions?.byAgentId[agentId];
}

function applyStreamPayload(payload: AgentStreamUpdatePayload): void {
  const {
    agentId,
    eventType,
    contentBlocks,
    assistantMessageId,
    assistantAppMessageId,
  } = payload;
  if (!agentId) return;

  const session = readSession(agentId);
  const existing = findInFlightAssistantMessage(session, assistantAppMessageId);

  if (eventType === "error" || eventType === "timeout") {
    if (!existing) return;
    appStore.dispatch(
      updateMessage(agentId, existing.id, {
        isStreaming: false,
        streamingComplete: true,
      }),
    );
    return;
  }

  if (!existing) {
    if (isStaleFinalizedAssistantStream(session, assistantAppMessageId)) return;
    if (!assistantMessageId) return;
    const placeholderBlocks = resolveStreamContentBlocks(undefined, contentBlocks, eventType) ?? [];
    const placeholder: AgentMessage = {
      id: assistantMessageId,
      ...(assistantAppMessageId ? { appMessageId: assistantAppMessageId } : {}),
      role: "assistant",
      contentBlocks: placeholderBlocks,
      timestamp: new Date(payload.timestamp ?? Date.now()).toISOString(),
      isStreaming: eventType !== "complete",
      streamingComplete: eventType === "complete",
    };
    appStore.dispatch(addMessage(agentId, placeholder));
    return;
  }

  const nextBlocks = resolveStreamContentBlocks(existing.contentBlocks, contentBlocks, eventType);

  if (eventType === "complete") {
    const updates: Partial<AgentMessage> = {
      isStreaming: false,
      streamingComplete: true,
    };
    if (nextBlocks && nextBlocks !== existing.contentBlocks) {
      updates.contentBlocks = nextBlocks;
    }
    appStore.dispatch(updateMessage(agentId, existing.id, updates));
    return;
  }

  if (!nextBlocks || nextBlocks === existing.contentBlocks) return;
  appStore.dispatch(
    updateMessage(agentId, existing.id, {
      contentBlocks: nextBlocks,
      isStreaming: true,
    }),
  );
}

/**
 * Middleware that gives `agentStreamUpdateReceived` a real handler: after the
 * action passes through the reducer, it applies the streamed payload to the
 * in-flight assistant message in the agent-session slice. Errors are swallowed
 * (logged only) so a malformed payload never blocks dispatch.
 */
export function createAgentStreamMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    const result = next(action);
    if (action && action.type === agentStreamUpdateReceived.type) {
      const payload = Array.isArray(action.payload)
        ? (action.payload[0] as AgentStreamUpdatePayload | undefined)
        : undefined;
      if (payload && typeof payload === "object") {
        try {
          applyStreamPayload(payload);
        } catch (error) {
          logger.error("Failed to apply agent stream update", error);
        }
      }
    }
    return result;
  };
}
