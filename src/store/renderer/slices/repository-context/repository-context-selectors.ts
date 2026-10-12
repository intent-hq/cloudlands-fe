import { selectWorkspaceActionContext } from '../workspace/workspace-selectors';
import type { NativeReviewOwner } from '$shared/types/native-review-operation';
import type { NativeReviewAttemptState } from './repository-context-types';
import type { RepositorySelectionEdit } from '$shared/types/repository-selection';
import type { RepositorySelectionEditState } from './repository-context-types';
import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import {
  repositoryRootKey,
  type RepositoryRootIdentity,
  type RepositoryRootContext,
} from '$shared/types/repository-context';
import { store } from '../../store';
import type { AppSelector } from '../../types';
import { selectPrincipalActionContext } from '../principal/principal-selectors';
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
  if (demand.admission === null || selectPrincipalActionContext.select(state) !== demand.admission)
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

/** Presentation of only the original edit owner; no private route or server reference. */
export const selectRepositorySelectionForEdit: AppSelector<
  RepositorySelectionEditState | null,
  [owner: RepositorySelectionEdit]
> = store.createSelector((state, owner) => {
  if (owner.admission === null || selectPrincipalActionContext.select(state) !== owner.admission)
    return null;
  const edits = state.repositoryContext.selectionEdits;
  const edit = edits ? getItem(edits, owner.editId) : undefined;
  return edit &&
    edit.status !== 'closed' &&
    edit.owner.admission === owner.admission &&
    repositoryRootKey(edit.owner.root) === repositoryRootKey(owner.root)
    ? edit
    : null;
});

export const selectRepositorySelectionPending = store.createSelector(
  (state, workspaceId: string) => {
    const edits = state.repositoryContext.selectionEdits;
    return (
      !!edits &&
      getItems(edits).some(
        (edit) =>
          edit.owner.root.workspaceId === workspaceId &&
          edit.owner.admission === selectPrincipalActionContext.select(state) &&
          (edit.status === 'capturing' ||
            (edit.status === 'pending' &&
              (!edit.observation || edit.observation.attempt?.status === 'pending'))),
      )
    );
  },
);

/** Presentation of only the original edit owner; no private route or server reference. */
export const selectNativeReviewForOwner: AppSelector<
  NativeReviewAttemptState | null,
  [owner: NativeReviewOwner]
> = store.createSelector((state, owner) => {
  if (owner.admission === null || selectPrincipalActionContext.select(state) !== owner.admission)
    return null;
  if (
    owner.hostContext === null ||
    selectWorkspaceActionContext.select(state, owner.root.workspaceId) !== owner.hostContext
  )
    return null;
  const edits = state.repositoryContext.nativeReviewAttempts;
  const edit = edits ? getItem(edits, owner.attemptId) : undefined;
  return edit &&
    edit.status !== 'closed' &&
    edit.owner.admission === owner.admission &&
    edit.owner.hostContext === owner.hostContext &&
    repositoryRootKey(edit.owner.root) === repositoryRootKey(owner.root)
    ? edit
    : null;
});

/** Internal occupancy survives public closure; it cannot grant a preparation or a new command. */
export const selectNativeReviewOccupancy: AppSelector<
  NativeReviewAttemptState | undefined,
  [attemptId: string]
> = store.createSelector((state, attemptId) =>
  state.repositoryContext.nativeReviewAttempts
    ? getItem(state.repositoryContext.nativeReviewAttempts, attemptId)
    : undefined,
);
