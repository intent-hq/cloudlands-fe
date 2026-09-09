import { describe, expect, it } from 'vitest';
import { resolveOnboardingSelectedProvider } from './resolve-onboarding-selected-provider';

describe('resolveOnboardingSelectedProvider', () => {
  it('does not replace an explicit Antigravity selection when it becomes unusable', () => {
    expect(
      resolveOnboardingSelectedProvider({
        activeProviderId: 'antigravity',
        defaultProviderId: 'codex',
        readyProviderIds: ['codex'],
      }),
    ).toBeUndefined();
  });
  it('does not select Antigravity solely because it is detected', () => {
    expect(
      resolveOnboardingSelectedProvider({
        activeProviderId: '',
        defaultProviderId: '',
        readyProviderIds: ['antigravity'],
      }),
    ).toBeUndefined();
    expect(
      resolveOnboardingSelectedProvider({
        activeProviderId: '',
        defaultProviderId: '',
        readyProviderIds: ['antigravity', 'codex'],
      }),
    ).toBe('codex');
  });

  it.each(['active', 'default'])('honors an explicit %s Antigravity preference', (preference) => {
    expect(
      resolveOnboardingSelectedProvider({
        activeProviderId: preference === 'active' ? 'antigravity' : '',
        defaultProviderId: preference === 'default' ? 'antigravity' : '',
        readyProviderIds: ['codex', 'antigravity'],
      }),
    ).toBe('antigravity');
  });

  it('returns undefined when no provider is ready', () => {
    expect(
      resolveOnboardingSelectedProvider({
        activeProviderId: 'auggie',
        defaultProviderId: 'auggie',
        readyProviderIds: [],
      }),
    ).toBeUndefined();
  });

  it('honors the active provider when it is ready', () => {
    expect(
      resolveOnboardingSelectedProvider({
        activeProviderId: 'claude-code',
        defaultProviderId: 'auggie',
        readyProviderIds: ['auggie', 'claude-code', 'codex'],
      }),
    ).toBe('claude-code');
  });

  it('falls back to the default provider when the active one is not ready', () => {
    expect(
      resolveOnboardingSelectedProvider({
        activeProviderId: 'opencode',
        defaultProviderId: 'auggie',
        readyProviderIds: ['auggie', 'codex'],
      }),
    ).toBe('auggie');
  });

  it('falls back to the first ready provider when neither active nor default is ready', () => {
    expect(
      resolveOnboardingSelectedProvider({
        activeProviderId: 'opencode',
        defaultProviderId: 'auggie',
        readyProviderIds: ['claude-code', 'codex'],
      }),
    ).toBe('claude-code');
  });

  it('ignores an undefined active provider and prefers the default when ready', () => {
    expect(
      resolveOnboardingSelectedProvider({
        activeProviderId: undefined,
        defaultProviderId: 'auggie',
        readyProviderIds: ['claude-code', 'auggie'],
      }),
    ).toBe('auggie');
  });

  it('treats an empty active provider string as no preference', () => {
    expect(
      resolveOnboardingSelectedProvider({
        activeProviderId: '',
        defaultProviderId: 'auggie',
        readyProviderIds: ['codex'],
      }),
    ).toBe('codex');
  });

  it('treats an unresolved default provider ("") as no default — first ready wins', () => {
    // With providers.active unset the settings-derived default is '' — it
    // must never match a ready id, so resolution falls through to the first
    // ready provider (no fabricated auggie preference).
    expect(
      resolveOnboardingSelectedProvider({
        activeProviderId: '',
        defaultProviderId: '',
        readyProviderIds: ['claude-code', 'auggie'],
      }),
    ).toBe('claude-code');
  });
});
