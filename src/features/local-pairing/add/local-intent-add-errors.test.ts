/**
 * Requester side of local code pairing in the renderer: IPC reply parsing,
 * the message for every redeem error (unknown codes included) and which
 * errors make the typed code useless.
 */
import { describe, expect, it } from 'vitest';
import type { LocalRedeemErrorCode } from '$shared/types/local-pairing';
import {
  formatLocalCode,
  isWellFormedLocalCode,
  normalizeLocalCode,
} from '$shared/utils/local-pairing-code';
import { localRedeemErrorMessage, localRedeemErrorSpendsCode } from './local-intent-add-errors';
import { parseListReply, parseRedeemReply } from './local-intent-add-client';

const ALL_CODES: LocalRedeemErrorCode[] = [
  'wrong-code',
  'locked',
  'expired',
  'code-format',
  'gone',
  'not-listening',
  'unreachable',
  'certificate',
  'refused',
  'remote-access-on',
  'unsupported',
  'busy',
  'save-failed',
  'unknown',
];

describe('local pairing codes', () => {
  it('normalizes, validates and formats like the contract', () => {
    expect(normalizeLocalCode(' ktp-82m ')).toBe('KTP82M');
    expect(isWellFormedLocalCode('ktp 82m')).toBe(true);
    expect(isWellFormedLocalCode('KTP-82')).toBe(false);
    expect(isWellFormedLocalCode('KTP-820')).toBe(false); // 0 is not in the alphabet
    expect(isWellFormedLocalCode('LIO-123')).toBe(false);
    expect(formatLocalCode('ktp8')).toBe('KTP-8');
    expect(formatLocalCode('ktp82mxyz')).toBe('KTP-82M');
    expect(formatLocalCode('kt')).toBe('KT');
  });
});

describe('parseListReply', () => {
  it('keeps well-formed Intents and drops the rest', () => {
    expect(
      parseListReply({
        ok: true,
        intents: [
          { instanceId: 'a', displayName: 'Intent', dataDir: '/a', accepting: true },
          { instanceId: '', displayName: 'x', dataDir: '/x', accepting: true },
          { instanceId: 'b', displayName: 'Intent Beta', dataDir: '/b' },
          'junk',
        ],
      }),
    ).toEqual({
      ok: true,
      intents: [
        { instanceId: 'a', displayName: 'Intent', dataDir: '/a', accepting: true },
        { instanceId: 'b', displayName: 'Intent Beta', dataDir: '/b', accepting: false },
      ],
    });
  });

  it('treats anything else as unavailable', () => {
    expect(parseListReply(undefined)).toEqual({ ok: false, code: 'unavailable' });
    expect(parseListReply({ ok: false, code: 'unavailable' })).toEqual({
      ok: false,
      code: 'unavailable',
    });
  });
});

describe('parseRedeemReply', () => {
  it('passes a saved machine through', () => {
    const reply = { ok: true, connection: { id: 'conn-1', label: 'Intent' } };
    expect(parseRedeemReply(reply)).toBe(reply);
  });

  it('keeps known codes and the tries left, and maps unknown codes to unknown', () => {
    expect(
      parseRedeemReply({ ok: false, error: { code: 'wrong-code', attemptsRemaining: 2 } }),
    ).toEqual({
      ok: false,
      error: { code: 'wrong-code', attemptsRemaining: 2 },
    });
    expect(
      parseRedeemReply({ ok: false, error: { code: 'locked', attemptsRemaining: 2 } }),
    ).toEqual({
      ok: false,
      error: { code: 'locked' },
    });
    expect(parseRedeemReply({ ok: false, error: { code: 'from-the-future' } })).toEqual({
      ok: false,
      error: { code: 'unknown' },
    });
    expect(parseRedeemReply(null)).toEqual({ ok: false, error: { code: 'unknown' } });
  });
});

describe('localRedeemErrorMessage', () => {
  it('gives every error its own message naming the other Intent where it helps', () => {
    const messages = ALL_CODES.map((code) =>
      localRedeemErrorMessage({ code, attemptsRemaining: 2 }, 'Intent Beta'),
    );
    expect(new Set(messages).size).toBe(ALL_CODES.length);
    for (const [index, message] of messages.entries()) {
      expect(message.length).toBeGreaterThan(10);
      if (ALL_CODES[index] !== 'code-format') expect(message).toContain('Intent Beta');
    }
  });

  it('shows the tries left after a wrong code', () => {
    expect(localRedeemErrorMessage({ code: 'wrong-code', attemptsRemaining: 2 }, 'B')).toContain(
      'Tries left: 2',
    );
    expect(localRedeemErrorMessage({ code: 'wrong-code' }, 'B')).not.toContain('Tries left');
  });

  it('tells the user to turn off the tunnel when that is the reason', () => {
    expect(localRedeemErrorMessage({ code: 'remote-access-on' }, 'B')).toContain('Tailcat tunnel');
    expect(localRedeemErrorMessage({ code: 'refused' }, 'B')).toContain('Tailcat tunnel');
  });
});

describe('localRedeemErrorSpendsCode', () => {
  it('clears the code only when it can never work again', () => {
    const spent = ALL_CODES.filter((code) => localRedeemErrorSpendsCode({ code }));
    expect(spent).toEqual(['wrong-code', 'locked', 'expired', 'certificate', 'save-failed']);
  });
});
