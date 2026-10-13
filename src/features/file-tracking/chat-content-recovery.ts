import { runSaga } from 'redux-saga';
import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import type {
  RendererRecoveryScope,
  RendererRecoveryHandle,
} from '$features/events/renderer-event-recovery';
import type { LocalFileChange } from '$lib/components/chat/types';
import { selectPrincipalActionContext } from '$store/renderer/slices/principal/principal-selectors';
import { selectChatChangesCanRead } from '$store/renderer/slices/chat-changes/chat-changes-selectors';
import {
  chatChangesRecovered,
  chatChangesRecoveryInvalidated,
} from '$store/renderer/slices/chat-changes/chat-changes-slice';
import type { ChatChangesConsumer } from '$store/renderer/slices/chat-changes/chat-changes-types';
import {
  readChange,
  settleReads,
} from '$store/renderer/slices/chat-changes/sagas/chat-changes-saga';
import {
  calculateDiffHunkStats,
  getChangeCategory,
  computeBranchBaseCollapsedCommittedPaths,
  computeBranchBaseCommittedFallbacks,
} from '$lib/components/chat/chat-changes-enrichment';
import { batchedGitDiff, type GitReadTransport } from './components/diff/diff-ipc-batcher';
import {
  bindGitReadTransport,
  observeGitReadFailure,
  gitRootTransportKeys,
  chatContentRecoveryKey,
  trackGitRead,
  waitForGitReads,
  serializeGitRead,
} from './git-recovery-read-lane';
import {
  captureGitAuthority,
  gitEventMatchesRoot,
  gitReadAuthorityDenied,
  captureGitReadRetirement,
} from './git-recovery-authority';
import type { WorktreeRecoveryStore } from './worktree-snapshots-recovery';

/** Refresh only live mutable projections; immutable transcript views never enroll. */
async function readChatContentSnapshot(
  wsId: string,
  consumer: ChatChangesConsumer,
  transport: GitReadTransport,
  current: () => boolean,
): Promise<LocalFileChange[]> {
  const controller = new AbortController();
  const original = getItems(consumer.inputChanges ?? consumer.changes).map((row) => row.change);
  const retained = getItems(consumer.changes).map((row) => row.change);
  const paths = new Map<string, LocalFileChange>();
  for (const change of [...original, ...retained])
    if (getChangeCategory(change) !== 'committed') paths.set(change.filePath, change);
  const collapsed =
    consumer.options.showStagingControls &&
    (consumer.options.branchBaseRef || consumer.options.branchBaseCommitSha)
      ? computeBranchBaseCollapsedCommittedPaths(original, consumer.options.groupByCommit)
      : new Set<string>();
  const fallbacks = computeBranchBaseCommittedFallbacks(original, collapsed);
  const planned = new Set<string>();
  const committed = original.filter((change) => {
    if (getChangeCategory(change) !== 'committed') return false;
    if (!collapsed.has(change.filePath)) return true;
    if (planned.has(change.filePath)) return false;
    planned.add(change.filePath);
    return true;
  });
  const read = async (change: LocalFileChange): Promise<LocalFileChange[]> => {
    const options = {
      signal: controller.signal,
      canRead: current,
      transport,
      gitRootId: consumer.options.gitRootId,
      gitRootPath: consumer.options.gitRootPath,
      gitlink: change.gitlink,
    };
    const stages = consumer.options.showStagingControls ? [false, true] : [false];
    const chunks = await settleReads(
      stages.map((staged) => batchedGitDiff(wsId, staged, change.filePath, options)),
    );
    return chunks.flatMap((chunk, index) =>
      !chunk
        ? []
        : [
            {
              ...change,
              ...calculateDiffHunkStats(chunk.chunks as LocalFileChange['chunks']),
              staged: stages[index],
              category: stages[index] ? ('staged' as const) : ('unstaged' as const),
              oldContent: chunk.oldContent ?? '',
              newContent: chunk.newContent ?? '',
              chunks: chunk.chunks as LocalFileChange['chunks'],
              isFullFileContent: true,
            },
          ],
    );
  };
  try {
    const results = await settleReads([...paths.values()].map(read));
    const immutable = await settleReads(
      committed.map((change) =>
        runSaga(
          {},
          readChange,
          wsId,
          { ...consumer.options, changes: original },
          change,
          controller.signal,
          fallbacks.get(change.filePath),
          transport,
          current,
          true,
        ).toPromise(),
      ),
    );
    return [...results.flat(), ...immutable.flat()];
  } finally {
    controller.abort();
  }
}

export function installChatChangesRecovery(
  scope: RendererRecoveryScope,
  store: WorktreeRecoveryStore,
) {
  const rows = new Map<
    string,
    {
      current(): boolean;
      dispose(): void;
      owner: RendererRecoveryHandle;
      rootKey: string;
      retire(error: unknown): void;
    }
  >();
  const roots = new Map<
    string,
    { current(): boolean; transport: GitReadTransport; recoveryKey: object }
  >();
  const principal = selectPrincipalActionContext.select(store.getState());
  const backend = store.getState().connections.windowBackendId;
  let stopped = false,
    syncing = false,
    retired = false;
  const sync = () => {
    if (stopped || syncing) return;
    syncing = true;
    try {
      const state = store.getState();
      if (
        selectPrincipalActionContext.select(state) !== principal ||
        state.connections.windowBackendId !== backend
      )
        retired = true;
      // Observe revocation even while demand cannot admit a replacement owner.
      for (const [key, root] of roots) if (!root.current()) roots.delete(key);
      const wanted = new Set<string>();
      for (const [wsId, workspace] of Object.entries(state.chatChanges.byWorkspaceId))
        for (const consumer of getItems(workspace.consumers)) {
          if (
            consumer.options.nodeOwnedPaths ||
            (!consumer.options.showStagingControls && !consumer.options.isAggregate)
          )
            continue;
          const { id, resourceKey, requestId } = consumer;
          const key = chatContentRecoveryKey(wsId, id, resourceKey, requestId);
          wanted.add(key);
          const existing = rows.get(key);
          if (existing && !existing.current()) {
            rows.delete(key);
            existing.dispose();
            store.dispatch(chatChangesRecovered(wsId, id, requestId, resourceKey, [], true));
          }
          if (rows.has(key) || retired) continue;
          const authority = captureGitAuthority(scope, store, wsId, consumer.options.gitRootId);
          const valid = () =>
            authority() &&
            selectChatChangesCanRead.select(store.getState(), wsId, id, resourceKey) &&
            getItem(store.getState().chatChanges.byWorkspaceId[wsId]?.consumers, id)?.requestId ===
              requestId;
          if (!valid()) continue;
          let live = true;
          const current = () => live && valid();
          const rootKey = JSON.stringify([wsId, consumer.options.gitRootId]);
          let root = roots.get(rootKey);
          if (!root?.current()) {
            const rootCurrent = captureGitAuthority(scope, store, wsId, consumer.options.gitRootId);
            const keys = gitRootTransportKeys(scope, rootKey, rootCurrent);
            const transport: GitReadTransport = {
              key: keys.ordinary,
              request: <T>(method: string, params?: unknown) => {
                if (!rootCurrent()) return Promise.reject(new Error('Chat Git authority retired'));
                const consumers = [...rows.values()].filter((row) => row.rootKey === rootKey);
                return trackGitRead(
                  transport,
                  observeGitReadFailure(
                    scope.request<T>(method, params).then((value) => {
                      if (!rootCurrent()) throw new Error('Chat Git authority retired');
                      return value;
                    }),
                    (error) => {
                      if (rootCurrent() && gitReadAuthorityDenied(error))
                        for (const row of consumers) if (row.current()) row.retire(error);
                    },
                  ),
                );
              },
            };
            root = { current: rootCurrent, transport, recoveryKey: keys.recovery };
            roots.set(rootKey, root);
          }
          const captured = root;
          const ordinary = async (
            lifetime: import('$shared/event-recovery/resource').RecoveryLifetime,
          ) => {
            const onFailure = captureGitReadRetirement(key);
            try {
              const changes = await serializeGitRead(
                key,
                () => current() && lifetime.commit(() => undefined),
                async () => {
                  await waitForGitReads(captured.transport);
                  if (!current() || !lifetime.commit(() => undefined))
                    throw new Error('Chat ordinary receipt retired');
                  const latest = getItem(
                    store.getState().chatChanges.byWorkspaceId[wsId]?.consumers,
                    id,
                  );
                  if (!latest) throw new Error('Chat consumer retired');
                  return readChatContentSnapshot(
                    wsId,
                    latest,
                    { ...captured.transport, onFailure },
                    () => current() && lifetime.commit(() => undefined),
                  );
                },
              );
              lifetime.commit(() => {
                store.dispatch(chatChangesRecovered(wsId, id, requestId, resourceKey, changes));
              });
            } catch {
              /* Transient failures preserve the ordinary cache; authority failures retire in transport. */
            }
          };
          const owner = scope.registerResource({
            key,
            workspaceId: wsId,
            eventTypes: ['git:*', 'changes:*', 'file:*', 'agent:file*', 'gitRoot:*'],
            isCurrent: current,
            onEvent: (_notification, lifetime) => ordinary(lifetime),
            acceptsEvent: (notification) =>
              gitEventMatchesRoot(notification, consumer.options.gitRootId),
            read: (reader) => {
              const onFailure = captureGitReadRetirement(key);
              return serializeGitRead(
                key,
                () => current() && reader.lifetime.isCurrent(),
                async () => {
                  await waitForGitReads(captured.transport);
                  if (!current() || !reader.lifetime.isCurrent())
                    throw new Error('Chat Git receipt retired');
                  const latest = getItem(
                    store.getState().chatChanges.byWorkspaceId[wsId]?.consumers,
                    id,
                  );
                  if (!latest) throw new Error('Chat consumer retired');
                  return readChatContentSnapshot(
                    wsId,
                    latest,
                    { key: captured.recoveryKey, request: reader.request, onFailure },
                    () => current() && reader.lifetime.isCurrent(),
                  );
                },
              );
            },
            apply: (changes) => {
              store.dispatch(chatChangesRecovered(wsId, id, requestId, resourceKey, changes));
            },
            invalidate: () => {
              store.dispatch(chatChangesRecoveryInvalidated(wsId, id, requestId));
            },
            retire: () => {
              live = false;
              store.dispatch(chatChangesRecovered(wsId, id, requestId, resourceKey, [], true));
            },
          });
          const unbind = bindGitReadTransport(
            key,
            captured.transport,
            captureGitReadRetirement(key),
          );
          rows.set(key, {
            owner,
            rootKey,
            retire: captureGitReadRetirement(key),
            current: valid,
            dispose: () => {
              live = false;
              unbind();
              owner.dispose();
            },
          });
        }
      for (const [key, row] of rows)
        if (!wanted.has(key)) {
          rows.delete(key);
          row.dispose();
        }
    } finally {
      syncing = false;
    }
  };
  const off = store.subscribe(sync);
  sync();
  return () => {
    stopped = true;
    off();
    for (const row of rows.values()) row.dispose();
    rows.clear();
  };
}
