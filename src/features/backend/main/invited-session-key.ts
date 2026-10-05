import { createHash } from 'node:crypto';

export interface InvitedPerson {
  fingerprint: string;
  principalId: string;
}

/** The principal is opaque: UTF-8 scalar validation must not normalize its bytes. */
export function scalarString(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    Buffer.from(value, 'utf8').toString('utf8') === value
  );
}

export function canonicalFingerprint(value: string): string {
  if (!/^(?:[a-fA-F0-9]{64}|(?:[a-fA-F0-9]{2}:){31}[a-fA-F0-9]{2})$/.test(value)) {
    throw new Error('Invalid invited host pin');
  }
  return value.replaceAll(':', '').toLowerCase();
}

export function sortedStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
}

function u32(value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
}

function lp(value: string): Buffer {
  if (!scalarString(value)) throw new Error('Invalid invited identity string');
  const bytes = Buffer.from(value, 'utf8');
  return Buffer.concat([u32(bytes.length), bytes]);
}

function identityBytes(person: InvitedPerson): Buffer {
  return Buffer.concat([
    Buffer.from(canonicalFingerprint(person.fingerprint), 'hex'),
    lp(person.principalId),
  ]);
}

export function invitedPersonKey(person: InvitedPerson): string {
  return (
    'invited-v2-s:' +
    createHash('sha256')
      .update('intent.invited-sync/v2/session\0', 'ascii')
      .update(identityBytes(person))
      .digest('hex')
  );
}

export function invitedRemovalKey(
  removal: InvitedPerson & {
    removalId: string;
    removedThrough: number;
    legacyAccounts: string[];
  },
): string {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      removal.removalId,
    ) ||
    !Number.isSafeInteger(removal.removedThrough) ||
    removal.removedThrough <= 0 ||
    JSON.stringify(sortedStrings(removal.legacyAccounts)) !== JSON.stringify(removal.legacyAccounts)
  ) {
    throw new Error('Invalid invited removal');
  }
  const clock = Buffer.alloc(8);
  clock.writeBigUInt64BE(BigInt(removal.removedThrough));
  return (
    'invited-v2-r:' +
    createHash('sha256')
      .update('intent.invited-sync/v2/removal\0', 'ascii')
      .update(identityBytes(removal))
      .update(Buffer.from(removal.removalId.replaceAll('-', ''), 'hex'))
      .update(clock)
      .update(u32(removal.legacyAccounts.length))
      .update(Buffer.concat(removal.legacyAccounts.map(lp)))
      .digest('hex')
  );
}
