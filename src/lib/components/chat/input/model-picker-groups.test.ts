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

  it('drops the disabled effective provider even while the enabled set still names it', () => {
    // The enabled set also carries the active provider, which can still be the
    // disabled one until the daemon re-derives the default.
    const groups = buildGroupedModelOptions({
      ...disabledEffectiveParams,
      enabledProviderIds: ['auggie', 'codex'],
      allProviderModels: {
        auggie: auggieModels,
        codex: [{ value: 'gpt-5.4', label: 'GPT 5.4' }],
      },
      effectiveProviderDisabled: true,
    });

    expect(groups.map(({ key }) => key)).toEqual(['codex']);
  });
});

describe('buildGroupedModelOptions named profiles (§5.54)', () => {
  const work = { providerRef: 'codex@pwork00000001', baseProviderId: 'codex', name: 'Work' };
  const personal = {
    providerRef: 'codex@ppers00000001',
    baseProviderId: 'codex',
    name: 'Personal',
  };
  const gpt = [{ value: 'gpt-5', label: 'GPT-5', data: {} }];

  it('keeps bare provider labels while no profiles exist', () => {
    const groups = buildGroupedModelOptions({
      ...baseParams,
      enabledProviderIds: ['codex'],
      allProviderModels: { codex: gpt },
      profiles: [],
    });
    expect(groups.map(({ key, label }) => [key, label])).toEqual([['codex', 'OpenAI Codex']]);
  });

  it('adds one group per profile after its base, keyed by its reference', () => {
    const groups = buildGroupedModelOptions({
      ...baseParams,
      enabledProviderIds: ['auggie', 'codex', work.providerRef, personal.providerRef],
      allProviderModels: {
        auggie: [{ value: 'sonnet', label: 'Sonnet', data: {} }],
        codex: gpt,
        [work.providerRef]: [{ value: 'gpt-5', label: 'GPT-5', data: {} }],
        [personal.providerRef]: [{ value: 'gpt-5-mini', label: 'GPT-5 mini', data: {} }],
      },
      profiles: [work, personal],
    });

    expect(groups.map(({ key }) => key)).toEqual([
      'auggie',
      'codex',
      work.providerRef,
      personal.providerRef,
    ]);
    const labels = Object.fromEntries(groups.map(({ key, label }) => [key, label]));
    // A provider without profiles keeps its bare catalog name.
    expect(labels.auggie).not.toMatch(/Default|Work|Personal/);
    // Once Codex has profiles its original configuration is "Default".
    expect(labels.codex).toMatch(/OpenAI Codex.*Default/);
    expect(labels[work.providerRef]).toMatch(/OpenAI Codex.*Work/);
    expect(labels[personal.providerRef]).toMatch(/OpenAI Codex.*Personal/);
    // Each profile lists its own catalog, not the base provider's.
    expect(groups[3]?.options.map(({ value }) => value)).toEqual(['gpt-5-mini']);
  });

  it('shows a loading row for a profile whose catalog is still loading', () => {
    const groups = buildGroupedModelOptions({
      ...baseParams,
      enabledProviderIds: ['codex', work.providerRef],
      allProviderModels: { codex: gpt },
      allProviderLoading: { [work.providerRef]: true },
      profiles: [work],
    });
    const group = groups.find(({ key }) => key === work.providerRef);
    expect(group?.label).toMatch(/OpenAI Codex.*Work/);
    expect(group?.options[0]?.data?.providerLoading).toBe(true);
  });

  it('offers no profile group when the profile is not selectable', () => {
    const groups = buildGroupedModelOptions({
      ...baseParams,
      enabledProviderIds: ['codex'],
      allProviderModels: { codex: gpt, [work.providerRef]: gpt },
      profiles: [work],
    });
    expect(groups.map(({ key }) => key)).toEqual(['codex']);
  });
});
