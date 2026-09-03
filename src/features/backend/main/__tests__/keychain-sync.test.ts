import { describe, expect, it, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

/**
 * Keychain sync (features/backend/main/keychain-sync.ts): payload schema,
 * helper spawn wrapper, and the two-way reconcile engine.
 *
 * The reconcile suites drive `reconcile()` with an in-memory mocked
 * KeychainClient + LocalSyncAdapter; the client suites mock
 * `child_process.spawn` and assert the wire contract with the real
 * `intent-keychain-helper` CLI (argv, stdin envelope, structured errors).
 */

// Mock child_process.spawn so no real helper process is launched. Both the
// `node:`-prefixed and bare specifiers must be mocked: the global test-setup
// mocks bare 'child_process' with the REAL spawn preserved, which otherwise
// wins the module-resolution race for this file. (vi.mock is hoisted, so the
// shared mock fn must be hoisted too.)
const spawnMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return { ...actual, spawn: spawnMock, default: { ...actual, spawn: spawnMock } };
});
vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return { ...actual, spawn: spawnMock, default: { ...actual, spawn: spawnMock } };
});

import { spawn } from 'child_process';
import {
  KEYCHAIN_PAYLOAD_VERSION,
  MAX_HELPER_OUTPUT_BYTES,
  TOMBSTONE_TTL_MS,
  accountKeyFor,
  createHelperKeychainClient,
  migrateLegacyGroupItems,
  parsePayload,
  reconcile,
  serializeRecord,
  type HelperErrorCode,
  type KeychainClient,
  type KeychainItem,
  type KeychainSyncRecord,
  type LocalSyncAdapter,
} from '../keychain-sync';

/** Fixed clock so TTL math is deterministic. */
const NOW = 1_700_000_000_000;

function rec(overrides: Partial<KeychainSyncRecord> = {}): KeychainSyncRecord {
  return {
    label: 'Studio Mac',
    accent: 'blue',
    host: '192.168.1.10',
    hosts: ['192.168.1.10'],
    port: 8443,
    fingerprint: 'AA:BB:CC',
    hostname: 'studio.local',
    tcAddress: null,
    detectHosts: true,
    token: 'secret-token',
    updatedAt: NOW - 10_000,
    ...overrides,
  };
}

function tombstone(overrides: Partial<KeychainSyncRecord> = {}): KeychainSyncRecord {
  const base = rec({ deleted: true, token: '', ...overrides });
  base.deletedAt = overrides.deletedAt ?? base.updatedAt;
  return base;
}

const ACCOUNT = accountKeyFor('192.168.1.10', 8443);

function item(record: KeychainSyncRecord): KeychainItem {
  return { account: accountKeyFor(record.host, record.port), payload: serializeRecord(record) };
}

/** In-memory KeychainClient recording writes; list/upsert/delete can fail on
 * demand (`upsertErrors` fails only the named accounts). `sharedGroup` makes
 * `list()` advertise a resolved shared access group; `scopedDeletes` records
 * the group each delete was scoped to. */
function fakeClient(
  items: KeychainItem[] = [],
  opts: {
    listError?: HelperErrorCode;
    upsertError?: HelperErrorCode;
    upsertErrors?: Record<string, HelperErrorCode>;
    deleteError?: HelperErrorCode;
    sharedGroup?: string;
  } = {},
) {
  const upserts: { account: string; payload: string }[] = [];
  const deletes: string[] = [];
  const scopedDeletes: { account: string; group?: string }[] = [];
  const client: KeychainClient = {
    async list() {
      if (opts.listError) return { ok: false, code: opts.listError, message: 'mock failure' };
      return opts.sharedGroup !== undefined
        ? { ok: true, items, sharedGroup: opts.sharedGroup }
        : { ok: true, items };
    },
    async upsert(account, payload) {
      const code = opts.upsertErrors?.[account] ?? opts.upsertError;
      if (code) return { ok: false, code, message: 'mock failure' };
      upserts.push({ account, payload });
      return { ok: true };
    },
    async delete(account, group) {
      if (opts.deleteError) return { ok: false, code: opts.deleteError, message: 'mock failure' };
      deletes.push(account);
      scopedDeletes.push({ account, group });
      return { ok: true };
    },
  };
  return { client, upserts, deletes, scopedDeletes };
}

/** In-memory LocalSyncAdapter recording remote applications. */
function fakeAdapter(records: KeychainSyncRecord[] = []) {
  const applied: { account: string; record: KeychainSyncRecord }[] = [];
  let listCalls = 0;
  const adapter: LocalSyncAdapter = {
    async list() {
      listCalls += 1;
      return records;
    },
    async applyRemote(account, record) {
      applied.push({ account, record });
    },
  };
  return { adapter, applied, listCalls: () => listCalls };
}

describe('accountKeyFor', () => {
  it('normalizes to trimmed lowercase host:port', () => {
    expect(accountKeyFor('  Studio.LOCAL ', 8443)).toBe('studio.local:8443');
    expect(accountKeyFor('192.168.1.10', 443)).toBe('192.168.1.10:443');
  });
});

describe('payload schema', () => {
  it('round-trips a live record', () => {
    const record = rec();
    const parsed = parsePayload(serializeRecord(record));
    expect(parsed).toEqual({ kind: 'record', record });
  });

  it('round-trips an explicit blank accent on live records and tombstones', () => {
    expect(parsePayload(serializeRecord(rec({ accent: null })))).toEqual({
      kind: 'record',
      record: rec({ accent: null }),
    });
    expect(parsePayload(serializeRecord(tombstone({ accent: null })))).toEqual({
      kind: 'record',
      record: tombstone({ accent: null }),
    });
  });

  it('scrubs the token from tombstone payloads', () => {
    const payload = serializeRecord(rec({ deleted: true, deletedAt: NOW - 1 }));
    const raw = JSON.parse(payload) as Record<string, unknown>;
    expect(raw.token).toBe('');
    expect(raw.deleted).toBe(true);
    expect(raw.deletedAt).toBe(NOW - 1);
    expect(payload).not.toContain('secret-token');
  });

  it('stamps the current schema version', () => {
    const raw = JSON.parse(serializeRecord(rec())) as Record<string, unknown>;
    expect(raw.v).toBe(KEYCHAIN_PAYLOAD_VERSION);
  });

  it('rejects malformed payloads', () => {
    expect(parsePayload('not json').kind).toBe('invalid');
    expect(parsePayload('[]').kind).toBe('invalid');
    expect(parsePayload('{"v":1}').kind).toBe('invalid');
    expect(parsePayload(JSON.stringify({ ...rec(), v: 1, port: 'x' })).kind).toBe('invalid');
  });

  it('flags payloads from a newer schema version', () => {
    const payload = JSON.stringify({ ...rec(), v: KEYCHAIN_PAYLOAD_VERSION + 1 });
    expect(parsePayload(payload).kind).toBe('newer-version');
  });

  it('defaults optional fields on parse', () => {
    const payload = JSON.stringify({
      v: 1,
      label: 'A',
      host: 'h',
      port: 1,
      fingerprint: 'F',
      token: 't',
      updatedAt: 5,
    });
    const parsed = parsePayload(payload);
    expect(parsed).toMatchObject({
      kind: 'record',
      record: { accent: 'blue', hosts: ['h'], hostname: null, tcAddress: null, detectHosts: true },
    });
  });

  it('round-trips a tc address and defaults blank/malformed ones to null', () => {
    const record = rec({ tcAddress: 'tc7f2a91.tailcat.net' });
    expect(parsePayload(serializeRecord(record))).toEqual({ kind: 'record', record });
    // Payloads from apps that predate the field (or wrote junk) parse as
    // null — additive compatibility, never `invalid`.
    expect(parsePayload(JSON.stringify({ ...rec(), v: 1, tcAddress: '  ' }))).toMatchObject({
      kind: 'record',
      record: { tcAddress: null },
    });
    expect(parsePayload(JSON.stringify({ ...rec(), v: 1, tcAddress: 42 }))).toMatchObject({
      kind: 'record',
      record: { tcAddress: null },
    });
  });

  it('rejects accents outside the shared palette', () => {
    const payload = JSON.stringify({ ...rec(), v: 1, accent: 'chartreuse' });
    expect(parsePayload(payload).kind).toBe('invalid');
  });
});

describe('reconcile', () => {
  it('fresh install: pulls every remote live record into an empty local store', async () => {
    const other = rec({
      host: '10.0.0.2',
      port: 9000,
      label: 'Laptop',
      fingerprint: 'DD:EE:FF',
      updatedAt: NOW - 5000,
    });
    const { client, upserts, deletes } = fakeClient([item(rec()), item(other)]);
    const { adapter, applied } = fakeAdapter([]);

    const result = await reconcile(adapter, { client, now: NOW });

    expect(result.status).toEqual({ state: 'active' });
    expect(result.pulled.sort()).toEqual([ACCOUNT, accountKeyFor('10.0.0.2', 9000)].sort());
    expect(applied).toHaveLength(2);
    expect(applied.find((a) => a.account === ACCOUNT)?.record).toEqual(rec());
    expect(result.pushed).toEqual([]);
    expect(upserts).toEqual([]);
    expect(deletes).toEqual([]);
  });

  it('local newer: pushes the local record to the keychain, local store untouched', async () => {
    const localRecord = rec({ label: 'Renamed', token: 'new-token', updatedAt: NOW - 1000 });
    const { client, upserts } = fakeClient([item(rec({ updatedAt: NOW - 10_000 }))]);
    const { adapter, applied } = fakeAdapter([localRecord]);

    const result = await reconcile(adapter, { client, now: NOW });

    expect(result.pushed).toEqual([ACCOUNT]);
    expect(result.pulled).toEqual([]);
    expect(applied).toEqual([]);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].account).toBe(ACCOUNT);
    expect(parsePayload(upserts[0].payload)).toEqual({ kind: 'record', record: localRecord });
  });

  it('remote newer: overwrites the local record (token included)', async () => {
    const remoteRecord = rec({
      label: 'Rotated',
      accent: null,
      token: 'rotated-token',
      updatedAt: NOW - 1000,
    });
    const { client, upserts } = fakeClient([item(remoteRecord)]);
    const { adapter, applied } = fakeAdapter([rec({ updatedAt: NOW - 10_000 })]);

    const result = await reconcile(adapter, { client, now: NOW });

    expect(result.pulled).toEqual([ACCOUNT]);
    expect(applied).toEqual([{ account: ACCOUNT, record: remoteRecord }]);
    expect(upserts).toEqual([]);
  });

  it('a detectHosts=false flip stamped past a peer refresh wins: pushed, the refreshed IPs are not pulled back', async () => {
    // A peer that has not pulled the flip yet refreshed its candidate list
    // at clock T; the flip was stamped strictly past T, so LWW keeps the
    // cleared list and the flip propagates instead of the resurrected IPs.
    const peerRefresh = rec({
      hosts: ['192.168.1.10', '10.0.0.5', '10.0.0.6'],
      updatedAt: NOW - 1000,
    });
    const flip = rec({ hosts: ['192.168.1.10'], detectHosts: false, updatedAt: NOW - 999 });
    const { client, upserts } = fakeClient([item(peerRefresh)]);
    const { adapter, applied } = fakeAdapter([flip]);

    const result = await reconcile(adapter, { client, now: NOW });

    expect(result.pulled).toEqual([]);
    expect(applied).toEqual([]);
    expect(result.pushed).toEqual([ACCOUNT]);
    expect(parsePayload(upserts[0].payload)).toEqual({ kind: 'record', record: flip });
  });

  it('remote tombstone newer than local live: deletes locally, no purge before TTL', async () => {
    const stone = tombstone({ updatedAt: NOW - 1000 });
    const { client, deletes } = fakeClient([item(stone)]);
    const { adapter, applied } = fakeAdapter([rec({ updatedAt: NOW - 10_000 })]);

    const result = await reconcile(adapter, { client, now: NOW });

    expect(result.deletedLocally).toEqual([ACCOUNT]);
    expect(applied).toHaveLength(1);
    expect(applied[0].record.deleted).toBe(true);
    expect(result.purged).toEqual([]);
    expect(deletes).toEqual([]);
  });

  it('tombstone vs re-add: the newer local live record wins and is pushed', async () => {
    const readd = rec({ token: 'fresh-token', updatedAt: NOW - 1000 });
    const { client, upserts } = fakeClient([item(tombstone({ updatedAt: NOW - 10_000 }))]);
    const { adapter, applied } = fakeAdapter([readd]);

    const result = await reconcile(adapter, { client, now: NOW });

    expect(result.pushed).toEqual([ACCOUNT]);
    expect(applied).toEqual([]);
    expect(parsePayload(upserts[0].payload)).toEqual({ kind: 'record', record: readd });
  });

  it('keychain unavailable: clean no-op that never touches the local store', async () => {
    for (const code of ['unavailable', 'helper-missing', 'unsupported-platform'] as const) {
      const { client, upserts, deletes } = fakeClient([], { listError: code });
      const { adapter, applied, listCalls } = fakeAdapter([rec()]);

      const result = await reconcile(adapter, { client, now: NOW });

      expect(result.status).toEqual({
        state: 'unavailable',
        reason: code,
        message: 'mock failure',
      });
      expect(applied).toEqual([]);
      expect(listCalls()).toBe(0);
      expect(upserts).toEqual([]);
      expect(deletes).toEqual([]);
      expect(result.pulled).toEqual([]);
      expect(result.pushed).toEqual([]);
    }
  });

  it('local-only record: pushed to the keychain', async () => {
    const { client, upserts } = fakeClient([]);
    const { adapter } = fakeAdapter([rec()]);

    const result = await reconcile(adapter, { client, now: NOW });

    expect(result.pushed).toEqual([ACCOUNT]);
    expect(upserts).toHaveLength(1);
  });

  it('local tombstone with no remote item: pushed so other machines learn the delete', async () => {
    const { client, upserts } = fakeClient([]);
    const { adapter } = fakeAdapter([tombstone({ updatedAt: NOW - 1000 })]);

    const result = await reconcile(adapter, { client, now: NOW });

    expect(result.pushed).toEqual([ACCOUNT]);
    const parsed = parsePayload(upserts[0].payload);
    expect(parsed).toMatchObject({ kind: 'record', record: { deleted: true, token: '' } });
  });

  it('expired local tombstone with no remote item: never resurrected', async () => {
    const { client, upserts } = fakeClient([]);
    const { adapter } = fakeAdapter([tombstone({ updatedAt: NOW - TOMBSTONE_TTL_MS - 1 })]);

    const result = await reconcile(adapter, { client, now: NOW });

    expect(result.pushed).toEqual([]);
    expect(upserts).toEqual([]);
  });

  it('fresh remote tombstone with no local record: no-op', async () => {
    const { client, deletes } = fakeClient([item(tombstone({ updatedAt: NOW - 1000 }))]);
    const { adapter, applied } = fakeAdapter([]);

    const result = await reconcile(adapter, { client, now: NOW });

    expect(applied).toEqual([]);
    expect(deletes).toEqual([]);
    expect(result.purged).toEqual([]);
  });

  it('expired remote tombstone with no local record: purged from the keychain', async () => {
    const stone = tombstone({ updatedAt: NOW - TOMBSTONE_TTL_MS - 1 });
    const { client, deletes } = fakeClient([item(stone)]);
    const { adapter, applied } = fakeAdapter([]);

    const result = await reconcile(adapter, { client, now: NOW });

    expect(result.purged).toEqual([ACCOUNT]);
    expect(deletes).toEqual([ACCOUNT]);
    expect(applied).toEqual([]);
  });

  it('matching tombstones on both sides: no writes; purge only after TTL', async () => {
    const fresh = tombstone({ updatedAt: NOW - 1000 });
    {
      const { client, upserts, deletes } = fakeClient([item(fresh)]);
      const { adapter, applied } = fakeAdapter([fresh]);
      await reconcile(adapter, { client, now: NOW });
      expect(upserts).toEqual([]);
      expect(deletes).toEqual([]);
      expect(applied).toEqual([]);
    }
    {
      const expired = tombstone({ updatedAt: NOW - TOMBSTONE_TTL_MS - 1 });
      const { client, deletes } = fakeClient([item(expired)]);
      const { adapter } = fakeAdapter([expired]);
      const result = await reconcile(adapter, { client, now: NOW });
      expect(result.purged).toEqual([ACCOUNT]);
      expect(deletes).toEqual([ACCOUNT]);
    }
  });

  it('equal clocks, both live: in sync, no writes either way', async () => {
    const record = rec({ updatedAt: NOW - 1000 });
    const { client, upserts, deletes } = fakeClient([item(record)]);
    const { adapter, applied } = fakeAdapter([record]);

    const result = await reconcile(adapter, { client, now: NOW });

    expect(applied).toEqual([]);
    expect(upserts).toEqual([]);
    expect(deletes).toEqual([]);
    expect(result.pulled).toEqual([]);
    expect(result.pushed).toEqual([]);
  });

  it('equal clocks but only local carries a tc address: pushed re-stamped strictly newer', async () => {
    // Additive-field upgrade: the address was captured by an app version
    // that did not sync tcAddress, so the local record and its keychain
    // copy share the same clock. The address-bearing side must win or the
    // address never reaches the user's other devices.
    const remoteRecord = rec({ updatedAt: NOW - 1000 });
    const localRecord = rec({ updatedAt: NOW - 1000, tcAddress: 'tc123.example.ts.net' });
    const { client, upserts } = fakeClient([item(remoteRecord)]);
    const { adapter, applied } = fakeAdapter([localRecord]);

    const result = await reconcile(adapter, { client, now: NOW });

    expect(applied).toEqual([]);
    expect(result.pushed).toEqual([ACCOUNT]);
    expect(parsePayload(upserts[0].payload)).toEqual({
      kind: 'record',
      record: { ...localRecord, updatedAt: NOW },
    });
  });

  it('equal clocks but only remote carries a tc address: pulled verbatim', async () => {
    const remoteRecord = rec({ updatedAt: NOW - 1000, tcAddress: 'tc123.example.ts.net' });
    const localRecord = rec({ updatedAt: NOW - 1000 });
    const { client, upserts } = fakeClient([item(remoteRecord)]);
    const { adapter, applied } = fakeAdapter([localRecord]);

    const result = await reconcile(adapter, { client, now: NOW });

    expect(upserts).toEqual([]);
    expect(result.pulled).toEqual([ACCOUNT]);
    expect(applied).toEqual([{ account: ACCOUNT, record: remoteRecord }]);
  });

  it('equal clocks with matching tc addresses stay in sync (no writes)', async () => {
    const record = rec({ updatedAt: NOW - 1000, tcAddress: 'tc123.example.ts.net' });
    const { client, upserts } = fakeClient([item(record)]);
    const { adapter, applied } = fakeAdapter([record]);

    const result = await reconcile(adapter, { client, now: NOW });

    expect(applied).toEqual([]);
    expect(upserts).toEqual([]);
    expect(result.pulled).toEqual([]);
    expect(result.pushed).toEqual([]);
  });

  it('two divergent zero-clock (pre-sync) records: local pushed with a fresh stamp', async () => {
    // Both machines hold pre-sync records (updatedAt 0) with different
    // content. The plain equal-clock skip would leave them divergent forever;
    // instead the local copy is pushed re-stamped to `now`, so the other
    // machine pulls it on its next pass and both converge.
    const remoteRecord = rec({ label: 'Old A', token: 'token-a', updatedAt: 0 });
    const localRecord = rec({ label: 'Old B', token: 'token-b', updatedAt: 0 });
    const { client, upserts } = fakeClient([item(remoteRecord)]);
    const { adapter, applied } = fakeAdapter([localRecord]);

    const result = await reconcile(adapter, { client, now: NOW });

    expect(result.pushed).toEqual([ACCOUNT]);
    expect(applied).toEqual([]);
    expect(parsePayload(upserts[0].payload)).toEqual({
      kind: 'record',
      record: { ...localRecord, updatedAt: NOW },
    });
  });

  it('a local-only zero-clock record is pushed re-stamped (keychain never holds clock 0)', async () => {
    const { client, upserts } = fakeClient([]);
    const { adapter } = fakeAdapter([rec({ updatedAt: 0 })]);

    const result = await reconcile(adapter, { client, now: NOW });

    expect(result.pushed).toEqual([ACCOUNT]);
    expect(parsePayload(upserts[0].payload)).toEqual({
      kind: 'record',
      record: rec({ updatedAt: NOW }),
    });
  });

  it('expired remote tombstone vs local live: local survives, stale tombstone purged', async () => {
    // A Mac offline beyond the TTL must NOT lose its live connection to an
    // expired tombstone, even one with a newer clock — the delete-propagation
    // window has closed. The tombstone is purged and the survivor pushed.
    const localRecord = rec({ updatedAt: NOW - TOMBSTONE_TTL_MS - 10_000 });
    const stone = tombstone({
      updatedAt: NOW - TOMBSTONE_TTL_MS - 5000,
      deletedAt: NOW - TOMBSTONE_TTL_MS - 5000,
    });
    const { client, upserts, deletes } = fakeClient([item(stone)]);
    const { adapter, applied } = fakeAdapter([localRecord]);

    const result = await reconcile(adapter, { client, now: NOW });

    expect(applied).toEqual([]);
    expect(result.deletedLocally).toEqual([]);
    expect(result.purged).toEqual([ACCOUNT]);
    expect(deletes).toEqual([ACCOUNT]);
    expect(result.pushed).toEqual([ACCOUNT]);
    expect(parsePayload(upserts[0].payload)).toEqual({ kind: 'record', record: localRecord });
  });

  it('shouldAbort stops the pass before further writes', async () => {
    const a = rec({ updatedAt: NOW - 1000 });
    const b = rec({ host: '10.0.0.2', port: 9000, updatedAt: NOW - 1000 });
    const { client, upserts } = fakeClient([]);
    const { adapter } = fakeAdapter([a, b]);

    let calls = 0;
    const result = await reconcile(adapter, {
      client,
      now: NOW,
      // First account proceeds; the pass aborts before the second.
      shouldAbort: () => calls++ >= 1,
    });

    expect(upserts).toHaveLength(1);
    expect(result.pushed).toHaveLength(1);
  });

  it('equal clocks, tombstone vs live: the tombstone wins deterministically', async () => {
    const stone = tombstone({ updatedAt: NOW - 1000 });
    const { client } = fakeClient([item(stone)]);
    const { adapter, applied } = fakeAdapter([rec({ updatedAt: NOW - 1000 })]);

    const result = await reconcile(adapter, { client, now: NOW });

    expect(result.deletedLocally).toEqual([ACCOUNT]);
    expect(applied[0].record.deleted).toBe(true);
  });

  it('unparseable and newer-version items freeze their account (no pull, no push-over)', async () => {
    const newer = JSON.stringify({ ...rec(), v: KEYCHAIN_PAYLOAD_VERSION + 1 });
    const { client, upserts } = fakeClient([
      { account: ACCOUNT, payload: 'garbage' },
      { account: 'other:1', payload: newer },
    ]);
    const { adapter, applied } = fakeAdapter([rec({ updatedAt: NOW })]);

    const result = await reconcile(adapter, { client, now: NOW });

    expect(result.skipped.sort()).toEqual([ACCOUNT, 'other:1'].sort());
    expect(applied).toEqual([]);
    expect(upserts).toEqual([]);
  });

  it('push failures are fail-soft: collected in errors, status stays active with the count', async () => {
    const { client } = fakeClient([], { upsertError: 'keychain-error' });
    const { adapter } = fakeAdapter([rec()]);

    const result = await reconcile(adapter, { client, now: NOW });

    expect(result.status).toEqual({ state: 'active', errorCount: 1 });
    expect(result.pushed).toEqual([]);
    expect(result.errors).toEqual([{ account: ACCOUNT, op: 'upsert', code: 'keychain-error' }]);
  });

  it('every upsert rejected as unavailable: status flips to unavailable (writes rejected, reads OK)', async () => {
    // The hardware-confirmed failure mode: list succeeds (0 items) but every
    // push fails code=unavailable — "Sync is active" must not be shown.
    const second = rec({ host: '10.0.0.2', port: 9000 });
    const { client } = fakeClient([], { upsertError: 'unavailable' });
    const { adapter, applied } = fakeAdapter([rec(), second]);

    const result = await reconcile(adapter, { client, now: NOW });

    expect(result.status).toEqual({
      state: 'unavailable',
      reason: 'unavailable',
      message: expect.stringContaining('writes are being rejected'),
    });
    expect(result.pushed).toEqual([]);
    expect(result.errors).toHaveLength(2);
    expect(applied).toEqual([]);
  });

  it('every purge rejected as unavailable: delete ops count as writes too', async () => {
    const stone = tombstone({ updatedAt: NOW - TOMBSTONE_TTL_MS - 1 });
    const { client } = fakeClient([item(stone)], { deleteError: 'unavailable' });
    const { adapter } = fakeAdapter([]);

    const result = await reconcile(adapter, { client, now: NOW });

    expect(result.status).toMatchObject({ state: 'unavailable', reason: 'unavailable' });
    expect(result.purged).toEqual([]);
    expect(result.errors).toEqual([{ account: ACCOUNT, op: 'delete', code: 'unavailable' }]);
  });

  it('partial write failure: status stays active carrying the error count', async () => {
    const failing = rec({ host: '10.0.0.2', port: 9000 });
    const { client } = fakeClient([], {
      upsertErrors: { [accountKeyFor('10.0.0.2', 9000)]: 'unavailable' },
    });
    const { adapter } = fakeAdapter([rec(), failing]);

    const result = await reconcile(adapter, { client, now: NOW });

    expect(result.status).toEqual({ state: 'active', errorCount: 1 });
    expect(result.pushed).toEqual([ACCOUNT]);
    expect(result.errors).toEqual([
      { account: accountKeyFor('10.0.0.2', 9000), op: 'upsert', code: 'unavailable' },
    ]);
  });

  it('all writes failing with MIXED codes stays active-degraded, not unavailable', async () => {
    const second = rec({ host: '10.0.0.2', port: 9000 });
    const { client } = fakeClient([], {
      upsertErrors: {
        [ACCOUNT]: 'unavailable',
        [accountKeyFor('10.0.0.2', 9000)]: 'keychain-error',
      },
    });
    const { adapter } = fakeAdapter([rec(), second]);

    const result = await reconcile(adapter, { client, now: NOW });

    expect(result.status).toEqual({ state: 'active', errorCount: 2 });
  });

  it('no-op reconcile (nothing to write) with a successful list stays plain active', async () => {
    const record = rec({ updatedAt: NOW - 1000 });
    // Writes would fail if attempted — but none are, so the verdict is clean.
    const { client } = fakeClient([item(record)], { upsertError: 'unavailable' });
    const { adapter } = fakeAdapter([record]);

    const result = await reconcile(adapter, { client, now: NOW });

    expect(result.status).toEqual({ state: 'active' });
    expect(result.errors).toEqual([]);
  });
});

describe('reconcile fingerprint identity (cross-account dedupe)', () => {
  // The machine changed address: locally it lives at the NEW account, the
  // keychain still holds it under the OLD account (same cert fingerprint).
  const OLD_ACCOUNT = ACCOUNT; // 192.168.1.10:8443
  const NEW_ACCOUNT = accountKeyFor('192.168.1.99', 9443);
  const moved = (overrides: Partial<KeychainSyncRecord> = {}) =>
    rec({ host: '192.168.1.99', hosts: ['192.168.1.99'], port: 9443, ...overrides });

  it('local newer under a new account: the stale remote account is tombstoned, never pulled', async () => {
    const localRecord = moved({ updatedAt: NOW - 1000 });
    const staleRemote = rec({ updatedAt: NOW - 50_000 });
    const { client, upserts } = fakeClient([item(staleRemote)]);
    const { adapter, applied } = fakeAdapter([localRecord]);

    const result = await reconcile(adapter, { client, now: NOW });

    // The stale account never resurrects locally.
    expect(applied).toEqual([]);
    expect(result.pulled).toEqual([]);

    // The stale account is tombstoned + the survivor pushed under its own.
    expect(result.pushed.sort()).toEqual([OLD_ACCOUNT, NEW_ACCOUNT].sort());
    const stalePush = upserts.find((u) => u.account === OLD_ACCOUNT);
    const survivorPush = upserts.find((u) => u.account === NEW_ACCOUNT);
    const staleParsed = parsePayload(stalePush!.payload);
    expect(staleParsed).toMatchObject({
      kind: 'record',
      record: { deleted: true, token: '', deletedAt: NOW },
    });
    // The tombstone's clock stays strictly older than the survivor's so it
    // can never win over the live record on another machine.
    expect((staleParsed as { record: KeychainSyncRecord }).record.updatedAt).toBeLessThan(
      localRecord.updatedAt,
    );
    expect(parsePayload(survivorPush!.payload)).toEqual({
      kind: 'record',
      record: localRecord,
    });
  });

  it('remote newer under a different account: pulled so the store collapses by fingerprint', async () => {
    // The OTHER machine saw the address change first: the keychain holds the
    // machine under the NEW account, locally it still sits at the old one.
    const remoteRecord = moved({ token: 'rotated', updatedAt: NOW - 1000 });
    const localRecord = rec({ updatedAt: NOW - 50_000 });
    const { client, upserts } = fakeClient([item(remoteRecord)]);
    const { adapter, applied } = fakeAdapter([localRecord]);

    const result = await reconcile(adapter, { client, now: NOW });

    expect(result.pulled).toEqual([NEW_ACCOUNT]);
    expect(applied).toEqual([{ account: NEW_ACCOUNT, record: remoteRecord }]);
    // The consumed old-account snapshot is NOT pushed back.
    expect(result.pushed).toEqual([]);
    expect(upserts).toEqual([]);
  });

  it('fresh remote tombstone matching by fingerprint deletes the moved local record (tie favors delete)', async () => {
    // Forgotten on another machine under the OLD address while it moved here.
    const stone = tombstone({ updatedAt: NOW - 1000 });
    const localRecord = moved({ updatedAt: NOW - 1000 }); // equal clock
    const { client, upserts } = fakeClient([item(stone)]);
    const { adapter, applied } = fakeAdapter([localRecord]);

    const result = await reconcile(adapter, { client, now: NOW });

    expect(result.deletedLocally).toEqual([OLD_ACCOUNT]);
    expect(applied).toHaveLength(1);
    expect(applied[0].record.deleted).toBe(true);
    // The delete must ALSO reach the keychain under the surviving (new)
    // account: without that tombstone, machines holding the record under the
    // new address keep it, and this machine pulls it back on its next pass.
    expect(result.pushed).toEqual([NEW_ACCOUNT]);
    const parsed = parsePayload(upserts[0].payload);
    expect(parsed).toMatchObject({
      kind: 'record',
      record: { deleted: true, token: '', updatedAt: stone.updatedAt, deletedAt: NOW },
    });
  });

  it('a fresh tombstone shields a live same-fingerprint record under ANY account from being pulled (no local record)', async () => {
    // Forget raced an address change: the keychain holds a fresh tombstone
    // under the OLD account and a live (older) record under the NEW one. A
    // machine with no live local record (fresh install, or it just honored
    // the tombstone) must NOT pull the live record back in — it must
    // tombstone the surviving account instead so every machine converges.
    const stone = tombstone({ updatedAt: NOW - 1000 });
    const live = moved({ updatedAt: NOW - 5000 });
    const { client, upserts } = fakeClient([item(stone), item(live)]);
    const { adapter, applied } = fakeAdapter([]);

    const result = await reconcile(adapter, { client, now: NOW });

    expect(applied).toEqual([]);
    expect(result.pulled).toEqual([]);
    expect(result.pushed).toEqual([NEW_ACCOUNT]);
    const parsed = parsePayload(upserts[0].payload);
    expect(parsed).toMatchObject({
      kind: 'record',
      record: { deleted: true, token: '', updatedAt: stone.updatedAt, deletedAt: NOW },
    });
  });

  it('a fingerprint-matching LOCAL tombstone shields a live remote under another account too', async () => {
    // The record was forgotten here while the keychain still holds it live
    // under its new address: the pull must be skipped (it would erase the
    // just-written tombstone via clearTombstone) and the live account
    // tombstoned in the keychain instead.
    const localStone = tombstone({ updatedAt: NOW - 1000 });
    const live = moved({ updatedAt: NOW - 5000 });
    const { client, upserts } = fakeClient([item(live)]);
    const { adapter, applied } = fakeAdapter([localStone]);

    const result = await reconcile(adapter, { client, now: NOW });

    expect(applied).toEqual([]);
    expect(result.pulled).toEqual([]);
    // The live remote account is tombstoned; the local tombstone still
    // pushes under its own account so other machines learn the delete.
    expect(result.pushed.sort()).toEqual([NEW_ACCOUNT, OLD_ACCOUNT].sort());
    const newPush = parsePayload(upserts.find((u) => u.account === NEW_ACCOUNT)!.payload);
    expect(newPush).toMatchObject({ kind: 'record', record: { deleted: true, token: '' } });
  });

  it('two stale live keychain accounts for one fingerprint: the loser is tombstoned, the newest wins locally', async () => {
    // Fresh install, keychain holds the same machine live under two accounts.
    // The losing account must get a keychain tombstone in THIS pass, and the
    // newest data must win locally regardless of iteration order.
    const older = rec({ updatedAt: NOW - 50_000 });
    const newer = moved({ token: 'rotated', updatedAt: NOW - 1000 });
    for (const items of [
      [item(older), item(newer)], // increasing updatedAt order
      [item(newer), item(older)], // decreasing order
    ]) {
      const { client, upserts } = fakeClient(items);
      const { adapter, applied } = fakeAdapter([]);

      const result = await reconcile(adapter, { client, now: NOW });

      // The newest record is the final local state.
      expect(applied[applied.length - 1]).toEqual({ account: NEW_ACCOUNT, record: newer });
      expect(result.pulled).toContain(NEW_ACCOUNT);
      // The losing account gets a keychain tombstone (clock strictly older
      // than the survivor's so it can never win over the live record).
      expect(result.pushed).toEqual([OLD_ACCOUNT]);
      const parsed = parsePayload(upserts[0].payload);
      expect(parsed).toMatchObject({
        kind: 'record',
        record: { deleted: true, token: '', deletedAt: NOW },
      });
      expect((parsed as { record: KeychainSyncRecord }).record.updatedAt).toBeLessThan(
        newer.updatedAt,
      );
    }
  });

  it('stale remote tombstone loses to a newer moved local record (re-add survives)', async () => {
    const stone = tombstone({ updatedAt: NOW - 50_000 });
    const localRecord = moved({ updatedAt: NOW - 1000 });
    const { client, upserts } = fakeClient([item(stone)]);
    const { adapter, applied } = fakeAdapter([localRecord]);

    const result = await reconcile(adapter, { client, now: NOW });

    expect(applied).toEqual([]);
    expect(result.deletedLocally).toEqual([]);
    // The survivor pushes under its own account; the stale tombstone is left
    // to age out via its TTL.
    expect(result.pushed).toEqual([NEW_ACCOUNT]);
    expect(upserts).toHaveLength(1);
    expect(parsePayload(upserts[0].payload)).toEqual({ kind: 'record', record: localRecord });
  });

  it('fingerprint-less records keep pure account semantics (no cross-account pairing)', async () => {
    // Legacy blank fingerprints must never match each other across accounts.
    const remoteRecord = rec({ fingerprint: '', updatedAt: NOW - 1000 });
    const localRecord = moved({ fingerprint: '  ', updatedAt: NOW - 500 });
    const { client, upserts } = fakeClient([item(remoteRecord)]);
    const { adapter, applied } = fakeAdapter([localRecord]);

    const result = await reconcile(adapter, { client, now: NOW });

    // Both records live on: the remote pulls in, the local pushes out.
    expect(result.pulled).toEqual([OLD_ACCOUNT]);
    expect(applied).toEqual([{ account: OLD_ACCOUNT, record: remoteRecord }]);
    expect(result.pushed).toEqual([NEW_ACCOUNT]);
    expect(upserts).toHaveLength(1);
  });

  it('same-account records never trigger the cross-account path (plain LWW)', async () => {
    // Same fingerprint AND same account: ordinary per-account reconcile.
    const remoteRecord = rec({ label: 'Rotated', updatedAt: NOW - 1000 });
    const localRecord = rec({ updatedAt: NOW - 50_000 });
    const { client, upserts } = fakeClient([item(remoteRecord)]);
    const { adapter, applied } = fakeAdapter([localRecord]);

    const result = await reconcile(adapter, { client, now: NOW });

    expect(result.pulled).toEqual([OLD_ACCOUNT]);
    expect(applied).toEqual([{ account: OLD_ACCOUNT, record: remoteRecord }]);
    expect(upserts).toEqual([]);
  });
});

// ============================================================================
// Legacy access-group migration
// ============================================================================

describe('migrateLegacyGroupItems', () => {
  const SHARED = 'TEAM12345X.dev.intentapp.backends';
  const LEGACY = 'TEAM12345X.dev.intentapp.cloudlands-fe.keychain-helper';

  function legacyItem(record: KeychainSyncRecord): KeychainItem {
    return { ...item(record), group: LEGACY };
  }
  function sharedItem(record: KeychainSyncRecord): KeychainItem {
    return { ...item(record), group: SHARED };
  }

  it('passes items through untouched when no shared group is advertised', async () => {
    const items = [legacyItem(rec())];
    const { client, upserts, deletes } = fakeClient(items);
    const outcome = await migrateLegacyGroupItems(client, items, undefined);
    expect(outcome).toEqual({ items, migrated: [], errors: [] });
    expect(upserts).toEqual([]);
    expect(deletes).toEqual([]);
  });

  it('migrates a legacy-only item: verified upsert first, then group-scoped delete', async () => {
    const record = rec();
    const items = [legacyItem(record)];
    const { client, upserts, scopedDeletes } = fakeClient(items, { sharedGroup: SHARED });
    const outcome = await migrateLegacyGroupItems(client, items, SHARED);
    expect(upserts).toEqual([{ account: ACCOUNT, payload: serializeRecord(record) }]);
    expect(scopedDeletes).toEqual([{ account: ACCOUNT, group: LEGACY }]);
    expect(outcome.migrated).toEqual([ACCOUNT]);
    expect(outcome.errors).toEqual([]);
    expect(outcome.items).toEqual([{ ...legacyItem(record), group: SHARED }]);
  });

  it('keeps the legacy copy when the shared-group write fails (fail-soft)', async () => {
    const record = rec();
    const items = [legacyItem(record)];
    const { client, deletes } = fakeClient(items, {
      sharedGroup: SHARED,
      upsertError: 'unavailable',
    });
    const outcome = await migrateLegacyGroupItems(client, items, SHARED);
    expect(deletes).toEqual([]); // never delete before a verified write
    expect(outcome.migrated).toEqual([]);
    expect(outcome.errors).toEqual([{ account: ACCOUNT, op: 'upsert', code: 'unavailable' }]);
    expect(outcome.items).toEqual([legacyItem(record)]);
  });

  it('both copies, shared newer: deletes the legacy copy without rewriting', async () => {
    const newer = rec({ updatedAt: NOW - 1000 });
    const older = rec({ updatedAt: NOW - 50_000 });
    const items = [sharedItem(newer), legacyItem(older)];
    const { client, upserts, scopedDeletes } = fakeClient(items, { sharedGroup: SHARED });
    const outcome = await migrateLegacyGroupItems(client, items, SHARED);
    expect(upserts).toEqual([]);
    expect(scopedDeletes).toEqual([{ account: ACCOUNT, group: LEGACY }]);
    expect(outcome.migrated).toEqual([ACCOUNT]);
    expect(outcome.items).toEqual([sharedItem(newer)]);
  });

  it('both copies, legacy newer: rewrites the shared copy then deletes legacy', async () => {
    const older = rec({ updatedAt: NOW - 50_000 });
    const newer = rec({ updatedAt: NOW - 1000, label: 'Renamed' });
    const items = [sharedItem(older), legacyItem(newer)];
    const { client, upserts, scopedDeletes } = fakeClient(items, { sharedGroup: SHARED });
    const outcome = await migrateLegacyGroupItems(client, items, SHARED);
    expect(upserts).toEqual([{ account: ACCOUNT, payload: serializeRecord(newer) }]);
    expect(scopedDeletes).toEqual([{ account: ACCOUNT, group: LEGACY }]);
    expect(outcome.migrated).toEqual([ACCOUNT]);
    expect(outcome.items).toEqual([{ ...legacyItem(newer), group: SHARED }]);
  });

  it('leaves both copies untouched when a payload is unparseable', async () => {
    const shared: KeychainItem = { account: ACCOUNT, payload: 'not json', group: SHARED };
    const legacy = legacyItem(rec());
    const { client, upserts, deletes } = fakeClient([shared, legacy], { sharedGroup: SHARED });
    const outcome = await migrateLegacyGroupItems(client, [shared, legacy], SHARED);
    expect(upserts).toEqual([]);
    expect(deletes).toEqual([]);
    expect(outcome.migrated).toEqual([]);
    expect(outcome.items).toEqual([shared]); // shared preferred in the view
  });

  it('freezes a legacy-only item whose payload is unparseable (nothing written or deleted)', async () => {
    const legacy: KeychainItem = { account: ACCOUNT, payload: 'not json', group: LEGACY };
    const { client, upserts, deletes } = fakeClient([legacy], { sharedGroup: SHARED });
    const outcome = await migrateLegacyGroupItems(client, [legacy], SHARED);
    expect(upserts).toEqual([]);
    expect(deletes).toEqual([]);
    expect(outcome.migrated).toEqual([]);
    expect(outcome.items).toEqual([legacy]); // kept in place, legacy group intact
  });

  it('freezes a legacy-only item carrying a newer schema version', async () => {
    const legacy: KeychainItem = {
      account: ACCOUNT,
      payload: JSON.stringify({ ...rec(), v: KEYCHAIN_PAYLOAD_VERSION + 1 }),
      group: LEGACY,
    };
    const { client, upserts, deletes } = fakeClient([legacy], { sharedGroup: SHARED });
    const outcome = await migrateLegacyGroupItems(client, [legacy], SHARED);
    expect(upserts).toEqual([]);
    expect(deletes).toEqual([]);
    expect(outcome.migrated).toEqual([]);
    expect(outcome.items).toEqual([legacy]);
  });

  it('picks the newest of multiple legacy copies (synchronizable variants) for LWW', async () => {
    const older = rec({ updatedAt: NOW - 50_000 });
    const newer = rec({ updatedAt: NOW - 1000, label: 'Renamed' });
    const sharedOld = rec({ updatedAt: NOW - 20_000 });
    const items = [sharedItem(sharedOld), legacyItem(older), legacyItem(newer)];
    const { client, upserts, scopedDeletes } = fakeClient(items, { sharedGroup: SHARED });
    const outcome = await migrateLegacyGroupItems(client, items, SHARED);
    // The NEWEST legacy copy beats the shared one and is re-written.
    expect(upserts).toEqual([{ account: ACCOUNT, payload: serializeRecord(newer) }]);
    expect(scopedDeletes).toEqual([
      { account: ACCOUNT, group: LEGACY },
      { account: ACCOUNT, group: LEGACY },
    ]);
    expect(outcome.migrated).toEqual([ACCOUNT]);
    expect(outcome.items).toEqual([{ ...legacyItem(newer), group: SHARED }]);
  });

  it('shared newer + failed legacy delete: no write succeeded, so not counted as migrated', async () => {
    const newer = rec({ updatedAt: NOW - 1000 });
    const older = rec({ updatedAt: NOW - 50_000 });
    const items = [sharedItem(newer), legacyItem(older)];
    const { client, upserts } = fakeClient(items, {
      sharedGroup: SHARED,
      deleteError: 'unavailable',
    });
    const outcome = await migrateLegacyGroupItems(client, items, SHARED);
    expect(upserts).toEqual([]);
    expect(outcome.migrated).toEqual([]); // only successful writes count
    expect(outcome.errors).toEqual([{ account: ACCOUNT, op: 'delete', code: 'unavailable' }]);
    expect(outcome.items).toEqual([sharedItem(newer)]);
  });

  it('a failed legacy delete after a verified upsert still counts as migrated and records the error', async () => {
    const record = rec();
    const items = [legacyItem(record)];
    const upserts: { account: string; payload: string }[] = [];
    const client: KeychainClient = {
      async list() {
        return { ok: true, items, sharedGroup: SHARED };
      },
      async upsert(account, payload) {
        upserts.push({ account, payload });
        return { ok: true };
      },
      async delete() {
        return { ok: false, code: 'keychain-error', message: 'mock failure' };
      },
    };
    const outcome = await migrateLegacyGroupItems(client, items, SHARED);
    expect(upserts).toHaveLength(1);
    expect(outcome.migrated).toEqual([ACCOUNT]);
    expect(outcome.errors).toEqual([{ account: ACCOUNT, op: 'delete', code: 'keychain-error' }]);
    expect(outcome.items).toEqual([{ ...legacyItem(record), group: SHARED }]);
  });

  it('items without a group attribute are treated as in place', async () => {
    const items = [item(rec())];
    const { client, upserts, deletes } = fakeClient(items, { sharedGroup: SHARED });
    const outcome = await migrateLegacyGroupItems(client, items, SHARED);
    expect(upserts).toEqual([]);
    expect(deletes).toEqual([]);
    expect(outcome).toEqual({ items, migrated: [], errors: [] });
  });

  it('shouldAbort stops further migrations but keeps the item view intact', async () => {
    const a = rec({ host: '10.0.0.1', updatedAt: NOW - 1000 });
    const b = rec({ host: '10.0.0.2', updatedAt: NOW - 1000 });
    const items = [legacyItem(a), legacyItem(b)];
    const { client, upserts } = fakeClient(items, { sharedGroup: SHARED });
    let calls = 0;
    const outcome = await migrateLegacyGroupItems(client, items, SHARED, () => calls++ >= 1);
    expect(upserts).toHaveLength(1);
    expect(outcome.migrated).toEqual([accountKeyFor('10.0.0.1', 8443)]);
    expect(outcome.items).toHaveLength(2); // untouched account stays in the view
  });

  it('shouldAbort flipping during the upsert halts before the legacy delete', async () => {
    const record = rec();
    const items = [legacyItem(record)];
    let abort = false;
    const upserts: string[] = [];
    const deletes: string[] = [];
    const client: KeychainClient = {
      async list() {
        return { ok: true, items, sharedGroup: SHARED };
      },
      async upsert(account) {
        upserts.push(account);
        abort = true; // sync disabled while the write is in flight
        return { ok: true };
      },
      async delete(account) {
        deletes.push(account);
        return { ok: true };
      },
    };
    const outcome = await migrateLegacyGroupItems(client, items, SHARED, () => abort);
    expect(upserts).toEqual([ACCOUNT]);
    expect(deletes).toEqual([]); // destructive step never runs after the abort
    expect(outcome.migrated).toEqual([ACCOUNT]); // the upsert did succeed
    expect(outcome.items).toEqual([{ ...legacyItem(record), group: SHARED }]);
  });
});

describe('reconcile with access-group migration', () => {
  const SHARED = 'TEAM12345X.dev.intentapp.backends';
  const LEGACY = 'TEAM12345X.dev.intentapp.cloudlands-fe.keychain-helper';

  it('migrates legacy items before reconciling and reports them in the result', async () => {
    const record = rec();
    const { client, upserts, scopedDeletes } = fakeClient([{ ...item(record), group: LEGACY }], {
      sharedGroup: SHARED,
    });
    const { adapter, applied } = fakeAdapter([]);

    const result = await reconcile(adapter, { client, now: NOW });

    expect(result.status).toEqual({ state: 'active' });
    expect(result.migrated).toEqual([ACCOUNT]);
    expect(scopedDeletes).toEqual([{ account: ACCOUNT, group: LEGACY }]);
    // Migration wrote it once; reconcile then pulls it locally (no re-push).
    expect(upserts).toEqual([{ account: ACCOUNT, payload: serializeRecord(record) }]);
    expect(result.pulled).toEqual([ACCOUNT]);
    expect(applied).toEqual([{ account: ACCOUNT, record }]);
  });

  it('dedupes shared+legacy copies of one account into a single reconcile view', async () => {
    const newer = rec({ updatedAt: NOW - 1000 });
    const older = rec({ updatedAt: NOW - 50_000 });
    const { client } = fakeClient(
      [
        { ...item(newer), group: SHARED },
        { ...item(older), group: LEGACY },
      ],
      { sharedGroup: SHARED },
    );
    const { adapter, applied } = fakeAdapter([]);

    const result = await reconcile(adapter, { client, now: NOW });

    expect(result.migrated).toEqual([ACCOUNT]);
    expect(result.pulled).toEqual([ACCOUNT]);
    expect(applied).toEqual([{ account: ACCOUNT, record: newer }]);
  });

  it('no shared group advertised: reconcile behaves exactly as before', async () => {
    const record = rec();
    const { client, deletes } = fakeClient([item(record)]);
    const { adapter, applied } = fakeAdapter([]);

    const result = await reconcile(adapter, { client, now: NOW });

    expect(result.migrated).toEqual([]);
    expect(deletes).toEqual([]);
    expect(result.pulled).toEqual([ACCOUNT]);
    expect(applied).toEqual([{ account: ACCOUNT, record }]);
  });

  it('migration write failures degrade to unavailable when every write is rejected', async () => {
    const { client } = fakeClient([{ ...item(rec()), group: LEGACY }], {
      sharedGroup: SHARED,
      upsertError: 'unavailable',
    });
    const { adapter } = fakeAdapter([]);

    const result = await reconcile(adapter, { client, now: NOW });

    expect(result.migrated).toEqual([]);
    expect(result.errors).toEqual([{ account: ACCOUNT, op: 'upsert', code: 'unavailable' }]);
    expect(result.status).toEqual({
      state: 'unavailable',
      reason: 'unavailable',
      message: expect.any(String),
    });
  });

  it('degrades to unavailable when the only attempted writes were legacy deletes that all failed', async () => {
    const newer = rec({ updatedAt: NOW - 1000 });
    const older = rec({ updatedAt: NOW - 50_000 });
    const { client, upserts } = fakeClient(
      [
        { ...item(newer), group: SHARED },
        { ...item(older), group: LEGACY },
      ],
      { sharedGroup: SHARED, deleteError: 'unavailable' },
    );
    const { adapter } = fakeAdapter([]);

    const result = await reconcile(adapter, { client, now: NOW });

    expect(upserts).toEqual([]);
    expect(result.migrated).toEqual([]); // failed delete is not a successful write
    expect(result.errors).toEqual([{ account: ACCOUNT, op: 'delete', code: 'unavailable' }]);
    expect(result.status).toEqual({
      state: 'unavailable',
      reason: 'unavailable',
      message: expect.any(String),
    });
  });
});

// ============================================================================
// Helper-backed client (mocked child_process.spawn)
// ============================================================================

interface FakeStdin extends EventEmitter {
  written: string;
  write: (s: string) => void;
  end: ReturnType<typeof vi.fn>;
}

interface FakeChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: FakeStdin;
  kill: ReturnType<typeof vi.fn>;
}

function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const stdin = new EventEmitter() as FakeStdin;
  stdin.written = '';
  stdin.write = (s: string) => {
    stdin.written += s;
  };
  stdin.end = vi.fn();
  child.stdin = stdin;
  child.kill = vi.fn();
  return child;
}

/** Queue the next spawn to emit `output` then close with `exitCode`. */
function respondWith(output: string, exitCode = 0): FakeChild {
  const child = fakeChild();
  vi.mocked(spawn).mockImplementationOnce((() => {
    queueMicrotask(() => {
      child.stdout.emit('data', Buffer.from(output, 'utf8'));
      child.emit('close', exitCode);
    });
    return child;
  }) as unknown as typeof spawn);
  return child;
}

const HELPER = '/fake/intent-keychain-helper';

describe('createHelperKeychainClient', () => {
  beforeEach(() => {
    vi.mocked(spawn).mockReset();
  });

  it('reports unsupported-platform off macOS without spawning', async () => {
    const client = createHelperKeychainClient({ platform: 'linux', helperPath: HELPER });
    const result = await client.list();
    expect(result).toMatchObject({ ok: false, code: 'unsupported-platform' });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('reports helper-missing when no bundled helper exists', async () => {
    const client = createHelperKeychainClient({ platform: 'darwin' });
    const result = await client.list();
    expect(result).toMatchObject({ ok: false, code: 'helper-missing' });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('list: spawns the helper and parses well-formed items', async () => {
    respondWith(
      JSON.stringify({
        items: [
          { account: ACCOUNT, payload: '{"v":1}', modifiedAtMs: 123 },
          { account: 'bad-row-no-payload' },
        ],
      }),
    );
    const client = createHelperKeychainClient({ platform: 'darwin', helperPath: HELPER });
    const result = await client.list();
    expect(spawn).toHaveBeenCalledWith(HELPER, ['list'], expect.anything());
    expect(result).toEqual({
      ok: true,
      items: [{ account: ACCOUNT, payload: '{"v":1}', modifiedAtMs: 123 }],
    });
  });

  it('list: surfaces per-item group and the top-level sharedGroup when reported', async () => {
    const shared = 'TEAM12345X.dev.intentapp.backends';
    const legacy = 'TEAM12345X.dev.intentapp.cloudlands-fe.keychain-helper';
    respondWith(
      JSON.stringify({
        items: [{ account: ACCOUNT, payload: '{"v":1}', group: legacy }],
        sharedGroup: shared,
      }),
    );
    const client = createHelperKeychainClient({ platform: 'darwin', helperPath: HELPER });
    const result = await client.list();
    expect(result).toEqual({
      ok: true,
      items: [{ account: ACCOUNT, payload: '{"v":1}', group: legacy }],
      sharedGroup: shared,
    });
  });

  it('delete: scopes to an access group via argv only when given', async () => {
    const legacy = 'TEAM12345X.dev.intentapp.cloudlands-fe.keychain-helper';
    respondWith(JSON.stringify({ ok: true }));
    const client = createHelperKeychainClient({ platform: 'darwin', helperPath: HELPER });
    expect(await client.delete(ACCOUNT, legacy)).toMatchObject({ ok: true });
    expect(vi.mocked(spawn).mock.calls[0][1]).toEqual(['delete', ACCOUNT, legacy]);

    respondWith(JSON.stringify({ ok: true }));
    expect(await client.delete(ACCOUNT)).toMatchObject({ ok: true });
    expect(vi.mocked(spawn).mock.calls[1][1]).toEqual(['delete', ACCOUNT]);
  });

  it('upsert: payload travels over stdin, never argv', async () => {
    const child = respondWith(JSON.stringify({ ok: true }));
    const client = createHelperKeychainClient({ platform: 'darwin', helperPath: HELPER });
    const payload = serializeRecord(rec());
    const result = await client.upsert(ACCOUNT, payload);
    expect(result).toMatchObject({ ok: true });
    const [, args] = vi.mocked(spawn).mock.calls[0];
    expect(args).toEqual(['upsert', ACCOUNT]);
    expect(JSON.stringify(args)).not.toContain('secret-token');
    expect(child.stdin.written).toBe(JSON.stringify({ payload }));
    expect(child.stdin.end).toHaveBeenCalled();
  });

  it('maps the helper structured unavailable error (never "no items")', async () => {
    respondWith(
      JSON.stringify({ error: 'unavailable', message: 'missing entitlement', status: -34018 }),
      1,
    );
    const client = createHelperKeychainClient({ platform: 'darwin', helperPath: HELPER });
    const result = await client.list();
    expect(result).toEqual({ ok: false, code: 'unavailable', message: 'missing entitlement' });
  });

  it('maps not-found on delete and unknown error codes to keychain-error', async () => {
    respondWith(JSON.stringify({ error: 'not-found', message: 'no such item' }), 1);
    const client = createHelperKeychainClient({ platform: 'darwin', helperPath: HELPER });
    expect(await client.delete(ACCOUNT)).toEqual({
      ok: false,
      code: 'not-found',
      message: 'no such item',
    });

    respondWith(JSON.stringify({ error: 'something-new', message: 'boom' }), 1);
    expect(await client.delete(ACCOUNT)).toEqual({
      ok: false,
      code: 'keychain-error',
      message: 'boom',
    });
  });

  it('maps unparseable helper output to helper-failed', async () => {
    respondWith('segfault noise', 1);
    const client = createHelperKeychainClient({ platform: 'darwin', helperPath: HELPER });
    const result = await client.list();
    expect(result).toMatchObject({ ok: false, code: 'helper-failed' });
  });

  it('maps a spawn failure to helper-failed instead of throwing', async () => {
    const child = fakeChild();
    vi.mocked(spawn).mockImplementationOnce((() => {
      queueMicrotask(() => child.emit('error', new Error('ENOENT')));
      return child;
    }) as unknown as typeof spawn);
    const client = createHelperKeychainClient({ platform: 'darwin', helperPath: HELPER });
    const result = await client.list();
    expect(result).toMatchObject({ ok: false, code: 'helper-failed', message: 'ENOENT' });
  });

  it('EPIPE on stdin (helper exited before draining) yields the structured error, not a crash', async () => {
    // The helper rejects the payload, prints a structured error, and exits
    // before reading stdin — the write then fails with EPIPE. An unhandled
    // 'error' on the stdin stream would crash the process; the client must
    // instead surface the helper's structured output from 'close'.
    const child = fakeChild();
    child.stdin.write = () => {
      child.stdin.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
    };
    vi.mocked(spawn).mockImplementationOnce((() => {
      queueMicrotask(() => {
        child.stdout.emit(
          'data',
          Buffer.from(JSON.stringify({ error: 'bad-arguments', message: 'payload too large' })),
        );
        child.emit('close', 1);
      });
      return child;
    }) as unknown as typeof spawn);
    const client = createHelperKeychainClient({ platform: 'darwin', helperPath: HELPER });
    const result = await client.upsert(ACCOUNT, '{"payload":"x"}');
    expect(result).toEqual({ ok: false, code: 'bad-arguments', message: 'payload too large' });
  });

  it('a synchronous stdin write throw maps to helper-failed instead of escaping the executor', async () => {
    const child = fakeChild();
    child.stdin.write = () => {
      throw Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
    };
    vi.mocked(spawn).mockImplementationOnce((() => child) as unknown as typeof spawn);
    const client = createHelperKeychainClient({ platform: 'darwin', helperPath: HELPER });
    const result = await client.upsert(ACCOUNT, '{"payload":"x"}');
    expect(result).toEqual({ ok: false, code: 'helper-failed', message: 'write EPIPE' });
  });

  it('caps stdout at exactly MAX_HELPER_OUTPUT_BYTES (overflow chunk is sliced, not appended)', async () => {
    // Valid list JSON padded to EXACTLY the cap. Delivered as a chunk of
    // cap−1 bytes followed by one chunk of the final byte plus trailing
    // garbage: an exact cap keeps just that final byte (parse succeeds),
    // while the old length-check-before-append kept the whole overflow
    // chunk and corrupted the output (cap + chunkSize overshoot).
    const skeleton = JSON.stringify({ items: [], pad: '' });
    const output = JSON.stringify({
      items: [],
      pad: 'x'.repeat(MAX_HELPER_OUTPUT_BYTES - skeleton.length),
    });
    expect(output.length).toBe(MAX_HELPER_OUTPUT_BYTES);

    const child = fakeChild();
    vi.mocked(spawn).mockImplementationOnce((() => {
      queueMicrotask(() => {
        child.stdout.emit('data', Buffer.from(output.slice(0, -1), 'utf8'));
        child.stdout.emit('data', Buffer.from(output.slice(-1) + 'TRAILING GARBAGE', 'utf8'));
        // A chunk arriving with zero budget left is dropped entirely.
        child.stdout.emit('data', Buffer.from('MORE GARBAGE', 'utf8'));
        child.emit('close', 0);
      });
      return child;
    }) as unknown as typeof spawn);
    const client = createHelperKeychainClient({ platform: 'darwin', helperPath: HELPER });
    const result = await client.list();
    expect(result).toEqual({ ok: true, items: [] });
  });
});
