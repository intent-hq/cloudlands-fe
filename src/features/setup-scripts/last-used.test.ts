/**
 * @vitest-environment jsdom
 *
 * Tests for the localStorage-backed last-used setup script per repo:
 * round-trip, trimming, blank rejection, corrupt-storage tolerance, and the
 * bounded-map eviction of the oldest repos.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getLastUsedSetupScript,
  recordLastUsedSetupScript,
  LAST_USED_SETUP_SCRIPTS_STORAGE_KEY,
  MAX_REPOS,
} from './last-used';

// The global test-setup stubs localStorage with no-op vi.fn()s; this suite
// needs a functional backing store, so install a real in-memory one.
function createMemoryLocalStorage(): Storage {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  } as Storage;
}

beforeEach(() => {
  Object.defineProperty(window, 'localStorage', {
    value: createMemoryLocalStorage(),
    configurable: true,
  });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe('recordLastUsedSetupScript / getLastUsedSetupScript', () => {
  it('round-trips the script for a repo', () => {
    recordLastUsedSetupScript('/repo/a', { name: 'My script', content: 'echo hi' });
    expect(getLastUsedSetupScript('/repo/a')).toEqual({ name: 'My script', content: 'echo hi' });
  });

  it('returns undefined for an unknown repo or empty repoPath', () => {
    expect(getLastUsedSetupScript('/repo/none')).toBeUndefined();
    expect(getLastUsedSetupScript('')).toBeUndefined();
  });

  it('stores the content trimmed', () => {
    recordLastUsedSetupScript('/repo/a', { name: 'S', content: '  echo hi \n' });
    expect(getLastUsedSetupScript('/repo/a')?.content).toBe('echo hi');
  });

  it('ignores blank content and empty repoPath', () => {
    recordLastUsedSetupScript('/repo/a', { name: 'S', content: '   \n ' });
    expect(getLastUsedSetupScript('/repo/a')).toBeUndefined();
    recordLastUsedSetupScript('', { name: 'S', content: 'echo hi' });
    expect(localStorage.getItem(LAST_USED_SETUP_SCRIPTS_STORAGE_KEY)).toBeNull();
  });

  it('overwrites the previous entry for the same repo', () => {
    recordLastUsedSetupScript('/repo/a', { name: 'Old', content: 'echo old' });
    recordLastUsedSetupScript('/repo/a', { name: 'New', content: 'echo new' });
    expect(getLastUsedSetupScript('/repo/a')).toEqual({ name: 'New', content: 'echo new' });
  });

  it('tolerates corrupt storage (invalid JSON, wrong root, malformed entries)', () => {
    localStorage.setItem(LAST_USED_SETUP_SCRIPTS_STORAGE_KEY, '{ not json');
    expect(getLastUsedSetupScript('/repo/a')).toBeUndefined();

    localStorage.setItem(LAST_USED_SETUP_SCRIPTS_STORAGE_KEY, '[1,2]');
    expect(getLastUsedSetupScript('/repo/a')).toBeUndefined();

    localStorage.setItem(
      LAST_USED_SETUP_SCRIPTS_STORAGE_KEY,
      JSON.stringify({
        '/repo/bad': { name: 7, content: 'x', usedAt: 'now' },
        '/repo/blank': { name: 'S', content: '   ', usedAt: 'now' },
        '/repo/good': { name: 'S', content: 'echo ok', usedAt: 'now' },
      }),
    );
    expect(getLastUsedSetupScript('/repo/bad')).toBeUndefined();
    expect(getLastUsedSetupScript('/repo/blank')).toBeUndefined();
    expect(getLastUsedSetupScript('/repo/good')).toEqual({ name: 'S', content: 'echo ok' });

    // A corrupt map is replaced wholesale on the next write.
    localStorage.setItem(LAST_USED_SETUP_SCRIPTS_STORAGE_KEY, '{ not json');
    recordLastUsedSetupScript('/repo/a', { name: 'S', content: 'echo hi' });
    expect(getLastUsedSetupScript('/repo/a')?.content).toBe('echo hi');
  });

  it('evicts the oldest repos beyond MAX_REPOS', () => {
    const start = new Date('2026-01-01T00:00:00Z').getTime();
    for (let i = 0; i < MAX_REPOS + 3; i++) {
      vi.setSystemTime(start + i * 1000);
      recordLastUsedSetupScript(`/repo/${i}`, { name: `S${i}`, content: `echo ${i}` });
    }
    // The three oldest entries are gone; the newest MAX_REPOS remain.
    expect(getLastUsedSetupScript('/repo/0')).toBeUndefined();
    expect(getLastUsedSetupScript('/repo/1')).toBeUndefined();
    expect(getLastUsedSetupScript('/repo/2')).toBeUndefined();
    expect(getLastUsedSetupScript('/repo/3')?.content).toBe('echo 3');
    expect(getLastUsedSetupScript(`/repo/${MAX_REPOS + 2}`)?.content).toBe(
      `echo ${MAX_REPOS + 2}`,
    );
  });
});
