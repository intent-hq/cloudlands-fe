import { ROOT_WORKSPACE_ID, isValidWorkspaceId, type WorkspaceId } from '$shared/types/branded-ids';

interface TerminalShortcutContext {
  isOnWorkspacePage: boolean;
  useSelectedWorkspace: boolean;
  selectedWorkspaceId: string | null | undefined;
  routeWorkspaceId: string | null | undefined;
}

export function resolveTerminalShortcutWorkspaceId({
  isOnWorkspacePage,
  useSelectedWorkspace,
  selectedWorkspaceId,
  routeWorkspaceId,
}: TerminalShortcutContext): WorkspaceId {
  if (!isOnWorkspacePage) return ROOT_WORKSPACE_ID;

  const candidate =
    (useSelectedWorkspace ? selectedWorkspaceId : null) ?? routeWorkspaceId ?? ROOT_WORKSPACE_ID;
  return candidate !== 'new' && isValidWorkspaceId(candidate) ? candidate : ROOT_WORKSPACE_ID;
}
