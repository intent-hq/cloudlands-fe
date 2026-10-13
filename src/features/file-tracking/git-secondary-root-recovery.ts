import { selectPrincipalActionContext } from '$store/renderer/slices/principal/principal-selectors';
import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import type {
  RendererRecoveryHandle,
  RendererRecoveryScope,
} from '$features/events/renderer-event-recovery';
import {
  normalizeCommitDetails,
  parsePushedGitStatus,
  toDiffChunks,
} from '$lib/client/live/live-git-client';
import {
  clearSecondaryRootGit,
  getGitWorkspaceState,
  setSecondaryRootGit,
} from '$store/renderer/slices/git/git-slice';
import type { SecondaryRootGitData } from '$store/renderer/slices/git/git-types';
import { selectCurrentWorkspaceTabId } from '$store/renderer/slices/tab-state/tab-state-selectors';
import { LineType, type CommitInfo } from '$shared/types';
import type { RecoveryLifetime } from '$shared/event-recovery/resource';
import type { GitReadTransport } from './components/diff/diff-ipc-batcher';
import type { WorktreeRecoveryStore } from './worktree-snapshots-recovery';
import {
  captureGitAuthority,
  gitEventMatchesRoot,
  captureGitReadRetirement,
} from './git-recovery-authority';
import {
  bindGitReadTransport,
  gitReadFailureDrained,
  observeGitReadFailure,
  captureGitRead,
  secondaryRootRecoveryKey,
  serializeGitRead,
} from './git-recovery-read-lane';

export const captureSecondaryRootRead = (workspaceId: string, gitRootId: string) =>
  captureGitRead(secondaryRootRecoveryKey(workspaceId, gitRootId));

/** Settle every physical sibling before releasing the shared ordinary/recovery lane. */
async function settled<T>(reads: Promise<T>[]): Promise<T[]> {
  const results = await Promise.allSettled(reads);
  await Promise.all(
    results.map((result) =>
      result.status === 'rejected' ? gitReadFailureDrained(result.reason) : undefined,
    ),
  );
  for (const result of results) if (result.status === 'rejected') throw result.reason;
  return results.map((result) => (result as PromiseFulfilledResult<T>).value);
}

export async function readSecondaryRootSnapshot(
  workspaceId: string,
  gitRootId: string,
  registeredCommitSha: string | undefined,
  limit: number,
  transport: GitReadTransport,
  previous?: SecondaryRootGitData,
): Promise<SecondaryRootGitData> {
  const request = <T>(method: string, params?: unknown) =>
    observeGitReadFailure(transport.request<T>(method, params), transport.onFailure);
  const params = { workspaceId, gitRootId };
  const [rawStatus, rawPage] = await settled<unknown>([
    request('git.status', params),
    request('git.commits', { ...params, limit }),
  ]);
  const status = parsePushedGitStatus(rawStatus);
  if (!status) throw new Error('Invalid secondary root status');
  const page = rawPage as { items: CommitInfo[]; nextToken?: string };
  if (!Array.isArray(page?.items)) throw new Error('Invalid secondary root history');
  const commits = [...page.items];
  let nextToken = page.nextToken;
  const seenTokens = new Set<string>();
  while (
    nextToken &&
    registeredCommitSha &&
    !commits.some((row) => row.hash === registeredCommitSha)
  ) {
    if (seenTokens.has(nextToken)) throw new Error('Repeated secondary root history page');
    seenTokens.add(nextToken);
    const next = await request<{ items: CommitInfo[]; nextToken?: string }>('git.commits', {
      ...params,
      limit,
      nextToken,
    });
    if (!Array.isArray(next.items)) throw new Error('Invalid secondary root history');
    const seen = new Set(commits.map((row) => row.hash));
    commits.push(...next.items.filter((row) => !seen.has(row.hash)));
    nextToken = next.nextToken;
  }
  const commitFiles: SecondaryRootGitData['commitFiles'] = {};
  const paths = status.files.map((row) => row.path);
  const details = async () => {
    await settled(
      commits.map(async (commit) => {
        const cached = previous?.commitFiles[commit.hash];
        if (cached) {
          commitFiles[commit.hash] = cached;
          return;
        }
        const detail = normalizeCommitDetails(
          await request<Record<string, unknown>>('git.commitDetails', {
            ...params,
            commitHash: commit.hash,
          }),
          commit.hash,
        );
        commitFiles[commit.hash] = detail.fileDetails.length
          ? detail.fileDetails
          : detail.files.map((path) => ({ path, additions: 0, deletions: 0 }));
      }),
    );
  };
  const [unstaged, staged] = await settled<unknown>([
    paths.length ? request('git.diffs', { ...params, paths }) : Promise.resolve([]),
    paths.length ? request('git.diffs', { ...params, paths, staged: true }) : Promise.resolve([]),
    details(),
  ]);
  const stats = new Map<string, { additions: number; deletions: number }>();
  for (const [isStaged, raw] of [
    [false, unstaged],
    [true, staged],
  ] as const) {
    for (const diff of toDiffChunks(raw)) {
      let additions = 0,
        deletions = 0;
      for (const hunk of diff.chunks)
        for (const line of hunk.lines) {
          if (line.type === LineType.Addition) additions++;
          if (line.type === LineType.Deletion) deletions++;
        }
      stats.set(`${isStaged}:${diff.file}`, { additions, deletions });
    }
  }
  return {
    status: {
      ...status,
      files: status.files.map((file) => ({
        ...file,
        ...(stats.get(`${file.staged}:${file.path}`) ?? { additions: 0, deletions: 0 }),
      })),
    },
    commits,
    nextToken,
    commitFiles,
  };
}

export function installSecondaryRootRecovery(
  scope: RendererRecoveryScope,
  store: WorktreeRecoveryStore,
) {
  const rows = new Map<
    string,
    { owner: RendererRecoveryHandle; current(): boolean; dispose(): void; retired(): boolean }
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
      const state = store.getState();
      const wanted = new Set<string>();
      const workspaceIds = new Set([
        ...Object.keys(state.git.byWorkspaceId),
        ...Object.keys(state.panelLayout.byWorkspaceId),
      ]);
      for (const workspaceId of workspaceIds) {
        const workspace = getGitWorkspaceState(state.git, workspaceId);
        const panels = Object.values(state.panelLayout.byWorkspaceId[workspaceId]?.panels ?? {});
        const demanded = panels.flatMap((panel) =>
          panel.tabs.flatMap((tab) =>
            tab.type === 'local-changes' && typeof tab.data?.gitRootId === 'string'
              ? [tab.data.gitRootId]
              : [],
          ),
        );
        for (const rootId of new Set([...Object.keys(workspace.secondaryRoots), ...demanded])) {
          const key = secondaryRootRecoveryKey(workspaceId, rootId);
          wanted.add(key);
          const existing = rows.get(key);
          if (existing && !existing.current()) {
            rows.delete(key);
            existing.dispose();
            store.dispatch(clearSecondaryRootGit(workspaceId, rootId));
            continue;
          }
          const selected = selectCurrentWorkspaceTabId.select(state) === workspaceId;
          const active =
            selected &&
            Object.values(state.panelLayout.byWorkspaceId[workspaceId]?.panels ?? {}).some(
              (panel) =>
                panel.tabs.some(
                  (tab) =>
                    tab.id === panel.activeTabId &&
                    tab.type === 'local-changes' &&
                    tab.data?.gitRootId === rootId,
                ),
            );
          if (existing) {
            existing.owner.setActive(active);
            continue;
          }
          if (!factoryLive) continue;
          const authority = captureGitAuthority(scope, store, workspaceId, rootId);
          if (!authority()) continue;
          let live = true;
          const current = () => live && authority();
          const root = getItem(state.gitRoots.byWorkspaceId[workspaceId]?.gitRoots, rootId);
          const clear = () => {
            store.dispatch(clearSecondaryRootGit(workspaceId, rootId));
          };
          const transport: GitReadTransport = {
            key: authority,
            request: async <T>(method: string, params?: unknown): Promise<T> => {
              if (!current()) throw new Error('Git root authority retired');
              const result = await scope.request<T>(method, params);
              if (!current()) throw new Error('Git root authority retired');
              return result;
            },
          };
          const snapshot = (reader: GitReadTransport) => {
            const previous =
              store.getState().git.byWorkspaceId[workspaceId]?.secondaryRoots[rootId];
            return readSecondaryRootSnapshot(
              workspaceId,
              rootId,
              root?.registeredCommitSha,
              100,
              reader,
              previous
                ? {
                    status: previous.status,
                    commits: getItems(previous.commits),
                    nextToken: previous.nextToken,
                    commitFiles: Object.fromEntries(
                      getItems(previous.commitFiles).map((row) => [
                        row.commitHash,
                        row.files ? getItems(row.files) : null,
                      ]),
                    ),
                  }
                : undefined,
            );
          };
          const apply = (data: SecondaryRootGitData): undefined => {
            store.dispatch(setSecondaryRootGit(workspaceId, rootId, data));
          };
          const ordinary = (lifetime: RecoveryLifetime) => {
            const retireDenied = captureGitReadRetirement(key);
            return serializeGitRead(
              key,
              () => current() && lifetime.commit(() => undefined),
              () =>
                snapshot({
                  key: transport.key,
                  onFailure: retireDenied,
                  request: async <T>(method: string, params?: unknown): Promise<T> => {
                    if (!lifetime.commit(() => undefined))
                      throw new Error('Git root receipt expired');
                    return transport.request<T>(method, params);
                  },
                }),
            )
              .then((data) => {
                lifetime.commit(() => {
                  apply(data);
                });
              })
              .catch(() => {});
          };
          const owner = scope.registerResource({
            key,
            workspaceId,
            eventTypes: ['git:*', 'changes:git-status', 'file:*', 'gitRoot:*'],
            active,
            isCurrent: current,
            acceptsEvent: (notification) => gitEventMatchesRoot(notification, rootId),
            read: (reader) => {
              const retireDenied = captureGitReadRetirement(key);
              return serializeGitRead(
                key,
                () => current() && reader.lifetime.isCurrent(),
                () =>
                  snapshot({
                    key: reader.lifetime.key,
                    request: reader.request,
                    onFailure: retireDenied,
                  }),
              );
            },
            apply,
            invalidate: () => {},
            retire: () => {
              live = false;
              clear();
            },
            onEvent: (_notification, lifetime) => ordinary(lifetime),
          });
          const unbind = bindGitReadTransport(key, transport, captureGitReadRetirement(key));
          rows.set(key, {
            owner,
            current: authority,
            retired: () => !live,
            dispose: () => {
              live = false;
              unbind();
              owner.dispose();
            },
          });
          if (active && !workspace.secondaryRoots[rootId]) void ordinary(owner.captureLifetime());
        }
      }
      for (const [key, row] of rows)
        if (!wanted.has(key) && (!row.retired() || !row.current())) {
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
