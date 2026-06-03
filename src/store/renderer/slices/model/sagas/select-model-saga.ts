import {
  call,
  put,
  takeLatest,
} from "typed-redux-saga";
import {
  getLocalStorageJSON,
  removeLocalStorageItem,
  setLocalStorageJSON,
  setLocalStorageItem,
} from "$store/renderer/utils/safe-local-storage-saga";
import { selectActiveProviderId } from "../../provider-settings/provider-settings-selectors";
import {
  normalizeModelForProvider,
  normalizeProviderModels,
} from "../model-selection-utils";
import {
  selectModel,
  setSelectedModel,
  resetToDefaults,
  clearAllWorkspaceModels,
  GLOBAL_MODEL_KEY,
  PROVIDER_MODELS_KEY,
  WORKSPACE_MODELS_KEY,
} from "../model-slice";
import { MODEL_DEFAULTS } from "$shared/constants/agent-services";
/**
 * Handle selecting a model: update state, persist, sync with unified store,
 * and remember per-provider preference.
 */
export function* handleSelectModel(action: ReturnType<typeof selectModel>) {
    const [model] = action.payload;
    const activeProviderId: string = yield* selectActiveProviderId.effect();
    const normalizedModel = normalizeModelForProvider(activeProviderId, model);
    // Update Redux state
    yield* put(setSelectedModel({ providerId: activeProviderId, model: normalizedModel }));
    // Persist to localStorage
    yield* call(setLocalStorageItem, GLOBAL_MODEL_KEY, normalizedModel);
    // Remember this model for the current active provider
    const providerModels = normalizeProviderModels((yield* call(getLocalStorageJSON<Record<string, string>>, PROVIDER_MODELS_KEY)) ?? {});
    providerModels[activeProviderId] = normalizedModel;
    yield* call(setLocalStorageJSON, PROVIDER_MODELS_KEY, providerModels);
}
/**
 * Handle reset to defaults: select default model and clear workspace overrides.
 */
function* handleResetToDefaults() {
    yield* put(selectModel(MODEL_DEFAULTS.UI_INITIAL_MODEL));
    // Clear per-workspace overrides
    yield* put(clearAllWorkspaceModels());
    yield* call(removeLocalStorageItem, WORKSPACE_MODELS_KEY);
}
/**
 * Select model saga:
 * - Watches for selectModel actions to persist + sync
 * - Watches for resetToDefaults actions
 */
export function* selectModelSaga() {
    yield* takeLatest(selectModel, handleSelectModel);
    yield* takeLatest(resetToDefaults, handleResetToDefaults);
}
