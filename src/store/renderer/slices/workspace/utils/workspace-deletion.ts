import { store } from '../../../store';
import { selectPrincipalActionContext } from '../../principal/principal-selectors';
import { selectWorkspaceActionContext } from '../workspace-selectors';
import {
  clearWorkspacePendingDeletion,
  markWorkspacePendingDeletion,
  removeWorkspaceEntity,
  setWorkspaceEntity,
} from '../workspace-slice';
import type { Workspace } from '$shared/types';

let sequence = 0;
const issued = new WeakSet<object>();
export type WorkspaceDeletion = {
  readonly workspaceId: string;
  begin(hide?: boolean): boolean;
  current(): boolean;
  restore(): void;
  expire(): void;
};

/** The row authorizes the operation before it is hidden. The token owns only that deletion. */
export function captureWorkspaceDeletion(workspace: Workspace): WorkspaceDeletion | null {
  const dispatch = store.dispatch;
  const backend = store.state.connections.windowBackendId;
  const admission = selectWorkspaceActionContext.select(store.state, workspace.id);
  if (!admission || store.state.workspace.pendingDeletions[workspace.id]) return null;
  const token = `operation-${++sequence}`;
  let begun = false;
  const sameStore = () => {
    try {
      return store.dispatch === dispatch && store.state.connections.windowBackendId === backend;
    } catch {
      return false;
    }
  };
  const owned = () => sameStore() && store.state.workspace.deletionTokens[workspace.id] === token;
  const current = () =>
    sameStore() &&
    selectPrincipalActionContext.select(store.state) === admission &&
    (begun
      ? owned() && store.state.workspace.invalidatedDeletions[workspace.id] !== token
      : selectWorkspaceActionContext.select(store.state, workspace.id) === admission);
  const operation: WorkspaceDeletion = {
    workspaceId: workspace.id,
    current,
    begin(hide = true) {
      if (begun || !current() || store.state.workspace.pendingDeletions[workspace.id]) return false;
      dispatch(markWorkspacePendingDeletion(workspace.id, token));
      if (hide) dispatch(removeWorkspaceEntity(workspace.id));
      begun = true;
      return current();
    },
    restore() {
      if (!current()) return;
      dispatch(clearWorkspacePendingDeletion(workspace.id, token));
      dispatch(setWorkspaceEntity(workspace));
    },
    expire() {
      if (owned()) dispatch(clearWorkspacePendingDeletion(workspace.id, token));
    },
  };
  issued.add(operation);
  return operation;
}

export function currentWorkspaceDeletion(operation: WorkspaceDeletion, id: string): boolean {
  return issued.has(operation) && operation.workspaceId === id && operation.current();
}

/** Capture timers at scheduling time, including event/bulk tombstones. */
export function captureDeletionExpiry(id: string): () => void {
  const dispatch = store.dispatch;
  const backend = store.state.connections.windowBackendId;
  const token = store.state.workspace.deletionTokens[id];
  return () => {
    try {
      if (
        token &&
        store.dispatch === dispatch &&
        store.state.connections.windowBackendId === backend
      )
        dispatch(clearWorkspacePendingDeletion(id, token));
    } catch {
      /* The originating store has been disposed. */
    }
  };
}
