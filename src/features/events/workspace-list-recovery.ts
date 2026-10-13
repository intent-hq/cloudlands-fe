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
let captureProjectionFailure: ((workspaceId: string) => (error: unknown) => void) | undefined;
export function runWorkspaceListRead<T>(receipt: RecoveryLifetime, read: () => Promise<T>) {
  return runRecoveryRead(WORKSPACE_LIST_RECOVERY_KEY, receipt, 'ordinary', 'list', read);
}
export function runWorkspaceProjectionRead<T>(
  receipt: RecoveryLifetime,
  workspaceId: string,
  read: () => Promise<T>,
  requestKey = `get:${workspaceId}`,
) {
  return runRecoveryRead(WORKSPACE_LIST_RECOVERY_KEY, receipt, 'ordinary', requestKey, read, {
    retireOnDenied: false,
    retireOnNotFound: false,
    onFailure: captureProjectionFailure?.(workspaceId),
  });
}
interface RecoveryStore {
  getState(): StoreState;
  subscribe(listener: () => void): () => void;
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
  let active = true;
  const incarnations = new Map<string, { authority: string }>();
  const current = () =>
    active &&
    scope.isCurrent() &&
    !!context &&
    selectPrincipalActionContext.select(store.getState()) === context &&
    store.getState().connections.windowBackendId === backendId;
  const observe = () => {
    if (!current()) {
      active = false;
      incarnations.clear();
      return;
    }
    const workspace = store.getState().workspace;
    const present = new Set<string>(workspace.workspaces.ids);
    for (const id of incarnations.keys()) if (!present.has(id)) incarnations.delete(id);
    for (const id of present) {
      const row = workspace.workspaces.map[id];
      const authority = JSON.stringify([
        row.myRole,
        row.canManage,
        workspace.capabilityContext,
        workspace.deletionTokens[id],
      ]);
      if (incarnations.get(id)?.authority !== authority) incarnations.set(id, { authority });
    }
  };
  observe();
  const unsubscribe = store.subscribe(observe);
  const capture = (workspaceId: string) => {
    const incarnation = incarnations.get(workspaceId);
    return (error: unknown) => {
      const failure = error as { rpcCode?: unknown; data?: { code?: unknown } } | null;
      const canonical =
        failure?.rpcCode === -32003 ||
        failure?.rpcCode === -32001 ||
        (failure?.rpcCode === -32602 && failure.data?.code === 'not-found');
      if (canonical && current() && incarnation && incarnations.get(workspaceId) === incarnation)
        purge(workspaceId);
    };
  };
  captureProjectionFailure = capture;
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
      active = false;
      incarnations.clear();
      for (const id of [...store.getState().workspace.workspaces.ids]) purge(id);
      store.dispatch(setWorkspaceHasLoaded(false, backendId, null));
    },
  });
  return () => {
    active = false;
    unsubscribe();
    incarnations.clear();
    if (captureProjectionFailure === capture) captureProjectionFailure = undefined;
    owner.dispose();
  };
}
