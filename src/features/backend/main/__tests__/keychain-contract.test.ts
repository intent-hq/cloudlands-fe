// @vitest-environment node
// @verify-changed-triggers: tests/fixtures/backend-keychain/**, tests/fixtures/backend-keychain.lock.json, scripts/backend-keychain-fixtures.mjs
import { describe, expect, it } from 'vitest';
import { loadBackendKeychainFixtures } from '../../../../../scripts/backend-keychain-fixtures.mjs';
import {
  accountKeyFor,
  parsePayload,
  reconcile,
  serializeRecord,
  type KeychainClient,
  type KeychainItem,
  type KeychainSyncRecord,
  type LocalSyncAdapter,
  type ParsedPayload,
} from '../keychain-sync';

interface ParseCase {
  id: string;
  payload: string;
  desktop: ParsedPayload;
}

interface Corpus {
  parseCases: ParseCase[];
  identityCases: {
    id: string;
    host: string;
    port: number;
    fingerprint: string;
    accountKey: string;
    registryKey: string;
  }[];
  serializeCases: { id: string; record: KeychainSyncRecord; expected: Record<string, unknown> }[];
  expiryCases: { id: string; parseCaseId: string; nowMs: number; expired: boolean }[];
  noWriteCases: {
    id: string;
    parseCaseId: string;
    account: string;
    localRecord: KeychainSyncRecord;
    nowMs: number;
    expected: { desktop: { applied: unknown[]; upserts: unknown[]; deletes: unknown[] } };
  }[];
}

const loaded = await loadBackendKeychainFixtures();
const corpus: Corpus = loaded.corpus;
console.info(
  `Backend Keychain contract: sourceCommit=${loaded.lock.sourceCommit} corpusSha256=${loaded.lock.corpusSha256}`,
);

function parseCase(id: string): ParseCase {
  const fixture = corpus.parseCases.find((c) => c.id === id);
  if (!fixture) throw new Error(`Missing canonical parse case: ${id}`);
  return fixture;
}

function expectedRecord(fixture: ParseCase): KeychainSyncRecord {
  if (fixture.desktop.kind !== 'record') throw new Error(`Expected a record case: ${fixture.id}`);
  return fixture.desktop.record;
}

// The only fake behavior is storage. Codec, account matching, fingerprint
// matching, TTL decisions and all writes run through production reconcile().
function stores(items: KeychainItem[] = [], records: KeychainSyncRecord[] = []) {
  const bytes = new Map(items.map((item) => [item.account, item.payload]));
  const applied: { account: string; record: KeychainSyncRecord }[] = [];
  const upserts: KeychainItem[] = [];
  const deletes: string[] = [];
  const client: KeychainClient = {
    async list() {
      return { ok: true, items: [...bytes].map(([account, payload]) => ({ account, payload })) };
    },
    async upsert(account, payload) {
      upserts.push({ account, payload });
      bytes.set(account, payload);
      return { ok: true };
    },
    async delete(account) {
      deletes.push(account);
      bytes.delete(account);
      return { ok: true };
    },
  };
  const adapter: LocalSyncAdapter = {
    async list() {
      return records;
    },
    async applyRemote(account, record) {
      applied.push({ account, record });
    },
  };
  return { client, adapter, bytes, applied, upserts, deletes };
}

describe('canonical owner-backend Keychain contract', () => {
  it.each(corpus.parseCases)('decodes $id exactly', (fixture) => {
    expect(parsePayload(fixture.payload)).toStrictEqual(fixture.desktop);
  });

  it.each(corpus.parseCases.filter((c) => c.desktop.kind === 'record'))(
    'delivers $id through reconciliation without losing routes or metadata',
    async (fixture) => {
      const record = expectedRecord(fixture);
      const account = accountKeyFor(record.host, record.port);
      const local =
        record.deleted === true
          ? [{ ...record, deleted: false, updatedAt: record.updatedAt - 1 }]
          : [];
      const state = stores([{ account, payload: fixture.payload }], local);
      const result = await reconcile(state.adapter, {
        client: state.client,
        now: record.updatedAt,
      });
      expect(state.applied).toStrictEqual([{ account, record }]);
      expect(state.upserts).toStrictEqual([]);
      expect(state.deletes).toStrictEqual([]);
      expect(result.errors).toStrictEqual([]);
      expect(result.status).toStrictEqual({ state: 'active' });
    },
  );

  it.each(corpus.identityCases)(
    'uses the account and machine identity for $id',
    async (fixture) => {
      expect(accountKeyFor(fixture.host, fixture.port)).toBe(fixture.accountKey);
      const base = parseCase('live-lan');
      const record = {
        ...expectedRecord(base),
        host: fixture.host,
        port: fixture.port,
        fingerprint: fixture.fingerprint,
      };
      const payload = JSON.stringify({
        ...JSON.parse(base.payload),
        host: fixture.host,
        port: fixture.port,
        fingerprint: fixture.fingerprint,
      });
      const fingerprintIdentity = fixture.registryKey.startsWith('fp:');
      // The registry key is the canonical expected identity, not a normalizer
      // reimplemented here. A different account must match only by fingerprint.
      const local: KeychainSyncRecord = {
        ...record,
        host: 'moved.fixture',
        fingerprint: fingerprintIdentity ? fixture.registryKey.slice(3) : fixture.fingerprint,
        updatedAt: record.updatedAt - 1,
      };
      const state = stores([{ account: fixture.accountKey, payload }], [local]);
      const result = await reconcile(state.adapter, {
        client: state.client,
        now: record.updatedAt,
      });
      expect(state.applied).toStrictEqual([{ account: fixture.accountKey, record }]);
      expect(result.pulled).toStrictEqual([fixture.accountKey]);
      expect(state.deletes).toStrictEqual([]);
      expect(result.errors).toStrictEqual([]);
      if (fingerprintIdentity) {
        // A matching machine consumes the stale local account instead of pushing
        // it as a second backend. Losing trim/case normalization breaks this.
        expect(state.upserts).toStrictEqual([]);
        // A match must also distinguish the other canonical identities. This
        // catches a matcher that collapses all nonblank fingerprints together.
        for (const other of corpus.identityCases.filter(
          (c) => c.registryKey !== fixture.registryKey,
        )) {
          const distinct = stores(
            [{ account: fixture.accountKey, payload }],
            [{ ...local, fingerprint: other.fingerprint }],
          );
          await reconcile(distinct.adapter, { client: distinct.client, now: record.updatedAt });
          expect(distinct.applied, other.id).toStrictEqual([
            { account: fixture.accountKey, record },
          ]);
          expect(
            distinct.upserts.map((item) => item.account),
            other.id,
          ).toStrictEqual([`moved.fixture:${fixture.port}`]);
        }
      } else {
        expect(fixture.registryKey).toBe(`addr:${fixture.accountKey}`);
        expect(state.upserts.map((item) => item.account)).toStrictEqual([
          `moved.fixture:${fixture.port}`,
        ]);
        // With the canonical account, even a blank fingerprint pairs in place.
        const sameAccount = stores(
          [{ account: fixture.registryKey.slice(5), payload }],
          [{ ...record, updatedAt: record.updatedAt - 1 }],
        );
        await reconcile(sameAccount.adapter, { client: sameAccount.client, now: record.updatedAt });
        expect(sameAccount.applied).toStrictEqual([{ account: fixture.accountKey, record }]);
        expect(sameAccount.upserts).toStrictEqual([]);
      }
    },
  );

  it.each(corpus.serializeCases)('serializes and pushes $id exactly', async (fixture) => {
    expect(JSON.parse(serializeRecord(fixture.record))).toStrictEqual(fixture.expected);
    const state = stores([], [fixture.record]);
    const account = accountKeyFor(fixture.record.host, fixture.record.port);
    await reconcile(state.adapter, { client: state.client, now: fixture.record.updatedAt });
    expect(
      state.upserts.map(({ account, payload }) => ({ account, payload: JSON.parse(payload) })),
    ).toStrictEqual([{ account, payload: fixture.expected }]);
    expect(state.applied).toStrictEqual([]);
    expect(state.deletes).toStrictEqual([]);
    expect(JSON.parse(state.bytes.get(account)!)).toStrictEqual(fixture.expected);
  });

  it.each(corpus.expiryCases)('observes the removal boundary: $id', async (fixture) => {
    const source = parseCase(fixture.parseCaseId);
    const record = expectedRecord(source);
    const account = accountKeyFor(record.host, record.port);
    const state = stores([{ account, payload: source.payload }]);
    const result = await reconcile(state.adapter, { client: state.client, now: fixture.nowMs });
    expect(state.deletes).toStrictEqual(fixture.expired ? [account] : []);
    expect(result.purged).toStrictEqual(fixture.expired ? [account] : []);
    expect(state.bytes.get(account)).toBe(fixture.expired ? undefined : source.payload);
    expect(state.applied).toStrictEqual(record.deleted === true ? [] : [{ account, record }]);
    expect(state.upserts).toStrictEqual([]);
  });

  it.each(corpus.noWriteCases)('freezes $id without any write or local apply', async (fixture) => {
    const source = parseCase(fixture.parseCaseId);
    const state = stores(
      [{ account: fixture.account, payload: source.payload }],
      [fixture.localRecord],
    );
    const result = await reconcile(state.adapter, { client: state.client, now: fixture.nowMs });
    expect({
      applied: state.applied,
      upserts: state.upserts,
      deletes: state.deletes,
    }).toStrictEqual(fixture.expected.desktop);
    expect([...state.bytes]).toStrictEqual([[fixture.account, source.payload]]);
    expect(result.skipped).toStrictEqual([fixture.account]);
    expect(result.errors).toStrictEqual([]);
  });
});
