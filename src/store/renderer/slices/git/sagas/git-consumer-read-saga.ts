import { rendererEventRecovery } from '$features/events/renderer-event-recovery';
import { gitRootsUpdated } from '../../git-roots/git-roots-slice';
import { connectionsListReceived, authRejectedReceived } from '../../connections/connections-slice';
import { connectionStatusChanged } from '../../daemon-health/daemon-health-slice';
import {
  daemonEventsSubscribing,
  daemonEventsSubscribed,
} from '../../workspace-events/workspace-events-slice';
import {
  principalContextChanged,
  principalIdentityChanged,
  principalReceived,
  principalReadFailed,
  hostMembershipChanged,
} from '../../principal/principal-slice';
import {
  markWorkspacePendingDeletion,
  clearWorkspacePendingDeletion,
  removeWorkspaceEntity,
  resetWorkspaceState,
  replaceWorkspaceList,
} from '../../workspace/workspace-slice';
import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import type { StoreState } from '../../../types';
import { selectPrincipalActionContext } from '../../principal/principal-selectors';
import {
  captureGitRead,
  gitContentRecoveryKey,
} from '$features/file-tracking/git-recovery-read-lane';
import { readGitContent } from '$features/file-tracking/git-content-read';
import { withRecoveryLifetime } from '../../../middlewares/event-recovery';
import {
  call,
  join,
  put,
  race,
  select,
  take,
  takeEvery,
  type SagaGenerator,
} from 'typed-redux-saga';
import { buffers, channel, runSaga, type Channel } from 'redux-saga';
import { appClient } from '$lib/client';
import { invoke } from '$lib/electron-bridge';
import {
  dedupedGitNumstat,
  dedupedShowFile,
} from '$features/file-tracking/components/diff/diff-ipc-batcher';
import {
  getGitMutationVersion,
  isGitMutationPending,
  waitForGitMutations,
} from '../../../utils/worktree-mutation-queue';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  gitReadRequested,
  releaseGitRead,
  gitReadStarted,
  gitReadCompleted,
  gitReadsInvalidated,
  openGitCommitFileRequested,
  openGitPRFileRequested,
  openGitXcodeRequested,
} from '../git-slice';
import type { AutoCommitReadStatus, GitReadRequest, GitReadResult } from '../git-types';
import { gitReadKey } from '../utils/git-read-key';
import { readTrackedDiff } from './git-tracked-diff-read';
import {
  takeLatestInContext,
  takeSingleFlightInContext,
} from '../../../utils/context-saga-effects';
import { openWorkspaceDiff } from '../../workspace-navigation/workspace-navigation-slice';
import { ChangeStage } from '$features/file-tracking/types';
import { takeEveryFromElectronChannel } from '../../../utils/ipc-channel';
import { notify } from '$lib/components/patterns/notify';
import { m } from '$shared/paraglide/messages.js';

type Resource = {
  workspaceId: string;
  key: string;
  request: GitReadRequest;
  consumers: Map<string, { requestId: string; canRead?: () => boolean }>;
  revision: number;
  failed: boolean;
};
type Resources = Map<string, Resource>;
type ReadMessage = {
  resource: Resource;
  cancel?: boolean;
  lane?: ReturnType<typeof captureGitRead>;
};
const queuedRead = (resource: Resource): ReadMessage => ({
  resource,
  lane: captureGitRead(gitContentRecoveryKey(resource.workspaceId, resource.key)),
});

function* read(resource: Resource, signal: AbortSignal): SagaGenerator<GitReadResult> {
  const { workspaceId, request } = resource;
  switch (request.kind) {
    case 'commitDetails':
      return {
        kind: request.kind,
        details: yield* call(
          [appClient.git, appClient.git.commitDetails],
          workspaceId,
          request.commitHash,
          request.gitRootId ? { gitRootId: request.gitRootId } : undefined,
        ),
      };
    case 'diffs': {
      const { kind, ...options } = request;
      return {
        kind,
        chunks: yield* call([appClient.git, appClient.git.diffs], workspaceId, options),
      };
    }
    case 'showFile': {
      const response = yield* call(
        dedupedShowFile,
        workspaceId,
        request.ref,
        request.filePath,
        request.gitRootId ? { gitRootId: request.gitRootId } : undefined,
      );
      if (!response.success) throw new Error(response.error);
      return { kind: request.kind, content: response.data ?? '' };
    }
    case 'numstat': {
      const { kind, ...options } = request;
      return { kind, entries: yield* call(dedupedGitNumstat, workspaceId, options) };
    }
    case 'autoCommitStatus': {
      const response = yield* call(
        invoke<{ success: boolean; data?: AutoCommitReadStatus[] }>,
        'git:get-auto-commit-status',
        { agentId: request.agentId },
      );
      return { kind: request.kind, statuses: response?.success ? (response.data ?? []) : [] };
    }
    case 'trackedDiff':
      return yield* readTrackedDiff(workspaceId, request, signal, () =>
        [...resource.consumers.values()].some(
          (consumer) => !consumer.canRead || consumer.canRead(),
        ),
      );
  }
}

function* refresh({ resource, lane }: ReadMessage): SagaGenerator<void> {
  const controller = new AbortController();
  const revision = resource.revision;
  if (!lane) return;
  resource.failed = false;
  try {
    do {
      if (isGitMutationPending(resource.workspaceId, resource.request.gitRootId))
        yield* call(waitForGitMutations, resource.workspaceId, resource.request.gitRootId);
      if (
        revision !== resource.revision ||
        !resource.consumers.size ||
        !lane.receipt.commit(() => undefined)
      )
        return;
      const generation = crypto.randomUUID();
      const epoch = getGitMutationVersion(resource.workspaceId, resource.request.gitRootId);
      const pending = isGitMutationPending(resource.workspaceId, resource.request.gitRootId);
      yield* put(
        withRecoveryLifetime(
          gitReadStarted(resource.workspaceId, resource.key, generation),
          lane.receipt,
        ),
      );
      try {
        const result = yield* call(lane.run<GitReadResult>, () =>
          lane.transport && resource.request.kind !== 'autoCommitStatus'
            ? readGitContent(
                resource.workspaceId,
                resource.request,
                lane.transport,
                controller.signal,
                () =>
                  lane.receipt.commit(() => undefined) &&
                  [...resource.consumers.values()].some(
                    (consumer) => !consumer.canRead || consumer.canRead(),
                  ),
              )
            : runSaga({}, read, resource, controller.signal).toPromise(),
        );
        if (
          revision === resource.revision &&
          lane.receipt.commit(() => undefined) &&
          !pending &&
          epoch === getGitMutationVersion(resource.workspaceId, resource.request.gitRootId)
        ) {
          resource.failed = result.kind === 'commitDetails' && result.details === null;
          yield* put(
            withRecoveryLifetime(
              gitReadCompleted(resource.workspaceId, resource.key, generation, result, null),
              lane.receipt,
            ),
          );
          return;
        }
      } catch (error) {
        if (
          revision === resource.revision &&
          lane.receipt.commit(() => undefined) &&
          !pending &&
          epoch === getGitMutationVersion(resource.workspaceId, resource.request.gitRootId)
        ) {
          resource.failed = true;
          yield* put(
            withRecoveryLifetime(
              gitReadCompleted(
                resource.workspaceId,
                resource.key,
                generation,
                null,
                error instanceof Error ? error.message : String(error),
              ),
              lane.receipt,
            ),
          );
          return;
        }
      }
    } while (
      revision === resource.revision &&
      resource.consumers.size &&
      lane.receipt.commit(() => undefined)
    );
  } finally {
    controller.abort();
  }
}

function* requested(
  resources: Resources,
  reads: Channel<ReadMessage>,
  action: ReturnType<typeof gitReadRequested>,
): SagaGenerator<void> {
  const [workspaceId, consumerId, requestId, request, canRead] = action.payload;
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
    resource.consumers.set(consumerId, { requestId, canRead });
    if (resource.failed) {
      // Retry only on an explicit request; pending and successful resources stay shared.
      resource.failed = false;
      yield* put(reads, queuedRead(resource));
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
  yield* put(reads, queuedRead(resource));
}

function* released(
  resources: Resources,
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
  resources: Resources,
  reads: Channel<ReadMessage>,
  action: ReturnType<typeof gitReadsInvalidated>,
): SagaGenerator<void> {
  const [workspaceId, gitRootId] = action.payload;
  for (const resource of resources.values()) {
    if (resource.workspaceId !== workspaceId || resource.request.gitRootId !== gitRootId) continue;
    resource.revision++;
    resource.failed = false;
    const queued = queuedRead(resource);
    if (!queued.lane?.receipt.commit(() => undefined))
      rendererEventRecovery.invalidate(gitContentRecoveryKey(resource.workspaceId, resource.key));
    yield* put(reads, queued);
  }
}

function* openCommitFile(
  action: ReturnType<typeof openGitCommitFileRequested>,
): SagaGenerator<void> {
  const [workspaceId, commitHash, filePath, additions = 0, deletions = 0, gitRootId] =
    action.payload;
  const lane = captureGitRead(
    gitContentRecoveryKey(
      workspaceId,
      gitReadKey({ kind: 'showFile', ref: commitHash, filePath, gitRootId }),
    ),
  );
  const options = { gitRootId, transport: lane.transport };
  if (!lane.receipt.commit(() => undefined)) return;
  const after = yield* call(dedupedShowFile, workspaceId, commitHash, filePath, options);
  if (!lane.receipt.commit(() => undefined)) return;
  const before = yield* call(dedupedShowFile, workspaceId, `${commitHash}^`, filePath, options);
  if (!lane.receipt.commit(() => undefined)) return;
  const change = {
    id: `commit-${commitHash}-${filePath}`,
    file: filePath,
    relativePath: filePath,
    status: 'modified' as const,
    stage: ChangeStage.Committed,
    commitHash,
    stats: { additions, deletions },
    content: {
      oldContent: before.success ? (before.data ?? '') : '',
      newContent: after.success ? (after.data ?? '') : '',
      diff: '',
    },
    attribution: { timestamp: Date.now() },
  };
  yield* put(
    withRecoveryLifetime(
      openWorkspaceDiff(workspaceId, change, {
        changeId: change.id,
        filePath,
        ...(gitRootId ? { gitRootId } : {}),
      }),
      lane.receipt,
    ),
  );
}

function* openPRFile(action: ReturnType<typeof openGitPRFileRequested>): SagaGenerator<void> {
  const [workspaceId, filePath, baseRef, additions = 0, deletions = 0] = action.payload;
  const lane = captureGitRead(
    gitContentRecoveryKey(workspaceId, gitReadKey({ kind: 'showFile', ref: 'HEAD', filePath })),
  );
  for (;;) {
    if (!lane.receipt.commit(() => undefined)) return;
    if (isGitMutationPending(workspaceId)) yield* call(waitForGitMutations, workspaceId);
    const epoch = getGitMutationVersion(workspaceId);
    if (!lane.receipt.commit(() => undefined)) return;
    const after = yield* call(dedupedShowFile, workspaceId, 'HEAD', filePath, {
      transport: lane.transport,
    });
    if (!lane.receipt.commit(() => undefined)) return;
    const before = yield* call(dedupedShowFile, workspaceId, baseRef, filePath, {
      transport: lane.transport,
    });
    if (!lane.receipt.commit(() => undefined)) return;
    if (epoch !== getGitMutationVersion(workspaceId)) continue;
    const change = {
      id: `pr-file:${filePath}`,
      file: filePath,
      relativePath: filePath,
      status: 'modified' as const,
      stage: ChangeStage.Committed,
      stats: { additions, deletions },
      content: {
        oldContent: before.success ? (before.data ?? '') : '',
        newContent: after.success ? (after.data ?? '') : '',
        diff: '',
      },
      attribution: { timestamp: Date.now() },
    };
    yield* put(
      withRecoveryLifetime(
        openWorkspaceDiff(workspaceId, change, { changeId: change.id, filePath }),
        lane.receipt,
      ),
    );
    return;
  }
}

function* openFile(
  action: ReturnType<typeof openGitCommitFileRequested> | ReturnType<typeof openGitPRFileRequested>,
): SagaGenerator<void> {
  if (action.type === openGitCommitFileRequested.type)
    yield* openCommitFile(action as ReturnType<typeof openGitCommitFileRequested>);
  else yield* openPRFile(action as ReturnType<typeof openGitPRFileRequested>);
}

type NavigationAction =
  | ReturnType<typeof openGitCommitFileRequested>
  | ReturnType<typeof openGitPRFileRequested>
  | ReturnType<typeof openGitXcodeRequested>;

function* openXcode(action: ReturnType<typeof openGitXcodeRequested>): SagaGenerator<void> {
  const [workspaceId, folder, file] = action.payload;
  let changedFiles: string[] = [];
  try {
    const status = yield* call([appClient.git, appClient.git.status], workspaceId);
    changedFiles = status?.files.map((entry) => entry.path) ?? [];
  } catch {
    // Changed paths are a best-effort project-selection hint.
  }
  try {
    yield* call(invoke, 'xcode:open', {
      folder,
      ...(file ? { file } : {}),
      changedFiles: changedFiles.length ? changedFiles : undefined,
    });
  } catch {
    yield* call([notify, notify.error], m.ui_workspaceActions_openFailed_error({ name: 'Xcode' }));
  }
}

function* waitForNavigationRetirement(action: NavigationAction): SagaGenerator<void> {
  const workspaceId = action.payload[0];
  const rootId =
    action.type === openGitCommitFileRequested.type
      ? (action as ReturnType<typeof openGitCommitFileRequested>).payload[5]
      : undefined;
  const identity = (state: StoreState) => {
    const roots = state.gitRoots?.byWorkspaceId[workspaceId]?.gitRoots;
    const root = rootId && roots ? getItem(roots, rootId) : undefined;
    return JSON.stringify([
      state.connections?.windowBackendId,
      state.principal ? selectPrincipalActionContext.select(state) : undefined,
      state.workspace?.deletionTokens[workspaceId],
      state.workspace?.workspaces
        ? getItems(state.workspace.workspaces).some((workspace) => workspace.id === workspaceId)
        : undefined,
      rootId ? [root?.path, root?.createdAt] : undefined,
    ]);
  };
  const original = identity(yield* select());
  for (;;) {
    const next = yield* take([
      workspaceUnmounted,
      gitRootsUpdated,
      connectionsListReceived,
      authRejectedReceived,
      connectionStatusChanged,
      daemonEventsSubscribing,
      daemonEventsSubscribed,
      principalContextChanged,
      principalIdentityChanged,
      principalReceived,
      principalReadFailed,
      hostMembershipChanged,
      markWorkspacePendingDeletion,
      clearWorkspacePendingDeletion,
      removeWorkspaceEntity,
      resetWorkspaceState,
      replaceWorkspaceList,
    ]);
    if (next.type === workspaceUnmounted.type && next.payload?.[0] === workspaceId) return;
    if (identity(yield* select()) !== original) return;
  }
}

function* withWorkspaceLifetime<A extends NavigationAction>(
  worker: (action: A) => SagaGenerator<void>,
  action: A,
): SagaGenerator<void> {
  yield* race({
    done: call(worker, action),
    unmounted: call(waitForNavigationRetirement, action),
  });
}

export function* gitConsumerReadSaga(): SagaGenerator<void> {
  const resources: Resources = new Map();
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
    function* autoCommitChanged(event: { agentId: string }): SagaGenerator<void> {
      for (const resource of resources.values()) {
        if (
          resource.request.kind !== 'autoCommitStatus' ||
          resource.request.agentId !== event.agentId
        )
          continue;
        resource.revision++;
        yield* put(reads, queuedRead(resource));
      }
    }
    yield* takeEveryFromElectronChannel('git:auto-commit-started', autoCommitChanged);
    yield* takeEveryFromElectronChannel('git:auto-commit-succeeded', autoCommitChanged);
    yield* takeEveryFromElectronChannel('git:auto-commit-hook-failure', autoCommitChanged);
    yield* takeLatestInContext(
      [openGitCommitFileRequested, openGitPRFileRequested],
      (action) => action.payload[0],
      withWorkspaceLifetime,
      openFile,
    );
    yield* takeLatestInContext(
      openGitXcodeRequested,
      (action) => action.payload[0],
      withWorkspaceLifetime,
      openXcode,
    );
    yield* join(owner);
  } finally {
    reads.close();
  }
}
