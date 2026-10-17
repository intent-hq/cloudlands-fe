import {
  captureGitRead,
  gitReadFailureDrained,
  chatContentRecoveryKey,
} from '$features/file-tracking/git-recovery-read-lane';
import { rendererEventRecovery } from '$features/events/renderer-event-recovery';
import { getRecoveryAdmission, withRecoveryLifetime } from '../../../middlewares/event-recovery';
import type { GitReadTransport } from '$features/file-tracking/components/diff/diff-ipc-batcher';
import { buffers, channel, type Channel } from 'redux-saga';
import {
  actionChannel,
  all,
  call,
  put,
  race,
  take,
  takeEvery,
  type SagaGenerator,
} from 'typed-redux-saga';
import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import {
  batchedGitBranchBaseDiff,
  batchedGitDiff,
  dedupedGitNumstat,
  dedupedShowFile,
} from '$features/file-tracking/components/diff/diff-ipc-batcher';
import type { DiffHunk, LocalFileChange } from '$lib/components/chat/types';
import { pathsMatch } from '$lib/utils/file-utils';
import {
  agentFileChangeReceived,
  agentFileRefreshTriggered,
  chatChangesInputChanged,
  chatChangesConsumerReleased,
  chatChangesEnriched,
  chatChangesFileRefreshStarted,
  chatChangesFileRefreshed,
  chatChangesMutationRefreshQueued,
  chatChangesHunkRequested,
} from '../chat-changes-slice';
import {
  selectChatChanges,
  selectChatChangesConsumer,
  selectChatChangesConsumers,
  selectChatChangesCanRead,
  selectAllChatChangesConsumers,
} from '../chat-changes-selectors';
import type { ChatChangesConsumer, ChatChangesInput, ChatFileRefresh } from '../chat-changes-types';
import {
  applyNumstatStats,
  calculateDiffHunkStats,
  computeBranchBaseCollapsedCommittedPaths,
  computeBranchBaseCommittedFallbacks,
  computeMergedDestinedPaths,
  getChangeCategory,
  isPathLocked,
  MAX_UPFRONT_FETCH_COUNT,
  REFRESH_COOLDOWN_MS,
  toGitRootRelativePath,
} from '$lib/components/chat/chat-changes-enrichment';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  bulkUpsertSessions,
  removeSession,
  removeWorkspaceSessions,
  clearAllSessions,
  restoreStoredSessions,
} from '../../agent-session/agent-session-slice';
import { selectLockedFilePaths } from '../../agent-lock/agent-lock-selectors';
import { selectWorkspaceById } from '../../workspace/workspace-selectors';
import {
  gitWriteRequested,
  gitWriteFinished,
  gitWriteConsumerReleased,
} from '../../git/git-write-slice';
import {
  takeLatestInContext,
  takeSingleFlightInContext,
} from '../../../utils/context-saga-effects';

type Lifetime = {
  controller: AbortController;
  resourceKey: string;
  wsId: string;
  id: string;
  lane: ReturnType<typeof captureGitRead>;
  recoveryVersion?: number;
};
type RefreshRequest = {
  wsId: string;
  id: string;
  resourceKey: string;
  path: string;
  lane: ReturnType<typeof captureGitRead>;
};

export function* readChange(
  wsId: string,
  input: ChatChangesInput,
  change: LocalFileChange,
  signal: AbortSignal,
  branchFallbacks?: LocalFileChange[],
  transport?: GitReadTransport,
  canRead: () => boolean = () => true,
  recovering = false,
): SagaGenerator<LocalFileChange[]> {
  const policy = { signal, transport, canRead: () => !signal.aborted && canRead() };
  if (signal.aborted || !canRead()) return [];
  if (branchFallbacks) {
    if (input.gitRootId) throw new Error('Secondary-root branch-base diffs are not supported');
    const chunk = yield* call(
      batchedGitBranchBaseDiff,
      wsId,
      {
        baseRef: input.branchBaseRef,
        baseCommitSha: input.branchBaseCommitSha,
        ...policy,
      },
      change.filePath,
    );
    if (!chunk) return recovering ? [] : branchFallbacks;
    const chunks = chunk.chunks as DiffHunk[] | undefined;
    return [
      {
        ...change,
        ...calculateDiffHunkStats(chunks),
        oldContent: chunk.oldContent || '',
        newContent: chunk.newContent || '',
        chunks,
        isFullFileContent: true,
      },
    ];
  }
  if (input.showStagingControls && getChangeCategory(change) === 'committed' && change.commitHash) {
    const commitHash = change.commitHash;
    const path = toGitRootRelativePath(change.filePath, input.gitRootPath);
    const options = { gitRootId: input.gitRootId, transport };
    const [newSide, oldSide] = yield* call(() =>
      settleReads([
        dedupedShowFile(wsId, commitHash, path, options),
        dedupedShowFile(wsId, `${commitHash}^`, path, options),
      ]),
    );
    return [
      {
        ...change,
        oldContent: oldSide.success ? oldSide.data || '' : '',
        newContent: newSide.success ? newSide.data || '' : '',
        isFullFileContent: true,
      },
    ];
  }
  const chunk = yield* call(
    batchedGitDiff,
    wsId,
    input.showStagingControls ? change.staged === true : false,
    change.filePath,
    {
      ...policy,
      gitlink: change.gitlink,
      gitRootId: input.gitRootId,
      gitRootPath: input.gitRootPath,
    },
  );
  return chunk
    ? [
        {
          ...change,
          oldContent: chunk.oldContent || '',
          newContent: chunk.newContent || '',
          chunks: chunk.chunks as DiffHunk[] | undefined,
          isFullFileContent: true,
        },
      ]
    : recovering
      ? []
      : [change];
}

function* enrich(
  lifetime: Lifetime,
  requestId: string,
  input: ChatChangesInput,
): SagaGenerator<void> {
  const { wsId, id, resourceKey, controller } = lifetime;
  let error: string | undefined;
  try {
    if (
      !lifetime.lane.receipt.commit(() => undefined) ||
      !(yield* selectChatChangesCanRead.effect(wsId, id, resourceKey))
    )
      return;
    const consumer = yield* selectChatChangesConsumer.effect(wsId, id);
    const now = Date.now();
    const protectedPaths = new Set(
      consumer
        ? getItems(consumer.fileRefreshes)
            .filter(
              (refresh) =>
                refresh.status === 'pending' ||
                (refresh.status === 'ready' && now - refresh.refreshedAt < REFRESH_COOLDOWN_MS),
            )
            .map((refresh) => refresh.path)
        : [],
    );
    const merged = input.showStagingControls
      ? computeMergedDestinedPaths(input.changes, input.groupByCommit)
      : new Set<string>();
    const collapsed =
      input.showStagingControls && (input.branchBaseRef || input.branchBaseCommitSha)
        ? computeBranchBaseCollapsedCommittedPaths(input.changes, input.groupByCommit)
        : new Set<string>();
    const fallbacks = computeBranchBaseCommittedFallbacks(input.changes, collapsed);
    const planned = new Set<string>();
    let slots = 0;
    function* one(change: LocalFileChange): SagaGenerator<LocalFileChange[]> {
      if (protectedPaths.has(change.filePath)) return [];
      let branchFallbacks: LocalFileChange[] | undefined;
      if (getChangeCategory(change) === 'committed' && collapsed.has(change.filePath)) {
        if (planned.has(change.filePath)) return [];
        planned.add(change.filePath);
        branchFallbacks = fallbacks.get(change.filePath);
      } else if (input.showStagingControls) {
        if (!merged.has(change.filePath) && slots >= MAX_UPFRONT_FETCH_COUNT) return [change];
        if (!merged.has(change.filePath)) slots++;
        if (getChangeCategory(change) !== 'committed' && change.chunks?.length) return [change];
      }
      try {
        return yield* call(
          readChange,
          wsId,
          input,
          change,
          controller.signal,
          branchFallbacks,
          lifetime.lane.transport,
          () => lifetime.lane.receipt.commit(() => undefined),
        );
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
        return branchFallbacks ?? [change];
      }
    }
    function* numstat(committed: boolean) {
      if (
        input.gitRootId ||
        !lifetime.lane.receipt.commit(() => undefined) ||
        !input.showStagingControls ||
        (committed && (input.groupByCommit || !(input.branchBaseRef || input.branchBaseCommitSha)))
      )
        return [];
      try {
        return yield* call(
          dedupedGitNumstat,
          wsId,
          committed
            ? {
                baseRef: input.branchBaseRef,
                baseCommitSha: input.branchBaseCommitSha,
                targetRef: 'HEAD',
                transport: lifetime.lane.transport,
              }
            : { transport: lifetime.lane.transport },
        );
      } catch {
        return [];
      }
    }
    const { results, localStats, committedStats } = yield* all({
      results: all(input.changes.map((change) => call(one, change))),
      localStats: call(numstat, false),
      committedStats: call(numstat, true),
    });
    if (
      !controller.signal.aborted &&
      lifetime.lane.receipt.commit(() => undefined) &&
      (yield* selectChatChangesCanRead.effect(wsId, id, resourceKey))
    ) {
      yield* put(
        withRecoveryLifetime(
          chatChangesEnriched(
            wsId,
            id,
            requestId,
            resourceKey,
            applyNumstatStats(results.flat(), localStats, committedStats),
            Date.now(),
            error,
            lifetime.recoveryVersion,
          ),
          lifetime.lane.receipt,
        ),
      );
    }
  } catch (caught) {
    if (
      lifetime.lane.receipt.commit(() => undefined) &&
      (yield* selectChatChangesCanRead.effect(wsId, id, resourceKey))
    ) {
      yield* put(
        withRecoveryLifetime(
          chatChangesEnriched(
            wsId,
            id,
            requestId,
            resourceKey,
            input.changes,
            Date.now(),
            caught instanceof Error ? caught.message : String(caught),
            lifetime.recoveryVersion,
          ),
          lifetime.lane.receipt,
        ),
      );
    }
  } finally {
    controller.abort();
  }
}

function* refreshFile(lifetime: Lifetime, path: string): SagaGenerator<void> {
  const { wsId, id, resourceKey, controller } = lifetime;
  try {
    if (
      !lifetime.lane.receipt.commit(() => undefined) ||
      !(yield* selectChatChangesCanRead.effect(wsId, id, resourceKey))
    )
      return;
    const consumer = yield* selectChatChangesConsumer.effect(wsId, id);
    if (!consumer) return;
    const refresh: ChatFileRefresh = {
      path,
      requestId: crypto.randomUUID(),
      status: 'pending',
      refreshedAt: Date.now(),
      mutationRequestId: getItem(consumer.fileRefreshes, path)?.queuedMutationRequestId,
    };
    yield* put(
      withRecoveryLifetime(
        chatChangesFileRefreshStarted(wsId, id, resourceKey, refresh),
        lifetime.lane.receipt,
      ),
    );
    try {
      const before = yield* selectChatChanges.effect(wsId, id);
      const gitlink = before.find((change) => change.filePath === path)?.gitlink;
      const options = {
        signal: controller.signal,
        canRead: () => !controller.signal.aborted && lifetime.lane.receipt.commit(() => undefined),
        transport: lifetime.lane.transport,
        gitRootId: consumer.options.gitRootId,
        gitRootPath: consumer.options.gitRootPath,
        gitlink,
      };
      const [staged, unstaged] = yield* call(() =>
        settleReads([
          batchedGitDiff(wsId, true, path, options),
          batchedGitDiff(wsId, false, path, options),
        ]),
      );
      if (
        !lifetime.lane.receipt.commit(() => undefined) ||
        !(yield* selectChatChangesCanRead.effect(wsId, id, resourceKey))
      )
        return;
      const existing = yield* selectChatChanges.effect(wsId, id);
      const changes: LocalFileChange[] = [];
      for (const [isStaged, chunk] of [
        [false, unstaged],
        [true, staged],
      ] as const) {
        const chunks = chunk?.chunks as DiffHunk[] | undefined;
        if (!chunk || !chunks?.length) continue;
        const previous = existing.find(
          (change) => change.filePath === path && !!change.staged === isStaged,
        );
        changes.push({
          filePath: path,
          ...calculateDiffHunkStats(chunks),
          staged: isStaged,
          category: isStaged ? 'staged' : 'unstaged',
          oldContent: chunk.oldContent || '',
          newContent: chunk.newContent || '',
          chunks,
          isFullFileContent: true,
          action: previous?.action || 'modify',
          toolName: previous?.toolName || 'git',
          toolCallId: previous?.toolCallId || `local-${path}-${isStaged ? 'staged' : 'unstaged'}`,
          ...(gitlink ? { gitlink } : {}),
        });
      }
      yield* put(
        withRecoveryLifetime(
          chatChangesFileRefreshed(
            wsId,
            id,
            resourceKey,
            { ...refresh, status: 'ready', refreshedAt: Date.now() },
            changes,
          ),
          lifetime.lane.receipt,
        ),
      );
    } catch {
      yield* put(
        withRecoveryLifetime(
          chatChangesFileRefreshed(wsId, id, resourceKey, {
            ...refresh,
            status: 'failed',
            refreshedAt: Date.now(),
          }),
          lifetime.lane.receipt,
        ),
      );
    }
  } finally {
    controller.abort();
  }
}

function writeConsumer(consumer: Pick<ChatChangesConsumer, 'id' | 'resourceKey'>) {
  return JSON.stringify([consumer.id, consumer.resourceKey]);
}

function* waitForInvalidation(lifetime: Lifetime): SagaGenerator<void> {
  while (yield* selectChatChangesCanRead.effect(lifetime.wsId, lifetime.id, lifetime.resourceKey)) {
    yield* take([
      chatChangesInputChanged,
      chatChangesConsumerReleased,
      workspaceUnmounted,
      bulkUpsertSessions,
      removeSession,
      removeWorkspaceSessions,
      clearAllSessions,
      restoreStoredSessions,
    ]);
  }
}

const admittedReads = new WeakMap<object, ReturnType<typeof captureGitRead>>();
function* inputWorker(action: ReturnType<typeof chatChangesInputChanged>): SagaGenerator<void> {
  const [wsId, id, requestId, input] = action.payload;
  const consumer = yield* selectChatChangesConsumer.effect(wsId, id);
  if (!consumer || consumer.requestId !== requestId) return;
  const lane = admittedReads.get(action);
  if (!lane) return;
  const lifetime: Lifetime = {
    wsId,
    id,
    resourceKey: consumer.resourceKey,
    controller: new AbortController(),
    lane,
    recoveryVersion: consumer.recoveryVersion,
  };
  try {
    yield* race({
      enriched: call(function* () {
        if (consumer.status === 'pending') yield* enrich(lifetime, requestId, input);
        yield* waitForInvalidation(lifetime);
      }),
      invalidated: call(waitForInvalidation, lifetime),
    });
  } finally {
    lifetime.controller.abort();
    const current = yield* selectChatChangesConsumer.effect(wsId, id);
    if (
      !current ||
      current.resourceKey !== lifetime.resourceKey ||
      !(yield* selectChatChangesCanRead.effect(wsId, id, lifetime.resourceKey))
    ) {
      yield* put(gitWriteConsumerReleased(wsId, writeConsumer(lifetime)));
    }
  }
}

function* refreshWorker(request: RefreshRequest): SagaGenerator<void> {
  const lifetime: Lifetime = { ...request, controller: new AbortController() };
  try {
    yield* race({
      refreshed: call(refreshFile, lifetime, request.path),
      invalidated: call(waitForInvalidation, lifetime),
    });
  } finally {
    lifetime.controller.abort();
  }
}

function* fileChanged(
  refreshes: Channel<RefreshRequest>,
  action: ReturnType<typeof agentFileRefreshTriggered>,
): SagaGenerator<void> {
  const [wsId, path] = action.payload;
  const consumers = yield* selectChatChangesConsumers.effect(wsId);
  for (const consumer of consumers) {
    if (!consumer.options.showStagingControls) continue;
    const changes = yield* selectChatChanges.effect(wsId, consumer.id);
    const change = changes.find((change) => pathsMatch(path, change.filePath));
    if (change) {
      const key = chatContentRecoveryKey(
        wsId,
        consumer.id,
        consumer.resourceKey,
        consumer.requestId,
      );
      const admission = getRecoveryAdmission(action, key);
      if (admission === null || (admission && !admission.commit(() => undefined))) continue;
      const lane = captureGitRead(key);
      if (admission) lane.receipt = admission;
      yield* put(refreshes, {
        wsId,
        id: consumer.id,
        resourceKey: consumer.resourceKey,
        path: change.filePath,
        lane,
      });
    }
  }
}

function* hunkRequested(action: ReturnType<typeof chatChangesHunkRequested>): SagaGenerator<void> {
  const [wsId, id, requestId, kind, filePath, hunkPatch] = action.payload;
  const consumer = yield* selectChatChangesConsumer.effect(wsId, id);
  if (
    !consumer?.options.showStagingControls ||
    !(yield* selectChatChangesCanRead.effect(wsId, id, consumer.resourceKey))
  )
    return;
  const locks = yield* selectLockedFilePaths.effect(wsId);
  const workspace = yield* selectWorkspaceById.effect(wsId);
  if (isPathLocked(locks, filePath, workspace?.worktreePath || workspace?.repositoryPath)) return;
  yield* put(
    gitWriteRequested(wsId, requestId, {
      kind,
      filePath,
      hunkPatch,
      source: 'chat',
      consumerId: writeConsumer(consumer),
      sourceAgentId: consumer.options.agentId ?? undefined,
    }),
  );
}

function* hunkFinished(
  refreshes: Channel<RefreshRequest>,
  action: ReturnType<typeof gitWriteFinished>,
): SagaGenerator<void> {
  const [wsId, requestId, result, operation] = action.payload;
  if (
    !result.success ||
    (operation.kind !== 'stageHunk' && operation.kind !== 'unstageHunk') ||
    operation.source !== 'chat'
  )
    return;
  const consumers = yield* selectChatChangesConsumers.effect(wsId);
  const consumer = consumers.find((consumer) => writeConsumer(consumer) === operation.consumerId);
  if (consumer) {
    const key = chatContentRecoveryKey(wsId, consumer.id, consumer.resourceKey, consumer.requestId);
    if (!rendererEventRecovery.capture(key).commit(() => undefined))
      rendererEventRecovery.invalidate(key);
    yield* put(
      chatChangesMutationRefreshQueued(
        wsId,
        consumer.id,
        consumer.resourceKey,
        operation.filePath,
        requestId,
        Date.now(),
      ),
    );
    yield* put(refreshes, {
      wsId,
      id: consumer.id,
      resourceKey: consumer.resourceKey,
      path: operation.filePath,
      lane: captureGitRead(
        chatContentRecoveryKey(wsId, consumer.id, consumer.resourceKey, consumer.requestId),
      ),
    });
  }
}

/** Context helpers own task lifetimes; channels carry accepted domain requests only. */
export function* chatChangesSaga(): SagaGenerator<void> {
  const inputs = yield* actionChannel(chatChangesInputChanged, buffers.expanding());
  const admitted = channel<ReturnType<typeof chatChangesInputChanged>>(buffers.expanding());
  const refreshes = channel<RefreshRequest>(buffers.expanding());
  try {
    yield* takeLatestInContext(
      admitted,
      (action) => JSON.stringify(action.payload.slice(0, 2)),
      inputWorker,
    );
    yield* takeSingleFlightInContext(
      refreshes,
      (request) => JSON.stringify([request.wsId, request.id, request.resourceKey, request.path]),
      refreshWorker,
    );
    yield* takeEvery([agentFileChangeReceived, agentFileRefreshTriggered], fileChanged, refreshes);
    yield* takeEvery(chatChangesHunkRequested, hunkRequested);
    yield* takeEvery(gitWriteFinished, hunkFinished, refreshes);
    while (true) {
      const action = yield* take(inputs);
      const [wsId, id, requestId] = action.payload;
      const consumer = yield* selectChatChangesConsumer.effect(wsId, id);
      if (consumer?.requestId === requestId) {
        admittedReads.set(
          action,
          captureGitRead(chatContentRecoveryKey(wsId, id, consumer.resourceKey, requestId)),
        );
        yield* put(admitted, action);
      }
    }
  } finally {
    inputs.close();
    admitted.close();
    refreshes.close();
    const consumers = yield* selectAllChatChangesConsumers.effect();
    for (const { wsId, consumer } of consumers) {
      yield* put(gitWriteConsumerReleased(wsId, writeConsumer(consumer)));
      yield* put(chatChangesConsumerReleased(wsId, consumer.id));
    }
  }
}

export async function settleReads<T>(reads: Promise<T>[]): Promise<T[]> {
  const values = await Promise.allSettled(reads);
  await Promise.all(
    values.map((value) =>
      value.status === 'rejected' ? gitReadFailureDrained(value.reason) : undefined,
    ),
  );
  for (const value of values) if (value.status === 'rejected') throw value.reason;
  return values.map((value) => (value as PromiseFulfilledResult<T>).value);
}
