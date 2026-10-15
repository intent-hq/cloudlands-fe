import { call, cancel, fork, spawn, take, type SagaGenerator } from 'typed-redux-saga';
import { queueFileMutation } from '../../../utils/worktree-mutation-queue';
import { loadFileContentSucceeded } from '../files-slice';

// Existing transport-lifetime owner: the observer must survive caller cancellation
// until the shared mutation queue settles. Do not add another queue or read cache.
export function* serializeFileMutation<T>(
  workspaceId: string,
  relativePath: string,
  run: (relativePath: string) => Promise<T>,
  observeRead?: (action: ReturnType<typeof loadFileContentSucceeded>) => void,
): SagaGenerator<T> {
  const execute = () => queueFileMutation(workspaceId, relativePath, () => run(relativePath));
  if (!observeRead) return yield* call(execute);

  // The transport queue outlives UI cancellation. Its task owns the observer,
  // including after unmount/reopen, and releases it only when I/O settles.
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const completion = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  yield* spawn(function* () {
    const reads = yield* fork(function* () {
      while (true) observeRead(yield* take(loadFileContentSucceeded));
    });
    try {
      resolve(yield* call(execute));
    } catch (error) {
      reject(error);
    } finally {
      yield* cancel(reads);
    }
  });
  return yield* call(() => completion);
}
