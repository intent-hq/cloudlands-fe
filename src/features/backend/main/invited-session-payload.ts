import {
  isConnectionAccent,
  isDetectedDeviceKind,
  isDeviceIconChoice,
} from '../../../shared/types/connections';
import { accountKeyFor, TOMBSTONE_TTL_MS } from './keychain-sync';
import {
  canonicalFingerprint,
  invitedPersonKey,
  invitedRemovalKey,
  scalarString,
  sortedStrings,
  type InvitedPerson,
} from './invited-session-key';

interface Extensible {
  [key: string]: unknown;
}
export interface InvitedSession extends InvitedPerson, Extensible {
  v: 2;
  kind: 'session';
  label: string;
  login: string | null;
  host: string;
  hosts: string[];
  port: number;
  hostname: string | null;
  detectHosts: boolean;
  tcAddress: string | null;
  tcUpdatedAt: number | null;
  token: string;
  updatedAt: number;
  pairedAt: number;
  removedThrough: number;
  deleted: boolean;
  deletedAt: number | null;
  legacyAccounts: string[];
}
export interface RemovedInvitedSession extends InvitedPerson, Extensible {
  v: 2;
  kind: 'removed';
  token: '';
  updatedAt: number;
  removedThrough: number;
  legacyAccounts: string[];
}
export interface InvitedRemoval extends InvitedPerson, Extensible {
  v: 2;
  kind: 'removal';
  removalId: string;
  removedThrough: number;
  legacyAccounts: string[];
}
export interface InvitedLegacyAlias extends Extensible {
  v: 2;
  kind: 'legacy-alias';
  personKeys: string[];
}
export type InvitedMutable = InvitedSession | RemovedInvitedSession;
export type InvitedPayload = InvitedMutable | InvitedRemoval | InvitedLegacyAlias;

export const isClock = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
const nullableString = (n: unknown): n is string | null => n === null || typeof n === 'string';
const object = (n: unknown): n is Record<string, unknown> =>
  !!n && typeof n === 'object' && !Array.isArray(n);
const stringSet = (n: unknown): n is string[] =>
  Array.isArray(n) &&
  n.every(scalarString) &&
  JSON.stringify(n) === JSON.stringify(sortedStrings(n));
const legacyAccount = (account: string): boolean => {
  const split = account.lastIndexOf(':');
  const host = account.slice(0, split);
  const port = Number(account.slice(split + 1));
  return (
    split > 0 &&
    Number.isInteger(port) &&
    port > 0 &&
    port <= 65535 &&
    accountKeyFor(host, port) === account
  );
};
export const isPersonAccount = (n: string): boolean => /^invited-v2-s:[0-9a-f]{64}$/.test(n);

/** Invalid, unknown and newer records are deliberately indistinguishable to the writer: frozen. */
export function parseInvitedPayload(account: string, payload: string): InvitedPayload | null {
  try {
    const r: unknown = JSON.parse(payload);
    if (!object(r) || r.v !== 2) return null;
    if (r.kind === 'legacy-alias') {
      if (
        !legacyAccount(account) ||
        !stringSet(r.personKeys) ||
        !r.personKeys.every(isPersonAccount)
      )
        return null;
      return r as InvitedLegacyAlias;
    }
    if (
      typeof r.fingerprint !== 'string' ||
      canonicalFingerprint(r.fingerprint) !== r.fingerprint ||
      !scalarString(r.principalId) ||
      !stringSet(r.legacyAccounts) ||
      !r.legacyAccounts.every(legacyAccount) ||
      !isClock(r.removedThrough)
    )
      return null;
    const person = r as unknown as InvitedPerson;
    if (r.kind === 'removal') {
      if (
        typeof r.removalId !== 'string' ||
        r.removedThrough === 0 ||
        [
          'token',
          'login',
          'label',
          'host',
          'hosts',
          'port',
          'hostname',
          'tcAddress',
          'tcUpdatedAt',
          'detectHosts',
          'accent',
          'detectedDeviceKind',
          'deviceIcon',
          'identity',
          'hostRole',
          'avatarUrl',
          'displayName',
        ].some((key) => Object.hasOwn(r, key)) ||
        invitedRemovalKey(r as unknown as InvitedRemoval) !== account
      )
        return null;
      return r as unknown as InvitedRemoval;
    }
    if (invitedPersonKey(person) !== account || !isClock(r.updatedAt)) return null;
    if (r.kind === 'removed')
      return r.token === '' ? (r as unknown as RemovedInvitedSession) : null;
    if (
      r.kind !== 'session' ||
      typeof r.label !== 'string' ||
      !nullableString(r.login) ||
      !scalarString(r.host) ||
      !Array.isArray(r.hosts) ||
      !r.hosts.every(scalarString) ||
      !Number.isInteger(r.port) ||
      (r.port as number) < 1 ||
      (r.port as number) > 65535 ||
      !nullableString(r.hostname) ||
      typeof r.detectHosts !== 'boolean' ||
      !nullableString(r.tcAddress) ||
      !(r.tcUpdatedAt === null || isClock(r.tcUpdatedAt)) ||
      !isClock(r.pairedAt) ||
      typeof r.deleted !== 'boolean' ||
      (r.deleted
        ? r.token !== '' || !isClock(r.deletedAt)
        : !scalarString(r.token) || r.deletedAt !== null) ||
      (r.accent !== undefined && !isConnectionAccent(r.accent)) ||
      (r.detectedDeviceKind !== undefined &&
        r.detectedDeviceKind !== null &&
        !isDetectedDeviceKind(r.detectedDeviceKind)) ||
      (r.deviceIcon !== undefined && !isDeviceIconChoice(r.deviceIcon))
    )
      return null;
    return r as unknown as InvitedSession;
  } catch {
    return null;
  }
}

export function compactInvited(record: InvitedMutable, now: number): InvitedMutable {
  if (
    record.kind !== 'session' ||
    !record.deleted ||
    record.deletedAt === null ||
    now - record.deletedAt <= TOMBSTONE_TTL_MS
  )
    return record;
  // Keep extension fields while removing the documented full-session detail fields.
  const next: Record<string, unknown> = { ...record, kind: 'removed' };
  for (const key of [
    'label',
    'login',
    'host',
    'hosts',
    'port',
    'hostname',
    'detectHosts',
    'tcAddress',
    'tcUpdatedAt',
    'pairedAt',
    'deleted',
    'deletedAt',
    'accent',
    'detectedDeviceKind',
    'deviceIcon',
  ])
    delete next[key];
  return next as unknown as RemovedInvitedSession;
}

export function removedSession(
  person: InvitedPerson,
  floor: number,
  aliases: string[],
): RemovedInvitedSession {
  return {
    v: 2,
    kind: 'removed',
    ...person,
    token: '',
    updatedAt: floor,
    removedThrough: floor,
    legacyAccounts: sortedStrings(aliases),
  };
}

/** Pure merge: metadata, credentials, routes and permanent removal memory have separate clocks. */
export function mergeInvitedPerson(
  records: InvitedMutable[],
  removals: InvitedRemoval[],
): InvitedMutable | null {
  const first = records[0] ?? removals[0];
  if (!first) return null;
  const person = { fingerprint: first.fingerprint, principalId: first.principalId };
  const key = invitedPersonKey(person);
  if ([...records, ...removals].some((r) => invitedPersonKey(r) !== key))
    throw new Error('Mixed invited people');
  const floor = Math.max(
    0,
    ...records.map((r) => r.removedThrough),
    ...removals.map((r) => r.removedThrough),
  );
  const legacyAccounts = sortedStrings([...records, ...removals].flatMap((r) => r.legacyAccounts));
  const extensions = Object.assign(
    {},
    ...records.map((r) =>
      Object.fromEntries(
        Object.entries(r).filter(
          ([field]) =>
            ![
              'v',
              'kind',
              'fingerprint',
              'principalId',
              'token',
              'updatedAt',
              'removedThrough',
              'legacyAccounts',
              'label',
              'login',
              'host',
              'hosts',
              'port',
              'hostname',
              'detectHosts',
              'tcAddress',
              'tcUpdatedAt',
              'pairedAt',
              'deleted',
              'deletedAt',
              'accent',
              'detectedDeviceKind',
              'deviceIcon',
            ].includes(field),
        ),
      ),
    ),
  );
  const live = records.filter(
    (r): r is InvitedSession => r.kind === 'session' && !r.deleted && r.pairedAt > floor,
  );
  if (!live.length) {
    const details = records
      .filter((r): r is InvitedSession => r.kind === 'session' && r.deleted)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    return details
      ? {
          ...extensions,
          ...details,
          token: '',
          updatedAt: floor,
          removedThrough: floor,
          legacyAccounts,
        }
      : { ...extensions, ...removedSession(person, floor, legacyAccounts) };
  }
  const metadata = [...live].sort(
    (a, b) =>
      b.updatedAt - a.updatedAt ||
      Buffer.compare(
        Buffer.from(accountKeyFor(b.host, b.port)),
        Buffer.from(accountKeyFor(a.host, a.port)),
      ),
  )[0];
  const credential = [...live].sort((a, b) => b.pairedAt - a.pairedAt)[0];
  const routes = [...live].sort(
    (a, b) =>
      (b.tcUpdatedAt ?? -1) - (a.tcUpdatedAt ?? -1) ||
      Number(b.tcAddress === null) - Number(a.tcAddress === null) ||
      Buffer.compare(
        Buffer.from(accountKeyFor(b.host, b.port)),
        Buffer.from(accountKeyFor(a.host, a.port)),
      ),
  );
  const route = routes[0];
  return {
    ...extensions,
    ...Object.assign({}, ...live.slice().reverse()),
    ...metadata,
    token: credential.token,
    pairedAt: credential.pairedAt,
    login: credential.login,
    tcAddress: route.tcAddress,
    tcUpdatedAt: route.tcUpdatedAt,
    removedThrough: floor,
    legacyAccounts,
  };
}
