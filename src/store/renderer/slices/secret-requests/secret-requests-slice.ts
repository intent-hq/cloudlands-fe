import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import type { SecretListing } from '$shared/types/secret-request-resource';
import type { SecretAnswerStatus, SecretRequestsState } from './secret-requests-types';

const initialState: SecretRequestsState = { listings: {}, answers: {}, hidden: {} };

/**
 * Refresh one agent's names-only `secret.list` (PROTOCOL §5.56). `requestIds`
 * are the request ids the transcript shows now; a listing fetched after this
 * proves which of them are gone.
 */
export const secretListRequested = createAction<
  [workspaceId: string, agentId: string, requestIds: string[]]
>('secretRequests/secretListRequested');

export const secretListLoaded = createAction<
  [agentId: string, listing: SecretListing, requestIds: string[]]
>('secretRequests/secretListLoaded');

export const secretListFailed = createAction<[agentId: string]>('secretRequests/secretListFailed');

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

/** Hide an expired card for the rest of this session. */
export const secretRequestHidden = createAction<[requestId: string]>(
  'secretRequests/secretRequestHidden',
);

export const secretRequestsReducer = createReducer<SecretRequestsState>(initialState);
secretRequestsReducer.with(
  secretListLoaded,
  (state, { payload: [agentId, listing, requestIds] }) => {
    const covered = new Set(state.listings[agentId]?.covered ?? []);
    for (const requestId of requestIds) covered.add(requestId);
    return {
      ...state,
      listings: {
        ...state.listings,
        [agentId]: { listing, covered: [...covered], failed: false },
      },
    };
  },
);
secretRequestsReducer.with(secretListFailed, (state, { payload: [agentId] }) => {
  const previous = state.listings[agentId];
  return {
    ...state,
    listings: {
      ...state.listings,
      [agentId]: {
        listing: previous?.listing ?? null,
        covered: previous?.covered ?? [],
        failed: true,
      },
    },
  };
});
secretRequestsReducer.with(secretAnswerUpdated, (state, { payload: [requestId, status] }) => ({
  ...state,
  answers: { ...state.answers, [requestId]: status },
}));
secretRequestsReducer.with(secretRequestHidden, (state, { payload: [requestId] }) => ({
  ...state,
  hidden: { ...state.hidden, [requestId]: true },
}));
