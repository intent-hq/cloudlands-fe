import { call, put, takeEvery } from "typed-redux-saga";
import { setLocalStorageJSON } from "$lib/store/utils/safe-local-storage-saga";
import { selectUserOverrides, selectProviderModelOverrides } from "../specialists-selectors";
import { switchModelOverridesForProvider, setUserOverrides, setProviderModelOverrides, PROVIDER_MODEL_OVERRIDES_KEY, SPECIALISTS_OVERRIDES_KEY, type SpecialistOverrides, } from "../specialists-slice";
function* handleSwitchModelOverrides(action: ReturnType<typeof switchModelOverridesForProvider>) {
    const [newProviderId, previousProviderId] = action.payload;
    // Read current state
    const overrides: SpecialistOverrides = yield* selectUserOverrides.effect();
    const currentModelOverrides = { ...overrides.modelOverrides };
    // Get providerModelOverrides from state
    const providerModelOverrides: Record<string, Record<string, string>> = {
        ...(yield* selectProviderModelOverrides.effect()),
    };
    // Save current model overrides for the outgoing provider
    if (Object.keys(currentModelOverrides).length > 0) {
        providerModelOverrides[previousProviderId] = currentModelOverrides;
    }
    else {
        providerModelOverrides[previousProviderId] = {};
    }
    // Save provider model overrides to state and localStorage
    yield* put(setProviderModelOverrides(providerModelOverrides));
    yield* call(setLocalStorageJSON, PROVIDER_MODEL_OVERRIDES_KEY, providerModelOverrides);
    // Restore saved overrides for the incoming provider, or clear
    const saved = providerModelOverrides[newProviderId];
    let newModelOverrides: Record<string, string> = {};
    if (saved && Object.keys(saved).length > 0) {
        newModelOverrides = { ...saved };
    }
    // Update overrides with the new model overrides (keeping behavior prompt and coding agent overrides)
    yield* put(setUserOverrides({
        codingAgentOverrides: { ...overrides.codingAgentOverrides },
        modelOverrides: newModelOverrides,
        behaviorPromptOverrides: { ...overrides.behaviorPromptOverrides },
    }));
    // Save the updated overrides to electron-store
    try {
        if (typeof window !== "undefined" && window.electronAPI) {
            yield* call([window.electronAPI, window.electronAPI.invoke], 'settings:set', {
                key: SPECIALISTS_OVERRIDES_KEY,
                value: {
                    codingAgentOverrides: { ...overrides.codingAgentOverrides },
                    modelOverrides: newModelOverrides,
                    behaviorPromptOverrides: { ...overrides.behaviorPromptOverrides },
                },
            });
        }
    }
    catch {
    }
}
export function* providerSwitchSaga() {
    yield* takeEvery(switchModelOverridesForProvider, handleSwitchModelOverrides);
}
