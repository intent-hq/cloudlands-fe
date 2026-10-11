import {
  defaultCatalogPreferences,
  readCatalogPreferences,
  writeCatalogPreferences,
  type CatalogPreferences,
} from '$lib/component-catalog/catalog-preferences';

// Keep access to the browser storage getter inside this error-safe adapter. The
// reference parser/writer owns the key, validation and backward compatibility.
export function loadCatalogPreferences(): CatalogPreferences {
  try {
    // eslint-disable-next-line themis/direct-local-storage-usage -- App-local safe storage adapter called only by the catalog saga.
    return readCatalogPreferences(window.localStorage);
  } catch {
    return defaultCatalogPreferences;
  }
}

export function saveCatalogPreferences(preferences: CatalogPreferences): void {
  try {
    // eslint-disable-next-line themis/direct-local-storage-usage -- App-local safe storage adapter called only by the catalog saga.
    writeCatalogPreferences(window.localStorage, preferences);
  } catch {
    // Preferences remain usable when the browser denies access to storage.
  }
}
