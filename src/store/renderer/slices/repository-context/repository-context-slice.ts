import type {
  NativeReviewOwner,
  NativeReviewInput,
  NativeReviewPreparedView,
  NativeReviewTextCommand,
  NativeReviewObservation,
  NativeReviewRetirement,
} from '$shared/types/native-review-operation';
import type { NativeReviewAttemptState } from './repository-context-types';
import type {
  RepositorySelectionEdit,
  SelectionCommand,
  SelectionPreview,
  SelectionObservation,
  SelectionRetirement,
} from '$shared/types/repository-selection';
import type { RepositorySelectionEditState } from './repository-context-types';
import {
  createCollection,
  addItem,
  getItem,
  getItems,
  removeItem,
  updateItem,
} from '@augmentcode/themis/utils/collections/collection-utils';
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

repositoryContextReducer.with(workspaceUnmounted, (state, { payload: [workspaceId] }) => {
  let cleared = clearWorkspaceState(state, workspaceId);
  for (const attempt of getItems(state.nativeReviewAttempts ?? emptyNativeAttempts)) {
    if (attempt.owner.root.workspaceId === workspaceId)
      cleared = closeNativeAttempt(cleared, attempt.owner);
  }
  let edits = state.selectionEdits;
  if (!edits) return cleared;
  for (const edit of getItems(edits))
    if (edit.owner.root.workspaceId === workspaceId) edits = removeItem(edits, edit.editId);
  return { ...cleared, selectionEdits: edits };
});

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

// Editing operations are separate from read rows: a read retirement is not a write outcome.
export const repositorySelectionEditRequested = createAction<[owner: RepositorySelectionEdit]>(
  'repositoryContext/selectionEditRequested',
);
export const repositorySelectionConfirmRequested = createAction<
  [owner: RepositorySelectionEdit, command: SelectionCommand]
>('repositoryContext/selectionConfirmRequested');
export const repositorySelectionReconcileRequested = createAction<[owner: RepositorySelectionEdit]>(
  'repositoryContext/selectionReconcileRequested',
);
export const repositorySelectionEditEnded = createAction<[owner: RepositorySelectionEdit]>(
  'repositoryContext/selectionEditEnded',
);
export const repositorySelectionEditStarted = createAction<[owner: RepositorySelectionEdit]>(
  'repositoryContext/selectionEditStarted',
);
export const repositorySelectionPreviewReceived = createAction<
  [owner: RepositorySelectionEdit, preview: SelectionPreview]
>('repositoryContext/selectionPreviewReceived');
export const repositorySelectionCommandStarted = createAction<[owner: RepositorySelectionEdit]>(
  'repositoryContext/selectionCommandStarted',
);
export const repositorySelectionObserved = createAction<
  [owner: RepositorySelectionEdit, observation: SelectionObservation]
>('repositoryContext/selectionObserved');
export const repositorySelectionRetired = createAction<
  [owner: RepositorySelectionEdit, kind: SelectionRetirement]
>('repositoryContext/selectionRetired');
export const repositorySelectionUnavailable = createAction<[owner: RepositorySelectionEdit]>(
  'repositoryContext/selectionUnavailable',
);
export const repositorySelectionEditCleared = createAction<[owner: RepositorySelectionEdit]>(
  'repositoryContext/selectionEditCleared',
);
const emptyEdits = createCollection<RepositorySelectionEditState, 'editId'>('editId');
function ownedEdit(state: RepositoryContextState, owner: RepositorySelectionEdit) {
  const entry = getItem(state.selectionEdits ?? emptyEdits, owner.editId);
  return entry &&
    entry.owner.admission === owner.admission &&
    repositoryRootKey(entry.owner.root) === repositoryRootKey(owner.root)
    ? entry
    : undefined;
}
function updateEdit(
  state: RepositoryContextState,
  owner: RepositorySelectionEdit,
  update: Partial<RepositorySelectionEditState>,
) {
  return ownedEdit(state, owner)
    ? {
        ...state,
        selectionEdits: updateItem(state.selectionEdits ?? emptyEdits, {
          ...update,
          editId: owner.editId,
        }),
      }
    : state;
}
repositoryContextReducer.with(repositorySelectionEditStarted, (state, { payload: [owner] }) => {
  const edits = state.selectionEdits ?? emptyEdits;
  if (owner.admission === null || getItem(edits, owner.editId) || getItems(edits).length >= 32)
    return state;
  return {
    ...state,
    selectionEdits: addItem(edits, {
      editId: owner.editId,
      owner: { ...owner, root: { ...owner.root } },
      status: 'capturing',
      preview: null,
      observation: null,
    }),
  };
});
repositoryContextReducer.with(
  repositorySelectionPreviewReceived,
  (state, { payload: [owner, preview] }) => {
    if (
      ownedEdit(state, owner)?.status !== 'capturing' ||
      repositoryRootKey(preview.root) !== repositoryRootKey(owner.root)
    )
      return state;
    return updateEdit(state, owner, { status: 'ready', preview });
  },
);
repositoryContextReducer.with(repositorySelectionCommandStarted, (state, { payload: [owner] }) =>
  ownedEdit(state, owner)?.status === 'ready'
    ? updateEdit(state, owner, { status: 'pending' })
    : state,
);
repositoryContextReducer.with(
  repositorySelectionObserved,
  (state, { payload: [owner, observation] }) => {
    const old = ownedEdit(state, owner);
    if (!old) return state;
    const retained = old.observation?.attempt?.status === 'settled' ? old.observation : observation;
    return updateEdit(state, owner, {
      observation: {
        ...retained,
        current: observation.current && old.status !== 'retired' && old.status !== 'closed',
      },
    });
  },
);
repositoryContextReducer.with(repositorySelectionRetired, (state, { payload: [owner, kind] }) => {
  const old = ownedEdit(state, owner);
  if (!old || old.status === 'closed') return state;
  return updateEdit(state, owner, {
    status: kind === 'closed' ? 'closed' : 'retired',
    preview: null,
    observation: old.observation ? { ...old.observation, current: false } : null,
  });
});
repositoryContextReducer.with(repositorySelectionUnavailable, (state, { payload: [owner] }) =>
  updateEdit(state, owner, { status: 'unavailable', preview: null }),
);
repositoryContextReducer.with(repositorySelectionEditCleared, (state, { payload: [owner] }) =>
  ownedEdit(state, owner)
    ? { ...state, selectionEdits: removeItem(state.selectionEdits ?? emptyEdits, owner.editId) }
    : state,
);

// Native preparation owns one action, independently of context and selection reads.
export const nativeReviewEditRequested = createAction<
  [owner: NativeReviewOwner, input: NativeReviewInput]
>('repositoryContext/nativeReviewAttemptRequested');
export const nativeReviewConfirmRequested = createAction<
  [owner: NativeReviewOwner, command: NativeReviewTextCommand]
>('repositoryContext/nativeReviewConfirmRequested');
export const nativeReviewReconcileRequested = createAction<[owner: NativeReviewOwner]>(
  'repositoryContext/nativeReviewReconcileRequested',
);
export const nativeReviewEditEnded = createAction<[owner: NativeReviewOwner]>(
  'repositoryContext/nativeReviewAttemptEnded',
);
export const nativeReviewEditStarted = createAction<[owner: NativeReviewOwner]>(
  'repositoryContext/nativeReviewAttemptStarted',
);
export const nativeReviewPreviewReceived = createAction<
  [owner: NativeReviewOwner, preview: NativeReviewPreparedView]
>('repositoryContext/nativeReviewPreviewReceived');
export const nativeReviewCommandStarted = createAction<[owner: NativeReviewOwner]>(
  'repositoryContext/nativeReviewCommandStarted',
);
export const nativeReviewObserved = createAction<
  [owner: NativeReviewOwner, observation: NativeReviewObservation]
>('repositoryContext/nativeReviewObserved');
export const nativeReviewRetired = createAction<
  [owner: NativeReviewOwner, kind: NativeReviewRetirement]
>('repositoryContext/nativeReviewRetired');
export const nativeReviewUnavailable = createAction<[owner: NativeReviewOwner]>(
  'repositoryContext/nativeReviewUnavailable',
);
export const nativeReviewEditCleared = createAction<[owner: NativeReviewOwner]>(
  'repositoryContext/nativeReviewAttemptCleared',
);
const emptyNativeAttempts = createCollection<NativeReviewAttemptState, 'attemptId'>('attemptId');
function ownedNativeAttempt(state: RepositoryContextState, owner: NativeReviewOwner) {
  const entry = getItem(state.nativeReviewAttempts ?? emptyNativeAttempts, owner.attemptId);
  return entry &&
    entry.owner.admission === owner.admission &&
    entry.owner.hostContext === owner.hostContext &&
    repositoryRootKey(entry.owner.root) === repositoryRootKey(owner.root)
    ? entry
    : undefined;
}
function updateNativeAttempt(
  state: RepositoryContextState,
  owner: NativeReviewOwner,
  update: Partial<NativeReviewAttemptState>,
) {
  return ownedNativeAttempt(state, owner)
    ? {
        ...state,
        nativeReviewAttempts: updateItem(state.nativeReviewAttempts ?? emptyNativeAttempts, {
          ...update,
          attemptId: owner.attemptId,
        }),
      }
    : state;
}
repositoryContextReducer.with(nativeReviewEditStarted, (state, { payload: [owner] }) => {
  const edits = state.nativeReviewAttempts ?? emptyNativeAttempts;
  if (owner.admission === null || getItem(edits, owner.attemptId) || getItems(edits).length >= 32)
    return state;
  return {
    ...state,
    nativeReviewAttempts: addItem(edits, {
      attemptId: owner.attemptId,
      owner: { ...owner, root: { ...owner.root } },
      status: 'capturing',
      preview: null,
      observation: null,
    }),
  };
});
repositoryContextReducer.with(
  nativeReviewPreviewReceived,
  (state, { payload: [owner, preview] }) => {
    if (
      ownedNativeAttempt(state, owner)?.status !== 'capturing' ||
      repositoryRootKey(preview.root) !== repositoryRootKey(owner.root)
    )
      return state;
    return updateNativeAttempt(state, owner, { status: 'ready', preview });
  },
);
repositoryContextReducer.with(nativeReviewCommandStarted, (state, { payload: [owner] }) =>
  ownedNativeAttempt(state, owner)?.status === 'ready'
    ? updateNativeAttempt(state, owner, { status: 'pending' })
    : state,
);
repositoryContextReducer.with(nativeReviewObserved, (state, { payload: [owner, observation] }) => {
  const old = ownedNativeAttempt(state, owner);
  if (!old) return state;
  const retained = observation;
  return updateNativeAttempt(state, owner, {
    observation: {
      ...retained,
      current: observation.current && old.status !== 'retired' && old.status !== 'closed',
    },
  });
});
repositoryContextReducer.with(nativeReviewRetired, (state, { payload: [owner, kind] }) => {
  const old = ownedNativeAttempt(state, owner);
  if (!old || old.status === 'closed') return state;
  return updateNativeAttempt(state, owner, {
    status: kind === 'closed' ? 'closed' : 'retired',
    preview: null,
    observation: old.observation ? { ...old.observation, current: false } : null,
  });
});
repositoryContextReducer.with(nativeReviewUnavailable, (state, { payload: [owner] }) =>
  updateNativeAttempt(state, owner, { status: 'unavailable', preview: null }),
);
function closeNativeAttempt(state: RepositoryContextState, owner: NativeReviewOwner) {
  const original = ownedNativeAttempt(state, owner);
  return updateNativeAttempt(state, owner, {
    status: 'closed',
    preview: null,
    observation: original?.observation ? { ...original.observation, current: false } : null,
  });
}
repositoryContextReducer.with(nativeReviewEditCleared, (state, { payload: [owner] }) =>
  closeNativeAttempt(state, owner),
);
// Redux subscribers may end the demand before a buffered saga command is delivered.
repositoryContextReducer.with(nativeReviewEditEnded, (state, { payload: [owner] }) =>
  closeNativeAttempt(state, owner),
);
