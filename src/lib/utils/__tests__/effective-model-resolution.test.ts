import { describe, expect, it } from 'vitest';

import { MOCK_PROVIDER_CATALOG } from '../../../test/fixtures/provider-catalog.fixture';

import {
  dropCrossProviderFallbackModel,
  resolveEffectiveModelForSpecialist,
  resolveSubmitModel,
  resolveSubmitProvider,
} from '../effective-model-resolution';

const defaultProviderId = MOCK_PROVIDER_CATALOG.defaultProviderId;

function tiersFor(providerId: string) {
  return MOCK_PROVIDER_CATALOG.providers.find((p) => p.id === providerId)?.modelTiers;
}

describe('resolveEffectiveModelForSpecialist', () => {

  it('uses the Redux effective model when the provider matches the specialist coding agent (file specialist)', () => {
    expect(
      resolveEffectiveModelForSpecialist({
        specialistId: 'spec-writer',
        selectedProvider: 'auggie',
        defaultProviderId,
        selectedProviderTiers: tiersFor('auggie'),
        availableModelValues: ['fable-5', 'opus4.7', 'sonnet4.5'],
        globalSelectedModel: 'sonnet4.5',
        effectiveCodingAgent: 'auggie',
        effectiveModel: 'fable-5',
        specialistInfo: { defaultModelTier: 'smart' },
      }),
    ).toBe('fable-5');
  });

  it('falls back to tier resolution when the Redux effective model is not in the available list', () => {
    const expectedTierModel =
      'auggie' !== defaultProviderId
        ? `auggie:${tiersFor('auggie')!.smart}`
        : tiersFor('auggie')!.smart;

    expect(
      resolveEffectiveModelForSpecialist({
        specialistId: 'spec-writer',
        selectedProvider: 'auggie',
        defaultProviderId,
        selectedProviderTiers: tiersFor('auggie'),
        availableModelValues: [expectedTierModel, 'sonnet4.5'],
        globalSelectedModel: 'sonnet4.5',
        effectiveCodingAgent: 'auggie',
        effectiveModel: 'fable-5',
        specialistInfo: { defaultModelTier: 'smart' },
      }),
    ).toBe(expectedTierModel);
  });

  it('resolves the tier against the locally-selected provider when it differs from the specialist coding agent', () => {
    const smartModel = tiersFor('claude-code')!.smart;
    const expectedTierModel =
      'claude-code' !== defaultProviderId ? `claude-code:${smartModel}` : smartModel;

    expect(
      resolveEffectiveModelForSpecialist({
        specialistId: 'implementor',
        selectedProvider: 'claude-code',
        defaultProviderId,
        selectedProviderTiers: tiersFor('claude-code'),
        availableModelValues: [expectedTierModel, 'claude-code:sonnet'],
        globalSelectedModel: undefined,
        effectiveCodingAgent: 'auggie',
        effectiveModel: 'opus4.7',
        specialistInfo: { defaultModelTier: 'smart' },
      }),
    ).toBe(expectedTierModel);
  });

  it('falls back to the specialist defaultModel when the tier-resolved model is unavailable', () => {
    expect(
      resolveEffectiveModelForSpecialist({
        specialistId: 'custom-agent',
        selectedProvider: 'auggie',
        defaultProviderId,
        selectedProviderTiers: tiersFor('auggie'),
        availableModelValues: ['sonnet4.5', 'custom-model'],
        globalSelectedModel: 'sonnet4.5',
        effectiveCodingAgent: 'codex',
        effectiveModel: undefined,
        specialistInfo: { defaultModelTier: 'smart', defaultModel: 'custom-model' },
      }),
    ).toBe('custom-model');
  });

  it('skips a bare (default-provider) defaultModel when a non-default provider is selected', () => {
    expect(
      resolveEffectiveModelForSpecialist({
        specialistId: 'spec-writer',
        selectedProvider: 'claude-code',
        defaultProviderId,
        selectedProviderTiers: tiersFor('claude-code'),
        availableModelValues: ['claude-code:sonnet', 'claude-code:haiku'],
        globalSelectedModel: undefined,
        effectiveCodingAgent: 'auggie',
        effectiveModel: undefined,
        specialistInfo: { defaultModel: 'fable-5' },
      }),
    ).toBe('claude-code:sonnet');
  });

  it('keeps a compound defaultModel that matches the selected provider', () => {
    expect(
      resolveEffectiveModelForSpecialist({
        specialistId: 'custom-agent',
        selectedProvider: 'claude-code',
        defaultProviderId,
        selectedProviderTiers: tiersFor('claude-code'),
        availableModelValues: ['claude-code:sonnet'],
        globalSelectedModel: undefined,
        effectiveCodingAgent: 'auggie',
        effectiveModel: undefined,
        specialistInfo: { defaultModel: 'claude-code:custom' },
      }),
    ).toBe('claude-code:custom');
  });

  it('resolves the preferred default model when no specialist is selected', () => {
    expect(
      resolveEffectiveModelForSpecialist({
        specialistId: null,
        selectedProvider: 'auggie',
        defaultProviderId,
        selectedProviderTiers: tiersFor('auggie'),
        availableModelValues: ['opus4.7', 'sonnet4.5'],
        globalSelectedModel: 'sonnet4.5',
      }),
    ).toBe('sonnet4.5');
  });

  it('returns undefined when no models are available and there is no specialist fallback', () => {
    expect(
      resolveEffectiveModelForSpecialist({
        specialistId: 'spec-writer',
        selectedProvider: 'auggie',
        defaultProviderId,
        selectedProviderTiers: tiersFor('auggie'),
        availableModelValues: [],
        globalSelectedModel: undefined,
        effectiveCodingAgent: 'auggie',
        effectiveModel: 'fable-5',
        specialistInfo: {},
      }),
    ).toBeUndefined();
  });
});

describe('resolveSubmitModel', () => {
  it('lets an explicit user override win over the specialist effective model', () => {
    expect(
      resolveSubmitModel({
        modelWasOverridden: true,
        overriddenModel: 'sonnet4.5',
        specialistId: 'spec-writer',
        selectedProvider: 'auggie',
        defaultProviderId,
        selectedProviderTiers: tiersFor('auggie'),
        availableModelValues: ['fable-5', 'sonnet4.5'],
        globalSelectedModel: 'fable-5',
        effectiveCodingAgent: 'auggie',
        effectiveModel: 'fable-5',
        specialistInfo: { defaultModelTier: 'smart' },
      }),
    ).toBe('sonnet4.5');
  });

  it('uses the displayed effective model when no override is active (file-specialist model on submit)', () => {
    expect(
      resolveSubmitModel({
        modelWasOverridden: false,
        overriddenModel: undefined,
        specialistId: 'spec-writer',
        selectedProvider: 'auggie',
        defaultProviderId,
        selectedProviderTiers: tiersFor('auggie'),
        availableModelValues: ['fable-5', 'sonnet4.5'],
        globalSelectedModel: 'sonnet4.5',
        effectiveCodingAgent: 'auggie',
        effectiveModel: 'fable-5',
        specialistInfo: { defaultModelTier: 'smart' },
      }),
    ).toBe('fable-5');
  });

  it('falls back to specialist resolution when the override flag is set but no model is present (degenerate persisted state)', () => {
    expect(
      resolveSubmitModel({
        modelWasOverridden: true,
        overriddenModel: undefined,
        specialistId: 'spec-writer',
        selectedProvider: 'auggie',
        defaultProviderId,
        selectedProviderTiers: tiersFor('auggie'),
        availableModelValues: ['fable-5', 'sonnet4.5'],
        globalSelectedModel: 'sonnet4.5',
        effectiveCodingAgent: 'auggie',
        effectiveModel: 'fable-5',
        specialistInfo: { defaultModelTier: 'smart' },
      }),
    ).toBe('fable-5');
  });

  it('returns the overridden model even when it is not in the available list (validated by the caller)', () => {
    expect(
      resolveSubmitModel({
        modelWasOverridden: true,
        overriddenModel: 'opus4.6',
        specialistId: null,
        selectedProvider: 'auggie',
        defaultProviderId,
        selectedProviderTiers: tiersFor('auggie'),
        availableModelValues: ['fable-5', 'sonnet4.5'],
        globalSelectedModel: 'sonnet4.5',
      }),
    ).toBe('opus4.6');
  });
});

describe('resolveSubmitProvider', () => {

  it('derives the provider from a compound model prefix', () => {
    expect(resolveSubmitProvider('claude-code:sonnet', 'grok', defaultProviderId)).toBe('claude-code');
  });

  it('resolves a bare model id to the default provider', () => {
    expect(resolveSubmitProvider('fable-5', 'grok', defaultProviderId)).toBe(defaultProviderId);
  });

  it('keeps the selected provider when no model resolved', () => {
    expect(resolveSubmitProvider(undefined, 'grok', defaultProviderId)).toBe('grok');
  });

  it('keeps the selected provider for an empty compound prefix (mirrors the daemon filter)', () => {
    expect(resolveSubmitProvider(':sonnet', 'grok', defaultProviderId)).toBe('grok');
  });
});

describe('dropCrossProviderFallbackModel', () => {

  it('keeps a model owned by the selected provider', () => {
    expect(dropCrossProviderFallbackModel('grok:grok-4', 'grok', defaultProviderId)).toBe('grok:grok-4');
  });

  it('keeps a bare model id when the selected provider is the default provider', () => {
    expect(dropCrossProviderFallbackModel('opus4.7', defaultProviderId, defaultProviderId)).toBe('opus4.7');
  });

  it('drops a bare default-provider model when the selected provider is non-default', () => {
    expect(dropCrossProviderFallbackModel('opus4.7', 'grok', defaultProviderId)).toBeUndefined();
  });

  it('drops a compound model owned by a different provider', () => {
    expect(dropCrossProviderFallbackModel('claude-code:sonnet', 'grok', defaultProviderId)).toBeUndefined();
  });

  it('passes through undefined', () => {
    expect(dropCrossProviderFallbackModel(undefined, 'grok', defaultProviderId)).toBeUndefined();
  });
});
