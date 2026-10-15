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
  beforeRead,
  admission,
  reportReadState = false,
  onError,
}: {
  readStatus: (
    workspaceId: string,
    options?: { forceRefresh?: boolean },
  ) => Promise<GitStatus | null>;
  /** Related canonical reads share this status worker's cancellation lifetime. */
  beforeRead?: (workspaceId: string, current: () => boolean) => Promise<void>;
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
  const invalidations = new Map<string, { context: string | null | undefined; pending: boolean }>();
  const contexts = new WeakMap<GitStatusReadAction, string | null | undefined>();

  function* loadGitStatusWorker(action: GitStatusReadAction): SagaGenerator<void> {
    const [workspaceId, forceRefresh] = action.payload;
    if (!workspaceId || action.type === workspaceUnmounted.type) return;
    const context = contexts.get(action);
    if (context === null || (admission && admission.readCurrentContext(workspaceId) !== context))
      return;
    const revision = invalidations.get(workspaceId);
    let active = true;
    const isCurrent = () =>
      active &&
      invalidations.get(workspaceId) === revision &&
      (!admission || admission.readCurrentContext(workspaceId) === context);

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
    try {
      for (;;) {
        if (!isCurrent()) return;
        if (isGitMutationPending(workspaceId)) yield* call(waitForGitMutations, workspaceId);
        if (!isCurrent()) return;
        const epoch = getGitMutationVersion(workspaceId);
        try {
          if (beforeRead) yield* call(beforeRead, workspaceId, isCurrent);
          if (!isCurrent()) return;
          const status = yield* call((): Promise<GitStatus | null> => {
            if (!isCurrent()) return Promise.resolve(null);
            return forceRefresh || (revision?.pending && revision.context === context)
              ? readStatus(workspaceId, { forceRefresh: true })
              : readStatus(workspaceId);
          });
          if (!isCurrent()) return;
          if (epoch !== getGitMutationVersion(workspaceId)) continue;
          if (status) {
            if (yield* publish(setGitStatus(workspaceId, toGitStatus(status)))) {
              if (revision && revision.context === context) revision.pending = false;
            }
          } else if (reportReadState)
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
    } finally {
      active = false;
    }
  }

  return function* gitStatusReadSaga() {
    const watcher = yield* takeSingleFlightInContext(
      [loadGitStatus, workspaceUnmounted],
      (action) => {
        if (action.type === workspaceUnmounted.type) invalidations.delete(action.payload[0]);
        else {
          // Bind queued work at intake; a later principal/root must send its own request.
          const context = admission?.readCurrentContext(action.payload[0]);
          contexts.set(action, context);
          // A coalesced ordinary request cannot downgrade an unfulfilled Save refresh.
          if (action.payload[2]?.invalidatePending)
            invalidations.set(action.payload[0], { context, pending: true });
        }
        return workspaceReadContext(action);
      },
      loadGitStatusWorker,
    );
    try {
      yield* join(watcher);
    } finally {
      invalidations.clear();
    }
  };
}
