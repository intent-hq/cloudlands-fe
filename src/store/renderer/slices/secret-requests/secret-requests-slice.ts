import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import type { SecretListing } from '$shared/types/secret-request-resource';
import type { SecretAnswerStatus, SecretRequestsState } from './secret-requests-types';

const initialState: SecretRequestsState = { listings: {}, answers: {} };

/** Refresh one agent's names-only `secret.list` (PROTOCOL §5.56). */
export const secretListRequested = createAction<[workspaceId: string, agentId: string]>(
  'secretRequests/secretListRequested',
);

export const secretListLoaded = createAction<[agentId: string, listing: SecretListing]>(
  'secretRequests/secretListLoaded',
);

/**
 * Answer a pending request. For `provided`, the card first stashes the value
 * in `secret-value-handoff` under `requestId`; the action itself never
 * carries the value.
 */
export const secretAnswerRequested = createAction<
  [
    request: {
      workspaceId: string;
      agentId: string;
      requestId: string;
      outcome: 'provided' | 'declined';
    },
  ]
>('secretRequests/secretAnswerRequested');

export const secretAnswerUpdated = createAction<[requestId: string, status: SecretAnswerStatus]>(
  'secretRequests/secretAnswerUpdated',
);

export const secretRequestsReducer = createReducer<SecretRequestsState>(initialState);
secretRequestsReducer.with(secretListLoaded, (state, { payload: [agentId, listing] }) => ({
  ...state,
  listings: { ...state.listings, [agentId]: listing },
}));
secretRequestsReducer.with(secretAnswerUpdated, (state, { payload: [requestId, status] }) => ({
  ...state,
  answers: { ...state.answers, [requestId]: status },
}));
