import { describe, expect, it } from 'vitest';

import { MOCK_PROVIDER_CATALOG } from '../../../test/fixtures/provider-catalog.fixture';

import { resolveSubmitProvider } from '../effective-model-resolution';

const defaultProviderId = MOCK_PROVIDER_CATALOG.defaultProviderId;

// Default-model resolution is daemon-owned (PROTOCOL §5.11); the former
// client-side resolution helpers were removed. Only the submit-provider
// derivation (explicit user picks only) remains client-side.
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
