import { getItem, getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import {
  repositoryRootKey,
  type RepositoryRootIdentity,
  type RepositoryRootContext,
} from '$shared/types/repository-context';
import { store } from '../../store';
import type { AppSelector } from '../../types';
import { selectPrincipalAdmissionContext } from '../principal/principal-selectors';
import type {
  RepositoryContextDemand,
  RepositoryContextDemandView,
  RepositoryContextWorkspaceState,
} from './repository-context-types';
import { getRepositoryContextWorkspaceState } from './repository-context-slice';

/** Callers supply the current captured upstream context, never an active-workspace fallback. */
export const selectRepositoryContextState: AppSelector<
  RepositoryContextWorkspaceState | null,
  [workspaceId: string, binding: string | null]
> = store.createSelector((state, workspaceId: string, binding: string | null) => {
  const current = getRepositoryContextWorkspaceState(state.repositoryContext, workspaceId);
  return binding !== null && current.binding === binding ? current : null;
});

export const selectRepositoryContextRoot: AppSelector<
  RepositoryRootContext | undefined,
  [root: RepositoryRootIdentity, binding: string | null]
> = store.createSelector((state, root: RepositoryRootIdentity, binding: string | null) => {
  const current = selectRepositoryContextState.select(state, root.workspaceId, binding);
  return current?.status === 'ready'
    ? getItem(current.roots, repositoryRootKey(root))?.context
    : undefined;
});

/** Never decode a binding or adopt a row by workspace/demand alone. Keep the original descriptor. */
export const selectRepositoryContextForDemand: AppSelector<
  RepositoryContextDemandView | null,
  [demand: RepositoryContextDemand]
> = store.createSelector((state, demand) => {
  if (
    demand.admission === null ||
    selectPrincipalAdmissionContext.select(state) !== demand.admission
  )
    return null;
  const current = getRepositoryContextWorkspaceState(state.repositoryContext, demand.workspaceId);
  const owner = current.ownership;
  if (
    !owner ||
    owner.demandId !== demand.demandId ||
    owner.admission !== demand.admission ||
    owner.request.workspaceId !== demand.workspaceId
  )
    return null;
  return {
    status: current.status,
    scope: current.scope,
    revision: current.revision,
    roots: current.status === 'ready' ? getItems(current.roots).map((entry) => entry.context) : [],
    unavailableReason: current.unavailableReason,
  };
});
