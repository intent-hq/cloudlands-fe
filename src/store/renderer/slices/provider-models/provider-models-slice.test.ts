/**
 * Provider Models Cache reducer + selector tests.
 *
 * Pins the session-cache contract: entries land under the dispatched
 * (normalized) provider id with a creator-stamped `fetchedAt`, a later load
 * for the same provider replaces its entry without touching others,
 * `providerModelsCacheCleared` drops the whole map and bumps the clear epoch
 * (the reconnect trigger), writes stamped with a pre-clear epoch are dropped,
 * and lookups are exact-key reads with no default-provider fallback.
 */
import { describe, expect, it } from 'vitest';
import type { StoreState } from '../../types';
import {
  selectProviderModelsCacheEntry,
  selectProviderModelsCacheMap,
  selectProviderModelsClearEpoch,
} from './provider-models-selectors';
import {
  initialState,
  providerModelsCacheCleared,
  providerModelsLoaded,
  providerModelsReducer,
} from './provider-models-slice';
import type { ProviderModelsFetchResult, ProviderModelsState } from './provider-models-types';

const AUGGIE_RESULT: ProviderModelsFetchResult = {
  models: [
    { value: 'sonnet4.5', label: 'Claude Sonnet 4.5' },
    { value: 'haiku4.5', label: 'Claude Haiku 4.5' },
  ],
};

const PI_RESULT: ProviderModelsFetchResult = {
  models: [{ value: 'pi:gpt5.4', label: 'GPT 5.4' }],
  warning: 'served from last-good cache',
  stale: true,
};

function storeWith(providerModels: ProviderModelsState): StoreState {
  return { providerModels } as unknown as StoreState;
}

describe('providerModelsReducer', () => {
  it('starts empty', () => {
    const state = providerModelsReducer(undefined, { type: '@@INIT' });
    expect(state.byProviderId).toEqual({});
  });

  it('providerModelsLoaded caches the result under the provider id with fetchedAt', () => {
    const action = providerModelsLoaded('auggie', AUGGIE_RESULT, 0);
    const state = providerModelsReducer(initialState, action);

    const entry = state.byProviderId['auggie'];
    expect(entry?.models).toEqual(AUGGIE_RESULT.models);
    expect(entry?.warning).toBeUndefined();
    expect(entry?.stale).toBeUndefined();
    // The creator stamps fetchedAt (ISO string) — the reducer stores it verbatim.
    expect(entry?.fetchedAt).toBe(action.payload[1].fetchedAt);
    expect(Number.isNaN(Date.parse(entry?.fetchedAt ?? ''))).toBe(false);
  });

  it('providerModelsLoaded carries warning/stale verbatim and keeps other entries', () => {
    const withAuggie = providerModelsReducer(
      initialState,
      providerModelsLoaded('auggie', AUGGIE_RESULT, 0),
    );
    const state = providerModelsReducer(withAuggie, providerModelsLoaded('pi', PI_RESULT, 0));

    expect(Object.keys(state.byProviderId).sort()).toEqual(['auggie', 'pi']);
    expect(state.byProviderId['pi']?.warning).toBe('served from last-good cache');
    expect(state.byProviderId['pi']?.stale).toBe(true);
  });

  it('a later providerModelsLoaded for the same provider replaces its entry', () => {
    const first = providerModelsReducer(
      initialState,
      providerModelsLoaded('auggie', { ...AUGGIE_RESULT, warning: 'old', stale: true }, 0),
    );
    const state = providerModelsReducer(
      first,
      providerModelsLoaded(
        'auggie',
        { models: [{ value: 'opus4.7', label: 'Claude Opus 4.7' }] },
        0,
      ),
    );

    const entry = state.byProviderId['auggie'];
    expect(entry?.models).toEqual([{ value: 'opus4.7', label: 'Claude Opus 4.7' }]);
    // Replaced wholesale — stale flags from the prior fetch must not linger.
    expect(entry?.warning).toBeUndefined();
    expect(entry?.stale).toBeUndefined();
  });

  it('providerModelsCacheCleared drops the whole map and bumps the clear epoch', () => {
    const populated = providerModelsReducer(
      providerModelsReducer(initialState, providerModelsLoaded('auggie', AUGGIE_RESULT, 0)),
      providerModelsLoaded('pi', PI_RESULT, 0),
    );

    const state = providerModelsReducer(populated, providerModelsCacheCleared());
    expect(state.byProviderId).toEqual({});
    expect(state.clearEpoch).toBe(1);

    expect(providerModelsReducer(state, providerModelsCacheCleared()).clearEpoch).toBe(2);
  });

  it('drops a providerModelsLoaded stamped with a pre-clear epoch (in-flight reconnect race)', () => {
    // A fetch starts at epoch 0, a reconnect clear lands (epoch 1), then the
    // pre-restart response settles — its write must NOT re-pollute the cache.
    const cleared = providerModelsReducer(initialState, providerModelsCacheCleared());
    const state = providerModelsReducer(cleared, providerModelsLoaded('auggie', AUGGIE_RESULT, 0));

    expect(state).toBe(cleared);
    expect(state.byProviderId).toEqual({});

    // A write from a fetch started AFTER the clear (current epoch) lands.
    const fresh = providerModelsReducer(cleared, providerModelsLoaded('auggie', AUGGIE_RESULT, 1));
    expect(fresh.byProviderId['auggie']?.models).toEqual(AUGGIE_RESULT.models);
  });

  it('unrelated actions leave state untouched (same reference)', () => {
    const populated = providerModelsReducer(
      initialState,
      providerModelsLoaded('auggie', AUGGIE_RESULT, 0),
    );
    expect(providerModelsReducer(populated, { type: 'other/action' })).toBe(populated);
  });
});

describe('provider-models selectors', () => {
  const populated = providerModelsReducer(
    providerModelsReducer(initialState, providerModelsLoaded('auggie', AUGGIE_RESULT, 0)),
    providerModelsLoaded('pi', PI_RESULT, 0),
  );

  it('selectProviderModelsCacheMap exposes the full map ({} when empty)', () => {
    expect(selectProviderModelsCacheMap.select(storeWith(initialState))).toEqual({});
    expect(selectProviderModelsCacheMap.select(storeWith(populated))).toBe(populated.byProviderId);
  });

  it('selectProviderModelsCacheEntry reads by exact key, undefined on a miss', () => {
    expect(selectProviderModelsCacheEntry.select(storeWith(populated), 'auggie')?.models).toEqual(
      AUGGIE_RESULT.models,
    );
    expect(selectProviderModelsCacheEntry.select(storeWith(populated), 'pi')?.stale).toBe(true);
    // No default-provider fallback: an unknown id is a miss, never another row.
    expect(selectProviderModelsCacheEntry.select(storeWith(populated), 'nope')).toBeUndefined();
    expect(
      selectProviderModelsCacheEntry.select(storeWith(initialState), 'auggie'),
    ).toBeUndefined();
  });

  it('selectProviderModelsClearEpoch reads the epoch (0 when the slice is absent)', () => {
    expect(selectProviderModelsClearEpoch.select(storeWith(initialState))).toBe(0);
    const cleared = providerModelsReducer(populated, providerModelsCacheCleared());
    expect(selectProviderModelsClearEpoch.select(storeWith(cleared))).toBe(1);
    expect(
      selectProviderModelsClearEpoch.select({} as unknown as StoreState),
    ).toBe(0);
  });
});
