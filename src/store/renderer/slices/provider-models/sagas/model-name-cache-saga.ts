import { call, put, takeEvery } from 'typed-redux-saga';
import { safeLocalStorage } from '$lib/utils/safe-storage';
import { setAvailableModels } from '../../model/model-slice';
import { MODEL_NAMES_STORAGE_KEY, readModelNames } from '../model-name-cache';
import { selectLearnedModelNames } from '../provider-models-selectors';
import { learnedModelNamesHydrated, providerModelsLoaded } from '../provider-models-slice';

/** Starts before catalog owners: synchronous local hydration, no backend dependency. */
export function* modelNameCacheSaga() {
  const stored = yield* call([safeLocalStorage, safeLocalStorage.getJSON], MODEL_NAMES_STORAGE_KEY);
  yield* put(learnedModelNamesHydrated(readModelNames(stored)));
  let previous = yield* selectLearnedModelNames.effect();
  yield* takeEvery([providerModelsLoaded, setAvailableModels], function* () {
    // Read accepted reducer state; stale-epoch responses never change this map.
    const names = yield* selectLearnedModelNames.effect();
    if (names === previous) return;
    previous = names;
    yield* call([safeLocalStorage, safeLocalStorage.setJSON], MODEL_NAMES_STORAGE_KEY, {
      version: 1,
      names,
    });
  });
}
