import {
  describe,
  expect,
  it,
} from 'vitest';
import { MODEL_DEFAULTS } from '$shared/constants/agent-services';
import { MOCK_PROVIDER_CATALOG } from '../../../../test/fixtures/provider-catalog.fixture';
import { initialState as modelInitialState } from './model-slice';
import { initialState as providerSettingsInitialState } from '../provider-settings/provider-settings-slice';
import { selectModelDisplayName, selectSelectedModel } from './model-selectors';
import { createCollection } from '$lib/store-shim/utils/collections/collection-utils';
import type { AuggieModel } from '$features/auggie/auggie-models.client';
import type { ModelState } from './model-types';
import type { ProviderSettingsState } from '../provider-settings/provider-settings-slice';
import type { StoreState } from '../../types';

const defaultProviderId = MOCK_PROVIDER_CATALOG.defaultProviderId;

function mockState(
  model: Partial<ModelState> = {},
  providerSettings: Partial<ProviderSettingsState> = {},
): StoreState {
  return {
    model: { ...modelInitialState, ...model },
    providerSettings: { ...providerSettingsInitialState, ...providerSettings },
  } as unknown as StoreState;
}

describe('selectSelectedModel', () => {
  it('returns the active provider default when set', () => {
    const state = mockState(
      { providerModels: { [defaultProviderId]: 'gpt5.4' } },
      { activeProviderId: defaultProviderId },
    );

    expect(selectSelectedModel.select(state)).toBe('gpt5.4');
  });

  it('returns the explicit provider default when a providerId is passed', () => {
    const state = mockState(
      {
        providerModels: {
          [defaultProviderId]: 'gpt5.4',
          codex: 'codex:gpt-5.3-codex/high',
        },
      },
      { activeProviderId: defaultProviderId },
    );

    expect(selectSelectedModel.select(state, 'codex')).toBe('codex:gpt-5.3-codex/high');
  });

  it('falls back to the UI initial model when no provider default exists', () => {
    const state = mockState({}, { activeProviderId: defaultProviderId });

    expect(selectSelectedModel.select(state)).toBe(MODEL_DEFAULTS.UI_INITIAL_MODEL);
  });
});

describe('selectModelDisplayName', () => {
  const catalogState = () =>
    mockState({
      defaultProviderId,
      availableModels: createCollection<AuggieModel, 'value'>('value', [
        { value: 'sonnet4.6', label: 'Claude Sonnet 4.6' },
        { value: 'codex:gpt-5-codex', label: 'GPT-5 Codex' },
      ]),
    });

  it('resolves a provider-prefixed catalog entry for a non-default provider', () => {
    expect(selectModelDisplayName.select(catalogState(), 'codex', 'gpt-5-codex')).toBe(
      'GPT-5 Codex',
    );
  });

  it('resolves a bare catalog entry for the default provider', () => {
    expect(selectModelDisplayName.select(catalogState(), defaultProviderId, 'sonnet4.6')).toBe(
      'Claude Sonnet 4.6',
    );
  });

  it('does not resolve a bare entry for a non-default provider', () => {
    expect(selectModelDisplayName.select(catalogState(), 'codex', 'sonnet4.6')).toBeUndefined();
  });

  it('returns undefined for an unknown model', () => {
    expect(
      selectModelDisplayName.select(catalogState(), defaultProviderId, 'unknown-model'),
    ).toBeUndefined();
  });

  it('returns undefined when the model slice is absent', () => {
    expect(
      selectModelDisplayName.select({} as unknown as StoreState, 'codex', 'gpt-5-codex'),
    ).toBeUndefined();
  });
});
