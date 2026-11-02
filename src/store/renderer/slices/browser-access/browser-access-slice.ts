import { createAsyncAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import type { StoreAsyncActionCreator } from '@themislib/themis/types';

import type { BrowserAccessState } from '$shared/types/browser-access';
import type { BrowserAccessSliceState } from './browser-access-types';

export const initialState: BrowserAccessSliceState = { current: null, pending: 0, failed: false };

export const loadBrowserAccessRequested = createAsyncAction<[], BrowserAccessState>(
  'browserAccess/load',
  'browserAccess/loadRequested',
);
export const setBrowserAccessEnabledRequested = createAsyncAction<
  [enabled: boolean],
  BrowserAccessState
>('browserAccess/setEnabled', 'browserAccess/setEnabledRequested');
export const setBrowserAccessPortRequested = createAsyncAction<[port: number], BrowserAccessState>(
  'browserAccess/setPort',
  'browserAccess/setPortRequested',
);
export const resetBrowserAccessKeyRequested = createAsyncAction<[], BrowserAccessState>(
  'browserAccess/resetKey',
  'browserAccess/resetKeyRequested',
);

export const browserAccessReducer = createReducer<BrowserAccessSliceState>(initialState);

/** Every request counts as pending until it settles; success stores main's new state. */
function track<Args extends unknown[]>(
  request: StoreAsyncActionCreator<Args, Args, BrowserAccessState>,
): void {
  browserAccessReducer.with(request, (state) => ({
    ...state,
    pending: state.pending + 1,
    failed: false,
  }));
  browserAccessReducer.with(request.success, (state, { payload: { response } }) => ({
    current: response,
    pending: Math.max(0, state.pending - 1),
    failed: false,
  }));
  browserAccessReducer.with(request.failure, (state) => ({
    ...state,
    pending: Math.max(0, state.pending - 1),
    failed: true,
  }));
}

track(loadBrowserAccessRequested);
track(setBrowserAccessEnabledRequested);
track(setBrowserAccessPortRequested);
track(resetBrowserAccessKeyRequested);
