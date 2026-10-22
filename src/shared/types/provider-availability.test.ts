import { describe, expect, it } from 'vitest';
import {
  getProviderStatusFromResult,
  isProviderReadyInResult,
  type ProviderAvailabilityResult,
} from './provider-availability';

const availability: ProviderAvailabilityResult = {
  hasAnyProvider: true,
  providers: {
    auggie: { available: true },
    claudeCode: { available: true, authenticated: true },
    codex: { available: true, authenticated: false },
    cortex: { available: false },
    mock: { available: false },
    opencode: { available: false },
    pi: { available: false },
    droid: { available: false },
    grok: { available: false },
    unsloth: { available: false },
    antigravity: { available: true, authenticated: true },
  },
};

describe('provider result helpers', () => {
  it('translates provider IDs to wire keys', () => {
    expect(getProviderStatusFromResult(availability, 'claude-code')).toBe(
      availability.providers.claudeCode,
    );
    expect(getProviderStatusFromResult(availability, 'antigravity')).toBe(
      availability.providers.antigravity,
    );
  });

  it.each([null, undefined])('handles an unresolved result: %s', (result) => {
    expect(getProviderStatusFromResult(result, 'auggie')).toBeUndefined();
    expect(isProviderReadyInResult(result, 'auggie')).toBe(false);
  });

  it.each(['unknown', 'toString', '__proto__'])('rejects an unknown provider %s', (provider) => {
    expect(getProviderStatusFromResult(availability, provider)).toBeUndefined();
    expect(isProviderReadyInResult(availability, provider)).toBe(false);
  });

  it('keeps existing auth rules for other providers', () => {
    expect(isProviderReadyInResult(availability, 'auggie')).toBe(true);
    expect(isProviderReadyInResult(availability, 'claude-code')).toBe(true);
    expect(isProviderReadyInResult(availability, 'codex')).toBe(false);
    expect(isProviderReadyInResult(availability, 'cortex')).toBe(false);
  });

  it.each([undefined, false, true])('requires confirmed Antigravity auth: %s', (authenticated) => {
    const result = {
      ...availability,
      providers: { ...availability.providers, antigravity: { available: true, authenticated } },
    };
    expect(isProviderReadyInResult(result, 'antigravity')).toBe(authenticated === true);
  });

  it('accepts an older daemon without Antigravity status', () => {
    const result = {
      ...availability,
      providers: { ...availability.providers, antigravity: undefined },
    };
    expect(getProviderStatusFromResult(result, 'antigravity')).toBeUndefined();
    expect(isProviderReadyInResult(result, 'antigravity')).toBe(false);
  });
});
