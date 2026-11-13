import { describe, expect, it } from 'vitest';

import { providerNotEnabledFromError, specialistPinnedProvider } from './proposal-pinned-provider';

describe('specialistPinnedProvider', () => {
  it("returns the agent's own provider, and nothing for an unpinned agent or General", () => {
    const specialists = [
      { id: 'implementor', codingAgent: 'auggie' },
      { id: 'ui-designer', codingAgent: '' },
    ];
    expect(specialistPinnedProvider(specialists, 'implementor')).toBe('auggie');
    expect(specialistPinnedProvider(specialists, 'ui-designer')).toBeUndefined();
    expect(specialistPinnedProvider(specialists, null)).toBeUndefined();
  });
});

describe('providerNotEnabledFromError', () => {
  it("reads the provider from the daemon's refusal", () => {
    expect(
      providerNotEnabledFromError(
        'workspace.create: provider "auggie" (Auggie) is not enabled — enable it in Settings > Providers, or choose an enabled provider or model.',
      ),
    ).toBe('auggie');
  });

  it('recognizes the refusal without a provider id, and ignores other errors', () => {
    expect(providerNotEnabledFromError('The provider is not enabled')).toBeNull();
    expect(providerNotEnabledFromError("cannot resolve base ref 'main'")).toBeUndefined();
    expect(providerNotEnabledFromError(null)).toBeUndefined();
  });
});
