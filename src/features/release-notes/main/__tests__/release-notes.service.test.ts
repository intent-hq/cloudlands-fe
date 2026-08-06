/**
 * Release-notes service tests — the startup version-diff decision matrix, the
 * pref-advances-only-after-showing semantics, and fail-soft fetching.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';

let testUserDataPath: string;
let appVersion = '2.1.0';

vi.mock('electron', () => ({
  app: {
    getPath: () => testUserDataPath,
    getVersion: () => appVersion,
  },
}));

const PREF_KEY = 'lastSeenReleaseNotesVersion';

async function writePref(value: string): Promise<void> {
  await fs.writeFile(
    path.join(testUserDataPath, 'local-prefs.json'),
    JSON.stringify({ [PREF_KEY]: value }),
    'utf8',
  );
}

async function readPref(): Promise<string | undefined> {
  try {
    const raw = await fs.readFile(path.join(testUserDataPath, 'local-prefs.json'), 'utf8');
    return JSON.parse(raw)[PREF_KEY];
  } catch {
    return undefined;
  }
}

function mockFetchOk(body: string, htmlUrl = 'https://github.com/example/releases/tag/v2.1.0') {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ body, html_url: htmlUrl }),
  })) as unknown as typeof fetch;
}

describe('release-notes service', () => {
  beforeEach(async () => {
    testUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'release-notes-test-'));
    appVersion = '2.1.0';
    vi.resetModules();
  });

  afterEach(async () => {
    const { __drainLocalPrefsWriteChainForTesting } = await import('../../../../main/local-prefs');
    await __drainLocalPrefsWriteChainForTesting();
    await fs.rm(testUserDataPath, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  describe('fetchReleaseNotes', () => {
    it('returns the markdown body and release page URL on success', async () => {
      vi.stubGlobal('fetch', mockFetchOk('## What changed\n\n- Everything'));
      const { fetchReleaseNotes } = await import('../release-notes.service');

      const notes = await fetchReleaseNotes('2.1.0');

      expect(notes).toEqual({
        version: '2.1.0',
        notes: '## What changed\n\n- Everything',
        url: 'https://github.com/example/releases/tag/v2.1.0',
      });
    });

    it('requests the tagged release on the public releases repo', async () => {
      const fetchSpy = mockFetchOk('body');
      vi.stubGlobal('fetch', fetchSpy);
      const { fetchReleaseNotes } = await import('../release-notes.service');

      await fetchReleaseNotes('2.1.0');

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.github.com/repos/intent-hq/cloudlands-releases/releases/tags/v2.1.0',
        expect.objectContaining({ headers: { Accept: 'application/vnd.github+json' } }),
      );
    });

    it('returns null on a 404 (unpublished version)', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
      const { fetchReleaseNotes } = await import('../release-notes.service');

      expect(await fetchReleaseNotes('99.0.0')).toBeNull();
    });

    it('returns null when the fetch rejects (offline)', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => {
        throw new Error('network down');
      }));
      const { fetchReleaseNotes } = await import('../release-notes.service');

      expect(await fetchReleaseNotes('2.1.0')).toBeNull();
    });

    it('returns null when the release body is empty', async () => {
      vi.stubGlobal('fetch', mockFetchOk('   '));
      const { fetchReleaseNotes } = await import('../release-notes.service');

      expect(await fetchReleaseNotes('2.1.0')).toBeNull();
    });
  });

  describe('checkForReleaseNotesOnStartup', () => {
    it('records the version and shows nothing on a fresh install', async () => {
      const fetchSpy = mockFetchOk('notes');
      vi.stubGlobal('fetch', fetchSpy);
      const { checkForReleaseNotesOnStartup } = await import('../release-notes.service');
      const show = vi.fn();

      expect(await checkForReleaseNotesOnStartup(show)).toBeNull();

      expect(show).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(await readPref()).toBe('2.1.0');
    });

    it('does nothing when the recorded version matches the running version', async () => {
      await writePref('2.1.0');
      const fetchSpy = mockFetchOk('notes');
      vi.stubGlobal('fetch', fetchSpy);
      const { checkForReleaseNotesOnStartup } = await import('../release-notes.service');
      const show = vi.fn();

      expect(await checkForReleaseNotesOnStartup(show)).toBeNull();

      expect(show).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('shows the notes and advances the pref when the version changed', async () => {
      await writePref('2.0.0');
      vi.stubGlobal('fetch', mockFetchOk('## 2.1.0'));
      const { checkForReleaseNotesOnStartup } = await import('../release-notes.service');
      const show = vi.fn();

      const notes = await checkForReleaseNotesOnStartup(show);

      expect(notes?.version).toBe('2.1.0');
      expect(show).toHaveBeenCalledWith(notes);
      expect(await readPref()).toBe('2.1.0');
    });

    it('leaves the pref untouched when the fetch fails, so a later startup retries', async () => {
      await writePref('2.0.0');
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
      const { checkForReleaseNotesOnStartup } = await import('../release-notes.service');
      const show = vi.fn();

      expect(await checkForReleaseNotesOnStartup(show)).toBeNull();

      expect(show).not.toHaveBeenCalled();
      expect(await readPref()).toBe('2.0.0');
    });
  });
});
