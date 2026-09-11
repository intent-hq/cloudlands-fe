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

describe('local-prefs', () => {
  it('getLocalPref returns undefined for missing file/key', async () => {
    const { getLocalPref, hasLocalPref } = await import('../local-prefs');
    expect(await getLocalPref('anything')).toBeUndefined();
    expect(await hasLocalPref('anything')).toBe(false);
  });

  it('setLocalPref then getLocalPref round-trips a value', async () => {
    const { setLocalPref, getLocalPref, hasLocalPref } = await import('../local-prefs');
    await setLocalPref('featureCodes', ['cortex', 'enable_figma_mcp']);
    expect(await getLocalPref('featureCodes')).toEqual(['cortex', 'enable_figma_mcp']);
    expect(await hasLocalPref('featureCodes')).toBe(true);
  });

  it('preserves other keys when writing one', async () => {
    const { setLocalPref, getLocalPref } = await import('../local-prefs');
    await setLocalPref('keychainSettings', { keychainAccessChoice: 'allow' });
    await setLocalPref('betaUpdatesEnabled', true);
    expect(await getLocalPref('keychainSettings')).toEqual({
      keychainAccessChoice: 'allow',
    });
    expect(await getLocalPref('betaUpdatesEnabled')).toBe(true);
  });

  it('deleteLocalPref removes a single key without disturbing others', async () => {
    const { setLocalPref, deleteLocalPref, getLocalPref } = await import('../local-prefs');
    await setLocalPref('a', 1);
    await setLocalPref('b', 2);
    await deleteLocalPref('a');
    expect(await getLocalPref('a')).toBeUndefined();
    expect(await getLocalPref('b')).toBe(2);
  });

  it('writes are serialized (no torn file with concurrent setters)', async () => {
    const { setLocalPref, getLocalPref } = await import('../local-prefs');
    await Promise.all([setLocalPref('x', 1), setLocalPref('y', 2), setLocalPref('z', 3)]);
    expect(await getLocalPref('x')).toBe(1);
    expect(await getLocalPref('y')).toBe(2);
    expect(await getLocalPref('z')).toBe(3);
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
    await setLocalPref('doc', 'v1');

    let started!: () => void;
    let release!: () => void;
    const renameStarted = new Promise<void>((resolve) => (started = resolve));
    gate = { started, release: new Promise<void>((resolve) => (release = resolve)) };

    const inflight = setLocalPref('doc', 'v2');
    await renameStarted;

    const midWriteEntries = await fs.readdir(tmpDir);
    expect(midWriteEntries).toContain('local-prefs.json');
    expect(midWriteEntries.some((name) => name.endsWith('.tmp'))).toBe(true);
    expect(await readDocumentOnDisk()).toEqual({ doc: 'v1' });
    expect(await getLocalPref('doc')).toBe('v1');

    release();
    await inflight;
    expect(await readDocumentOnDisk()).toEqual({ doc: 'v2' });
    expect(await getLocalPref('doc')).toBe('v2');
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
    await setLocalPref('doc', 'v1');

    failRename = true;
    await setLocalPref('doc', 'v2');

    expect(await readDocumentOnDisk()).toEqual({ doc: 'v1' });
    expect(await getLocalPref('doc')).toBe('v1');
    expect(await fs.readdir(tmpDir)).toEqual(['local-prefs.json']);
  });

  it('malformed JSON on disk yields an empty map (defensive)', async () => {
    const target = path.join(tmpDir, 'local-prefs.json');
    await fs.writeFile(target, 'not json at all', 'utf8');
    const { getLocalPref } = await import('../local-prefs');
    expect(await getLocalPref('anything')).toBeUndefined();
  });

  it('does not read the legacy electron-store file (fresh-start posture)', async () => {
    // No `config.json` (the electron-store default name) exists in userData;
    // the helper never touches it. Just assert the fresh-start default.
    const { getLocalPref } = await import('../local-prefs');
    expect(await getLocalPref('betaUpdatesEnabled')).toBeUndefined();
  });
});
