/**
 * Agent Availability Slice
 *
 * Actions and reducer for tracking ACP provider availability status.
 */

import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import type { AgentAvailabilityState } from './agent-availability-types';
import type { NpxStatus } from '$shared/types/provider-availability';

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

export const initialState: AgentAvailabilityState = {
  providerStatusMap: {},
  providerLoadingMap: {},
  providerCheckEpochMap: {},
  providerUserInfoLoadingMap: {},
  hasCheckedOnce: false,
  watchedTerminalIds: [],
  npxStatus: null,
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Request a single provider availability check. Saga handles IPC + dispatch. */
export const checkSingleProviderRequested = createAction<[providerId: string]>(
  'agentAvailability/checkSingleProviderRequested',
);

/**
 * `epoch` is the provider's check generation captured when the probe started
 * (see `providerCheckEpochMap`). The reducer drops the result when a newer
 * check has started since, so a slow stale probe can never overwrite a
 * fresher one. `undefined` skips the guard (direct dispatches in tests).
 */
export const checkSingleProviderSuccess = createAction<
  [providerId: string, status: ProviderStatus, epoch?: number]
>('agentAvailability/checkSingleProviderSuccess');

export const checkSingleProviderFailure = createAction<[providerId: string, epoch?: number]>(
  'agentAvailability/checkSingleProviderFailure',
);

/** Request a bulk check of all providers. */
export const checkAllProvidersRequested = createAction(
  'agentAvailability/checkAllProvidersRequested',
);

export const checkAllProvidersComplete = createAction(
  'agentAvailability/checkAllProvidersComplete',
);

/** Set all provider loading flags at once (used when bulk check starts). */
export const setAllProvidersLoading = createAction<[loadingMap: Record<string, boolean>]>(
  'agentAvailability/setAllProvidersLoading',
);

/** Ensure providers have been checked at least once (saga trigger). */
export const ensureProvidersChecked = createAction('agentAvailability/ensureProvidersChecked');

/** Set npx availability status from host.providerDiscovery response. */
export const setNpxStatus = createAction<[npxStatus: NpxStatus | null]>(
  'agentAvailability/setNpxStatus',
);

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export const agentAvailabilityReducer = createReducer<AgentAvailabilityState>(initialState);

/** Whether a result carrying `epoch` is stale (a newer check started since). */
function isStaleResult(
  state: AgentAvailabilityState,
  providerId: string,
  epoch: number | undefined,
): boolean {
  return epoch !== undefined && epoch !== (state.providerCheckEpochMap[providerId] ?? 0);
}

agentAvailabilityReducer.with(setAllProvidersLoading, (state, { payload: [loadingMap] }) => {
  const providerCheckEpochMap = { ...state.providerCheckEpochMap };
  for (const providerId of Object.keys(loadingMap)) {
    providerCheckEpochMap[providerId] = (providerCheckEpochMap[providerId] ?? 0) + 1;
  }
  return {
    ...state,
    providerLoadingMap: loadingMap,
    providerCheckEpochMap,
  };
});
agentAvailabilityReducer.with(checkSingleProviderRequested, (state, { payload: [providerId] }) => ({
  ...state,
  providerLoadingMap: { ...state.providerLoadingMap, [providerId]: true },
  providerCheckEpochMap: {
    ...state.providerCheckEpochMap,
    [providerId]: (state.providerCheckEpochMap[providerId] ?? 0) + 1,
  },
}));
agentAvailabilityReducer.with(
  checkSingleProviderSuccess,
  (state, { payload: [providerId, status, epoch] }) => {
    // A newer check started while this probe was in flight — its result is
    // stale (e.g. a pre-install focus sweep landing after a successful
    // post-install recheck) and must not overwrite the fresher one. The
    // newer check's own terminal action settles the loading flag.
    if (isStaleResult(state, providerId, epoch)) return state;
    return {
      ...state,
      providerStatusMap: { ...state.providerStatusMap, [providerId]: status },
      providerLoadingMap: { ...state.providerLoadingMap, [providerId]: false },
    };
  },
);
agentAvailabilityReducer.with(
  checkSingleProviderFailure,
  (state, { payload: [providerId, epoch] }) => {
    if (isStaleResult(state, providerId, epoch)) return state;
    // Settle the in-flight flag but never fabricate a status or erase a
    // previously successful one — a failed probe proves nothing about
    // availability.
    return {
      ...state,
      providerLoadingMap: { ...state.providerLoadingMap, [providerId]: false },
    };
  },
);
agentAvailabilityReducer.with(checkAllProvidersComplete, (state) => {
  // A sweep where every probe failed lands no statuses — presenting it as
  // "checked" would let consumers read the empty map as "confirmed nothing
  // available" instead of "unknown".
  if (state.hasCheckedOnce) return state;
  if (Object.keys(state.providerStatusMap).length === 0) return state;
  return {
    ...state,
    hasCheckedOnce: true,
  };
});
agentAvailabilityReducer.with(setNpxStatus, (state, { payload: [npxStatus] }) => ({
  ...state,
  npxStatus,
}));
