import { createAction } from "svelte-redux-toolkit/utils/store/create-action";
import { createReducer } from "svelte-redux-toolkit/utils/store/create-reducer";
import {
  DEFAULT_THEME_CUSTOMIZATION,
  DEFAULT_THEME_NAME,
  DEFAULT_THEME_PREFERENCE,
  type ThemeCustomizationState,
  type ThemeName,
  type ThemePreference,
  type ThemeState,
} from "./theme-types";

export const initialState: ThemeState = {
  name: DEFAULT_THEME_NAME,
  preference: DEFAULT_THEME_PREFERENCE,
  error: null,
  ...DEFAULT_THEME_CUSTOMIZATION,
};

export const setThemeName = createAction<[name: ThemeName]>("theme/setThemeName");
export const setThemePreference = createAction<[preference: ThemePreference]>(
  "theme/setThemePreference",
);
export const setThemeCustomization = createAction<[customization: ThemeCustomizationState]>(
  "theme/setThemeCustomization",
);
export const requestThemePreferenceChange = createAction<[preference: ThemePreference]>(
  "theme/requestThemePreferenceChange",
);
export const selectThemePreset = createAction<[presetId: string]>("theme/selectThemePreset");
export const clearThemeCustomization = createAction("theme/clearThemeCustomization");
export const importCustomTheme = createAction<[json: unknown]>("theme/importCustomTheme");
export const setThemeError = createAction<[error: string | null]>("theme/setThemeError");

function isSameThemeCustomization(
  state: ThemeState,
  customization: ThemeCustomizationState,
): boolean {
  return (
    state.hasCustomTheme === customization.hasCustomTheme &&
    state.customThemeName === customization.customThemeName &&
    state.activePresetId === customization.activePresetId
  );
}

export const themeReducer = createReducer<ThemeState>(initialState)
  .with(setThemeName, (state, { payload: [name] }) => {
    if (state.name === name) return state;
    return { ...state, name };
  })
  .with(setThemePreference, (state, { payload: [preference] }) => {
    if (state.preference === preference) return state;
    return { ...state, preference };
  })
  .with(setThemeCustomization, (state, { payload: [customization] }) => {
    if (isSameThemeCustomization(state, customization)) return state;
    return { ...state, ...customization };
  })
  .with(setThemeError, (state, { payload: [error] }) => {
    if (state.error === error) return state;
    return { ...state, error };
  });
