import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { runSaga } from "redux-saga";

vi.mock(
  "typed-redux-saga",
  async () => await import("$store/renderer/utils/test-helpers/typed-redux-saga-mock"),
);

vi.mock("$lib/utils/client-logger", () => ({
  createLogger: () => ({
    error: vi.fn(),
  }),
}));

vi.mock("svelte-sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock(
  "$lib/electron-bridge",
  async () => await import("$store/renderer/utils/test-helpers/electron-bridge-mock"),
);

import { invoke } from "$lib/electron-bridge";
import { WEBSOCKET_API_CHANNELS } from "$shared/ipc/channels";
import {
  handleDiscoveryAutoDisabled,
  handleLoadWebSocketApiStatus,
  handleRegenerateWebSocketApiToken,
  handleSetWebSocketApiDiscoveryEnabled,
  handleSetWebSocketApiEnabled,
} from "./websocket-api-saga";
import {
  initialState,
  setWebSocketApiDiscoveryCountdownNow,
  setWebSocketApiDiscoveryState,
  setWebSocketApiEnabled,
  setWebSocketApiEnabledState,
  setWebSocketApiLoading,
  setWebSocketApiRegenerating,
  setWebSocketApiToken,
  setWebSocketApiDiscoveryEnabled,
  webSocketApiDiscoveryAutoDisabled,
  webSocketApiStatusLoaded,
} from "../websocket-api-slice";

const mockInvoke = vi.mocked(invoke);

type DispatchedAction = { type: string; payload?: unknown };

async function runWebSocketSaga(
  saga: (...args: any[]) => Generator,
  args: any[] = [],
  state = { websocketApi: initialState },
): Promise<DispatchedAction[]> {
  const dispatched: DispatchedAction[] = [];

  await runSaga(
    {
      dispatch: (action: DispatchedAction) => dispatched.push(action),
      getState: () => state,
    },
    saga,
    ...args,
  ).toPromise();

  return dispatched;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("handleLoadWebSocketApiStatus", () => {
  it("loads and normalizes WebSocket API settings from IPC", async () => {
    mockInvoke.mockResolvedValueOnce({
      success: true,
      data: {
        enabled: true,
        token: "token-123",
        port: 5180,
        discoveryEnabled: true,
        discoveryExpiresAt: 61000,
        localIps: ["192.168.1.10"],
        certFingerprint: "AA:BB",
      },
    });

    const dispatched = await runWebSocketSaga(handleLoadWebSocketApiStatus);

    expect(mockInvoke).toHaveBeenCalledWith(WEBSOCKET_API_CHANNELS.GET_STATUS);
    expect(dispatched).toContainEqual(setWebSocketApiLoading(true));
    expect(dispatched).toContainEqual(
      webSocketApiStatusLoaded({
        enabled: true,
        token: "token-123",
        port: 5180,
        discoveryEnabled: true,
        discoveryExpiresAt: 61000,
        localIps: ["192.168.1.10"],
        certFingerprint: "AA:BB",
      }),
    );
    expect(dispatched).toContainEqual(setWebSocketApiDiscoveryCountdownNow(1000));
    expect(dispatched).toContainEqual(setWebSocketApiLoading(false));
  });
});

describe("handleSetWebSocketApiEnabled", () => {
  it("persists the enabled setting and refreshes status", async () => {
    mockInvoke
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({
        success: true,
        data: { enabled: true, token: "token", port: 5180 },
      });

    const dispatched = await runWebSocketSaga(
      handleSetWebSocketApiEnabled,
      [setWebSocketApiEnabled(true)],
      { websocketApi: { ...initialState, enabled: false } },
    );

    expect(mockInvoke).toHaveBeenNthCalledWith(
      1,
      WEBSOCKET_API_CHANNELS.SET_ENABLED,
      { enabled: true },
    );
    expect(mockInvoke).toHaveBeenNthCalledWith(2, WEBSOCKET_API_CHANNELS.GET_STATUS);
    expect(dispatched).toContainEqual(setWebSocketApiEnabledState(true));
  });
});

describe("handleRegenerateWebSocketApiToken", () => {
  it("updates the token returned by IPC", async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, data: { token: "new-token" } });

    const dispatched = await runWebSocketSaga(handleRegenerateWebSocketApiToken);

    expect(mockInvoke).toHaveBeenCalledWith(WEBSOCKET_API_CHANNELS.REGENERATE_TOKEN);
    expect(dispatched).toContainEqual(setWebSocketApiRegenerating(true));
    expect(dispatched).toContainEqual(setWebSocketApiToken("new-token"));
    expect(dispatched).toContainEqual(setWebSocketApiRegenerating(false));
  });
});

describe("handleSetWebSocketApiDiscoveryEnabled", () => {
  it("persists discovery state and starts saga-owned countdown state", async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, data: { discoveryEnabled: true } });

    const dispatched = await runWebSocketSaga(
      handleSetWebSocketApiDiscoveryEnabled,
      [setWebSocketApiDiscoveryEnabled(true)],
      { websocketApi: initialState },
    );

    expect(mockInvoke).toHaveBeenCalledWith(
      WEBSOCKET_API_CHANNELS.SET_DISCOVERY,
      { enabled: true },
    );
    expect(dispatched).toContainEqual(setWebSocketApiDiscoveryState(true, 301000));
    expect(dispatched).toContainEqual(setWebSocketApiDiscoveryCountdownNow(1000));
  });
});

describe("handleDiscoveryAutoDisabled", () => {
  it("dispatches the auto-disable state reset", async () => {
    const dispatched = await runWebSocketSaga(handleDiscoveryAutoDisabled);

    expect(dispatched).toEqual([webSocketApiDiscoveryAutoDisabled()]);
  });
});
