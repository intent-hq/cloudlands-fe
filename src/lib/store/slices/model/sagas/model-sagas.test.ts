import {
  describe,
  it,
  vi,
} from 'vitest';
import { testSaga } from 'redux-saga-test-plan';

vi.mock('typed-redux-saga', async () => await import('$lib/store/utils/test-helpers/typed-redux-saga-mock'));

import { loadModelsSaga } from './load-models-saga';
import { modelSaga } from './model-saga';
import { persistenceSaga } from './persistence-saga';
import { selectModelSaga } from './select-model-saga';

describe('modelSaga', () => {
  it('forks the persistence, load, and selection sagas', () => {
    testSaga(modelSaga)
      .next()
      .fork(persistenceSaga)
      .next()
      .fork(loadModelsSaga)
      .next()
      .fork(selectModelSaga)
      .next()
      .isDone();
  });
});