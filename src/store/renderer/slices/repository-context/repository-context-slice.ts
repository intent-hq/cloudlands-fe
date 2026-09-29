import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import {
  compareRepositoryContextRevisions,
  repositoryRootKey,
  isRepositoryContextForRequest,
  type RepositoryContextRequest,
  type RepositoryContextResponse,
} from '$shared/types/repository-context';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import type {
  RepositoryContextDemandOwnership,
  RepositoryContextState,
  RepositoryContextWorkspaceState,
} from './repository-context-types';

const emptyWorkspaceState: RepositoryContextWorkspaceState = {
  binding: null,
  ownership: null,
  status: 'inactive',
  scope: null,
  revision: null,
  roots: createCollection('id'),
  pending: null,
  unavailableReason: null,
};
const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } =
  createWorkspaceScopedHelpers(emptyWorkspaceState);
export { getWorkspaceState as getRepositoryContextWorkspaceState };

/** Pass the original captured admission for typed UI demands; omitted keeps legacy callers. */
export const repositoryContextDemanded = createAction<
  [workspaceId: string, demandId: string, admission?: string | null]
>('repositoryContext/demanded');
export const repositoryContextDemandEnded = createAction<
  [workspaceId: string, demandId: string, admission?: string | null]
>('repositoryContext/demandEnded');

export const repositoryContextBound =
  createAction<
    [workspaceId: string, binding: string, ownership?: RepositoryContextDemandOwnership]
  >('repositoryContext/bound');
export const repositoryContextRetired = createAction<
  [workspaceId: string, binding: string, ownedRequestId?: string]
>('repositoryContext/retired');
export const repositoryContextStarted = createAction<[request: RepositoryContextRequest]>(
  'repositoryContext/started',
);
export const repositoryContextReceived = createAction<[response: RepositoryContextResponse]>(
  'repositoryContext/received',
);
export const repositoryContextFailed = createAction<[request: RepositoryContextRequest]>(
  'repositoryContext/failed',
);

const initialState: RepositoryContextState = { byWorkspaceId: {} };
export const repositoryContextReducer = createReducer<RepositoryContextState>(initialState);

repositoryContextReducer.with(
  repositoryContextBound,
  (state, { payload: [workspaceId, binding, ownership] }) => {
    const current = getWorkspaceState(state, workspaceId);
    if (current.binding === binding) return state;
    if (
      ownership &&
      (ownership.request.workspaceId !== workspaceId || ownership.request.binding !== binding)
    )
      return state;
    return setWorkspaceState(state, workspaceId, {
      ...emptyWorkspaceState,
      binding,
      ownership: ownership ? { ...ownership, request: { ...ownership.request } } : null,
    });
  },
);

repositoryContextReducer.with(
  repositoryContextRetired,
  (state, { payload: [workspaceId, binding, ownedRequestId] }) => {
    const current = getWorkspaceState(state, workspaceId);
    if (ownedRequestId !== undefined && current.ownership?.request.requestId !== ownedRequestId)
      return state;
    if (current.binding !== binding && current.ownership?.request.binding !== binding) return state;
    return clearWorkspaceState(state, workspaceId);
  },
);

repositoryContextReducer.with(workspaceUnmounted, (state, { payload: [workspaceId] }) =>
  clearWorkspaceState(state, workspaceId),
);

repositoryContextReducer.with(repositoryContextStarted, (state, { payload: [request] }) => {
  const current = getWorkspaceState(state, request.workspaceId);
  if (current.binding === null || current.binding !== request.binding) return state;
  return setWorkspaceState(state, request.workspaceId, {
    ...current,
    status: 'loading',
    ownership:
      current.ownership && matchesRequest(current.ownership.request, request)
        ? current.ownership
        : null,
    pending: { ...request },
    unavailableReason: null,
  });
});

function matchesRequest(left: RepositoryContextRequest, right: RepositoryContextRequest): boolean {
  return (
    left.binding === right.binding &&
    left.requestId === right.requestId &&
    left.workspaceId === right.workspaceId &&
    left.gitRootId === right.gitRootId
  );
}

function matchesPending(
  current: RepositoryContextWorkspaceState,
  request: RepositoryContextRequest,
): boolean {
  return (
    current.binding !== null &&
    current.binding === request.binding &&
    current.pending?.requestId === request.requestId &&
    current.pending.workspaceId === request.workspaceId &&
    current.pending.gitRootId === request.gitRootId
  );
}

repositoryContextReducer.with(
  repositoryContextReceived,
  (state, { payload: [{ request, context }] }) => {
    const current = getWorkspaceState(state, request.workspaceId);
    if (!matchesPending(current, request)) return state;
    const order =
      current.scope && current.revision
        ? compareRepositoryContextRevisions(context, {
            scope: current.scope,
            revision: current.revision,
          })
        : 0;
    const valid = isRepositoryContextForRequest(context, request);
    if (order === null || !valid) {
      return setWorkspaceState(state, request.workspaceId, {
        ...emptyWorkspaceState,
        ownership: current.ownership,
        status: 'unavailable',
        unavailableReason: valid ? 'context-changed' : 'invalid-response',
      });
    }
    if (order < 0) {
      // Keep the revision floor, but never expose an older response as fresh data.
      return setWorkspaceState(state, request.workspaceId, {
        ...current,
        status: 'unavailable',
        pending: null,
        roots: createCollection('id'),
        unavailableReason: 'context-changed',
      });
    }
    return setWorkspaceState(state, request.workspaceId, {
      ...current,
      status: 'ready',
      pending: null,
      scope: context.scope,
      revision: context.revision,
      roots: createCollection(
        'id',
        context.roots.map((entry) => ({ id: repositoryRootKey(entry.root), context: entry })),
      ),
      unavailableReason: null,
    });
  },
);

repositoryContextReducer.with(repositoryContextFailed, (state, { payload: [request] }) => {
  const current = getWorkspaceState(state, request.workspaceId);
  if (!matchesPending(current, request)) return state;
  return setWorkspaceState(state, request.workspaceId, {
    ...current,
    status: 'unavailable',
    pending: null,
    roots: createCollection('id'),
    unavailableReason: 'read-failed',
  });
});
