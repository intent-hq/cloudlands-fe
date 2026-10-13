import { trackWorktreeSnapshotRead } from './worktree-read-lane';
import type {
  RendererRecoveryScope,
  RendererRecoveryHandle,
} from '$features/events/renderer-event-recovery';
import type { StoreState } from '$store/renderer/types';
import {
  selectHostRole,
  selectPrincipalActionContext,
} from '$store/renderer/slices/principal/principal-selectors';
import { selectCurrentWorkspaceTabId } from '$store/renderer/slices/tab-state/tab-state-selectors';
import {
  selectWorkspaceById,
  selectWorkspaceListLoadedForBackend,
} from '$store/renderer/slices/workspace/workspace-selectors';
import { setAgentLockState } from '$store/renderer/slices/agent-lock/agent-lock-slice';
import { clearGitSnapshot, setGitStatus } from '$store/renderer/slices/git/git-slice';
import { toGitStatus } from '$store/renderer/slices/git/utils/git-status';
import { parsePushedGitStatus } from '$lib/client/live/live-git-client';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import { toLockRecord } from './file-tracking.client';
import { agentLocksRecoveryKey, gitStatusRecoveryKey } from './worktree-recovery-keys';

export interface WorktreeRecoveryStore {
  getState(): StoreState;
  dispatch(action: { type: string; [key: string]: unknown }): unknown;
  subscribe(listener: () => void): () => void;
}

/** Selected workspace snapshots are active; retained inactive rows are invalidated lazily. */
export function installWorktreeSnapshotsRecovery(
  scope: RendererRecoveryScope,
  store: WorktreeRecoveryStore,
) {
  const principal = selectPrincipalActionContext.select(store.getState());
  const rows = new Map<
    string,
    { token: string | undefined; locks: RendererRecoveryHandle; git: RendererRecoveryHandle }
  >();
  let stopped = false,
    syncing = false;
  const permitted = (workspaceId: string) => {
    const state = store.getState(),
      role = selectHostRole.select(state);
    return (
      !stopped &&
      scope.isCurrent() &&
      !!principal &&
      selectPrincipalActionContext.select(state) === principal &&
      state.workspace.capabilityContext === principal &&
      (role === 'owner' || (role === 'member' && workspaceId !== CHIEF_WORKSPACE_ID)) &&
      selectWorkspaceListLoadedForBackend.select(state, state.connections.windowBackendId) &&
      !!selectWorkspaceById.select(state, workspaceId)
    );
  };
  const sync = () => {
    if (syncing || stopped) return;
    syncing = true;
    try {
      const state = store.getState(),
        selected = selectCurrentWorkspaceTabId.select(state);
      if (selectPrincipalActionContext.select(state) !== principal) {
        stopped = true;
        for (const [id, row] of rows) {
          row.locks.dispose();
          row.git.dispose();
          store.dispatch(setAgentLockState(id, {}, {}));
          store.dispatch(clearGitSnapshot(id));
        }
        rows.clear();
        return;
      }
      const ids = new Set([
        ...rows.keys(),
        ...Object.keys(state.agentLock.byWorkspaceId),
        ...Object.keys(state.git.byWorkspaceId),
        ...(selected ? [selected] : []),
      ]);
      for (const workspaceId of ids) {
        const old = rows.get(workspaceId),
          token = state.workspace.deletionTokens[workspaceId];
        if (old && (!permitted(workspaceId) || old.token !== token)) {
          rows.delete(workspaceId);
          old.locks.dispose();
          old.git.dispose();
          store.dispatch(setAgentLockState(workspaceId, {}, {}));
          store.dispatch(clearGitSnapshot(workspaceId));
        }
        if (!permitted(workspaceId)) continue;
        let row = rows.get(workspaceId);
        if (!row) {
          const current = () =>
            permitted(workspaceId) &&
            store.getState().workspace.deletionTokens[workspaceId] === token;
          const active = selected === workspaceId;
          const locks = scope.registerResource({
            key: agentLocksRecoveryKey(workspaceId),
            workspaceId,
            eventTypes: ['changes:agent-locks'],
            active,
            isCurrent: current,
            read: ({ request, lifetime }) =>
              trackWorktreeSnapshotRead(
                agentLocksRecoveryKey(workspaceId),
                () => {
                  if (!lifetime.isCurrent()) throw new Error('Lock authority expired');
                  return request<{ lockedAgentIds: string[]; lockedFilePaths: string[] }>(
                    'file-tracking.getAgentLocks',
                    { workspaceId },
                  );
                },
                'recovery',
              ),
            apply: (snapshot) => {
              store.dispatch(
                setAgentLockState(
                  workspaceId,
                  toLockRecord(snapshot.lockedAgentIds),
                  toLockRecord(snapshot.lockedFilePaths),
                ),
              );
            },
            invalidate: () => {},
            retire: () => {
              store.dispatch(setAgentLockState(workspaceId, {}, {}));
            },
          });
          const git = scope.registerResource({
            key: gitStatusRecoveryKey(workspaceId),
            workspaceId,
            eventTypes: ['git:*', 'changes:git-status', 'file:*'],
            active,
            isCurrent: current,
            read: ({ request, lifetime }) =>
              trackWorktreeSnapshotRead(
                gitStatusRecoveryKey(workspaceId),
                async () => {
                  if (!lifetime.isCurrent()) throw new Error('Git status authority expired');
                  const status = parsePushedGitStatus(await request('git.status', { workspaceId }));
                  if (!status) throw new Error('Invalid recovered Git status');
                  return status;
                },
                'recovery',
              ),
            apply: (status) => {
              store.dispatch(setGitStatus(workspaceId, toGitStatus(status)));
            },
            invalidate: () => {},
            retire: () => {
              store.dispatch(clearGitSnapshot(workspaceId));
            },
          });
          row = { token, locks, git };
          rows.set(workspaceId, row);
        }
        row.locks.setActive(selected === workspaceId);
        row.git.setActive(selected === workspaceId);
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
    for (const row of rows.values()) {
      row.locks.dispose();
      row.git.dispose();
    }
    rows.clear();
  };
}
