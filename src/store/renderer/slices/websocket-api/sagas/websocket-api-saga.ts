import { invoke } from "$lib/electron-bridge";
import { takeEveryFromElectronChannel } from "$store/renderer/utils/ipc-channel";
import { createLogger } from "$lib/utils/client-logger";
import { WEBSOCKET_API_CHANNELS } from "$shared/ipc/channels";
import {
  call,
  delay,
  fork,
  put,
  takeEvery,
} from "typed-redux-saga";
import type { SagaGenerator } from "typed-redux-saga";
import { takeLatestFromSelector } from "@augmentcode/ag-redux-toolkit/saga";
import {
  loadWebSocketApiStatus,
  regenerateWebSocketApiToken,
  setWebSocketApiDiscoveryCountdownNow,
  setWebSocketApiDiscoveryEnabled,
  setWebSocketApiDiscoveryState,
  setWebSocketApiEnabled,
  setWebSocketApiEnabledState,
  setWebSocketApiError,
  setWebSocketApiLoading,
  setWebSocketApiRegenerating,
  setWebSocketApiToken,
  webSocketApiDiscoveryAutoDisabled,
  webSocketApiStatusLoaded,
} from "../websocket-api-slice";
import {
  selectWebSocketApiActiveDiscoveryExpiresAt,
  selectWebSocketApiDiscoveryCountdownState,
  selectWebSocketApiEnabled,
} from "../websocket-api-selectors";
import type { WebSocketApiStatusSnapshot } from "../websocket-api-types";

const logger = createLogger("WebSocketApiSaga");
const DISCOVERY_TIMEOUT_MS = 5 * 60 * 1000;
const DISCOVERY_TICK_MS = 1000;

type IpcResponse<T = undefined> = {
  success?: boolean;
  data?: T;
  error?: string;
};

type WebSocketApiStatusData = {
  enabled?: boolean;
  token?: string | null;
  port?: number | null;
  discoveryEnabled?: boolean;
  discoveryExpiresAt?: number | null;
  localIps?: string[] | null;
  certFingerprint?: string | null;
};

type DiscoveryResponseData = {
  discoveryEnabled?: boolean;
  discoveryExpiresAt?: number | null;
};

type RegenerateTokenResponseData = {
  token?: string | null;
};

type DiscoveryCountdownState = {
  discoveryEnabled: boolean;
  discoveryExpiresAt: number | null;
  discoveryCountdownNow: number | null;
};

function normalizeStatus(data: WebSocketApiStatusData): WebSocketApiStatusSnapshot {
  return {
    enabled: data.enabled ?? false,
    token: data.token ?? "",
    port: typeof data.port === "number" ? data.port : null,
    discoveryEnabled: data.discoveryEnabled ?? false,
    discoveryExpiresAt: typeof data.discoveryExpiresAt === "number" ? data.discoveryExpiresAt : null,
    localIps: data.localIps?.length ? data.localIps : ["127.0.0.1"],
    certFingerprint: data.certFingerprint ?? "",
  };
}

async function showToast(kind: "success" | "error", message: string): Promise<void> {
  try {
    const { toast } = await import("svelte-sonner");
    if (kind === "success") {
      toast.success(message);
    } else {
      toast.error(message);
    }
  } catch {
    // Toasts are non-critical for saga correctness.
  }
}

async function showSuccessToast(message: string): Promise<void> {
  await showToast("success", message);
}

async function showErrorToast(message: string): Promise<void> {
  await showToast("error", message);
}

function* setCountdownNowIfActive(
  discoveryEnabled: boolean,
  discoveryExpiresAt: number | null,
): SagaGenerator<void> {
  yield* put(
    setWebSocketApiDiscoveryCountdownNow(
      discoveryEnabled && discoveryExpiresAt ? Date.now() : null,
    ),
  );
}

export function* handleLoadWebSocketApiStatus(): SagaGenerator<void> {
  yield* put(setWebSocketApiLoading(true));
  yield* put(setWebSocketApiError(null));

  try {
    const result: IpcResponse<WebSocketApiStatusData> = yield* call(
      invoke<IpcResponse<WebSocketApiStatusData>>,
      WEBSOCKET_API_CHANNELS.GET_STATUS,
    );

    if (result?.success && result.data) {
      const status = normalizeStatus(result.data);
      yield* put(webSocketApiStatusLoaded(status));
      yield* call(setCountdownNowIfActive, status.discoveryEnabled, status.discoveryExpiresAt);
    } else {
      yield* put(setWebSocketApiError("Failed to load WebSocket API settings"));
      yield* call(showErrorToast, "Failed to load WebSocket API settings");
    }
  } catch (error) {
    logger.error("Failed to load WebSocket API status:", error);
    yield* put(setWebSocketApiError("Failed to load WebSocket API settings"));
    yield* call(showErrorToast, "Failed to load WebSocket API settings");
  } finally {
    yield* put(setWebSocketApiLoading(false));
  }
}

export function* handleSetWebSocketApiEnabled(
  action: ReturnType<typeof setWebSocketApiEnabled>,
): SagaGenerator<void> {
  const [enabled] = action.payload;
  const previousEnabled: boolean = yield* selectWebSocketApiEnabled.effect();
  yield* put(setWebSocketApiEnabledState(enabled));

  try {
    const result: IpcResponse = yield* call(
      invoke<IpcResponse>,
      WEBSOCKET_API_CHANNELS.SET_ENABLED,
      { enabled },
    );

    if (!result?.success) {
      yield* put(setWebSocketApiEnabledState(previousEnabled));
      yield* call(showErrorToast, "Failed to update WebSocket API setting");
      return;
    }

    yield* call(handleLoadWebSocketApiStatus);
  } catch (error) {
    logger.error("Failed to toggle WebSocket API:", error);
    yield* put(setWebSocketApiEnabledState(previousEnabled));
    yield* call(showErrorToast, "Failed to update WebSocket API setting");
  }
}

export function* handleRegenerateWebSocketApiToken(): SagaGenerator<void> {
  yield* put(setWebSocketApiRegenerating(true));

  try {
    const result: IpcResponse<RegenerateTokenResponseData> = yield* call(
      invoke<IpcResponse<RegenerateTokenResponseData>>,
      WEBSOCKET_API_CHANNELS.REGENERATE_TOKEN,
    );

    if (result?.success && result.data?.token) {
      yield* put(setWebSocketApiToken(result.data.token));
      yield* call(
        showSuccessToast,
        "API token regenerated. Existing connections have been disconnected.",
      );
    }
  } catch (error) {
    logger.error("Failed to regenerate token:", error);
    yield* call(showErrorToast, "Failed to regenerate token");
  } finally {
    yield* put(setWebSocketApiRegenerating(false));
  }
}

export function* handleSetWebSocketApiDiscoveryEnabled(
  action: ReturnType<typeof setWebSocketApiDiscoveryEnabled>,
): SagaGenerator<void> {
  const [enabled] = action.payload;
  const previous: DiscoveryCountdownState =
    yield* selectWebSocketApiDiscoveryCountdownState.effect();
  const optimisticExpiresAt = enabled ? Date.now() + DISCOVERY_TIMEOUT_MS : null;

  yield* put(setWebSocketApiDiscoveryState(enabled, optimisticExpiresAt));
  yield* call(setCountdownNowIfActive, enabled, optimisticExpiresAt);

  try {
    const result: IpcResponse<DiscoveryResponseData> = yield* call(
      invoke<IpcResponse<DiscoveryResponseData>>,
      WEBSOCKET_API_CHANNELS.SET_DISCOVERY,
      { enabled },
    );

    if (!result?.success) {
      throw new Error(result?.error || "Failed to update network discovery setting");
    }

    const discoveryEnabled = result.data?.discoveryEnabled ?? enabled;
    const discoveryExpiresAt = result.data?.discoveryExpiresAt ?? optimisticExpiresAt;
    yield* put(setWebSocketApiDiscoveryState(discoveryEnabled, discoveryExpiresAt));
    yield* call(setCountdownNowIfActive, discoveryEnabled, discoveryExpiresAt);
  } catch (error) {
    logger.error("Failed to toggle discovery:", error);
    yield* put(setWebSocketApiDiscoveryState(previous.discoveryEnabled, previous.discoveryExpiresAt));
    yield* put(setWebSocketApiDiscoveryCountdownNow(previous.discoveryCountdownNow));
    yield* call(showErrorToast, "Failed to update network discovery setting");
  }
}

export function* handleDiscoveryAutoDisabled(): SagaGenerator<void> {
  yield* put(webSocketApiDiscoveryAutoDisabled());
}

export function* discoveryCountdownTickerSaga(): SagaGenerator<void> {
  yield* takeLatestFromSelector(
    selectWebSocketApiActiveDiscoveryExpiresAt,
    function* ({ payload: expiresAt }): SagaGenerator<void> {
      if (expiresAt === null) {
        const state: DiscoveryCountdownState =
          yield* selectWebSocketApiDiscoveryCountdownState.effect();
        if (state.discoveryCountdownNow !== null) {
          yield* put(setWebSocketApiDiscoveryCountdownNow(null));
        }
        return;
      }

      let now = Date.now();
      while (now < expiresAt) {
        yield* put(setWebSocketApiDiscoveryCountdownNow(now));
        yield* delay(DISCOVERY_TICK_MS);
        now = Date.now();
      }

      yield* put(webSocketApiDiscoveryAutoDisabled());
    },
  );
}

function* watchDiscoveryAutoDisabledSaga(): SagaGenerator<void> {
  yield* takeEveryFromElectronChannel(
    "websocket-api:discovery-auto-disabled",
    handleDiscoveryAutoDisabled,
  );
}

export function* websocketApiSaga(): SagaGenerator<void> {
  yield* fork(watchDiscoveryAutoDisabledSaga);
  yield* fork(discoveryCountdownTickerSaga);
  yield* takeEvery(loadWebSocketApiStatus, handleLoadWebSocketApiStatus);
  yield* takeEvery(setWebSocketApiEnabled, handleSetWebSocketApiEnabled);
  yield* takeEvery(regenerateWebSocketApiToken, handleRegenerateWebSocketApiToken);
  yield* takeEvery(
    setWebSocketApiDiscoveryEnabled,
    handleSetWebSocketApiDiscoveryEnabled,
  );
}
