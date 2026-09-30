import { describe, expect, it } from 'vitest';
import { invitedPersonKey, invitedRemovalKey } from '../invited-session-key';
import {
  compactInvited,
  mergeInvitedPerson,
  parseInvitedPayload,
  type InvitedSession,
  type InvitedRemoval,
} from '../invited-session-payload';

const base: InvitedSession = {
  v: 2,
  kind: 'session',
  fingerprint: 'ab'.repeat(32),
  principalId: 'B',
  login: null,
  label: 'Studio',
  host: 'old.example',
  hosts: ['old.example'],
  port: 443,
  hostname: null,
  detectHosts: true,
  tcAddress: 'Opaque-Aa_route',
  tcUpdatedAt: 100,
  token: 'still-valid-on-server',
  updatedAt: 100,
  pairedAt: 100,
  removedThrough: 0,
  deleted: false,
  deletedAt: null,
  legacyAccounts: ['old.example:443'],
};
const removal: InvitedRemoval = {
  v: 2,
  kind: 'removal',
  fingerprint: base.fingerprint,
  principalId: 'B',
  removalId: '00000000-0000-4000-8000-000000000001',
  removedThrough: 200,
  legacyAccounts: base.legacyAccounts,
};
const parse = (r: unknown, account = invitedPersonKey(base)) =>
  parseInvitedPayload(account, JSON.stringify(r));

describe('invited payload validation', () => {
  it('accepts nullable display login and preserves unknown extension bytes semantically', () => {
    const extended = { ...base, future: { value: 'kept' } };
    expect(parse(extended)).toEqual(extended);
  });
  it.each(Object.keys(base))('requires %s rather than supplying defaults', (key) => {
    const row: Record<string, unknown> = { ...base };
    delete row[key];
    expect(parse(row)).toBeNull();
  });
  it.each([NaN, Infinity, -1, true, '100', Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid clock %s',
    (clock) => {
      for (const key of ['updatedAt', 'pairedAt', 'removedThrough', 'tcUpdatedAt']) {
        const payload = JSON.stringify({ ...base, [key]: clock });
        // JSON.stringify(NaN/Infinity) produces null, which is a valid unknown route clock.
        expect(
          parseInvitedPayload(
            invitedPersonKey(base),
            typeof clock === 'number' && !Number.isFinite(clock)
              ? payload.replace(`"${key}":null`, `"${key}":1e999`)
              : payload,
          ),
        ).toBeNull();
      }
    },
  );
  it.each([0, 65536, 1.5, true, '443'])('rejects invalid ports %s', (port) => {
    expect(parse({ ...base, port })).toBeNull();
  });
  it('freezes wrong accounts, newer formats and malformed identity strings', () => {
    expect(parse(base, invitedPersonKey({ ...base, principalId: 'C' }))).toBeNull();
    expect(parse({ ...base, v: 3 })).toBeNull();
    expect(parse({ ...base, kind: 'future' })).toBeNull();
    expect(parse({ ...base, principalId: '\ud800' })).toBeNull();
  });
  it('requires exact immutable removal identity and excludes credential fields', () => {
    const key = invitedRemovalKey(removal);
    expect(parse(removal, key)).toEqual(removal);
    expect(parse({ ...removal, removedThrough: 201 }, key)).toBeNull();
    expect(parse({ ...removal, token: '' }, key)).toBeNull();
  });
});

describe('independent credential, route and removal clocks', () => {
  it('rejects the still-server-valid B bearer after removal despite route clock 300; C survives', () => {
    expect(
      mergeInvitedPerson([{ ...base, updatedAt: 300, host: 'new.example' }], [removal]),
    ).toMatchObject({ kind: 'removed', token: '', removedThrough: 200 });
    const c = { ...base, principalId: 'C', updatedAt: 400 };
    expect(mergeInvitedPerson([c], [])).toEqual(c);
  });
  it('retains a new pairing bearer when an old pairing carries later metadata', () => {
    const newer = { ...base, pairedAt: 250, updatedAt: 250, token: 'new-bearer' };
    const staleRoute = {
      ...base,
      updatedAt: 300,
      host: 'new.example',
      tcUpdatedAt: 300,
      tcAddress: null,
    };
    expect(mergeInvitedPerson([staleRoute, newer], [])).toMatchObject({
      token: 'new-bearer',
      pairedAt: 250,
      host: 'new.example',
      tcAddress: null,
      tcUpdatedAt: 300,
    });
  });
  it('retains removal memory and all aliases after explicit rejoin', () => {
    const rejoin = {
      ...base,
      pairedAt: 201,
      updatedAt: 201,
      legacyAccounts: ['other.example:443'],
    };
    expect(mergeInvitedPerson([rejoin], [removal])).toMatchObject({
      pairedAt: 201,
      removedThrough: 200,
      legacyAccounts: ['old.example:443', 'other.example:443'],
    });
  });
  it('does not interpret unknown routes as clears; equal route clock clear wins', () => {
    const unknown = { ...base, tcAddress: null, tcUpdatedAt: null };
    expect(mergeInvitedPerson([unknown, base], [])).toMatchObject({ tcAddress: base.tcAddress });
    expect(mergeInvitedPerson([{ ...base, tcAddress: null }, base], [])).toMatchObject({
      tcAddress: null,
    });
  });
  it('compacts full deleted details without losing removal memory or extensions', () => {
    const deleted = {
      ...base,
      deleted: true,
      deletedAt: 200,
      token: '',
      removedThrough: 200,
      updatedAt: 200,
      future: 7,
    };
    const compact = compactInvited(deleted, 40 * 86400_000);
    expect(compact).toMatchObject({ kind: 'removed', removedThrough: 200, future: 7 });
    expect(compact).not.toHaveProperty('host');
    expect(parse(compact)).toEqual(compact);
  });
});
