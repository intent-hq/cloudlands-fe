import { describe, expect, it } from 'vitest';
import { getOnboardingProviderTier, orderOnboardingProviders } from './order-onboarding-providers';

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
    const catalog = providers('missing', 'loggedOut', 'ready');
    const result = orderOnboardingProviders(catalog, {
      ready: { available: true, authenticated: true },
      loggedOut: { available: true, authenticated: false },
      missing: { available: false },
    });
    expect(ids(result)).toEqual(['ready', 'loggedOut', 'missing']);
  });

  it('preserves the input (catalog) order within each tier', () => {
    const catalog = providers('b3', 'a1', 'c2', 'b1', 'a3', 'c1', 'a2');
    const result = orderOnboardingProviders(catalog, {
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

  it('keeps catalog order before any status arrives (all tier 3)', () => {
    const catalog = providers('opencode', 'auggie', 'droid');
    expect(ids(orderOnboardingProviders(catalog, {}))).toEqual(['opencode', 'auggie', 'droid']);
  });

  it('keeps tiers sticky during an in-flight refresh (loading flags are not an input)', () => {
    // Simulates a background re-check: the availability slice sets
    // providerLoadingMap[id] = true but keeps the previous status in
    // providerStatusMap until a fresh result lands. Ordering depends only
    // on the status map, so the prior tier-1 provider is not demoted.
    const catalog = providers('missing', 'ready');
    const statusMap = {
      ready: { available: true, authenticated: true },
      missing: { available: false },
    };
    const before = ids(orderOnboardingProviders(catalog, statusMap));
    const duringRefresh = ids(orderOnboardingProviders(catalog, statusMap));
    expect(before).toEqual(['ready', 'missing']);
    expect(duringRefresh).toEqual(before);
  });

  it('moves a provider up when a fresh status confirms login', () => {
    const catalog = providers('auggie', 'opencode');
    const beforeAuth = orderOnboardingProviders(catalog, {
      opencode: { available: true },
    });
    expect(ids(beforeAuth)).toEqual(['opencode', 'auggie']);
    const afterAuth = orderOnboardingProviders(catalog, {
      auggie: { available: true, authenticated: true },
      opencode: { available: true, authenticated: true },
    });
    expect(ids(afterAuth)).toEqual(['auggie', 'opencode']);
  });

  it('orders Claude Code, then Codex, then the rest when nothing is detected', () => {
    const catalog = providers('auggie', 'codex', 'opencode', 'claude-code');
    expect(ids(orderOnboardingProviders(catalog, {}))).toEqual([
      'claude-code',
      'codex',
      'auggie',
      'opencode',
    ]);
  });

  it('puts detected providers ahead of Claude Code and Codex', () => {
    const catalog = providers('claude-code', 'codex', 'auggie', 'opencode');
    const result = orderOnboardingProviders(catalog, {
      opencode: { available: true, authenticated: true },
      auggie: { available: true },
    });
    expect(ids(result)).toEqual(['opencode', 'auggie', 'claude-code', 'codex']);
  });

  it('applies the Claude Code, Codex priority inside a detected tier', () => {
    const catalog = providers('auggie', 'codex', 'claude-code');
    const ready = { available: true, authenticated: true };
    const result = orderOnboardingProviders(catalog, {
      auggie: ready,
      codex: ready,
      'claude-code': ready,
    });
    expect(ids(result)).toEqual(['claude-code', 'codex', 'auggie']);
  });
});
