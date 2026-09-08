import { describe, expect, it } from 'vitest';

import { isPairingUri, parsePairingUri } from '../pairing-uri';

// The canonical shape from PROTOCOL §5 `pairing.getInfo`:
// intent://pair?v=1&host=<ip[,ip...]>&port=<p>&fp=<sha256>&token=<t>[&tc=<addr>]
const FULL_URI =
  'intent://pair?v=1&host=192.168.1.10,10.0.0.5&port=5181&fp=AA%3ABB%3ACC&token=abab12&tc=tc7f2a91.tailcat.net';

describe('isPairingUri', () => {
  it('recognizes pairing URIs (case-insensitive, surrounding whitespace)', () => {
    expect(isPairingUri(FULL_URI)).toBe(true);
    expect(isPairingUri('  INTENT://PAIR?token=x  ')).toBe(true);
  });

  it('rejects other text', () => {
    expect(isPairingUri('my-host.local')).toBe(false);
    expect(isPairingUri('intent://open?id=ws_1')).toBe(false);
    expect(isPairingUri('https://example.com')).toBe(false);
  });

  it('rejects undefined actions that merely start with "pair"', () => {
    expect(isPairingUri('intent://pairing?v=1&host=h&port=5181&fp=AA&token=t')).toBe(false);
    expect(isPairingUri('intent://paired?token=t')).toBe(false);
  });

  it('accepts exact-action variants (bare, query, path, fragment)', () => {
    expect(isPairingUri('intent://pair')).toBe(true);
    expect(isPairingUri('intent://pair?token=t')).toBe(true);
    expect(isPairingUri('intent://pair/?token=t')).toBe(true);
    expect(isPairingUri('intent://pair#x')).toBe(true);
    expect(isPairingUri('INTENT://PAIR?token=t')).toBe(true);
  });
});

describe('parsePairingUri', () => {
  it('parses every component field including the tc= tunnel address', () => {
    expect(parsePairingUri(FULL_URI)).toEqual({
      hosts: ['192.168.1.10', '10.0.0.5'],
      port: 5181,
      fingerprint: 'AA:BB:CC',
      token: 'abab12',
      tcAddress: 'tc7f2a91.tailcat.net',
    });
  });

  it('returns null tcAddress when the tc= param is absent (older daemon / tunnel down)', () => {
    const parsed = parsePairingUri('intent://pair?v=1&host=192.168.1.10&port=5181&token=t1');
    expect(parsed).not.toBeNull();
    expect(parsed?.tcAddress).toBeNull();
    expect(parsed?.hosts).toEqual(['192.168.1.10']);
    expect(parsed?.port).toBe(5181);
  });

  it('accepts the legacy certFingerprint= spelling', () => {
    const parsed = parsePairingUri(
      'intent://pair?token=t&host=h&port=5181&certFingerprint=DD%3AEE',
    );
    expect(parsed?.fingerprint).toBe('DD:EE');
  });

  it('ignores unknown query params (additive-param tolerance)', () => {
    const parsed = parsePairingUri('intent://pair?token=t&host=h&port=5181&future=1&v=9');
    expect(parsed?.token).toBe('t');
    expect(parsed?.hosts).toEqual(['h']);
  });

  it('nulls invalid ports and empty fields instead of failing the parse', () => {
    const parsed = parsePairingUri('intent://pair?host=&port=99999&token=&tc=%20');
    expect(parsed).toEqual({
      hosts: [],
      port: null,
      fingerprint: null,
      token: null,
      tcAddress: null,
    });
  });

  it('returns null for non-pairing text', () => {
    expect(parsePairingUri('my-host.local')).toBeNull();
    expect(parsePairingUri('intent://open?id=ws_1')).toBeNull();
  });
});
