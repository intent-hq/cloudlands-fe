import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

/**
 * Round-trip tests for the guest sessions store
 * (features/backend/main/guest-sessions-store.ts).
 *
 * The store persists daemons joined as a GUEST (invite.redeem credentials)
 * to `guest-sessions.json` under `app.getPath('userData')`, separate from
 * the owner registry, encrypting the token via `safeStorage` when available.
 */

let tmpDir: string;
let encryptionAvailable = true;

function mockElectron() {
  vi.doMock('electron', () => ({
    app: { getPath: () => tmpDir },
    safeStorage: {
      isEncryptionAvailable: () => encryptionAvailable,
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
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guest-sessions-'));
  encryptionAvailable = true;
  vi.resetModules();
  mockElectron();
});

afterEach(async () => {
  const mod = await import('../guest-sessions-store');
  await mod.__drainWriteChainForTesting();
  await fs.rm(tmpDir, { recursive: true, force: true });
  vi.doUnmock('electron');
});

const sample = {
  label: 'studio.local',
  host: '192.168.1.10',
  hosts: ['192.168.1.10', '10.0.0.5', '127.0.0.1'],
  port: 8443,
  fingerprint: 'AA:BB:CC',
  tcAddress: null,
  principalId: 'prn_7',
  login: 'octocat',
  token: 'guest-secret',
};

async function readFile(): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(path.join(tmpDir, 'guest-sessions.json'), 'utf8'));
}

describe('guest-sessions-store', () => {
  it('starts empty and never writes the owner registry file', async () => {
    const store = await import('../guest-sessions-store');
    expect(await store.list()).toEqual([]);
    await store.add(sample);
    const files = await fs.readdir(tmpDir);
    expect(files).toEqual(['guest-sessions.json']);
  });

  it('add() returns a token-free record with candidate hosts and principal identity', async () => {
    const store = await import('../guest-sessions-store');
    const rec = await store.add(sample);
    expect(rec).toMatchObject({
      label: 'studio.local',
      host: '192.168.1.10',
      hosts: ['192.168.1.10', '10.0.0.5'],
      port: 8443,
      fingerprint: 'AA:BB:CC',
      tcAddress: null,
      hostname: null,
      principalId: 'prn_7',
      login: 'octocat',
    });
    expect(typeof rec.id).toBe('string');
    expect(rec).not.toHaveProperty('token');
    expect(JSON.stringify(await store.list())).not.toContain('guest-secret');
  });

  it('encrypts the token at rest and decrypts it on demand', async () => {
    const store = await import('../guest-sessions-store');
    const rec = await store.add(sample);
    const raw = await readFile();
    const sessions = raw.sessions as Array<{ encToken: { encrypted: boolean; value: string } }>;
    expect(sessions[0].encToken.encrypted).toBe(true);
    expect(JSON.stringify(raw)).not.toContain('guest-secret');
    expect(await store.getDecryptedToken(rec.id)).toBe('guest-secret');
    expect(await store.getDecryptedToken('nope')).toBeNull();
  });

  it('falls back to plaintext with an explicit marker when safeStorage is unavailable', async () => {
    encryptionAvailable = false;
    const store = await import('../guest-sessions-store');
    const rec = await store.add(sample);
    const raw = await readFile();
    const sessions = raw.sessions as Array<{ encToken: { encrypted: boolean; value: string } }>;
    expect(sessions[0].encToken).toEqual({ encrypted: false, value: 'guest-secret' });
    expect(await store.getDecryptedToken(rec.id)).toBe('guest-secret');
  });

  it('throws a coded error when the ciphertext no longer decrypts', async () => {
    const store = await import('../guest-sessions-store');
    const rec = await store.add(sample);
    vi.resetModules();
    vi.doMock('electron', () => ({
      app: { getPath: () => tmpDir },
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (s: string) => Buffer.from(s),
        decryptString: () => {
          throw new Error('keyring changed');
        },
      },
    }));
    const reloaded = await import('../guest-sessions-store');
    await expect(reloaded.getDecryptedToken(rec.id)).rejects.toMatchObject({
      code: 'guest-secret-unavailable',
    });
  });

  it('re-joining the same daemon upserts in place (same id, fresh token and identity)', async () => {
    const store = await import('../guest-sessions-store');
    const first = await store.add(sample);
    const second = await store.add({
      ...sample,
      host: '10.9.9.9',
      hosts: ['10.9.9.9'],
      login: 'hubot',
      principalId: 'prn_8',
      token: 'newer-secret',
    });
    expect(second.id).toBe(first.id);
    expect(await store.list()).toHaveLength(1);
    expect(second).toMatchObject({ host: '10.9.9.9', login: 'hubot', principalId: 'prn_8' });
    expect(await store.getDecryptedToken(first.id)).toBe('newer-secret');
  });

  it('falls back to host:port identity when the stored record has no fingerprint', async () => {
    const store = await import('../guest-sessions-store');
    const first = await store.add({ ...sample, fingerprint: '' });
    const second = await store.add({ ...sample, fingerprint: 'DD:EE:FF' });
    expect(second.id).toBe(first.id);
    expect(second.fingerprint).toBe('DD:EE:FF');
  });

  it('findMatching() resolves by fingerprint first, then by any candidate host:port', async () => {
    const store = await import('../guest-sessions-store');
    const rec = await store.add(sample);
    expect(
      await store.findMatching({ hosts: ['203.0.113.1'], port: 1, fingerprint: 'aabbcc' }),
    ).toMatchObject({ id: rec.id });
    expect(
      await store.findMatching({
        hosts: ['203.0.113.1', '192.168.1.10'],
        port: 8443,
        fingerprint: null,
      }),
    ).toMatchObject({ id: rec.id });
    expect(
      await store.findMatching({ hosts: ['203.0.113.1'], port: 8443, fingerprint: '11:22:33' }),
    ).toBeNull();
  });

  it('setHostname() persists once and reports no-ops', async () => {
    const store = await import('../guest-sessions-store');
    const rec = await store.add(sample);
    expect(await store.setHostname(rec.id, ' studio ')).toBe(true);
    expect(await store.setHostname(rec.id, 'studio')).toBe(false);
    expect(await store.setHostname(rec.id, '')).toBe(false);
    expect(await store.setHostname('missing', 'x')).toBe(false);
    expect(await store.findById(rec.id)).toMatchObject({ hostname: 'studio' });
  });

  it('forget() removes the session, leaves a tombstone, and notifies local listeners', async () => {
    const store = await import('../guest-sessions-store');
    const listener = vi.fn();
    store.onGuestSessionsMutated(listener);
    const rec = await store.add(sample);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(await store.forget(rec.id)).toBe(true);
    expect(await store.forget(rec.id)).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(await store.list()).toEqual([]);
    const sync = await store.listSyncRecords();
    expect(sync).toHaveLength(1);
    expect(sync[0]).toMatchObject({
      deleted: true,
      token: '',
      fingerprint: 'AA:BB:CC',
      principalId: 'prn_7',
      login: 'octocat',
    });
  });

  it('a re-join after forget clears the tombstone and stamps past it', async () => {
    const store = await import('../guest-sessions-store');
    const rec = await store.add(sample);
    await store.forget(rec.id);
    const [tomb] = await store.listSyncRecords();
    const again = await store.add(sample);
    const sync = await store.listSyncRecords();
    expect(sync).toHaveLength(1);
    expect(sync[0]).toMatchObject({ token: 'guest-secret' });
    expect(sync[0].deleted).toBeUndefined();
    expect(again.updatedAt).toBeGreaterThan(tomb.updatedAt);
  });

  it('ignores malformed rows on disk', async () => {
    const store = await import('../guest-sessions-store');
    await fs.writeFile(
      path.join(tmpDir, 'guest-sessions.json'),
      JSON.stringify({ sessions: [{ id: 'x' }, 42], tombstones: ['nope'] }),
    );
    expect(await store.list()).toEqual([]);
  });
});

describe('guest-sessions-store keychain sync adapter', () => {
  it('listSyncRecords() carries principal identity and the plaintext token', async () => {
    const store = await import('../guest-sessions-store');
    await store.add(sample);
    const [rec] = await store.listSyncRecords();
    expect(rec).toMatchObject({
      label: 'studio.local',
      host: '192.168.1.10',
      hosts: ['192.168.1.10', '10.0.0.5'],
      port: 8443,
      fingerprint: 'AA:BB:CC',
      token: 'guest-secret',
      principalId: 'prn_7',
      login: 'octocat',
      detectHosts: false,
    });
  });

  it('applyRemoteSyncRecord() inserts a live record without notifying local listeners', async () => {
    const store = await import('../guest-sessions-store');
    const listener = vi.fn();
    store.onGuestSessionsMutated(listener);
    const changed = await store.applyRemoteSyncRecord({
      label: 'remote',
      host: '10.1.1.1',
      hosts: ['10.1.1.1'],
      port: 9000,
      fingerprint: '11:22:33',
      hostname: 'remote.local',
      tcAddress: null,
      detectHosts: false,
      token: 'remote-secret',
      principalId: 'prn_9',
      login: 'octocat',
      updatedAt: 1_700_000_000_000,
    });
    expect(changed).toBe(true);
    expect(listener).not.toHaveBeenCalled();
    const [rec] = await store.list();
    expect(rec).toMatchObject({ label: 'remote', hostname: 'remote.local', principalId: 'prn_9' });
    expect(await store.getDecryptedToken(rec.id)).toBe('remote-secret');
  });

  it('applyRemoteSyncRecord() rejects records lacking principal identity', async () => {
    const store = await import('../guest-sessions-store');
    const changed = await store.applyRemoteSyncRecord({
      label: 'owner-shaped',
      host: '10.1.1.1',
      hosts: ['10.1.1.1'],
      port: 9000,
      fingerprint: '11:22:33',
      hostname: null,
      tcAddress: null,
      detectHosts: true,
      token: 'owner-secret',
      updatedAt: 1_700_000_000_000,
    });
    expect(changed).toBe(false);
    expect(await store.list()).toEqual([]);
  });

  it('applyRemoteSyncRecord() tombstone deletes the matching session by fingerprint', async () => {
    const store = await import('../guest-sessions-store');
    const rec = await store.add(sample);
    const changed = await store.applyRemoteSyncRecord({
      label: 'studio.local',
      host: '203.0.113.9',
      hosts: ['203.0.113.9'],
      port: 1,
      fingerprint: 'aa:bb:cc',
      hostname: null,
      tcAddress: null,
      detectHosts: false,
      token: '',
      updatedAt: Date.now() + 1000,
      deleted: true,
      deletedAt: Date.now() + 1000,
    });
    expect(changed).toBe(true);
    expect(await store.findById(rec.id)).toBeNull();
    const sync = await store.listSyncRecords();
    expect(sync).toEqual([expect.objectContaining({ deleted: true, fingerprint: 'aa:bb:cc' })]);
  });
});
