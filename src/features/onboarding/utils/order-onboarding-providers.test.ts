import { describe, expect, it } from 'vitest';
import {
  getOnboardingProviderTier,
  orderOnboardingProviders,
} from './order-onboarding-providers';

const ids = (providers: { id: string }[]) => providers.map((p) => p.id);
const providers = (...list: string[]) => list.map((id) => ({ id }));

describe('getOnboardingProviderTier', () => {
  it('puts installed + confirmed-logged-in providers in tier 1', () => {
    expect(getOnboardingProviderTier({ available: true, authenticated: true })).toBe(1);
  });

  it('puts installed but logged-out providers in tier 2', () => {
    expect(getOnboardingProviderTier({ available: true, authenticated: false })).toBe(2);
  });

  it('puts installed providers with an unknown auth verdict in tier 2', () => {
    expect(getOnboardingProviderTier({ available: true })).toBe(2);
    expect(getOnboardingProviderTier({ available: true, authenticated: undefined })).toBe(2);
  });

  it('puts not-installed providers in tier 3', () => {
    expect(getOnboardingProviderTier({ available: false })).toBe(3);
    expect(getOnboardingProviderTier({ available: false, authenticated: true })).toBe(3);
  });

  it('puts providers with no status yet in tier 3', () => {
    expect(getOnboardingProviderTier(undefined)).toBe(3);
  });
});

describe('orderOnboardingProviders', () => {
  it('orders tier 1 before tier 2 before tier 3', () => {
    const shuffled = providers('missing', 'loggedOut', 'ready');
    const result = orderOnboardingProviders(shuffled, {
      ready: { available: true, authenticated: true },
      loggedOut: { available: true, authenticated: false },
      missing: { available: false },
    });
    expect(ids(result)).toEqual(['ready', 'loggedOut', 'missing']);
  });

  it('preserves the input (shuffled) order within each tier', () => {
    const shuffled = providers('b3', 'a1', 'c2', 'b1', 'a3', 'c1', 'a2');
    const result = orderOnboardingProviders(shuffled, {
      a1: { available: true, authenticated: true },
      b1: { available: true, authenticated: true },
      c1: { available: true, authenticated: true },
      c2: { available: true, authenticated: false },
      a2: { available: true },
      b3: { available: false },
      a3: undefined,
    });
    expect(ids(result)).toEqual(['a1', 'b1', 'c1', 'c2', 'a2', 'b3', 'a3']);
  });

  it('returns the input order unchanged before any status arrives (all tier 3)', () => {
    const shuffled = providers('codex', 'auggie', 'claude-code');
    expect(ids(orderOnboardingProviders(shuffled, {}))).toEqual([
      'codex',
      'auggie',
      'claude-code',
    ]);
  });

  it('keeps tiers sticky during an in-flight refresh (loading flags are not an input)', () => {
    // Simulates a background re-check: the availability slice sets
    // providerLoadingMap[id] = true but keeps the previous status in
    // providerStatusMap until a fresh result lands. Ordering depends only
    // on the status map, so the prior tier-1 provider is not demoted.
    const shuffled = providers('missing', 'ready');
    const statusMap = {
      ready: { available: true, authenticated: true },
      missing: { available: false },
    };
    const before = ids(orderOnboardingProviders(shuffled, statusMap));
    const duringRefresh = ids(orderOnboardingProviders(shuffled, statusMap));
    expect(before).toEqual(['ready', 'missing']);
    expect(duringRefresh).toEqual(before);
  });

  it('moves a provider up when a fresh status confirms login', () => {
    const shuffled = providers('codex', 'auggie');
    const beforeAuth = orderOnboardingProviders(shuffled, {
      auggie: { available: true },
    });
    expect(ids(beforeAuth)).toEqual(['auggie', 'codex']);
    const afterAuth = orderOnboardingProviders(shuffled, {
      auggie: { available: true, authenticated: true },
      codex: { available: true, authenticated: true },
    });
    expect(ids(afterAuth)).toEqual(['codex', 'auggie']);
  });
});
