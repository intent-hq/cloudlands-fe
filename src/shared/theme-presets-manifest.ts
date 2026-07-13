export interface ThemePresetManifestEntry {
  id: string;
  label: string;
}

export const THEME_PRESET_MANIFEST = [
  { id: 'dracula', label: 'Dracula' },
  { id: 'nord', label: 'Nord' },
  { id: 'rose-pine', label: 'Rosé Pine' },
  { id: 'tokyo-night', label: 'Tokyo Night' },
  { id: 'solarized', label: 'Solarized' },
  { id: 'github', label: 'GitHub' },
  { id: 'high-contrast', label: 'High Contrast' },
] as const satisfies ReadonlyArray<ThemePresetManifestEntry>;

export const THEME_PRESET_IDS: readonly string[] = THEME_PRESET_MANIFEST.map(({ id }) => id);