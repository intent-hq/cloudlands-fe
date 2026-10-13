import type { RendererRecoveryScope } from './renderer-event-recovery';
import { runtimeReadDrained } from './runtime-read-lane';
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
interface ProjectionFailure {
  onFailure(error: unknown): void;
  release(): void;
}
let captureProjectionFailure: ((workspaceId: string) => ProjectionFailure) | undefined;
export function runWorkspaceListRead<T>(receipt: RecoveryLifetime, read: () => Promise<T>) {
  return runRecoveryRead(WORKSPACE_LIST_RECOVERY_KEY, receipt, 'ordinary', 'list', read);
}
export function runWorkspaceProjectionRead<T>(
  receipt: RecoveryLifetime,
  workspaceId: string,
  read: () => Promise<T>,
  requestKey = `get:${workspaceId}`,
) {
  const failure = captureProjectionFailure?.(workspaceId);
  const result = runRecoveryRead(
    WORKSPACE_LIST_RECOVERY_KEY,
    receipt,
    'ordinary',
    requestKey,
    read,
    {
      retireOnDenied: false,
      retireOnNotFound: false,
      onFailure: failure?.onFailure,
    },
  );
  if (failure) void runtimeReadDrained(result).then(failure.release, failure.release);
  return result;
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
  const pendingPoints = new Map<string, number>();
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
    for (const id of incarnations.keys())
      if (!present.has(id) && !pendingPoints.has(id)) incarnations.delete(id);
    const rows = new Map(
      workspace.workspaces.ids.map((id) => [String(id), workspace.workspaces.map[id]]),
    );
    for (const id of new Set([...present, ...pendingPoints.keys()])) {
      const row = rows.get(id);
      const authority = JSON.stringify([
        !!row,
        row?.myRole,
        row?.canManage,
        workspace.capabilityContext,
        workspace.deletionTokens[id],
      ]);
      if (incarnations.get(id)?.authority !== authority) incarnations.set(id, { authority });
    }
  };
  observe();
  const unsubscribe = store.subscribe(observe);
  const capture = (workspaceId: string): ProjectionFailure => {
    pendingPoints.set(workspaceId, (pendingPoints.get(workspaceId) ?? 0) + 1);
    observe();
    const incarnation = incarnations.get(workspaceId);
    return {
      onFailure: (error: unknown) => {
        const failure = error as { rpcCode?: unknown; data?: { code?: unknown } } | null;
        const canonical =
          failure?.rpcCode === -32003 ||
          failure?.rpcCode === -32001 ||
          (failure?.rpcCode === -32602 && failure.data?.code === 'not-found');
        if (canonical && current() && incarnation && incarnations.get(workspaceId) === incarnation)
          purge(workspaceId);
      },
      release: () => {
        const remaining = (pendingPoints.get(workspaceId) ?? 1) - 1;
        if (remaining) pendingPoints.set(workspaceId, remaining);
        else pendingPoints.delete(workspaceId);
        observe();
      },
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
          const result = await reader.request<{ workspaces?: unknown } | null>('workspace.list', {
            includeArchived: true,
          });
          const raw = result?.workspaces;
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
