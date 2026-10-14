import { call, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import type { AgentsClient } from '$lib/client/app-client';
import { createLogger } from '$lib/utils/client-logger';
import type { HydratedBlockEntry } from '../chat-state-types';
import {
  messageBlockHydrationRequested,
  messageBlockHydrated,
  messageBlockHydrationFailed,
} from '../chat-state-slice';

const logger = createLogger('ChatReadSaga');

/** Shared bounded-cache and single-flight policy; the mounted reader owns cancellation. */
export function createMessageBlockHydrationWorkers({
  getMessageBlock,
  readEntry,
  readWorkspaceId,
}: {
  getMessageBlock: AgentsClient['getMessageBlock'];
  readEntry: (
    agentId: string,
    messageId: string,
    blockId: string,
  ) => SagaGenerator<HydratedBlockEntry | undefined>;
  readWorkspaceId: (agentId: string) => SagaGenerator<string | undefined>;
}) {
  function* watch(admits: (agentId: string) => boolean = () => true, retirePending = false) {
    const inFlight = new Set<string>();
    return yield* takeEvery(messageBlockHydrationRequested, function* (action) {
      const [agentId, messageId, blockId] = action.payload;
      if (!agentId || !messageId || !blockId || !admits(agentId)) return;
      const key = `${agentId}|${messageId}|${blockId}`;
      if (inFlight.has(key)) return;
      const entry = yield* readEntry(agentId, messageId, blockId);
      if (entry?.status !== 'loading') return;
      inFlight.add(key);
      let settled = false;
      try {
        const block = yield* call(
          getMessageBlock,
          agentId,
          messageId,
          blockId,
          yield* readWorkspaceId(agentId),
        );
        if (admits(agentId)) {
          yield* put(messageBlockHydrated(agentId, messageId, blockId, block));
          settled = true;
        }
      } catch (error) {
        if (admits(agentId)) {
          const message = error instanceof Error ? error.message : String(error);
          logger.warn('message block hydration failed', { agentId, messageId, blockId, message });
          yield* put(messageBlockHydrationFailed(agentId, messageId, blockId, message));
          settled = true;
        }
      } finally {
        inFlight.delete(key);
        if (retirePending && !settled) {
          yield* put(
            messageBlockHydrationFailed(
              agentId,
              messageId,
              blockId,
              'Message block hydration cancelled',
            ),
          );
        }
      }
    });
  }
  return { watch };
}
