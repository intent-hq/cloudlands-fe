import { describe, expect, it } from 'vitest';
import { isProviderListed } from './provider-visibility';

describe('isProviderListed', () => {
  it('lists Auggie only for an installed CLI or an enabled provider', () => {
    expect(isProviderListed('auggie', { available: true })).toBe(true);
    expect(isProviderListed('auggie', { available: false })).toBe(false);
    expect(isProviderListed('auggie', undefined, true)).toBe(true);
  });

  it('does not count Auggie runnable only through npx as installed', () => {
    expect(isProviderListed('auggie', { available: true, viaNpx: true })).toBe(false);
    expect(isProviderListed('auggie', { available: true, viaNpx: true }, true)).toBe(true);
  });

  it('always lists other providers', () => {
    expect(isProviderListed('grok', { available: false })).toBe(true);
    expect(isProviderListed('opencode', { available: true, viaNpx: true })).toBe(true);
  });
});
