import { call, put, fork, takeEvery } from "typed-redux-saga";
import { createLogger } from "$lib/utils/client-logger";
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

const logger = createLogger("BackgroundAgentSettingsSaga");

// ============================================================================
// Init saga: load from localStorage on startup
// ============================================================================

function* initSaga() {
  if (typeof window === "undefined") return;

  // Load main settings
  try {
    const stored: string | null = yield* call(
      [localStorage, localStorage.getItem],
      STORAGE_KEY
    );
    if (stored) {
      const parsed = JSON.parse(stored);
      yield* put(
        hydrateSettings({
          defaultModel: parsed.defaultModel,
          typeOverrides: parsed.typeOverrides,
        })
      );
      logger.debug("Loaded background agent settings from localStorage");
    }
  } catch (error) {
    logger.error("Failed to load background agent settings:", error);
  }

  // Load per-provider settings cache
  try {
    const stored: string | null = yield* call(
      [localStorage, localStorage.getItem],
      PROVIDER_SETTINGS_KEY
    );
    if (stored) {
      const parsed: Record<string, ProviderBgSettings> = JSON.parse(stored);
      yield* put(hydrateProviderSettings(parsed));
      logger.debug("Loaded per-provider background agent settings cache", {
        providers: Object.keys(parsed),
      });
    }
  } catch (error) {
    logger.error(
      "Failed to load per-provider background agent settings cache:",
      error
    );
  }
}

// ============================================================================
// Persistence saga: save to localStorage on relevant actions
// ============================================================================

function* persistMainSettings() {
  try {
    const defaultModel: string = yield* selectBgDefaultModel.effect();
    const typeOverrides: Record<BackgroundAgentType, string> =
      yield* selectBgTypeOverrides.effect();
    const settings = { defaultModel, typeOverrides };
    yield* call(
      [localStorage, localStorage.setItem],
      STORAGE_KEY,
      JSON.stringify(settings)
    );
    logger.debug("Saved background agent settings");
  } catch (error) {
    logger.error("Failed to save background agent settings:", error);
  }
}

function* persistProviderSettings(
  providerSettings: Record<string, ProviderBgSettings>
) {
  try {
    yield* call(
      [localStorage, localStorage.setItem],
      PROVIDER_SETTINGS_KEY,
      JSON.stringify(providerSettings)
    );
  } catch (error) {
    logger.error(
      "Failed to save per-provider background agent settings cache:",
      error
    );
  }
}

// ============================================================================
// switchProvider saga: save/restore logic
// ============================================================================

function* handleSwitchProvider(
  action: ReturnType<typeof switchProvider>
) {
  const { newProviderId, previousProviderId } = action.payload[0];
  logger.info("Switching background agent settings for provider:", {
    from: previousProviderId,
    to: newProviderId,
  });

  // Save current settings for the outgoing provider
  const currentDefaultModel: string = yield* selectBgDefaultModel.effect();
  const currentOverrides: Record<BackgroundAgentType, string> =
    yield* selectBgTypeOverrides.effect();

  yield* put(
    saveProviderSnapshot({
      providerId: previousProviderId,
      settings: {
        defaultModel: currentDefaultModel,
        typeOverrides: { ...currentOverrides },
      },
    })
  );

  // Try to restore saved settings for the incoming provider
  const allProviderSettings: Record<string, ProviderBgSettings> =
    yield* selectProviderSettings.effect();

  const saved = allProviderSettings[newProviderId];
  if (saved) {
    logger.info("Restoring background agent settings for provider:", {
      providerId: newProviderId,
      defaultModel: saved.defaultModel,
    });
    yield* put(
      restoreProviderSettings({
        defaultModel: saved.defaultModel,
        typeOverrides: saved.typeOverrides,
      })
    );
  } else {
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
    yield* put(
      restoreProviderSettings({
        defaultModel: fastModel,
        typeOverrides: { commit: "", pr: "", review: "", fast: "" },
      })
    );
  }

  // Persist provider settings cache (main settings are persisted by takeEvery on restoreProviderSettings)
  const finalProviderSettings: Record<string, ProviderBgSettings> =
    yield* selectProviderSettings.effect();
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
  yield* fork(function* () {
    yield* takeEvery(switchProvider, handleSwitchProvider);
  });
}

