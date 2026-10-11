import { backendRequest } from '@/features/backend/backend-transport';
import type { Workspace } from '$shared/types';
/** The same complete archived-inclusive daemon list that backs Electron workspace:list. */
export async function listAuthorityWorkspaces() {
  const result = await backendRequest<{ workspaces: Workspace[] }>('workspace.list', {
    includeArchived: true,
  });
  if (!Array.isArray(result.workspaces)) throw new Error('Invalid workspace.list response');
  return { ok: true as const, data: result.workspaces, complete: true };
}

export async function getAuthorityWorkspace(workspaceId: string): Promise<Workspace | null> {
  const result = await backendRequest<{ workspace: Workspace | null } | Workspace | null>(
    'workspace.get',
    { workspaceId },
  );
  return result && 'workspace' in result ? result.workspace : result;
}
