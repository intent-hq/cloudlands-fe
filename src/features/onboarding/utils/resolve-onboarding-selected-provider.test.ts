import { describe, expect, it } from 'vitest';
import { resolveOnboardingSelectedProvider } from './resolve-onboarding-selected-provider';

describe('resolveOnboardingSelectedProvider', () => {
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
});
