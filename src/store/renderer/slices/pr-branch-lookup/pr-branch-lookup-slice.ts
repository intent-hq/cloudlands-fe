import { createAction } from "ag-redux-toolkit/utils/store/create-action";
import { createReducer } from "ag-redux-toolkit/utils/store/create-reducer";
import type {
  PrBranchLookupPayload,
  PrBranchLookupRequest,
  PrBranchLookupState,
} from './pr-branch-lookup-types';

export const initialState: PrBranchLookupState = {
  byKey: {},
};

function getLookupKey(request: PrBranchLookupRequest): string {
  return `${request.owner}/${request.repo}#${request.prNumber}`;
}

export const requestPrBranchLookup = createAction<
  [request: PrBranchLookupRequest],
  PrBranchLookupPayload
>('prBranchLookup/request', (request) => ({
  ...request,
  key: getLookupKey(request),
}));

export const prBranchLookupStarted = createAction<
  [request: PrBranchLookupPayload],
  PrBranchLookupPayload
>('prBranchLookup/started', (request) => request);

export const prBranchLookupSucceeded = createAction<
  [request: PrBranchLookupPayload, branch: string],
  { key: string; branch: string }
>('prBranchLookup/succeeded', (request, branch) => ({ key: request.key, branch }));

export const prBranchLookupFailed = createAction<
  [request: PrBranchLookupPayload, error: string],
  { key: string; error: string }
>('prBranchLookup/failed', (request, error) => ({ key: request.key, error }));

export const prBranchLookupReducer = createReducer<PrBranchLookupState>(initialState)
  .with(prBranchLookupStarted, (state, { payload }) => ({
    ...state,
    byKey: {
      ...state.byKey,
      [payload.key]: { status: 'loading' },
    },
  }))
  .with(prBranchLookupSucceeded, (state, { payload }) => ({
    ...state,
    byKey: {
      ...state.byKey,
      [payload.key]: { status: 'succeeded', branch: payload.branch },
    },
  }))
  .with(prBranchLookupFailed, (state, { payload }) => ({
    ...state,
    byKey: {
      ...state.byKey,
      [payload.key]: { status: 'failed', error: payload.error },
    },
  }));
