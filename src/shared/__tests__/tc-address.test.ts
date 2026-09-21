import { describe, expect, it } from 'vitest';

import {
  TC_ADDRESS,
  TC_ADDRESS_KEY_ONLY,
  TC_ADDRESS_REGION,
} from '../../test/fixtures/tc-address.fixture';
import { isTcAddress } from '../tc-address';

describe('isTcAddress', () => {
  it.each([TC_ADDRESS_KEY_ONLY, TC_ADDRESS_REGION, TC_ADDRESS])(
    'recognizes an offline-valid Tailcat address: %s',
    (address) => {
      expect(isTcAddress(address)).toBe(true);
      expect(isTcAddress(`  ${address}\n`)).toBe(true);
    },
  );

  it.each([
    'example.com',
    '192.168.1.10',
    '::1',
    'tcp-server.local',
    'tchost',
    'tc-key-abc123',
    'tc-7f2a91',
    'tc' + 'a'.repeat(60),
    '',
    TC_ADDRESS.replace(/^tc/, 'TC'),
    TC_ADDRESS.slice(0, 20),
    TC_ADDRESS + '=',
    TC_ADDRESS + '.local',
    TC_ADDRESS.replace('_', '/'),
    TC_ADDRESS.replace('-', '+'),
    TC_ADDRESS.replace('WCD', 'WC D'),
    TC_ADDRESS + 'aaa', // Invalid unpadded base64 length (one mod four).
  ])('does not route a hostname or malformed lookalike through Tailcat: %s', (host) => {
    expect(isTcAddress(host)).toBe(false);
  });
});
