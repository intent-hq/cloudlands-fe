// Svelte binding of the shared read owner; remove this facade when the Svelte renderer retires.
import { selectLearnedModelNames } from '../provider-models-selectors';
import { createModelNameCacheSaga } from './model-name-cache-saga-factory';

export const { modelNameCacheSaga } = createModelNameCacheSaga({ selectLearnedModelNames });
