import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type { AuggieModel } from '$features/auggie/auggie-models.client';
import type { DropdownOption } from '$lib/components/ui/dropdown';

// The picker utils normalize provider ids via the providerCatalog slice —
// provide a hydrated §5.38-shaped mock state instead of booting the full store.
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import(
    '$store/renderer/utils/test-helpers/store-mock'
  );
  const { initialState, providerCatalogLoaded, providerCatalogReducer } = await import(
    '$store/renderer/slices/provider-catalog/provider-catalog-slice'
  );
  const { MOCK_PROVIDER_CATALOG } = await import(
    '../../../../test/fixtures/provider-catalog.fixture'
  );
  const providerCatalog = providerCatalogReducer(
    initialState,
    providerCatalogLoaded(MOCK_PROVIDER_CATALOG),
  );
  return createAppStoreMockModule({ state: () => ({ providerCatalog }) });
});

import { findModelFallbackOption, isUserProviderSettled } from './model-picker-utils';

const sampleModel: AuggieModel = { value: 'auggie:sonnet4.6', label: 'Sonnet 4.6' };
const sampleDropdownOption: DropdownOption = {
  value: 'auggie:sonnet4.6',
  label: 'Sonnet 4.6',
  description: 'A model',
};

describe('isUserProviderSettled', () => {
  it('returns false while a disabled agent provider fetch is still pending', () => {
    const result = isUserProviderSettled({
      agentProviderModels: null,
      agentProviderError: null,
      enabledProviderIds: ['codex'],
      allProviderModels: { codex: [sampleDropdownOption] },
      modelProvider: 'auggie',
    });
    expect(result).toBe(false);
  });

  it('returns true when a disabled agent provider has loaded', () => {
    const result = isUserProviderSettled({
      agentProviderModels: [sampleModel],
      agentProviderError: null,
      enabledProviderIds: ['codex'],
      allProviderModels: {},
      modelProvider: 'auggie',
    });
    expect(result).toBe(true);
  });

  it('returns true when the disabled agent-provider fetch errored', () => {
    const result = isUserProviderSettled({
      agentProviderModels: null,
      agentProviderError: 'network blew up',
      enabledProviderIds: ['codex'],
      allProviderModels: {},
      modelProvider: 'auggie',
    });
    expect(result).toBe(true);
  });

  it('returns true when a disabled agent provider definitively returns no models', () => {
    const result = isUserProviderSettled({
      agentProviderModels: [],
      agentProviderError: null,
      enabledProviderIds: ['codex'],
      allProviderModels: { codex: [sampleDropdownOption] },
      modelProvider: 'auggie',
    });
    expect(result).toBe(true);
  });

  it('returns false when the enabled provider has no models yet', () => {
    const emptyResult = isUserProviderSettled({
      agentProviderModels: null,
      agentProviderError: null,
      enabledProviderIds: ['auggie'],
      allProviderModels: { auggie: [] },
      modelProvider: 'auggie',
    });
    expect(emptyResult).toBe(false);

    const missingResult = isUserProviderSettled({
      agentProviderModels: null,
      agentProviderError: null,
      enabledProviderIds: ['auggie'],
      allProviderModels: {},
      modelProvider: 'auggie',
    });
    expect(missingResult).toBe(false);
  });

  it('returns true when the enabled provider has loaded ≥1 model', () => {
    const result = isUserProviderSettled({
      agentProviderModels: null,
      agentProviderError: null,
      enabledProviderIds: ['auggie'],
      allProviderModels: { auggie: [sampleDropdownOption] },
      modelProvider: 'auggie',
    });
    expect(result).toBe(true);
  });

  it('normalizes raw enabled provider ids through the catalog before checking membership', () => {
    // 'acp' is an alias that the catalog lookup resolves to the default
    // provider ('auggie'). Passing the raw alias must still recognize the
    // provider as enabled so the helper evaluates settledness, not treat it
    // as "not enabled".
    const result = isUserProviderSettled({
      agentProviderModels: null,
      agentProviderError: null,
      enabledProviderIds: ['acp'],
      allProviderModels: { auggie: [] },
      modelProvider: 'auggie',
    });
    expect(result).toBe(false);
  });
});

describe('findModelFallbackOption', () => {
  const option = (value: string, isDefault = false): DropdownOption => ({
    value,
    label: value,
    data: { isDefault },
  });

  it("prefers the user's globally selected model over the CLI-marked default", () => {
    // Coordinator ruling (spec Decisions): the CLI-marked default is a
    // *default*, not an override — the user's explicit global pick wins.
    const options = [option('auggie:a'), option('auggie:cli-default', true), option('auggie:b')];
    const result = findModelFallbackOption({
      options,
      globallySelectedModel: 'auggie:b',
    });
    expect(result?.value).toBe('auggie:b');
  });

  it('falls back to the CLI-marked default when the global pick is absent', () => {
    const options = [option('auggie:a'), option('auggie:cli-default', true)];
    const result = findModelFallbackOption({
      options,
      globallySelectedModel: 'auggie:not-listed',
    });
    expect(result?.value).toBe('auggie:cli-default');
  });

  it('falls back to the first available option when neither resolves', () => {
    const options = [option('auggie:a'), option('auggie:b')];
    const result = findModelFallbackOption({ options, globallySelectedModel: null });
    expect(result?.value).toBe('auggie:a');
  });

  it('excludes the sentinel and respects restrictToProvider before resolving', () => {
    const options = [
      option('use-default'),
      option('codex:x', true),
      option('auggie:cli-default', true),
      option('auggie:y'),
    ];
    const result = findModelFallbackOption({
      options,
      excludeValue: 'use-default',
      restrictToProvider: 'auggie',
      globallySelectedModel: 'codex:x',
    });
    // codex:x is filtered out by the provider restriction, so the in-provider
    // CLI default wins over first-available.
    expect(result?.value).toBe('auggie:cli-default');
  });
});
