import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import {
  createCollection,
  addItem as collectionAddItem,
  removeItem as collectionRemoveItem,
  updateItem as collectionUpdateItem,
} from '@augmentcode/themis/utils/collections/collection-utils';
import type { ContextItem } from '$features/context/types';
import type { ContextState, ContextWorkspaceState } from './context-types';

// ============================================================================
// Empty / initial state
// ============================================================================

export const emptyWorkspaceContextState: ContextWorkspaceState = {
  items: createCollection<ContextItem, 'id'>('id'),
  loading: false,
  error: null,
};

export const initialState: ContextState = {
  byWorkspaceId: {},
};

const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } = createWorkspaceScopedHelpers(
  emptyWorkspaceContextState,
);

export { getWorkspaceState };

// ============================================================================
// Actions
// ============================================================================

/** Trigger: initialize context for a workspace (loads from localStorage via saga) */
export const initContextForWorkspace = createAction<[workspaceId: string, force?: boolean]>(
  'context/initContextForWorkspace',
);

/** Reducer: hydrate items from localStorage */
export const hydrateContextItems = createAction<[workspaceId: string, items: ContextItem[]]>(
  'context/hydrateContextItems',
);

/** Reducer: add a fully-formed context item (id/timestamps already set) */
export const addContextItem =
  createAction<[workspaceId: string, item: ContextItem]>('context/addContextItem');

/** Reducer: remove a context item by ID */
export const removeContextItem = createAction<[workspaceId: string, itemId: string]>(
  'context/removeContextItem',
);

/** Reducer: partially update a context item */
export const updateContextItem = createAction<
  [workspaceId: string, itemId: string, updates: Partial<ContextItem>]
>('context/updateContextItem');

// ============================================================================
// Reducer
// ============================================================================

export const contextReducer = createReducer<ContextState>(initialState);

contextReducer.with(hydrateContextItems, (state, { payload: [workspaceId, items] }) => {
  return setWorkspaceState(state, workspaceId, {
    items: createCollection<ContextItem, 'id'>('id', items),
    loading: false,
    error: null,
  });
});
contextReducer.with(addContextItem, (state, { payload: [workspaceId, item] }) => {
  const ws = getWorkspaceState(state, workspaceId);
  return setWorkspaceState(state, workspaceId, {
    ...ws,
    items: collectionAddItem(ws.items, item),
  });
});
contextReducer.with(removeContextItem, (state, { payload: [workspaceId, itemId] }) => {
  const ws = getWorkspaceState(state, workspaceId);
  return setWorkspaceState(state, workspaceId, {
    ...ws,
    items: collectionRemoveItem(ws.items, itemId),
  });
});
contextReducer.with(updateContextItem, (state, { payload: [workspaceId, itemId, updates] }) => {
  const ws = getWorkspaceState(state, workspaceId);
  return setWorkspaceState(state, workspaceId, {
    ...ws,
    items: collectionUpdateItem(ws.items, { ...updates, id: itemId } as ContextItem),
  });
});
contextReducer.with(workspaceUnmounted, (state, { payload: [wsId] }) =>
  clearWorkspaceState(state, wsId),
);
