import { call, fork, put, takeEvery } from "typed-redux-saga";
import { createLogger } from "$lib/utils/client-logger";
import {
  getLocalStorageItem,
  setLocalStorageItem,
} from "$lib/store/utils/safe-local-storage-saga";
import {
  ACP_PROVIDERS,
  getDefaultProviderId,
} from "$shared/config/provider-config";
import { switchProvider as switchBgAgentProvider } from "../../background-agent-settings/background-agent-settings-slice";
import { switchModelOverridesForProvider } from "../../specialists/specialists-slice";
import {
  ACTIVE_PROVIDER_STORAGE_KEY,
  ENABLED_PROVIDERS_STORAGE_KEY,
  OLD_STORAGE_KEY,
  ensureEnabledIfUnset,
  hydrateActiveProvider,
  loadEnabledProvidersFromStorage,
  setActiveProvider,
  setProviderEnabled,
  toggleProvider,
  validateActiveProvider,
} from "../provider-settings-slice";
import {
  selectActiveProviderId,
  selectEnabledProviders,
} from "../provider-settings-selectors";

const logger = createLogger("ProviderSettingsSaga");

function parseEnabledProviders(
  stored: string | null
): Record<string, boolean> | null {
  if (!stored) return null;

  const parsed = JSON.parse(stored) as unknown;

  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  if ("enabledProviders" in parsed) {
    const enabledProviders = (parsed as { enabledProviders?: unknown }).enabledProviders;
    return enabledProviders && typeof enabledProviders === "object"
      ? (enabledProviders as Record<string, boolean>)
      : {};
  }

  return parsed as Record<string, boolean>;
}

function* initSaga() {
  if (typeof window === "undefined") return;

  let storedEnabledProviders: Record<string, boolean> | null = null;

  try {
    const stored: string | null = yield* call(getLocalStorageItem, ENABLED_PROVIDERS_STORAGE_KEY);
    storedEnabledProviders = parseEnabledProviders(stored);
    if (storedEnabledProviders) {
      yield* put(loadEnabledProvidersFromStorage(storedEnabledProviders));
      logger.debug("Loaded enabled providers from localStorage");
    }
  } catch (error) {
    logger.error("Failed to load enabled providers:", error);
  }

  try {
    const stored: string | null = yield* call(getLocalStorageItem, ACTIVE_PROVIDER_STORAGE_KEY);
    if (stored) {
      if (ACP_PROVIDERS[stored]) {
        yield* put(hydrateActiveProvider(stored));
        logger.debug("Loaded active provider from localStorage:", stored);
        return;
      }
      logger.warn("Stored provider ID not found in config, falling back to default:", stored);
    }

    if (storedEnabledProviders) {
      const defaultId = getDefaultProviderId();
      if (storedEnabledProviders[defaultId] !== false) {
        logger.info("Migrated from old settings, using default provider:", defaultId);
        yield* put(hydrateActiveProvider(defaultId));
        return;
      }

      const firstEnabled = Object.entries(storedEnabledProviders).find(
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

    const legacyStored: string | null = yield* call(getLocalStorageItem, OLD_STORAGE_KEY);
    const legacyEnabledProviders = parseEnabledProviders(legacyStored);
    if (!legacyEnabledProviders) return;

    const defaultId = getDefaultProviderId();
    if (legacyEnabledProviders[defaultId] !== false) {
      logger.info("Migrated from legacy settings, using default provider:", defaultId);
      yield* put(hydrateActiveProvider(defaultId));
      return;
    }

    const firstEnabled = Object.entries(legacyEnabledProviders).find(
      ([, enabled]) => enabled === true
    );
    if (!firstEnabled) return;

    const [providerId] = firstEnabled;
    if (ACP_PROVIDERS[providerId]) {
      logger.info("Migrated from legacy settings, using first enabled provider:", providerId);
      yield* put(hydrateActiveProvider(providerId));
    }
  } catch (error) {
    logger.error("Failed to load active provider:", error);
  }
}

function* watchSetActiveProvider() {
  let previousProviderId: string = yield* selectActiveProviderId.effect();

  yield* takeEvery(setActiveProvider, function* (action) {
    const [newProviderId] = action.payload;

    if (!ACP_PROVIDERS[newProviderId]) {
      logger.warn("Attempted to set unknown provider as active:", newProviderId);
      return;
    }

    try {
      yield* call(setLocalStorageItem, ACTIVE_PROVIDER_STORAGE_KEY, newProviderId);
      logger.debug("Saved active provider:", newProviderId);
    } catch (error) {
      logger.error("Failed to save active provider:", error);
    }

    if (previousProviderId !== newProviderId) {
      logger.info("Setting active provider:", { from: previousProviderId, to: newProviderId });
      yield* put(switchBgAgentProvider({ newProviderId, previousProviderId }));
      yield* put(switchModelOverridesForProvider(newProviderId, previousProviderId));
    }

    previousProviderId = newProviderId;
  });
}

function* handlePersistEnabledProviders() {
  try {
    const enabledProviders: Record<string, boolean> = yield* selectEnabledProviders.effect();
    yield* call(
      setLocalStorageItem,
      ENABLED_PROVIDERS_STORAGE_KEY,
      JSON.stringify({ enabledProviders })
    );
  } catch (error) {
    logger.error("Failed to save enabled providers:", error);
  }
}

function* handlePreventDisablingActiveProvider() {
  yield* takeEvery(setProviderEnabled, function* (action: ReturnType<typeof setProviderEnabled>) {
    const activeProviderId: string = yield* selectActiveProviderId.effect();
    const [{ providerId, enabled }] = action.payload;

    if (providerId === activeProviderId && !enabled) {
      logger.warn("Prevented disabling the active provider:", providerId);
      yield* put(setProviderEnabled({ providerId, enabled: true }));
    }
  });

  yield* takeEvery(toggleProvider, function* (action: ReturnType<typeof toggleProvider>) {
    const activeProviderId: string = yield* selectActiveProviderId.effect();
    const enabledProviders: Record<string, boolean> = yield* selectEnabledProviders.effect();
    const [providerId] = action.payload;

    if (providerId === activeProviderId && enabledProviders[providerId] === false) {
      logger.warn("Prevented disabling the active provider:", providerId);
      yield* put(setProviderEnabled({ providerId, enabled: true }));
    }
  });
}

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

export function* providerSettingsSaga() {
  yield* call(initSaga);
  yield* fork(watchSetActiveProvider);
  yield* takeEvery(setProviderEnabled, handlePersistEnabledProviders);
  yield* takeEvery(toggleProvider, handlePersistEnabledProviders);
  yield* takeEvery(ensureEnabledIfUnset, handlePersistEnabledProviders);
  yield* call(handlePreventDisablingActiveProvider);
  yield* fork(function* () {
    yield* takeEvery(validateActiveProvider, handleValidateActiveProvider);
  });
}