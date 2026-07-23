import { describe, it, expect } from 'vitest';
import { hostnameMatchesDomain, urlMatchesAnyDomain } from '../main/mcp-host-match';

describe('hostnameMatchesDomain', () => {
  it('matches the exact domain', () => {
    expect(hostnameMatchesDomain('sentry.io', 'sentry.io')).toBe(true);
  });

  it('matches subdomains', () => {
    expect(hostnameMatchesDomain('us.sentry.io', 'sentry.io')).toBe(true);
    expect(hostnameMatchesDomain('mcp.us.sentry.io', 'sentry.io')).toBe(true);
  });

  it('rejects lookalike hosts that embed the domain as a prefix', () => {
    expect(hostnameMatchesDomain('sentry.io.evil.com', 'sentry.io')).toBe(false);
  });

  it('rejects hosts that merely end with the domain string', () => {
    expect(hostnameMatchesDomain('notsentry.io', 'sentry.io')).toBe(false);
    expect(hostnameMatchesDomain('evilsentry.io', 'sentry.io')).toBe(false);
  });
});

describe('urlMatchesAnyDomain', () => {
  const domains = ['sentry.dev', 'sentry.io'];

  it('matches exact and subdomain URLs', () => {
    expect(urlMatchesAnyDomain('https://sentry.io/mcp', domains)).toBe(true);
    expect(urlMatchesAnyDomain('https://us.sentry.io/mcp', domains)).toBe(true);
    expect(urlMatchesAnyDomain('https://mcp.sentry.dev/mcp', domains)).toBe(true);
  });

  it('rejects lookalike hosts', () => {
    expect(urlMatchesAnyDomain('https://sentry.io.evil.com/mcp', domains)).toBe(false);
    expect(urlMatchesAnyDomain('https://notsentry.io/mcp', domains)).toBe(false);
  });

  it('rejects domains appearing only in the path or query', () => {
    expect(urlMatchesAnyDomain('https://evil.com/sentry.io', domains)).toBe(false);
    expect(urlMatchesAnyDomain('https://evil.com/?host=sentry.io', domains)).toBe(false);
  });

  it('returns false for unparseable URLs', () => {
    expect(urlMatchesAnyDomain('not a url', domains)).toBe(false);
    expect(urlMatchesAnyDomain('', domains)).toBe(false);
  });
});
