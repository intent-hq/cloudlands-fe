import { call, put, fork, takeEvery } from "typed-redux-saga";
import { createLogger } from "$lib/utils/client-logger";
import {
  ACP_PROVIDERS,
  getDefaultProviderId,
} from "$shared/config/provider-config";
import {
  STORAGE_KEY,
  OLD_STORAGE_KEY,
  hydrateActiveProvider,
  setActiveProvider,
  validateActiveProvider,
} from "../active-provider-slice";
import { selectActiveProviderId } from "../active-provider-selectors";
import { switchProvider as switchBgAgentProvider } from "../../background-agent-settings/background-agent-settings-slice";
import { switchModelOverridesForProvider } from "../../specialists/specialists-slice";

const logger = createLogger("ActiveProviderSaga");

// ============================================================================
// Init saga: load from localStorage on startup (including migration)
// ============================================================================

function* initSaga() {
  if (typeof window === "undefined") return;

  try {
    // Try new storage key first
    const stored: string | null = yield* call(
      [localStorage, localStorage.getItem],
      STORAGE_KEY
    );
    if (stored) {
      if (ACP_PROVIDERS[stored]) {
        yield* put(hydrateActiveProvider(stored));
        logger.debug("Loaded active provider from localStorage:", stored);
        return;
      }
      logger.warn("Stored provider ID not found in config, falling back to default:", stored);
    }

    // Migration: check old additional-agents-settings
    const oldStored: string | null = yield* call(
      [localStorage, localStorage.getItem],
      OLD_STORAGE_KEY
    );
    if (oldStored) {
      const oldSettings = JSON.parse(oldStored);
      const enabledProviders = oldSettings.enabledProviders || {};

      const defaultId = getDefaultProviderId();
      if (enabledProviders[defaultId] !== false) {
        logger.info("Migrated from old settings, using default provider:", defaultId);
        yield* put(hydrateActiveProvider(defaultId));
        return;
      }

      const firstEnabled = Object.entries(enabledProviders).find(
        ([, enabled]) => enabled === true
      );
      if (firstEnabled) {
        const [providerId] = firstEnabled;
        if (ACP_PROVIDERS[providerId]) {
          logger.info("Migrated from old settings, using first enabled provider:", providerId);
          yield* put(hydrateActiveProvider(providerId));
          return;
        }
      }
    }
  } catch (error) {
    logger.error("Failed to load active provider:", error);
  }
}

// ============================================================================
// watchSetActiveProvider: persist + cross-slice coordination
// ============================================================================

function* watchSetActiveProvider() {
  // We use takeEvery but need the previous state. Since sagas run after reducers,
  // we track the previous provider ID ourselves.
  let previousProviderId: string = yield* selectActiveProviderId.effect();

  yield* takeEvery(setActiveProvider, function* (action) {
    const [newProviderId] = action.payload;

    // Validate the provider exists
    if (!ACP_PROVIDERS[newProviderId]) {
      logger.warn("Attempted to set unknown provider as active:", newProviderId);
      return;
    }

    // Persist to localStorage
    try {
      yield* call(
        [localStorage, localStorage.setItem],
        STORAGE_KEY,
        newProviderId
      );
      logger.debug("Saved active provider:", newProviderId);
    } catch (error) {
      logger.error("Failed to save active provider:", error);
    }

    // Cross-slice coordination when provider actually changes
    if (previousProviderId !== newProviderId) {
      logger.info("Setting active provider:", { from: previousProviderId, to: newProviderId });

      // Dispatch to background-agent-settings slice (already in Redux)
      yield* put(switchBgAgentProvider({ newProviderId, previousProviderId }));

      // Dispatch to specialists slice (now in Redux)
      yield* put(switchModelOverridesForProvider(newProviderId, previousProviderId));
    }

    previousProviderId = newProviderId;
  });
}

// ============================================================================
// validateActiveProvider saga: check if current provider is available
// ============================================================================

function* handleValidateActiveProvider(action: ReturnType<typeof validateActiveProvider>) {
  const [availableProviderIds] = action.payload;

  if (availableProviderIds.length === 0) {
    logger.warn("No available providers, keeping current selection");
    return;
  }

  const currentProviderId: string = yield* selectActiveProviderId.effect();

  if (!availableProviderIds.includes(currentProviderId)) {
    const defaultId = getDefaultProviderId();
    const fallbackId = availableProviderIds.includes(defaultId)
      ? defaultId
      : availableProviderIds[0];

    logger.info("Active provider unavailable, falling back:", {
      from: currentProviderId,
      to: fallbackId,
    });
    yield* put(setActiveProvider(fallbackId));
  }
}

// ============================================================================
// Root saga
// ============================================================================

export function* activeProviderSaga() {
  yield* call(initSaga);
  yield* fork(watchSetActiveProvider);
  yield* fork(function* () {
    yield* takeEvery(validateActiveProvider, handleValidateActiveProvider);
  });
}

