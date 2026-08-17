import { createAction } from "@augmentcode/themis/utils/store/create-action";
import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";
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

export const prBranchLookupSucceeded = createAction<
  [request: PrBranchLookupPayload, branch: string],
  { key: string; branch: string }
>('prBranchLookup/succeeded', (request, branch) => ({ key: request.key, branch }));

export const prBranchLookupReducer = createReducer<PrBranchLookupState>(initialState);
prBranchLookupReducer.with(prBranchLookupSucceeded, (state, { payload }) => ({
    ...state,
    byKey: {
      ...state.byKey,
      [payload.key]: { status: 'succeeded', branch: payload.branch },
    },
  }));
