import { trackWorktreeSnapshotRead } from './worktree-read-lane';
import type { RecoveryReader } from '$features/events/event-recovery-coordinator';
import type { RendererRecoveryScope } from '$features/events/renderer-event-recovery';
import {
  parsePushedGitStatus,
  toCommitInfo,
  toTrackedChange,
} from '$lib/client/live/live-git-client';
import { reconcileGitStatusChanges } from './git-status-reconciliation';
import {
  clearWorkspace,
  setChangesData,
  setCommitsData,
  setLoadingOlderCommits,
} from '$store/renderer/slices/changes/changes-slice';
import type { GitStatus } from '$shared/types';
import type { CommitInfo, TrackedChange } from './types';

export const changesRecoveryKey = (workspaceId: string) =>
  `changes:${JSON.stringify([workspaceId])}`;
export type ChangesRecoverySnapshot = {
  status?: GitStatus;
  tracked?: TrackedChange[];
  history?: { commits: CommitInfo[]; boundarySha: string | null; historyIdentity?: string };
  historyIdentity?: string;
};
export interface ChangesRecoveryProjection {
  isCurrent(): boolean;
  demand(): { files: boolean; history: boolean };
  loadedHistoryIdentity(): string | undefined;
  invalidate(): void;
  applied(snapshot: ChangesRecoverySnapshot): void;
  retired?(): void;
  dispatch(action: { type: string; payload?: unknown }): unknown;
}

/** A status identity only proves immutable history correspondence, never event publication order. */
async function readChangesRecovery(
  workspaceId: string,
  projection: ChangesRecoveryProjection,
  { request }: RecoveryReader,
): Promise<ChangesRecoverySnapshot> {
  const demand = projection.demand();
  const snapshot: ChangesRecoverySnapshot = {};
  const status = demand.history
    ? await request<{ historyIdentity?: string; gitStatus?: unknown }>('accept-changes.getStatus', {
        workspaceId,
      })
    : undefined;
  const identity =
    typeof status?.historyIdentity === 'string' && status.historyIdentity
      ? status.historyIdentity
      : undefined;
  snapshot.historyIdentity = identity;
  if (demand.files) {
    const gitStatus =
      parsePushedGitStatus(status?.gitStatus) ??
      (await request<unknown>('git.status', { workspaceId }));
    const tracked = await request<{ changes: unknown[] }>('file-tracking.getChanges', {
      workspaceId,
    });
    snapshot.status = parsePushedGitStatus(gitStatus) ?? undefined;
    if (!snapshot.status || !Array.isArray(tracked.changes))
      throw new Error('Invalid changes recovery snapshot');
    const rows = tracked.changes.map(toTrackedChange);
    if (rows.some((row) => row === null))
      throw new Error('Invalid tracked changes recovery snapshot');
    snapshot.tracked = rows as TrackedChange[];
  }
  if (demand.history && (!identity || identity !== projection.loadedHistoryIdentity())) {
    const history = await request<{
      commits: unknown[];
      boundarySha: string | null;
      historyIdentity?: string;
    }>('file-tracking.loadCommits', { workspaceId });
    if (!Array.isArray(history.commits) || (identity && history.historyIdentity !== identity))
      throw new Error('History changed during recovery');
    snapshot.history = {
      commits: history.commits.map(toCommitInfo).filter((row): row is CommitInfo => row !== null),
      boundarySha: typeof history.boundarySha === 'string' ? history.boundarySha : null,
      historyIdentity: history.historyIdentity,
    };
  }
  return snapshot;
}

export function registerChangesRecovery(
  scope: RendererRecoveryScope,
  workspaceId: string,
  projection: ChangesRecoveryProjection,
) {
  return scope.registerResource({
    key: changesRecoveryKey(workspaceId),
    workspaceId,
    eventTypes: ['git:*', 'changes:tracked', 'changes:git-status', 'file:*', 'workspace:updated'],
    isCurrent: projection.isCurrent,
    active: projection.demand().files || projection.demand().history,
    read: (reader) =>
      trackWorktreeSnapshotRead(
        changesRecoveryKey(workspaceId),
        () => {
          if (!reader.lifetime.isCurrent()) throw new Error('Changes authority expired');
          return readChangesRecovery(workspaceId, projection, reader);
        },
        'recovery',
      ),
    invalidate: projection.invalidate,
    apply: (snapshot) => {
      if (snapshot.status && snapshot.tracked) {
        const changes = reconcileGitStatusChanges(snapshot.status.files, snapshot.tracked);
        projection.dispatch(setChangesData(workspaceId, changes, false, changes.length));
      }
      if (snapshot.history)
        projection.dispatch(
          setCommitsData(workspaceId, snapshot.history.commits, snapshot.history.boundarySha),
        );
      projection.dispatch(setLoadingOlderCommits(workspaceId, false));
      projection.applied(snapshot);
    },
    retire: () => {
      projection.retired?.();
      projection.dispatch(clearWorkspace(workspaceId));
    },
  });
}
