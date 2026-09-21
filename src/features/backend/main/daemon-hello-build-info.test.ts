import { describe, expect, it } from 'vitest';

import { daemonHelloBuildKey, extractDaemonHelloBuildInfo } from './daemon-hello-build-info';

describe('extractDaemonHelloBuildInfo', () => {
  it('extracts version and buildCommit from a PROTOCOL §5.17 hello result', () => {
    const result = extractDaemonHelloBuildInfo({
      clientId: 'client-1',
      protocolVersion: '6.7',
      server: { version: '0.42.0', buildCommit: 'abc1234' },
    });
    expect(result).toEqual({ version: '0.42.0', buildCommit: 'abc1234' });
  });

  it('returns a null buildCommit when the daemon does not report one', () => {
    expect(extractDaemonHelloBuildInfo({ server: { version: '0.42.0' } })).toEqual({
      version: '0.42.0',
      buildCommit: null,
    });
    expect(extractDaemonHelloBuildInfo({ server: { version: '0.42.0', buildCommit: '' } })).toEqual(
      { version: '0.42.0', buildCommit: null },
    );
    expect(extractDaemonHelloBuildInfo({ server: { version: '0.42.0', buildCommit: 42 } })).toEqual(
      { version: '0.42.0', buildCommit: null },
    );
  });

  it('returns null without a well-formed server.version', () => {
    expect(extractDaemonHelloBuildInfo(undefined)).toBeNull();
    expect(extractDaemonHelloBuildInfo(null)).toBeNull();
    expect(extractDaemonHelloBuildInfo('hello')).toBeNull();
    expect(extractDaemonHelloBuildInfo({})).toBeNull();
    expect(extractDaemonHelloBuildInfo({ server: null })).toBeNull();
    expect(extractDaemonHelloBuildInfo({ server: {} })).toBeNull();
    expect(extractDaemonHelloBuildInfo({ server: { version: '' } })).toBeNull();
    expect(extractDaemonHelloBuildInfo({ server: { version: 42 } })).toBeNull();
  });
});

describe('daemonHelloBuildKey', () => {
  it('differs when either the version or the commit differs', () => {
    const a = daemonHelloBuildKey({ version: '0.42.0', buildCommit: 'abc1234' });
    const b = daemonHelloBuildKey({ version: '0.42.1', buildCommit: 'abc1234' });
    const c = daemonHelloBuildKey({ version: '0.42.0', buildCommit: 'def5678' });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it('is stable for the same build identity', () => {
    expect(daemonHelloBuildKey({ version: '0.42.0', buildCommit: null })).toBe(
      daemonHelloBuildKey({ version: '0.42.0', buildCommit: null }),
    );
  });
});
