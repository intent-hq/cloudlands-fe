import { call, cancelled, put, select } from 'typed-redux-saga';
import type { SagaGenerator } from 'typed-redux-saga';
import { getCommitHistory } from '../changes-projections';
import {
  commitHistoryStarted,
  commitHistorySucceeded,
  commitHistoryFailed,
} from '../changes-slice';
import type { CommitHistoryRequest, CommitHistoryWorkerDependencies } from '../changes-types';

/** Shared policy only. Each renderer binds its existing refresh/page action watcher once. */
export function createCommitHistoryWorkers(dependencies: CommitHistoryWorkerDependencies) {
  function* read(workspaceId: string, reset: boolean, older: boolean): SagaGenerator<void> {
    const context = yield* dependencies.admittedContext(workspaceId);
    if (!context) return;
    const history = yield* select(getCommitHistory, workspaceId);
    const list = older ? 'older' : 'current';
    const previous = history[list];
    if (
      !reset &&
      (history.context !== context ||
        !history.generation ||
        !history.current.loaded ||
        history.current.loading ||
        previous.loading ||
        (previous.loaded && previous.nextToken === null) ||
        previous.consumedTokens.includes(previous.nextToken))
    )
      return;

    const requestId = crypto.randomUUID();
    const generation = reset ? requestId : history.generation;
    if (!generation) return;
    const request: CommitHistoryRequest = {
      context,
      generation,
      requestId,
      list,
      pageToken: reset ? null : previous.nextToken,
      reset,
    };
    let live = true;
    const transportCurrent = () =>
      live &&
      (!dependencies.readCurrentContext ||
        dependencies.readCurrentContext(workspaceId) === context);
    function* current(): SagaGenerator<boolean> {
      if (!transportCurrent()) return false;
      if ((yield* dependencies.admittedContext(workspaceId)) !== context) return false;
      const latest = yield* select(getCommitHistory, workspaceId);
      return (
        latest.context === context &&
        latest.generation === request.generation &&
        latest[list].requestId === requestId
      );
    }

    yield* put(commitHistoryStarted(workspaceId, request));
    try {
      if (!(yield* current())) return;
      const page = yield* call(
        dependencies.readPage,
        workspaceId,
        {
          includeOlder: older,
          limit: dependencies.pageSize ?? 20,
          ...(request.pageToken !== null ? { pageToken: request.pageToken } : {}),
        },
        transportCurrent,
      );
      if (!(yield* current())) return;
      if (
        page.nextToken !== null &&
        (page.nextToken === request.pageToken ||
          (!reset && previous.consumedTokens.includes(page.nextToken)))
      ) {
        // i18n-ignore (internal wire-contract diagnostic)
        throw new Error('Commit history returned a repeated page token');
      }
      yield* put(commitHistorySucceeded(workspaceId, request, page));
    } catch (error) {
      if (yield* current()) {
        yield* put(
          commitHistoryFailed(
            workspaceId,
            request,
            error instanceof Error ? error.message : String(error),
          ),
        );
      }
    } finally {
      if ((yield* cancelled()) && (yield* current())) {
        yield* put(commitHistoryFailed(workspaceId, request, null));
      }
      live = false;
    }
  }

  return {
    refresh: function* (workspaceId: string): SagaGenerator<void> {
      yield* read(workspaceId, true, false);
    },
    loadMore: function* (workspaceId: string, older = false): SagaGenerator<void> {
      yield* read(workspaceId, false, older);
    },
  };
}
