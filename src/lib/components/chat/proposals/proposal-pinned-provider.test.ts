import { describe, expect, it, vi } from 'vitest';

// The disabled check normalizes provider ids via the providerCatalog slice.
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => ({}) });
});

import { disabledPinnedProvider, providerNotEnabledFromError } from './proposal-pinned-provider';

const SPECIALISTS = [
  { id: 'implementor', codingAgent: 'auggie' },
  { id: 'ui-designer', codingAgent: '' },
];

describe('disabledPinnedProvider', () => {
  it('reports a pinned provider that is turned off', () => {
    expect(
      disabledPinnedProvider({
        specialistId: 'implementor',
        specialists: SPECIALISTS,
        requestProvider: undefined,
        enabledProviders: { auggie: false },
      }),
    ).toBe('auggie');
  });

  it('ignores an enabled pin, an unpinned agent and General', () => {
    const base = { specialists: SPECIALISTS, requestProvider: undefined };
    expect(
      disabledPinnedProvider({ ...base, specialistId: 'implementor', enabledProviders: {} }),
    ).toBeNull();
    expect(
      disabledPinnedProvider({
        ...base,
        specialistId: 'ui-designer',
        enabledProviders: { auggie: false },
      }),
    ).toBeNull();
    expect(
      disabledPinnedProvider({ ...base, specialistId: null, enabledProviders: { auggie: false } }),
    ).toBeNull();
  });

  it('ignores the pin when the request names its own provider', () => {
    expect(
      disabledPinnedProvider({
        specialistId: 'implementor',
        specialists: SPECIALISTS,
        requestProvider: 'codex',
        enabledProviders: { auggie: false },
      }),
    ).toBeNull();
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
