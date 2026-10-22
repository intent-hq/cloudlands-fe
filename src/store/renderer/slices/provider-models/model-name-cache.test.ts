import { describe, expect, it } from 'vitest';
import type { StoreState } from '../../types';
import {
  hostExecutionConnectionChanged,
  hostExecutionInvalidated,
} from '../host-execution/host-execution-slice';
import { setAvailableModels } from '../model/model-slice';
import { readModelNames } from './model-name-cache';
import { selectLearnedModelDisplayName } from './provider-models-selectors';
import {
  initialState,
  learnedModelNamesHydrated,
  providerModelsCacheCleared,
  providerModelsLoaded,
  providerModelsReducer,
} from './provider-models-slice';
import type { ProviderModelsState } from './provider-models-types';

const lookup = (state: ProviderModelsState, provider: string, model: string) =>
  selectLearnedModelDisplayName.select({ providerModels: state } as StoreState, provider, model);
const models = [{ value: 'vendor/model:tag', label: 'Custom model' }];

describe('learned model names', () => {
  it('learns exact identities from workspace and active catalogs without conflating providers', () => {
    let state = providerModelsReducer(initialState, providerModelsLoaded('pi', { models }, 0, 'A'));
    state = providerModelsReducer(
      state,
      setAvailableModels(
        [
          {
            value: 'vendor/model:tag',
            label: 'Other provider label',
            effortLevels: ['high'],
            isDefault: true,
          },
        ],
        'opencode',
      ),
    );
    expect(lookup(state, 'pi', 'vendor/model:tag')).toBe('Custom model');
    expect(lookup(state, 'opencode', 'vendor/model:tag')).toBe('Other provider label');
    expect(lookup(state, 'unknown', 'vendor/model:tag')).toBeUndefined();
    expect(lookup(state, 'pi', 'vendor')).toBeUndefined();
    expect(state.learnedNames).toEqual({
      pi: { 'vendor/model:tag': 'Custom model' },
      opencode: { 'vendor/model:tag': 'Other provider label' },
    });
  });

  it('merges observations across workspaces, refreshes labels and retains omitted names', () => {
    let state = providerModelsReducer(initialState, providerModelsLoaded('pi', { models }, 0, 'A'));
    state = providerModelsReducer(
      state,
      providerModelsLoaded(
        'pi',
        {
          models: [
            { value: 'new', label: 'New model' },
            { value: 'vendor/model:tag', label: 'Updated name' },
          ],
        },
        0,
        'B',
      ),
    );
    state = providerModelsReducer(state, providerModelsLoaded('pi', { models: [] }, 0));
    state = providerModelsReducer(state, setAvailableModels([], 'pi'));
    expect(lookup(state, 'pi', 'vendor/model:tag')).toBe('Updated name');
    expect(lookup(state, 'pi', 'new')).toBe('New model');
  });

  it.each([
    providerModelsCacheCleared(),
    hostExecutionInvalidated(),
    hostExecutionConnectionChanged('other'),
  ])('retains names through $type but rejects old-epoch responses', (clear) => {
    const before = providerModelsReducer(initialState, providerModelsLoaded('pi', { models }, 0));
    const cleared = providerModelsReducer(before, clear);
    expect(cleared.learnedNames).toBe(before.learnedNames);
    expect(cleared.byProviderId).toEqual({});
    expect(
      providerModelsReducer(
        cleared,
        providerModelsLoaded(
          'pi',
          {
            models: [{ value: 'vendor/model:tag', label: 'Obsolete response' }],
          },
          0,
          'A',
        ),
      ),
    ).toBe(cleared);
    const fresh = providerModelsReducer(
      cleared,
      providerModelsLoaded(
        'pi',
        {
          models: [{ value: 'vendor/model:tag', label: 'Fresh response' }],
        },
        1,
        'A',
      ),
    );
    expect(lookup(fresh, 'pi', 'vendor/model:tag')).toBe('Fresh response');
  });

  it('hydration fills missing names without replacing already discovered labels', () => {
    const state = providerModelsReducer(initialState, setAvailableModels(models, 'pi'));
    const hydrated = providerModelsReducer(
      state,
      learnedModelNamesHydrated({
        pi: { 'vendor/model:tag': 'Old saved label', absent: 'Remembered model' },
        codex: { gpt: 'GPT' },
      }),
    );
    expect(lookup(hydrated, 'pi', 'vendor/model:tag')).toBe('Custom model');
    expect(lookup(hydrated, 'pi', 'absent')).toBe('Remembered model');
    expect(lookup(hydrated, 'codex', 'gpt')).toBe('GPT');
    expect(hydrated.byProviderId).toEqual({});
  });

  it('does not learn blank labels or unsafe dictionary keys', () => {
    let state = providerModelsReducer(initialState, setAvailableModels(models, 'pi'));
    for (const provider of ['__proto__', 'constructor', 'prototype', '']) {
      state = providerModelsReducer(state, setAvailableModels(models, provider));
      expect(lookup(state, provider, 'vendor/model:tag')).toBeUndefined();
    }
    state = providerModelsReducer(
      state,
      setAvailableModels(
        [
          { value: '__proto__', label: 'Invalid' },
          { value: 'constructor', label: 'Invalid' },
          { value: '', label: 'Invalid' },
          { value: 'vendor/model:tag', label: '  ' },
        ],
        'pi',
      ),
    );
    expect(state.learnedNames).toEqual({ pi: { 'vendor/model:tag': 'Custom model' } });
    expect(lookup(state, 'pi', 'toString')).toBeUndefined();
  });

  it.each([
    undefined,
    null,
    [],
    'invalid',
    { version: 2, names: { pi: { x: 'X' } } },
    { version: 1, names: [] },
  ])('ignores invalid or unsupported stored envelopes: %j', (value) => {
    expect(readModelNames(value)).toEqual({});
  });

  it('validates persisted labels and excludes poison keys and capability objects', () => {
    expect(
      readModelNames(
        JSON.parse(`{"version":1,"names":{
      "__proto__":{"x":"Bad"},"constructor":{"x":"Bad"},"empty":{},
      "pi":{"__proto__":"Bad","constructor":"Bad","":"Bad","blank":" ",
      "object":{"label":"Bad","effortLevels":["high"]},"number":2,"good":"Good"}
    }}`),
      ),
    ).toEqual({ pi: { good: 'Good' } });
    expect({}).not.toHaveProperty('x');
  });
});
