import { store } from "../../store";
import type { ThemeCustomizationState, ThemeName, ThemePreference } from "./theme-types";

export const selectThemeName = store.createSelector((state): ThemeName => {
  return state.theme.name;
});

export const selectThemePreference = store.createSelector((state): ThemePreference => {
  return state.theme.preference;
});

export const selectIsDarkTheme = store.createSelector((state): boolean => {
  return state.theme.name === "dark";
});

export const selectThemeCustomization = store.createSelector((state): ThemeCustomizationState => {
  return {
    hasCustomTheme: state.theme.hasCustomTheme,
    customThemeName: state.theme.customThemeName,
    activePresetId: state.theme.activePresetId,
  };
});

export const selectHasCustomTheme = store.createSelector((state): boolean => {
  return state.theme.hasCustomTheme;
});

export const selectCustomThemeName = store.createSelector((state): string | null => {
  return state.theme.customThemeName;
});

export const selectActiveThemePresetId = store.createSelector((state): string | null => {
  return state.theme.activePresetId;
});

export const selectThemeError = store.createSelector((state): string | null => {
  return state.theme.error;
});
