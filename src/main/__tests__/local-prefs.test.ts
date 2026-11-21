import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

/**
 * Round-trip tests for the FE-local prefs helper (main/local-prefs.ts).
 * The legacy `settings` electron-store is retired; FE-only preferences
 * (keychain choice, download-attribution marker, betaUpdatesEnabled,
 * featureCodes) live in a single JSON file under `app.getPath('userData')`.
 */

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'local-prefs-'));
  vi.resetModules();
  vi.doMock('electron', () => ({
    app: { getPath: (name: string) => (name === 'userData' ? tmpDir : tmpDir) },
  }));
  vi.doMock('../../shared/logger', () => ({
    Logger: class {
      debug() {}
      info() {}
      warn() {}
      error() {}
    },
  }));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  vi.doUnmock('electron');
  vi.doUnmock('fs');
});

type Rename = typeof import('fs').promises.rename;

/** Mock `fs` so the helper's `promises.rename` routes through `rename`; everything else is real. */
async function mockFsRename(
  rename: (actual: Rename, ...args: Parameters<Rename>) => Promise<void>,
) {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  const promises = {
    ...actual.promises,
    rename: (...args: Parameters<Rename>) => rename(actual.promises.rename, ...args),
  };
  vi.doMock('fs', () => ({ ...actual, promises, default: { ...actual, promises } }));
}

async function readDocumentOnDisk(): Promise<unknown> {
  return JSON.parse(await fs.readFile(path.join(tmpDir, 'local-prefs.json'), 'utf8'));
}

/** Write the file as an older or newer build left it; the API accepts only registered keys. */
async function writeDocumentOnDisk(document: Record<string, unknown>): Promise<void> {
  await fs.writeFile(path.join(tmpDir, 'local-prefs.json'), JSON.stringify(document), 'utf8');
}

const BROWSER_ACCESS_PREFS = {
  'browserAccess.enabled': true,
  'browserAccess.port': 47120,
  'browserAccess.accessKey': 'k'.repeat(43),
  'browserAccess.pageOrigin': 'https://box.example.ts.net',
};

describe('local-prefs', () => {
  it('reads the dock setting as on until opted out, and rejects an unreadable file', async () => {
    const { getDockLabEnabledLocalPref, setDockLabEnabledLocalPref, setLocalPref } =
      await import('../local-prefs');
    const file = path.join(tmpDir, 'local-prefs.json');
    // Missing file or missing key: the profile never chose, so the dock is on.
    expect(await getDockLabEnabledLocalPref()).toBe(true);
    await setLocalPref('menuBarAutoHide', true);
    expect(await getDockLabEnabledLocalPref()).toBe(true);
    await setDockLabEnabledLocalPref(false);
    expect(await getDockLabEnabledLocalPref()).toBe(false);
    await setDockLabEnabledLocalPref(true);
    expect(await getDockLabEnabledLocalPref()).toBe(true);
    // Corrupt or non-object contents are errors, not "unset".
    for (const contents of ['{"dockLabEnabled": fal', '[]', 'null', '']) {
      await fs.writeFile(file, contents);
      await expect(getDockLabEnabledLocalPref(), contents).rejects.toThrow();
    }
    // An unreadable path (a directory) is an error too, not "unset".
    await fs.rm(file);
    await fs.mkdir(file);
    await expect(getDockLabEnabledLocalPref()).rejects.toThrow();
  });

  it('rejects a failed Labs write and permits retry without losing the persisted setting', async () => {
    let fail = false;
    await mockFsRename(async (rename, ...args) => {
      if (fail) throw new Error('disk unavailable');
      await rename(...args);
    });
    const { setDockLabEnabledLocalPref, getDockLabEnabledLocalPref } =
      await import('../local-prefs');
    expect(await getDockLabEnabledLocalPref()).toBe(true);
    fail = true;
    await expect(setDockLabEnabledLocalPref(false)).rejects.toThrow('disk unavailable');
    expect(await getDockLabEnabledLocalPref()).toBe(true);
    fail = false;
    await setDockLabEnabledLocalPref(false);
    expect(await getDockLabEnabledLocalPref()).toBe(false);
  });

  it('hides the dock by default on Intent OS, and a saved choice wins', async () => {
    vi.stubEnv('INTENT_OS', '1');
    try {
      const { getDockEnabledLocalPref, setDockEnabledLocalPref } = await import('../local-prefs');
      expect(await getDockEnabledLocalPref()).toBe(false);
      await setDockEnabledLocalPref(true);
      expect(await getDockEnabledLocalPref()).toBe(true);
      await setDockEnabledLocalPref(false);
      expect(await getDockEnabledLocalPref()).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('shows the dock by default outside Intent OS', async () => {
    const { getDockEnabledLocalPref } = await import('../local-prefs');
    expect(await getDockEnabledLocalPref()).toBe(true);
  });

  it('getLocalPref returns undefined for missing file/key', async () => {
    const { getLocalPref, hasLocalPref } = await import('../local-prefs');
    expect(await getLocalPref('featureCodes')).toBeUndefined();
    expect(await hasLocalPref('featureCodes')).toBe(false);
  });

  it('setLocalPref then getLocalPref round-trips a value', async () => {
    const { setLocalPref, getLocalPref, hasLocalPref } = await import('../local-prefs');
    await setLocalPref('featureCodes', ['cortex', 'enable_figma_mcp']);
    expect(await getLocalPref('featureCodes')).toEqual(['cortex', 'enable_figma_mcp']);
    expect(await hasLocalPref('featureCodes')).toBe(true);
  });

  it('preserves other keys when writing one', async () => {
    const { setLocalPref, getLocalPref } = await import('../local-prefs');
    await setLocalPref('backendClientIdentitiesV1', { key: 'k', canonicalIds: {} });
    await setLocalPref('betaUpdatesEnabled', true);
    expect(await getLocalPref('backendClientIdentitiesV1')).toEqual({
      key: 'k',
      canonicalIds: {},
    });
    expect(await getLocalPref('betaUpdatesEnabled')).toBe(true);
  });

  it('keeps keys it does not know when rewriting the file', async () => {
    await writeDocumentOnDisk({ addedByNewerBuild: 1 });
    const { setLocalPref } = await import('../local-prefs');
    await setLocalPref('dockEnabled', false);
    expect(await readDocumentOnDisk()).toEqual({ addedByNewerBuild: 1, dockEnabled: false });
  });

  it('deleteLocalPref removes a single key without disturbing others', async () => {
    const { setLocalPref, deleteLocalPref, getLocalPref } = await import('../local-prefs');
    await setLocalPref('selfPublishSuppressed', true);
    await setLocalPref('dockEnabled', false);
    await deleteLocalPref('selfPublishSuppressed');
    expect(await getLocalPref('selfPublishSuppressed')).toBeUndefined();
    expect(await getLocalPref('dockEnabled')).toBe(false);
  });

  it('removes the retired Browser access keys, including its saved access key', async () => {
    await writeDocumentOnDisk({ ...BROWSER_ACCESS_PREFS, dockLabEnabled: true });
    const { deleteRetiredLocalPrefs } = await import('../local-prefs');
    await deleteRetiredLocalPrefs();
    expect(await readDocumentOnDisk()).toEqual({ dockLabEnabled: true });
  });

  it('leaves the file untouched when no retired key is present', async () => {
    let renames = 0;
    await mockFsRename(async (actual, from, to) => {
      renames += 1;
      return actual(from, to);
    });
    const { deleteRetiredLocalPrefs, setLocalPref } = await import('../local-prefs');
    await deleteRetiredLocalPrefs();
    await expect(fs.access(path.join(tmpDir, 'local-prefs.json'))).rejects.toThrow();

    await setLocalPref('dockLabEnabled', true);
    const writes = renames;
    await deleteRetiredLocalPrefs();
    expect(renames).toBe(writes);
    expect(await readDocumentOnDisk()).toEqual({ dockLabEnabled: true });
  });

  it('keeps later writes working after a failed retired-key cleanup', async () => {
    let failRename = false;
    await mockFsRename(async (actual, from, to) => {
      if (failRename) throw new Error('disk unavailable');
      return actual(from, to);
    });
    await writeDocumentOnDisk(BROWSER_ACCESS_PREFS);
    const { deleteRetiredLocalPrefs, setLocalPref } = await import('../local-prefs');
    failRename = true;
    await expect(deleteRetiredLocalPrefs()).resolves.toBeUndefined();
    expect(await readDocumentOnDisk()).toEqual(BROWSER_ACCESS_PREFS);
    failRename = false;
    await setLocalPref('dockLabEnabled', true);
    await deleteRetiredLocalPrefs();
    expect(await readDocumentOnDisk()).toEqual({ dockLabEnabled: true });
  });

  it('writes are serialized (no torn file with concurrent setters)', async () => {
    const { setLocalPref, getLocalPref } = await import('../local-prefs');
    await Promise.all([
      setLocalPref('lastUpdateCheckDay', '2026-11-18'),
      setLocalPref('lastUpdateWeek', '2026-W47'),
      setLocalPref('lastUpdateMonth', '2026-11'),
    ]);
    expect(await getLocalPref('lastUpdateCheckDay')).toBe('2026-11-18');
    expect(await getLocalPref('lastUpdateWeek')).toBe('2026-W47');
    expect(await getLocalPref('lastUpdateMonth')).toBe('2026-11');
  });

  it('a reader interleaved between the temp write and the rename sees the previous complete document', async () => {
    let gate: { started: () => void; release: Promise<void> } | null = null;
    await mockFsRename(async (actual, from, to) => {
      if (gate) {
        gate.started();
        await gate.release;
      }
      return actual(from, to);
    });
    const { setLocalPref, getLocalPref } = await import('../local-prefs');
    await setLocalPref('backendClientId', 'v1');

    let started!: () => void;
    let release!: () => void;
    const renameStarted = new Promise<void>((resolve) => (started = resolve));
    gate = { started, release: new Promise<void>((resolve) => (release = resolve)) };

    const inflight = setLocalPref('backendClientId', 'v2');
    await renameStarted;

    const midWriteEntries = await fs.readdir(tmpDir);
    expect(midWriteEntries).toContain('local-prefs.json');
    expect(midWriteEntries.some((name) => name.endsWith('.tmp'))).toBe(true);
    expect(await readDocumentOnDisk()).toEqual({ backendClientId: 'v1' });
    expect(await getLocalPref('backendClientId')).toBe('v1');

    release();
    await inflight;
    expect(await readDocumentOnDisk()).toEqual({ backendClientId: 'v2' });
    expect(await getLocalPref('backendClientId')).toBe('v2');
    expect(await fs.readdir(tmpDir)).toEqual(['local-prefs.json']);
  });

  it('a failed rename leaves the previous file intact and no stray temp file', async () => {
    let failRename = false;
    await mockFsRename(async (actual, from, to) => {
      if (failRename) {
        throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
      }
      return actual(from, to);
    });
    const { setLocalPref, getLocalPref } = await import('../local-prefs');
    await setLocalPref('backendClientId', 'v1');

    failRename = true;
    await setLocalPref('backendClientId', 'v2');

    expect(await readDocumentOnDisk()).toEqual({ backendClientId: 'v1' });
    expect(await getLocalPref('backendClientId')).toBe('v1');
    expect(await fs.readdir(tmpDir)).toEqual(['local-prefs.json']);
  });

  it('malformed JSON on disk yields an empty map (defensive)', async () => {
    const target = path.join(tmpDir, 'local-prefs.json');
    await fs.writeFile(target, 'not json at all', 'utf8');
    const { getLocalPref } = await import('../local-prefs');
    expect(await getLocalPref('featureCodes')).toBeUndefined();
  });

  it('does not read the legacy electron-store file (fresh-start posture)', async () => {
    // No `config.json` (the electron-store default name) exists in userData;
    // the helper never touches it. Just assert the fresh-start default.
    const { getLocalPref } = await import('../local-prefs');
    expect(await getLocalPref('betaUpdatesEnabled')).toBeUndefined();
  });
});
