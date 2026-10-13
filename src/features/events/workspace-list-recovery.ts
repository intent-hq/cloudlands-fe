import type { RendererRecoveryScope } from './renderer-event-recovery';
import type { RecoveryLifetime } from '$shared/event-recovery/resource';
import type { StoreState } from '$store/renderer/types';
import { runRecoveryRead } from '$lib/client/live/recovery-read-queue';
import { normalizeWorkspace } from '$lib/client/live/live-workspaces-client';
import {
  replaceWorkspaceList,
  setWorkspaceHasLoaded,
} from '$store/renderer/slices/workspace/workspace-slice';
import { selectPrincipalActionContext } from '$store/renderer/slices/principal/principal-selectors';
import { workspaceDeleted } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';

export const WORKSPACE_LIST_RECOVERY_KEY = 'workspace-list';
export function runWorkspaceListRead<T>(receipt: RecoveryLifetime, read: () => Promise<T>) {
  return runRecoveryRead(WORKSPACE_LIST_RECOVERY_KEY, receipt, 'ordinary', 'list', read);
}
export function runWorkspaceProjectionRead<T>(
  receipt: RecoveryLifetime,
  requestKey: string,
  read: () => Promise<T>,
) {
  return runRecoveryRead(WORKSPACE_LIST_RECOVERY_KEY, receipt, 'ordinary', requestKey, read);
}
interface RecoveryStore {
  getState(): StoreState;
  dispatch(action: { type: string }): unknown;
}
/** An authoritative missing row revokes its entire workspace projection. */
export function installWorkspaceListRecovery(
  scope: RendererRecoveryScope,
  store: RecoveryStore,
  retireWorkspace?: (workspaceId: string) => void,
) {
  const state = store.getState();
  const context = selectPrincipalActionContext.select(state);
  const backendId = state.connections.windowBackendId;
  const purge =
    retireWorkspace ??
    ((workspaceId: string) => {
      const ids = store.getState().agentSessions.agentIdsByWorkspace[workspaceId] ?? [];
      store.dispatch(workspaceDeleted(workspaceId, [...ids], 'unshared'));
    });
  const owner = scope.registerResource({
    key: WORKSPACE_LIST_RECOVERY_KEY,
    workspaceId: null,
    eventTypes: [
      'workspace:*',
      'pr:*',
      'note:created',
      'note:updated',
      'note:deleted',
      'task:created',
      'task:status-changed',
      'agent:deleted',
      'agent:idle',
      'agent:status-changed',
      'agent:stream:start',
      'agent:stream:activity',
      'agent:stream:status',
    ],
    active: true,
    isCurrent: () =>
      scope.isCurrent() &&
      !!context &&
      selectPrincipalActionContext.select(store.getState()) === context &&
      store.getState().connections.windowBackendId === backendId,
    read: (reader) =>
      runRecoveryRead(
        WORKSPACE_LIST_RECOVERY_KEY,
        reader.lifetime,
        'recovery',
        'list',
        async () => {
          const deletionTokens = { ...store.getState().workspace.deletionTokens };
          const raw = await reader.request<unknown>('workspace.list', { includeArchived: true });
          if (
            !Array.isArray(raw) ||
            raw.some((row) => !row || typeof row !== 'object' || typeof row.id !== 'string')
          )
            throw new Error('Invalid authoritative workspace list');
          return { workspaces: raw.map(normalizeWorkspace), deletionTokens };
        },
      ),
    apply: ({ workspaces, deletionTokens }) => {
      const present = new Set(workspaces.map((row) => String(row.id)));
      for (const id of [...store.getState().workspace.workspaces.ids])
        if (!present.has(id)) purge(id);
      store.dispatch(replaceWorkspaceList(workspaces, { complete: true, deletionTokens }));
      store.dispatch(setWorkspaceHasLoaded(true, backendId, context));
    },
    invalidate: () => {},
    retire: () => {
      for (const id of [...store.getState().workspace.workspaces.ids]) purge(id);
      store.dispatch(setWorkspaceHasLoaded(false, backendId, null));
    },
  });
  return () => owner.dispose();
}
