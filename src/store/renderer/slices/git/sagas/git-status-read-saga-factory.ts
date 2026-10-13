import type { StoreAction } from '@themislib/themis/types';
import { call, join, put, type SagaGenerator } from 'typed-redux-saga';
import type { GitStatus } from '$shared/types';
import { m } from '$shared/paraglide/messages.js';
import { takeSingleFlightInContext } from '../../../utils/context-saga-effects';
import {
  getGitMutationVersion,
  isGitMutationPending,
  waitForGitMutations,
} from '../../../utils/worktree-mutation-queue';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { loadGitStatus, setGitStatus, setGitStatusError, setGitStatusLoading } from '../git-slice';
import { toGitStatus } from '../utils/git-status';

type GitStatusReadAction = ReturnType<typeof loadGitStatus> | ReturnType<typeof workspaceUnmounted>;

function workspaceReadContext(action: GitStatusReadAction) {
  const workspaceId = action.payload[0];
  return action.type === workspaceUnmounted.type
    ? { context: workspaceId, cancel: true as const }
    : workspaceId;
}

/** Status-only owner. Hosts keep workspaceUnmounted responsible for cache/authority cleanup. */
export function createGitStatusReadSaga({
  readStatus,
  admission,
  reportReadState = false,
  onError,
}: {
  readStatus: (
    workspaceId: string,
    options?: { forceRefresh?: boolean },
  ) => Promise<GitStatus | null>;
  admission?: {
    /** Read the current owning selector directly; never retain a selector notification. */
    readCurrentContext: (workspaceId: string) => string | null;
    /** Synchronous host Store dispatch, fenced at entry. */
    dispatch: (action: StoreAction<unknown>) => unknown;
  };
  /** Opt in for status-only surfaces; the source binding retains its existing silent reads. */
  reportReadState?: boolean;
  onError?: (error: unknown) => void;
}) {
  function* loadGitStatusWorker(action: GitStatusReadAction): SagaGenerator<void> {
    const [workspaceId, forceRefresh] = action.payload;
    if (!workspaceId || action.type === workspaceUnmounted.type) return;
    const context = admission?.readCurrentContext(workspaceId);
    if (context === null) return;
    const isCurrent = () => !admission || admission.readCurrentContext(workspaceId) === context;

    function* publish(result: StoreAction<unknown>): SagaGenerator<boolean> {
      if (!admission) {
        yield* put(result);
        return true;
      }
      return yield* call(() => {
        if (!isCurrent()) return false;
        admission.dispatch(result);
        return true;
      });
    }

    if (reportReadState && !(yield* publish(setGitStatusLoading(workspaceId)))) return;
    for (;;) {
      if (!isCurrent()) return;
      if (isGitMutationPending(workspaceId)) yield* call(waitForGitMutations, workspaceId);
      if (!isCurrent()) return;
      const epoch = getGitMutationVersion(workspaceId);
      try {
        const status = yield* call((): Promise<GitStatus | null> => {
          if (!isCurrent()) return Promise.resolve(null);
          return forceRefresh
            ? readStatus(workspaceId, { forceRefresh: true })
            : readStatus(workspaceId);
        });
        if (!isCurrent()) return;
        if (epoch !== getGitMutationVersion(workspaceId)) continue;
        if (status) yield* publish(setGitStatus(workspaceId, toGitStatus(status)));
        else if (reportReadState)
          yield* publish(setGitStatusError(workspaceId, m.git_client_statusFailed_error()));
      } catch (error) {
        if (!isCurrent()) return;
        if (epoch !== getGitMutationVersion(workspaceId)) continue;
        onError?.(error);
        if (reportReadState)
          yield* publish(
            setGitStatusError(
              workspaceId,
              error instanceof Error ? error.message : m.git_client_statusFailed_error(),
            ),
          );
      }
      return;
    }
  }

  return function* gitStatusReadSaga() {
    const watcher = yield* takeSingleFlightInContext(
      [loadGitStatus, workspaceUnmounted],
      workspaceReadContext,
      loadGitStatusWorker,
    );
    yield* join(watcher);
  };
}
