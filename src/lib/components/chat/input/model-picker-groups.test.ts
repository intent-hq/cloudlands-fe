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
