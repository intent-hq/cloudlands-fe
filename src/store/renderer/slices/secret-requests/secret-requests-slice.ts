import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import type { SecretListing } from '$shared/types/secret-request-resource';
import type { SecretAnswerStatus, SecretRequestsState } from './secret-requests-types';

const initialState: SecretRequestsState = { listings: {}, answers: {}, hidden: {}, collapsed: {} };

/**
 * Refresh one agent's names-only `secret.list` (PROTOCOL §5.56). `requestIds`
 * are the request ids the transcript shows now; a listing fetched after this
 * proves which of them are gone.
 */
export const secretListRequested = createAction<
  [workspaceId: string, agentId: string, requestIds: string[]]
>('secretRequests/secretListRequested');

/**
 * A fetched listing. `answeredBefore` is the answer epoch when the fetch
 * started: finished local answers up to it are replaced by the listing.
 */
export const secretListLoaded = createAction<
  [agentId: string, listing: SecretListing, requestIds: string[], answeredBefore: number]
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

export const secretAnswerUpdated = createAction<
  [requestId: string, status: SecretAnswerStatus, epoch: number]
>('secretRequests/secretAnswerUpdated');

/** Finished local outcomes that a later authoritative listing replaces. */
const LISTING_REPLACES: ReadonlySet<SecretAnswerStatus> = new Set([
  'provided',
  'declined',
  'expired',
]);

/** Hide an expired card for the rest of this session. */
export const secretRequestHidden = createAction<[requestId: string]>(
  'secretRequests/secretRequestHidden',
);

/** Collapse one agent's card stack (like the Q&A card's Hide). */
export const secretRequestsCollapsed = createAction<[agentId: string, requestIds: string[]]>(
  'secretRequests/secretRequestsCollapsed',
);

/** Expand one agent's card stack again. */
export const secretRequestsExpanded = createAction<[agentId: string]>(
  'secretRequests/secretRequestsExpanded',
);

export const secretRequestsReducer = createReducer<SecretRequestsState>(initialState);
secretRequestsReducer.with(
  secretListLoaded,
  (state, { payload: [agentId, listing, requestIds, answeredBefore] }) => {
    const covered = new Set(state.listings[agentId]?.covered ?? []);
    for (const requestId of requestIds) covered.add(requestId);
    const known = new Set(covered);
    for (const entry of listing.pendingRequests) known.add(entry.requestId);
    for (const entry of listing.answeredRequests) known.add(entry.requestId);
    const answers = { ...state.answers };
    for (const requestId of known) {
      const answer = answers[requestId];
      if (answer && LISTING_REPLACES.has(answer.status) && answer.epoch <= answeredBefore)
        delete answers[requestId];
    }
    return {
      ...state,
      answers,
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
secretRequestsReducer.with(
  secretAnswerUpdated,
  (state, { payload: [requestId, status, epoch] }) => ({
    ...state,
    answers: { ...state.answers, [requestId]: { status, epoch } },
  }),
);
secretRequestsReducer.with(secretRequestHidden, (state, { payload: [requestId] }) => ({
  ...state,
  hidden: { ...state.hidden, [requestId]: true },
}));
secretRequestsReducer.with(
  secretRequestsCollapsed,
  (state, { payload: [agentId, requestIds] }) => ({
    ...state,
    collapsed: { ...state.collapsed, [agentId]: requestIds },
  }),
);
secretRequestsReducer.with(secretRequestsExpanded, (state, { payload: [agentId] }) => {
  const { [agentId]: _expanded, ...collapsed } = state.collapsed;
  return { ...state, collapsed };
});
