import { store } from '@/store';
import { workspaceClient } from '@/features/workspace/workspace-client';
import { createWorkspaceTitleSaga } from '../../../../../../src/store/renderer/slices/workspace/sagas/workspace-title-saga-factory';
import { selectWorkspaceById } from '../workspace-selectors';
import {
  selectPendingWorkspaceTitleToken,
  selectWorkspaceTitleAuthority,
  selectWorkspaceTitleContext,
  selectWorkspaceTitleOperations,
  selectWorkspaceTitleRevision,
  selectWorkspaceTitleViewCurrent,
} from '../workspace-title-selectors';

export const workspaceTitleSaga = createWorkspaceTitleSaga({
  update: (request, options) => workspaceClient.update(request, options),
  selectWorkspace: (id) => selectWorkspaceById.effect(id),
  selectPendingToken: (id) => selectPendingWorkspaceTitleToken.effect(id),
  admission: {
    selectOperations: (id) => selectWorkspaceTitleOperations.effect(id),
    selectRevision: (id) => selectWorkspaceTitleRevision.effect(id),
    readRevision: (id) => selectWorkspaceTitleRevision.select(store.state, id),
    isCurrent: (request) =>
      selectWorkspaceTitleViewCurrent.select(store.state, request) &&
      selectWorkspaceTitleAuthority.select(store.state, request.workspaceId) ===
        request.authority &&
      selectWorkspaceTitleContext.select(store.state, request.workspaceId) === request.context,
    canPublish: (request) =>
      selectWorkspaceTitleAuthority.select(store.state, request.workspaceId) === request.authority,
    dispatch: (action) => store.dispatch(action),
  },
});
