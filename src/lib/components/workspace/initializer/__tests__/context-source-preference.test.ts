/**
 * @vitest-environment jsdom
 *
 * Unit tests for the Add-context picker's last-used-source persistence and
 * provider ordering helpers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LAST_SOURCE_STORAGE_KEY,
  loadLastUsedSource,
  orderProviders,
  orderSources,
  resolveActiveSource,
  saveLastUsedSource,
  type ProviderConnectionState,
} from '../context-source-preference';

const conn = (partial: Partial<ProviderConnectionState> = {}): ProviderConnectionState => ({
  github: false,
  linear: false,
  sentry: false,
  ...partial,
});

describe('orderProviders', () => {
  it('fresh install (nothing connected, no last-used) is alphabetical', () => {
    expect(orderProviders(conn(), null)).toEqual(['github', 'linear', 'sentry']);
  });

  it('puts connected providers before unconnected, alphabetical within groups', () => {
    expect(orderProviders(conn({ linear: true, sentry: true }), null)).toEqual([
      'linear',
      'sentry',
      'github',
    ]);
  });

  it('puts the last-used provider first when it is connected', () => {
    expect(
      orderProviders(conn({ github: true, linear: true, sentry: true }), 'sentry'),
    ).toEqual(['sentry', 'github', 'linear']);
  });

  it('ignores last-used when its provider is not connected', () => {
    expect(orderProviders(conn({ github: true, linear: true }), 'sentry')).toEqual([
      'github',
      'linear',
      'sentry',
    ]);
  });
});

describe('orderSources', () => {
  it('keeps GitHub issues and PRs adjacent, issues first, even when PRs were last used', () => {
    expect(
      orderSources(conn({ github: true, linear: true, sentry: true }), 'github-prs'),
    ).toEqual(['github-issues', 'github-prs', 'linear', 'sentry']);
  });

  it('fresh install source order is GitHub, Linear, Sentry', () => {
    expect(orderSources(conn(), null)).toEqual([
      'github-issues',
      'github-prs',
      'linear',
      'sentry',
    ]);
  });
});

describe('persistence', () => {
  // The global test setup replaces window.localStorage with a non-storing
  // vi.fn mock; back it with an in-memory store for round-trip tests.
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map();
    vi.mocked(localStorage.getItem).mockImplementation((key) => store.get(key) ?? null);
    vi.mocked(localStorage.setItem).mockImplementation((key, value) => {
      store.set(key, String(value));
    });
  });

  afterEach(() => {
    vi.mocked(localStorage.getItem).mockImplementation(() => null);
    vi.mocked(localStorage.setItem).mockImplementation(() => undefined);
  });

  it('round-trips the saved source', () => {
    saveLastUsedSource('github-prs');
    expect(loadLastUsedSource()).toBe('github-prs');
  });

  it('returns null when nothing is stored', () => {
    expect(loadLastUsedSource()).toBeNull();
  });

  it('returns null for a corrupt stored value', () => {
    localStorage.setItem(LAST_SOURCE_STORAGE_KEY, 'bogus-source');
    expect(loadLastUsedSource()).toBeNull();
  });

  it('returns null when localStorage.getItem throws', () => {
    vi.mocked(localStorage.getItem).mockImplementation(() => {
      throw new Error('denied');
    });
    expect(loadLastUsedSource()).toBeNull();
  });

  it('does not throw when localStorage.setItem throws', () => {
    vi.mocked(localStorage.setItem).mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => saveLastUsedSource('linear')).not.toThrow();
  });
});

describe('resolveActiveSource', () => {
  it('returns the persisted source when its provider is connected', () => {
    expect(resolveActiveSource(conn({ sentry: true }), 'sentry')).toBe('sentry');
  });

  it('keeps the persisted source while nothing is connected yet', () => {
    expect(resolveActiveSource(conn(), 'sentry')).toBe('sentry');
  });

  it('falls back to the first connected provider source when the persisted provider is unconnected', () => {
    expect(resolveActiveSource(conn({ linear: true }), 'sentry')).toBe('linear');
    expect(resolveActiveSource(conn({ github: true }), 'sentry')).toBe('github-issues');
  });

  it('fresh install resolves to GitHub issues (first in default order)', () => {
    expect(resolveActiveSource(conn(), null)).toBe('github-issues');
  });
});
