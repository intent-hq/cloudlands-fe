import { THEME_PRESET_MANIFEST } from '../../shared/theme-presets-manifest';

const catalogThemes = ['system', 'light', 'dark'] as const;
export const catalogColorThemes = [
  'default',
  ...THEME_PRESET_MANIFEST.map(({ id }) => id),
] as const;

export type CatalogTheme = (typeof catalogThemes)[number];
export type CatalogColorTheme = 'default' | (typeof THEME_PRESET_MANIFEST)[number]['id'];
export type CatalogPreviewFit = 'component';

export interface CatalogPreferences {
  theme: CatalogTheme;
  colorTheme: CatalogColorTheme;
  reducedMotion: boolean;
}

export interface CatalogUrlSettings {
  state?: string;
  theme?: CatalogTheme;
  width?: number;
  reducedMotion?: boolean;
  fit?: CatalogPreviewFit;
}

export const defaultCatalogPreferences: CatalogPreferences = {
  theme: 'system',
  colorTheme: 'default',
  reducedMotion: false,
};

export function parseCatalogUrlSettings(params: URLSearchParams): CatalogUrlSettings {
  const theme = params.get('theme');
  const state = params.get('state')?.trim();
  const widthValue = params.get('width');
  const width = widthValue === null ? undefined : Number(widthValue);
  const motion = params.get('motion');
  const legacyReducedMotion = params.get('reducedMotion');
  const fit = params.get('fit');

  return {
    state: state || undefined,
    theme: catalogThemes.includes(theme as CatalogTheme) ? (theme as CatalogTheme) : undefined,
    width:
      Number.isInteger(width) && width !== undefined && width >= 240 && width <= 1600
        ? width
        : undefined,
    reducedMotion:
      motion === 'reduced' || legacyReducedMotion === 'true'
        ? true
        : motion === 'full' || legacyReducedMotion === 'false'
          ? false
          : undefined,
    ...(fit === 'component' ? { fit: 'component' as const } : {}),
  };
}

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
