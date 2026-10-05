import { describe, expect, it } from 'vitest';
import { initialState as modelInitialState } from './model-slice';
import { initialState as providerSettingsInitialState } from '../provider-settings/provider-settings-slice';
import {
  selectAgentModelEffortLevels,
  selectHasResolvableModel,
  selectHasResolvableProvider,
  selectModelDisplayName,
  selectModelEffortLevels,
  selectProviderModelEffortLevels,
  selectSelectedModel,
} from './model-selectors';
import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import type { AuggieModel } from '$features/auggie/auggie-models.client';
import type { ModelState } from './model-types';
import type { ProviderSettingsState } from '../provider-settings/provider-settings-slice';
import type { StoreState } from '../../types';
import type { ProviderStatus } from '../agent-availability/agent-availability-types';

const defaultProviderId = 'auggie';

function mockState(
  model: Partial<ModelState> = {},
  // `activeProviderId` seeds `model.defaultProviderId` — the default provider
  // lives in the model slice now that `providers.active` is retired.
  providerSettings: Partial<ProviderSettingsState> & { activeProviderId?: string } = {},
  providerStatusMap: Record<string, ProviderStatus> = {},
): StoreState {
  const { activeProviderId, ...settings } = providerSettings;
  return {
    model: {
      ...modelInitialState,
      ...(activeProviderId !== undefined ? { defaultProviderId: activeProviderId } : {}),
      ...model,
    },
    providerSettings: { ...providerSettingsInitialState, ...settings },
    providerCatalog: {
      providers: createCollection('id'),
      loaded: false,
      byWorkspaceId: {
        'ws-1': {
          catalog: { providers: [] },
          settings: [
            {
              path: 'model.defaultProvider',
              value: model.defaultProviderId ?? activeProviderId ?? 'auggie',
            },
            { path: 'model.providerDefaults', value: model.providerModels ?? {} },
          ],
          specialists: [],
          readiness: {},
        },
      },
    },
    providerModels: {
      byProviderId: {},
      clearEpoch: 0,
      byWorkspaceId: {
        'ws-1': {
          [model.availableModelsProviderId ?? activeProviderId ?? 'auggie']: {
            models: Object.values(model.availableModels?.map ?? {}),
            fetchedAt: '2026-09-28T00:00:00Z',
          },
        },
      },
    },
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

  it('keeps an explicit model absent from a partial provider catalog', () => {
    const providerId = 'claude-code';
    const availableModels = createCollection<AuggieModel, 'value'>('value', [
      { value: 'claude-opus-4-1', label: 'Claude Opus 4.1' },
      { value: 'claude-fable-5[1m]', label: 'Claude Fable 5', isDefault: true },
    ]);
    const state = mockState(
      {
        availableModels,
        availableModelsProviderId: providerId,
        providerModels: { [providerId]: 'fable-5' },
        defaultProviderId: providerId,
      },
      { activeProviderId: providerId, enabledProviders: {} },
      { [providerId]: { available: true } },
    );

    expect(selectSelectedModel.select(state)).toBe('fable-5');
  });

  it('keeps the persisted model when the catalog was loaded for another provider', () => {
    // Provenance gate: availableModelsProviderId names the provider the
    // catalog rows belong to — a foreign catalog never validates (or
    // replaces) another provider's persisted pick.
    const providerId = 'claude-code';
    const state = mockState(
      {
        availableModels: createCollection<AuggieModel, 'value'>('value', [
          { value: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', isDefault: true },
        ]),
        availableModelsProviderId: 'codex',
        providerModels: { [providerId]: 'fable-5' },
        defaultProviderId: providerId,
      },
      { activeProviderId: providerId },
    );

    expect(selectSelectedModel.select(state)).toBe('fable-5');
  });

  it('preserves a valid provider-specific Claude Code model ID', () => {
    const providerId = 'claude-code';
    const model = 'claude-fable-5[1m]';
    const state = mockState(
      {
        availableModels: createCollection<AuggieModel, 'value'>('value', [
          { value: model, label: 'Claude Fable 5', isDefault: true },
        ]),
        availableModelsProviderId: providerId,
        providerModels: { [providerId]: model },
        defaultProviderId: providerId,
      },
      { activeProviderId: providerId },
    );

    expect(selectSelectedModel.select(state)).toBe(model);
  });

  it('keeps the persisted model while the active provider catalog is cold', () => {
    const providerId = 'claude-code';
    const state = mockState(
      {
        providerModels: { [providerId]: 'fable-5' },
        defaultProviderId: providerId,
      },
      { activeProviderId: providerId },
    );

    expect(selectSelectedModel.select(state)).toBe('fable-5');
  });

  it('falls back to the catalog default (isDefault row, else first row) when no model is persisted and the active provider is available', () => {
    const availableModels = createCollection<AuggieModel, 'value'>('value', [
      { value: 'opus4.7', label: 'Claude Opus 4.7' },
      { value: 'sonnet4.5', label: 'Claude Sonnet 4.5', isDefault: true },
    ]);
    const state = mockState(
      { availableModels, availableModelsProviderId: defaultProviderId, defaultProviderId },
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
        availableModelsProviderId: defaultProviderId,
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
        availableModelsProviderId: defaultProviderId,
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

describe('selectHasResolvableProvider', () => {
  it('is false on a fresh backend with no active provider and no model', () => {
    const state = mockState({}, { activeProviderId: '' });

    expect(selectHasResolvableProvider.select(state)).toBe(false);
  });

  it('is true once an active provider is configured, even before models load', () => {
    const state = mockState({}, { activeProviderId: defaultProviderId, enabledProviders: {} });

    expect(selectHasResolvableProvider.select(state)).toBe(true);
  });

  it('is true when a model is resolvable', () => {
    const state = mockState(
      {
        availableModels: createCollection<AuggieModel, 'value'>('value', [
          { value: 'opus4.7', label: 'Claude Opus 4.7' },
        ]),
        availableModelsProviderId: defaultProviderId,
        defaultProviderId,
      },
      { activeProviderId: defaultProviderId, enabledProviders: {} },
      { [defaultProviderId]: { available: true } },
    );

    expect(selectHasResolvableProvider.select(state)).toBe(true);
  });
});

describe('selectModelDisplayName', () => {
  const catalogState = () =>
    mockState({
      defaultProviderId,
      availableModelsProviderId: defaultProviderId,
      availableModels: createCollection<AuggieModel, 'value'>('value', [
        { value: 'sonnet4.6', label: 'Claude Sonnet 4.6' },
      ]),
    });

  it('resolves a bare catalog entry for the provider the catalog was loaded for', () => {
    expect(selectModelDisplayName.select(catalogState(), defaultProviderId, 'sonnet4.6')).toBe(
      'Claude Sonnet 4.6',
    );
  });

  it('strips a legacy compound prefix from the model id before the lookup', () => {
    expect(
      selectModelDisplayName.select(catalogState(), defaultProviderId, 'auggie:sonnet4.6'),
    ).toBe('Claude Sonnet 4.6');
  });

  it('does not resolve an entry for a provider the catalog was not loaded for', () => {
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
        { value: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', effortLevels: efforts },
        { value: 'opus4.7', label: 'Claude Opus 4.7', effortLevels: ['low', 'high'] },
      ]),
    });

  it('returns effortLevels for a catalog row that carries them', () => {
    expect(selectModelEffortLevels.select(catalogState(), 'gpt-5.3-codex')).toEqual(efforts);
    expect(selectModelEffortLevels.select(catalogState(), 'opus4.7')).toEqual(['low', 'high']);
  });

  it('returns undefined for models without effort support or unknown ids', () => {
    expect(selectModelEffortLevels.select(catalogState(), 'sonnet4.6')).toBeUndefined();
    expect(selectModelEffortLevels.select(catalogState(), 'unknown-model')).toBeUndefined();
    expect(selectModelEffortLevels.select(catalogState(), undefined)).toBeUndefined();
    expect(selectModelEffortLevels.select(catalogState(), null)).toBeUndefined();
  });

  it('strips legacy compound prefixes and {model}/{effort} suffixes before the lookup', () => {
    expect(selectModelEffortLevels.select(catalogState(), 'codex:gpt-5.3-codex')).toEqual(efforts);
    expect(selectModelEffortLevels.select(catalogState(), 'codex:gpt-5.3-codex/xhigh')).toEqual(
      efforts,
    );
    expect(selectModelEffortLevels.select(catalogState(), 'gpt-5.3-codex/high')).toEqual(efforts);
  });

  it('returns undefined when the model slice is absent', () => {
    expect(
      selectModelEffortLevels.select({} as unknown as StoreState, 'sonnet4.6'),
    ).toBeUndefined();
  });
});

describe('selectProviderModelEffortLevels', () => {
  const codexEfforts = ['low', 'medium', 'high'];
  const stateWithCache = () => {
    const base = mockState({
      defaultProviderId,
      availableModelsProviderId: defaultProviderId,
      availableModels: createCollection<AuggieModel, 'value'>('value', [
        { value: 'gpt5.6-sol', label: 'GPT-5.6 Sol', effortLevels: ['low', 'max'] },
      ]),
    });
    return {
      ...base,
      providerModels: {
        byProviderId: {
          codex: {
            models: [
              { value: 'codex:gpt-5.3-codex', label: 'GPT-5.3 Codex', effortLevels: codexEfforts },
              { value: 'codex:gpt-5.2', label: 'GPT-5.2' },
            ],
            fetchedAt: '2026-01-01T00:00:00.000Z',
          },
        },
        clearEpoch: 0,
      },
    } as unknown as StoreState;
  };

  it('resolves the active catalog when the provider matches its provenance', () => {
    expect(
      selectProviderModelEffortLevels.select(stateWithCache(), defaultProviderId, 'gpt5.6-sol'),
    ).toEqual(['low', 'max']);
  });

  it('resolves another provider through the provider-models cache (compound rows)', () => {
    expect(
      selectProviderModelEffortLevels.select(stateWithCache(), 'codex', 'gpt-5.3-codex'),
    ).toEqual(codexEfforts);
    // A {model}/{effort} suffix strips before the cache match.
    expect(
      selectProviderModelEffortLevels.select(stateWithCache(), 'codex', 'gpt-5.3-codex/high'),
    ).toEqual(codexEfforts);
  });

  it('does not resolve a cross-provider model against the active catalog', () => {
    expect(
      selectProviderModelEffortLevels.select(stateWithCache(), 'codex', 'gpt5.6-sol'),
    ).toBeUndefined();
  });

  it('falls back to the bare-id active-catalog lookup when no provider is given', () => {
    expect(
      selectProviderModelEffortLevels.select(stateWithCache(), undefined, 'gpt5.6-sol'),
    ).toEqual(['low', 'max']);
  });

  it('returns undefined for unknown providers/models, effort-less rows, or absent slices', () => {
    expect(
      selectProviderModelEffortLevels.select(stateWithCache(), 'unknown', 'gpt-5.3-codex'),
    ).toBeUndefined();
    expect(
      selectProviderModelEffortLevels.select(stateWithCache(), 'codex', 'gpt-5.2'),
    ).toBeUndefined();
    expect(
      selectProviderModelEffortLevels.select(stateWithCache(), 'codex', undefined),
    ).toBeUndefined();
    expect(
      selectProviderModelEffortLevels.select({} as unknown as StoreState, 'codex', 'gpt-5.3-codex'),
    ).toBeUndefined();
  });
});

describe('selectAgentModelEffortLevels', () => {
  it('inherits defaults from its own workspace instead of direct settings', () => {
    const state = mockState({ defaultProviderId: 'auggie', providerModels: { auggie: 'local' } });
    state.providerCatalog = {
      providers: createCollection('id'),
      loaded: false,
      byWorkspaceId: {
        A: {
          catalog: { providers: [] },
          settings: [
            { path: 'model.defaultProvider', value: 'codex' },
            { path: 'model.providerDefaults', value: { codex: 'remote' } },
          ],
          specialists: [],
          readiness: {},
        },
      },
    } as StoreState['providerCatalog'];
    state.providerModels.byWorkspaceId = {
      A: {
        codex: {
          models: [{ value: 'remote', label: 'Remote', effortLevels: ['high'] }],
          fetchedAt: '2026-09-28T00:00:00Z',
        },
      },
    };
    state.agentSessions = {
      byAgentId: { a: { id: 'a', workspaceId: 'A' } },
      agentIdsByWorkspace: {},
    } as unknown as StoreState['agentSessions'];
    expect(selectAgentModelEffortLevels.select(state, 'a')).toEqual(['high']);
  });

  it('resolves effort levels from the agent session model', () => {
    const base = mockState({
      defaultProviderId,
      availableModelsProviderId: 'codex',
      availableModels: createCollection<AuggieModel, 'value'>('value', [
        { value: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', effortLevels: ['low', 'high'] },
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
    // No resolvable provider default / unknown agent → undefined.
    expect(selectAgentModelEffortLevels.select(state, 'a2')).toBeUndefined();
    expect(selectAgentModelEffortLevels.select(state, 'unknown')).toBeUndefined();
  });

  it('resolves effort levels from the provider model when the session inherits its model', () => {
    const base = mockState({
      defaultProviderId,
      providerModels: { auggie: 'gpt5.6-sol' },
      availableModelsProviderId: 'auggie',
      availableModels: createCollection<AuggieModel, 'value'>('value', [
        {
          value: 'gpt5.6-sol',
          label: 'GPT-5.6 Sol',
          effortLevels: ['low', 'medium', 'high', 'max'],
        },
      ]),
    });
    const state = {
      ...base,
      agentSessions: {
        byAgentId: {
          inherited: { id: 'inherited', workspaceId: 'ws-1', provider: 'auggie', model: null },
        },
        agentIdsByWorkspace: {},
      },
    } as unknown as StoreState;

    expect(selectAgentModelEffortLevels.select(state, 'inherited')).toEqual([
      'low',
      'medium',
      'high',
      'max',
    ]);
  });

  it('prefers the session-advertised effortLevels over the catalog metadata (§5.5)', () => {
    // The daemon-discovered `thought_level` levels win even when the catalog
    // row carries its own (possibly stale) static effortLevels.
    const base = mockState({
      defaultProviderId,
      availableModelsProviderId: 'codex',
      availableModels: createCollection<AuggieModel, 'value'>('value', [
        { value: 'codex:gpt-5.3-codex', label: 'GPT-5.3 Codex', effortLevels: ['low', 'high'] },
      ]),
    });
    const state = {
      ...base,
      agentSessions: {
        byAgentId: {
          a1: {
            id: 'a1',
            workspaceId: 'ws-1',
            model: 'codex:gpt-5.3-codex',
            effortLevels: ['minimal', 'low', 'medium', 'high', 'xhigh'],
          },
        },
        agentIdsByWorkspace: {},
      },
    } as unknown as StoreState;

    expect(selectAgentModelEffortLevels.select(state, 'a1')).toEqual([
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
    ]);
  });

  it('resolves session-advertised effortLevels for a model absent from the catalog (claude-code case)', () => {
    // claude-code models have no catalog effortLevels; the picker gates purely
    // on what the session discovered at open.
    const base = mockState({
      defaultProviderId,
      availableModelsProviderId: 'codex',
      availableModels: createCollection<AuggieModel, 'value'>('value', [
        { value: 'claude-code:opus', label: 'Claude Opus' },
      ]),
    });
    const state = {
      ...base,
      agentSessions: {
        byAgentId: {
          a1: {
            id: 'a1',
            workspaceId: 'ws-1',
            model: 'claude-code:opus',
            effortLevels: ['low', 'medium', 'high', 'max'],
          },
        },
        agentIdsByWorkspace: {},
      },
    } as unknown as StoreState;

    expect(selectAgentModelEffortLevels.select(state, 'a1')).toEqual([
      'low',
      'medium',
      'high',
      'max',
    ]);
  });

  it('falls back to the catalog when the session effortLevels are absent or empty', () => {
    const base = mockState({
      defaultProviderId,
      availableModelsProviderId: 'codex',
      availableModels: createCollection<AuggieModel, 'value'>('value', [
        { value: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', effortLevels: ['low', 'high'] },
      ]),
    });
    const state = {
      ...base,
      agentSessions: {
        byAgentId: {
          absent: { id: 'absent', workspaceId: 'ws-1', model: 'codex:gpt-5.3-codex' },
          empty: {
            id: 'empty',
            workspaceId: 'ws-1',
            model: 'codex:gpt-5.3-codex',
            effortLevels: [],
          },
        },
        agentIdsByWorkspace: {},
      },
    } as unknown as StoreState;

    expect(selectAgentModelEffortLevels.select(state, 'absent')).toEqual(['low', 'high']);
    expect(selectAgentModelEffortLevels.select(state, 'empty')).toEqual(['low', 'high']);
  });
});

it.each(['acp', 'default', 'augment'])(
  'normalizes inherited %s against each workspace catalog',
  (alias) => {
    const state = mockState();
    const scoped = (provider: string) => ({
      catalog: { providers: [{ id: provider, legacyAliases: [alias] }] },
      settings: [
        { path: 'model.defaultProvider', value: provider },
        { path: 'model.providerDefaults', value: { [provider]: 'same-model' } },
      ],
      specialists: [],
      readiness: {},
    });
    state.providerCatalog.byWorkspaceId = {
      A: scoped('auggie'),
      B: scoped('codex'),
    } as unknown as NonNullable<StoreState['providerCatalog']['byWorkspaceId']>;
    state.providerModels.byWorkspaceId = {
      A: {
        auggie: {
          models: [{ value: 'same-model', label: 'A', effortLevels: ['low', 'high'] }],
          fetchedAt: 'now',
        },
      },
      B: {
        codex: {
          models: [{ value: 'same-model', label: 'B', effortLevels: ['medium', 'max'] }],
          fetchedAt: 'now',
        },
      },
    };
    state.agentSessions = {
      byAgentId: {
        a: { id: 'a', workspaceId: 'A', provider: alias, model: null },
        b: { id: 'b', workspaceId: 'B', provider: alias, model: null },
      },
    } as unknown as StoreState['agentSessions'];
    expect(selectAgentModelEffortLevels.select(state, 'a')).toEqual(['low', 'high']);
    expect(selectAgentModelEffortLevels.select(state, 'b')).toEqual(['medium', 'max']);
  },
);

describe('learned model display names', () => {
  function learnedState() {
    const state = mockState();
    state.providerModels.learnedNames = {
      codex: {
        shared: 'Remembered Codex',
        'org/model:variant': 'Custom identity',
        org: 'Wrong base',
      },
      auggie: { shared: 'Remembered Auggie' },
    };
    return state;
  }

  it('resolves learned names without live catalogs and keeps provider identities separate', () => {
    const state = learnedState();
    expect(selectModelDisplayName.select(state, 'codex', 'shared')).toBe('Remembered Codex');
    expect(selectModelDisplayName.select(state, 'auggie', 'shared', 'ws-1')).toBe(
      'Remembered Auggie',
    );
    expect(selectModelDisplayName.select(state, 'codex', 'never-seen')).toBeUndefined();
    expect(selectProviderModelEffortLevels.select(state, 'codex', 'shared')).toBeUndefined();
    expect(selectHasResolvableModel.select(state, 'codex')).toBe(false);
  });

  it('preserves full slash/colon identities and only formats recognized legacy effort suffixes', () => {
    const state = learnedState();
    expect(selectModelDisplayName.select(state, 'codex', 'org/model:variant')).toBe(
      'Custom identity',
    );
    expect(selectModelDisplayName.select(state, 'codex', 'org/unknown')).toBeUndefined();
    expect(selectModelDisplayName.select(state, 'codex', 'codex:shared/high')).toBe(
      'Remembered Codex (High)',
    );
    state.providerModels.learnedNames.codex['shared/high'] = 'Exact slash model';
    expect(selectModelDisplayName.select(state, 'codex', 'shared/high')).toBe('Exact slash model');
  });

  it('normalizes advertised provider aliases and their legacy prefixes', () => {
    const state = learnedState();
    state.providerCatalog.providers = createCollection('id', [
      { id: 'codex', legacyAliases: ['old-codex'] },
    ] as never);
    expect(selectModelDisplayName.select(state, 'old-codex', 'old-codex:shared')).toBe(
      'Remembered Codex',
    );
  });

  it('prefers live labels in the requested scope, including legacy effort base labels', () => {
    const state = learnedState();
    state.model.availableModelsProviderId = 'codex';
    state.model.availableModels = createCollection('value', [
      { value: 'shared', label: 'Active name' },
    ]);
    state.providerModels.learnedNames.codex['shared/high'] = 'Old effort name';
    state.providerModels.byWorkspaceId = {
      'ws-1': { codex: { models: [{ value: 'shared', label: 'Workspace name' }], fetchedAt: '' } },
    };
    expect(selectModelDisplayName.select(state, 'codex', 'shared')).toBe('Active name');
    expect(selectModelDisplayName.select(state, 'codex', 'shared/high')).toBe('Active name (High)');
    expect(selectModelDisplayName.select(state, 'codex', 'shared', 'ws-1')).toBe('Workspace name');
    expect(selectModelDisplayName.select(state, 'codex', 'shared', 'ws-2')).toBe(
      'Remembered Codex',
    );
  });
});
