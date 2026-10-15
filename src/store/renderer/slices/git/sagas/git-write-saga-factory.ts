import { call, cancelled, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import type { MutationResult } from '$lib/client/client-types';
import type { GitStatus } from '$shared/types';
import { reserveGitMutation } from '../../../utils/worktree-mutation-queue';
import { setGitStatus } from '../git-slice';
import { gitWriteFinished, gitWriteRequested, gitWriteStarted } from '../git-write-slice';
import type { GitWriteAuthority, GitWriteSagaDependencies } from './git-write-saga-types';

/** One write owner per renderer; transactions retain their lease through transport settlement. */
export function createGitWriteSaga(deps: GitWriteSagaDependencies) {
  function* gitWriteWorker(action: ReturnType<typeof gitWriteRequested>): SagaGenerator<void> {
    const [workspaceId, requestId, operation] = action.payload;
    const lease = reserveGitMutation(workspaceId);
    let authority: GitWriteAuthority | undefined;
    let captured = !deps.captureAuthority;
    const canPublish = () => captured && (authority?.canPublish() ?? true);
    const canDispatch = () => canPublish() && (authority?.canDispatch() ?? true);
    let result: MutationResult = { success: false, error: deps.unknownError() };
    let started = false;
    const currentIndex = operation.kind === 'commit' && operation.params.currentIndex;
    let executionCancelled = false;
    let settledCommit: MutationResult | undefined;
    let releasedWhileQueued = false;
    let snapshot: GitStatus | null | undefined;
    try {
      try {
        authority = deps.captureAuthority?.(workspaceId, operation);
        captured = true;
        yield* call(() => lease.ready);
        const entry = yield* deps.selectOperation(workspaceId, requestId);
        if (entry?.status !== 'queued' || entry.operation !== operation) return;
        if (entry.consumerReleased) {
          releasedWhileQueued = true;
          return;
        }
        if (!canPublish()) return;
        yield* put(gitWriteStarted(workspaceId, requestId));
        started = true;
        if (!canDispatch()) return;
        const execute = yield* deps.prepare(
          workspaceId,
          operation,
          () => canDispatch() && (!currentIndex || !executionCancelled),
        );
        if (!execute) return;
        if (
          deps.optimisticStatus !== false &&
          (operation.kind === 'stage' || operation.kind === 'unstage')
        ) {
          snapshot = yield* deps.selectStatus(workspaceId);
          const current = yield* deps.selectOperation(workspaceId, requestId);
          if (snapshot && current && canPublish() && !current.consumerReleased) {
            const paths = new Set(operation.paths);
            yield* put(
              setGitStatus(workspaceId, {
                ...snapshot,
                files: snapshot.files.map((file) =>
                  paths.has(file.path) ? { ...file, staged: operation.kind === 'stage' } : file,
                ),
              }),
            );
          }
        }
        result = yield* call(() =>
          lease.run(async () => {
            // The lease queues a microtask too: recheck immediately before actual I/O.
            if (!canDispatch() || (currentIndex && executionCancelled))
              return { success: false, error: deps.unknownError() };
            if (!currentIndex) return execute();
            try {
              settledCommit = await execute();
            } catch (error) {
              // The commit client handles known local refusals. An unexpected rejection
              // here cannot establish whether its transport already wrote the index.
              settledCommit = {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                commitOutcome: { state: 'unknown' },
              };
            }
            return settledCommit;
          }),
        );
      } catch (error) {
        result = { success: false, error: error instanceof Error ? error.message : String(error) };
      }
      try {
        const current = yield* deps.selectOperation(workspaceId, requestId);
        if (canPublish() && current && !current.consumerReleased && snapshot && !result.success)
          yield* put(setGitStatus(workspaceId, snapshot));
        if (started && canPublish()) {
          yield* call(() => deps.invalidate(workspaceId));
          // Failed unstage restores the snapshot without a status read.
          if (
            current &&
            !current.consumerReleased &&
            (operation.kind !== 'unstage' || result.success)
          )
            yield* deps.reconcile(workspaceId, requestId, lease, canPublish);
        }
      } finally {
        yield* call(() => lease.release());
      }
      if (started) {
        const current = yield* deps.selectOperation(workspaceId, requestId);
        if (current && !current.consumerReleased && canPublish())
          yield* deps.publish(workspaceId, operation, result, canPublish);
      }
    } catch (error) {
      // Publication failures cannot turn an already-applied Git operation into a failed write.
      deps.logError('Failed to publish Git mutation side effects', error);
    } finally {
      const wasCancelled = yield* cancelled();
      executionCancelled = wasCancelled;
      // A cancelled queued caller must not wait for unrelated work it may itself
      // be responsible for finishing. Its queue reservation still drains below.
      const queuedFailure =
        wasCancelled && !started ? action.failure(new Error(deps.unknownError())) : undefined;
      if (queuedFailure && canPublish()) yield* put(queuedFailure);
      // Cancellation does not abort the transport or a partial-index restoration.
      // Retain operation ownership until the complete transaction has settled.
      yield* call(() => lease.release());
      const retired = releasedWhileQueued || !canPublish();
      if (wasCancelled && !(currentIndex && settledCommit)) {
        const failure = { success: false, error: deps.unknownError() };
        yield* put(
          retired
            ? gitWriteFinished(workspaceId, requestId, failure, operation, true)
            : gitWriteFinished(workspaceId, requestId, failure, operation),
        );
        if (!queuedFailure) {
          const settled = action.failure(new Error(failure.error));
          if (!retired && canPublish()) yield* put(settled);
        }
      } else {
        if (currentIndex && settledCommit) result = settledCommit;
        if (started || retired)
          yield* put(
            retired
              ? gitWriteFinished(workspaceId, requestId, result, operation, true)
              : gitWriteFinished(workspaceId, requestId, result, operation),
          );
        // Settle the originating caller even when its principal no longer owns this Store.
        const settled = action.success(result);
        if (!retired && canPublish()) yield* put(settled);
      }
    }
  }

  return function* gitWriteSaga() {
    yield* takeEvery(gitWriteRequested, gitWriteWorker);
  };
}
