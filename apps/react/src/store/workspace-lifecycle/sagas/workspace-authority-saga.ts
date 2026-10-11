import { selectCurrentConnectionId } from '../../connections/connections-selectors';
import { all, call, race, take } from 'typed-redux-saga';
import { createLogger } from '$lib/utils/client-logger';
import { createWorkspaceMembershipSaga } from '../../../../../../src/store/renderer/slices/workspace-lifecycle/sagas/workspace-membership-saga-factory';
import {
  backendReconnected,
  workspaceUnmounted,
} from '../../../../../../src/store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
const logger = createLogger('WorkspaceAuthoritySaga');
import { store } from '@/store';
import {
  listAuthorityWorkspaces,
  getAuthorityWorkspace,
} from '@/features/principal/workspace-authority-client';
import { selectPrincipalActionContext } from '../../principal/principal-selectors';
import {
  selectWorkspaceListLoadedForBackend,
  selectWorkspaceDeletionTokens,
  selectWorkspaceById,
} from '../../workspace/workspace-selectors';
import { createWorkspaceAuthoritySaga } from '../../../../../../src/store/renderer/slices/workspace-lifecycle/sagas/workspace-authority-saga-factory';
const workspaceListSaga = createWorkspaceAuthoritySaga({
  dispatchIdentity: () => store.dispatch,
  backendIdEffect: selectCurrentConnectionId.effect,
  principalContextEffect: selectPrincipalActionContext.effect,
  deletionTokensEffect: selectWorkspaceDeletionTokens.effect,
  listLoadedEffect: selectWorkspaceListLoadedForBackend.effect,
  listWorkspaces: listAuthorityWorkspaces,
});

const workspaceMembershipSaga = createWorkspaceMembershipSaga({
  principalContextEffect: selectPrincipalActionContext.effect,
  workspaceByIdEffect: selectWorkspaceById.effect,
  getWorkspace: getAuthorityWorkspace,
  runRead: function* (id, read) {
    try {
      yield* race({
        read: call(read, id),
        reconnected: take(backendReconnected),
        unmounted: take(
          (action: { type: string; payload?: unknown[] }) =>
            action.type === workspaceUnmounted.type && action.payload?.[0] === id,
        ),
      });
    } catch (error) {
      logger.warn('Workspace membership read failed', error);
    }
  },
});
export function* workspaceAuthoritySaga() {
  yield* all([call(workspaceListSaga), call(workspaceMembershipSaga)]);
}
