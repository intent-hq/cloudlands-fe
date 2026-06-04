import {
  describe,
  expect,
  it,
} from "vitest";
import {
  initialState,
  setWebSocketApiDiscoveryCountdownNow,
  setWebSocketApiDiscoveryState,
  setWebSocketApiEnabledState,
  setWebSocketApiError,
  setWebSocketApiLoading,
  setWebSocketApiRegenerating,
  setWebSocketApiToken,
  webSocketApiDiscoveryAutoDisabled,
  webSocketApiStatusLoaded,
  websocketApiReducer,
} from "./websocket-api-slice";

describe("websocketApiReducer", () => {
  it("returns the initial state", () => {
    expect(websocketApiReducer(undefined, { type: "@@INIT" })).toEqual(initialState);
  });

  it("tracks loading, regenerating, and error state", () => {
    let state = websocketApiReducer(initialState, setWebSocketApiLoading(false));
    state = websocketApiReducer(state, setWebSocketApiRegenerating(true));
    state = websocketApiReducer(state, setWebSocketApiError("boom"));

    expect(state.loading).toBe(false);
    expect(state.regenerating).toBe(true);
    expect(state.error).toBe("boom");
  });

  it("hydrates status data from IPC", () => {
    const state = websocketApiReducer(
      { ...initialState, error: "previous" },
      webSocketApiStatusLoaded({
        enabled: true,
        token: "token-123",
        port: 5180,
        discoveryEnabled: true,
        discoveryExpiresAt: 12345,
        localIps: ["192.168.1.10"],
        certFingerprint: "AA:BB",
      }),
    );

    expect(state).toMatchObject({
      enabled: true,
      token: "token-123",
      port: 5180,
      discoveryEnabled: true,
      discoveryExpiresAt: 12345,
      localIps: ["192.168.1.10"],
      certFingerprint: "AA:BB",
      error: null,
    });
  });

  it("updates enabled and token fields", () => {
    let state = websocketApiReducer(initialState, setWebSocketApiEnabledState(true));
    state = websocketApiReducer(state, setWebSocketApiToken("new-token"));

    expect(state.enabled).toBe(true);
    expect(state.token).toBe("new-token");
  });

  it("updates discovery state and clears countdown when discovery is off", () => {
    let state = websocketApiReducer(initialState, setWebSocketApiDiscoveryState(true, 5000));
    state = websocketApiReducer(state, setWebSocketApiDiscoveryCountdownNow(1000));

    expect(state.discoveryEnabled).toBe(true);
    expect(state.discoveryExpiresAt).toBe(5000);
    expect(state.discoveryCountdownNow).toBe(1000);

    state = websocketApiReducer(state, setWebSocketApiDiscoveryState(false, null));

    expect(state.discoveryEnabled).toBe(false);
    expect(state.discoveryExpiresAt).toBeNull();
    expect(state.discoveryCountdownNow).toBeNull();
  });

  it("clears discovery fields when auto-disabled", () => {
    const activeState = {
      ...initialState,
      discoveryEnabled: true,
      discoveryExpiresAt: 5000,
      discoveryCountdownNow: 1000,
    };

    expect(websocketApiReducer(activeState, webSocketApiDiscoveryAutoDisabled())).toMatchObject({
      discoveryEnabled: false,
      discoveryExpiresAt: null,
      discoveryCountdownNow: null,
    });
  });
});
