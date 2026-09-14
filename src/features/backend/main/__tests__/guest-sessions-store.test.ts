import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import { promises as mutableFs } from 'fs';
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
    expect(rec.workspaces).toEqual([]);
    expect(JSON.stringify(await store.list())).not.toContain('guest-secret');
  });

  it('add() records the admitted workspace and a re-join merges by id, retitling in place', async () => {
    const store = await import('../guest-sessions-store');
    const first = await store.add({ ...sample, workspace: { id: 'ws-1', title: 'Design' } });
    expect(first.workspaces).toEqual([{ id: 'ws-1', title: 'Design' }]);

    const second = await store.add({ ...sample, workspace: { id: 'ws-2', title: 'Release' } });
    expect(second.id).toBe(first.id);
    expect(second.workspaces).toEqual([
      { id: 'ws-1', title: 'Design' },
      { id: 'ws-2', title: 'Release' },
    ]);

    const retitled = await store.add({ ...sample, workspace: { id: 'ws-1', title: 'Design v2' } });
    expect(retitled.workspaces).toEqual([
      { id: 'ws-1', title: 'Design v2' },
      { id: 'ws-2', title: 'Release' },
    ]);
    // The list is a local detail: the keychain sync record does not carry it.
    const [sync] = await store.listSyncRecords();
    expect(sync).not.toHaveProperty('workspaces');
  });

  it('leaveWorkspace() drops one workspace, keeps the session at zero, persists once and notifies', async () => {
    const store = await import('../guest-sessions-store');
    const listener = vi.fn();
    store.onGuestSessionsMutated(listener);
    const rec = await store.add({ ...sample, workspace: { id: 'ws-1', title: 'Design' } });
    await store.add({ ...sample, workspace: { id: 'ws-2', title: 'Release' } });
    listener.mockClear();

    expect(await store.leaveWorkspace(rec.id, 'ws-1')).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(await store.findById(rec.id)).toMatchObject({
      workspaces: [{ id: 'ws-2', title: 'Release' }],
    });

    expect(await store.leaveWorkspace(rec.id, 'ws-1')).toBe(false);
    expect(await store.leaveWorkspace('missing', 'ws-2')).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);

    expect(await store.leaveWorkspace(rec.id, 'ws-2')).toBe(true);
    const [session] = await store.list();
    expect(session.id).toBe(rec.id);
    expect(session.workspaces).toEqual([]);
    expect(await store.getDecryptedToken(rec.id)).toBe('guest-secret');
  });

  it('reads rows written before the workspace list existed as having no workspaces', async () => {
    const store = await import('../guest-sessions-store');
    const rec = await store.add(sample);
    await store.__drainWriteChainForTesting();
    const file = await readFile();
    const sessions = file.sessions as Array<Record<string, unknown>>;
    delete sessions[0].workspaces;
    await fs.writeFile(path.join(tmpDir, 'guest-sessions.json'), JSON.stringify(file));
    vi.resetModules();
    mockElectron();
    const reloaded = await import('../guest-sessions-store');
    expect(await reloaded.findById(rec.id)).toMatchObject({ workspaces: [] });
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

  it('falls back to flagged plaintext when safeStorage is unavailable', async () => {
    encryptionAvailable = false;
    const store = await import('../guest-sessions-store');
    const rec = await store.add(sample);
    const raw = await readFile();
    const sessions = raw.sessions as Array<{ encToken: { encrypted: boolean; value: string } }>;
    expect(sessions[0].encToken).toEqual({ encrypted: false, value: 'guest-secret' });
    expect(await store.getDecryptedToken(rec.id)).toBe('guest-secret');
    // The token-free record carries the flag so the fallback is never silent.
    expect(rec.tokenEncrypted).toBe(false);
    expect((await store.list())[0].tokenEncrypted).toBe(false);
  });

  it('reports tokenEncrypted: true for a safeStorage-encrypted credential', async () => {
    const store = await import('../guest-sessions-store');
    const rec = await store.add(sample);
    expect(rec.tokenEncrypted).toBe(true);
    expect((await store.findById(rec.id))?.tokenEncrypted).toBe(true);
  });

  it('a re-join never downgrades an encrypted credential to plaintext (fails closed)', async () => {
    const store = await import('../guest-sessions-store');
    const first = await store.add(sample);
    encryptionAvailable = false;
    await expect(store.add({ ...sample, token: 'replacement-secret' })).rejects.toMatchObject({
      code: 'guest-encryption-unavailable',
    });
    const raw = await readFile();
    const sessions = raw.sessions as Array<{ id: string; encToken: { encrypted: boolean } }>;
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(first.id);
    expect(sessions[0].encToken.encrypted).toBe(true);
    expect(await store.getDecryptedToken(first.id)).toBe('guest-secret');
    // A plaintext record may be refreshed with plaintext, and upgraded once
    // encryption is back.
    await store.forget(first.id);
    const plain = await store.add(sample);
    expect(plain.tokenEncrypted).toBe(false);
    const refreshed = await store.add({ ...sample, token: 'still-plain' });
    expect(refreshed.id).toBe(plain.id);
    expect(refreshed.tokenEncrypted).toBe(false);
    encryptionAvailable = true;
    const upgraded = await store.add({ ...sample, token: 'now-encrypted' });
    expect(upgraded.id).toBe(plain.id);
    expect(upgraded.tokenEncrypted).toBe(true);
    expect(await store.getDecryptedToken(plain.id)).toBe('now-encrypted');
  });

  it('a corrupt registry file is never overwritten: reads are empty, mutations fail closed', async () => {
    const file = path.join(tmpDir, 'guest-sessions.json');
    await fs.writeFile(file, '{"sessions": [ this is not json', 'utf8');
    const before = await fs.readFile(file, 'utf8');
    const store = await import('../guest-sessions-store');
    expect(await store.list()).toEqual([]);
    expect(await store.findById('x')).toBeNull();
    expect(await store.getDecryptedToken('x')).toBeNull();
    await expect(store.add(sample)).rejects.toMatchObject({ code: 'guest-store-corrupt' });
    await expect(store.setHostname('x', 'h')).rejects.toMatchObject({
      code: 'guest-store-corrupt',
    });
    await expect(store.forget('x')).rejects.toMatchObject({ code: 'guest-store-corrupt' });
    expect(await fs.readFile(file, 'utf8')).toBe(before);
    expect(await fs.readdir(tmpDir)).toEqual(['guest-sessions.json']);
  });

  it('a registry whose top level is not an object is corrupt too', async () => {
    const file = path.join(tmpDir, 'guest-sessions.json');
    await fs.writeFile(file, '[1, 2, 3]', 'utf8');
    const store = await import('../guest-sessions-store');
    await expect(store.add(sample)).rejects.toMatchObject({ code: 'guest-store-corrupt' });
    expect(await fs.readFile(file, 'utf8')).toBe('[1, 2, 3]');
  });

  it.each([
    ['missing registry arrays', {}],
    ['a sessions field that is not an array', { sessions: { recoverable: true }, tombstones: [] }],
    ['a malformed session row', { sessions: [{ id: 'recoverable' }], tombstones: [] }],
    ['a malformed tombstone row', { sessions: [], tombstones: [{ id: 'recoverable' }] }],
  ])(
    'valid JSON with %s is corrupt: mutations refuse and the bytes are preserved',
    async (_name, contents) => {
      const file = path.join(tmpDir, 'guest-sessions.json');
      const original = JSON.stringify(contents);
      await fs.writeFile(file, original, 'utf8');
      const store = await import('../guest-sessions-store');
      await expect(store.add(sample)).rejects.toMatchObject({ code: 'guest-store-corrupt' });
      await expect(store.forget('recoverable')).rejects.toMatchObject({
        code: 'guest-store-corrupt',
      });
      expect(await fs.readFile(file, 'utf8')).toBe(original);
      expect(await fs.readdir(tmpDir)).toEqual(['guest-sessions.json']);
    },
  );

  it('a malformed row next to a valid one blocks every mutation but keeps the valid one readable', async () => {
    const store = await import('../guest-sessions-store');
    const stored = await store.add(sample);
    const file = path.join(tmpDir, 'guest-sessions.json');
    const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as {
      sessions: Array<{ encToken: { encrypted: unknown } }>;
    };
    const malformed = structuredClone(parsed.sessions[0]) as Record<string, unknown> & {
      encToken: { encrypted: unknown };
    };
    malformed.id = 'other';
    malformed.fingerprint = 'DD:EE:FF';
    malformed.encToken.encrypted = 'true';
    parsed.sessions.push(malformed);
    const original = JSON.stringify(parsed);
    await fs.writeFile(file, original, 'utf8');

    expect((await store.list()).map((r) => r.id)).toEqual([stored.id]);
    expect(await store.getDecryptedToken(stored.id)).toBe(sample.token);
    await expect(store.add({ ...sample, fingerprint: 'DD:EE:FF' })).rejects.toMatchObject({
      code: 'guest-store-corrupt',
    });
    await expect(store.forget(stored.id)).rejects.toMatchObject({ code: 'guest-store-corrupt' });
    expect(await fs.readFile(file, 'utf8')).toBe(original);
  });

  it('writes land atomically: a reader racing a write never sees a truncated registry', async () => {
    const store = await import('../guest-sessions-store');
    const record = await store.add(sample);
    const target = path.join(tmpDir, 'guest-sessions.json');
    const realWrite = mutableFs.writeFile;
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>((resolve) => (release = resolve));
    const started = new Promise<void>((resolve) => (entered = resolve));
    const spy = vi.spyOn(mutableFs, 'writeFile').mockImplementationOnce(async (...args) => {
      // Simulate the slow, partially-flushed write: the destination path
      // handed to writeFile must never be the live registry.
      expect(String(args[0])).not.toBe(target);
      await realWrite(args[0], '');
      entered();
      await blocked;
      return realWrite(...args);
    });
    const write = store.setHostname(record.id, 'changed-host');
    try {
      await started;
      const midWrite = await store.findById(record.id);
      expect(midWrite).not.toBeNull();
      expect(midWrite?.hostname).toBeNull();
    } finally {
      release();
      await write;
      spy.mockRestore();
    }
    expect((await store.findById(record.id))?.hostname).toBe('changed-host');
    // No temp file survives a completed write.
    expect(await fs.readdir(tmpDir)).toEqual(['guest-sessions.json']);
  });

  it('a failed write leaves the registry intact and no temp file behind', async () => {
    const store = await import('../guest-sessions-store');
    const record = await store.add(sample);
    const before = await fs.readFile(path.join(tmpDir, 'guest-sessions.json'), 'utf8');
    const spy = vi.spyOn(mutableFs, 'rename').mockRejectedValueOnce(new Error('ENOSPC'));
    try {
      await expect(store.setHostname(record.id, 'changed-host')).rejects.toThrow('ENOSPC');
    } finally {
      spy.mockRestore();
    }
    expect(await fs.readFile(path.join(tmpDir, 'guest-sessions.json'), 'utf8')).toBe(before);
    expect(await fs.readdir(tmpDir)).toEqual(['guest-sessions.json']);
  });

  it('notifies onGuestCredentialReplaced with the id only when a re-join replaces a session', async () => {
    const store = await import('../guest-sessions-store');
    const replaced: string[] = [];
    const off = store.onGuestCredentialReplaced((id) => replaced.push(id));
    const first = await store.add(sample);
    expect(replaced).toEqual([]);
    await store.setHostname(first.id, 'studio');
    expect(replaced).toEqual([]);
    await store.add({ ...sample, token: 'newer-secret', principalId: 'prn_8' });
    expect(replaced).toEqual([first.id]);
    off();
    await store.add({ ...sample, token: 'even-newer' });
    expect(replaced).toEqual([first.id]);
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

  it('setTcAddress() persists conclusively, skips unchanged writes, and out-clocks the record', async () => {
    const store = await import('../guest-sessions-store');
    const rec = await store.add({ ...sample, tcAddress: 'invite-time.tailcat.net' });
    const mutated = vi.fn();
    store.onGuestSessionsMutated(mutated);
    expect(await store.setTcAddress(rec.id, 'invite-time.tailcat.net')).toBe(false);
    expect(await store.setTcAddress(rec.id, ' tc7f2a91.tailcat.net ')).toBe(true);
    const refreshed = await store.findById(rec.id);
    expect(refreshed).toMatchObject({ tcAddress: 'tc7f2a91.tailcat.net' });
    expect(refreshed!.updatedAt).toBeGreaterThan(rec.updatedAt);
    // A successful answer without a tunnel clears the stale address.
    expect(await store.setTcAddress(rec.id, null)).toBe(true);
    expect(await store.setTcAddress(rec.id, '')).toBe(false);
    expect(await store.setTcAddress('missing', 'x')).toBe(false);
    expect((await store.findById(rec.id))?.tcAddress).toBeNull();
    expect(mutated).toHaveBeenCalledTimes(2);
    expect(await store.listSyncRecords()).toEqual([expect.objectContaining({ tcAddress: null })]);
  });

  it('setHosts() replaces the invite-time candidates, keeps the primary first, and skips no-ops', async () => {
    const store = await import('../guest-sessions-store');
    const rec = await store.add(sample);
    const mutated = vi.fn();
    store.onGuestSessionsMutated(mutated);
    expect(await store.setHosts(rec.id, ['10.0.0.5', '10.0.0.5', sample.host])).toBe(true);
    expect(await store.setHosts(rec.id, ['10.0.0.5'])).toBe(false);
    expect(await store.setHosts('missing', ['10.0.0.5'])).toBe(false);
    const refreshed = await store.findById(rec.id);
    expect(refreshed?.hosts).toEqual([sample.host, '10.0.0.5']);
    expect(refreshed!.updatedAt).toBeGreaterThan(rec.updatedAt);
    expect(mutated).toHaveBeenCalledOnce();
    // The current interfaces replace the invite-time list wholesale.
    expect(await store.setHosts(rec.id, ['172.16.0.9'])).toBe(true);
    expect((await store.findById(rec.id))?.hosts).toEqual([sample.host, '172.16.0.9']);
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
    const replaced = vi.fn();
    store.onGuestSessionsMutated(listener);
    store.onGuestCredentialReplaced(replaced);
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
    expect(replaced).not.toHaveBeenCalled();
    const [rec] = await store.list();
    expect(rec).toMatchObject({ label: 'remote', hostname: 'remote.local', principalId: 'prn_9' });
    expect(await store.getDecryptedToken(rec.id)).toBe('remote-secret');
  });

  it('applyRemoteSyncRecord() replacing a live credential notifies onGuestCredentialReplaced', async () => {
    const store = await import('../guest-sessions-store');
    const first = await store.add(sample);
    const replaced = vi.fn();
    store.onGuestCredentialReplaced(replaced);
    const [remote] = await store.listSyncRecords();
    const changed = await store.applyRemoteSyncRecord({
      ...remote,
      token: 'synced-replacement',
      updatedAt: remote.updatedAt + 1,
    });
    expect(changed).toBe(true);
    expect(replaced).toHaveBeenCalledExactlyOnceWith(first.id);
    expect(await store.getDecryptedToken(first.id)).toBe('synced-replacement');
  });

  it('a local re-join out-clocks a clock-ahead record pulled from another device', async () => {
    const store = await import('../guest-sessions-store');
    const first = await store.add(sample);
    const [remote] = await store.listSyncRecords();
    const ahead = Date.now() + 60 * 60 * 1000;
    await store.applyRemoteSyncRecord({ ...remote, token: 'remote-token', updatedAt: ahead });
    expect(await store.getDecryptedToken(first.id)).toBe('remote-token');

    // The local re-join must win the next LWW reconcile against that record,
    // or the old remote credential would overwrite the fresh one.
    const rejoined = await store.add({ ...sample, token: 'fresh-token', principalId: 'prn_9' });
    expect(rejoined.id).toBe(first.id);
    expect(rejoined.updatedAt).toBeGreaterThan(ahead);
    const [synced] = await store.listSyncRecords();
    expect(synced).toMatchObject({ token: 'fresh-token', principalId: 'prn_9' });
    expect(synced.updatedAt).toBe(rejoined.updatedAt);
  });

  it('applyRemoteSyncRecord() that is refused as a downgrade notifies nobody', async () => {
    const store = await import('../guest-sessions-store');
    const first = await store.add(sample);
    const replaced = vi.fn();
    store.onGuestCredentialReplaced(replaced);
    const [remote] = await store.listSyncRecords();
    encryptionAvailable = false;
    expect(
      await store.applyRemoteSyncRecord({
        ...remote,
        token: 'plain-replacement',
        updatedAt: remote.updatedAt + 1,
      }),
    ).toBe(false);
    expect(replaced).not.toHaveBeenCalled();
    expect((await store.findById(first.id))?.tokenEncrypted).toBe(true);
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
    const removed = vi.fn();
    const mutated = vi.fn();
    store.onGuestSessionRemovedBySync(removed);
    store.onGuestSessionsMutated(mutated);
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
    // The pool is told which live session went away; a pull never loops back
    // into a push.
    expect(removed).toHaveBeenCalledExactlyOnceWith(rec.id);
    expect(mutated).not.toHaveBeenCalled();
    const sync = await store.listSyncRecords();
    expect(sync).toEqual([expect.objectContaining({ deleted: true, fingerprint: 'aa:bb:cc' })]);
  });

  it('a tombstone matching no live session notifies no removal, and a local forget never does', async () => {
    const store = await import('../guest-sessions-store');
    const removed = vi.fn();
    store.onGuestSessionRemovedBySync(removed);
    const rec = await store.add(sample);
    await store.forget(rec.id);
    const [tomb] = await store.listSyncRecords();
    expect(await store.applyRemoteSyncRecord({ ...tomb, updatedAt: tomb.updatedAt + 1 })).toBe(
      false,
    );
    expect(removed).not.toHaveBeenCalled();
  });
});
