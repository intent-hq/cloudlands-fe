import { selectPrincipalActionContext } from '$store/renderer/slices/principal/principal-selectors';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import type {
  RendererRecoveryHandle,
  RendererRecoveryScope,
} from '$features/events/renderer-event-recovery';
import {
  gitReadStarted,
  gitReadCompleted,
  gitReadCleared,
} from '$store/renderer/slices/git/git-slice';
import type { WorktreeRecoveryStore } from './worktree-snapshots-recovery';
import {
  captureGitAuthority,
  gitEventMatchesRoot,
  captureGitReadRetirement,
} from './git-recovery-authority';
import {
  bindGitReadTransport,
  observeGitReadFailure,
  gitRootTransportKeys,
  gitContentRecoveryKey,
  serializeGitRead,
  waitForGitReads,
  trackGitRead,
} from './git-recovery-read-lane';
import { readGitContent } from './git-content-read';

/** Register only real retained consumer demand; no independent polling/subscription. */
export function installGitContentRecovery(
  scope: RendererRecoveryScope,
  store: WorktreeRecoveryStore,
) {
  const rows = new Map<
    string,
    { owner: RendererRecoveryHandle; current(): boolean; dispose(): void }
  >();
  const rootTransports = new Map<
    string,
    {
      current(): boolean;
      transport: import('./components/diff/diff-ipc-batcher').GitReadTransport;
      recoveryKey: object;
    }
  >();
  const initialPrincipal = selectPrincipalActionContext.select(store.getState());
  const initialBackend = store.getState().connections.windowBackendId;
  let factoryRetired = false;
  const factoryCurrent = () => {
    const state = store.getState();
    if (
      selectPrincipalActionContext.select(state) !== initialPrincipal ||
      state.connections.windowBackendId !== initialBackend
    )
      factoryRetired = true;
    return !factoryRetired;
  };
  let stopped = false,
    syncing = false;
  const sync = () => {
    if (stopped || syncing) return;
    syncing = true;
    const factoryLive = factoryCurrent();
    try {
      // Observe revocation even while demand cannot admit a replacement owner.
      for (const [key, root] of rootTransports) if (!root.current()) rootTransports.delete(key);
      const wanted = new Set<string>();
      for (const [workspaceId, workspace] of Object.entries(store.getState().git.byWorkspaceId)) {
        const demands = new Set(getItems(workspace.readConsumers).map((row) => row.readKey));
        for (const entry of getItems(workspace.reads)) {
          if (entry.request.kind === 'autoCommitStatus' || !demands.has(entry.readKey)) continue;
          const key = gitContentRecoveryKey(workspaceId, entry.readKey);
          wanted.add(key);
          const prior = rows.get(key);
          const replaced = !!prior && !prior.current();
          if (prior && replaced) {
            rows.delete(key);
            prior.dispose();
            store.dispatch(gitReadCleared(workspaceId, entry.readKey));
          }
          if (rows.has(key)) continue;
          if (!factoryLive) continue;
          const authority = captureGitAuthority(scope, store, workspaceId, entry.request.gitRootId);
          if (!authority()) continue;
          let live = true;
          const current = () => live && authority();
          const clear = () => {
            store.dispatch(gitReadCleared(workspaceId, entry.readKey));
          };
          const rootKey = JSON.stringify([workspaceId, entry.request.gitRootId]);
          let rootTransport = rootTransports.get(rootKey);
          if (!rootTransport?.current()) {
            const valid = captureGitAuthority(scope, store, workspaceId, entry.request.gitRootId);
            const keys = gitRootTransportKeys(scope, rootKey, valid);
            rootTransport = {
              current: valid,
              recoveryKey: keys.recovery,
              transport: {
                key: keys.ordinary,
                request: async <T>(method: string, params?: unknown): Promise<T> => {
                  if (!valid()) throw new Error('Git root authority retired');
                  const value = await scope.request<T>(method, params);
                  if (!valid()) throw new Error('Git root authority retired');
                  return value;
                },
              },
            };
            rootTransports.set(rootKey, rootTransport);
          }
          const capturedRoot = rootTransport;
          const observingTransport = (readKey: object, retireDenied: (error: unknown) => void) => ({
            key: readKey,
            onFailure: retireDenied,
            request: <T>(method: string, params?: unknown): Promise<T> =>
              observeGitReadFailure(
                capturedRoot.transport.request<T>(method, params),
                retireDenied,
              ),
          });
          const controller = new AbortController();
          const freshRequest =
            entry.request.kind === 'trackedDiff' &&
            entry.request.allowHeadReads &&
            entry.request.stage !== 'committed'
              ? { ...entry.request, forceRefresh: true, useProvidedContent: false }
              : entry.request;
          const apply = (
            result: import('$store/renderer/slices/git/git-types').GitReadResult,
          ): undefined => {
            const generation = crypto.randomUUID();
            store.dispatch(gitReadStarted(workspaceId, entry.readKey, generation));
            store.dispatch(gitReadCompleted(workspaceId, entry.readKey, generation, result, null));
          };
          const ordinary = (
            lifetime: import('$shared/event-recovery/resource').RecoveryLifetime,
          ) => {
            const retireDenied = captureGitReadRetirement(key);
            return trackGitRead(
              capturedRoot.transport,
              serializeGitRead(
                key,
                () => current() && lifetime.commit(() => undefined),
                () =>
                  readGitContent(
                    workspaceId,
                    freshRequest,
                    observingTransport(capturedRoot.transport.key, retireDenied),
                    controller.signal,
                    () => current() && lifetime.commit(() => undefined),
                  ),
              ),
            )
              .then((result) => {
                lifetime.commit(() => {
                  apply(result);
                });
              })
              .catch(() => {
                /* Keep ordinary cache on transient failures; the observer retires canonical denials. */
              });
          };
          const owner = scope.registerResource({
            key,
            workspaceId,
            eventTypes: ['git:*', 'changes:*', 'file:*', 'gitRoot:*'],
            isCurrent: current,
            acceptsEvent: (notification) => {
              const request = entry.request;
              if (
                request.kind === 'commitDetails' ||
                (request.kind === 'diffs' && request.commitHash) ||
                (request.kind === 'trackedDiff' &&
                  request.stage === 'committed' &&
                  (request.commitHash || request.useProvidedContent))
              )
                return false;
              return gitEventMatchesRoot(notification, request.gitRootId);
            },
            read: (reader) => {
              const retireDenied = captureGitReadRetirement(key);
              return serializeGitRead(
                key,
                () => current() && reader.lifetime.isCurrent(),
                async () => {
                  await waitForGitReads(capturedRoot.transport);
                  if (!current() || !reader.lifetime.isCurrent())
                    throw new Error('Git read authority expired');
                  const request =
                    entry.request.kind === 'trackedDiff' &&
                    entry.request.allowHeadReads &&
                    entry.request.stage !== 'committed'
                      ? { ...entry.request, forceRefresh: true, useProvidedContent: false }
                      : entry.request;
                  return readGitContent(
                    workspaceId,
                    request,
                    observingTransport(capturedRoot.recoveryKey, retireDenied),
                    controller.signal,
                    () => current() && reader.lifetime.isCurrent(),
                  );
                },
              );
            },
            apply,
            invalidate: clear,
            retire: () => {
              live = false;
              controller.abort();
              clear();
            },
            onEvent: (_notification, lifetime) => ordinary(lifetime),
          });
          const unbind = bindGitReadTransport(
            key,
            rootTransport.transport,
            captureGitReadRetirement(key),
          );
          rows.set(key, {
            owner,
            current: authority,
            dispose: () => {
              live = false;
              controller.abort();
              unbind();
              owner.dispose();
            },
          });
          if (replaced || (!entry.loading && entry.result === null))
            void ordinary(owner.captureLifetime());
        }
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
