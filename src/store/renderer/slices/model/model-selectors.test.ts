import {
  describe,
  expect,
  it,
} from 'vitest';
import { MODEL_DEFAULTS } from '$shared/constants/agent-services';
import { MOCK_PROVIDER_CATALOG } from '../../../../test/fixtures/provider-catalog.fixture';
import { initialState as modelInitialState } from './model-slice';
import { initialState as providerSettingsInitialState } from '../provider-settings/provider-settings-slice';
import {
  selectHasResolvableModel,
  selectModelDisplayName,
  selectSelectedModel,
} from './model-selectors';
import { createCollection } from '$lib/store-shim/utils/collections/collection-utils';
import type { AuggieModel } from '$features/auggie/auggie-models.client';
import type { ModelState } from './model-types';
import type { ProviderSettingsState } from '../provider-settings/provider-settings-slice';
import type { StoreState } from '../../types';
import type { ProviderStatus } from '../agent-availability/agent-availability-types';

const defaultProviderId = MOCK_PROVIDER_CATALOG.defaultProviderId;

function mockState(
  model: Partial<ModelState> = {},
  providerSettings: Partial<ProviderSettingsState> = {},
  providerStatusMap: Record<string, ProviderStatus> = {},
): StoreState {
  return {
    model: { ...modelInitialState, ...model },
    providerSettings: { ...providerSettingsInitialState, ...providerSettings },
    agentAvailability: {
      providerStatusMap,
      providerLoadingMap: {},
      providerUserInfoLoadingMap: {},
      hasCheckedOnce: false,
      watchedTerminalIds: [],
      npxStatus: null,
    },
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

  it('returns the persisted model for an available active provider', () => {
    const state = mockState(
      { providerModels: { [defaultProviderId]: 'gpt5.4' } },
      { activeProviderId: defaultProviderId, enabledProviders: {} },
      { [defaultProviderId]: { available: true } },
    );

    expect(selectSelectedModel.select(state)).toBe('gpt5.4');
  });

  it('falls back to UI_INITIAL_MODEL when no model is persisted and the active provider is available', () => {
    const state = mockState(
      {},
      { activeProviderId: defaultProviderId, enabledProviders: {} },
      { [defaultProviderId]: { available: true } },
    );

    expect(selectSelectedModel.select(state)).toBe(MODEL_DEFAULTS.UI_INITIAL_MODEL);
  });

  it('does not fall back to UI_INITIAL_MODEL when the active provider is unavailable', () => {
    const state = mockState(
      {},
      { activeProviderId: defaultProviderId, enabledProviders: {} },
      { [defaultProviderId]: { available: false } },
    );

    expect(selectSelectedModel.select(state)).toBe('');
  });

  it('does not fall back to UI_INITIAL_MODEL when the active provider has not been checked', () => {
    const state = mockState({}, { activeProviderId: defaultProviderId, enabledProviders: {} });

    expect(selectSelectedModel.select(state)).toBe('');
  });
});

describe('selectHasResolvableModel', () => {
  it('is true when the active provider is available', () => {
    const state = mockState(
      {},
      { activeProviderId: defaultProviderId, enabledProviders: {} },
      { [defaultProviderId]: { available: true } },
    );

    expect(selectHasResolvableModel.select(state)).toBe(true);
  });

  it('is false when the active provider is unavailable and nothing is persisted', () => {
    const state = mockState(
      {},
      { activeProviderId: defaultProviderId, enabledProviders: {} },
      { [defaultProviderId]: { available: false } },
    );

    expect(selectHasResolvableModel.select(state)).toBe(false);
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
