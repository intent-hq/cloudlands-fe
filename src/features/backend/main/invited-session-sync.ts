/** Invited-service v2 reconciliation (§5.49). Owner v1 never enters this engine. */
import { randomUUID } from 'node:crypto';
import { m } from '../../../shared/paraglide/messages.js';
import { AuthRejectedError } from './backend-connection';
import {
  KEYCHAIN_SERVICE_GUEST_SESSIONS,
  createHelperKeychainClient,
  parsePayload,
  TOMBSTONE_TTL_MS,
  type KeychainItem,
  type KeychainSyncRecord,
  type ReconcileOptions,
  type ReconcileResult,
} from './keychain-sync';
import {
  canonicalFingerprint,
  invitedPersonKey,
  invitedRemovalKey,
  sortedStrings,
  type InvitedPerson,
} from './invited-session-key';
import {
  compactInvited,
  isClock,
  mergeInvitedPerson,
  parseInvitedPayload,
  type InvitedMutable,
  type InvitedPayload,
  type InvitedRemoval,
  type InvitedSession,
} from './invited-session-payload';

export interface InvitedCandidate {
  host: string;
  hosts: string[];
  port: number;
  fingerprint: string;
  tcAddress: string | null;
  token: string;
  principalId?: string;
}
export interface VerifiedInvitedIdentity {
  principalId: string;
  login: string | null;
}
export interface InvitedSyncAdapter {
  /** Includes inactive encrypted candidates and permanent observations, not just active sessions. */
  read(): Promise<{
    items: KeychainItem[];
    pendingPairings: string[];
    excludedPeople?: string[];
    provenance?: Record<string, InvitedPerson[]>;
  }>;
  /** Preserve candidates and removal facts durably before any publication. Does not activate imports. */
  remember(items: KeychainItem[]): Promise<void>;
  /** Apply only authenticated live state or folded removal state; merge against newer local mutations. */
  apply(account: string, record: InvitedMutable): Promise<void>;
  authenticate(candidate: InvitedCandidate): Promise<VerifiedInvitedIdentity | null>;
  /** An authoritative rejection of the selected bearer; implementations fence against a newer join. */
  rejectCredential?(record: InvitedSession): Promise<void>;
  /** Consume a saved deliberate rejoin once, after the complete list. Never create intent on a read. */
  admitPairing(
    account: string,
    floor: number,
    observedClock: number,
    expected: { token: string; pairedAt: number },
  ): Promise<InvitedSession | null>;
}

type Known = { item: KeychainItem; record: InvitedPayload };
type Legacy = { item: KeychainItem; record: KeychainSyncRecord; raw: Record<string, unknown> };
const itemFor = (account: string, record: InvitedPayload): KeychainItem => ({
  account,
  payload: JSON.stringify(record),
});
const failed = (reason: 'unavailable' | 'helper-failed'): ReconcileResult => ({
  status: { state: 'unavailable', reason, message: m.settings_backendSync_invitedPending() },
  pulled: [],
  pushed: [],
  deletedLocally: [],
  purged: [],
  skipped: [],
  migrated: [],
  errors: [],
});

function legacyPayload(item: KeychainItem): Legacy | null {
  try {
    const raw = JSON.parse(item.payload) as Record<string, unknown>;
    if (raw.v !== 1) return null;
    const parsed = parsePayload(item.payload);
    if (
      parsed.kind !== 'record' ||
      !isClock(parsed.record.updatedAt) ||
      !Number.isInteger(parsed.record.port) ||
      parsed.record.port < 1 ||
      parsed.record.port > 65535
    )
      return null;
    return { item, record: parsed.record, raw };
  } catch {
    return null;
  }
}

function legacySession(
  row: Legacy,
  identity: VerifiedInvitedIdentity,
  now: number,
  aliases: string[],
): InvitedSession {
  const r = row.record;
  const pairedAt = isClock(row.raw.pairedAt) ? row.raw.pairedAt : r.updatedAt;
  return {
    ...row.raw,
    v: 2,
    kind: 'session',
    fingerprint: canonicalFingerprint(r.fingerprint),
    principalId: identity.principalId,
    label: r.label,
    login: identity.login,
    host: r.host,
    hosts: r.hosts,
    port: r.port,
    hostname: r.hostname,
    detectHosts: r.detectHosts,
    tcAddress: r.tcAddress,
    tcUpdatedAt: r.tcAddress === null ? null : r.updatedAt,
    token: r.token,
    updatedAt: r.updatedAt || now,
    pairedAt: pairedAt || now,
    removedThrough: 0,
    deleted: false,
    deletedAt: null,
    legacyAccounts: aliases,
  };
}

/** No new diagnostic includes account names, bearer material or person tuples. */
export async function reconcileInvitedSessions(
  adapter: InvitedSyncAdapter,
  options: ReconcileOptions = {},
): Promise<ReconcileResult> {
  const client =
    options.client ?? createHelperKeychainClient({ service: KEYCHAIN_SERVICE_GUEST_SESSIONS });
  const aborted = async () => (await options.shouldAbort?.()) === true;
  const authenticateSelected = async (record: InvitedSession) => {
    try {
      return await adapter.authenticate(record);
    } catch (error) {
      if (error instanceof AuthRejectedError && error.statusCode === 401 && !(await aborted()))
        await adapter.rejectCredential?.(record);
      return null;
    }
  };
  if (await aborted()) return failed('unavailable');
  const remote = await client.list();
  if (!remote.ok)
    return {
      ...failed('unavailable'),
      status: {
        state: 'unavailable',
        reason: remote.code,
        message: m.settings_backendSync_invitedPending(),
      },
    };
  if (await aborted()) return failed('unavailable');
  // Permanent remote observations must survive a locked local credential vault too.
  const remoteRemovals = remote.items.filter(
    (item) => parseInvitedPayload(item.account, item.payload)?.kind === 'removal',
  );
  if (remoteRemovals.length) await adapter.remember(remoteRemovals);
  if (
    remote.items.some(
      (item) =>
        item.account.startsWith('invited-v2-r:') &&
        !parseInvitedPayload(item.account, item.payload),
    )
  )
    return failed('helper-failed');
  const local = await adapter.read();
  const all = [...local.items, ...remote.items];
  const known: Known[] = [];
  const legacy: Legacy[] = [];
  const frozen = new Set<string>(local.excludedPeople);
  let unreadableRemoval = false;
  for (const item of all) {
    const record = parseInvitedPayload(item.account, item.payload);
    if (record) known.push({ item, record });
    else if (item.account.startsWith('invited-v2-')) {
      frozen.add(item.account);
      if (item.account.startsWith('invited-v2-r:')) unreadableRemoval = true;
    } else {
      const old = legacyPayload(item);
      if (old) legacy.push(old);
      else frozen.add(item.account);
    }
  }
  // Removal observations survive encryption failures, failed publication and later missing list rows.
  const removalRows = known.filter(
    (k): k is Known & { record: InvitedRemoval } => k.record.kind === 'removal',
  );
  if (await aborted()) return failed('unavailable');
  await adapter.remember(removalRows.map((k) => k.item));
  if (unreadableRemoval) return failed('helper-failed');
  const result: ReconcileResult = {
    status: { state: 'active' },
    pulled: [],
    pushed: [],
    deletedLocally: [],
    purged: [],
    skipped: [...frozen],
    migrated: [],
    errors: [],
  };
  const now = options.now ?? Date.now();
  const records = new Map<string, InvitedMutable[]>();
  const removals = new Map<string, InvitedRemoval[]>();
  const aliases = new Map<string, Set<string>>();
  const addAlias = (alias: string, person: string) => {
    const set = aliases.get(alias) ?? new Set<string>();
    set.add(person);
    aliases.set(alias, set);
  };
  const addKnown = (r: InvitedPayload) => {
    if (r.kind === 'legacy-alias') return;
    const key = invitedPersonKey(r);
    for (const alias of r.legacyAccounts) addAlias(alias, key);
    if (r.kind === 'removal') removals.set(key, [...(removals.get(key) ?? []), r]);
    else records.set(key, [...(records.get(key) ?? []), r]);
  };
  for (const { item, record } of known) {
    if (record.kind === 'legacy-alias')
      for (const key of record.personKeys) addAlias(item.account, key);
    else addKnown(record);
  }
  const v2People = new Set([...records.keys(), ...removals.keys()]);
  const retiredAliases = new Set(aliases.keys());
  const legacyPeople = new Map<string, { row: Legacy; identity?: VerifiedInvitedIdentity }[]>();
  const unclassified = new Set<string>();
  // Classify the complete candidate set before deciding winners or writing aliases.
  for (const row of legacy) {
    if (await aborted()) return result;
    if (frozen.has(row.item.account)) continue;
    if (retiredAliases.has(row.item.account)) continue;
    let fingerprint: string;
    try {
      fingerprint = canonicalFingerprint(row.record.fingerprint);
    } catch {
      unclassified.add(row.item.account);
      continue;
    }
    let principalId = row.record.principalId;
    let identity: VerifiedInvitedIdentity | undefined;
    if (!principalId && row.record.deleted) {
      const provenance = local.provenance?.[row.item.account];
      if (provenance?.length === 1 && provenance[0].fingerprint === fingerprint) {
        principalId = provenance[0].principalId;
        row.record = { ...row.record, principalId };
      }
      if (!principalId) {
        unclassified.add(row.item.account);
        continue;
      }
    }
    if (!row.record.deleted) {
      // A known v2 person cannot be changed by an old writer, even with a higher clock.
      if (principalId) {
        try {
          const key = invitedPersonKey({ fingerprint, principalId });
          if (frozen.has(key)) {
            unclassified.add(row.item.account);
            continue;
          }
          if (v2People.has(key)) {
            addAlias(row.item.account, key);
            continue;
          }
        } catch {
          unclassified.add(row.item.account);
          continue;
        }
      }
      identity =
        (await adapter.authenticate({ ...row.record, fingerprint }).catch(() => null)) ?? undefined;
      if (!identity || (principalId !== undefined && identity.principalId !== principalId)) {
        unclassified.add(row.item.account);
        continue;
      }
      principalId = identity.principalId;
    }
    let key: string;
    try {
      key = invitedPersonKey({ fingerprint, principalId: principalId! });
    } catch {
      unclassified.add(row.item.account);
      continue;
    }
    if (frozen.has(key)) {
      unclassified.add(row.item.account);
      continue;
    }
    addAlias(row.item.account, key);
    if (v2People.has(key)) continue;
    legacyPeople.set(key, [...(legacyPeople.get(key) ?? []), { row, identity }]);
  }
  // Preserve unknown/missing-identity bytes encrypted as pending, without turning them into active rows.
  if (await aborted()) return result;
  await adapter.remember(all.filter((i) => !i.account.startsWith('invited-v2-r:')));
  for (const [key, candidates] of legacyPeople) {
    if (candidates.some(({ row }) => unclassified.has(row.item.account))) continue;
    const eligible = candidates.filter(
      ({ row }) =>
        !row.record.deleted ||
        now - (row.record.deletedAt ?? row.record.updatedAt) <= TOMBSTONE_TTL_MS,
    );
    eligible.sort(
      (a, b) =>
        b.row.record.updatedAt - a.row.record.updatedAt ||
        Number(b.row.record.deleted === true) - Number(a.row.record.deleted === true) ||
        Buffer.compare(Buffer.from(b.row.item.account), Buffer.from(a.row.item.account)),
    );
    const winner = eligible[0];
    if (!winner) continue;
    const legacyAccounts = sortedStrings(candidates.map(({ row }) => row.item.account));
    if (winner.row.record.deleted) {
      const record: InvitedRemoval = {
        v: 2,
        kind: 'removal',
        fingerprint: canonicalFingerprint(winner.row.record.fingerprint),
        principalId: winner.row.record.principalId!,
        removalId: randomUUID(),
        removedThrough: winner.row.record.updatedAt || 1,
        legacyAccounts,
      };
      if (await aborted()) return result;
      await adapter.remember([itemFor(invitedRemovalKey(record), record)]);
      addKnown(record);
    } else {
      const record = legacySession(winner.row, winner.identity!, now, legacyAccounts);
      if (await aborted()) return result;
      await adapter.remember([itemFor(key, record)]);
      addKnown(record);
    }
  }

  const published = new Set<string>();
  const blockedRemovalPeople = new Set<string>();
  // Create-only publication precedes mutable caches and alias retirement, including across groups.
  for (const [key, entries] of removals) {
    if (frozen.has(key)) continue;
    for (const removal of new Map(entries.map((r) => [invitedRemovalKey(r), r])).values()) {
      if (await aborted()) return result;
      const account = invitedRemovalKey(removal);
      const inserted = await client.insert?.(account, JSON.stringify(removal));
      const existing = inserted?.ok ? parseInvitedPayload(account, inserted.payload) : null;
      if (!inserted?.ok || existing?.kind !== 'removal') {
        blockedRemovalPeople.add(key);
        result.errors.push({
          account,
          op: 'upsert',
          code: inserted && !inserted.ok ? inserted.code : 'helper-failed',
        });
        continue;
      }
      // Derivation validates every immutable field. Unknown extension bytes remain untouched by insert.
      published.add(account);
      for (const old of remote.items.filter(
        (i) =>
          i.account === account &&
          i.group !== undefined &&
          remote.sharedGroup !== undefined &&
          i.group !== remote.sharedGroup,
      )) {
        if (await aborted()) return result;
        const deleted = await client.delete(account, old.group);
        if (!deleted.ok && deleted.code !== 'not-found')
          result.errors.push({ account, op: 'delete', code: deleted.code });
        else result.migrated.push(account);
      }
    }
  }
  for (const key of new Set([...records.keys(), ...removals.keys()])) {
    if (await aborted()) return result;
    if (frozen.has(key)) continue;
    const personAliases = [...aliases]
      .filter(([, people]) => people.has(key))
      .map(([alias]) => alias);
    const candidates = (records.get(key) ?? []).map((r) => ({
      ...r,
      legacyAccounts: sortedStrings([...r.legacyAccounts, ...personAliases]),
    }));
    const facts = removals.get(key) ?? [];
    let merged = mergeInvitedPerson(candidates, facts);
    if (!merged) continue;
    if (local.pendingPairings.includes(key)) {
      const pending = [...local.items].reverse().flatMap((item) => {
        const record = item.account === key ? parseInvitedPayload(key, item.payload) : null;
        return record?.kind === 'session' && !record.deleted ? [record] : [];
      })[0];
      if (pending && (await authenticateSelected(pending))?.principalId === pending.principalId) {
        if (await aborted()) return result;
        const admitted = await adapter.admitPairing(
          key,
          merged.removedThrough,
          Math.max(merged.updatedAt, ...candidates.map((r) => r.updatedAt)),
          pending,
        );
        if (admitted) merged = mergeInvitedPerson([...candidates, admitted], facts)!;
        else continue;
      } else continue;
    }
    merged = compactInvited(merged, now);
    const live = merged.kind === 'session' && !merged.deleted;
    if (live) {
      const identity = await authenticateSelected(merged as InvitedSession);
      if (!identity || identity.principalId !== merged.principalId) {
        result.skipped.push(key);
        continue;
      }
    }
    if (await aborted()) return result;
    await adapter.remember([itemFor(key, merged)]);
    await adapter.apply(key, merged);
    (live ? result.pulled : result.deletedLocally).push(key);
    if (blockedRemovalPeople.has(key)) continue;
    const payload = JSON.stringify(merged);
    const copies = remote.items.filter((i) => i.account === key);
    const destination = copies.find((i) => i.group === remote.sharedGroup || i.group === undefined);
    if (destination?.payload !== payload) {
      if (await aborted()) return result;
      const written = await client.upsert(key, payload);
      if (!written.ok) {
        result.errors.push({ account: key, op: 'upsert', code: written.code });
        continue;
      }
      result.pushed.push(key);
    }
    published.add(key);
    for (const old of copies.filter(
      (i) =>
        i.group !== undefined && remote.sharedGroup !== undefined && i.group !== remote.sharedGroup,
    )) {
      if (await aborted()) return result;
      const deleted = await client.delete(key, old.group);
      if (!deleted.ok && deleted.code !== 'not-found')
        result.errors.push({ account: key, op: 'delete', code: deleted.code });
      else result.migrated.push(key);
    }
  }
  for (const [account, people] of aliases) {
    if (await aborted()) return result;
    if (
      !account ||
      frozen.has(account) ||
      unclassified.has(account) ||
      [...people].some(
        (key) =>
          frozen.has(key) ||
          blockedRemovalPeople.has(key) ||
          (!published.has(key) &&
            (!removals.get(key)?.length ||
              !(removals.get(key) ?? []).every((r) => published.has(invitedRemovalKey(r))))),
      )
    )
      continue;
    const extensions = known
      .filter((k) => k.item.account === account && k.record.kind === 'legacy-alias')
      .map((k) => k.record);
    const marker = {
      ...Object.assign({}, ...extensions),
      v: 2,
      kind: 'legacy-alias',
      personKeys: sortedStrings([...people]),
    } as const;
    const payload = JSON.stringify(marker);
    const current = remote.items.filter((i) => i.account === account);
    const destination = current.find(
      (i) => i.group === remote.sharedGroup || i.group === undefined,
    );
    if (destination?.payload !== payload) {
      const written = await client.upsert(account, payload);
      if (!written.ok) {
        result.errors.push({ account, op: 'upsert', code: written.code });
        continue;
      }
    }
    await adapter.remember([{ account, payload }]);
    for (const old of current.filter(
      (i) =>
        i.group !== undefined && remote.sharedGroup !== undefined && i.group !== remote.sharedGroup,
    )) {
      if (await aborted()) return result;
      const deleted = await client.delete(account, old.group);
      if (!deleted.ok && deleted.code !== 'not-found')
        result.errors.push({ account, op: 'delete', code: deleted.code });
    }
  }
  if (result.errors.length) result.status = { state: 'active', errorCount: result.errors.length };
  return result;
}
