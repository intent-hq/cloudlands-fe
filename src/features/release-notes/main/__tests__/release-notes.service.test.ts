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

const ipcHandlers = vi.hoisted(
  () => new Map<string, (event: unknown, data: unknown) => Promise<unknown>>(),
);

vi.mock('electron', () => ({
  app: {
    getPath: () => testUserDataPath,
    getVersion: () => appVersion,
  },
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, data: unknown) => Promise<unknown>) => {
      ipcHandlers.set(channel, handler);
    },
  },
  BrowserWindow: class {},
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

function release(tag: string, body: string, extra: Record<string, unknown> = {}) {
  return {
    tag_name: tag,
    body,
    html_url: `https://github.com/example/releases/tag/${tag}`,
    ...extra,
  };
}

function mockReleaseList(items: unknown[]) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => items,
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
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: false, status: 404 })),
      );
      const { fetchReleaseNotes } = await import('../release-notes.service');

      expect(await fetchReleaseNotes('99.0.0')).toBeNull();
    });

    it('returns null when the fetch rejects (offline)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new Error('network down');
        }),
      );
      const { fetchReleaseNotes } = await import('../release-notes.service');

      expect(await fetchReleaseNotes('2.1.0')).toBeNull();
    });

    it('returns null when the release body is empty', async () => {
      vi.stubGlobal('fetch', mockFetchOk('   '));
      const { fetchReleaseNotes } = await import('../release-notes.service');

      expect(await fetchReleaseNotes('2.1.0')).toBeNull();
    });
  });

  describe('fetchReleaseNotesRange', () => {
    it('combines skipped versions in numeric newest-first order within the range', async () => {
      vi.stubGlobal(
        'fetch',
        mockReleaseList([
          release('v2.2.0', '## 2.2.0'),
          release('v2.10.0', '## 2.10.0'),
          release('v2.4.0', '## 2.4.0'),
          release('v2.11.0', 'too new'),
          release('v2.1.0', 'lower bound'),
        ]),
      );
      const { fetchReleaseNotesRange } = await import('../release-notes.service');

      expect(await fetchReleaseNotesRange('2.1.0', '2.10.0')).toEqual({
        version: '2.10.0',
        notes: '## 2.10.0\n\n---\n\n## 2.4.0\n\n---\n\n## 2.2.0',
        url: 'https://github.com/example/releases/tag/v2.10.0',
      });
    });

    it('excludes rolling, draft, malformed, prerelease-tagged, and empty releases', async () => {
      vi.stubGlobal(
        'fetch',
        mockReleaseList([
          release('stable', 'rolling'),
          release('v2.3.0', 'draft', { draft: true }),
          release('2.3.0', 'missing prefix'),
          release('v2.3', 'malformed'),
          release('v2.3.0-beta.1', 'prerelease tag'),
          release('v2.2.0', '   '),
          release('v2.1.0', '## Included'),
        ]),
      );
      const { fetchReleaseNotesRange } = await import('../release-notes.service');

      expect(await fetchReleaseNotesRange('2.0.0', '2.3.0')).toEqual({
        version: '2.3.0',
        notes: '## Included',
        url: 'https://github.com/intent-hq/cloudlands-releases/releases/tag/v2.3.0',
      });
    });

    it('lists releases from the public repo without authentication', async () => {
      const fetchSpy = mockReleaseList([release('v2.1.0', 'notes')]);
      vi.stubGlobal('fetch', fetchSpy);
      const { fetchReleaseNotesRange } = await import('../release-notes.service');

      await fetchReleaseNotesRange('2.0.0', '2.1.0');

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.github.com/repos/intent-hq/cloudlands-releases/releases?per_page=100&page=1',
        expect.objectContaining({ headers: { Accept: 'application/vnd.github+json' } }),
      );
    });

    it('returns null on an API failure', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: false, status: 503 })),
      );
      const { fetchReleaseNotesRange } = await import('../release-notes.service');

      expect(await fetchReleaseNotesRange('2.0.0', '2.1.0')).toBeNull();
    });

    it.each(['malformed', '2.1.0'])(
      'falls back to the current release when the previous version is %s',
      async (previousVersion) => {
        const fetchSpy = mockFetchOk('## Current');
        vi.stubGlobal('fetch', fetchSpy);
        const { fetchReleaseNotesRange } = await import('../release-notes.service');

        expect(await fetchReleaseNotesRange(previousVersion, '2.1.0')).toEqual({
          version: '2.1.0',
          notes: '## Current',
          url: 'https://github.com/example/releases/tag/v2.1.0',
        });
        expect(fetchSpy).toHaveBeenCalledWith(
          'https://api.github.com/repos/intent-hq/cloudlands-releases/releases/tags/v2.1.0',
          expect.any(Object),
        );
      },
    );
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

    it('shows the cumulative notes and advances the pref when versions were skipped', async () => {
      await writePref('2.0.0');
      appVersion = '2.3.0';
      vi.stubGlobal(
        'fetch',
        mockReleaseList([
          release('v2.2.0', '## 2.2.0'),
          release('v2.3.0', '## 2.3.0'),
          release('v2.1.0', '## 2.1.0'),
        ]),
      );
      const { checkForReleaseNotesOnStartup } = await import('../release-notes.service');
      const show = vi.fn();

      const notes = await checkForReleaseNotesOnStartup(show);

      expect(notes).toEqual({
        version: '2.3.0',
        notes: '## 2.3.0\n\n---\n\n## 2.2.0\n\n---\n\n## 2.1.0',
        url: 'https://github.com/example/releases/tag/v2.3.0',
      });
      expect(show).toHaveBeenCalledWith(notes);
      expect(show).toHaveBeenCalledTimes(1);
      expect(await readPref()).toBe('2.3.0');
    });

    it('keeps the prior pref when handing the payload off fails', async () => {
      await writePref('2.0.0');
      vi.stubGlobal('fetch', mockReleaseList([release('v2.1.0', '## 2.1.0')]));
      const { checkForReleaseNotesOnStartup } = await import('../release-notes.service');

      await expect(
        checkForReleaseNotesOnStartup(() => {
          throw new Error('renderer handoff failed');
        }),
      ).rejects.toThrow('renderer handoff failed');

      expect(await readPref()).toBe('2.0.0');
    });

    it('leaves the pref untouched when the fetch fails, so a later startup retries', async () => {
      await writePref('2.0.0');
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: false, status: 404 })),
      );
      const { checkForReleaseNotesOnStartup } = await import('../release-notes.service');
      const show = vi.fn();

      expect(await checkForReleaseNotesOnStartup(show)).toBeNull();

      expect(show).not.toHaveBeenCalled();
      expect(await readPref()).toBe('2.0.0');
    });
  });

  describe('initializeReleaseNotesOnStartup (no window at init time)', () => {
    it('parks the notes as pending and advances the pref', async () => {
      // Regression (intent-hq/monorepo#3054): the startup check used to be
      // gated on the main window existing, which usually lost the startup
      // race — no notes were fetched and the pref never advanced. With no
      // window the notes must park for the renderer's get-pending claim and
      // the pref must still advance.
      ipcHandlers.clear();
      await writePref('2.0.0');
      vi.stubGlobal('fetch', mockReleaseList([release('v2.1.0', '## 2.1.0')]));
      const { initializeReleaseNotesOnStartup, setupReleaseNotesIPC } =
        await import('../release-notes.ipc');
      setupReleaseNotesIPC();

      await initializeReleaseNotesOnStartup(() => null);

      const getPending = ipcHandlers.get('release-notes:get-pending');
      expect(getPending).toBeDefined();
      expect(await getPending!({}, undefined)).toEqual({
        success: true,
        data: {
          version: '2.1.0',
          notes: '## 2.1.0',
          url: 'https://github.com/example/releases/tag/v2.1.0',
        },
      });
      expect(await readPref()).toBe('2.1.0');
    });
  });
});
