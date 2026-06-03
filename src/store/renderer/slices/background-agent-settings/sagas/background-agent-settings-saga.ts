import {
  call,
  put,
  takeEvery,
} from "typed-redux-saga";
import {
  getLocalStorageJSON,
  setLocalStorageJSON,
} from "$store/renderer/utils/safe-local-storage-saga";
import {
  getDefaultModelForProvider,
  getDefaultProviderId,
  PROVIDER_MODEL_TIERS,
} from "$shared/config/provider-config";
import {
  STORAGE_KEY,
  PROVIDER_SETTINGS_KEY,
  hydrateSettings,
  hydrateProviderSettings,
  setDefaultModel,
  setTypeOverride,
  clearTypeOverride,
  resetSettings,
  saveProviderSnapshot,
  restoreProviderSettings,
  switchProvider,
  type ProviderBgSettings,
  type BackgroundAgentType,
} from "../background-agent-settings-slice";
import {
  selectBgDefaultModel,
  selectBgTypeOverrides,
  selectProviderSettings,
} from "../background-agent-settings-selectors";
// ============================================================================
// Init saga: load from localStorage on startup
// ============================================================================
function* initSaga() {
    // Load main settings
    const parsed = yield* call(getLocalStorageJSON<{
        defaultModel?: unknown;
        typeOverrides?: Partial<Record<BackgroundAgentType, unknown>>;
    }>, STORAGE_KEY);
    if (parsed) {
        const typeOverrides = parsed.typeOverrides;
        yield* put(hydrateSettings({
            defaultModel: typeof parsed.defaultModel === "string" ? parsed.defaultModel : "",
            typeOverrides: {
                commit: typeof typeOverrides?.commit === "string" ? typeOverrides.commit : "",
                pr: typeof typeOverrides?.pr === "string" ? typeOverrides.pr : "",
                review: typeof typeOverrides?.review === "string" ? typeOverrides.review : "",
                fast: typeof typeOverrides?.fast === "string" ? typeOverrides.fast : "",
            },
        }));
    }
    // Load per-provider settings cache
    const parsedProviderSettings = yield* call(getLocalStorageJSON<Record<string, ProviderBgSettings>>, PROVIDER_SETTINGS_KEY);
    if (parsedProviderSettings) {
        yield* put(hydrateProviderSettings(parsedProviderSettings));
    }
}
// ============================================================================
// Persistence saga: save to localStorage on relevant actions
// ============================================================================
function* persistMainSettings() {
    try {
        const defaultModel: string = yield* selectBgDefaultModel.effect();
        const typeOverrides: Record<BackgroundAgentType, string> = yield* selectBgTypeOverrides.effect();
        const settings = { defaultModel, typeOverrides };
        yield* call(setLocalStorageJSON, STORAGE_KEY, settings);
    }
    catch {
    }
}
function* persistProviderSettings(providerSettings: Record<string, ProviderBgSettings>) {
    yield* call(setLocalStorageJSON, PROVIDER_SETTINGS_KEY, providerSettings);
}
// ============================================================================
// switchProvider saga: save/restore logic
// ============================================================================
function* handleSwitchProvider(action: ReturnType<typeof switchProvider>) {
    const { newProviderId, previousProviderId } = action.payload[0];
    // Save current settings for the outgoing provider
    const currentDefaultModel: string = yield* selectBgDefaultModel.effect();
    const currentOverrides: Record<BackgroundAgentType, string> = yield* selectBgTypeOverrides.effect();
    yield* put(saveProviderSnapshot({
        providerId: previousProviderId,
        settings: {
            defaultModel: currentDefaultModel,
            typeOverrides: { ...currentOverrides },
        },
    }));
    // Try to restore saved settings for the incoming provider
    const allProviderSettings: Record<string, ProviderBgSettings> = yield* selectProviderSettings.effect();
    const saved = allProviderSettings[newProviderId];
    if (saved) {
        yield* put(restoreProviderSettings({
            defaultModel: saved.defaultModel,
            typeOverrides: saved.typeOverrides,
        }));
    }
    else {
        // No saved settings — reset for the new provider
        let fastModel = "";
        if (newProviderId in PROVIDER_MODEL_TIERS) {
            const baseModel = getDefaultModelForProvider(newProviderId, "fast");
            const defaultProviderId = getDefaultProviderId();
            fastModel =
                newProviderId !== defaultProviderId
                    ? `${newProviderId}:${baseModel}`
                    : baseModel;
        }
        yield* put(restoreProviderSettings({
            defaultModel: fastModel,
            typeOverrides: { commit: "", pr: "", review: "", fast: "" },
        }));
    }
    // Persist provider settings cache (main settings are persisted by takeEvery on restoreProviderSettings)
    const finalProviderSettings: Record<string, ProviderBgSettings> = yield* selectProviderSettings.effect();
    yield* call(persistProviderSettings, finalProviderSettings);
}
// ============================================================================
// Root saga
// ============================================================================
export function* backgroundAgentSettingsSaga() {
    yield* call(initSaga);
    // Persist on any state-changing action
    yield* takeEvery(setDefaultModel, persistMainSettings);
    yield* takeEvery(setTypeOverride, persistMainSettings);
    yield* takeEvery(clearTypeOverride, persistMainSettings);
    yield* takeEvery(resetSettings, persistMainSettings);
    yield* takeEvery(restoreProviderSettings, persistMainSettings);
    // Handle switchProvider
    yield* takeEvery(switchProvider, handleSwitchProvider);
}
