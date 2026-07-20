/**
 * Agent Availability Slice
 *
 * Actions and reducer for tracking ACP provider availability status.
 */

import { createAction } from '$lib/store-shim/utils/store/create-action';
import { createReducer } from '$lib/store-shim/utils/store/create-reducer';
import type {
  AgentAvailabilityState,
  ManagedInstallStatus,
  ProviderStatus,
} from './agent-availability-types';
import type { NpxStatus } from '$shared/types/provider-availability';

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

export const initialState: AgentAvailabilityState = {
  providerStatusMap: {},
  providerLoadingMap: {},
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

export const checkSingleProviderSuccess = createAction<[providerId: string, status: ProviderStatus]>(
  'agentAvailability/checkSingleProviderSuccess',
);

export const checkSingleProviderFailure = createAction<[providerId: string]>(
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

/** Fetch user info for a provider (saga trigger). */
export const fetchProviderUserInfoRequested = createAction<[providerId: string]>(
  'agentAvailability/fetchProviderUserInfoRequested',
);

export const fetchProviderUserInfoSuccess = createAction<[providerId: string, status: ProviderStatus]>(
  'agentAvailability/fetchProviderUserInfoSuccess',
);

export const fetchProviderUserInfoComplete = createAction<[providerId: string]>(
  'agentAvailability/fetchProviderUserInfoComplete',
);

/** Track a terminal that's installing a provider. */
export const trackInstallTerminal = createAction<[terminalId: string]>(
  'agentAvailability/trackInstallTerminal',
);

/** Remove a watched terminal (e.g. on exit). */
export const removeWatchedTerminal = createAction<[terminalId: string]>(
  'agentAvailability/removeWatchedTerminal',
);

/** Ensure providers have been checked at least once (saga trigger). */
export const ensureProvidersChecked = createAction(
  'agentAvailability/ensureProvidersChecked',
);

export const setManagedInstallStatus = createAction<[
  providerId: string,
  status: Partial<ManagedInstallStatus>,
]>('agentAvailability/setManagedInstallStatus');

/** Set npx availability status from host.providerDiscovery response. */
export const setNpxStatus = createAction<[npxStatus: NpxStatus | null]>(
  'agentAvailability/setNpxStatus',
);

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export const agentAvailabilityReducer = createReducer<AgentAvailabilityState>(initialState)
  .with(setAllProvidersLoading, (state, { payload: [loadingMap] }) => ({
    ...state,
    providerLoadingMap: loadingMap,
  }))
  .with(checkSingleProviderRequested, (state, { payload: [providerId] }) => ({
    ...state,
    providerLoadingMap: { ...state.providerLoadingMap, [providerId]: true },
  }))
  .with(checkSingleProviderSuccess, (state, { payload: [providerId, status] }) => ({
    ...state,
    providerStatusMap: { ...state.providerStatusMap, [providerId]: status },
    providerLoadingMap: { ...state.providerLoadingMap, [providerId]: false },
  }))
  .with(checkSingleProviderFailure, (state, { payload: [providerId] }) => ({
    ...state,
    providerLoadingMap: { ...state.providerLoadingMap, [providerId]: false },
  }))
  .with(checkAllProvidersComplete, (state) => ({
    ...state,
    hasCheckedOnce: true,
  }))
  .with(fetchProviderUserInfoRequested, (state, { payload: [providerId] }) => ({
    ...state,
    providerUserInfoLoadingMap: { ...state.providerUserInfoLoadingMap, [providerId]: true },
  }))
  .with(fetchProviderUserInfoSuccess, (state, { payload: [providerId, status] }) => {
    const existing = state.providerStatusMap[providerId];
    if (!existing) return state;
    return {
      ...state,
      providerStatusMap: {
        ...state.providerStatusMap,
        [providerId]: {
          ...existing,
          authenticated: status.authenticated,
          authDetails: status.authDetails,
        },
      },
    };
  })
  .with(fetchProviderUserInfoComplete, (state, { payload: [providerId] }) => ({
    ...state,
    providerUserInfoLoadingMap: { ...state.providerUserInfoLoadingMap, [providerId]: false },
  }))
  .with(setManagedInstallStatus, (state, { payload: [providerId, managedStatus] }) => {
    const existing = state.providerStatusMap[providerId] ?? { available: false };
    return {
      ...state,
      providerStatusMap: {
        ...state.providerStatusMap,
        [providerId]: {
          ...existing,
          ...managedStatus,
        },
      },
    };
  })
  .with(trackInstallTerminal, (state, { payload: [terminalId] }) => {
    if (state.watchedTerminalIds.includes(terminalId)) return state;
    return {
      ...state,
      watchedTerminalIds: [...state.watchedTerminalIds, terminalId],
    };
  })
  .with(removeWatchedTerminal, (state, { payload: [terminalId] }) => {
    const idx = state.watchedTerminalIds.indexOf(terminalId);
    if (idx === -1) return state;
    return {
      ...state,
      watchedTerminalIds: state.watchedTerminalIds.filter((id) => id !== terminalId),
    };
  })
  .with(setNpxStatus, (state, { payload: [npxStatus] }) => ({
    ...state,
    npxStatus,
  }));
