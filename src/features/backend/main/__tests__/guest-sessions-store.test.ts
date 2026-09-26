import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import { promises as mutableFs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { invitedPersonKey, invitedRemovalKey } from '../invited-session-key';
import { parseInvitedPayload } from '../invited-session-payload';
import { reconcileInvitedSessions } from '../invited-session-sync';
import {
  serializeRecord,
  accountKeyFor,
  type KeychainClient,
  type KeychainItem,
  type KeychainSyncRecord,
} from '../keychain-sync';
import type { InvitedSession } from '../invited-session-payload';
import { AuthRejectedError } from '../backend-connection';

/**
 * Round-trip tests for the guest sessions store
 * (features/backend/main/guest-sessions-store.ts).
 *
 * The store persists daemons joined as a GUEST (invite.prove credentials)
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
  fingerprint: 'ab'.repeat(32),
  tcAddress: null,
  principalId: 'prn_7',
  login: 'octocat',
  token: 'guest-secret',
};

const authenticate = async (r: { principalId?: string }) => ({
  principalId: r.principalId!,
  login: null,
});
function keychain(items: KeychainItem[] = []): KeychainClient {
  return {
    list: async () => ({ ok: true, items }),
    insert: async (account, payload) => {
      const old = items.find((r) => r.account === account);
      if (!old) items.push({ account, payload });
      return { ok: true, inserted: !old, payload: old?.payload ?? payload };
    },
    upsert: async (account, payload) => {
      const old = items.find((r) => r.account === account);
      if (old) old.payload = payload;
      else items.push({ account, payload });
      return { ok: true };
    },
    delete: async () => ({ ok: true }),
  };
}

type Store = typeof import('../guest-sessions-store');
async function syncRecords(store: Store): Promise<InvitedSession[]> {
  const { items } = await store.createInvitedSyncAdapter(authenticate).read();
  return [...new Map(items.map((r) => [r.account, r])).values()].flatMap((r) => {
    const value = parseInvitedPayload(r.account, r.payload);
    return value?.kind === 'session' ? [value] : [];
  });
}
async function importRecord(
  store: Store,
  record: KeychainSyncRecord | InvitedSession,
): Promise<boolean> {
  const row =
    'kind' in record
      ? { account: invitedPersonKey(record as InvitedSession), payload: JSON.stringify(record) }
      : { account: accountKeyFor(record.host, record.port), payload: serializeRecord(record) };
  const result = await reconcileInvitedSessions(store.createInvitedSyncAdapter(authenticate), {
    client: keychain([row]),
  });
  return result.pulled.length > 0;
}
describe('invited v2 registry durability', () => {
  it('explicitly forgets an unqualified legacy row locally without inventing a synced person', async () => {
    const store = await import('../guest-sessions-store');
    const record = await store.add(sample);
    const raw = await readFile();
    const rows = raw.sessions as Array<{ fingerprint: string }>;
    rows[0].fingerprint = 'legacy-unqualified-pin';
    await fs.writeFile(path.join(tmpDir, 'guest-sessions.json'), JSON.stringify(raw));
    expect(await store.forget(record.id)).toBe(true);
    expect(await store.list()).toEqual([]);
    const next = await readFile();
    expect(next.invitedSync ?? []).toEqual([]);
    expect(next.tombstones).toEqual([]);
  });

  it('a returning link without a tunnel does not invent a clear, while a new known route gets its own clock', async () => {
    const store = await import('../guest-sessions-store');
    const first = await store.add({ ...sample, tcAddress: 'Case_Sensitive/Route' });
    const initial = (await syncRecords(store))[0];
    await store.add({ ...sample, retainPairing: true, tcAddress: null });
    expect((await store.findById(first.id))?.tcAddress).toBe('Case_Sensitive/Route');
    await store.add({ ...sample, retainPairing: true, tcAddress: 'New_Opaque/Route' });
    const next = (await syncRecords(store))[0];
    expect(next.pairedAt).toBe(initial.pairedAt);
    expect(next.tcUpdatedAt).toBeGreaterThan(initial.tcUpdatedAt!);
    expect(next.tcAddress).toBe('New_Opaque/Route');
  });

  it('persists authoritative rejection during sync before dropping only that person', async () => {
    const store = await import('../guest-sessions-store');
    await store.add(sample);
    const other = await store.add({ ...sample, principalId: 'other', token: 'other-token' });
    const remote: KeychainItem[] = [];
    const client = keychain(remote);
    await reconcileInvitedSessions(store.createInvitedSyncAdapter(authenticate), { client });
    const rejected = store.createInvitedSyncAdapter(async (r) => {
      if (r.principalId === sample.principalId) throw new AuthRejectedError(401);
      return authenticate(r);
    });
    await reconcileInvitedSessions(rejected, { client });
    expect((await store.list()).map((r) => r.id)).toEqual([other.id]);
    vi.resetModules();
    const reloaded = await import('../guest-sessions-store');
    const facts = (await reloaded.createInvitedSyncAdapter(authenticate).read()).items.filter((r) =>
      r.account.startsWith('invited-v2-r:'),
    );
    expect(facts).toHaveLength(1);
    await reconcileInvitedSessions(reloaded.createInvitedSyncAdapter(authenticate), { client });
    expect((await reloaded.list()).map((r) => r.id)).toEqual([other.id]);
    expect(remote.some((r) => r.account === facts[0].account)).toBe(true);
  });

  it.each(['timeout', 'listener disabled', 'rejoined'])(
    'sync failure cannot erase a current credential when %s',
    async (kind) => {
      const store = await import('../guest-sessions-store');
      const first = await store.add(sample);
      const client = keychain();
      await reconcileInvitedSessions(store.createInvitedSyncAdapter(authenticate), { client });
      const adapter = store.createInvitedSyncAdapter(async () => {
        if (kind === 'timeout') throw new Error('timeout');
        if (kind === 'listener disabled') throw new AuthRejectedError(403);
        await store.add({ ...sample, token: 'new-token' });
        throw new AuthRejectedError(401);
      });
      await reconcileInvitedSessions(adapter, { client });
      expect(await store.getDecryptedToken(first.id)).toBe(
        kind === 'rejoined' ? 'new-token' : sample.token,
      );
      expect(
        (await adapter.read()).items.filter((r) => r.account.startsWith('invited-v2-r:')),
      ).toEqual([]);
    },
  );

  it('persists offline removal and one immutable outbox identity across restart with encryption locked', async () => {
    const store = await import('../guest-sessions-store');
    const rec = await store.add(sample);
    encryptionAvailable = false;
    expect(await store.forget(rec.id)).toBe(true);
    vi.resetModules();
    const reloaded = await import('../guest-sessions-store');
    const adapter = reloaded.createInvitedSyncAdapter(authenticate);
    const first = await adapter.read();
    const facts = first.items.filter((r) => r.account.startsWith('invited-v2-r:'));
    expect(facts).toHaveLength(1);
    expect(parseInvitedPayload(facts[0].account, facts[0].payload)).toMatchObject({
      kind: 'removal',
      principalId: sample.principalId,
    });
    expect(await reloaded.list()).toEqual([]);
    const client = keychain();
    client.insert = vi.fn(async () => ({ ok: false, code: 'unavailable', message: 'locked' }));
    await expect(reconcileInvitedSessions(adapter, { client })).resolves.toMatchObject({
      errors: [expect.anything()],
    });
    expect(
      (await adapter.read()).items.filter((r) => r.account.startsWith('invited-v2-r:')),
    ).toEqual(facts);
    expect(JSON.stringify(await readFile())).not.toContain(sample.token);
  });

  it('keeps a returning guest upgrade on the same record, bearer, workspaces and pairedAt', async () => {
    const store = await import('../guest-sessions-store');
    const first = await store.add({
      ...sample,
      workspace: { id: 'w1', title: 'Project' },
      hostRole: 'guest',
    });
    const second = await store.add({ ...sample, hostRole: 'member', retainPairing: true });
    expect(second).toMatchObject({
      id: first.id,
      pairedAt: first.pairedAt,
      hostRole: 'member',
      workspaces: first.workspaces,
    });
    expect(await store.getDecryptedToken(second.id)).toBe(sample.token);
    await expect(store.add({ ...sample, retainPairing: true, token: 'rotated' })).rejects.toThrow();
  });

  it('does not apply a late rejection to a replacement credential', async () => {
    const store = await import('../guest-sessions-store');
    const old = await store.add(sample);
    await store.add({ ...sample, token: 'new-bearer' });
    expect(
      await store.forget(old.id, {
        principalId: sample.principalId,
        token: sample.token,
        pairedAt: old.pairedAt!,
      }),
    ).toBe(false);
    expect(await store.getDecryptedToken(old.id)).toBe('new-bearer');
  });

  it('keeps imports encrypted and inactive until pinned remote authentication succeeds after restart', async () => {
    const store = await import('../guest-sessions-store');
    await store.add(sample);
    const row = (await store.createInvitedSyncAdapter(authenticate).read()).items.find((r) =>
      r.account.startsWith('invited-v2-s:'),
    )!;
    await fs.rm(path.join(tmpDir, 'guest-sessions.json'));
    await reconcileInvitedSessions(
      store.createInvitedSyncAdapter(async () => null),
      { client: keychain([row]) },
    );
    expect(await store.list()).toEqual([]);
    expect(JSON.stringify(await readFile())).not.toContain(sample.token);
    vi.resetModules();
    const reloaded = await import('../guest-sessions-store');
    await reconcileInvitedSessions(reloaded.createInvitedSyncAdapter(authenticate), {
      client: keychain([row]),
    });
    expect(await reloaded.list()).toHaveLength(1);
    const [restored] = await reloaded.list();
    expect(restored.workspaces).toEqual([]);
    expect(await reloaded.getDecryptedToken(restored.id)).toBe(sample.token);
  });

  it('retains unknown top-level data through local metadata writes', async () => {
    const store = await import('../guest-sessions-store');
    const record = await store.add(sample);
    const state = await readFile();
    state.future = { keep: 'unchanged' };
    await fs.writeFile(path.join(tmpDir, 'guest-sessions.json'), JSON.stringify(state));
    await store.setHostname(record.id, 'new');
    expect((await readFile()).future).toEqual(state.future);
  });
});

async function readFile(): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(path.join(tmpDir, 'guest-sessions.json'), 'utf8'));
}

describe('guest-sessions-store', () => {
  it('keeps two invited people on one host separate across a disk reload', async () => {
    const store = await import('../guest-sessions-store');
    const fingerprint = 'ab'.repeat(32);
    const b = await store.add({ ...sample, fingerprint, principalId: 'B' });
    const c = await store.add({ ...sample, fingerprint, principalId: 'C', token: 'C-secret' });
    expect(c.id).not.toBe(b.id);
    vi.resetModules();
    const reloaded = await import('../guest-sessions-store');
    expect((await reloaded.list()).map((row) => row.principalId)).toEqual(['B', 'C']);
    expect(await reloaded.getDecryptedToken(b.id)).toBe(sample.token);
    expect(await reloaded.getDecryptedToken(c.id)).toBe('C-secret');
    await reloaded.forget(b.id);
    expect((await reloaded.list()).map((row) => row.principalId)).toEqual(['C']);
  });

  it('never merges different pinned hosts just because their dial address matches', async () => {
    const store = await import('../guest-sessions-store');
    const a = await store.add({ ...sample, fingerprint: 'ab'.repeat(32) });
    const b = await store.add({ ...sample, fingerprint: 'cd'.repeat(32) });
    expect(b.id).not.toBe(a.id);
    expect(await store.list()).toHaveLength(2);
  });

  it('refuses the first credential when OS encryption is unavailable without writing plaintext', async () => {
    const store = await import('../guest-sessions-store');
    encryptionAvailable = false;
    await expect(store.add({ ...sample, fingerprint: 'ab'.repeat(32) })).rejects.toMatchObject({
      code: 'guest-encryption-unavailable',
    });
    expect(await fs.readdir(tmpDir)).toEqual([]);
  });

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
      fingerprint: sample.fingerprint,
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
    const [sync] = await syncRecords(store);
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

  it('leaveWorkspace() leaves the keychain LWW clock alone, so it cannot outrank a remote re-join', async () => {
    const store = await import('../guest-sessions-store');
    const rec = await store.add({ ...sample, workspace: { id: 'ws-1', title: 'Design' } });
    await reconcileInvitedSessions(store.createInvitedSyncAdapter(authenticate), {
      client: keychain(),
    });
    const before = (await store.findById(rec.id))!.updatedAt;

    expect(await store.leaveWorkspace(rec.id, 'ws-1')).toBe(true);
    expect((await store.findById(rec.id))!.updatedAt).toBe(before);
    const [sync] = await syncRecords(store);
    expect(sync.updatedAt).toBe(before);

    // A strictly newer remote copy (another device re-joined with a fresh
    // credential) still wins against the record that just left a workspace.
    const remote = {
      ...sync,
      token: 'rejoined-token',
      pairedAt: before + 1,
      updatedAt: before + 1,
    };
    expect(await importRecord(store, remote)).toBe(true);
    expect((await store.findById(rec.id))!.updatedAt).toBe(before + 1);
    expect(await store.getDecryptedToken(rec.id)).toBe('rejoined-token');
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

  describe('setWorkspaces() — hydrating the joined list from the host', () => {
    const remoteRecord = {
      label: 'remote',
      host: '10.1.1.1',
      hosts: ['10.1.1.1'],
      port: 9000,
      fingerprint: 'cd'.repeat(32),
      hostname: 'remote.local',
      tcAddress: null,
      detectHosts: false,
      token: 'remote-secret',
      principalId: 'prn_9',
      login: 'octocat',
      updatedAt: 1_700_000_000_000,
    };

    it('populates a row written before the field existed and persists it', async () => {
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

      expect(await reloaded.setWorkspaces(rec.id, [{ id: 'ws-1', title: 'Design' }])).toBe(true);
      expect(await reloaded.findById(rec.id)).toMatchObject({
        workspaces: [{ id: 'ws-1', title: 'Design' }],
      });
      await reloaded.__drainWriteChainForTesting();
      const persisted = (await readFile()).sessions as Array<Record<string, unknown>>;
      expect(persisted[0].workspaces).toEqual([{ id: 'ws-1', title: 'Design' }]);
    });

    it('populates a row imported by keychain sync, which never carries the list', async () => {
      const store = await import('../guest-sessions-store');
      expect(await importRecord(store, remoteRecord)).toBe(true);
      const [imported] = await store.list();
      expect(imported.workspaces).toEqual([]);

      expect(
        await store.setWorkspaces(imported.id, [
          { id: 'ws-a', title: 'Alpha' },
          { id: 'ws-b', title: 'Beta' },
        ]),
      ).toBe(true);
      expect(await store.findById(imported.id)).toMatchObject({
        workspaces: [
          { id: 'ws-a', title: 'Alpha' },
          { id: 'ws-b', title: 'Beta' },
        ],
      });
      // Still a local detail: the sync record does not carry it.
      const [sync] = await syncRecords(store);
      expect(sync).not.toHaveProperty('workspaces');
    });

    it('reconciles by id: drops memberships the host no longer lists, retitles, appends new ones in host order', async () => {
      const store = await import('../guest-sessions-store');
      const rec = await store.add({ ...sample, workspace: { id: 'ws-1', title: 'Design' } });
      await store.add({ ...sample, workspace: { id: 'ws-2', title: 'Release' } });
      await store.add({ ...sample, workspace: { id: 'ws-3', title: 'Docs' } });

      expect(
        await store.setWorkspaces(rec.id, [
          { id: 'ws-9', title: 'New' },
          { id: 'ws-3', title: 'Docs v2' },
          { id: 'ws-1', title: 'Design' },
          { id: 'ws-9', title: 'New (dup)' },
        ]),
      ).toBe(true);
      expect((await store.findById(rec.id))?.workspaces).toEqual([
        { id: 'ws-1', title: 'Design' },
        { id: 'ws-3', title: 'Docs v2' },
        { id: 'ws-9', title: 'New' },
      ]);

      expect(await store.setWorkspaces(rec.id, [])).toBe(true);
      expect((await store.findById(rec.id))?.workspaces).toEqual([]);
    });

    it('is a no-op for an unchanged list or an unknown session, and never a syncable mutation', async () => {
      const store = await import('../guest-sessions-store');
      const listener = vi.fn();
      store.onGuestSessionsMutated(listener);
      const rec = await store.add({ ...sample, workspace: { id: 'ws-1', title: 'Design' } });
      listener.mockClear();
      const before = (await store.findById(rec.id))!.updatedAt;

      expect(await store.setWorkspaces(rec.id, [{ id: 'ws-1', title: 'Design' }])).toBe(false);
      expect(await store.setWorkspaces(rec.id, [{ id: 'ws-1', title: 'Renamed' }])).toBe(true);
      expect(await store.setWorkspaces('missing', [{ id: 'ws-1', title: 'Design' }])).toBe(false);

      expect(listener).not.toHaveBeenCalled();
      const after = (await store.findById(rec.id))!;
      expect(after.updatedAt).toBe(before);
      expect(after.workspaces).toEqual([{ id: 'ws-1', title: 'Renamed' }]);
      expect(await store.getDecryptedToken(rec.id)).toBe('guest-secret');
    });
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

  it('keeps a recoverable legacy plaintext row readable but refuses a new plaintext write', async () => {
    const store = await import('../guest-sessions-store');
    const record = await store.add(sample);
    const state = await readFile();
    (state.sessions as Array<{ encToken: unknown }>)[0].encToken = {
      encrypted: false,
      value: sample.token,
    };
    await fs.writeFile(path.join(tmpDir, 'guest-sessions.json'), JSON.stringify(state));
    encryptionAvailable = false;
    expect(await store.getDecryptedToken(record.id)).toBe(sample.token);
    expect((await store.findById(record.id))?.tokenEncrypted).toBe(false);
    await expect(store.add({ ...sample, token: 'next' })).rejects.toMatchObject({
      code: 'guest-encryption-unavailable',
    });
    expect(await store.getDecryptedToken(record.id)).toBe(sample.token);
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
    // The next join can succeed only once encryption is available again.
    encryptionAvailable = true;
    const upgraded = await store.add({ ...sample, token: 'now-encrypted' });
    expect(upgraded.id).toBe(first.id);
    expect(upgraded.tokenEncrypted).toBe(true);
    expect(await store.getDecryptedToken(first.id)).toBe('now-encrypted');
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
    await expect(store.add({ ...sample, fingerprint: 'de'.repeat(32) })).rejects.toMatchObject({
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
    await store.add({ ...sample, token: 'newer-secret' });
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

  it('re-joining the same person keeps the id while a different person gets a separate id', async () => {
    const store = await import('../guest-sessions-store');
    const first = await store.add(sample);
    const second = await store.add({ ...sample, host: 'new.example', token: 'fresh-token' });
    expect(second.id).toBe(first.id);
    expect(await store.getDecryptedToken(second.id)).toBe('fresh-token');
    const other = await store.add({ ...sample, principalId: 'other', token: 'other-token' });
    expect(other.id).not.toBe(first.id);
    expect(await store.list()).toHaveLength(2);
  });
  it('an unpinned legacy row is kept for explicit recovery and never matched by route', async () => {
    const store = await import('../guest-sessions-store');
    const first = await store.add(sample);
    const file = await readFile();
    (file.sessions as Array<{ fingerprint: string }>)[0].fingerprint = '';
    await fs.writeFile(path.join(tmpDir, 'guest-sessions.json'), JSON.stringify(file));
    expect(
      await store.findMatching({
        hosts: [sample.host],
        port: sample.port,
        fingerprint: sample.fingerprint,
      }),
    ).toBeNull();
    const fresh = await store.add(sample);
    expect(fresh.id).not.toBe(first.id);
    expect(await store.list()).toHaveLength(2);
  });
  it('findMatching() requires a pin and never uses candidate host routes', async () => {
    const store = await import('../guest-sessions-store');
    const rec = await store.add(sample);
    expect(
      await store.findMatching({
        hosts: ['203.0.113.1'],
        port: 1,
        fingerprint: sample.fingerprint,
      }),
    ).toMatchObject({ id: rec.id });
    expect(
      await store.findMatching({
        hosts: ['203.0.113.1', '192.168.1.10'],
        port: 8443,
        fingerprint: null,
      }),
    ).toBeNull();
    expect(
      await store.findMatching({
        hosts: ['203.0.113.1'],
        port: 8443,
        fingerprint: 'cd'.repeat(32),
      }),
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
    expect(refreshed).toMatchObject({ tcAddress: ' tc7f2a91.tailcat.net ' });
    expect(refreshed!.updatedAt).toBeGreaterThan(rec.updatedAt);
    // A successful answer without a tunnel clears the stale address.
    expect(await store.setTcAddress(rec.id, null)).toBe(true);
    expect(await store.setTcAddress(rec.id, '')).toBe(false);
    expect(await store.setTcAddress('missing', 'x')).toBe(false);
    expect((await store.findById(rec.id))?.tcAddress).toBeNull();
    expect(mutated).toHaveBeenCalledTimes(2);
    expect(await syncRecords(store)).toEqual([expect.objectContaining({ tcAddress: null })]);
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
    const sync = await syncRecords(store);
    expect(sync).toHaveLength(1);
    expect(sync[0]).toMatchObject({
      deleted: true,
      token: '',
      fingerprint: sample.fingerprint,
      principalId: 'prn_7',
      login: 'octocat',
    });
  });

  it('a re-join after forget clears the tombstone and stamps past it', async () => {
    const store = await import('../guest-sessions-store');
    const rec = await store.add(sample);
    await store.forget(rec.id);
    const [tomb] = await syncRecords(store);
    const again = await store.add(sample);
    const sync = await syncRecords(store);
    expect(sync).toHaveLength(1);
    expect(sync[0]).toMatchObject({ token: 'guest-secret' });
    expect(sync[0].deleted).toBe(false);
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

describe('authenticated invited sync store application', () => {
  it('imports only verified live credentials without local mutation notifications and keeps nullable login', async () => {
    const store = await import('../guest-sessions-store');
    const mutated = vi.fn();
    store.onGuestSessionsMutated(mutated);
    const remote = {
      label: 'remote',
      host: 'remote.example',
      hosts: ['remote.example'],
      port: 443,
      fingerprint: sample.fingerprint,
      hostname: null,
      tcAddress: null,
      detectHosts: true,
      token: 'remote-secret',
      principalId: 'B',
      updatedAt: 100,
    };
    expect(await importRecord(store, remote)).toBe(true);
    const [record] = await store.list();
    expect(record).toMatchObject({ principalId: 'B', login: null, workspaces: [] });
    expect(await store.getDecryptedToken(record.id)).toBe('remote-secret');
    expect(mutated).not.toHaveBeenCalled();
    expect(JSON.stringify(await readFile())).not.toContain('remote-secret');
  });
  it('applies a newer verified pairing to the same id and invalidates only its pooled credential', async () => {
    const store = await import('../guest-sessions-store');
    const first = await store.add(sample);
    const adapter = store.createInvitedSyncAdapter(authenticate);
    await reconcileInvitedSessions(adapter, { client: keychain() });
    const [before] = await syncRecords(store);
    const replaced = vi.fn();
    store.onGuestCredentialReplaced(replaced);
    await importRecord(store, {
      ...before,
      token: 'replacement',
      pairedAt: before.pairedAt + 1,
      updatedAt: before.updatedAt + 1,
    });
    expect(replaced).toHaveBeenCalledExactlyOnceWith(first.id);
    expect(await store.getDecryptedToken(first.id)).toBe('replacement');
  });
  it('preserves disk bytes and credentials on encryption failure during import', async () => {
    const store = await import('../guest-sessions-store');
    const first = await store.add(sample);
    await reconcileInvitedSessions(store.createInvitedSyncAdapter(authenticate), {
      client: keychain(),
    });
    const [before] = await syncRecords(store);
    const bytes = await fs.readFile(path.join(tmpDir, 'guest-sessions.json'), 'utf8');
    encryptionAvailable = false;
    await expect(
      importRecord(store, {
        ...before,
        token: 'replacement',
        pairedAt: before.pairedAt + 1,
        updatedAt: before.updatedAt + 1,
      }),
    ).rejects.toMatchObject({ code: 'guest-encryption-unavailable' });
    expect(await fs.readFile(path.join(tmpDir, 'guest-sessions.json'), 'utf8')).toBe(bytes);
    expect(await store.getDecryptedToken(first.id)).toBe(sample.token);
  });
  it('a removal from another device removes only its person and notifies the correct pool', async () => {
    const store = await import('../guest-sessions-store');
    const b = await store.add(sample);
    const c = await store.add({ ...sample, principalId: 'C', token: 'C-token' });
    await reconcileInvitedSessions(store.createInvitedSyncAdapter(authenticate), {
      client: keychain(),
    });
    const removed = vi.fn();
    store.onGuestSessionRemovedBySync(removed);
    const r = {
      v: 2 as const,
      kind: 'removal' as const,
      fingerprint: sample.fingerprint,
      principalId: sample.principalId,
      removalId: '00000000-0000-4000-8000-000000000001',
      removedThrough: Date.now() + 1000,
      legacyAccounts: [],
    };
    await reconcileInvitedSessions(store.createInvitedSyncAdapter(authenticate), {
      client: keychain([{ account: invitedRemovalKey(r), payload: JSON.stringify(r) }]),
    });
    expect(removed).toHaveBeenCalledExactlyOnceWith(b.id);
    expect(await store.findById(b.id)).toBeNull();
    expect(await store.getDecryptedToken(c.id)).toBe('C-token');
  });
  it('honors the connection form sync opt-out for an invited personal token', async () => {
    const store = await import('../guest-sessions-store');
    await store.add({ ...sample, syncExcluded: true });
    const client = keychain();
    client.upsert = vi.fn(client.upsert);
    await reconcileInvitedSessions(store.createInvitedSyncAdapter(authenticate), { client });
    expect(client.upsert).not.toHaveBeenCalled();
    expect(await store.list()).toHaveLength(1);
  });
});
