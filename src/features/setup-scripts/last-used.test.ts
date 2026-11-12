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
  getRecentSetupScripts,
  recordLastUsedSetupScript,
  LAST_USED_SETUP_SCRIPTS_STORAGE_KEY,
  MAX_RECENT_SCRIPTS_PER_REPO,
  MAX_REPOS,
  RECENT_SETUP_SCRIPTS_STORAGE_KEY,
} from './last-used';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('recordLastUsedSetupScript / getLastUsedSetupScript', () => {
  it('round-trips the script for a repo', () => {
    recordLastUsedSetupScript('/repo/a', { name: 'My script', content: 'echo hi' });
    expect(getLastUsedSetupScript('/repo/a')).toEqual({
      name: 'My script',
      content: 'echo hi',
      nameSource: 'named',
    });
  });

  it('round-trips an explicit nameSource and defaults missing ones to named', () => {
    recordLastUsedSetupScript('/repo/a', {
      name: 'From repo config',
      content: 'echo repo',
      nameSource: 'repo-config',
    });
    expect(getLastUsedSetupScript('/repo/a')?.nameSource).toBe('repo-config');

    // Entries written before the field existed carry no nameSource — the
    // reader folds them to 'named' (display pass-through).
    localStorage.setItem(
      LAST_USED_SETUP_SCRIPTS_STORAGE_KEY,
      JSON.stringify({ '/repo/legacy': { name: 'Custom', content: 'echo x', usedAt: 'now' } }),
    );
    expect(getLastUsedSetupScript('/repo/legacy')).toEqual({
      name: 'Custom',
      content: 'echo x',
      nameSource: 'named',
    });
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
    expect(getLastUsedSetupScript('/repo/a')).toEqual({
      name: 'New',
      content: 'echo new',
      nameSource: 'named',
    });
  });

  it('keys GitHub selections by path + URL so repos sharing a clone path stay separate', () => {
    recordLastUsedSetupScript(
      '/clones/x',
      { name: 'A script', content: 'echo a' },
      'https://github.com/owner-a/x',
    );
    recordLastUsedSetupScript(
      '/clones/x',
      { name: 'B script', content: 'echo b' },
      'https://github.com/owner-b/x',
    );
    expect(getLastUsedSetupScript('/clones/x', 'https://github.com/owner-a/x')).toEqual({
      name: 'A script',
      content: 'echo a',
      nameSource: 'named',
    });
    expect(getLastUsedSetupScript('/clones/x', 'https://github.com/owner-b/x')).toEqual({
      name: 'B script',
      content: 'echo b',
      nameSource: 'named',
    });
    // A local repo at the same path is yet another identity.
    expect(getLastUsedSetupScript('/clones/x')).toBeUndefined();
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
    expect(getLastUsedSetupScript('/repo/good')).toEqual({
      name: 'S',
      content: 'echo ok',
      nameSource: 'named',
    });

    // A malformed nameSource invalidates the entry rather than leaking an
    // unknown value into display logic.
    localStorage.setItem(
      LAST_USED_SETUP_SCRIPTS_STORAGE_KEY,
      JSON.stringify({
        '/repo/bad-source': { name: 'S', content: 'echo x', usedAt: 'now', nameSource: 'bogus' },
      }),
    );
    expect(getLastUsedSetupScript('/repo/bad-source')).toBeUndefined();

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
    expect(getLastUsedSetupScript(`/repo/${MAX_REPOS + 2}`)?.content).toBe(`echo ${MAX_REPOS + 2}`);
  });
});

describe('getRecentSetupScripts', () => {
  const start = new Date('2026-01-01T00:00:00Z').getTime();
  let tick = 0;
  function record(
    repo: string,
    script: { name: string; content: string; nameSource?: 'repo-config' | 'custom' | 'named' },
    githubUrl?: string,
  ) {
    vi.setSystemTime(start + ++tick * 1000);
    recordLastUsedSetupScript(repo, script, githubUrl);
  }
  const names = (repo: string, githubUrl?: string) =>
    getRecentSetupScripts(repo, githubUrl).map((entry) => entry.name);

  beforeEach(() => {
    tick = 0;
  });

  it('lists each used script once, newest first, promoting a reused script', () => {
    record('/repo/a', { name: 'Install', content: 'pnpm i' });
    record('/repo/a', { name: 'Build', content: 'pnpm build' });
    record('/repo/a', { name: 'Install', content: '  pnpm i \n' });
    expect(getRecentSetupScripts('/repo/a')).toEqual([
      {
        name: 'Install',
        content: 'pnpm i',
        nameSource: 'named',
        usedAt: new Date(start + 3000).toISOString(),
      },
      {
        name: 'Build',
        content: 'pnpm build',
        nameSource: 'named',
        usedAt: new Date(start + 2000).toISOString(),
      },
    ]);
    // The single last-used value still reports the newest script.
    expect(getLastUsedSetupScript('/repo/a')?.name).toBe('Install');
  });

  it('keeps scripts that differ by name source or content as separate entries', () => {
    record('/repo/a', { name: 'Setup', content: 'make', nameSource: 'repo-config' });
    record('/repo/a', { name: 'Setup', content: 'make', nameSource: 'custom' });
    record('/repo/a', { name: 'Setup', content: 'make all', nameSource: 'custom' });
    expect(
      getRecentSetupScripts('/repo/a').map((entry) => [entry.nameSource, entry.content]),
    ).toEqual([
      ['custom', 'make all'],
      ['custom', 'make'],
      ['repo-config', 'make'],
    ]);
  });

  it('keeps at most MAX_RECENT_SCRIPTS_PER_REPO scripts per repo', () => {
    for (let i = 0; i < MAX_RECENT_SCRIPTS_PER_REPO + 2; i++) {
      record('/repo/a', { name: `S${i}`, content: `echo ${i}` });
    }
    const recent = names('/repo/a');
    expect(recent).toHaveLength(MAX_RECENT_SCRIPTS_PER_REPO);
    expect(recent[0]).toBe(`S${MAX_RECENT_SCRIPTS_PER_REPO + 1}`);
    expect(recent).not.toContain('S0');
    expect(recent).not.toContain('S1');
  });

  it('isolates repos and GitHub selections that share a clone path', () => {
    record('/clones/x', { name: 'A', content: 'echo a' }, 'https://github.com/owner-a/x');
    record('/clones/x', { name: 'B', content: 'echo b' }, 'https://github.com/owner-b/x');
    record('/repo/other', { name: 'C', content: 'echo c' });
    expect(names('/clones/x', 'https://github.com/owner-a/x')).toEqual(['A']);
    expect(names('/clones/x', 'https://github.com/owner-b/x')).toEqual(['B']);
    expect(names('/clones/x')).toEqual([]);
    expect(names('')).toEqual([]);
  });

  it('includes a last-used entry recorded before the history existed', () => {
    localStorage.setItem(
      LAST_USED_SETUP_SCRIPTS_STORAGE_KEY,
      JSON.stringify({
        '/repo/legacy': { name: 'Old', content: 'echo old', usedAt: '2025-06-01T00:00:00.000Z' },
      }),
    );
    expect(getRecentSetupScripts('/repo/legacy')).toEqual([
      { name: 'Old', content: 'echo old', nameSource: 'named', usedAt: '2025-06-01T00:00:00.000Z' },
    ]);

    // The next creation keeps the legacy script in the history behind it.
    record('/repo/legacy', { name: 'New', content: 'echo new' });
    expect(names('/repo/legacy')).toEqual(['New', 'Old']);
    expect(getLastUsedSetupScript('/repo/legacy')?.name).toBe('New');
  });

  it('evicts the repos whose newest use is oldest beyond MAX_REPOS', () => {
    for (let i = 0; i < MAX_REPOS + 2; i++) {
      record(`/repo/${i}`, { name: `S${i}`, content: `echo ${i}` });
    }
    const stored = JSON.parse(localStorage.getItem(RECENT_SETUP_SCRIPTS_STORAGE_KEY) ?? '{}');
    expect(Object.keys(stored)).toHaveLength(MAX_REPOS);
    expect(stored['/repo/0']).toBeUndefined();
    expect(names(`/repo/${MAX_REPOS + 1}`)).toEqual([`S${MAX_REPOS + 1}`]);
  });

  it('tolerates malformed or unavailable storage', () => {
    localStorage.setItem(RECENT_SETUP_SCRIPTS_STORAGE_KEY, '{ not json');
    expect(getRecentSetupScripts('/repo/a')).toEqual([]);

    localStorage.setItem(
      RECENT_SETUP_SCRIPTS_STORAGE_KEY,
      JSON.stringify({
        '/repo/a': [
          { name: 7, content: 'x', usedAt: 'now' },
          { name: 'Ok', content: 'echo ok', usedAt: '2026-02-01T00:00:00.000Z' },
          { name: 'Blank', content: '  ', usedAt: 'now' },
        ],
        '/repo/b': 'not a list',
      }),
    );
    expect(names('/repo/a')).toEqual(['Ok']);
    expect(names('/repo/b')).toEqual([]);

    // A corrupt history is replaced on the next write.
    localStorage.setItem(RECENT_SETUP_SCRIPTS_STORAGE_KEY, '[1,2]');
    record('/repo/a', { name: 'Fresh', content: 'echo fresh' });
    expect(names('/repo/a')).toEqual(['Fresh']);

    // Throwing storage never reaches the caller.
    const getItem = vi.mocked(localStorage.getItem).mockImplementation(() => {
      throw new Error('unavailable');
    });
    const setItem = vi.mocked(localStorage.setItem).mockImplementation(() => {
      throw new Error('full');
    });
    try {
      expect(() => record('/repo/a', { name: 'S', content: 'echo s' })).not.toThrow();
      expect(getRecentSetupScripts('/repo/a')).toEqual([]);
      expect(getLastUsedSetupScript('/repo/a')).toBeUndefined();
    } finally {
      getItem.mockReset();
      setItem.mockReset();
    }
  });
});
