import { describe, it, vi } from 'vitest';
import { testSaga } from 'redux-saga-test-plan';
import * as sagaEffects from 'redux-saga/effects';

vi.mock('typed-redux-saga', () => ({
  fork: function* (saga: any, ...args: any[]) {
    return yield sagaEffects.fork(saga, ...args);
  },
}));

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