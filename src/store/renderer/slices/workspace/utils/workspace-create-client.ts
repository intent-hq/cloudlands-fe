import type { CreateWorkspaceRequest } from '$shared/types';
import { m } from '$shared/paraglide/messages.js';
import {
  getPrincipalActionContext,
  getWorkspaceCreationVisible,
} from '../../principal/principal-projections';
import type {
  WorkspaceDomainClient,
  WorkspaceDomainClientDependencies,
} from './workspace-domain-client-types';

/** Shared creation admission and response policy; the daemon owns provisioning. */
export async function createWorkspaceWithAdmission(
  { store, workspaces }: Pick<WorkspaceDomainClientDependencies, 'store' | 'workspaces'>,
  request: CreateWorkspaceRequest,
): ReturnType<WorkspaceDomainClient['create']> {
  const context = () =>
    getWorkspaceCreationVisible(store.state) ? getPrincipalActionContext(store.state) : null;
  const dispatch = store.dispatch;
  const captured = context();
  const current = () => store.dispatch === dispatch && captured !== null && captured === context();
  const retired = () => ({ ok: false as const, error: m.workspace_client_accessChanged_error() });
  if (!current()) return retired();
  const result = await workspaces.create(request);
  if (!current()) return retired();
  if (result.success && result.workspace) {
    const ws = result.workspace;
    return {
      ok: true,
      data: {
        workspace: {
          ...ws,
          path: ws.path?.replaceAll('\\', '/'),
          repositoryPath: ws.repositoryPath?.replaceAll('\\', '/'),
          worktreePath: ws.worktreePath?.replaceAll('\\', '/'),
        },
        initialAgent: result.initialAgent,
      },
    };
  }
  const error = result.error || m.workspace_client_createFailed_error();
  return result.errorCode
    ? { ok: false, error, errorCode: result.errorCode }
    : { ok: false, error };
}
