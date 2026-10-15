import type { StoreAction } from '@themislib/themis/types';
import type { FileNameSearchResult } from '$lib/client/file-name-search-types';
import type { FileExplorerSearch } from '../file-explorer-types';
import { call, cancel, delay, fork, put, race, take, type SagaGenerator } from 'typed-redux-saga';
import { takeLatestInContext } from '../../../utils/context-saga-effects';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  fileSearchLoading,
  fileSearchOpened,
  fileSearchReleased,
  fileSearchRequested,
  fileSearchSettled,
  retireFileExplorer,
} from '../file-explorer-slice';

type SearchGuard = () => boolean;
type ObservedAction = { type: string; payload?: unknown };
type SearchAction =
  | ReturnType<typeof fileSearchRequested>
  | ReturnType<typeof fileSearchReleased>
  | ReturnType<typeof fileSearchOpened>;

/** The single consumer-keyed filename search owner, bound to each renderer's transport. */
export function createFileSearchSaga({
  read,
  admission,
  skipWhitespaceOnly = false,
  onError,
}: {
  read: (
    workspaceId: string,
    query: string,
    isCurrent: SearchGuard,
  ) => Promise<FileNameSearchResult>;
  admission?: {
    /** Include backend, principal epoch and absolute root identity; null denies the read. */
    readCurrentContext: (workspaceId: string) => string | null;
    /** Canonical registered consumer/request; never a parallel cache. */
    readSearch: (workspaceId: string, consumerId: string) => FileExplorerSearch | undefined;
    dispatch: (action: StoreAction<unknown>) => unknown;
  };
  skipWhitespaceOnly?: boolean;
  onError?: (error: unknown) => void;
}) {
  function matchesRegisteredRequest(request: ReturnType<typeof fileSearchRequested>): boolean {
    if (!admission) return true;
    const [wsId, consumerId, requestId, query, context] = request.payload;
    const search = admission.readSearch(wsId, consumerId);
    return (
      context !== undefined &&
      search?.workspaceId === wsId &&
      search.consumerId === consumerId &&
      search.requestId === requestId &&
      search.query === query &&
      search.context === context
    );
  }

  // A rejected old-context request must not cancel the current consumer's admitted work.
  function acceptsSearchAction(action: ObservedAction): action is SearchAction {
    if (action.type === fileSearchRequested.type)
      return matchesRegisteredRequest(action as ReturnType<typeof fileSearchRequested>);
    return action.type === fileSearchReleased.type || action.type === fileSearchOpened.type;
  }

  function* publish(action: StoreAction<unknown>, isCurrent: SearchGuard): SagaGenerator<void> {
    if (admission) {
      yield* call(() => {
        if (isCurrent()) admission.dispatch(action);
      });
    } else if (isCurrent()) {
      yield* put(action);
    }
  }

  function* searchFiles(
    action: ReturnType<typeof fileSearchRequested>,
    isCurrent: SearchGuard,
  ): SagaGenerator<void> {
    const [wsId, consumerId, requestId, query] = action.payload;
    if (!query) return;
    if (skipWhitespaceOnly && !query.trim()) {
      yield* publish(fileSearchSettled(wsId, consumerId, requestId, [], null), isCurrent);
      return;
    }
    yield* delay(50);
    if (!isCurrent()) return;
    const loader = yield* fork(function* () {
      yield* delay(500);
      yield* publish(fileSearchLoading(wsId, consumerId, requestId), isCurrent);
    });
    try {
      const result = yield* call(() => {
        if (!isCurrent()) return Promise.resolve(null);
        return read(wsId, query, isCurrent);
      });
      if (result) {
        yield* publish(
          fileSearchSettled(wsId, consumerId, requestId, result.files, null, result.truncated),
          isCurrent,
        );
      }
    } catch (error) {
      if (isCurrent()) onError?.(error);
      yield* publish(
        fileSearchSettled(
          wsId,
          consumerId,
          requestId,
          [],
          error instanceof Error ? error.message : String(error),
        ),
        isCurrent,
      );
    } finally {
      yield* cancel(loader);
    }
  }

  function* searchFilesWorker(action: SearchAction): SagaGenerator<void> {
    if (action.type !== fileSearchRequested.type) return;
    const request = action as ReturnType<typeof fileSearchRequested>;
    const [wsId, , , , requestedContext] = request.payload;
    if (!wsId) return;
    // Capture before debounce. A generation-specific active flag also fences a same-context remount.
    const context = admission?.readCurrentContext(wsId);
    if (context === null || (admission && requestedContext !== context)) return;
    let active = true;
    const isCurrent = () => {
      if (!active || admission?.readCurrentContext(wsId) !== context) return false;
      return matchesRegisteredRequest(request);
    };
    if (!isCurrent()) return;
    const isRetired = (event: ObservedAction) =>
      Array.isArray(event.payload) &&
      event.payload[0] === wsId &&
      (event.type === workspaceUnmounted.type ||
        (admission !== undefined && event.type === retireFileExplorer.type));
    try {
      yield* race({
        search: call(searchFiles, request, isCurrent),
        cleanup: take(isRetired),
      });
    } finally {
      active = false;
    }
  }

  return function* fileSearchSaga() {
    yield* takeLatestInContext(
      acceptsSearchAction,
      (action) => JSON.stringify([action.payload[0], action.payload[1]]),
      searchFilesWorker,
    );
  };
}
