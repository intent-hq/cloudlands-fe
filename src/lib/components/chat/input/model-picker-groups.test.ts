import { describe, expect, it, vi } from 'vitest';

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  const { initialState, providerCatalogLoaded, providerCatalogReducer } =
    await import('$store/renderer/slices/provider-catalog/provider-catalog-slice');
  const { MOCK_PROVIDER_CATALOG } =
    await import('../../../../test/fixtures/provider-catalog.fixture');
  const providerCatalog = providerCatalogReducer(
    initialState,
    providerCatalogLoaded(MOCK_PROVIDER_CATALOG),
  );
  return createAppStoreMockModule({ state: () => ({ providerCatalog }) });
});

import { AUGGIE_LEGACY_GROUP_KEY, buildGroupedModelOptions } from './model-picker-groups';

const baseParams = {
  showDefaultOption: false,
  useDefaultOption: { value: 'default', label: 'Default' },
  effectiveProviderId: 'auggie',
  availableModels: [],
  availableModelsProviderId: 'auggie',
  allProviderLoading: {},
  allProviderErrors: {},
  allProviderWarnings: {},
};

describe('buildGroupedModelOptions legacy models', () => {
  it('keeps current Auggie rows first and adds a nested legacy subgroup', () => {
    const groups = buildGroupedModelOptions({
      ...baseParams,
      enabledProviderIds: ['auggie'],
      allProviderModels: {
        auggie: [
          { value: 'current', label: 'Current', data: {} },
          { value: 'legacy', label: 'Legacy', data: { isLegacyModel: true } },
        ],
      },
    });

    expect(groups.map(({ key }) => key)).toEqual(['auggie', AUGGIE_LEGACY_GROUP_KEY]);
    expect(groups[0]?.options.map(({ value }) => value)).toEqual(['current']);
    expect(groups[1]).toMatchObject({
      key: AUGGIE_LEGACY_GROUP_KEY,
      parentKey: 'auggie',
      label: 'Legacy models',
      options: [{ value: 'legacy' }],
    });
  });

  it('does not create a legacy subgroup for other providers', () => {
    const groups = buildGroupedModelOptions({
      ...baseParams,
      effectiveProviderId: 'codex',
      availableModelsProviderId: 'codex',
      enabledProviderIds: ['codex'],
      allProviderModels: {
        codex: [{ value: 'codex:old', label: 'Old', data: { isLegacyModel: true } }],
      },
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: 'codex', options: [{ value: 'codex:old' }] });
  });
});

describe('buildGroupedModelOptions default pseudo-row filtering', () => {
  it('drops a default pseudo-row served alongside real rows', () => {
    const groups = buildGroupedModelOptions({
      ...baseParams,
      enabledProviderIds: ['auggie'],
      allProviderModels: {
        auggie: [
          { value: 'auggie:default', label: 'Default (recommended)' },
          { value: 'auggie:sonnet', label: 'Sonnet' },
        ],
      },
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.options.map(({ value }) => value)).toEqual(['auggie:sonnet']);
  });

  it('keeps a sole default pseudo-row so the group is never empty (D1)', () => {
    const groups = buildGroupedModelOptions({
      ...baseParams,
      enabledProviderIds: ['auggie'],
      allProviderModels: {
        auggie: [{ value: 'auggie:default', label: 'Default (recommended)' }],
      },
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.options.map(({ value }) => value)).toEqual(['auggie:default']);
  });
});

describe('buildGroupedModelOptions disabled effective provider (intent#5737)', () => {
  const auggieModels = [{ value: 'sonnet4.6', label: 'Sonnet 4.6' }];
  const disabledEffectiveParams = {
    ...baseParams,
    effectiveProviderId: 'auggie',
    availableModels: auggieModels,
    availableModelsProviderId: 'auggie',
    enabledProviderIds: ['codex'],
    allProviderModels: { codex: [{ value: 'gpt-5.4', label: 'GPT 5.4' }] },
  };

  it('keeps the unavailable effective provider group when it is not disabled in settings', () => {
    const groups = buildGroupedModelOptions(disabledEffectiveParams);

    expect(groups.map(({ key }) => key)).toEqual(['auggie', 'codex']);
    expect(groups[0]?.options.map(({ value }) => value)).toEqual(['sonnet4.6']);
  });

  it('drops the effective provider group when it was disabled in settings', () => {
    const groups = buildGroupedModelOptions({
      ...disabledEffectiveParams,
      effectiveProviderDisabled: true,
    });

    expect(groups.map(({ key }) => key)).toEqual(['codex']);
  });

  it('leaves an enabled effective provider unchanged by the flag', () => {
    const groups = buildGroupedModelOptions({
      ...disabledEffectiveParams,
      enabledProviderIds: ['auggie', 'codex'],
      allProviderModels: {
        auggie: auggieModels,
        codex: [{ value: 'gpt-5.4', label: 'GPT 5.4' }],
      },
      effectiveProviderDisabled: true,
    });

    expect(groups.map(({ key }) => key)).toEqual(['auggie', 'codex']);
  });
});
