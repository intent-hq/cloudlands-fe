import { describe, expect, it, vi } from 'vitest';

// The disabled check normalizes provider ids via the providerCatalog slice.
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => ({}) });
});

import type { ProviderAvailabilityResult } from '$shared/types/provider-availability';
import {
  availableInitialAgentProviders,
  defaultInitialAgentProvider,
  initialAgentDefaultModel,
} from './initial-agent-defaults';

const ready = { available: true, authenticated: true };
const availability = {
  hasAnyProvider: true,
  providers: { auggie: ready, claudeCode: ready, codex: { available: false } },
} as unknown as ProviderAvailabilityResult;
const catalog = [{ id: 'auggie' }, { id: 'codex' }, { id: 'claude-code' }];

function pick(enabledProviders: Record<string, boolean>, loaded = true) {
  const context = { availability: loaded ? availability : null, enabledProviders, profiles: [] };
  return defaultInitialAgentProvider({
    ...context,
    activeProviderId: 'claude-code',
    defaultProviderId: 'codex',
    availableProviders: availableInitialAgentProviders(catalog, context),
  });
}

describe('defaultInitialAgentProvider', () => {
  it('keeps the active provider while it is turned on and ready', () => {
    expect(pick({})).toBe('claude-code');
    // Before availability loads, only Settings > Providers can rule it out.
    expect(pick({}, false)).toBe('claude-code');
  });

  it('falls back to the first available provider, never a turned-off one', () => {
    expect(pick({ 'claude-code': false })).toBe('auggie');
    expect(pick({ 'claude-code': false, auggie: false })).toBe('');
    expect(pick({ 'claude-code': false }, false)).toBe('');
  });
});

describe('initialAgentDefaultModel', () => {
  const base = {
    provider: 'codex',
    specialists: [{ id: 'implementor', resolvedModel: 'store-default' }],
    configuredModels: { codex: 'gpt-5.5' },
    activeProviderId: 'claude-code',
    selectedModel: 'claude-sonnet-4-5',
  };

  it("names the specialist's resolved model in the provider's context", () => {
    const providerView = { implementor: { resolvedModel: 'gpt-5.5-codex' } };
    expect(initialAgentDefaultModel({ ...base, specialist: 'implementor', providerView })).toBe(
      'gpt-5.5-codex',
    );
    expect(
      initialAgentDefaultModel({ ...base, specialist: 'implementor', providerView: undefined }),
    ).toBe('store-default');
  });

  it("names the provider's configured model for General", () => {
    expect(initialAgentDefaultModel({ ...base, specialist: null, providerView: undefined })).toBe(
      'gpt-5.5',
    );
  });
});
