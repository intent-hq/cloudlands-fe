import type { SagaGenerator } from 'typed-redux-saga';
import { call, put } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { takeLeadingByWorkspace } from '../../../utils/context-saga-effects';
import { selectGraphHistoryStatus } from '../agent-overview-history-selectors';
import {
  GRAPH_HISTORY_MAX_EVENTS,
  graphHistoryLoadCompleted,
  graphHistoryLoadFailed,
  graphHistoryLoadStarted,
  graphHistoryPageReceived,
  loadGraphHistoryRequested,
  sanitizeGraphHistoryEvents,
} from '../agent-overview-history-slice';

export function* loadGraphHistoryWorker(
  action: ReturnType<typeof loadGraphHistoryRequested>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  const status = yield* selectGraphHistoryStatus.effect(workspaceId);
  if (status === 'complete') return;

  yield* put(graphHistoryLoadStarted(workspaceId));
  const seenIds = new Set<string>();
  const seenTokens = new Set<string>();
  let nextToken: string | null = null;

  try {
    do {
      const page: Awaited<ReturnType<typeof appClient.events.queryPage>> = yield* call(
        [appClient.events, appClient.events.queryPage],
        workspaceId,
        { limit: 200, ...(nextToken ? { nextToken } : {}) },
      );
      const remaining = GRAPH_HISTORY_MAX_EVENTS - seenIds.size;
      const events = sanitizeGraphHistoryEvents(page.items, workspaceId)
        .filter((event) => {
          if (seenIds.has(event.id)) return false;
          seenIds.add(event.id);
          return true;
        })
        .slice(0, remaining);
      const responseToken = page.nextToken;
      const pagingDidNotProgress =
        responseToken !== null &&
        (events.length === 0 || responseToken === nextToken || seenTokens.has(responseToken));
      if (nextToken !== null) seenTokens.add(nextToken);
      nextToken = responseToken;
      yield* put(graphHistoryPageReceived(workspaceId, events, nextToken));
      if (pagingDidNotProgress) {
        yield* put(graphHistoryLoadFailed(workspaceId));
        return;
      }
    } while (nextToken !== null && seenIds.size < GRAPH_HISTORY_MAX_EVENTS);

    yield* put(graphHistoryLoadCompleted(workspaceId, new Date().toISOString()));
  } catch {
    yield* put(graphHistoryLoadFailed(workspaceId));
  }
}

export function* agentOverviewHistorySaga(): SagaGenerator<void> {
  yield* takeLeadingByWorkspace(loadGraphHistoryRequested, loadGraphHistoryWorker);
}
