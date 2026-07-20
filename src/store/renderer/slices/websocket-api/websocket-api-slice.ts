import { createAction } from "$lib/store-shim/utils/store/create-action";
import { createReducer } from "$lib/store-shim/utils/store/create-reducer";
import type {
  WebSocketApiState,
  WebSocketApiStatusSnapshot,
} from "./websocket-api-types";

export const initialState: WebSocketApiState = {
  enabled: false,
  token: "",
  port: 5179,
  discoveryEnabled: false,
  discoveryExpiresAt: null,
  localIps: ["127.0.0.1"],
  certFingerprint: "",
  loading: true,
  regenerating: false,
  error: null,
  discoveryCountdownNow: null,
};

export const setWebSocketApiLoading = createAction<[loading: boolean]>(
  "websocketApi/setLoading"
);

export const setWebSocketApiRegenerating = createAction<[regenerating: boolean]>(
  "websocketApi/setRegenerating"
);

export const setWebSocketApiError = createAction<[error: string | null]>(
  "websocketApi/setError"
);

export const webSocketApiStatusLoaded = createAction<[status: WebSocketApiStatusSnapshot]>(
  "websocketApi/statusLoaded"
);

export const setWebSocketApiEnabledState = createAction<[enabled: boolean]>(
  "websocketApi/setEnabledState"
);

export const setWebSocketApiToken = createAction<[token: string]>(
  "websocketApi/setToken"
);

export const setWebSocketApiDiscoveryState = createAction<
  [enabled: boolean, expiresAt: number | null]
>("websocketApi/setDiscoveryState");

export const setWebSocketApiDiscoveryCountdownNow = createAction<[now: number | null]>(
  "websocketApi/setDiscoveryCountdownNow"
);

export const webSocketApiDiscoveryAutoDisabled = createAction(
  "websocketApi/discoveryAutoDisabled"
);

export const websocketApiReducer = createReducer<WebSocketApiState>(initialState)
  .with(setWebSocketApiLoading, (state, { payload: [loading] }) => ({
    ...state,
    loading,
  }))
  .with(setWebSocketApiRegenerating, (state, { payload: [regenerating] }) => ({
    ...state,
    regenerating,
  }))
  .with(setWebSocketApiError, (state, { payload: [error] }) => ({
    ...state,
    error,
  }))
  .with(webSocketApiStatusLoaded, (state, { payload: [status] }) => ({
    ...state,
    ...status,
    error: null,
  }))
  .with(setWebSocketApiEnabledState, (state, { payload: [enabled] }) => ({
    ...state,
    enabled,
  }))
  .with(setWebSocketApiToken, (state, { payload: [token] }) => ({
    ...state,
    token,
  }))
  .with(setWebSocketApiDiscoveryState, (state, { payload: [enabled, expiresAt] }) => ({
    ...state,
    discoveryEnabled: enabled,
    discoveryExpiresAt: expiresAt,
    discoveryCountdownNow: enabled && expiresAt ? state.discoveryCountdownNow : null,
  }))
  .with(setWebSocketApiDiscoveryCountdownNow, (state, { payload: [now] }) => ({
    ...state,
    discoveryCountdownNow: now,
  }))
  .with(webSocketApiDiscoveryAutoDisabled, (state) => ({
    ...state,
    discoveryEnabled: false,
    discoveryExpiresAt: null,
    discoveryCountdownNow: null,
  }));
