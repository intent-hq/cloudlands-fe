import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

/**
 * Round-trip tests for the multi-backend connections store
 * (features/backend/main/connections-store.ts).
 *
 * The store persists remote intentd connections + the active selection to
 * `backend-connections.json` under `app.getPath('userData')`, encrypting the
 * bearer token via Electron `safeStorage` when available (plaintext fallback
 * otherwise). A synthesized, non-forgettable "This machine (local)" entry is
 * always first. `safeStorage` is mocked per-suite to exercise both paths.
 */

let tmpDir: string;

/** Toggle used by the mocked safeStorage across suites. */
let encryptionAvailable = true;

function mockElectron() {
  vi.doMock('electron', () => ({
    app: { getPath: () => tmpDir },
    safeStorage: {
      isEncryptionAvailable: () => encryptionAvailable,
      // Reversible "encryption" so tests can assert round-trip + at-rest ciphertext.
      encryptString: (s: string) => Buffer.from(`enc:${s}`, 'utf8'),
      decryptString: (b: Buffer) => b.toString('utf8').replace(/^enc:/, ''),
    },
  }));
  vi.doMock('../../../shared/logger', () => ({
    Logger: class {
      debug() {}
      info() {}
      warn() {}
      error() {}
    },
  }));
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'backend-connections-'));
  encryptionAvailable = true;
  vi.resetModules();
  mockElectron();
});

afterEach(async () => {
  const mod = await import('../connections-store');
  await mod.__drainWriteChainForTesting();
  await fs.rm(tmpDir, { recursive: true, force: true });
  vi.doUnmock('electron');
});

const sampleConn = {
  label: 'Studio Mac',
  host: '192.168.1.10',
  port: 8443,
  fingerprint: 'AA:BB:CC',
  token: 'secret-token',
};

describe('connections-store', () => {
  it('list() synthesizes the local entry first even with an empty store', async () => {
    const store = await import('../connections-store');
    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: store.LOCAL_CONNECTION_ID,
      label: store.LOCAL_CONNECTION_LABEL,
      isLocal: true,
      host: null,
      port: null,
      fingerprint: null,
    });
  });

  it('local entry defaults to the active id', async () => {
    const store = await import('../connections-store');
    expect(await store.getActiveId()).toBe(store.LOCAL_CONNECTION_ID);
  });

  it('add → list round-trips through disk, local stays first, no token leaked', async () => {
    const store = await import('../connections-store');
    const rec = await store.add(sampleConn);
    expect(rec.id).not.toBe(store.LOCAL_CONNECTION_ID);
    expect(rec).not.toHaveProperty('encToken');
    expect(rec).not.toHaveProperty('token');

    const list = await store.list();
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe(store.LOCAL_CONNECTION_ID);
    expect(list[1]).toMatchObject({
      id: rec.id,
      label: 'Studio Mac',
      host: '192.168.1.10',
      port: 8443,
      fingerprint: 'AA:BB:CC',
      isLocal: false,
    });
    expect(list[1]).not.toHaveProperty('token');
    expect(list[1]).not.toHaveProperty('encToken');
  });

  it('forget removes a remote but rejects forgetting local', async () => {
    const store = await import('../connections-store');
    const rec = await store.add(sampleConn);
    await expect(store.forget(store.LOCAL_CONNECTION_ID)).rejects.toThrow();
    // Local still present after the rejected forget.
    expect((await store.list()).some((c) => c.id === store.LOCAL_CONNECTION_ID)).toBe(true);

    await store.forget(rec.id);
    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(store.LOCAL_CONNECTION_ID);
  });

  it('setActiveId persists and forgetting the active one falls back to local', async () => {
    const store = await import('../connections-store');
    const rec = await store.add(sampleConn);
    await store.setActiveId(rec.id);
    expect(await store.getActiveId()).toBe(rec.id);

    await store.forget(rec.id);
    expect(await store.getActiveId()).toBe(store.LOCAL_CONNECTION_ID);
  });

  it('setActiveId rejects an unknown id but accepts local', async () => {
    const store = await import('../connections-store');
    await expect(store.setActiveId('does-not-exist')).rejects.toThrow();
    await store.setActiveId(store.LOCAL_CONNECTION_ID);
    expect(await store.getActiveId()).toBe(store.LOCAL_CONNECTION_ID);
  });

  it('active id persists across a fresh module load (through disk)', async () => {
    const store = await import('../connections-store');
    const rec = await store.add(sampleConn);
    await store.setActiveId(rec.id);
    await store.__drainWriteChainForTesting();

    vi.resetModules();
    mockElectron();
    const reloaded = await import('../connections-store');
    expect(await reloaded.getActiveId()).toBe(rec.id);
    expect((await reloaded.list()).map((c) => c.id)).toContain(rec.id);
  });

  it('getDecryptedToken returns the original token; local has none', async () => {
    const store = await import('../connections-store');
    const rec = await store.add(sampleConn);
    expect(await store.getDecryptedToken(rec.id)).toBe('secret-token');
    expect(await store.getDecryptedToken(store.LOCAL_CONNECTION_ID)).toBeNull();
    expect(await store.getDecryptedToken('unknown')).toBeNull();
  });

  it('token is encrypted at rest when safeStorage is available', async () => {
    const store = await import('../connections-store');
    await store.add(sampleConn);
    await store.__drainWriteChainForTesting();

    const raw = await fs.readFile(path.join(tmpDir, 'backend-connections.json'), 'utf8');
    const parsed = JSON.parse(raw);
    const enc = parsed.connections[0].encToken;
    expect(enc.encrypted).toBe(true);
    expect(enc.value).not.toContain('secret-token');
    // base64 of "enc:secret-token"
    expect(Buffer.from(enc.value, 'base64').toString('utf8')).toBe('enc:secret-token');
  });

  it('falls back to marked plaintext when safeStorage is unavailable', async () => {
    encryptionAvailable = false;
    const store = await import('../connections-store');
    const rec = await store.add(sampleConn);
    await store.__drainWriteChainForTesting();

    const raw = await fs.readFile(path.join(tmpDir, 'backend-connections.json'), 'utf8');
    const parsed = JSON.parse(raw);
    const enc = parsed.connections[0].encToken;
    expect(enc.encrypted).toBe(false);
    expect(enc.value).toBe('secret-token');
    // Still decrypts (identity) via the store API.
    expect(await store.getDecryptedToken(rec.id)).toBe('secret-token');
  });

  it('serializes concurrent adds without losing writes', async () => {
    const store = await import('../connections-store');
    await Promise.all([
      store.add({ ...sampleConn, label: 'A' }),
      store.add({ ...sampleConn, label: 'B' }),
      store.add({ ...sampleConn, label: 'C' }),
    ]);
    const labels = (await store.list())
      .filter((c) => !c.isLocal)
      .map((c) => c.label)
      .sort();
    expect(labels).toEqual(['A', 'B', 'C']);
  });

  it('malformed JSON on disk yields just the local entry (defensive)', async () => {
    await fs.writeFile(path.join(tmpDir, 'backend-connections.json'), 'not json', 'utf8');
    const store = await import('../connections-store');
    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(store.LOCAL_CONNECTION_ID);
    expect(await store.getActiveId()).toBe(store.LOCAL_CONNECTION_ID);
  });
});
