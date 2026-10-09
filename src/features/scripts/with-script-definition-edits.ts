import { store } from '$store/renderer/store';
import {
  selectScriptById,
  selectScriptDetectionOperation,
  selectWorkspaceScriptOperations,
} from '$store/renderer/slices/scripts/scripts-selectors';
import {
  editScriptRequested,
  scriptDetectionRequested,
  scriptDetectionFinished,
  scriptOperationSucceeded,
} from '$store/renderer/slices/scripts/scripts-slice';
import { m } from '$shared/paraglide/messages.js';

/** Reserve all affected definitions before a save/detection can read and upsert them. */
export async function withScriptDefinitionEdits<T extends { success: boolean; error?: string }>(
  workspaceId: string,
  scriptIds: string[] | 'workspace',
  mutation: () => Promise<T>,
): Promise<T | { success: false; error: string }> {
  if (selectScriptDetectionOperation.select(store.state, workspaceId)?.pending)
    return { success: false, error: m.scripts_pendingChange_error() };
  if (scriptIds === 'workspace') {
    if (
      Object.values(selectWorkspaceScriptOperations.select(store.state, workspaceId)).some(
        (op) => op.pending,
      )
    )
      return { success: false, error: m.scripts_pendingChange_error() };
    store.dispatch(scriptDetectionRequested(workspaceId));
    const reservation = selectScriptDetectionOperation.select(store.state, workspaceId);
    try {
      return await mutation();
    } finally {
      if (reservation === selectScriptDetectionOperation.select(store.state, workspaceId))
        store.dispatch(scriptDetectionFinished(workspaceId));
    }
  }
  const ids = [...new Set(scriptIds)];
  for (const id of ids) {
    if (!selectScriptById.select(store.state, workspaceId, id))
      return { success: false, error: m.scripts_client_notFound_error({ scriptId: id }) };
    if (selectWorkspaceScriptOperations.select(store.state, workspaceId)[id]?.pending)
      return { success: false, error: m.scripts_pendingChange_error() };
  }
  for (const id of ids) store.dispatch(editScriptRequested(workspaceId, id));
  const reservations = selectWorkspaceScriptOperations.select(store.state, workspaceId);
  try {
    return await mutation();
  } finally {
    for (const id of ids) {
      if (reservations[id] === selectWorkspaceScriptOperations.select(store.state, workspaceId)[id])
        store.dispatch(scriptOperationSucceeded(workspaceId, id, 'edit'));
    }
  }
}
