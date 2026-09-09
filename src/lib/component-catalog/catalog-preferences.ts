import { THEME_PRESET_MANIFEST } from '../../shared/theme-presets-manifest';

const catalogThemes = ['system', 'light', 'dark'] as const;
export const catalogMotions = ['system', 'full', 'reduced'] as const;
export const catalogColorThemes = [
  'default',
  ...THEME_PRESET_MANIFEST.map(({ id }) => id),
] as const;

export type CatalogTheme = (typeof catalogThemes)[number];
export type CatalogColorTheme = 'default' | (typeof THEME_PRESET_MANIFEST)[number]['id'];
export type CatalogMotion = (typeof catalogMotions)[number];

export interface CatalogPreferences {
  theme: CatalogTheme;
  colorTheme: CatalogColorTheme;
  motion: CatalogMotion;
}

export interface CatalogUrlSettings {
  state?: string;
  theme?: CatalogTheme;
  width?: number;
  motion?: CatalogMotion;
}

export const defaultCatalogPreferences: CatalogPreferences = {
  theme: 'system',
  colorTheme: 'default',
  motion: 'system',
};

export function parseCatalogUrlSettings(params: URLSearchParams): CatalogUrlSettings {
  const theme = params.get('theme');
  const state = params.get('state')?.trim();
  const widthValue = params.get('width');
  const width = widthValue === null ? undefined : Number(widthValue);
  const motion = params.get('motion');
  const legacyReducedMotion = params.get('reducedMotion');

  return {
    state: state || undefined,
    theme: catalogThemes.includes(theme as CatalogTheme) ? (theme as CatalogTheme) : undefined,
    width:
      Number.isInteger(width) && width !== undefined && width >= 240 && width <= 1600
        ? width
        : undefined,
    motion: catalogMotions.includes(motion as CatalogMotion)
      ? (motion as CatalogMotion)
      : legacyReducedMotion === 'true'
        ? 'reduced'
        : legacyReducedMotion === 'false'
          ? 'full'
          : undefined,
  };
}

const storageKey = 'component-catalog-preferences';

export function readCatalogPreferences(storage: Storage): CatalogPreferences {
  try {
    const value = JSON.parse(storage.getItem(storageKey) ?? '{}') as Partial<CatalogPreferences> & {
      reducedMotion?: unknown;
    };
    return {
      theme: catalogThemes.includes(value.theme as CatalogTheme)
        ? (value.theme as CatalogTheme)
        : defaultCatalogPreferences.theme,
      colorTheme: catalogColorThemes.includes(value.colorTheme as CatalogColorTheme)
        ? (value.colorTheme as CatalogColorTheme)
        : defaultCatalogPreferences.colorTheme,
      motion: catalogMotions.includes(value.motion as CatalogMotion)
        ? (value.motion as CatalogMotion)
        : value.reducedMotion === true
          ? 'reduced'
          : defaultCatalogPreferences.motion,
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
