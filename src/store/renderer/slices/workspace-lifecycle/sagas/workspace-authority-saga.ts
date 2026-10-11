import { selectCurrentConnectionId } from '../../connections/connections-selectors';
// Svelte lifetime binding; remove at the Svelte renderer cutover.
import { store } from '../../../store';
import { appClient } from '$lib/client';
import { workspaceClient } from '../../workspace/utils/workspace.client';
import { selectPrincipalActionContext } from '../../principal/principal-selectors';
import { selectWorkspaceListLoadedForBackend } from '../../workspace/workspace-selectors';
import { selectWorkspaceDeletionTokens } from '../../workspace/workspace-selectors';
import { createWorkspaceAuthoritySaga } from './workspace-authority-saga-factory';
export const workspaceAuthoritySaga = createWorkspaceAuthoritySaga({
  dispatchIdentity: () => store.dispatch,
  backendIdEffect: selectCurrentConnectionId.effect,
  principalContextEffect: selectPrincipalActionContext.effect,
  deletionTokensEffect: selectWorkspaceDeletionTokens.effect,
  listLoadedEffect: selectWorkspaceListLoadedForBackend.effect,
  listWorkspaces: () => workspaceClient.list({ lite: true }),
  recentViews: () => appClient.workspaces.recentViews(),
});
