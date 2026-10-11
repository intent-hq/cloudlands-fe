import { store } from '../index';

export const selectCatalogQuery = store.createSelector((state) => state.catalog.query);
export const selectCatalogPreferences = store.createSelector((state) => state.catalog.preferences);
