import { describe, expect, it } from 'vitest';
import { isHostMembershipChange, parsePrincipalSnapshot } from './principal';

const principal = {
  id: 'person',
  login: null,
  displayName: null,
  avatarUrl: null,
  isAdministrator: false,
  hostRole: 'member',
  hostMembershipRevision: 2,
};

describe('principal discovery wire contract', () => {
  it.each([undefined, false, true, 0, 1, 2, '1', null])(
    'admits full-instance setup only for exact server gitlabCheckout 1 (%j)',
    (flag) => {
      const snapshot = parsePrincipalSnapshot(
        { capabilities: { gitlabCheckout: 1 }, server: { capabilities: { gitlabCheckout: flag } } },
        principal,
      );
      expect(snapshot?.capabilities.gitlabCheckout).toBe(flag === 1);
    },
  );
  it('preserves simultaneous submission and invitation capabilities', () => {
    const snapshot = parsePrincipalSnapshot(
      { server: { capabilities: { submissionCorrelation: 1, invitationAccountSearch: 1 } } },
      principal,
    );
    expect(snapshot?.capabilities).toMatchObject({
      submissionCorrelation: 1,
      invitationAccountSearch: true,
    });
  });
  it.each([undefined, false, true, 0, 2, '1', null, {}])(
    'requires exact integer capability 1, not %j',
    (flag) => {
      const snapshot = parsePrincipalSnapshot(
        {
          capabilities: { hostMembership: 1 },
          server: { capabilities: { hostMembership: flag, personalPairing: 1 } },
        },
        principal,
      );
      expect(snapshot?.capabilities.hostMembership).toBe(false);
      expect(snapshot?.capabilities.personalPairing).toBe(true);
    },
  );
  it.each([undefined, false, true, 0, 1, 2, '1', null, {}])(
    'enables submission correlation only for exact server capability 1 (%j)',
    (flag) => {
      const snapshot = parsePrincipalSnapshot(
        {
          capabilities: { submissionCorrelation: 1 },
          server: { capabilities: { submissionCorrelation: flag } },
        },
        principal,
      );
      expect(snapshot?.capabilities.submissionCorrelation).toBe(flag === 1 ? 1 : undefined);
    },
  );
  it.each([undefined, 'owner', -1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects malformed advertised revision %s',
    (value) => {
      expect(
        parsePrincipalSnapshot(
          { server: { capabilities: { hostMembership: 1 } } },
          { ...principal, hostMembershipRevision: value },
        ),
      ).toBe(null);
    },
  );
  it('accepts unlinked profiles and provider-aware identity without deriving authority from them', () => {
    const hello = { server: { capabilities: { hostMembership: 1 } } };
    expect(parsePrincipalSnapshot(hello, principal)?.principal).toEqual(principal);
    const identity = { provider: 'gitlab', host: 'gitlab.example:443', externalUserId: '123' };
    expect(parsePrincipalSnapshot(hello, { ...principal, identity })?.principal.identity).toEqual(
      identity,
    );
    expect(
      parsePrincipalSnapshot(hello, {
        ...principal,
        identity: { ...identity, externalUserId: 123 },
      }),
    ).toBe(null);
  });
  it('requires a valid admitted principal even on older daemons', () => {
    for (const value of [
      null,
      {},
      { ...principal, id: '' },
      { ...principal, isAdministrator: undefined },
      { ...principal, login: undefined },
    ]) {
      expect(parsePrincipalSnapshot({ server: {} }, value)).toBe(null);
    }
    expect(parsePrincipalSnapshot({}, principal)).toBe(null);
  });
  it('accepts only valid membership invalidations', () => {
    expect(
      isHostMembershipChange({
        revision: 1,
        action: 'removed',
        hostRole: 'guest',
        principalId: 'person',
      }),
    ).toBe(true);
    for (const change of [
      null,
      {},
      { revision: -1, action: 'added', hostRole: 'member', principalId: 'person' },
      { revision: 1, action: 'removed', hostRole: 'member', principalId: 'person' },
    ]) {
      expect(isHostMembershipChange(change)).toBe(false);
    }
  });
});

it.each([undefined, false, true, 0, 1, 2])(
  'only admits invitation account search capability value 1 (%s)',
  (flag) => {
    const snapshot = parsePrincipalSnapshot(
      { server: { capabilities: { invitationAccountSearch: flag } } },
      { id: 'owner', login: null, displayName: null, avatarUrl: null, isAdministrator: true },
    );
    expect(snapshot?.capabilities.invitationAccountSearch).toBe(flag === 1);
  },
);
