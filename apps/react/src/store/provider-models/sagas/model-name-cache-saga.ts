import { selectLearnedModelNames } from '../provider-models-selectors';
import { createModelNameCacheSaga } from '../../../../../../src/store/renderer/slices/provider-models/sagas/model-name-cache-saga-factory';

export const { modelNameCacheSaga } = createModelNameCacheSaga({ selectLearnedModelNames });
