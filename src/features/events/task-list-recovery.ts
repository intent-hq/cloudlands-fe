import type { RecoveryLifetime } from '$shared/event-recovery/resource';
import type { RendererRecoveryHandle, RendererRecoveryScope } from './renderer-event-recovery';
import type { StoreState } from '$store/renderer/types';
import { runRecoveryRead } from '$lib/client/live/recovery-read-queue';
import { normalizeTaskListResult } from '$lib/client/live/live-tasks-client';
import { selectPrincipalActionContext } from '$store/renderer/slices/principal/principal-selectors';
import {
  acquireWorkspaceTasksDemand,
  clearWorkspaceTasks,
  invalidateWorkspaceTasks,
  loadWorkspaceTasksSucceeded,
  workspaceTasksReadStarted,
} from '$store/renderer/slices/workspace-tasks/workspace-tasks-slice';

export const tasksRecoveryKey = (workspaceId: string) => `tasks:${JSON.stringify([workspaceId])}`;
export function runTaskListRead<T>(
  workspaceId: string,
  receipt: RecoveryLifetime,
  read: () => Promise<T>,
) {
  return runRecoveryRead(tasksRecoveryKey(workspaceId), receipt, 'ordinary', 'list', read);
}
interface TaskStore {
  getState(): StoreState;
  dispatch(action: { type: string }): unknown;
  subscribe(listener: () => void): () => void;
}
/** The task aggregate is daemon-owned and cannot be reconstructed from note rows. */
export function installTaskListRecovery(scope: RendererRecoveryScope, store: TaskStore) {
  const authority = selectPrincipalActionContext.select(store.getState());
  const owners = new Map<string, RendererRecoveryHandle>();
  let stopped = false;
  let syncing = false;
  const clear = (workspaceId: string) => {
    const demand = [
      ...(store.getState().workspaceTasks.byWorkspaceId[workspaceId]?.demandIds ?? []),
    ];
    const wasSyncing = syncing;
    syncing = true;
    try {
      store.dispatch(clearWorkspaceTasks(workspaceId));
      for (const id of demand) store.dispatch(acquireWorkspaceTasksDemand(workspaceId, id));
    } finally {
      syncing = wasSyncing;
    }
  };
  const sync = () => {
    if (stopped || syncing || !scope.isCurrent()) return;
    syncing = true;
    try {
      const rows = store.getState().workspaceTasks.byWorkspaceId;
      if (!authority || selectPrincipalActionContext.select(store.getState()) !== authority) {
        for (const id of Object.keys(rows)) {
          owners.get(id)?.dispose();
          clear(id);
        }
        owners.clear();
        stopped = true;
        return;
      }
      for (const [id, handle] of owners) {
        if (rows[id]) continue;
        handle.dispose();
        owners.delete(id);
      }
      for (const [workspaceId, row] of Object.entries(rows)) {
        let handle = owners.get(workspaceId);
        const active = row.demandIds.length > 0;
        if (!handle) {
          const key = tasksRecoveryKey(workspaceId);
          handle = scope.registerResource({
            key,
            workspaceId,
            eventTypes: ['task:*', 'note:*', 'workspace:*'],
            active,
            isCurrent: () =>
              !stopped &&
              !!authority &&
              scope.isCurrent() &&
              !!store.getState().workspaceTasks.byWorkspaceId[workspaceId] &&
              selectPrincipalActionContext.select(store.getState()) === authority,
            read: ({ request, lifetime }) =>
              runRecoveryRead(key, lifetime, 'recovery', 'list', async () => {
                const raw = await request<unknown>('task.list', { workspaceId });
                if (
                  !raw ||
                  typeof raw !== 'object' ||
                  !Array.isArray((raw as { tasks?: unknown }).tasks)
                )
                  throw new Error('Invalid authoritative task list');
                return normalizeTaskListResult(raw);
              }),
            apply: ({ tasks, stats }) => {
              store.dispatch(workspaceTasksReadStarted(workspaceId));
              store.dispatch(loadWorkspaceTasksSucceeded(workspaceId, tasks, stats));
            },
            invalidate: () => {
              store.dispatch(invalidateWorkspaceTasks(workspaceId));
            },
            retire: () => {
              clear(workspaceId);
            },
          });
          owners.set(workspaceId, handle);
        } else handle.setActive(active);
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
    for (const [id, handle] of owners) {
      handle.dispose();
      clear(id);
    }
    owners.clear();
  };
}
