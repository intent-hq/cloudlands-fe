import { describe, expect, it, vi } from 'vitest';
import { invitedPersonKey, invitedRemovalKey } from '../invited-session-key';
import { reconcileInvitedSessions, type InvitedSyncAdapter } from '../invited-session-sync';
import {
  parseInvitedPayload,
  type InvitedSession,
  type InvitedRemoval,
} from '../invited-session-payload';
import { serializeRecord, type KeychainItem, type KeychainClient } from '../keychain-sync';

const fingerprint = 'ab'.repeat(32);
const session = (principalId = 'B', changes: Partial<InvitedSession> = {}): InvitedSession => ({
  v: 2,
  kind: 'session',
  fingerprint,
  principalId,
  login: null,
  label: 'Studio',
  host: 'old.example',
  hosts: ['old.example'],
  port: 443,
  hostname: null,
  detectHosts: true,
  tcAddress: null,
  tcUpdatedAt: null,
  token: `${principalId}-still-valid`,
  updatedAt: 100,
  pairedAt: 100,
  removedThrough: 0,
  deleted: false,
  deletedAt: null,
  legacyAccounts: ['old.example:443'],
  ...changes,
});
const removal = (removedThrough = 200): InvitedRemoval => ({
  v: 2,
  kind: 'removal',
  fingerprint,
  principalId: 'B',
  removalId: '00000000-0000-4000-8000-000000000001',
  removedThrough,
  legacyAccounts: ['old.example:443'],
});
const item = (record: InvitedSession | InvitedRemoval): KeychainItem => ({
  account: record.kind === 'removal' ? invitedRemovalKey(record) : invitedPersonKey(record),
  payload: JSON.stringify(record),
});
const old = (principalId?: string, changes = {}): KeychainItem => ({
  account: 'old.example:443',
  payload: serializeRecord({
    label: 'old',
    host: 'old.example',
    hosts: ['old.example'],
    port: 443,
    fingerprint,
    principalId,
    login: 'legacy',
    hostname: null,
    detectHosts: true,
    tcAddress: null,
    token: `${principalId}-still-valid`,
    updatedAt: 100,
    ...changes,
  }),
});

function harness(remoteItems: KeychainItem[] = [], localItems: KeychainItem[] = []) {
  const remote = remoteItems.map((row) => ({ ...row }));
  const local = new Map(localItems.map((r) => [r.account, r]));
  const active = new Map<string, unknown>();
  const calls: string[] = [];
  const client: KeychainClient = {
    list: vi.fn(async () => ({ ok: true as const, items: remote.map((row) => ({ ...row })) })),
    insert: vi.fn(async (account, payload) => {
      calls.push('insert');
      const found = remote.find((r) => r.account === account);
      if (!found) remote.push({ account, payload });
      return { ok: true as const, inserted: !found, payload: found?.payload ?? payload };
    }),
    upsert: vi.fn(async (account, payload) => {
      calls.push('upsert');
      const found = remote.find((r) => r.account === account);
      if (found) found.payload = payload;
      else remote.push({ account, payload });
      return { ok: true as const };
    }),
    delete: vi.fn(async () => ({ ok: true as const })),
  };
  const adapter: InvitedSyncAdapter = {
    read: vi.fn(async () => ({ items: [...local.values()], pendingPairings: [] })),
    remember: vi.fn(async (items) => {
      calls.push('remember');
      for (const r of items) local.set(r.account, r);
    }),
    apply: vi.fn(async (account, record) => {
      calls.push('apply');
      active.set(account, record);
    }),
    // Controlled FE authority fixture: every token remains server-valid, including forgotten B.
    authenticate: vi.fn(async (candidate) => ({
      principalId: candidate.principalId ?? 'B',
      login: null,
    })),
    admitPairing: vi.fn(async () => null),
  };
  return {
    remote,
    local,
    active,
    client,
    adapter,
    calls,
    run: (options = {}) => reconcileInvitedSessions(adapter, { client, now: 300, ...options }),
  };
}

describe('invited service v2 reconciliation (controlled authority fixtures)', () => {
  it('scans removals first, suppressing stale valid B after a route write while C remains live', async () => {
    const h = harness([
      item(session('B', { updatedAt: 300 })),
      item(session('C')),
      item(removal()),
    ]);
    await h.run();
    expect(h.active.get(invitedPersonKey(session()))).toMatchObject({
      kind: 'removed',
      removedThrough: 200,
    });
    expect(h.active.get(invitedPersonKey(session('C')))).toMatchObject({ token: 'C-still-valid' });
    expect(h.adapter.authenticate).not.toHaveBeenCalledWith(
      expect.objectContaining({ principalId: 'B' }),
    );
    expect(h.calls.indexOf('insert')).toBeLessThan(h.calls.indexOf('upsert'));
    expect(h.client.delete).not.toHaveBeenCalled();
  });
  it('retains a removal when a later list omits it and after 30-day compaction', async () => {
    const h = harness([item(removal()), item(session())]);
    await h.run();
    h.remote.splice(0, h.remote.length, item(session('B', { updatedAt: 900 })));
    await h.run({ now: 40 * 86400_000 });
    expect(h.active.get(invitedPersonKey(session()))).toMatchObject({
      kind: 'removed',
      removedThrough: 200,
    });
    expect(h.remote.some((r) => r.account === invitedRemovalKey(removal()))).toBe(true);
  });
  it('failed/locked list is unknown and produces no local or remote side effect', async () => {
    const h = harness([], [item(session())]);
    vi.mocked(h.client.list).mockResolvedValue({
      ok: false,
      code: 'unavailable',
      message: 'locked',
    });
    expect((await h.run()).status).toMatchObject({ state: 'unavailable' });
    expect(h.calls).toEqual([]);
    expect(h.adapter.authenticate).not.toHaveBeenCalled();
  });
  it('unknown removal namespace defers all invited publication and admission', async () => {
    const h = harness([{ account: 'invited-v2-r:future', payload: '{"v":3}' }, item(session())]);
    expect((await h.run()).status.state).toBe('unavailable');
    expect(h.client.upsert).not.toHaveBeenCalled();
    expect(h.adapter.apply).not.toHaveBeenCalled();
  });
  it('frozen canonical accounts cannot be bypassed by a legacy alias', async () => {
    const key = invitedPersonKey(session());
    const h = harness([{ account: key, payload: '{"v":3}' }, old('B')]);
    await h.run();
    expect(h.client.upsert).not.toHaveBeenCalled();
    expect(h.adapter.apply).not.toHaveBeenCalled();
  });
  it('keeps an unverifiable/mismatched import pending and never publishes it', async () => {
    const h = harness([item(session())]);
    vi.mocked(h.adapter.authenticate).mockResolvedValue({ principalId: 'different', login: null });
    await h.run();
    expect(h.local.has(invitedPersonKey(session()))).toBe(true);
    expect(h.adapter.apply).not.toHaveBeenCalled();
    expect(h.client.upsert).not.toHaveBeenCalled();
  });
  it('duplicate immutable insertion preserves unknown extension bytes and never calls upsert for it', async () => {
    const r = item(removal());
    r.payload = JSON.stringify({ ...removal(), future: { keep: true } }, null, 3);
    const bytes = r.payload;
    const h = harness([r], [item(removal())]);
    await h.run();
    expect(h.remote.find((x) => x.account === r.account)?.payload).toBe(bytes);
    expect(vi.mocked(h.client.upsert).mock.calls.some(([account]) => account === r.account)).toBe(
      false,
    );
  });
  it('failed immutable insertion keeps local suppression and does not retire aliases or publish a tombstone', async () => {
    const h = harness([], [item(removal())]);
    vi.mocked(h.client.insert!).mockResolvedValue({
      ok: false,
      code: 'unavailable',
      message: 'locked',
    });
    await h.run();
    expect(h.client.upsert).not.toHaveBeenCalled();
    expect(h.active.get(invitedPersonKey(session()))).toMatchObject({ kind: 'removed' });
    expect(h.local.has(invitedRemovalKey(removal()))).toBe(true);
  });
  it('migrates both people sharing a legacy alias without fingerprint coalescing', async () => {
    const h = harness([old('B'), old('C')]);
    await h.run();
    expect(h.active.get(invitedPersonKey(session('B')))).toMatchObject({ principalId: 'B' });
    expect(h.active.get(invitedPersonKey(session('C')))).toMatchObject({ principalId: 'C' });
    expect(JSON.parse(h.remote.find((r) => r.account === 'old.example:443')!.payload)).toEqual({
      v: 2,
      kind: 'legacy-alias',
      personKeys: [invitedPersonKey(session('C')), invitedPersonKey(session('B'))].sort(),
    });
  });
  it('persists one legacy removal ID before publication and reuses it after a failed write', async () => {
    const h = harness([old('B', { deleted: true, deletedAt: 200, updatedAt: 200 })]);
    vi.mocked(h.client.insert!).mockResolvedValueOnce({
      ok: false,
      code: 'unavailable',
      message: 'locked',
    });
    await h.run();
    const first = vi.mocked(h.client.insert!).mock.calls[0][0];
    await h.run();
    expect(vi.mocked(h.client.insert!).mock.calls[1][0]).toBe(first);
  });
  it('quarantines unattributed legacy deletion instead of inferring the only person', async () => {
    const h = harness([
      old(undefined, { deleted: true, updatedAt: 200, deletedAt: 200 }),
      old('B'),
    ]);
    await h.run();
    expect(h.adapter.apply).not.toHaveBeenCalled();
    expect(h.client.upsert).not.toHaveBeenCalled();
  });
  it('preserves newer pairedAt when older bearer metadata is later', async () => {
    const h = harness(
      [item(session('B', { updatedAt: 500, host: 'moved.example' }))],
      [item(session('B', { pairedAt: 400, updatedAt: 400, token: 'new' }))],
    );
    await h.run();
    expect(h.active.get(invitedPersonKey(session()))).toMatchObject({
      token: 'new',
      host: 'moved.example',
    });
  });
  it('never restamps a route as a pairing and aborts side effects after preference disable', async () => {
    const h = harness([item(session())]);
    let disabled = false;
    vi.mocked(h.adapter.authenticate).mockImplementation(async () => {
      disabled = true;
      return { principalId: 'B', login: null };
    });
    await h.run({ shouldAbort: () => disabled });
    expect(h.adapter.admitPairing).not.toHaveBeenCalled();
    expect(h.adapter.apply).not.toHaveBeenCalled();
    expect(h.client.upsert).not.toHaveBeenCalled();
  });
  it('restores a retired alias after a delayed v1 deletion without deleting C', async () => {
    const h = harness([
      old('B', { deleted: true, updatedAt: 900, deletedAt: 900 }),
      item(session('C')),
      item(removal()),
    ]);
    await h.run();
    expect(h.active.get(invitedPersonKey(session('C')))).toMatchObject({ deleted: false });
    expect(
      parseInvitedPayload(
        'old.example:443',
        h.remote.find((r) => r.account === 'old.example:443')!.payload,
      ),
    ).toMatchObject({ kind: 'legacy-alias' });
  });
});

describe('mixed-version and concurrent invited writers', () => {
  it('migrates all legacy candidates with delete-on-tie regardless of listing order', async () => {
    const live = old('B');
    const deleted = {
      ...old('B', {
        host: 'other.example',
        updatedAt: 100,
        deleted: true,
        deletedAt: 100,
        token: '',
      }),
      account: 'other.example:443',
    };
    for (const rows of [
      [live, deleted],
      [deleted, live],
    ]) {
      const h = harness(rows);
      await h.run();
      expect(h.active.get(invitedPersonKey(session()))).toMatchObject({
        kind: 'removed',
        removedThrough: 100,
        legacyAccounts: ['old.example:443', 'other.example:443'],
      });
      expect(h.adapter.authenticate).toHaveBeenCalledTimes(1);
      expect(h.remote.filter((r) => r.account.startsWith('invited-v2-r:'))).toHaveLength(1);
    }
  });

  it('ignores expired legacy cleanup and stamps a zero-clock validated pairing exactly once', async () => {
    const live = old('B', { updatedAt: 0 });
    const deleted = {
      ...old('B', { updatedAt: 5, deleted: true, deletedAt: 5, token: '' }),
      account: 'other.example:443',
    };
    const h = harness([live, deleted]);
    const now = 40 * 86400_000;
    await h.run({ now });
    await h.run({ now: now + 1 });
    expect(h.active.get(invitedPersonKey(session()))).toMatchObject({
      pairedAt: now,
      removedThrough: 0,
    });
    expect(h.remote.filter((r) => r.account.startsWith('invited-v2-r:'))).toEqual([]);
  });

  it('executes the exact pinned v1 writer: same-account skip, real cross-account alias overwrite, then v2 repair', async () => {
    const oldWriter = await import('../__fixtures__/invited-session-v2/keychain-sync-c9.fixture');
    const { Logger } = await import('../../../../shared/logger');
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    try {
      const h = harness([item(session('B')), item(session('C')), item(removal())]);
      await h.run();
      const alias = 'old.example:443';
      expect(JSON.parse(h.remote.find((r) => r.account === alias)!.payload)).toMatchObject({
        kind: 'legacy-alias',
      });
      const protectedBytes = h.remote
        .filter((r) => r.account.startsWith('invited-v2-'))
        .map((r) => ({ ...r }));
      const oldLive = oldWriter.parsePayload(old('B').payload);
      if (oldLive.kind !== 'record') throw new Error('Invalid frozen v1 fixture');
      const local = { list: async () => [oldLive.record], applyRemote: vi.fn(async () => {}) };
      vi.mocked(h.client.upsert).mockClear();
      await oldWriter.reconcile(local, { client: h.client, now: 300 });
      expect(h.client.upsert).not.toHaveBeenCalled();
      const otherAddress = old('B', {
        host: 'different.example',
        token: '',
        deleted: true,
        deletedAt: 250,
        updatedAt: 250,
      });
      otherAddress.account = 'different.example:443';
      h.remote.push(otherAddress);
      await oldWriter.reconcile(local, { client: h.client, now: 300 });
      expect(h.client.upsert).toHaveBeenCalledWith(alias, expect.stringContaining('"v":1'));
      expect(JSON.parse(h.remote.find((r) => r.account === alias)!.payload)).toMatchObject({
        v: 1,
        deleted: true,
      });
      expect(h.remote.filter((r) => r.account.startsWith('invited-v2-'))).toEqual(protectedBytes);
      await h.run();
      expect(JSON.parse(h.remote.find((r) => r.account === alias)!.payload)).toMatchObject({
        kind: 'legacy-alias',
        personKeys: [invitedPersonKey(session('B')), invitedPersonKey(session('C'))].sort(),
      });
      expect(h.active.get(invitedPersonKey(session('B')))).toMatchObject({ kind: 'removed' });
      expect(h.active.get(invitedPersonKey(session('C')))).toMatchObject({
        token: 'C-still-valid',
      });
      const warningArgs = warn.mock.calls.filter(
        ([message]) => message === 'skipping keychain item',
      );
      expect(warningArgs.length).toBeGreaterThan(0);
      expect(JSON.stringify(warningArgs)).not.toContain(fingerprint);
      expect(JSON.stringify(warningArgs)).not.toContain('principalId');
      expect(JSON.stringify(warningArgs)).not.toContain('still-valid');
    } finally {
      warn.mockRestore();
    }
  });

  it.each([300, 40 * 86400_000])(
    'a real paused blind upsert cannot erase another writer removal, including after compaction (%s)',
    async (now) => {
      const stale = { ...session('B'), host: 'new.example', updatedAt: 300 };
      const h = harness([item(session('B')), item(session('C'))], [item(stale)]);
      let release!: () => void;
      let entered!: () => void;
      const enteredWrite = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      const upsert = h.client.upsert;
      vi.mocked(h.client.upsert).mockImplementationOnce(async (account, payload) => {
        entered();
        await wait;
        return upsert(account, payload);
      });
      // X runs the production reconciler and pauses at its real mutable write,
      // after the complete snapshot, authentication and removal scan.
      const blindWrite = h.run();
      await enteredWrite;
      await h.client.insert!(invitedRemovalKey(removal()), JSON.stringify(removal()));
      const removalBytes = h.remote.find(
        (r) => r.account === invitedRemovalKey(removal()),
      )!.payload;
      // The removing writer goes away. The paused writer overwrites the mutable cache after this.
      if (now > 300) {
        const other = harness(h.remote.map((r) => ({ ...r })));
        await other.run({ now });
        h.remote.splice(0, h.remote.length, ...other.remote);
      }
      release();
      await blindWrite;
      expect(
        JSON.parse(h.remote.find((r) => r.account === invitedPersonKey(stale))!.payload),
      ).toMatchObject({ token: 'B-still-valid', pairedAt: 100, removedThrough: 0, updatedAt: 300 });
      const fresh = harness(h.remote.map((r) => ({ ...r })));
      await fresh.run({ now });
      expect(fresh.active.get(invitedPersonKey(stale))).toMatchObject({
        kind: 'removed',
        removedThrough: 200,
      });
      expect(fresh.active.get(invitedPersonKey(session('C')))).toMatchObject({
        token: 'C-still-valid',
      });
      expect(fresh.remote.find((r) => r.account === invitedRemovalKey(removal()))!.payload).toBe(
        removalBytes,
      );
    },
  );

  it('folds multiple independent removers regardless of delivery order and retries immutable inserts without replacement', async () => {
    const r1 = removal();
    const r2 = { ...removal(250), removalId: '00000000-0000-4000-8000-000000000002' };
    const source = [item(session('B', { updatedAt: 999 })), item(r1), item(r2), item(session('C'))];
    for (const rows of [
      source,
      [...source].reverse(),
      [source[2], source[0], source[3], source[1]],
    ]) {
      const h = harness(rows.map((r) => ({ ...r })));
      await h.run();
      await h.run();
      expect(h.active.get(invitedPersonKey(session()))).toMatchObject({
        removedThrough: 250,
        token: '',
      });
      for (const r of [r1, r2])
        expect(h.remote.find((row) => row.account === invitedRemovalKey(r))!.payload).toBe(
          JSON.stringify(r),
        );
    }
  });

  it('preserves unknown extension fields across known access-group copies and writes the destination before a scoped delete', async () => {
    const a = { ...item(session('C', { oldExtra: 'keep', accent: null })), group: 'old' };
    const b = { ...item(session('C', { updatedAt: 101, newExtra: 'also keep' })), group: 'shared' };
    const h = harness([a, b]);
    vi.mocked(h.client.list).mockResolvedValue({
      ok: true,
      items: h.remote,
      sharedGroup: 'shared',
    });
    vi.mocked(h.client.delete).mockImplementation(async () => {
      h.calls.push('delete');
      return { ok: true };
    });
    await h.run();
    expect(h.active.get(a.account)).toMatchObject({
      oldExtra: 'keep',
      newExtra: 'also keep',
      accent: null,
    });
    expect(h.client.delete).toHaveBeenCalledWith(a.account, 'old');
    expect(h.calls.indexOf('upsert')).toBeLessThan(h.calls.indexOf('delete'));
  });

  it('unknown bytes in one access group freeze every copy of that person', async () => {
    const frozen = {
      account: invitedPersonKey(session()),
      group: 'old',
      payload: '{"v":3,"future":"opaque"}',
    };
    const h = harness([frozen, { ...item(session()), group: 'shared' }]);
    vi.mocked(h.client.list).mockResolvedValue({
      ok: true,
      items: h.remote,
      sharedGroup: 'shared',
    });
    await h.run();
    expect(h.client.upsert).not.toHaveBeenCalled();
    expect(h.client.delete).not.toHaveBeenCalled();
    expect(h.remote[0]).toEqual(frozen);
    expect(h.adapter.apply).not.toHaveBeenCalled();
  });

  it('a missing-person legacy deletion cannot use another person as implicit provenance', async () => {
    const h = harness([
      old(undefined, { deleted: true, token: '', updatedAt: 200, deletedAt: 200 }),
      old('B'),
    ]);
    await h.run();
    expect(h.adapter.apply).not.toHaveBeenCalled();
    expect(h.client.insert).not.toHaveBeenCalled();
    expect(h.client.upsert).not.toHaveBeenCalled();
  });
  it('an exact saved unambiguous legacy-account provenance resolves only that person deletion', async () => {
    const h = harness([
      old(undefined, { deleted: true, token: '', updatedAt: 200, deletedAt: 200 }),
      old('C', { host: 'c.example' }),
    ]);
    h.remote[1].account = 'c.example:443';
    vi.mocked(h.adapter.read).mockResolvedValue({
      items: [],
      pendingPairings: [],
      provenance: { 'old.example:443': [{ fingerprint, principalId: 'B' }] },
    });
    await h.run();
    expect(h.active.get(invitedPersonKey(session('B')))).toMatchObject({
      removedThrough: 200,
      token: '',
    });
    expect(h.active.get(invitedPersonKey(session('C')))).toMatchObject({ token: 'C-still-valid' });
  });
});
