import { call, join, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import { buffers, channel, type Channel } from 'redux-saga';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  gitReadRequested,
  releaseGitRead,
  gitReadStarted,
  gitReadCompleted,
  gitReadsInvalidated,
} from '../git-slice';
import type {
  GitConsumerReadDependencies,
  GitReadResource as Resource,
  GitReadMessage as ReadMessage,
} from '../git-types';
import { gitReadKey } from '../utils/git-read-key';
import { takeSingleFlightInContext } from '../../../utils/context-saga-effects';

function hasAuthority(resource: Resource): boolean {
  // A tracked transcript's callback fences current-file I/O only. Its recorded
  // content (or unavailable result) must still settle when that I/O is denied.
  return [...resource.consumers.values()].some(
    (consumer) =>
      resource.request.kind === 'trackedDiff' || !consumer.canRead || consumer.canRead(),
  );
}

/** One transport-lifetime owner over the canonical Git slice; bound once by each app. */
export function createGitConsumerReadSaga(dependencies: GitConsumerReadDependencies) {
  function* publish(
    action: ReturnType<typeof gitReadStarted> | ReturnType<typeof gitReadCompleted>,
    canRead: () => boolean,
  ): SagaGenerator<boolean> {
    const dispatch = dependencies.dispatch;
    if (dispatch) {
      return yield* call(() => {
        if (!canRead()) return false;
        dispatch(action);
        return true;
      });
    }
    if (!canRead()) return false;
    yield* put(action);
    return true;
  }

  function* refresh({ resource }: ReadMessage): SagaGenerator<void> {
    const controller = new AbortController();
    const revision = resource.revision;
    resource.failed = false;
    const current = () =>
      !controller.signal.aborted && revision === resource.revision && hasAuthority(resource);
    try {
      do {
        if (!current()) return;
        if (dependencies.isMutationPending(resource.workspaceId, resource.request.gitRootId))
          yield* call(
            dependencies.waitForMutations,
            resource.workspaceId,
            resource.request.gitRootId,
          );
        if (!current()) return;
        // Capture authorizers at admission. A new principal's consumer must never
        // authorize publication of a request sent under a retired principal.
        const authorizers = [...resource.consumers.values()];
        const canReadFiles = () =>
          current() && authorizers.some((consumer) => !consumer.canRead || consumer.canRead());
        const canRead = () =>
          current() && (resource.request.kind === 'trackedDiff' || canReadFiles());
        const generation = crypto.randomUUID();
        const epoch = dependencies.getMutationVersion(
          resource.workspaceId,
          resource.request.gitRootId,
        );
        const pending = dependencies.isMutationPending(
          resource.workspaceId,
          resource.request.gitRootId,
        );
        const canPublish = () =>
          canRead() &&
          !pending &&
          epoch ===
            dependencies.getMutationVersion(resource.workspaceId, resource.request.gitRootId);
        if (
          !(yield* publish(gitReadStarted(resource.workspaceId, resource.key, generation), canRead))
        )
          return;
        try {
          // The injected reader receives the same live fence for any nested I/O.
          const result = yield* call(function* admittedRead() {
            if (!canRead()) return undefined;
            return yield* call(
              dependencies.read,
              resource.workspaceId,
              resource.request,
              controller.signal,
              canReadFiles,
            );
          });
          if (result && canPublish()) {
            resource.failed = result.kind === 'commitDetails' && result.details === null;
            yield* publish(
              gitReadCompleted(resource.workspaceId, resource.key, generation, result, null),
              canPublish,
            );
            return;
          }
        } catch (error) {
          if (canPublish()) {
            resource.failed = true;
            yield* publish(
              gitReadCompleted(
                resource.workspaceId,
                resource.key,
                generation,
                null,
                error instanceof Error ? error.message : String(error),
              ),
              canPublish,
            );
            return;
          }
        }
      } while (current());
    } finally {
      controller.abort();
    }
  }

  function* requested(
    resources: Map<string, Resource>,
    reads: Channel<ReadMessage>,
    action: ReturnType<typeof gitReadRequested>,
  ): SagaGenerator<void> {
    const [workspaceId, consumerId, requestId, request, canRead] = action.payload;
    if (request.kind !== 'trackedDiff' && canRead && !canRead()) return;
    const key = gitReadKey(request);
    for (const [id, entry] of resources) {
      if (entry.workspaceId !== workspaceId || entry.key === key) continue;
      entry.consumers.delete(consumerId);
      if (!entry.consumers.size) {
        yield* put(reads, { resource: entry, cancel: true });
        resources.delete(id);
      }
    }
    const id = JSON.stringify([workspaceId, key]);
    let resource = resources.get(id);
    if (resource) {
      if (!hasAuthority(resource)) {
        resource.revision++;
        resource.failed = true;
      }
      resource.consumers.set(consumerId, { requestId, canRead });
      if (resource.failed) {
        // Retry only on an explicit request; pending and successful resources stay shared.
        resource.failed = false;
        yield* put(reads, { resource });
      }
      return;
    }
    resource = {
      workspaceId,
      key,
      request,
      consumers: new Map([[consumerId, { requestId, canRead }]]),
      revision: 0,
      failed: false,
    };
    resources.set(id, resource);
    yield* put(reads, { resource });
  }

  function* released(
    resources: Map<string, Resource>,
    reads: Channel<ReadMessage>,
    action: ReturnType<typeof releaseGitRead> | ReturnType<typeof workspaceUnmounted>,
  ): SagaGenerator<void> {
    const [workspaceId, consumerId, requestId] = action.payload;
    for (const [id, resource] of resources) {
      if (resource.workspaceId !== workspaceId) continue;
      if (action.type === workspaceUnmounted.type) resource.consumers.clear();
      else if (consumerId && resource.consumers.get(consumerId)?.requestId === requestId)
        resource.consumers.delete(consumerId);
      if (!resource.consumers.size) {
        yield* put(reads, { resource, cancel: true });
        resources.delete(id);
      }
    }
  }

  function* invalidated(
    resources: Map<string, Resource>,
    reads: Channel<ReadMessage>,
    action: ReturnType<typeof gitReadsInvalidated>,
  ): SagaGenerator<void> {
    const [workspaceId, gitRootId, scope] = action.payload;
    for (const resource of resources.values()) {
      if (resource.workspaceId !== workspaceId || resource.request.gitRootId !== gitRootId)
        continue;
      if (scope) {
        const request = resource.request;
        // Saving a worktree file cannot change staged or immutable commit reads.
        if (request.kind !== 'diffs' || request.staged || request.commitHash) continue;
        const paths = [...(request.paths ?? []), ...(request.path ? [request.path] : [])];
        if (paths.length && !paths.includes(scope.worktreePath)) continue;
      }
      resource.revision++;
      resource.failed = false;
      yield* put(reads, { resource });
    }
  }

  return function* gitConsumerReadOwnerSaga(): SagaGenerator<void> {
    const resources = new Map<string, Resource>();
    const reads = channel<ReadMessage>(buffers.expanding());
    try {
      const owner = yield* takeSingleFlightInContext(
        reads,
        ({ resource, cancel }) => {
          const context = JSON.stringify([resource.workspaceId, resource.key]);
          return cancel ? { context, cancel: true } : context;
        },
        refresh,
      );
      yield* takeEvery(gitReadRequested, requested, resources, reads);
      yield* takeEvery([releaseGitRead, workspaceUnmounted], released, resources, reads);
      yield* takeEvery(gitReadsInvalidated, invalidated, resources, reads);
      if (dependencies.bindAutoCommitEvents) {
        yield* call(dependencies.bindAutoCommitEvents, function* invalidateAgent(agentId: string) {
          for (const resource of resources.values()) {
            if (
              resource.request.kind !== 'autoCommitStatus' ||
              resource.request.agentId !== agentId
            )
              continue;
            resource.revision++;
            yield* put(reads, { resource });
          }
        });
      }
      yield* join(owner);
    } finally {
      for (const resource of resources.values()) resource.consumers.clear();
      resources.clear();
      reads.close();
    }
  };
}
