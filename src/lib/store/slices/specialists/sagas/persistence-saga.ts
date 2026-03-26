import { call, takeEvery } from "typed-redux-saga";
import { selectUserOverrides, selectCustomSpecialists } from "../specialists-selectors";
import { setModelOverride, clearModelOverride, setBulkModelOverrides, setBehaviorPromptOverride, clearBehaviorPromptOverride, setCodingAgentOverride, clearCodingAgentOverride, clearAllOverrides, resetAllOverrides, createCustomSpecialist, updateCustomSpecialist, deleteCustomSpecialist, SPECIALISTS_OVERRIDES_KEY, CUSTOM_SPECIALISTS_KEY, type SpecialistOverrides, type CustomSpecialist, } from "../specialists-slice";
function* saveOverridesToStore() {
    try {
        if (typeof window !== "undefined" && window.electronAPI) {
            const overrides: SpecialistOverrides = yield* selectUserOverrides.effect();
            const plainOverrides: SpecialistOverrides = {
                codingAgentOverrides: { ...overrides.codingAgentOverrides },
                modelOverrides: { ...overrides.modelOverrides },
                behaviorPromptOverrides: { ...overrides.behaviorPromptOverrides },
            };
            yield* call([window.electronAPI, window.electronAPI.invoke], 'settings:set', { key: SPECIALISTS_OVERRIDES_KEY, value: plainOverrides });
        }
    }
    catch (error) {
    }
}
function* saveCustomSpecialistsToStore() {
    try {
        if (typeof window !== "undefined" && window.electronAPI) {
            const customs: CustomSpecialist[] = yield* selectCustomSpecialists.effect();
            const plainCustom = customs.map((s) => ({ ...s }));
            yield* call([window.electronAPI, window.electronAPI.invoke], 'settings:set', { key: CUSTOM_SPECIALISTS_KEY, value: plainCustom });
        }
    }
    catch (error) {
    }
}
export function* persistenceSaga() {
    // Watch all override-changing actions and persist
    yield* takeEvery([setModelOverride, clearModelOverride, setBulkModelOverrides, setBehaviorPromptOverride, clearBehaviorPromptOverride, setCodingAgentOverride, clearCodingAgentOverride, clearAllOverrides, resetAllOverrides], saveOverridesToStore);
    // Watch all custom-specialist-changing actions and persist
    yield* takeEvery([createCustomSpecialist, updateCustomSpecialist, deleteCustomSpecialist], saveCustomSpecialistsToStore);
}
