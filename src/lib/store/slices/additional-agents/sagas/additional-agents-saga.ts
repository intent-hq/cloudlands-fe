import { call, put, takeEvery } from "typed-redux-saga";
import { createLogger } from "$lib/utils/client-logger";
import { selectEnabledProviders } from "../additional-agents-selectors";
import { selectActiveProviderId } from "../../active-provider/active-provider-selectors";
import {
  setProviderEnabled,
  toggleProvider,
  ensureEnabledIfUnset,
  loadEnabledProvidersFromStorage,
  STORAGE_KEY,
} from "../additional-agents-slice";

const logger = createLogger("AdditionalAgentsSaga");

/**
 * Init saga: load from localStorage on startup.
 */
function* initAdditionalAgentsSaga() {
  if (typeof window === "undefined") return;

  try {
    const stored: string | null = yield* call(
      [localStorage, localStorage.getItem],
      STORAGE_KEY
    );
    if (stored) {
      const parsed = JSON.parse(stored);
      const providers = parsed.enabledProviders ?? parsed;
      yield* put(loadEnabledProvidersFromStorage(providers));
      logger.debug("Loaded additional agents settings from localStorage");
    }
  } catch (error) {
    logger.error("Failed to load additional agents settings:", error);
  }
}

/**
 * Persistence saga: save to localStorage whenever state changes.
 */
function* handlePersist() {
  try {
    const enabledProviders: Record<string, boolean> =
      yield* selectEnabledProviders.effect();
    yield* call(
      [localStorage, localStorage.setItem],
      STORAGE_KEY,
      JSON.stringify({ enabledProviders })
    );
  } catch (error) {
    logger.error("Failed to save additional agents settings:", error);
  }
}

/**
 * Prevent disabling the active provider.
 * If someone tries to disable the active provider, we re-enable it.
 */
function* handlePreventDisablingActiveProvider() {
  yield* takeEvery(setProviderEnabled, function* (action: ReturnType<typeof setProviderEnabled>) {
    const activeProviderId: string = yield* selectActiveProviderId.effect();
    const [{ providerId, enabled }] = action.payload;

    // If trying to disable the active provider, re-enable it
    if (providerId === activeProviderId && !enabled) {
      logger.warn("Prevented disabling the active provider:", providerId);
      yield* put(setProviderEnabled({ providerId, enabled: true }));
    }
  });

  yield* takeEvery(toggleProvider, function* (action: ReturnType<typeof toggleProvider>) {
    const activeProviderId: string = yield* selectActiveProviderId.effect();
    const enabledProviders: Record<string, boolean> = yield* selectEnabledProviders.effect();
    const [providerId] = action.payload;

    // takeEvery runs after reducers, so this reflects the post-toggle value.
    // `false` here means the user just tried to turn an enabled provider off.
    if (providerId === activeProviderId && enabledProviders[providerId] === false) {
      logger.warn("Prevented disabling the active provider:", providerId);
      yield* put(setProviderEnabled({ providerId, enabled: true }));
    }
  });
}

/**
 * Root saga for additional-agents slice.
 */
export function* additionalAgentsSaga() {
  yield* call(initAdditionalAgentsSaga);
  yield* takeEvery(setProviderEnabled, handlePersist);
  yield* takeEvery(toggleProvider, handlePersist);
  yield* takeEvery(ensureEnabledIfUnset, handlePersist);
  yield* call(handlePreventDisablingActiveProvider);
}

