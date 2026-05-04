import { beforeEach, describe, it, vi } from 'vitest';
import { expectSaga } from 'redux-saga-test-plan';

vi.mock(
  'typed-redux-saga',
  async () => await import('$lib/store/utils/test-helpers/typed-redux-saga-mock'),
);

vi.mock(
  '$lib/electron-bridge',
  async () => await import('$lib/store/utils/test-helpers/electron-bridge-mock'),
);

import { invoke } from '$lib/electron-bridge';
import { getLocalStorageJSON } from '$lib/store/utils/safe-local-storage-saga';
import {
  hydrateActivityLogPresets,
  hydratePromoBannerInteractions,
} from '../user-preferences-slice';
import { ACTIVITY_LOG_PRESETS_STORAGE_KEY, PROMO_BANNER_STORAGE_KEY } from './persistence-saga';
import { applyChannel } from './apply-channel';
import { initUserPreferencesSaga } from './init-saga';

describe('initUserPreferencesSaga', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockResolvedValue({ success: false, error: 'not available in test' });
  });

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

  const validPromoRecord = {
    dismissed: true,
    dismissedAt: '2026-04-29T00:00:00.000Z',
    interactions: [{ type: 'dismiss', result: 'success', timestamp: '2026-04-29T00:00:00.000Z' }],
  };

  it('hydrates migrated activity log and promo banner preferences from valid storage', async () => {
    await expectSaga(initUserPreferencesSaga)
      .provide({
        call(effect, next) {
          if (effect.fn === applyChannel) return undefined;
          if (effect.fn === invoke) return { success: false, error: 'not available in test' };
          if (effect.fn !== getLocalStorageJSON) return next();

          if (effect.args[0] === ACTIVITY_LOG_PRESETS_STORAGE_KEY) {
            return [preset, { name: 'Missing filters' }, { filters: preset.filters }];
          }

          if (effect.args[0] === PROMO_BANNER_STORAGE_KEY) {
            return {
              bannerA: validPromoRecord,
              bannerB: { dismissed: true },
              bannerC: [],
            };
          }

          return undefined;
        },
      })
      .put(hydrateActivityLogPresets([preset]))
      .put(hydratePromoBannerInteractions({ bannerA: validPromoRecord }))
      .run();
  });

  it('falls back to empty hydrated preferences for malformed storage', async () => {
    await expectSaga(initUserPreferencesSaga)
      .provide({
        call(effect, next) {
          if (effect.fn === applyChannel) return undefined;
          if (effect.fn === invoke) return { success: false, error: 'not available in test' };
          if (effect.fn !== getLocalStorageJSON) return next();

          if (effect.args[0] === ACTIVITY_LOG_PRESETS_STORAGE_KEY) {
            return { presets: [preset] };
          }

          if (effect.args[0] === PROMO_BANNER_STORAGE_KEY) {
            return [{ bannerA: { dismissed: true, interactions: [] } }];
          }

          return undefined;
        },
      })
      .put(hydrateActivityLogPresets([]))
      .put(hydratePromoBannerInteractions({}))
      .run();
  });
});
