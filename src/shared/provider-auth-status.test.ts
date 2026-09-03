/**
 * `host.providerAuthStatus` contract folding (PROTOCOL §5.14): the wire
 * verdict map plus the additive protocol-9.4 `identity` object
 * (intent-hq/intentd#1685) rendered into `ProviderStatus.authDetails`.
 */
import { describe, expect, it } from 'vitest';
import { formatProviderIdentity, toAuthVerdictMap } from './provider-auth-status';

describe('formatProviderIdentity', () => {
  it('renders the email alone when no org name is present', () => {
    expect(formatProviderIdentity({ email: 'dev@example.com' })).toBe('dev@example.com');
  });

  it('joins email and org with a middle dot when the org adds signal', () => {
    expect(formatProviderIdentity({ email: 'dev@example.com', orgName: 'Example Org' })).toBe(
      'dev@example.com · Example Org',
    );
  });

  it('collapses the email-derived default org ("<email>\'s Organization") to the email', () => {
    expect(
      formatProviderIdentity({
        email: 'dev@example.com',
        orgName: "dev@example.com's Organization",
      }),
    ).toBe('dev@example.com');
    // Case and apostrophe variants of the same default still collapse.
    expect(
      formatProviderIdentity({
        email: 'Dev@Example.com',
        orgName: 'dev@example.com’s organization',
      }),
    ).toBe('Dev@Example.com');
    // An org that merely equals the email adds nothing either.
    expect(formatProviderIdentity({ email: 'dev@example.com', orgName: 'dev@example.com' })).toBe(
      'dev@example.com',
    );
  });

  it('does not collapse an org that only shares the email as a prefix', () => {
    expect(
      formatProviderIdentity({ email: 'dev@example.com', orgName: 'dev@example.com Labs' }),
    ).toBe('dev@example.com · dev@example.com Labs');
  });

  it('falls back to the org name when the email is absent', () => {
    expect(formatProviderIdentity({ orgName: 'Example Org' })).toBe('Example Org');
    expect(formatProviderIdentity({ orgName: 'Example Org', subscriptionType: 'max' })).toBe(
      'Example Org',
    );
  });

  it('yields undefined when nothing renders', () => {
    expect(formatProviderIdentity(undefined)).toBeUndefined();
    expect(formatProviderIdentity(null)).toBeUndefined();
    expect(formatProviderIdentity({})).toBeUndefined();
    expect(formatProviderIdentity({ subscriptionType: 'max' })).toBeUndefined();
    expect(formatProviderIdentity({ email: '   ', orgName: '' })).toBeUndefined();
  });
});

describe('toAuthVerdictMap', () => {
  it('folds the wire null to undefined and keeps true/false verdicts', () => {
    expect(
      toAuthVerdictMap({
        providers: [
          { id: 'pi', authenticated: true },
          { id: 'droid', authenticated: false },
          { id: 'grok', authenticated: null },
        ],
      }),
    ).toEqual({
      pi: { authenticated: true },
      droid: { authenticated: false },
      grok: { authenticated: undefined },
    });
  });

  it('renders the additive identity object into authDetails', () => {
    const map = toAuthVerdictMap({
      providers: [
        {
          id: 'claude-code',
          authenticated: true,
          identity: { email: 'dev@example.com', orgName: 'Example Org', subscriptionType: 'max' },
        },
        { id: 'codex', authenticated: true },
      ],
    });
    expect(map['claude-code']).toEqual({
      authenticated: true,
      authDetails: 'dev@example.com · Example Org',
    });
    // Pre-9.4 daemons (no identity field) degrade silently: no key at all.
    expect(map['codex']).toStrictEqual({ authenticated: true });
  });

  it('omits authDetails when the identity renders to nothing', () => {
    const map = toAuthVerdictMap({
      providers: [
        { id: 'claude-code', authenticated: true, identity: { subscriptionType: 'max' } },
      ],
    });
    expect(map['claude-code']).toStrictEqual({ authenticated: true });
  });

  it('returns an empty map for a missing response', () => {
    expect(toAuthVerdictMap(undefined)).toEqual({});
    expect(toAuthVerdictMap(null)).toEqual({});
  });
});
