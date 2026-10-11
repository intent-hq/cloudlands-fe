import { call, put, takeEvery } from 'typed-redux-saga';
import { selectCatalogPreferences } from '../catalog-selectors';
import { setCatalogPreferences } from '../catalog-slice';
import { loadCatalogPreferences, saveCatalogPreferences } from '../utils/catalog-storage';

function* persistCatalogPreferences() {
  const preferences = yield* selectCatalogPreferences.effect();
  yield* call(saveCatalogPreferences, preferences);
}

export function* catalogSaga() {
  const preferences = yield* call(loadCatalogPreferences);
  yield* put(setCatalogPreferences(preferences));
  yield* takeEvery(setCatalogPreferences, persistCatalogPreferences);
}
