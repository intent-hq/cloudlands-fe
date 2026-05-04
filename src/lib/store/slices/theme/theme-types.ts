export type ThemeName = "light" | "dark";
export type ThemePreference = ThemeName | "system";

export type ThemeState = {
  name: ThemeName;
  preference: ThemePreference;
  hasCustomTheme: boolean;
  customThemeName: string | null;
  activePresetId: string | null;
  error: string | null;
};

export type ThemeCustomizationState = Pick<
  ThemeState,
  "hasCustomTheme" | "customThemeName" | "activePresetId"
>;

export const DEFAULT_THEME_NAME: ThemeName = "dark";
export const DEFAULT_THEME_PREFERENCE: ThemePreference = "system";
export const DEFAULT_THEME_CUSTOMIZATION: ThemeCustomizationState = {
  hasCustomTheme: false,
  customThemeName: null,
  activePresetId: null,
};
