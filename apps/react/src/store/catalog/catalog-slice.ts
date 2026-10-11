import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import type { StoreReducerFunction } from '@themislib/themis/types';
import {
  defaultCatalogPreferences,
  type CatalogPreferences,
} from '$lib/component-catalog/catalog-preferences';
import type { CatalogState } from './catalog-types';

export const setCatalogQuery = createAction<[query: string]>('catalog/setQuery');
export const setCatalogPreferences =
  createAction<[preferences: CatalogPreferences]>('catalog/setPreferences');

export const catalogReducer: StoreReducerFunction<CatalogState> = createReducer<CatalogState>({
  query: '',
  preferences: defaultCatalogPreferences,
})
  .with(setCatalogQuery, (state, { payload: [query] }) =>
    state.query === query ? state : { ...state, query },
  )
  .with(
    setCatalogPreferences,
    (state: CatalogState, { payload: [preferences] }: ReturnType<typeof setCatalogPreferences>) =>
      state.preferences.theme === preferences.theme &&
      state.preferences.motion === preferences.motion &&
      state.preferences.colorTheme === preferences.colorTheme
        ? state
        : { ...state, preferences },
  );
