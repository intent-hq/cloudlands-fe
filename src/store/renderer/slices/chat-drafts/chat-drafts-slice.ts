import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import {
  createCollection,
  getItem,
  removeItem,
  upsertItem,
} from '@themislib/themis/utils/collections/collection-utils';
import type {
  ChatDraftOwner,
  ChatDraftSaveOutcome,
  ChatDraftSaveRequest,
  ChatDraftSnapshot,
  ChatDraftsState,
} from './chat-drafts-types';

export type { ChatDraftsState };

export const initialState: ChatDraftsState = {
  owners: createCollection<ChatDraftOwner, 'id'>('id'),
};

export const chatDraftOwnerOpened = createAction<[ownerId: string]>('chatDrafts/ownerOpened');
/** Flushes the owner's pending save, then drops its outcomes. */
export const chatDraftOwnerReleased = createAction<[ownerId: string]>('chatDrafts/ownerReleased');

export const chatDraftRestoreRequested = createAction<
  [ownerId: string, requestId: string, workspaceId: string, agentId: string]
>('chatDrafts/restoreRequested');
export const chatDraftRestoreSettled = createAction<
  [
    ownerId: string,
    requestId: string,
    status: 'restored' | 'failed',
    draft: ChatDraftSnapshot | null,
    error?: string,
  ]
>('chatDrafts/restoreSettled');
/** Drops the owner's restore so a late `drafts.get` response is ignored. */
export const chatDraftRestoreInvalidated = createAction<[ownerId: string]>(
  'chatDrafts/restoreInvalidated',
);

export const chatDraftSaveScheduled = createAction<
  [ownerId: string, requestId: string, request: ChatDraftSaveRequest]
>('chatDrafts/saveScheduled');
export const chatDraftSaveFlushRequested = createAction<[ownerId: string]>(
  'chatDrafts/saveFlushRequested',
);
export const chatDraftSaveCancelled = createAction<[ownerId: string]>('chatDrafts/saveCancelled');
export const chatDraftSaveStarted =
  createAction<[ownerId: string, requestId: string, request: ChatDraftSaveRequest]>(
    'chatDrafts/saveStarted',
  );
export const chatDraftSaveSettled =
  createAction<[ownerId: string, requestId: string, status: 'saved' | 'failed', error?: string]>(
    'chatDrafts/saveSettled',
  );
export const chatDraftSaveOutcomesAcknowledged = createAction<
  [ownerId: string, requestIds: string[]]
>('chatDrafts/saveOutcomesAcknowledged');

/** Send cleanup: drop the pair's draft on the daemon, after any committed save. */
export const chatDraftClearRequested = createAction<[workspaceId: string, agentId: string]>(
  'chatDrafts/clearRequested',
);
/** Saga-internal FIFO handoff after immediate clear invalidation. */
export const chatDraftClearStarted =
  createAction<[workspaceId: string, agentId: string]>('chatDrafts/clearStarted');

function updateOwner(
  state: ChatDraftsState,
  ownerId: string,
  update: (owner: ChatDraftOwner) => ChatDraftOwner,
): ChatDraftsState {
  const owner = getItem(state.owners, ownerId);
  if (!owner) return state;
  const next = update(owner);
  return next === owner ? state : { ...state, owners: upsertItem(state.owners, next) };
}

export const chatDraftsReducer = createReducer<ChatDraftsState>(initialState);

chatDraftsReducer.with(chatDraftOwnerOpened, (state, { payload: [ownerId] }) =>
  getItem(state.owners, ownerId)
    ? state
    : {
        ...state,
        owners: upsertItem(state.owners, {
          id: ownerId,
          restore: null,
          saves: createCollection<ChatDraftSaveOutcome, 'id'>('id'),
        }),
      },
);
chatDraftsReducer.with(chatDraftOwnerReleased, (state, { payload: [ownerId] }) =>
  getItem(state.owners, ownerId) ? { ...state, owners: removeItem(state.owners, ownerId) } : state,
);
chatDraftsReducer.with(
  chatDraftRestoreRequested,
  (state, { payload: [ownerId, requestId, workspaceId, agentId] }) =>
    updateOwner(state, ownerId, (owner) => ({
      ...owner,
      restore: { requestId, workspaceId, agentId, status: 'pending' },
    })),
);
chatDraftsReducer.with(
  chatDraftRestoreSettled,
  (state, { payload: [ownerId, requestId, status, draft, error] }) =>
    updateOwner(state, ownerId, (owner) =>
      owner.restore?.requestId === requestId && owner.restore.status === 'pending'
        ? { ...owner, restore: { ...owner.restore, status, draft, error } }
        : owner,
    ),
);
chatDraftsReducer.with(chatDraftRestoreInvalidated, (state, { payload: [ownerId] }) =>
  updateOwner(state, ownerId, (owner) => (owner.restore ? { ...owner, restore: null } : owner)),
);
chatDraftsReducer.with(chatDraftSaveStarted, (state, { payload: [ownerId, requestId, request] }) =>
  updateOwner(state, ownerId, (owner) => ({
    ...owner,
    saves: upsertItem(owner.saves, {
      id: requestId,
      workspaceId: request.workspaceId,
      agentId: request.agentId,
      status: 'pending',
    }),
  })),
);
chatDraftsReducer.with(
  chatDraftSaveSettled,
  (state, { payload: [ownerId, requestId, status, error] }) =>
    updateOwner(state, ownerId, (owner) => {
      const save = getItem(owner.saves, requestId);
      if (!save || save.status !== 'pending') return owner;
      return { ...owner, saves: upsertItem(owner.saves, { ...save, status, error }) };
    }),
);
chatDraftsReducer.with(
  chatDraftSaveOutcomesAcknowledged,
  (state, { payload: [ownerId, requestIds] }) =>
    updateOwner(state, ownerId, (owner) => {
      const saves = requestIds.reduce(
        (current, id) => (getItem(current, id) ? removeItem(current, id) : current),
        owner.saves,
      );
      return saves === owner.saves ? owner : { ...owner, saves };
    }),
);
