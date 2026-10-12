import {
  clearWorkspacePendingDeletion,
  markWorkspacePendingDeletion,
  removeWorkspaceEntity,
  setWorkspaceEntity,
} from '../workspace-slice';
import type { Workspace } from '$shared/types';

import { getPrincipalActionContext } from '../../principal/principal-projections';
import { getWorkspaceActionContext } from '../workspace-authority-projections';
import type {
  WorkspaceDomainStore,
  WorkspaceDeletion,
  WorkspaceDeletionRuntime,
} from './workspace-domain-client-types';

/** One issuer per renderer Store; only its own issued tokens can authorize deletion. */
export function createWorkspaceDeletionRuntime(
  store: WorkspaceDomainStore,
): WorkspaceDeletionRuntime {
  let sequence = 0;
  const issued = new WeakSet<object>();
  /** The row authorizes the operation before it is hidden. The token owns only that deletion. */
  function captureWorkspaceDeletion(workspace: Workspace): WorkspaceDeletion | null {
    const dispatch = store.dispatch;
    const backend = store.state.connections.windowBackendId;
    const admission = getWorkspaceActionContext(store.state, workspace.id);
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
      getPrincipalActionContext(store.state) === admission &&
      (begun
        ? owned() &&
          store.state.workspace.invalidatedDeletions[workspace.id] !== token &&
          store.state.workspace.terminalDeletions[workspace.id] !== token
        : getWorkspaceActionContext(store.state, workspace.id) === admission);
    const operation: WorkspaceDeletion = {
      workspaceId: workspace.id,
      current,
      terminal() {
        if (
          !begun ||
          !owned() ||
          getPrincipalActionContext(store.state) !== admission ||
          store.state.workspace.terminalDeletions[workspace.id] !== token
        )
          return null;
        return store.state.workspace.invalidatedDeletions[workspace.id] === token
          ? 'denied'
          : 'removed';
      },
      begin(hide = true) {
        if (begun || !current() || store.state.workspace.pendingDeletions[workspace.id])
          return false;
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

  function currentWorkspaceDeletion(operation: WorkspaceDeletion, id: string): boolean {
    return issued.has(operation) && operation.workspaceId === id && operation.current();
  }

  /** Only settles a sent delete; it cannot admit a new delete or Undo. */
  function terminalWorkspaceDeletion(operation: WorkspaceDeletion, id: string): boolean {
    return (
      issued.has(operation) && operation.workspaceId === id && operation.terminal() === 'removed'
    );
  }

  /** Capture timers at scheduling time, including event/bulk tombstones. */
  function captureDeletionExpiry(id: string): () => void {
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

  return {
    captureWorkspaceDeletion,
    currentWorkspaceDeletion,
    terminalWorkspaceDeletion,
    captureDeletionExpiry,
  };
}
