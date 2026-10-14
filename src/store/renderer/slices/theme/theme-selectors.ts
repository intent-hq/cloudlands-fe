import { store } from '../../store';
import { getIsDarkTheme } from './theme-projections';
import type { ThemePreference } from './theme-types';

export const selectThemePreference = store.createSelector((state): ThemePreference => {
  return state.theme.preference;
});

export const selectIsDarkTheme = store.createSelector(getIsDarkTheme);

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
