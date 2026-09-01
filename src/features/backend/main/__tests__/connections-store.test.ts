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
      accent: 'blue',
      host: '192.168.1.10',
      port: 8443,
      fingerprint: 'AA:BB:CC',
      isLocal: false,
    });
    expect(list[1]).not.toHaveProperty('token');
    expect(list[1]).not.toHaveProperty('encToken');
  });

  it('preserves explicit blank accents and defaults only records written before accents existed', async () => {
    const store = await import('../connections-store');
    const rec = await store.add({ ...sampleConn, accent: null });
    expect(rec.accent).toBeNull();
    await store.__drainWriteChainForTesting();

    const file = path.join(tmpDir, 'backend-connections.json');
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(parsed.connections[0].accent).toBeNull();

    vi.resetModules();
    mockElectron();
    const blankReloaded = await import('../connections-store');
    expect(
      (await blankReloaded.list()).find((connection) => connection.id === rec.id)?.accent,
    ).toBeNull();

    delete parsed.connections[0].accent;
    await fs.writeFile(file, JSON.stringify(parsed), 'utf8');

    vi.resetModules();
    mockElectron();
    const reloaded = await import('../connections-store');
    expect((await reloaded.list()).find((connection) => connection.id === rec.id)?.accent).toBe(
      'blue',
    );
  });

  it('round-trips an explicit blank through update, sync, and tombstones', async () => {
    const store = await import('../connections-store');
    const rec = await store.add(sampleConn);
    expect(
      await store.updateMetadata(rec.id, { label: sampleConn.label, accent: null }),
    ).toMatchObject({ accent: null });
    expect((await store.listSyncRecords())[0].accent).toBeNull();

    await store.forget(rec.id);
    const tombstone = (await store.listSyncRecords()).find((record) => record.deleted === true);
    expect(tombstone?.accent).toBeNull();
  });

  it('accepts an explicit blank accent through the add and update IPC schemas', async () => {
    const { ConnectionsAddSchema, ConnectionsUpdateSchema } =
      await import('../../../../main/ipc-schemas');
    expect(
      ConnectionsAddSchema.parse({
        label: 'Studio Mac',
        accent: null,
        host: 'studio.local',
        port: 5181,
        fingerprint: 'AA:BB',
        token: 'secret',
      }).accent,
    ).toBeNull();
    expect(
      ConnectionsUpdateSchema.parse({ id: 'remote-1', label: 'Studio Mac', accent: null }).accent,
    ).toBeNull();
  });

  it('updateMetadata changes name and accent without rewriting the bearer token', async () => {
    const store = await import('../connections-store');
    const rec = await store.add(sampleConn);
    await store.__drainWriteChainForTesting();
    const file = path.join(tmpDir, 'backend-connections.json');
    const before = JSON.parse(await fs.readFile(file, 'utf8')).connections[0];

    const updated = await store.updateMetadata(rec.id, {
      label: '  Editing Mac  ',
      accent: 'violet',
    });
    expect(updated).toMatchObject({ id: rec.id, label: 'Editing Mac', accent: 'violet' });
    expect(await store.getDecryptedToken(rec.id)).toBe('secret-token');

    const after = JSON.parse(await fs.readFile(file, 'utf8')).connections[0];
    expect(after.encToken).toEqual(before.encToken);
    expect(after).toMatchObject({ label: 'Editing Mac', accent: 'violet' });
    expect((await store.listSyncRecords())[0]).toMatchObject({
      label: 'Editing Mac',
      accent: 'violet',
    });
  });

  it('updateMetadata rejects local, unknown, blank-name, and invalid-accent updates', async () => {
    const store = await import('../connections-store');
    const rec = await store.add(sampleConn);

    await expect(
      store.updateMetadata(store.LOCAL_CONNECTION_ID, { label: 'Local', accent: 'blue' }),
    ).rejects.toThrow(/local/i);
    await expect(
      store.updateMetadata('missing', { label: 'Missing', accent: 'blue' }),
    ).rejects.toThrow(/unknown/i);
    await expect(store.updateMetadata(rec.id, { label: '   ', accent: 'blue' })).rejects.toThrow(
      /label/i,
    );
    await expect(
      store.updateMetadata(rec.id, { label: 'Studio Mac', accent: 'chartreuse' as never }),
    ).rejects.toThrow(/accent/i);
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

  it('updates remote address metadata while preserving the secret and syncing the old identity tombstone', async () => {
    const store = await import('../connections-store');
    const original = await store.add(sampleConn);

    const updated = await store.updateMetadata(original.id, {
      label: 'Moved Mac',
      accent: 'violet',
      host: '10.0.0.42',
      port: 9443,
      fingerprint: 'DD:EE:FF',
    });

    expect(updated).toMatchObject({
      id: original.id,
      label: 'Moved Mac',
      accent: 'violet',
      host: '10.0.0.42',
      port: 9443,
      fingerprint: 'DD:EE:FF',
    });
    expect(await store.getDecryptedToken(original.id)).toBe(sampleConn.token);
    const syncRecords = await store.listSyncRecords();
    expect(syncRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ host: sampleConn.host, deleted: true }),
        expect.objectContaining({ host: '10.0.0.42' }),
      ]),
    );
  });

  it('deduplicates an updated live identity and preserves the edited record as active', async () => {
    const store = await import('../connections-store');
    const edited = await store.add(sampleConn);
    const duplicate = await store.add({
      ...sampleConn,
      label: 'Duplicate Mac',
      host: 'duplicate.local',
      port: 9443,
      fingerprint: 'dd ee ff',
      token: 'duplicate-token',
    });
    await store.setActiveId(duplicate.id);

    const updated = await store.updateMetadata(edited.id, {
      label: 'Moved Mac',
      accent: 'violet',
      host: 'duplicate.local',
      port: 9443,
      fingerprint: 'DDEEFF',
    });

    expect(updated.id).toBe(edited.id);
    expect((await store.list()).filter((connection) => !connection.isLocal)).toEqual([updated]);
    expect(await store.getActiveId()).toBe(edited.id);
    expect(await store.getDecryptedToken(edited.id)).toBe(sampleConn.token);
  });

  it('clears a matching tombstone when an update adopts that identity', async () => {
    const store = await import('../connections-store');
    const edited = await store.add(sampleConn);
    const removed = await store.add({
      ...sampleConn,
      host: 'removed.local',
      port: 9443,
      fingerprint: '11:22:33',
    });
    await store.forget(removed.id);

    await store.updateMetadata(edited.id, {
      label: edited.label,
      accent: edited.accent ?? 'blue',
      host: 'removed.local',
      port: 9443,
      fingerprint: '112233',
    });

    const syncRecords = await store.listSyncRecords();
    expect(syncRecords).toContainEqual(
      expect.objectContaining({ host: 'removed.local', fingerprint: '112233' }),
    );
    expect(syncRecords).not.toContainEqual(
      expect.objectContaining({ host: 'removed.local', deleted: true }),
    );
  });

  it('replaces only the encrypted secret and validated fingerprint for one remote', async () => {
    const store = await import('../connections-store');
    const original = await store.add(sampleConn);
    const updated = await store.replaceSecret(original.id, 'rotated-token', 'DD:EE:FF');

    expect(updated).toMatchObject({ id: original.id, fingerprint: 'DD:EE:FF' });
    expect(await store.getDecryptedToken(original.id)).toBe('rotated-token');
    expect(updated).not.toHaveProperty('token');
    expect(updated).not.toHaveProperty('encToken');
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
    // Distinct backends (distinct fingerprints AND targets) — same-backend
    // adds intentionally upsert.
    await Promise.all([
      store.add({ ...sampleConn, port: 8443, fingerprint: 'FP:A', label: 'A' }),
      store.add({ ...sampleConn, port: 8444, fingerprint: 'FP:B', label: 'B' }),
      store.add({ ...sampleConn, port: 8445, fingerprint: 'FP:C', label: 'C' }),
    ]);
    const labels = (await store.list())
      .filter((c) => !c.isLocal)
      .map((c) => c.label)
      .sort();
    expect(labels).toEqual(['A', 'B', 'C']);
  });

  it('re-adding an existing host:port upserts in place (same id, fresh token/fingerprint/label)', async () => {
    const store = await import('../connections-store');
    const original = await store.add(sampleConn);
    await store.setHostname(original.id, 'studio.local');

    const updated = await store.add({
      label: 'Renamed Mac',
      host: sampleConn.host,
      port: sampleConn.port,
      fingerprint: 'DD:EE:FF',
      token: 'fresh-token',
    });

    // Same record: id preserved, captured hostname preserved, fields refreshed.
    expect(updated.id).toBe(original.id);
    expect(updated).toMatchObject({
      label: 'Renamed Mac',
      fingerprint: 'DD:EE:FF',
      hostname: 'studio.local',
    });

    // No duplicate: local + the single upserted remote.
    const list = await store.list();
    expect(list).toHaveLength(2);
    expect(list[1]).toMatchObject({
      id: original.id,
      label: 'Renamed Mac',
      fingerprint: 'DD:EE:FF',
    });

    // The stored token was replaced.
    expect(await store.getDecryptedToken(original.id)).toBe('fresh-token');
  });

  it('collapses pre-existing host:port duplicates on add (keeps the first, drops the rest)', async () => {
    // Earlier app versions allowed repeated host:port entries — seed such a
    // file directly (add() itself can no longer produce duplicates).
    await fs.writeFile(
      path.join(tmpDir, 'backend-connections.json'),
      JSON.stringify({
        connections: [
          {
            id: 'dup-1',
            label: 'First',
            host: '192.168.1.10',
            port: 8443,
            fingerprint: 'AA',
            encToken: { encrypted: false, value: 'tok-1' },
          },
          {
            id: 'dup-2',
            label: 'Second',
            host: '192.168.1.10',
            port: 8443,
            fingerprint: 'BB',
            hostname: 'studio.local',
            encToken: { encrypted: false, value: 'tok-2' },
          },
          {
            id: 'other',
            label: 'Other',
            host: '192.168.1.11',
            port: 8443,
            fingerprint: 'CC',
            encToken: { encrypted: false, value: 'tok-3' },
          },
        ],
        activeId: 'local',
      }),
      'utf8',
    );
    const store = await import('../connections-store');

    const updated = await store.add(sampleConn);

    // No duplicate is active → the FIRST match survives, refreshed in place,
    // inheriting the captured hostname from the dropped duplicate.
    expect(updated).toMatchObject({ id: 'dup-1', label: 'Studio Mac', hostname: 'studio.local' });

    // All host:port duplicates collapsed into one; the unrelated record survives.
    const remotes = (await store.list()).filter((c) => !c.isLocal);
    expect(remotes.map((c) => c.id).sort()).toEqual(['dup-1', 'other']);
    expect(await store.getDecryptedToken('dup-1')).toBe('secret-token');
    expect(await store.getDecryptedToken('dup-2')).toBeNull();
  });

  it('collapsing duplicates prefers the ACTIVE duplicate\u2019s id (active re-pair keeps its id)', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'backend-connections.json'),
      JSON.stringify({
        connections: [
          {
            id: 'dup-1',
            label: 'First',
            host: '192.168.1.10',
            port: 8443,
            fingerprint: 'AA',
            encToken: { encrypted: false, value: 'tok-1' },
          },
          {
            id: 'dup-2',
            label: 'Second',
            host: '192.168.1.10',
            port: 8443,
            fingerprint: 'BB',
            encToken: { encrypted: false, value: 'tok-2' },
          },
        ],
        activeId: 'dup-2',
      }),
      'utf8',
    );
    const store = await import('../connections-store');

    const updated = await store.add(sampleConn);

    // The ACTIVE duplicate survives (not the first), so a re-pair of the live
    // backend returns the active id and the caller's active-reconnect path fires.
    expect(updated.id).toBe('dup-2');
    expect(await store.getActiveId()).toBe('dup-2');

    const remotes = (await store.list()).filter((c) => !c.isLocal);
    expect(remotes).toHaveLength(1);
    expect(remotes[0]).toMatchObject({ id: 'dup-2', label: 'Studio Mac', fingerprint: 'AA:BB:CC' });
    expect(await store.getDecryptedToken('dup-2')).toBe('secret-token');
  });

  it('adding a different backend (host:port and fingerprint) still appends a new record', async () => {
    const store = await import('../connections-store');
    const first = await store.add(sampleConn);
    const samePortOtherHost = await store.add({
      ...sampleConn,
      host: '192.168.1.11',
      fingerprint: 'DD:EE:FF',
    });
    const sameHostOtherPort = await store.add({
      ...sampleConn,
      port: 9443,
      fingerprint: '11:22:33',
    });

    expect(samePortOtherHost.id).not.toBe(first.id);
    expect(sameHostOtherPort.id).not.toBe(first.id);
    expect((await store.list()).filter((c) => !c.isLocal)).toHaveLength(3);
  });

  it('re-adding the same fingerprint under a NEW host:port upserts in place (no duplicate)', async () => {
    const store = await import('../connections-store');
    const original = await store.add(sampleConn);
    await store.setHostname(original.id, 'studio.local');
    await store.setHosts(original.id, ['10.0.0.5']);

    // Same machine (same cert fingerprint), new DHCP address.
    const updated = await store.add({
      label: 'Studio Mac',
      host: '192.168.1.99',
      port: 9443,
      fingerprint: 'aa:bb:cc', // case-insensitive match
      token: 'fresh-token',
    });

    // Same record: id + captured hostname preserved, address refreshed.
    expect(updated.id).toBe(original.id);
    expect(updated).toMatchObject({
      host: '192.168.1.99',
      port: 9443,
      hostname: 'studio.local',
    });

    const remotes = (await store.list()).filter((c) => !c.isLocal);
    expect(remotes).toHaveLength(1);
    expect(remotes[0]).toMatchObject({ id: original.id, host: '192.168.1.99', port: 9443 });
    expect(await store.getDecryptedToken(original.id)).toBe('fresh-token');
  });

  it('fingerprint-less legacy records still dedupe by host:port only', async () => {
    // Seed two records with EMPTY fingerprints at different targets — blank
    // fingerprints must never match each other.
    await fs.writeFile(
      path.join(tmpDir, 'backend-connections.json'),
      JSON.stringify({
        connections: [
          {
            id: 'legacy-1',
            label: 'Legacy A',
            host: '192.168.1.10',
            port: 8443,
            fingerprint: '',
            encToken: { encrypted: false, value: 'tok-1' },
          },
          {
            id: 'legacy-2',
            label: 'Legacy B',
            host: '192.168.1.11',
            port: 8443,
            fingerprint: '  ',
            encToken: { encrypted: false, value: 'tok-2' },
          },
        ],
        activeId: 'local',
      }),
      'utf8',
    );
    const store = await import('../connections-store');

    // A fingerprint-less add at legacy-1's target upserts it; legacy-2 stays.
    const updated = await store.add({
      label: 'Repaired A',
      host: '192.168.1.10',
      port: 8443,
      fingerprint: '',
      token: 'tok-new',
    });
    expect(updated.id).toBe('legacy-1');
    expect((await store.list()).filter((c) => !c.isLocal)).toHaveLength(2);
  });

  it('different fingerprints at the SAME host:port are different machines (no upsert, no tombstone match)', async () => {
    const store = await import('../connections-store');
    // A machine at this address was forgotten with an OLD certificate…
    const old = await store.add(sampleConn); // fingerprint AA:BB:CC
    await store.forget(old.id);

    // …and a NEW backend (fresh cert) reuses the address. It must be a brand
    // new record, and the old cert's tombstone must not delete it.
    const fresh = await store.add({ ...sampleConn, fingerprint: 'DD:EE:FF', token: 'tok-new' });
    expect(fresh.id).not.toBe(old.id);
    expect((await store.list()).filter((c) => !c.isLocal)).toHaveLength(1);

    // The old-cert tombstone survives (it names a different machine)…
    await store.__drainWriteChainForTesting();
    const file = path.join(tmpDir, 'backend-connections.json');
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(parsed.tombstones).toHaveLength(1);
    expect(parsed.tombstones[0].fingerprint).toBe('AA:BB:CC');

    // …and applying it as a remote tombstone must NOT remove the new backend.
    const changed = await store.applyRemoteSyncRecord({
      label: sampleConn.label,
      host: sampleConn.host,
      hosts: [sampleConn.host],
      port: sampleConn.port,
      fingerprint: 'AA:BB:CC',
      hostname: null,
      tcAddress: null,
      detectHosts: true,
      token: '',
      updatedAt: Date.now() + 60_000,
      deleted: true,
      deletedAt: Date.now() + 60_000,
    });
    expect(changed).toBe(false);
    expect((await store.list()).filter((c) => !c.isLocal)).toHaveLength(1);
  });

  it('add stamps past a fingerprint-matching tombstone from a skewed (future) clock', async () => {
    const store = await import('../connections-store');
    const rec = await store.add(sampleConn);
    await store.forget(rec.id);
    await store.__drainWriteChainForTesting();

    // Simulate the tombstone having been written by a machine whose clock is
    // ahead: bump its LWW clock into this machine's future.
    const file = path.join(tmpDir, 'backend-connections.json');
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    const futureClock = Date.now() + 60_000;
    parsed.tombstones[0].updatedAt = futureClock;
    await fs.writeFile(file, JSON.stringify(parsed), 'utf8');
    vi.resetModules();
    mockElectron();

    // An explicit re-publish must outrank the tombstone it supersedes, or the
    // keychain copy of the tombstone re-deletes the record on next reconcile.
    const store2 = await import('../connections-store');
    await store2.add({ ...sampleConn, token: 'tok-new' });
    await store2.__drainWriteChainForTesting();
    const after = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(after.tombstones).toHaveLength(0);
    expect(after.connections).toHaveLength(1);
    expect(after.connections[0].updatedAt).toBeGreaterThan(futureClock);
  });

  it('records default to a null hostname until one is captured', async () => {
    const store = await import('../connections-store');
    const rec = await store.add(sampleConn);
    expect(rec.hostname).toBeNull();
    expect((await store.list())[1].hostname).toBeNull();
  });

  it('setHostname persists the captured hostname and it round-trips through disk', async () => {
    const store = await import('../connections-store');
    const rec = await store.add(sampleConn);
    await store.setHostname(rec.id, 'studio.local');
    await store.__drainWriteChainForTesting();

    vi.resetModules();
    mockElectron();
    const reloaded = await import('../connections-store');
    const remote = (await reloaded.list()).find((c) => c.id === rec.id);
    expect(remote?.hostname).toBe('studio.local');
  });

  it('setHostname trims whitespace and ignores an empty hostname (keeps host:port fallback)', async () => {
    const store = await import('../connections-store');
    const rec = await store.add(sampleConn);

    await store.setHostname(rec.id, '  my-mac.local  ');
    expect((await store.list())[1].hostname).toBe('my-mac.local');

    // A blank capture must not blank out the label.
    await store.setHostname(rec.id, '   ');
    expect((await store.list())[1].hostname).toBe('my-mac.local');
  });

  it('setHostname is a no-op for an unknown id (fail-soft)', async () => {
    const store = await import('../connections-store');
    await store.add(sampleConn);
    await expect(store.setHostname('does-not-exist', 'ghost.local')).resolves.toBeUndefined();
    expect((await store.list()).some((c) => c.hostname === 'ghost.local')).toBe(false);
  });

  it('setHostname migrates an address-default label to the captured pretty name', async () => {
    const store = await import('../connections-store');
    // The add form auto-fills the label with the address; trimmed comparison.
    const rec = await store.add({ ...sampleConn, label: ' 192.168.1.10:8443 ' });
    await store.setHostname(rec.id, "Clement's Mac mini");

    const remote = (await store.list()).find((c) => c.id === rec.id);
    expect(remote?.label).toBe("Clement's Mac mini");
    expect(remote?.hostname).toBe("Clement's Mac mini");
  });

  it('setHostname counts a whitespace-only label as uncustomized (add schema only enforces min(1))', async () => {
    const store = await import('../connections-store');
    const rec = await store.add({ ...sampleConn, label: '   ' });
    await store.setHostname(rec.id, 'studio.local');

    const remote = (await store.list()).find((c) => c.id === rec.id);
    expect(remote?.label).toBe('studio.local');
  });

  it('setHostname migrates the label even when the hostname itself is unchanged (pre-feature records)', async () => {
    const store = await import('../connections-store');
    const rec = await store.add({ ...sampleConn, label: '192.168.1.10:8443' });
    await store.__drainWriteChainForTesting();

    // Simulate a record whose hostname was captured before labels followed it.
    const file = path.join(tmpDir, 'backend-connections.json');
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    parsed.connections[0].hostname = 'studio.local';
    await fs.writeFile(file, JSON.stringify(parsed), 'utf8');

    // The routine same-hostname re-capture still migrates the address label.
    await store.setHostname(rec.id, 'studio.local');
    const remote = (await store.list()).find((c) => c.id === rec.id);
    expect(remote?.label).toBe('studio.local');
  });

  it('an uncustomized label follows a backend rename on re-capture', async () => {
    const store = await import('../connections-store');
    const rec = await store.add({ ...sampleConn, label: '192.168.1.10:8443' });
    await store.setHostname(rec.id, 'studio.local');
    expect((await store.list())[1].label).toBe('studio.local');

    // The backend machine is renamed; the label (still equal to the previous
    // capture) follows the new pretty name.
    await store.setHostname(rec.id, "Clement's Mac mini");
    const remote = (await store.list()).find((c) => c.id === rec.id);
    expect(remote?.label).toBe("Clement's Mac mini");
    expect(remote?.hostname).toBe("Clement's Mac mini");
  });

  it('a user-edited label is never overwritten by hostname captures', async () => {
    const store = await import('../connections-store');
    const rec = await store.add(sampleConn); // label 'Studio Mac' (customized)
    await store.setHostname(rec.id, 'studio.local');
    expect((await store.list())[1].label).toBe('Studio Mac');

    // A backend rename updates the hostname but still leaves the label alone.
    await store.setHostname(rec.id, "Clement's Mac mini");
    const remote = (await store.list()).find((c) => c.id === rec.id);
    expect(remote?.label).toBe('Studio Mac');
    expect(remote?.hostname).toBe("Clement's Mac mini");
  });

  it('editing the label back to the address makes it uncustomized again (follows the next capture)', async () => {
    const store = await import('../connections-store');
    const rec = await store.add({ ...sampleConn, label: 'My Custom Name' });
    await store.setHostname(rec.id, 'studio.local');
    expect((await store.list())[1].label).toBe('My Custom Name');

    await store.updateMetadata(rec.id, { label: '192.168.1.10:8443', accent: 'blue' });
    await store.setHostname(rec.id, 'renamed.local');
    const remote = (await store.list()).find((c) => c.id === rec.id);
    expect(remote?.label).toBe('renamed.local');
  });

  it('an address edit re-defaults an unmigrated address label to the new address (no stale freeze)', async () => {
    const store = await import('../connections-store');
    // Pre-migration record: label still the address, hostname already captured
    // (labels did not follow captures yet when this record was written).
    const rec = await store.add({ ...sampleConn, label: '192.168.1.10:8443' });
    await store.__drainWriteChainForTesting();
    const file = path.join(tmpDir, 'backend-connections.json');
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    parsed.connections[0].hostname = 'studio.local';
    await fs.writeFile(file, JSON.stringify(parsed), 'utf8');

    // The user edits the address; the label equal to the OLD host:port is
    // re-defaulted to the new address instead of freezing the stale one.
    await store.updateMetadata(rec.id, {
      label: '192.168.1.10:8443',
      accent: 'blue',
      host: '10.0.0.42',
      port: 9443,
    });
    let remote = (await store.list()).find((c) => c.id === rec.id);
    expect(remote?.label).toBe('10.0.0.42:9443');

    // Still uncustomized: the next capture is followed.
    await store.setHostname(rec.id, 'renamed.local');
    remote = (await store.list()).find((c) => c.id === rec.id);
    expect(remote?.label).toBe('renamed.local');
  });

  it('an endpoint edit resets an auto-captured label to the new address default (rename still followed)', async () => {
    const store = await import('../connections-store');
    const rec = await store.add({ ...sampleConn, label: '192.168.1.10:8443' });
    await store.setHostname(rec.id, 'studio.local');
    expect((await store.list())[1].label).toBe('studio.local');

    // The edit form submits the displayed (auto-captured) label untouched
    // alongside a new address. The hostname is cleared, so the label resets
    // to the new address default instead of freezing the stale pretty name.
    await store.updateMetadata(rec.id, {
      label: 'studio.local',
      accent: 'blue',
      host: '10.0.0.42',
      port: 9443,
    });
    let remote = (await store.list()).find((c) => c.id === rec.id);
    expect(remote?.label).toBe('10.0.0.42:9443');
    expect(remote?.hostname).toBeNull();

    // The next connect's capture (a backend rename here) is followed.
    await store.setHostname(rec.id, "Clement's Mac mini");
    remote = (await store.list()).find((c) => c.id === rec.id);
    expect(remote?.label).toBe("Clement's Mac mini");
  });

  it('an endpoint edit with a user-given label keeps it verbatim', async () => {
    const store = await import('../connections-store');
    const rec = await store.add(sampleConn); // label 'Studio Mac' (customized)
    await store.setHostname(rec.id, 'studio.local');

    await store.updateMetadata(rec.id, {
      label: 'Studio Mac',
      accent: 'blue',
      host: '10.0.0.42',
      port: 9443,
    });
    await store.setHostname(rec.id, "Clement's Mac mini");
    const remote = (await store.list()).find((c) => c.id === rec.id);
    expect(remote?.label).toBe('Studio Mac');
  });

  it('a certificate rotation via replaceSecret resets an auto-captured label to the address default', async () => {
    const store = await import('../connections-store');
    const rec = await store.add({ ...sampleConn, label: '192.168.1.10:8443' });
    await store.setHostname(rec.id, 'studio.local');
    expect((await store.list())[1].label).toBe('studio.local');

    // A different cert may mean a different machine: the captured hostname is
    // cleared, and the auto-captured label falls back to the address so the
    // next connect re-captures the (possibly new) pretty name.
    await store.replaceSecret(rec.id, 'rotated-token', 'DD:EE:FF');
    let remote = (await store.list()).find((c) => c.id === rec.id);
    expect(remote?.label).toBe('192.168.1.10:8443');
    expect(remote?.hostname).toBeNull();

    await store.setHostname(rec.id, 'renamed.local');
    remote = (await store.list()).find((c) => c.id === rec.id);
    expect(remote?.label).toBe('renamed.local');

    // A user-given label survives the same rotation untouched.
    await store.updateMetadata(rec.id, { label: 'My Mac', accent: 'blue' });
    await store.replaceSecret(rec.id, 'rotated-again', '11:22:33');
    remote = (await store.list()).find((c) => c.id === rec.id);
    expect(remote?.label).toBe('My Mac');
  });

  it('records default to a null daemonVersion until one is captured', async () => {
    const store = await import('../connections-store');
    const rec = await store.add(sampleConn);
    expect(rec.daemonVersion).toBeNull();
    expect((await store.list())[1].daemonVersion).toBeNull();
  });

  it('setDaemonVersion persists the captured version and it round-trips through disk', async () => {
    const store = await import('../connections-store');
    const rec = await store.add(sampleConn);
    await expect(store.setDaemonVersion(rec.id, '0.8.10')).resolves.toBe(true);
    await store.__drainWriteChainForTesting();

    vi.resetModules();
    mockElectron();
    const reloaded = await import('../connections-store');
    const remote = (await reloaded.list()).find((c) => c.id === rec.id);
    expect(remote?.daemonVersion).toBe('0.8.10');
  });

  it('setDaemonVersion refreshes a changed version and reports unchanged writes as false', async () => {
    const store = await import('../connections-store');
    const rec = await store.add(sampleConn);

    await expect(store.setDaemonVersion(rec.id, ' 0.8.10 ')).resolves.toBe(true);
    expect((await store.list())[1].daemonVersion).toBe('0.8.10');

    // The routine every-reconnect same-version capture is a no-op.
    await expect(store.setDaemonVersion(rec.id, '0.8.10')).resolves.toBe(false);

    // A daemon upgrade refreshes the stored value.
    await expect(store.setDaemonVersion(rec.id, '0.9.0')).resolves.toBe(true);
    expect((await store.list())[1].daemonVersion).toBe('0.9.0');

    // A blank capture must not blank out a known version.
    await expect(store.setDaemonVersion(rec.id, '   ')).resolves.toBe(false);
    expect((await store.list())[1].daemonVersion).toBe('0.9.0');
  });

  it('setDaemonVersion is a no-op for an unknown id (fail-soft)', async () => {
    const store = await import('../connections-store');
    await store.add(sampleConn);
    await expect(store.setDaemonVersion('does-not-exist', '1.0.0')).resolves.toBe(false);
    expect((await store.list()).some((c) => c.daemonVersion === '1.0.0')).toBe(false);
  });

  it('setDaemonVersion never bumps the LWW clock or notifies keychain sync (per-machine state)', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_700_000_000_000);
      const store = await import('../connections-store');
      const rec = await store.add(sampleConn);
      await store.__drainWriteChainForTesting();

      const listener = vi.fn();
      const unsubscribe = store.onConnectionsMutated(listener);

      vi.setSystemTime(1_700_000_001_000);
      await store.setDaemonVersion(rec.id, '0.8.10');
      await store.__drainWriteChainForTesting();

      const file = path.join(tmpDir, 'backend-connections.json');
      const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
      expect(parsed.connections[0].daemonVersion).toBe('0.8.10');
      expect(parsed.connections[0].updatedAt).toBe(1_700_000_000_000);
      expect(listener).not.toHaveBeenCalled();
      unsubscribe();

      // The captured version never enters the sync surface either.
      const records = await store.listSyncRecords();
      expect(JSON.stringify(records)).not.toContain('daemonVersion');
    } finally {
      vi.useRealTimers();
    }
  });

  it('records default to a null updateSupported until one is captured', async () => {
    const store = await import('../connections-store');
    const rec = await store.add(sampleConn);
    expect(rec.updateSupported).toBeNull();
    expect((await store.list())[1].updateSupported).toBeNull();
  });

  it('setUpdateSupported persists the captured flag and it round-trips through disk', async () => {
    const store = await import('../connections-store');
    const rec = await store.add(sampleConn);
    await expect(store.setUpdateSupported(rec.id, true)).resolves.toBe(true);
    await store.__drainWriteChainForTesting();

    vi.resetModules();
    mockElectron();
    const reloaded = await import('../connections-store');
    const remote = (await reloaded.list()).find((c) => c.id === rec.id);
    expect(remote?.updateSupported).toBe(true);
  });

  it('setUpdateSupported refreshes a changed flag and reports unchanged writes as false', async () => {
    const store = await import('../connections-store');
    const rec = await store.add(sampleConn);

    await expect(store.setUpdateSupported(rec.id, true)).resolves.toBe(true);
    expect((await store.list())[1].updateSupported).toBe(true);

    // The routine every-reconnect same-flag capture is a no-op.
    await expect(store.setUpdateSupported(rec.id, true)).resolves.toBe(false);

    // A supervision change (or daemon downgrade) refreshes the stored flag.
    await expect(store.setUpdateSupported(rec.id, false)).resolves.toBe(true);
    expect((await store.list())[1].updateSupported).toBe(false);
  });

  it('setUpdateSupported(null) clears a previously-stored flag back to unknown', async () => {
    const store = await import('../connections-store');
    const rec = await store.add(sampleConn);

    // A daemon replaced by one too old to report the field must not keep
    // the stale true: a conclusive flagless response clears to unknown.
    await expect(store.setUpdateSupported(rec.id, true)).resolves.toBe(true);
    await expect(store.setUpdateSupported(rec.id, null)).resolves.toBe(true);
    expect((await store.list())[1].updateSupported).toBeNull();

    // Already-unknown (absent or null) is a no-op — no write, no broadcast.
    await expect(store.setUpdateSupported(rec.id, null)).resolves.toBe(false);
  });

  it('setUpdateSupported is a no-op for an unknown id (fail-soft)', async () => {
    const store = await import('../connections-store');
    await store.add(sampleConn);
    await expect(store.setUpdateSupported('does-not-exist', true)).resolves.toBe(false);
    expect((await store.list()).some((c) => c.updateSupported === true)).toBe(false);
  });

  it('setUpdateSupported never bumps the LWW clock or notifies keychain sync (per-machine state)', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_700_000_000_000);
      const store = await import('../connections-store');
      const rec = await store.add(sampleConn);
      await store.__drainWriteChainForTesting();

      const listener = vi.fn();
      const unsubscribe = store.onConnectionsMutated(listener);

      vi.setSystemTime(1_700_000_001_000);
      await store.setUpdateSupported(rec.id, true);
      await store.__drainWriteChainForTesting();

      const file = path.join(tmpDir, 'backend-connections.json');
      const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
      expect(parsed.connections[0].updateSupported).toBe(true);
      expect(parsed.connections[0].updatedAt).toBe(1_700_000_000_000);
      expect(listener).not.toHaveBeenCalled();
      unsubscribe();

      // The captured flag never enters the sync surface either.
      const records = await store.listSyncRecords();
      expect(JSON.stringify(records)).not.toContain('updateSupported');
    } finally {
      vi.useRealTimers();
    }
  });

  it('add captures the pairing tcAddress and it round-trips through disk', async () => {
    const store = await import('../connections-store');
    const rec = await store.add({ ...sampleConn, tcAddress: 'tc.example.ts.net' });
    expect(rec.tcAddress).toBe('tc.example.ts.net');
    await store.__drainWriteChainForTesting();

    vi.resetModules();
    mockElectron();
    const reloaded = await import('../connections-store');
    const remote = (await reloaded.list()).find((c) => c.id === rec.id);
    expect(remote?.tcAddress).toBe('tc.example.ts.net');
  });

  it('records default to a null tcAddress until one is captured', async () => {
    const store = await import('../connections-store');
    const rec = await store.add(sampleConn);
    expect(rec.tcAddress).toBeNull();
    expect((await store.list())[1].tcAddress).toBeNull();
  });

  it('re-pair keeps the known tcAddress when the new pairing URI omits tc=', async () => {
    const store = await import('../connections-store');
    const rec = await store.add({ ...sampleConn, tcAddress: 'tc.example.ts.net' });

    // Same host:port → same identity; an older QR without tc= must not clear it.
    const repaired = await store.add({ ...sampleConn, token: 'token-2' });
    expect(repaired.id).toBe(rec.id);
    expect(repaired.tcAddress).toBe('tc.example.ts.net');

    // A pairing URI that does carry tc= overwrites.
    const updated = await store.add({ ...sampleConn, token: 'token-3', tcAddress: 'tc2.ts.net' });
    expect(updated.tcAddress).toBe('tc2.ts.net');
  });

  it('setTcAddress refreshes/clears the stored address and reports no-ops as false', async () => {
    const store = await import('../connections-store');
    const rec = await store.add(sampleConn);

    await expect(store.setTcAddress(rec.id, 'tc.example.ts.net')).resolves.toBe(true);
    expect((await store.list())[1].tcAddress).toBe('tc.example.ts.net');

    // The routine every-reconnect same-address capture is a no-op.
    await expect(store.setTcAddress(rec.id, 'tc.example.ts.net')).resolves.toBe(false);

    // A successful status without the field conclusively clears the address.
    await expect(store.setTcAddress(rec.id, null)).resolves.toBe(true);
    expect((await store.list())[1].tcAddress).toBeNull();

    // Already-cleared (absent or null) is a no-op; unknown id is fail-soft.
    await expect(store.setTcAddress(rec.id, null)).resolves.toBe(false);
    await expect(store.setTcAddress('does-not-exist', 'tc.ts.net')).resolves.toBe(false);
  });

  it('setTcAddress bumps the LWW clock and notifies keychain sync (synced state)', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_700_000_000_000);
      const store = await import('../connections-store');
      const rec = await store.add(sampleConn);
      await store.__drainWriteChainForTesting();

      const listener = vi.fn();
      const unsubscribe = store.onConnectionsMutated(listener);

      vi.setSystemTime(1_700_000_001_000);
      await store.setTcAddress(rec.id, 'tc.example.ts.net');
      await store.__drainWriteChainForTesting();

      const file = path.join(tmpDir, 'backend-connections.json');
      const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
      expect(parsed.connections[0].tcAddress).toBe('tc.example.ts.net');
      // A tc address change is a syncable edit: the LWW clock advances so the
      // rotation propagates to the user's other devices.
      expect(parsed.connections[0].updatedAt).toBe(1_700_000_001_000);
      expect(listener).toHaveBeenCalledTimes(1);

      // The unchanged every-reconnect case skips the write: no clock bump,
      // no sync notification.
      await store.setTcAddress(rec.id, 'tc.example.ts.net');
      await store.__drainWriteChainForTesting();
      expect(listener).toHaveBeenCalledTimes(1);
      unsubscribe();

      // The captured address is part of the sync surface.
      const records = await store.listSyncRecords();
      const synced = records.find((r) => r.host === sampleConn.host);
      expect(synced?.tcAddress).toBe('tc.example.ts.net');
    } finally {
      vi.useRealTimers();
    }
  });

  it('setTcAddress out-clocks an add landing in the same millisecond', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_700_000_000_000);
      const store = await import('../connections-store');
      const rec = await store.add(sampleConn);
      // Same-millisecond capture (the routine post-connect case): the stamp
      // is forced strictly past the record's clock, or reconcile would treat
      // equal live clocks as in-sync and never propagate the address.
      await store.setTcAddress(rec.id, 'tc.example.ts.net');
      await store.__drainWriteChainForTesting();

      const file = path.join(tmpDir, 'backend-connections.json');
      const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
      expect(parsed.connections[0].updatedAt).toBe(1_700_000_000_001);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sync records carry tcAddress and applyRemoteSyncRecord round-trips it', async () => {
    const store = await import('../connections-store');
    const rec = await store.add({ ...sampleConn, tcAddress: 'tc.example.ts.net' });

    const records = await store.listSyncRecords();
    const synced = records.find((r) => r.host === sampleConn.host);
    expect(synced?.tcAddress).toBe('tc.example.ts.net');

    // A newer remote copy updates the stored address in place…
    await store.applyRemoteSyncRecord({ ...synced!, tcAddress: 'tc2.ts.net', updatedAt: 9e12 });
    expect((await store.list()).find((c) => c.id === rec.id)?.tcAddress).toBe('tc2.ts.net');

    // …and a remote copy without one (older app / tunnel down) clears it.
    await store.applyRemoteSyncRecord({ ...synced!, tcAddress: null, updatedAt: 9e12 + 1 });
    expect((await store.list()).find((c) => c.id === rec.id)?.tcAddress).toBeNull();
  });

  it('applyRemoteSyncRecord inserts a new record with the synced tcAddress', async () => {
    const store = await import('../connections-store');
    await store.applyRemoteSyncRecord({
      label: 'Studio',
      host: '10.0.0.9',
      hosts: ['10.0.0.9'],
      port: 8443,
      fingerprint: 'AA:BB',
      hostname: null,
      tcAddress: 'tc.example.ts.net',
      detectHosts: true,
      token: 'tok',
      updatedAt: 1_700_000_000_000,
    });
    const pulled = (await store.list()).find((c) => c.host === '10.0.0.9');
    expect(pulled?.tcAddress).toBe('tc.example.ts.net');
  });

  it('malformed JSON on disk yields just the local entry (defensive)', async () => {
    await fs.writeFile(path.join(tmpDir, 'backend-connections.json'), 'not json', 'utf8');
    const store = await import('../connections-store');
    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(store.LOCAL_CONNECTION_ID);
    expect(await store.getActiveId()).toBe(store.LOCAL_CONNECTION_ID);
  });

  it('new records default to a single-host candidate list and detectHosts enabled (#1746)', async () => {
    const store = await import('../connections-store');
    const rec = await store.add(sampleConn);
    expect(rec.hosts).toEqual(['192.168.1.10']);
    expect(await store.getDetectHosts(rec.id)).toBe(true);
  });

  it('pre-#1746 records (no hosts field) migrate to a one-element list', async () => {
    const store = await import('../connections-store');
    const rec = await store.add(sampleConn);
    await store.__drainWriteChainForTesting();

    // Simulate a record written before the hosts/detectHosts fields existed.
    const file = path.join(tmpDir, 'backend-connections.json');
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    delete parsed.connections[0].hosts;
    delete parsed.connections[0].detectHosts;
    await fs.writeFile(file, JSON.stringify(parsed), 'utf8');

    vi.resetModules();
    mockElectron();
    const reloaded = await import('../connections-store');
    const remote = (await reloaded.list()).find((c) => c.id === rec.id);
    expect(remote?.hosts).toEqual(['192.168.1.10']);
    // Old records default to detection enabled.
    expect(await reloaded.getDetectHosts(rec.id)).toBe(true);
  });

  it('setHosts persists deduplicated extras with the primary host first', async () => {
    const store = await import('../connections-store');
    const rec = await store.add(sampleConn);
    await store.setHosts(rec.id, ['10.0.0.5', '192.168.1.10', ' 10.0.0.5 ', 'fe80::1', '']);
    await store.__drainWriteChainForTesting();

    vi.resetModules();
    mockElectron();
    const reloaded = await import('../connections-store');
    const remote = (await reloaded.list()).find((c) => c.id === rec.id);
    expect(remote?.hosts).toEqual(['192.168.1.10', '10.0.0.5', 'fe80::1']);
    // The primary host stays untouched.
    expect(remote?.host).toBe('192.168.1.10');
  });

  it('setHosts is a no-op for unknown ids and detectHosts=false records', async () => {
    const store = await import('../connections-store');
    await expect(store.setHosts('does-not-exist', ['10.0.0.5'])).resolves.toBeUndefined();

    const optedOut = await store.add({ ...sampleConn, detectHosts: false });
    expect(await store.getDetectHosts(optedOut.id)).toBe(false);
    await store.setHosts(optedOut.id, ['10.0.0.5']);
    const remote = (await store.list()).find((c) => c.id === optedOut.id);
    expect(remote?.hosts).toEqual(['192.168.1.10']);
  });

  it('getDetectHosts is false for local and unknown ids', async () => {
    const store = await import('../connections-store');
    expect(await store.getDetectHosts(store.LOCAL_CONNECTION_ID)).toBe(false);
    expect(await store.getDetectHosts('does-not-exist')).toBe(false);
  });
});

describe('connections-store keychain sync surface', () => {
  it('add stamps updatedAt (persisted to disk) and setHostname/setHosts bump it', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_700_000_000_000);
      const store = await import('../connections-store');
      const rec = await store.add(sampleConn);
      await store.__drainWriteChainForTesting();

      const file = path.join(tmpDir, 'backend-connections.json');
      let parsed = JSON.parse(await fs.readFile(file, 'utf8'));
      expect(parsed.connections[0].updatedAt).toBe(1_700_000_000_000);

      vi.setSystemTime(1_700_000_001_000);
      await store.setHostname(rec.id, 'studio.local');
      await store.__drainWriteChainForTesting();
      parsed = JSON.parse(await fs.readFile(file, 'utf8'));
      expect(parsed.connections[0].updatedAt).toBe(1_700_000_001_000);

      vi.setSystemTime(1_700_000_002_000);
      await store.setHosts(rec.id, ['10.0.0.5']);
      await store.__drainWriteChainForTesting();
      parsed = JSON.parse(await fs.readFile(file, 'utf8'));
      expect(parsed.connections[0].updatedAt).toBe(1_700_000_002_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('setHostname/setHosts with unchanged values do not bump the LWW clock or notify', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_700_000_000_000);
      const store = await import('../connections-store');
      const rec = await store.add(sampleConn);
      await store.setHostname(rec.id, 'studio.local');
      await store.setHosts(rec.id, ['10.0.0.5']);
      await store.__drainWriteChainForTesting();

      const listener = vi.fn();
      const unsubscribe = store.onConnectionsMutated(listener);

      // The routine every-connect refresh with identical values must not
      // re-stamp updatedAt — that would let this stale record win over a
      // newer remote edit in keychain sync.
      vi.setSystemTime(1_700_000_005_000);
      await store.setHostname(rec.id, 'studio.local');
      await store.setHosts(rec.id, [' 10.0.0.5 ']); // dedupes to the same list
      await store.__drainWriteChainForTesting();

      const file = path.join(tmpDir, 'backend-connections.json');
      const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
      expect(parsed.connections[0].updatedAt).toBe(1_700_000_000_000);
      expect(listener).not.toHaveBeenCalled();
      unsubscribe();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a setHostname label migration is a real edit: bumps the LWW clock and notifies sync', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_700_000_000_000);
      const store = await import('../connections-store');
      const rec = await store.add({ ...sampleConn, label: '192.168.1.10:8443' });
      // The first capture lands in the same millisecond as add: the stamp is
      // forced strictly past the record's clock so reconciliation (which
      // treats equal live clocks as in-sync) propagates the migrated label
      // to a device still holding the address label.
      await store.setHostname(rec.id, 'studio.local');
      await store.__drainWriteChainForTesting();
      const file = path.join(tmpDir, 'backend-connections.json');
      let parsed = JSON.parse(await fs.readFile(file, 'utf8'));
      expect(parsed.connections[0].updatedAt).toBe(1_700_000_000_001);

      const listener = vi.fn();
      const unsubscribe = store.onConnectionsMutated(listener);

      // Same hostname re-capture with the label already following it: the
      // routine every-connect no-op keeps the clock and stays silent.
      vi.setSystemTime(1_700_000_001_000);
      await store.setHostname(rec.id, 'studio.local');
      await store.__drainWriteChainForTesting();
      parsed = JSON.parse(await fs.readFile(file, 'utf8'));
      expect(parsed.connections[0].label).toBe('studio.local');
      expect(parsed.connections[0].updatedAt).toBe(1_700_000_000_001);
      expect(listener).not.toHaveBeenCalled();

      // A rename moves both fields, bumps the clock, and notifies — the new
      // label must propagate to the user's other machines.
      vi.setSystemTime(1_700_000_002_000);
      await store.setHostname(rec.id, "Clement's Mac mini");
      await store.__drainWriteChainForTesting();
      parsed = JSON.parse(await fs.readFile(file, 'utf8'));
      expect(parsed.connections[0].label).toBe("Clement's Mac mini");
      expect(parsed.connections[0].updatedAt).toBe(1_700_000_002_000);
      expect(listener).toHaveBeenCalledTimes(1);
      unsubscribe();
    } finally {
      vi.useRealTimers();
    }
  });

  it('forget writes a tombstone (token-free) and re-adding the target clears it', async () => {
    const store = await import('../connections-store');
    const rec = await store.add(sampleConn);
    await store.setHostname(rec.id, 'studio.local');
    await store.forget(rec.id);
    await store.__drainWriteChainForTesting();

    const file = path.join(tmpDir, 'backend-connections.json');
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(parsed.connections).toHaveLength(0);
    expect(parsed.tombstones).toHaveLength(1);
    expect(parsed.tombstones[0]).toMatchObject({
      host: '192.168.1.10',
      port: 8443,
      hostname: 'studio.local',
    });
    expect(JSON.stringify(parsed.tombstones)).not.toContain('secret-token');
    expect(typeof parsed.tombstones[0].updatedAt).toBe('number');
    expect(typeof parsed.tombstones[0].deletedAt).toBe('number');

    // Re-adding the same target clears the tombstone.
    await store.add(sampleConn);
    await store.__drainWriteChainForTesting();
    const after = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(after.tombstones).toHaveLength(0);
    expect(after.connections).toHaveLength(1);
  });

  it('add dedupes host case-insensitively (no split-brain with accountKeyFor)', async () => {
    const store = await import('../connections-store');
    const first = await store.add({ ...sampleConn, host: 'Studio.LOCAL' });
    const second = await store.add({ ...sampleConn, host: 'studio.local', label: 'Re-added' });
    expect(second.id).toBe(first.id);
    expect((await store.list()).filter((c) => !c.isLocal)).toHaveLength(1);
  });

  it('listSyncRecords lists live records (decrypted token) and tombstones, never the local entry', async () => {
    const store = await import('../connections-store');
    const rec = await store.add(sampleConn);
    const other = await store.add({
      ...sampleConn,
      port: 9443,
      fingerprint: 'FP:GONE',
      label: 'Gone',
    });
    await store.forget(other.id);

    const records = await store.listSyncRecords();
    expect(records).toHaveLength(2);
    const live = records.find((r) => r.deleted !== true);
    const stone = records.find((r) => r.deleted === true);
    expect(live).toMatchObject({
      label: 'Studio Mac',
      host: '192.168.1.10',
      port: 8443,
      token: 'secret-token',
      detectHosts: true,
    });
    expect(typeof live?.updatedAt).toBe('number');
    expect(stone).toMatchObject({ label: 'Gone', port: 9443, token: '' });
    expect(records.some((r) => r.host === null || r.label === 'This machine (local)')).toBe(false);
    void rec;
  });

  it('pre-sync records (no updatedAt) list as epoch-old (updatedAt 0)', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'backend-connections.json'),
      JSON.stringify({
        connections: [
          {
            id: 'old-1',
            label: 'Old',
            host: '192.168.1.10',
            port: 8443,
            fingerprint: 'AA',
            encToken: { encrypted: false, value: 'tok' },
          },
        ],
        activeId: 'local',
      }),
      'utf8',
    );
    const store = await import('../connections-store');
    const records = await store.listSyncRecords();
    expect(records).toHaveLength(1);
    expect(records[0].updatedAt).toBe(0);
  });

  it('applyRemoteSyncRecord upserts a live record verbatim (id preserved, clock not re-stamped)', async () => {
    const store = await import('../connections-store');
    const rec = await store.add(sampleConn);

    const changed = await store.applyRemoteSyncRecord({
      label: 'Renamed remotely',
      accent: null,
      host: '192.168.1.10',
      hosts: ['192.168.1.10', '10.0.0.9'],
      port: 8443,
      fingerprint: 'NEW:FP',
      hostname: 'studio.local',
      tcAddress: null,
      detectHosts: true,
      token: 'rotated-token',
      updatedAt: 42,
    });
    expect(changed).toBe(true);

    const remote = (await store.list()).find((c) => !c.isLocal);
    expect(remote).toMatchObject({
      id: rec.id,
      label: 'Renamed remotely',
      accent: null,
      fingerprint: 'NEW:FP',
      hostname: 'studio.local',
      hosts: ['192.168.1.10', '10.0.0.9'],
    });
    expect(await store.getDecryptedToken(rec.id)).toBe('rotated-token');
    // The remote clock is preserved so machines converge.
    expect((await store.listSyncRecords())[0].updatedAt).toBe(42);
  });

  it('applyRemoteSyncRecord inserts a brand-new backend (fresh pull)', async () => {
    const store = await import('../connections-store');
    const changed = await store.applyRemoteSyncRecord({
      label: 'Laptop',
      host: '10.0.0.2',
      hosts: ['10.0.0.2'],
      port: 9000,
      fingerprint: 'FP',
      hostname: null,
      tcAddress: null,
      detectHosts: false,
      token: 'laptop-token',
      updatedAt: 7,
    });
    expect(changed).toBe(true);
    const remote = (await store.list()).find((c) => !c.isLocal);
    expect(remote).toMatchObject({ label: 'Laptop', host: '10.0.0.2', port: 9000 });
    expect(await store.getDetectHosts(remote!.id)).toBe(false);
    expect(await store.getDecryptedToken(remote!.id)).toBe('laptop-token');
  });

  it('applyRemoteSyncRecord tombstone removes the backend and falls active back to local', async () => {
    const store = await import('../connections-store');
    const rec = await store.add(sampleConn);
    await store.setActiveId(rec.id);

    // A fresh (non-TTL-expired) remote clock, slightly ahead of local.
    const remoteClock = Date.now() + 1000;
    const changed = await store.applyRemoteSyncRecord({
      label: 'Studio Mac',
      host: '192.168.1.10',
      hosts: ['192.168.1.10'],
      port: 8443,
      fingerprint: 'AA:BB:CC',
      hostname: null,
      tcAddress: null,
      detectHosts: true,
      token: '',
      updatedAt: remoteClock,
      deleted: true,
      deletedAt: remoteClock,
    });
    expect(changed).toBe(true);
    expect((await store.list()).filter((c) => !c.isLocal)).toHaveLength(0);
    expect(await store.getActiveId()).toBe(store.LOCAL_CONNECTION_ID);
    // The tombstone is remembered with the remote clock (not re-stamped).
    const records = await store.listSyncRecords();
    expect(records).toEqual([
      expect.objectContaining({
        deleted: true,
        updatedAt: remoteClock,
        deletedAt: remoteClock,
        token: '',
      }),
    ]);
  });

  it('applyRemoteSyncRecord matches by fingerprint: a record under a NEW host:port collapses into the existing entry', async () => {
    const store = await import('../connections-store');
    const rec = await store.add(sampleConn); // 192.168.1.10:8443, AA:BB:CC

    const changed = await store.applyRemoteSyncRecord({
      label: 'Studio Mac',
      host: '192.168.1.99',
      hosts: ['192.168.1.99'],
      port: 9443,
      fingerprint: 'aa:bb:cc', // same machine, case-differing fingerprint
      hostname: 'studio.local',
      tcAddress: null,
      detectHosts: true,
      token: 'rotated-token',
      updatedAt: 42,
    });
    expect(changed).toBe(true);

    // One record, same id, address taken from the remote.
    const remotes = (await store.list()).filter((c) => !c.isLocal);
    expect(remotes).toHaveLength(1);
    expect(remotes[0]).toMatchObject({ id: rec.id, host: '192.168.1.99', port: 9443 });
    expect(await store.getDecryptedToken(rec.id)).toBe('rotated-token');
  });

  it('applyRemoteSyncRecord tombstone matches by fingerprint: a delete under the OLD address removes the moved record', async () => {
    const store = await import('../connections-store');
    // The machine now lives at a new address locally.
    const rec = await store.add({ ...sampleConn, host: '192.168.1.99', port: 9443 });
    await store.setActiveId(rec.id);

    const remoteClock = Date.now() + 1000;
    const changed = await store.applyRemoteSyncRecord({
      label: 'Studio Mac',
      host: '192.168.1.10', // the OLD address
      hosts: ['192.168.1.10'],
      port: 8443,
      fingerprint: 'AA:BB:CC',
      hostname: null,
      tcAddress: null,
      detectHosts: true,
      token: '',
      updatedAt: remoteClock,
      deleted: true,
      deletedAt: remoteClock,
    });
    expect(changed).toBe(true);
    expect((await store.list()).filter((c) => !c.isLocal)).toHaveLength(0);
    expect(await store.getActiveId()).toBe(store.LOCAL_CONNECTION_ID);
  });

  it('re-adding the same machine under a new address clears its old-address tombstone', async () => {
    const store = await import('../connections-store');
    const rec = await store.add(sampleConn); // 192.168.1.10:8443
    await store.forget(rec.id);
    await store.__drainWriteChainForTesting();

    const file = path.join(tmpDir, 'backend-connections.json');
    let parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(parsed.tombstones).toHaveLength(1);

    // Same fingerprint, new address: the machine came back — the tombstone
    // for the old address must not survive to suppress it elsewhere.
    await store.add({ ...sampleConn, host: '192.168.1.99', port: 9443 });
    await store.__drainWriteChainForTesting();
    parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(parsed.tombstones).toHaveLength(0);
    expect(parsed.connections).toHaveLength(1);
  });

  it('onConnectionsMutated fires on local mutations but never on applyRemoteSyncRecord', async () => {
    const store = await import('../connections-store');
    const listener = vi.fn();
    const unsubscribe = store.onConnectionsMutated(listener);

    const rec = await store.add(sampleConn);
    expect(listener).toHaveBeenCalledTimes(1);
    await store.setHostname(rec.id, 'studio.local');
    expect(listener).toHaveBeenCalledTimes(2);
    await store.setHosts(rec.id, ['10.0.0.5']);
    expect(listener).toHaveBeenCalledTimes(3);
    await store.forget(rec.id);
    expect(listener).toHaveBeenCalledTimes(4);

    // No-op mutations do not notify.
    await store.setHostname('does-not-exist', 'ghost.local');
    await store.setHosts('does-not-exist', ['10.0.0.5']);
    await store.forget('does-not-exist');
    expect(listener).toHaveBeenCalledTimes(4);

    // Remote application never notifies (pull must not loop into push).
    await store.applyRemoteSyncRecord({
      label: 'Laptop',
      host: '10.0.0.2',
      hosts: ['10.0.0.2'],
      port: 9000,
      fingerprint: 'FP',
      hostname: null,
      tcAddress: null,
      detectHosts: true,
      token: 't',
      updatedAt: 7,
    });
    expect(listener).toHaveBeenCalledTimes(4);

    unsubscribe();
    await store.add({ ...sampleConn, port: 9999 });
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it('activeId is never part of the sync surface', async () => {
    const store = await import('../connections-store');
    const rec = await store.add(sampleConn);
    await store.setActiveId(rec.id);
    const records = await store.listSyncRecords();
    expect(JSON.stringify(records)).not.toContain(rec.id);
    expect(JSON.stringify(records)).not.toContain('activeId');
  });

  it('add without syncExcluded stays synced (flag false, listed to sync)', async () => {
    const store = await import('../connections-store');
    const rec = await store.add(sampleConn);
    expect(rec.syncExcluded).toBe(false);
    expect((await store.list()).find((c) => c.id === rec.id)?.syncExcluded).toBe(false);
    expect(await store.listSyncRecords()).toHaveLength(1);
  });

  it('add with syncExcluded persists the flag and hides the record from listSyncRecords', async () => {
    const store = await import('../connections-store');
    const excluded = await store.add({ ...sampleConn, syncExcluded: true });
    const synced = await store.add({
      ...sampleConn,
      port: 9443,
      fingerprint: 'FP:SYNCED',
      label: 'Synced',
    });
    expect(excluded.syncExcluded).toBe(true);
    expect(excluded).not.toHaveProperty('token');
    expect(excluded).not.toHaveProperty('encToken');
    await store.__drainWriteChainForTesting();

    // Persisted on disk…
    const file = path.join(tmpDir, 'backend-connections.json');
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(parsed.connections.find((c: { id: string }) => c.id === excluded.id).syncExcluded).toBe(
      true,
    );

    // …and invisible to sync while the synced sibling still lists.
    const records = await store.listSyncRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ label: 'Synced', port: 9443 });
    void synced;
  });

  it('re-add flips the exclusion flag on the surviving record (both directions)', async () => {
    const store = await import('../connections-store');
    const original = await store.add({ ...sampleConn, syncExcluded: true });
    expect(await store.listSyncRecords()).toHaveLength(0);

    // Re-add with the box kept (explicit inclusion) clears the flag in place.
    const included = await store.add({ ...sampleConn, syncExcluded: false });
    expect(included.id).toBe(original.id);
    expect(included.syncExcluded).toBe(false);
    expect(await store.listSyncRecords()).toHaveLength(1);

    // Re-add opted out again sets it back on the same record.
    const reExcluded = await store.add({ ...sampleConn, syncExcluded: true });
    expect(reExcluded.id).toBe(original.id);
    expect(reExcluded.syncExcluded).toBe(true);
    expect(await store.listSyncRecords()).toHaveLength(0);
  });

  it('re-add WITHOUT syncExcluded preserves the survivor exclusion (refresh must not flip consent)', async () => {
    const store = await import('../connections-store');
    // The user explicitly opted this backend out of sync…
    const original = await store.add({ ...sampleConn, syncExcluded: true });
    expect(await store.listSyncRecords()).toHaveLength(0);

    // …then a flag-less upsert (e.g. connections:refresh-self after a token
    // rotation) re-adds the same backend. The exclusion MUST survive: a
    // freshness path never carries consent to publish to the keychain.
    const refreshed = await store.add(sampleConn);
    expect(refreshed.id).toBe(original.id);
    expect(refreshed.syncExcluded).toBe(true);
    expect(await store.listSyncRecords()).toHaveLength(0);

    // And symmetrically: a flag-less re-add of a synced record keeps it synced.
    const synced = await store.add({
      ...sampleConn,
      port: 9443,
      fingerprint: 'FP:SYNCED',
      syncExcluded: false,
    });
    const reAdded = await store.add({ ...sampleConn, port: 9443, fingerprint: 'FP:SYNCED' });
    expect(reAdded.id).toBe(synced.id);
    expect(reAdded.syncExcluded).toBe(false);
    expect(await store.listSyncRecords()).toHaveLength(1);
  });

  it('forget of an excluded record writes an excluded tombstone that never reaches sync', async () => {
    const store = await import('../connections-store');
    const rec = await store.add({ ...sampleConn, syncExcluded: true });
    await store.forget(rec.id);
    await store.__drainWriteChainForTesting();

    // The tombstone is kept on disk (local bookkeeping) marked excluded…
    const file = path.join(tmpDir, 'backend-connections.json');
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(parsed.connections).toHaveLength(0);
    expect(parsed.tombstones).toHaveLength(1);
    expect(parsed.tombstones[0].excluded).toBe(true);

    // …but never listed to sync, so the deletion cannot hit the keychain.
    expect(await store.listSyncRecords()).toHaveLength(0);
  });

  it('forget of a synced record writes a non-excluded tombstone (still listed to sync)', async () => {
    const store = await import('../connections-store');
    const rec = await store.add(sampleConn);
    await store.forget(rec.id);
    await store.__drainWriteChainForTesting();

    const file = path.join(tmpDir, 'backend-connections.json');
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(parsed.tombstones[0].excluded).toBe(false);
    const records = await store.listSyncRecords();
    expect(records).toEqual([expect.objectContaining({ deleted: true })]);
  });

  it('legacy state without syncExcluded is read as synced (back-compat)', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'backend-connections.json'),
      JSON.stringify({
        connections: [
          {
            id: 'legacy-1',
            label: 'Legacy',
            host: '192.168.1.10',
            port: 8443,
            fingerprint: 'AA',
            encToken: { encrypted: false, value: 'tok' },
          },
        ],
        activeId: 'local',
        tombstones: [
          {
            label: 'Legacy gone',
            host: '192.168.1.11',
            port: 8443,
            fingerprint: 'BB',
            updatedAt: Date.now(),
            deletedAt: Date.now(),
          },
        ],
      }),
      'utf8',
    );
    const store = await import('../connections-store');
    const remote = (await store.list()).find((c) => !c.isLocal);
    expect(remote?.syncExcluded).toBe(false);
    // Both the legacy record and the legacy tombstone still sync.
    const records = await store.listSyncRecords();
    expect(records).toHaveLength(2);
    expect(records.filter((r) => r.deleted === true)).toHaveLength(1);
  });

  it('applyRemoteSyncRecord live pull never overwrites an excluded record (same account)', async () => {
    const store = await import('../connections-store');
    const rec = await store.add({ ...sampleConn, syncExcluded: true });
    await store.__drainWriteChainForTesting();
    const file = path.join(tmpDir, 'backend-connections.json');
    const before = JSON.parse(await fs.readFile(file, 'utf8'));

    const changed = await store.applyRemoteSyncRecord({
      label: 'Synced twin',
      host: '192.168.1.10',
      hosts: ['192.168.1.10'],
      port: 8443,
      fingerprint: 'AA:BB:CC',
      hostname: 'twin.local',
      tcAddress: null,
      detectHosts: true,
      token: 'remote-token',
      updatedAt: Date.now() + 60_000, // newer than the local record
    });
    expect(changed).toBe(false);

    // Untouched on disk (label, token, LWW clock) and no duplicate inserted.
    await store.__drainWriteChainForTesting();
    const after = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(after.connections).toEqual(before.connections);
    expect(await store.getDecryptedToken(rec.id)).toBe('secret-token');
  });

  it('applyRemoteSyncRecord live pull for an excluded backend under a NEW address creates no duplicate', async () => {
    const store = await import('../connections-store');
    const rec = await store.add({ ...sampleConn, syncExcluded: true });

    const changed = await store.applyRemoteSyncRecord({
      label: 'Studio Mac',
      host: '192.168.1.99',
      hosts: ['192.168.1.99'],
      port: 9443,
      fingerprint: 'aa:bb:cc', // same machine, case-differing fingerprint
      hostname: null,
      tcAddress: null,
      detectHosts: true,
      token: 'remote-token',
      updatedAt: Date.now() + 60_000,
    });
    expect(changed).toBe(false);

    const remotes = (await store.list()).filter((c) => !c.isLocal);
    expect(remotes).toHaveLength(1);
    expect(remotes[0]).toMatchObject({
      id: rec.id,
      host: '192.168.1.10',
      port: 8443,
      syncExcluded: true,
    });
  });

  it('applyRemoteSyncRecord matches an excluded fingerprint-less record by host:port (no update, no duplicate)', async () => {
    const store = await import('../connections-store');
    const rec = await store.add({ ...sampleConn, fingerprint: '', syncExcluded: true });

    const changed = await store.applyRemoteSyncRecord({
      label: 'Synced twin',
      host: '192.168.1.10',
      hosts: ['192.168.1.10'],
      port: 8443,
      fingerprint: '',
      hostname: null,
      tcAddress: null,
      detectHosts: true,
      token: 'remote-token',
      updatedAt: Date.now() + 60_000,
    });
    expect(changed).toBe(false);

    const remotes = (await store.list()).filter((c) => !c.isLocal);
    expect(remotes).toHaveLength(1);
    expect(remotes[0]).toMatchObject({ id: rec.id, label: 'Studio Mac', syncExcluded: true });
    expect(await store.getDecryptedToken(rec.id)).toBe('secret-token');
  });

  it('applyRemoteSyncRecord tombstone never deletes an excluded record and remembers nothing', async () => {
    const store = await import('../connections-store');
    const rec = await store.add({ ...sampleConn, syncExcluded: true });
    await store.setActiveId(rec.id);

    const remoteClock = Date.now() + 60_000;
    const changed = await store.applyRemoteSyncRecord({
      label: 'Studio Mac',
      host: '192.168.1.10', // an OLD address of the same machine
      hosts: ['192.168.1.10'],
      port: 7443,
      fingerprint: 'AA:BB:CC',
      hostname: null,
      tcAddress: null,
      detectHosts: true,
      token: '',
      updatedAt: remoteClock,
      deleted: true,
      deletedAt: remoteClock,
    });
    expect(changed).toBe(false);

    // The record survives, stays active, and no tombstone is remembered.
    const remotes = (await store.list()).filter((c) => !c.isLocal);
    expect(remotes).toHaveLength(1);
    expect(remotes[0].id).toBe(rec.id);
    expect(await store.getActiveId()).toBe(rec.id);
    await store.__drainWriteChainForTesting();
    const file = path.join(tmpDir, 'backend-connections.json');
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(parsed.tombstones).toHaveLength(0);
  });

  it('applyRemoteSyncRecord live pull never resurrects a forgotten excluded backend (excluded tombstone shields)', async () => {
    const store = await import('../connections-store');
    const rec = await store.add({ ...sampleConn, syncExcluded: true });
    await store.forget(rec.id);

    // The stale keychain copy arrives as an unpaired live pull — nothing
    // live matches, only the excluded tombstone. A NEWER remote clock must
    // not matter: exclusion is a consent boundary, not a clock race.
    const changed = await store.applyRemoteSyncRecord({
      label: 'Synced twin',
      host: '192.168.1.10',
      hosts: ['192.168.1.10'],
      port: 8443,
      fingerprint: 'AA:BB:CC',
      hostname: null,
      tcAddress: null,
      detectHosts: true,
      token: 'remote-token',
      updatedAt: Date.now() + 60_000,
    });
    expect(changed).toBe(false);

    // The forget holds: no backend re-created, excluded tombstone intact.
    expect((await store.list()).filter((c) => !c.isLocal)).toHaveLength(0);
    await store.__drainWriteChainForTesting();
    const file = path.join(tmpDir, 'backend-connections.json');
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(parsed.tombstones).toHaveLength(1);
    expect(parsed.tombstones[0].excluded).toBe(true);
  });

  it('excluded-tombstone shield matches a fingerprint-less backend by host:port', async () => {
    const store = await import('../connections-store');
    const rec = await store.add({ ...sampleConn, fingerprint: '', syncExcluded: true });
    await store.forget(rec.id);

    const changed = await store.applyRemoteSyncRecord({
      label: 'Synced twin',
      host: '192.168.1.10',
      hosts: ['192.168.1.10'],
      port: 8443,
      fingerprint: '',
      hostname: null,
      tcAddress: null,
      detectHosts: true,
      token: 'remote-token',
      updatedAt: Date.now() + 60_000,
    });
    expect(changed).toBe(false);

    expect((await store.list()).filter((c) => !c.isLocal)).toHaveLength(0);
    await store.__drainWriteChainForTesting();
    const file = path.join(tmpDir, 'backend-connections.json');
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(parsed.tombstones).toHaveLength(1);
    expect(parsed.tombstones[0].excluded).toBe(true);
  });

  it('a NON-excluded tombstone does not shield: a live pull still applies (normal LWW)', async () => {
    const store = await import('../connections-store');
    const rec = await store.add(sampleConn);
    await store.forget(rec.id);

    // The reconcile layer already decided this pull via LWW; the store must
    // apply it — re-create the backend and clear the synced tombstone.
    const changed = await store.applyRemoteSyncRecord({
      label: 'Studio Mac',
      host: '192.168.1.10',
      hosts: ['192.168.1.10'],
      port: 8443,
      fingerprint: 'AA:BB:CC',
      hostname: null,
      tcAddress: null,
      detectHosts: true,
      token: 'remote-token',
      updatedAt: Date.now() + 60_000,
    });
    expect(changed).toBe(true);

    expect((await store.list()).filter((c) => !c.isLocal)).toHaveLength(1);
    await store.__drainWriteChainForTesting();
    const file = path.join(tmpDir, 'backend-connections.json');
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(parsed.tombstones).toHaveLength(0);
  });

  it('reconcile after forgetting an excluded backend: the stale keychain copy never undoes the forget', async () => {
    // End-to-end shape of the bug: opt a backend out, the keychain still
    // holds its stale synced copy from before the opt-out, forget it — the
    // next reconcile pulls the unpaired stale record and must NOT re-create
    // the backend.
    const store = await import('../connections-store');
    const sync = await import('../keychain-sync');

    const keychain = new Map<string, string>();
    const client: import('../keychain-sync').KeychainClient = {
      async list() {
        return {
          ok: true,
          items: [...keychain.entries()].map(([account, payload]) => ({ account, payload })),
        };
      },
      async upsert(account, payload) {
        keychain.set(account, payload);
        return { ok: true };
      },
      async delete(account) {
        keychain.delete(account);
        return { ok: true };
      },
    };
    const adapter: import('../keychain-sync').LocalSyncAdapter = {
      list: () => store.listSyncRecords(),
      applyRemote: async (_account, record) => {
        await store.applyRemoteSyncRecord(record);
      },
    };

    const rec = await store.add({ ...sampleConn, syncExcluded: true });
    keychain.set(
      sync.accountKeyFor('192.168.1.10', 8443),
      sync.serializeRecord({
        label: 'Studio Mac',
        host: '192.168.1.10',
        hosts: ['192.168.1.10'],
        port: 8443,
        fingerprint: 'AA:BB:CC',
        hostname: null,
        tcAddress: null,
        detectHosts: true,
        token: 'stale-token',
        updatedAt: Date.now() - 60_000,
      }),
    );
    await store.forget(rec.id);

    const result = await sync.reconcile(adapter, { client });
    expect(result.pushed).toEqual([]);

    // The forget holds across the reconcile and stays local-only: no
    // backend re-created, excluded tombstone intact, keychain untouched.
    expect((await store.list()).filter((c) => !c.isLocal)).toHaveLength(0);
    await store.__drainWriteChainForTesting();
    const file = path.join(tmpDir, 'backend-connections.json');
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(parsed.tombstones).toHaveLength(1);
    expect(parsed.tombstones[0].excluded).toBe(true);
    expect(keychain.size).toBe(1);
  });

  it('reconcile treats excluded records as fully local: never pushed, never overwritten or deleted, never duplicated', async () => {
    // Real store + real reconcile against an in-memory keychain: the
    // excluded record must be invisible (push side) and inviolable (pull
    // side) across full reconcile passes.
    const store = await import('../connections-store');
    const sync = await import('../keychain-sync');

    const keychain = new Map<string, string>();
    const client: import('../keychain-sync').KeychainClient = {
      async list() {
        return {
          ok: true,
          items: [...keychain.entries()].map(([account, payload]) => ({ account, payload })),
        };
      },
      async upsert(account, payload) {
        keychain.set(account, payload);
        return { ok: true };
      },
      async delete(account) {
        keychain.delete(account);
        return { ok: true };
      },
    };
    const adapter: import('../keychain-sync').LocalSyncAdapter = {
      list: () => store.listSyncRecords(),
      applyRemote: async (_account, record) => {
        await store.applyRemoteSyncRecord(record);
      },
    };

    // An excluded live record plus an excluded tombstone (a forgotten
    // local-only backend) — neither may ever reach the keychain.
    const rec = await store.add({ ...sampleConn, syncExcluded: true });
    const gone = await store.add({
      label: 'Gone',
      host: '10.0.0.5',
      port: 7000,
      fingerprint: 'GG:HH',
      token: 'gone-token',
      syncExcluded: true,
    });
    await store.forget(gone.id);

    let result = await sync.reconcile(adapter, { client });
    expect(result.pushed).toEqual([]);
    expect(keychain.size).toBe(0);

    // Pull side: a NEWER remote live copy of the excluded backend under a
    // DIFFERENT account (same fingerprint — the machine's synced twin).
    const twinAccount = sync.accountKeyFor('192.168.1.99', 9443);
    keychain.set(
      twinAccount,
      sync.serializeRecord({
        label: 'Synced twin',
        host: '192.168.1.99',
        hosts: ['192.168.1.99'],
        port: 9443,
        fingerprint: 'AA:BB:CC',
        hostname: null,
        tcAddress: null,
        detectHosts: true,
        token: 'remote-token',
        updatedAt: Date.now() + 60_000,
      }),
    );
    result = await sync.reconcile(adapter, { client });
    expect(result.pushed).toEqual([]);
    let remotes = (await store.list()).filter((c) => !c.isLocal);
    expect(remotes).toHaveLength(1);
    expect(remotes[0]).toMatchObject({
      id: rec.id,
      host: '192.168.1.10',
      port: 8443,
      syncExcluded: true,
    });
    expect(await store.getDecryptedToken(rec.id)).toBe('secret-token');
    // The excluded record's own account never appeared in the keychain, and
    // its token never leaked into any payload.
    expect(keychain.has(sync.accountKeyFor('192.168.1.10', 8443))).toBe(false);
    expect([...keychain.values()].join()).not.toContain('secret-token');

    // A NEWER remote tombstone for the same fingerprint never deletes it.
    const tombClock = Date.now() + 120_000;
    keychain.set(
      twinAccount,
      sync.serializeRecord({
        label: 'Synced twin',
        host: '192.168.1.99',
        hosts: ['192.168.1.99'],
        port: 9443,
        fingerprint: 'AA:BB:CC',
        hostname: null,
        tcAddress: null,
        detectHosts: true,
        token: '',
        updatedAt: tombClock,
        deleted: true,
        deletedAt: tombClock,
      }),
    );
    result = await sync.reconcile(adapter, { client });
    expect(result.deletedLocally).toEqual([]);
    remotes = (await store.list()).filter((c) => !c.isLocal);
    expect(remotes).toHaveLength(1);
    expect(remotes[0]).toMatchObject({ id: rec.id, syncExcluded: true });
  });

  it('self-refresh port change end to end: the stale keychain account is tombstoned, the record rewritten under the new account', async () => {
    // The refresh path re-upserts the self record through store.add (same
    // fingerprint, new port). This drives the REAL store + REAL reconcile
    // against an in-memory keychain to prove no stale duplicate survives.
    const store = await import('../connections-store');
    const sync = await import('../keychain-sync');

    // In-memory keychain client.
    const keychain = new Map<string, string>();
    const client: import('../keychain-sync').KeychainClient = {
      async list() {
        return {
          ok: true,
          items: [...keychain.entries()].map(([account, payload]) => ({ account, payload })),
        };
      },
      async upsert(account, payload) {
        keychain.set(account, payload);
        return { ok: true };
      },
      async delete(account) {
        keychain.delete(account);
        return { ok: true };
      },
    };
    const adapter: import('../keychain-sync').LocalSyncAdapter = {
      list: () => store.listSyncRecords(),
      applyRemote: async (_account, record) => {
        await store.applyRemoteSyncRecord(record);
      },
    };

    // Publish at the original address and push to the keychain.
    await store.add({ ...sampleConn, host: '192.168.1.10', port: 5181 });
    await sync.reconcile(adapter, { client });
    const oldAccount = sync.accountKeyFor('192.168.1.10', 5181);
    expect([...keychain.keys()]).toEqual([oldAccount]);

    // Port change: the refresh re-upserts under the new port — the store's
    // fingerprint dedupe collapses it into ONE record with a fresh clock.
    await store.add({ ...sampleConn, host: '192.168.1.10', port: 6200 });
    expect((await store.list()).filter((c) => !c.isLocal)).toHaveLength(1);

    await sync.reconcile(adapter, { client });

    // The stale account now holds a tombstone; the record lives under the
    // new account. No live duplicate remains in the keychain.
    const newAccount = sync.accountKeyFor('192.168.1.10', 6200);
    const staleParsed = sync.parsePayload(keychain.get(oldAccount)!);
    expect(staleParsed).toMatchObject({ kind: 'record', record: { deleted: true, token: '' } });
    const newParsed = sync.parsePayload(keychain.get(newAccount)!);
    expect(newParsed).toMatchObject({
      kind: 'record',
      record: { port: 6200, fingerprint: 'AA:BB:CC', token: 'secret-token' },
    });

    // And locally the store still holds exactly one live record (the
    // tombstone pull never resurrects or deletes the moved record).
    const remotes = (await store.list()).filter((c) => !c.isLocal);
    expect(remotes).toHaveLength(1);
    expect(remotes[0]).toMatchObject({ port: 6200 });
  });
});
