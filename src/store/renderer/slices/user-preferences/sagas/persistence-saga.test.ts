import {
  describe,
  it,
  vi,
} from 'vitest';
import { testSaga } from 'redux-saga-test-plan';

vi.mock(
  'typed-redux-saga',
  async () => await import('$store/renderer/utils/test-helpers/typed-redux-saga-mock'),
);

import { setLocalStorageJSON } from '$store/renderer/utils/safe-local-storage-saga';
import {
  selectActivityLogPresets,
  selectPromoBannerInteractions,
} from '../user-preferences-selectors';
import {
  ACTIVITY_LOG_PRESETS_STORAGE_KEY,
  persistActivityLogPresets,
  persistPromoBannerInteractions,
  PROMO_BANNER_STORAGE_KEY,
} from './persistence-saga';

describe('user preferences persistence saga', () => {
  const preset = {
    name: 'Errors',
    filters: {
      showFileChanges: false,
      showAgentActivity: true,
      showSystemEvents: false,
      showErrors: true,
      searchQuery: 'error',
      dateRange: 'today',
      actorFilter: 'agent',
    },
  };

  it('persists activity log presets from Redux state', () => {
    const presets = [preset];

    testSaga(persistActivityLogPresets)
      .next()
      .select(selectActivityLogPresets.select)
      .next(presets)
      .call(setLocalStorageJSON, ACTIVITY_LOG_PRESETS_STORAGE_KEY, presets)
      .next()
      .isDone();
  });

  it('persists promotional banner interactions from Redux state', () => {
    const interactions = {
      bannerA: {
        dismissed: true,
        dismissedAt: '2026-04-29T00:00:00.000Z',
        completedAllSteps: true,
        interactions: [
          { type: 'dismiss', result: 'success', timestamp: '2026-04-29T00:00:00.000Z' },
        ],
      },
    };

    testSaga(persistPromoBannerInteractions)
      .next()
      .select(selectPromoBannerInteractions.select)
      .next(interactions)
      .call(setLocalStorageJSON, PROMO_BANNER_STORAGE_KEY, interactions)
      .next()
      .isDone();
  });
});
