import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  channel,
  runSaga,
  type Task,
} from "redux-saga";
import type { SagaGenerator } from "typed-redux-saga";

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

const { selectorChannelRef } = vi.hoisted(() => ({
  selectorChannelRef: { current: null as any },
}));

vi.mock("@augmentcode/ag-redux-toolkit/saga", async () => {
  const sagaEffects = await vi.importActual<typeof import("redux-saga/effects")>(
    "redux-saga/effects",
  );

  return {
    takeLatestFromSelector: function* (_selector: any, worker: any): SagaGenerator<Task> {
      if (!selectorChannelRef.current) {
        throw new Error("Test selector channel was not initialized");
      }

      return yield sagaEffects.takeLatest(selectorChannelRef.current, worker);
    },
  };
});

import { invoke } from "$lib/electron-bridge";
import { WEBSOCKET_API_CHANNELS } from "$shared/ipc/channels";
import {
  discoveryCountdownTickerSaga,
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

type SelectorPayload = {
  payload: number | null;
  prevPayload?: number | null;
};

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

function startDiscoveryCountdownTickerSaga(state = initialState): {
  dispatched: DispatchedAction[];
  emit: (payload: number | null, prevPayload?: number | null) => void;
  setState: (nextState: typeof initialState) => void;
  stop: () => void;
} {
  const dispatched: DispatchedAction[] = [];
  const selectorChannel = channel<SelectorPayload>();
  const stateRef = { current: { websocketApi: state } };
  selectorChannelRef.current = selectorChannel;

  const task = runSaga(
    {
      dispatch: (action: DispatchedAction) => dispatched.push(action),
      getState: () => stateRef.current,
    },
    discoveryCountdownTickerSaga,
  );

  return {
    dispatched,
    emit: (payload, prevPayload) => selectorChannel.put({ payload, prevPayload }),
    setState: (nextState) => {
      stateRef.current = { websocketApi: nextState };
    },
    stop: () => {
      selectorChannel.close();
      task.cancel();
      selectorChannelRef.current = null;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  vi.clearAllMocks();
});

afterEach(() => {
  selectorChannelRef.current?.close?.();
  selectorChannelRef.current = null;
  vi.useRealTimers();
});

describe("discoveryCountdownTickerSaga", () => {
  it("does not tick while active discovery expiry is null", async () => {
    const ticker = startDiscoveryCountdownTickerSaga();
    await vi.advanceTimersByTimeAsync(0);

    ticker.emit(null);
    await vi.advanceTimersByTimeAsync(3000);

    expect(ticker.dispatched).toEqual([]);
    ticker.stop();
  });

  it("ticks every second while discovery is active", async () => {
    const ticker = startDiscoveryCountdownTickerSaga({
      ...initialState,
      discoveryEnabled: true,
      discoveryExpiresAt: 5000,
    });
    await vi.advanceTimersByTimeAsync(0);

    ticker.emit(5000);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);

    expect(ticker.dispatched).toContainEqual(
      setWebSocketApiDiscoveryCountdownNow(1000),
    );
    expect(ticker.dispatched).toContainEqual(
      setWebSocketApiDiscoveryCountdownNow(2000),
    );
    ticker.stop();
  });

  it("auto-disables discovery when the active expiry is reached", async () => {
    const ticker = startDiscoveryCountdownTickerSaga({
      ...initialState,
      discoveryEnabled: true,
      discoveryExpiresAt: 2500,
    });
    await vi.advanceTimersByTimeAsync(0);

    ticker.emit(2500);
    await vi.advanceTimersByTimeAsync(2000);

    expect(ticker.dispatched).toContainEqual(
      setWebSocketApiDiscoveryCountdownNow(1000),
    );
    expect(ticker.dispatched).toContainEqual(
      setWebSocketApiDiscoveryCountdownNow(2000),
    );
    expect(ticker.dispatched).toContainEqual(webSocketApiDiscoveryAutoDisabled());
    ticker.stop();
  });

  it("cancels active ticking and clears countdownNow when discovery turns inactive", async () => {
    const ticker = startDiscoveryCountdownTickerSaga({
      ...initialState,
      discoveryEnabled: true,
      discoveryExpiresAt: 5000,
    });
    await vi.advanceTimersByTimeAsync(0);

    ticker.emit(5000);
    await vi.advanceTimersByTimeAsync(1000);

    ticker.setState({
      ...initialState,
      discoveryCountdownNow: 2000,
    });
    ticker.emit(null, 5000);
    await vi.advanceTimersByTimeAsync(4000);

    expect(ticker.dispatched).toContainEqual(
      setWebSocketApiDiscoveryCountdownNow(null),
    );
    expect(ticker.dispatched).not.toContainEqual(webSocketApiDiscoveryAutoDisabled());
    expect(
      ticker.dispatched.filter(
        (action) => action.type === setWebSocketApiDiscoveryCountdownNow.type,
      ),
    ).toEqual([
      setWebSocketApiDiscoveryCountdownNow(1000),
      setWebSocketApiDiscoveryCountdownNow(2000),
      setWebSocketApiDiscoveryCountdownNow(null),
    ]);
    ticker.stop();
  });

  it("clears stale countdownNow when discovery is inactive", async () => {
    const ticker = startDiscoveryCountdownTickerSaga({
      ...initialState,
      discoveryCountdownNow: 1000,
    });
    await vi.advanceTimersByTimeAsync(0);

    ticker.emit(null);
    await vi.advanceTimersByTimeAsync(0);

    expect(ticker.dispatched).toEqual([
      setWebSocketApiDiscoveryCountdownNow(null),
    ]);
    ticker.stop();
  });
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
