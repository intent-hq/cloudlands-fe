import type { CatalogPreferences } from '$lib/component-catalog/catalog-preferences';

export type CatalogState = {
  query: string;
  preferences: CatalogPreferences;
};
