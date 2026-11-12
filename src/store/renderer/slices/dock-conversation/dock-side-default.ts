import { store } from '../../store';
import { getPrincipalActionContext } from '../principal/principal-context';
import { selectDockWorkspaces } from '../hud/hud-selectors';
import { selectDockShortcutWorkspaces } from './dock-conversation-selectors';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';

/**
 * The chat the open shortcut returns to when the dock is on a screen side: the chat open
 * in the dock, else the last one opened from it (same machine and authority, still
 * present), else the first workspace the side shows. Null when there is no workspace.
 */
function dockSideDefaultWorkspaceId(state: typeof store.state): string | null {
  const ids = selectDockShortcutWorkspaces.select(state).map((row) => String(row.id));
  const known = (id: string | null | undefined): id is string =>
    !!id && (id === CHIEF_WORKSPACE_ID || ids.includes(id));
  const authority = getPrincipalActionContext(state);
  const dock = state.dockConversation;
  if (dock.authority && dock.authority === authority && known(dock.workspaceId))
    return dock.workspaceId;
  const selection = dock.shortcutSelection;
  if (
    selection &&
    selection.backendId === state.connections.windowBackendId &&
    selection.authority === authority &&
    known(selection.workspaceId)
  )
    return selection.workspaceId;
  const shown = selectDockWorkspaces
    .select(state)
    .map((view) => String(view.workspace.id))
    .find((id) => ids.includes(id));
  return shown ?? ids[0] ?? null;
}

export const selectDockSideDefaultWorkspaceId = store.createSelector(dockSideDefaultWorkspaceId);
