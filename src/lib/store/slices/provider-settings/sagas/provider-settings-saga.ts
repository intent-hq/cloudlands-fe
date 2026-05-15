import {
  call,
  fork,
  put,
  takeEvery,
} from "typed-redux-saga";
import {
  getLocalStorageJSON,
  getLocalStorageItem,
  setLocalStorageJSON,
  setLocalStorageItem,
} from "$lib/store/utils/safe-local-storage-saga";
import {
  ACP_PROVIDERS,
  getAvailableIdsFromResult,
  getDefaultProviderId,
} from "$shared/config/provider-config";
import { PROVIDERS_CHANNELS } from "$shared/ipc/channels";
import type { ProviderAvailabilityResult } from "$shared/types/provider-availability";
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
type ProviderAvailabilityIpcResult = {
    success?: boolean;
    data?: ProviderAvailabilityResult;
};

async function fetchAvailableProviderIds(): Promise<string[]> {
    if (typeof window === "undefined" || !window.electronAPI)
        return [];
    try {
        const result = (await window.electronAPI.invoke(PROVIDERS_CHANNELS.GET_AVAILABILITY)) as ProviderAvailabilityIpcResult;
        if (!result?.success || !result?.data)
            return [];
        return getAvailableIdsFromResult(result.data.providers, result.data.hiddenProviders ?? []);
    }
    catch {
        return [];
    }
}

function getProviderValidationFallback(currentProviderId: string, availableProviderIds: string[]): string | null {
    if (availableProviderIds.length === 0 || availableProviderIds.includes(currentProviderId)) {
        return null;
    }
    const defaultId = getDefaultProviderId();
    return availableProviderIds.includes(defaultId) ? defaultId : availableProviderIds[0];
}

function parseEnabledProviders(parsed: unknown): Record<string, boolean> | null {
    if (!parsed || typeof parsed !== "object")
        return null;
    if ("enabledProviders" in parsed) {
        const enabledProviders = (parsed as {
            enabledProviders?: unknown;
        }).enabledProviders;
        return enabledProviders && typeof enabledProviders === "object"
            ? (enabledProviders as Record<string, boolean>)
            : {};
    }
    return parsed as Record<string, boolean>;
}
export function* initSaga() {
    if (typeof window === "undefined")
        return;
    let activeProviderId = getDefaultProviderId();
    let hydratedActiveProvider = false;
    let storedEnabledProviders: Record<string, boolean> | null = null;
    const storedEnabledProvidersValue = yield* call(getLocalStorageJSON<unknown>, ENABLED_PROVIDERS_STORAGE_KEY);
    storedEnabledProviders = parseEnabledProviders(storedEnabledProvidersValue);
    if (storedEnabledProviders) {
        yield* put(loadEnabledProvidersFromStorage(storedEnabledProviders));
    }
    const stored: string | null = yield* call(getLocalStorageItem, ACTIVE_PROVIDER_STORAGE_KEY);
    if (stored) {
        if (ACP_PROVIDERS[stored]) {
            yield* put(hydrateActiveProvider(stored));
            activeProviderId = stored;
            hydratedActiveProvider = true;
        }
    }
    if (!hydratedActiveProvider && storedEnabledProviders) {
        const defaultId = getDefaultProviderId();
        if (storedEnabledProviders[defaultId] !== false) {
            yield* put(hydrateActiveProvider(defaultId));
            activeProviderId = defaultId;
            hydratedActiveProvider = true;
        }
        else {
            const firstEnabled = Object.entries(storedEnabledProviders).find(([, enabled]) => enabled === true);
            if (firstEnabled) {
                const [providerId] = firstEnabled;
                if (ACP_PROVIDERS[providerId]) {
                    yield* put(hydrateActiveProvider(providerId));
                    activeProviderId = providerId;
                    hydratedActiveProvider = true;
                }
            }
        }
    }
    if (!hydratedActiveProvider) {
        const legacyStored = yield* call(getLocalStorageJSON<unknown>, OLD_STORAGE_KEY);
        const legacyEnabledProviders = parseEnabledProviders(legacyStored);
        if (legacyEnabledProviders) {
            const defaultId = getDefaultProviderId();
            if (legacyEnabledProviders[defaultId] !== false) {
                yield* put(hydrateActiveProvider(defaultId));
                activeProviderId = defaultId;
            }
            else {
                const firstEnabled = Object.entries(legacyEnabledProviders).find(([, enabled]) => enabled === true);
                if (firstEnabled) {
                    const [providerId] = firstEnabled;
                    if (ACP_PROVIDERS[providerId]) {
                        yield* put(hydrateActiveProvider(providerId));
                        activeProviderId = providerId;
                    }
                }
            }
        }
    }
    const availableIds = yield* call(fetchAvailableProviderIds);
    if (availableIds.length > 0) {
        const fallbackProviderId = getProviderValidationFallback(activeProviderId, availableIds);
        if (fallbackProviderId) {
            yield* put(setActiveProvider(fallbackProviderId));
        }
    }
}
function* watchSetActiveProvider() {
    let previousProviderId: string = yield* selectActiveProviderId.effect();
    yield* takeEvery(setActiveProvider, function* (action) {
        const [newProviderId] = action.payload;
        if (!ACP_PROVIDERS[newProviderId]) {
            return;
        }
        yield* call(setLocalStorageItem, ACTIVE_PROVIDER_STORAGE_KEY, newProviderId);
        if (previousProviderId !== newProviderId) {
            yield* put(switchBgAgentProvider({ newProviderId, previousProviderId }));
            yield* put(switchModelOverridesForProvider(newProviderId, previousProviderId));
        }
        previousProviderId = newProviderId;
    });
}
function* handlePersistEnabledProviders() {
    const enabledProviders: Record<string, boolean> = yield* selectEnabledProviders.effect();
    yield* call(setLocalStorageJSON, ENABLED_PROVIDERS_STORAGE_KEY, { enabledProviders });
}
function* handlePreventDisablingActiveProvider() {
    yield* takeEvery(setProviderEnabled, function* (action: ReturnType<typeof setProviderEnabled>) {
        const activeProviderId: string = yield* selectActiveProviderId.effect();
        const [{ providerId, enabled }] = action.payload;
        if (providerId === activeProviderId && !enabled) {
            yield* put(setProviderEnabled({ providerId, enabled: true }));
        }
    });
    yield* takeEvery(toggleProvider, function* (action: ReturnType<typeof toggleProvider>) {
        const activeProviderId: string = yield* selectActiveProviderId.effect();
        const enabledProviders: Record<string, boolean> = yield* selectEnabledProviders.effect();
        const [providerId] = action.payload;
        if (providerId === activeProviderId && enabledProviders[providerId] === false) {
            yield* put(setProviderEnabled({ providerId, enabled: true }));
        }
    });
}
function* handleValidateActiveProvider(action: ReturnType<typeof validateActiveProvider>) {
    const [availableProviderIds] = action.payload;
    if (availableProviderIds.length === 0) {
        return;
    }
    const currentProviderId: string = yield* selectActiveProviderId.effect();
    const fallbackId = getProviderValidationFallback(currentProviderId, availableProviderIds);
    if (fallbackId) {
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
    yield* takeEvery(validateActiveProvider, handleValidateActiveProvider);
}
