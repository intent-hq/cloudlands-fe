import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import type {
  PrBranchLookupPayload,
  PrBranchLookupRequest,
  PrBranchLookupState,
} from './pr-branch-lookup-types';

export const initialState: PrBranchLookupState = {
  byKey: {},
};

export function getPrBranchLookupKey(request: PrBranchLookupRequest): string {
  return `${request.owner}/${request.repo}#${request.prNumber}`;
}

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

export const prBranchLookupReducer = createReducer<PrBranchLookupState>(initialState);
prBranchLookupReducer.with(prBranchLookupStarted, (state, { payload }) => ({
  ...state,
  byKey: {
    ...state.byKey,
    [payload.key]: { status: 'loading' },
  },
}));
prBranchLookupReducer.with(prBranchLookupSucceeded, (state, { payload }) => ({
  ...state,
  byKey: {
    ...state.byKey,
    [payload.key]: { status: 'succeeded', branch: payload.branch },
  },
}));
prBranchLookupReducer.with(prBranchLookupFailed, (state, { payload }) => ({
  ...state,
  byKey: {
    ...state.byKey,
    [payload.key]: { status: 'failed', error: payload.error },
  },
}));
