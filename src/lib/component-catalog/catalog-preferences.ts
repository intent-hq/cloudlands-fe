import { THEME_PRESET_MANIFEST } from '../../shared/theme-presets-manifest';

export const catalogThemes = ['system', 'light', 'dark'] as const;
export const catalogColorThemes = [
  'default',
  ...THEME_PRESET_MANIFEST.map(({ id }) => id),
] as const;

export type CatalogTheme = (typeof catalogThemes)[number];
export type CatalogColorTheme = 'default' | (typeof THEME_PRESET_MANIFEST)[number]['id'];

export interface CatalogPreferences {
  theme: CatalogTheme;
  colorTheme: CatalogColorTheme;
  reducedMotion: boolean;
}

export const defaultCatalogPreferences: CatalogPreferences = {
  theme: 'system',
  colorTheme: 'default',
  reducedMotion: false,
};

const storageKey = 'component-catalog-preferences';

export function readCatalogPreferences(storage: Storage): CatalogPreferences {
  try {
    const value = JSON.parse(storage.getItem(storageKey) ?? '{}') as Partial<CatalogPreferences>;
    return {
      theme: catalogThemes.includes(value.theme as CatalogTheme)
        ? (value.theme as CatalogTheme)
        : defaultCatalogPreferences.theme,
      colorTheme: catalogColorThemes.includes(value.colorTheme as CatalogColorTheme)
        ? (value.colorTheme as CatalogColorTheme)
        : defaultCatalogPreferences.colorTheme,
      reducedMotion:
        typeof value.reducedMotion === 'boolean'
          ? value.reducedMotion
          : defaultCatalogPreferences.reducedMotion,
    };
  } catch {
    return defaultCatalogPreferences;
  }
}

export function writeCatalogPreferences(storage: Storage, value: CatalogPreferences): void {
  try {
    storage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // Catalog controls remain usable when storage is unavailable.
  }
}
