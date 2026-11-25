/**
 * Where the theme is saved. One theme for every host view of this app: each
 * view follows the others' changes (see `ThemeManager`).
 */
import { sharedPreference } from './shared-preference';

const THEME_STORAGE_KEY = 'theme';
const CUSTOM_THEME_STORAGE_KEY = 'custom-vscode-theme';
const PRESET_ID_STORAGE_KEY = 'theme-preset-id';
const PRESET_SET_STORAGE_KEY = 'theme-preset-set';

const storedText = (stored: unknown): string | undefined =>
  typeof stored === 'string' && stored ? stored : undefined;

export const themePreferenceStorage = sharedPreference<string>({
  key: THEME_STORAGE_KEY,
  scope: 'app',
  format: 'text',
  parse: storedText,
});
export const customThemeStorage = sharedPreference<unknown>({
  key: CUSTOM_THEME_STORAGE_KEY,
  scope: 'app',
  parse: (stored) => stored,
});
export const presetIdStorage = sharedPreference<string>({
  key: PRESET_ID_STORAGE_KEY,
  scope: 'app',
  format: 'text',
  parse: storedText,
});
export const presetSetStorage = sharedPreference<unknown>({
  key: PRESET_SET_STORAGE_KEY,
  scope: 'app',
  parse: (stored) => stored,
});
export const THEME_STORAGE_KEYS: readonly string[] = [
  THEME_STORAGE_KEY,
  CUSTOM_THEME_STORAGE_KEY,
  PRESET_ID_STORAGE_KEY,
  PRESET_SET_STORAGE_KEY,
];
