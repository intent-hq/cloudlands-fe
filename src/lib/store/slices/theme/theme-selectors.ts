import { createSelector } from "../../utils/create-selector";
import type { ThemeCustomizationState, ThemeName, ThemePreference } from "./theme-types";

export const selectThemeName = createSelector((state): ThemeName => {
  return state.theme.name;
});

export const selectThemePreference = createSelector((state): ThemePreference => {
  return state.theme.preference;
});

export const selectIsDarkTheme = createSelector((state): boolean => {
  return state.theme.name === "dark";
});

export const selectThemeCustomization = createSelector((state): ThemeCustomizationState => {
  return {
    hasCustomTheme: state.theme.hasCustomTheme,
    customThemeName: state.theme.customThemeName,
    activePresetId: state.theme.activePresetId,
  };
});

export const selectHasCustomTheme = createSelector((state): boolean => {
  return state.theme.hasCustomTheme;
});

export const selectCustomThemeName = createSelector((state): string | null => {
  return state.theme.customThemeName;
});

export const selectActiveThemePresetId = createSelector((state): string | null => {
  return state.theme.activePresetId;
});

export const selectThemeError = createSelector((state): string | null => {
  return state.theme.error;
});
