import type { Workspace } from '$shared/types';
import { CHIEF_WORKSPACE_ID, ROOT_WORKSPACE_ID } from '$shared/types/branded-ids';
import type { HostRole } from '$shared/types/principal';

/**
 * Workspace-independent principal facts. Derive once with
 * `selectWorkspaceAuthority`, then apply the per-row rules below to any number
 * of workspaces: `.select()` is not memoized, so re-deriving these per row
 * made recovery scans O(rows × authority) on every store update.
 */
export interface WorkspaceAuthority {
  snapshotReady: boolean;
  hostMembership: boolean;
  role: HostRole | null;
  revoked: boolean;
  canAdministerHost: boolean;
  collaborationReady: boolean;
  /** Read only when `hostMembership` is true. */
  capabilitiesReady: boolean;
  actionContext: string | null;
}

type WorkspaceRow = Pick<Workspace, 'myRole' | 'canManage'> | undefined;
/** Called only after the principal checks, matching the selectors' original read order. */
type ReadRow = () => WorkspaceRow;

const isVirtualWorkspace = (wsId: string) =>
  wsId === CHIEF_WORKSPACE_ID || wsId === ROOT_WORKSPACE_ID;

/** Server management authority, independent of owner metadata and experimental visibility. */
export function canManageWorkspace(
  authority: WorkspaceAuthority,
  wsId: string,
  readRow: ReadRow,
): boolean {
  if (!authority.snapshotReady || authority.role === null) return false;
  // Virtual host administration never inherits member workspace rights.
  if (isVirtualWorkspace(wsId)) return authority.role === 'owner';
  const row = readRow();
  if (!row) return false;
  if (authority.hostMembership) return authority.capabilitiesReady && row.canManage === true;
  // A guest may retain ownership of one workspace without owning the host.
  return (
    row.myRole === 'owner' ||
    (authority.role === 'owner' && row.myRole !== 'collaborator' && row.myRole !== 'manager')
  );
}

/** Confirmed denial permits destructive cleanup; unknown authority and lab visibility do not. */
export function workspaceManagementDenied(
  authority: WorkspaceAuthority,
  wsId: string,
  readRow: ReadRow,
): boolean {
  if (authority.revoked) return true;
  if (authority.role === null) return false;
  if (isVirtualWorkspace(wsId)) return authority.role !== 'owner';
  const row = readRow();
  if (authority.hostMembership) return authority.capabilitiesReady && row?.canManage === false;
  return row?.myRole === 'collaborator' || row?.myRole === 'manager';
}

/** Existing owner controls remain ordinary UI; member management is an experimental surface. */
export function workspaceManagementVisible(
  authority: WorkspaceAuthority,
  wsId: string,
  readRow: ReadRow,
): boolean {
  return (
    canManageWorkspace(authority, wsId, readRow) &&
    (authority.canAdministerHost || authority.collaborationReady)
  );
}

/** Collaborators retain ordinary chat/permission rights, without management authority. */
export function workspaceParticipationContext(
  authority: WorkspaceAuthority,
  wsId: string,
  readRow: ReadRow,
): string | null {
  if (!authority.snapshotReady) return null;
  // Chief is a host-owner surface, without an ordinary workspace membership row.
  if (wsId === CHIEF_WORKSPACE_ID)
    return authority.canAdministerHost ? authority.actionContext : null;
  if (authority.hostMembership && !authority.capabilitiesReady) return null;
  if (!authority.canAdministerHost && !authority.collaborationReady) return null;
  const row = readRow();
  if (
    !row ||
    (row.myRole !== 'owner' &&
      row.myRole !== 'collaborator' &&
      row.myRole !== 'manager' &&
      row.canManage !== true)
  )
    return null;
  return authority.actionContext;
}

/** Current shared-host prompt service uses canManage; legacy guest prompts keep their wire rights. */
export function workspacePermissionContext(
  authority: WorkspaceAuthority,
  wsId: string,
  readRow: ReadRow,
): string | null {
  if (!authority.hostMembership) return workspaceParticipationContext(authority, wsId, readRow);
  return workspaceManagementVisible(authority, wsId, readRow) ? authority.actionContext : null;
}
