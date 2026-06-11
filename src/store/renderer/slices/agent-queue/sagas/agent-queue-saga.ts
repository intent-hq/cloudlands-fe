import { invoke } from "$lib/electron-bridge";
import { createLogger } from "$lib/utils/client-logger";
import { takeEveryFromElectronChannel } from "$store/renderer/utils/ipc-channel";
import { AGENT_BACKEND_CHANNELS } from "$shared/ipc/channels";
import type { QueuedMessage } from "$shared/types";
import {
  call,
  cancelled,
  fork,
  put,
  takeEvery,
  type SagaGenerator,
} from "typed-redux-saga";
import {
  hydrateAgentQueueRequested,
  removeQueuedMessageFromAgentQueue,
  removeQueuedMessageRequested,
  replaceAgentQueue,
  restoreRecentlyRemovedMessageId,
  setAgentQueueError,
  setAgentQueueHydrating,
} from "../agent-queue-slice";

const logger = createLogger("AgentQueueSaga");

type QueueUpdatedData = {
  agentId?: string;
  queue?: QueuedMessage[];
};

type QueueOperationResult = {
  success: boolean;
  queue?: QueuedMessage[];
  error?: string;
};

type WrappedQueueResponse = {
  success: boolean;
  data?: QueueOperationResult;
  error?: { message?: string } | string;
};

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return fallback;
}

export function normalizeQueue(queue: QueuedMessage[] | undefined): QueuedMessage[] {
  return Array.isArray(queue) ? queue.map((message) => ({ ...message })) : [];
}

export function unwrapQueueResponse(
  result: QueueOperationResult | WrappedQueueResponse,
): QueueOperationResult {
  if ("data" in result && result.data !== undefined) {
    return result.data;
  }
  if ("queue" in result) {
    return result as QueueOperationResult;
  }
  const error = typeof result.error === "string" ? result.error : result.error?.message;
  return { success: false, error: error || "IPC call failed" };
}

export function* handleQueueUpdated(data: QueueUpdatedData): SagaGenerator<void> {
  if (!data.agentId) {
    logger.warn("Received queue update without agentId", { data });
    return;
  }
  const queue = normalizeQueue(data.queue);
  yield* put(replaceAgentQueue(data.agentId, queue));
  logger.debug("Queue updated in Redux", { agentId: data.agentId, count: queue.length });
}

export function* hydrateAgentQueue(
  action: ReturnType<typeof hydrateAgentQueueRequested>,
): SagaGenerator<void> {
  const [agentId] = action.payload;
  try {
    const response = yield* call(
      invoke<QueueOperationResult | WrappedQueueResponse>,
      AGENT_BACKEND_CHANNELS.GET_QUEUE,
      { agentId },
    );
    const result = unwrapQueueResponse(response);
    if (result.success) {
      yield* put(replaceAgentQueue(agentId, normalizeQueue(result.queue)));
    } else {
      const error = result.error || "Failed to hydrate queued messages";
      yield* put(setAgentQueueError(agentId, error));
      logger.warn("Failed to hydrate queued messages", { agentId, error });
    }
  } catch (error) {
    const message = errorMessage(error, "Error hydrating queued messages");
    yield* put(setAgentQueueError(agentId, message));
    logger.error("Error hydrating queued messages", { agentId, error });
  } finally {
    if (yield* cancelled()) {
      yield* put(setAgentQueueHydrating(agentId, false));
    }
  }
}

export function* removeQueuedMessage(
  action: ReturnType<typeof removeQueuedMessageRequested>,
): SagaGenerator<void> {
  const [agentId, messageId] = action.payload;
  // Optimistic removal so the UI updates immediately; the tombstone in
  // recentlyRemovedMessageIds suppresses stale queue:updated echoes.
  yield* put(removeQueuedMessageFromAgentQueue(agentId, messageId));
  try {
    const response = yield* call(
      invoke<QueueOperationResult | WrappedQueueResponse>,
      AGENT_BACKEND_CHANNELS.REMOVE_QUEUED,
      { agentId, messageId },
    );
    const result = unwrapQueueResponse(response);
    if (!result.success) {
      const error = result.error || "Failed to remove queued message";
      logger.error("Failed to remove queued message", { agentId, messageId, error });
      yield* put(restoreRecentlyRemovedMessageId(agentId, messageId));
      yield* put(hydrateAgentQueueRequested(agentId));
    }
  } catch (error) {
    logger.error("Error removing queued message", { agentId, messageId, error });
    yield* put(restoreRecentlyRemovedMessageId(agentId, messageId));
    yield* put(hydrateAgentQueueRequested(agentId));
  }
}

export function* watchQueueUpdatedSaga(): SagaGenerator<void> {
  yield* takeEveryFromElectronChannel<QueueUpdatedData>(
    "agent:queue:updated",
    function* (data) {
      yield* call(handleQueueUpdated, data);
    },
  );
}

export function* watchQueueHydrationSaga(): SagaGenerator<void> {
  yield* takeEvery(hydrateAgentQueueRequested, hydrateAgentQueue);
}

export function* watchQueueRemovalSaga(): SagaGenerator<void> {
  yield* takeEvery(removeQueuedMessageRequested, removeQueuedMessage);
}

export function* agentQueueSaga(): SagaGenerator<void> {
  yield* fork(watchQueueUpdatedSaga);
  yield* fork(watchQueueHydrationSaga);
  yield* fork(watchQueueRemovalSaga);
}