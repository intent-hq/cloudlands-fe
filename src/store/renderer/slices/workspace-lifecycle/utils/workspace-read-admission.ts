import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import type { LifecycleReadDependencies, LifecycleReadState } from '../lifecycle-read-types';

/** Canonical same-snapshot admission, preserving selector read and short-circuit order. */
export function getAdmittedWorkspaceReadContext<State extends LifecycleReadState>(
  state: State,
  workspaceId: string,
  selectors: Pick<
    LifecycleReadDependencies<State, { requestId: string }>['selectors'],
    | 'selectPrincipalActionContext'
    | 'selectHostRole'
    | 'selectWorkspaceById'
    | 'selectWorkspaceListLoadedForBackend'
  >,
): string | null {
  const {
    selectPrincipalActionContext,
    selectHostRole,
    selectWorkspaceById,
    selectWorkspaceListLoadedForBackend,
  } = selectors;
  const context = selectPrincipalActionContext.select(state);
  const role = selectHostRole.select(state);
  if (
    !context ||
    (role !== 'owner' && role !== 'member') ||
    (role === 'member' && workspaceId === CHIEF_WORKSPACE_ID) ||
    !selectWorkspaceById.select(state, workspaceId) ||
    !selectWorkspaceListLoadedForBackend.select(state, state.connections.windowBackendId) ||
    state.workspace.capabilityContext !== context
  )
    return null;
  return context;
}
