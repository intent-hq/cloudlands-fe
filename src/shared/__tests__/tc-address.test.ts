/**
 * isTcAddress — the shared manual-entry predicate for tailcat tunnel
 * addresses (PROTOCOL §12.3): the ConnectBackendModal uses it to re-attach a
 * hand-typed tc address, and main's captureFingerprint uses it to route the
 * capture through a tailcat forwarder.
 */
import { describe, expect, it } from 'vitest';
import { isTcAddress } from '../tc-address';

describe('isTcAddress', () => {
  it('accepts daemon-minted tc addresses', () => {
    expect(isTcAddress('tc-key-abc123')).toBe(true);
    expect(isTcAddress('tc-7f2a91')).toBe(true);
  });

  it('is whitespace- and case-tolerant (paste artifacts)', () => {
    expect(isTcAddress('  tc-key-abc123  ')).toBe(true);
    expect(isTcAddress('TC-KEY-ABC123')).toBe(true);
  });

  it('rejects hostnames, IPs, and near-misses', () => {
    expect(isTcAddress('example.com')).toBe(false);
    expect(isTcAddress('192.168.1.10')).toBe(false);
    expect(isTcAddress('tcp-server.local')).toBe(false);
    expect(isTcAddress('tchost')).toBe(false);
    expect(isTcAddress('')).toBe(false);
  });
});
