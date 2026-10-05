import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import provenance from '../__fixtures__/invited-session-v2/provenance.json';
import { invitedPersonKey, invitedRemovalKey, canonicalFingerprint } from '../invited-session-key';

// Independently published §5.49 vectors (docs commit 68c7dacba5011e91feda3f065b23d0f965205bae).
const fingerprint = 'ab'.repeat(32);
describe('invited v2 account identity', () => {
  it('runs the frozen v1 source identified by the recorded hash, with import paths as the only edit', () => {
    const source = readFileSync(
      'src/features/backend/main/__fixtures__/invited-session-v2/keychain-sync-c9.fixture.ts',
      'utf8',
    ).replaceAll('../../../../../shared/', '../../../shared/');
    expect(createHash('sha256').update(source).digest('hex')).toBe(provenance.sourceSha256);
    for (const [principalId, key] of Object.entries(provenance.sessionVectors)) {
      expect(invitedPersonKey({ fingerprint, principalId })).toBe(key);
    }
  });
  it.each([
    ['B', '8e4ca5301c7e9fdeb66c53a80eb0c36dcd84707596e010f972342e9631b39c02'],
    ['C', '8b7992fc9596dc890a8acb87157e82a26cbf1cea7e7f3cf1d6747198b3db5015'],
    ['é', '397d72f58023e3b4931f01f0f521bdb0cb82260caedf458af7c2a0c57e22ab78'],
  ])('matches the session vector for %s', (principalId, hash) => {
    expect(invitedPersonKey({ fingerprint, principalId })).toBe(`invited-v2-s:${hash}`);
  });
  it('matches the immutable removal vector', () => {
    expect(
      invitedRemovalKey({
        fingerprint,
        principalId: 'B',
        removalId: '00000000-0000-4000-8000-000000000001',
        removedThrough: 200,
        legacyAccounts: ['old.example:443'],
      }),
    ).toBe('invited-v2-r:afb2ccf2baac828571f18cf41dc2df0f1e6938f53476efeda9aad4738b4ef56f');
  });
  it('canonicalizes only the pin, never opaque principal bytes', () => {
    expect(canonicalFingerprint(Array(32).fill('AB').join(':'))).toBe(fingerprint);
    expect(invitedPersonKey({ fingerprint, principalId: 'é' })).not.toBe(
      invitedPersonKey({ fingerprint, principalId: 'e\u0301' }),
    );
    expect(invitedPersonKey({ fingerprint, principalId: 'B' })).not.toBe(
      invitedPersonKey({ fingerprint, principalId: ' B' }),
    );
  });
  it.each(['', 'AA:BB:CC', 'ab'.repeat(31), 'ab'.repeat(33), 'gg'.repeat(32)])(
    'rejects invalid pins %s',
    (pin) => {
      expect(() => invitedPersonKey({ fingerprint: pin, principalId: 'B' })).toThrow();
    },
  );
  it.each(['', '\ud800', '\udfff'])('rejects non-scalar or empty principals', (principalId) => {
    expect(() => invitedPersonKey({ fingerprint, principalId })).toThrow();
  });
});
