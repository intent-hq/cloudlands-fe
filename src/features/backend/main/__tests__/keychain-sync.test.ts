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
    host: '192.168.1.10',
    hosts: ['192.168.1.10'],
    port: 8443,
    fingerprint: 'AA:BB:CC',
    hostname: 'studio.local',
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

/** In-memory KeychainClient recording writes; list can fail on demand. */
function fakeClient(
  items: KeychainItem[] = [],
  opts: { listError?: HelperErrorCode; upsertError?: HelperErrorCode } = {},
) {
  const upserts: { account: string; payload: string }[] = [];
  const deletes: string[] = [];
  const client: KeychainClient = {
    async list() {
      if (opts.listError) return { ok: false, code: opts.listError, message: 'mock failure' };
      return { ok: true, items };
    },
    async upsert(account, payload) {
      if (opts.upsertError) return { ok: false, code: opts.upsertError, message: 'mock failure' };
      upserts.push({ account, payload });
      return { ok: true };
    },
    async delete(account) {
      deletes.push(account);
      return { ok: true };
    },
  };
  return { client, upserts, deletes };
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
      record: { hosts: ['h'], hostname: null, detectHosts: true },
    });
  });
});

describe('reconcile', () => {
  it('fresh install: pulls every remote live record into an empty local store', async () => {
    const other = rec({ host: '10.0.0.2', port: 9000, label: 'Laptop', updatedAt: NOW - 5000 });
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
    const remoteRecord = rec({ label: 'Rotated', token: 'rotated-token', updatedAt: NOW - 1000 });
    const { client, upserts } = fakeClient([item(remoteRecord)]);
    const { adapter, applied } = fakeAdapter([rec({ updatedAt: NOW - 10_000 })]);

    const result = await reconcile(adapter, { client, now: NOW });

    expect(result.pulled).toEqual([ACCOUNT]);
    expect(applied).toEqual([{ account: ACCOUNT, record: remoteRecord }]);
    expect(upserts).toEqual([]);
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

  it('push failures are fail-soft: collected in errors, status stays active', async () => {
    const { client } = fakeClient([], { upsertError: 'keychain-error' });
    const { adapter } = fakeAdapter([rec()]);

    const result = await reconcile(adapter, { client, now: NOW });

    expect(result.status).toEqual({ state: 'active' });
    expect(result.pushed).toEqual([]);
    expect(result.errors).toEqual([{ account: ACCOUNT, op: 'upsert', code: 'keychain-error' }]);
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
