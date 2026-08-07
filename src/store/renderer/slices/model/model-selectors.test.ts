import {
  describe,
  expect,
  it,
} from 'vitest';
import { initialState as modelInitialState } from './model-slice';
import { initialState as providerSettingsInitialState } from '../provider-settings/provider-settings-slice';
import {
  selectAgentModelEffortLevels,
  selectHasResolvableModel,
  selectModelDisplayName,
  selectModelEffortLevels,
  selectSelectedModel,
} from './model-selectors';
import { createCollection } from '$lib/store-shim/utils/collections/collection-utils';
import type { AuggieModel } from '$features/auggie/auggie-models.client';
import type { ModelState } from './model-types';
import type { ProviderSettingsState } from '../provider-settings/provider-settings-slice';
import type { StoreState } from '../../types';
import type { ProviderStatus } from '../agent-availability/agent-availability-types';

const defaultProviderId = 'auggie';

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

  it('falls back to the catalog default (isDefault row, else first row) when no model is persisted and the active provider is available', () => {
    const availableModels = createCollection<AuggieModel, 'value'>('value', [
      { value: 'opus4.7', label: 'Claude Opus 4.7' },
      { value: 'sonnet4.5', label: 'Claude Sonnet 4.5', isDefault: true },
      { value: 'codex:gpt-5-codex', label: 'GPT-5 Codex' },
    ]);
    const state = mockState(
      { availableModels, defaultProviderId },
      { activeProviderId: defaultProviderId, enabledProviders: {} },
      { [defaultProviderId]: { available: true } },
    );

    // The CLI-marked default row wins over the first row.
    expect(selectSelectedModel.select(state)).toBe('sonnet4.5');

    const noDefaultMarked = mockState(
      {
        availableModels: createCollection<AuggieModel, 'value'>('value', [
          { value: 'opus4.7', label: 'Claude Opus 4.7' },
          { value: 'sonnet4.5', label: 'Claude Sonnet 4.5' },
        ]),
        defaultProviderId,
      },
      { activeProviderId: defaultProviderId, enabledProviders: {} },
      { [defaultProviderId]: { available: true } },
    );

    // No marked default → the first available row.
    expect(selectSelectedModel.select(noDefaultMarked)).toBe('opus4.7');
  });

  it('does not fabricate a default when the active provider is unavailable', () => {
    const state = mockState(
      {},
      { activeProviderId: defaultProviderId, enabledProviders: {} },
      { [defaultProviderId]: { available: false } },
    );

    expect(selectSelectedModel.select(state)).toBe('');
  });

  it('does not fabricate a default when the active provider has not been checked', () => {
    const state = mockState({}, { activeProviderId: defaultProviderId, enabledProviders: {} });

    expect(selectSelectedModel.select(state)).toBe('');
  });
});

describe('selectHasResolvableModel', () => {
  it('is true when the active provider is available and has catalog rows', () => {
    const state = mockState(
      {
        availableModels: createCollection<AuggieModel, 'value'>('value', [
          { value: 'opus4.7', label: 'Claude Opus 4.7' },
        ]),
        defaultProviderId,
      },
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

describe('selectModelEffortLevels', () => {
  const efforts = ['low', 'medium', 'high', 'xhigh'];
  const catalogState = () =>
    mockState({
      defaultProviderId,
      availableModels: createCollection<AuggieModel, 'value'>('value', [
        { value: 'sonnet4.6', label: 'Claude Sonnet 4.6' },
        { value: 'codex:gpt-5.3-codex', label: 'GPT-5.3 Codex', effortLevels: efforts },
        { value: 'opus4.7', label: 'Claude Opus 4.7', effortLevels: ['low', 'high'] },
      ]),
    });

  it('returns effortLevels for a catalog row that carries them', () => {
    expect(selectModelEffortLevels.select(catalogState(), 'codex:gpt-5.3-codex')).toEqual(efforts);
    expect(selectModelEffortLevels.select(catalogState(), 'opus4.7')).toEqual(['low', 'high']);
  });

  it('returns undefined for models without effort support or unknown ids', () => {
    expect(selectModelEffortLevels.select(catalogState(), 'sonnet4.6')).toBeUndefined();
    expect(selectModelEffortLevels.select(catalogState(), 'unknown-model')).toBeUndefined();
    expect(selectModelEffortLevels.select(catalogState(), undefined)).toBeUndefined();
    expect(selectModelEffortLevels.select(catalogState(), null)).toBeUndefined();
  });

  it('strips a legacy codex compound {model}/{effort} suffix before the lookup', () => {
    expect(selectModelEffortLevels.select(catalogState(), 'codex:gpt-5.3-codex/xhigh')).toEqual(
      efforts,
    );
  });

  it('falls back to the default-provider prefixed row for a bare session model id', () => {
    const state = mockState({
      defaultProviderId,
      availableModels: createCollection<AuggieModel, 'value'>('value', [
        { value: `${defaultProviderId}:sonnet4.6`, label: 'Claude Sonnet 4.6', effortLevels: efforts },
      ]),
    });
    expect(selectModelEffortLevels.select(state, 'sonnet4.6')).toEqual(efforts);
  });

  it('returns undefined when the model slice is absent', () => {
    expect(
      selectModelEffortLevels.select({} as unknown as StoreState, 'sonnet4.6'),
    ).toBeUndefined();
  });
});

describe('selectAgentModelEffortLevels', () => {
  it('resolves effort levels from the agent session model', () => {
    const base = mockState({
      defaultProviderId,
      availableModels: createCollection<AuggieModel, 'value'>('value', [
        { value: 'codex:gpt-5.3-codex', label: 'GPT-5.3 Codex', effortLevels: ['low', 'high'] },
      ]),
    });
    const state = {
      ...base,
      agentSessions: {
        byAgentId: {
          a1: { id: 'a1', workspaceId: 'ws-1', model: 'codex:gpt-5.3-codex' },
          a2: { id: 'a2', workspaceId: 'ws-1' },
        },
        agentIdsByWorkspace: {},
      },
    } as unknown as StoreState;

    expect(selectAgentModelEffortLevels.select(state, 'a1')).toEqual(['low', 'high']);
    // No model on the session (provider default) / unknown agent → undefined.
    expect(selectAgentModelEffortLevels.select(state, 'a2')).toBeUndefined();
    expect(selectAgentModelEffortLevels.select(state, 'unknown')).toBeUndefined();
  });
});
