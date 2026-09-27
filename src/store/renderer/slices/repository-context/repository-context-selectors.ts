import { getItem } from '@augmentcode/themis/utils/collections/collection-utils';
import { repositoryRootKey, type RepositoryRootIdentity } from '$shared/types/repository-context';
import { store } from '../../store';
import { getRepositoryContextWorkspaceState } from './repository-context-slice';

/** Callers supply the current captured upstream context, never an active-workspace fallback. */
export const selectRepositoryContextState = store.createSelector(
  (state, workspaceId: string, binding: string | null) => {
    const current = getRepositoryContextWorkspaceState(state.repositoryContext, workspaceId);
    return binding !== null && current.binding === binding ? current : null;
  },
);

export const selectRepositoryContextRoot = store.createSelector(
  (state, root: RepositoryRootIdentity, binding: string | null) => {
    const current = selectRepositoryContextState.select(state, root.workspaceId, binding);
    return current?.status === 'ready'
      ? getItem(current.roots, repositoryRootKey(root))?.context
      : undefined;
  },
);
