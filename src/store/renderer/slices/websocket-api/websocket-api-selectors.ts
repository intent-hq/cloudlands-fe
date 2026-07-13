import { store } from "../../store";

export const selectWebSocketApiEnabled = store.createSelector(
  (state) => state.websocketApi.enabled
);

export const selectWebSocketApiToken = store.createSelector(
  (state) => state.websocketApi.token
);

export const selectWebSocketApiPort = store.createSelector(
  (state) => state.websocketApi.port
);

export const selectWebSocketApiLoading = store.createSelector(
  (state) => state.websocketApi.loading
);

export const selectWebSocketApiRegenerating = store.createSelector(
  (state) => state.websocketApi.regenerating
);

export const selectWebSocketApiDiscoveryEnabled = store.createSelector(
  (state) => state.websocketApi.discoveryEnabled
);

export const selectWebSocketApiLocalIps = store.createSelector(
  (state) => state.websocketApi.localIps
);

export const selectWebSocketApiCertFingerprint = store.createSelector(
  (state) => state.websocketApi.certFingerprint
);

export const selectWebSocketApiDiscoveryCountdownState = store.createSelector((state) => ({
  discoveryEnabled: state.websocketApi.discoveryEnabled,
  discoveryExpiresAt: state.websocketApi.discoveryExpiresAt,
  discoveryCountdownNow: state.websocketApi.discoveryCountdownNow,
}));

export const selectWebSocketApiActiveDiscoveryExpiresAt = store.createSelector((state) => {
  const { discoveryEnabled, discoveryExpiresAt } = state.websocketApi;
  return discoveryEnabled && discoveryExpiresAt ? discoveryExpiresAt : null;
});

export const selectWebSocketApiDiscoveryCountdown = store.createSelector((state) => {
  const { discoveryEnabled, discoveryExpiresAt, discoveryCountdownNow } = state.websocketApi;
  if (!discoveryEnabled || !discoveryExpiresAt || !discoveryCountdownNow) return "";

  const remaining = Math.max(0, discoveryExpiresAt - discoveryCountdownNow);
  if (remaining <= 0) return "";

  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
});
