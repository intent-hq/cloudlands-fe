import { describe, expect, it } from 'vitest';
import { localPairingEventAction } from './local-pairing-events';
import {
  localPairingCodeChanged,
  localPairingCredentialChanged,
  localPairingCredentialRevoked,
} from './local-pairing-slice';
import {
  parseLocalPairingCode,
  parseLocalPairingCredentials,
  sortLocalPairingCredentials,
} from './local-pairing-types';

const CODE = {
  codeId: 'code-1',
  state: 'active',
  createdAt: '2026-11-12T10:00:00Z',
  expiresAt: '2026-11-12T10:10:00Z',
  attemptsRemaining: 5,
};

const CREDENTIAL = {
  credentialId: 'cred-1',
  appName: 'Intent Alpha',
  createdAt: '2026-11-12T10:01:00Z',
  lastUsedAt: '2026-11-12T10:02:00Z',
  connected: true,
};

describe('parseLocalPairingCode', () => {
  it('accepts the contract shape and keeps only fields valid for the state', () => {
    expect(parseLocalPairingCode(CODE)).toEqual(CODE);
    expect(
      parseLocalPairingCode({ ...CODE, state: 'active', cancelReason: 'user', appName: 'x' }),
    ).toEqual(CODE);
    expect(
      parseLocalPairingCode({ ...CODE, state: 'cancelled', cancelReason: 'replaced' }),
    ).toMatchObject({ state: 'cancelled', cancelReason: 'replaced' });
    expect(
      parseLocalPairingCode({ ...CODE, state: 'cancelled', cancelReason: 'tunnel-active' }),
    ).toMatchObject({ state: 'cancelled', cancelReason: 'tunnel-active' });
    expect(
      parseLocalPairingCode({
        ...CODE,
        state: 'redeemed',
        credentialId: 'cred-1',
        appName: 'Intent Alpha',
      }),
    ).toMatchObject({ credentialId: 'cred-1', appName: 'Intent Alpha' });
  });

  it('rejects malformed codes', () => {
    expect(parseLocalPairingCode(null)).toBeNull();
    expect(parseLocalPairingCode({ ...CODE, state: 'pending' })).toBeNull();
    expect(parseLocalPairingCode({ ...CODE, codeId: '' })).toBeNull();
    expect(parseLocalPairingCode({ ...CODE, expiresAt: 'soon' })).toBeNull();
    expect(parseLocalPairingCode({ ...CODE, attemptsRemaining: -1 })).toBeNull();
    expect(parseLocalPairingCode({ ...CODE, attemptsRemaining: 1.5 })).toBeNull();
  });
});

describe('credentials', () => {
  it('drops malformed rows and defaults optional fields', () => {
    expect(
      parseLocalPairingCredentials({
        credentials: [
          CREDENTIAL,
          { credentialId: 'x' },
          { ...CREDENTIAL, credentialId: 'cred-2', lastUsedAt: null, connected: 'yes' },
        ],
      }),
    ).toEqual([
      CREDENTIAL,
      { ...CREDENTIAL, credentialId: 'cred-2', lastUsedAt: null, connected: false },
    ]);
    expect(parseLocalPairingCredentials({})).toBeNull();
  });

  it('sorts by creation time, then id', () => {
    const later = { ...CREDENTIAL, credentialId: 'a', createdAt: '2026-11-12T11:00:00Z' };
    const tie = { ...CREDENTIAL, credentialId: 'b' };
    expect(
      sortLocalPairingCredentials([later, tie, CREDENTIAL]).map((entry) => entry.credentialId),
    ).toEqual(['b', 'cred-1', 'a']);
  });
});

describe('localPairingEventAction', () => {
  it('maps both events and ignores anything malformed', () => {
    expect(localPairingEventAction('pairing:localCode-changed', { localCode: CODE })).toEqual(
      localPairingCodeChanged(parseLocalPairingCode(CODE)!),
    );
    expect(
      localPairingEventAction('pairing:localCredentials-changed', { credential: CREDENTIAL }),
    ).toEqual(localPairingCredentialChanged(CREDENTIAL));
    expect(
      localPairingEventAction('pairing:localCredentials-changed', {
        credentialId: 'cred-1',
        revoked: true,
      }),
    ).toEqual(localPairingCredentialRevoked('cred-1'));
    expect(localPairingEventAction('pairing:localCode-changed', { localCode: {} })).toBeNull();
    expect(localPairingEventAction('pairing:localCode-changed', null)).toBeNull();
    expect(localPairingEventAction('pairing:localCredentials-changed', {})).toBeNull();
    expect(localPairingEventAction('remoteMachine:changed', { localCode: CODE })).toBeNull();
  });
});
