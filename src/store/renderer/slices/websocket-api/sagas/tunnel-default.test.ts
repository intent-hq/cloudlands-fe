import { describe, expect, it } from 'vitest';
import { bindIsLoopbackOnly, tunnelDefaultApplies } from './tunnel-default';

describe('bindIsLoopbackOnly', () => {
  it('accepts every loopback spelling the daemon accepts, and an unset bind', () => {
    for (const bind of [
      undefined,
      null,
      '',
      [],
      '127.0.0.1',
      ['127.0.0.1'],
      ['127.0.0.2', '::1'],
      '0:0:0:0:0:0:0:1',
      '0000:0000:0000:0000:0000:0000:0000:0001',
      '::0:1',
      '::ffff:127.0.0.1',
      '0::1',
    ])
      expect(bindIsLoopbackOnly(bind), JSON.stringify(bind)).toBe(true);
  });

  it('rejects any other network', () => {
    for (const bind of [
      '192.168.1.5',
      ['127.0.0.1', '100.101.102.103'],
      ['0.0.0.0'],
      '::',
      '::2',
      'fe80::1',
      '::ffff:192.168.1.5',
    ])
      expect(bindIsLoopbackOnly(bind), JSON.stringify(bind)).toBe(false);
  });
});

describe('tunnelDefaultApplies', () => {
  const rows = (bind: unknown, tunnel?: boolean) => [
    { path: 'server.bindAddress', value: bind },
    ...(tunnel === undefined ? [] : [{ path: 'server.tunnel.enabled', value: tunnel }]),
  ];

  it('applies to an off tunnel over a loopback-only bind', () => {
    expect(tunnelDefaultApplies(rows('127.0.0.1', false))).toBe(true);
    expect(tunnelDefaultApplies(rows(null, false))).toBe(true);
  });

  it("keeps an on or unsupported tunnel and a user's other networks", () => {
    expect(tunnelDefaultApplies(rows('127.0.0.1', true))).toBe(false);
    expect(tunnelDefaultApplies(rows('127.0.0.1'))).toBe(false);
    expect(tunnelDefaultApplies(rows(['192.168.1.5'], false))).toBe(false);
  });
});
