import {
  describe,
  expect,
  it,
} from "vitest";
import type { StoreState } from "../../types";
import { initialState } from "./websocket-api-slice";
import {
  selectWebSocketApiDiscoveryCountdown,
  selectWebSocketApiEnabled,
  selectWebSocketApiToken,
} from "./websocket-api-selectors";

function mockState(overrides = {}): StoreState {
  return {
    websocketApi: {
      ...initialState,
      ...overrides,
    },
  } as StoreState;
}

describe("websocket-api selectors", () => {
  it("returns raw settings fields", () => {
    const state = mockState({ enabled: true, token: "token-123" });

    expect(selectWebSocketApiEnabled.select(state)).toBe(true);
    expect(selectWebSocketApiToken.select(state)).toBe("token-123");
  });

  it("formats the discovery countdown from saga-owned clock state", () => {
    const state = mockState({
      discoveryEnabled: true,
      discoveryExpiresAt: 125000,
      discoveryCountdownNow: 65000,
    });

    expect(selectWebSocketApiDiscoveryCountdown.select(state)).toBe("1:00");
  });
});
