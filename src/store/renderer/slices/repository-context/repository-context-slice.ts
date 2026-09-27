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
  RepositoryContextState,
  RepositoryContextWorkspaceState,
} from './repository-context-types';

const emptyWorkspaceState: RepositoryContextWorkspaceState = {
  binding: null,
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

export const repositoryContextBound =
  createAction<[workspaceId: string, binding: string]>('repositoryContext/bound');
export const repositoryContextRetired = createAction<[workspaceId: string, binding: string]>(
  'repositoryContext/retired',
);
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
  (state, { payload: [workspaceId, binding] }) => {
    const current = getWorkspaceState(state, workspaceId);
    if (current.binding === binding) return state;
    return setWorkspaceState(state, workspaceId, { ...emptyWorkspaceState, binding });
  },
);

repositoryContextReducer.with(
  repositoryContextRetired,
  (state, { payload: [workspaceId, binding] }) => {
    if (getWorkspaceState(state, workspaceId).binding !== binding) return state;
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
    pending: { ...request },
    unavailableReason: null,
  });
});

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
