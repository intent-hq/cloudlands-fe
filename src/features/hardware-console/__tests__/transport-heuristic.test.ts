import { describe, expect, it } from 'vitest';

import { inferTransportFromCollectionCount } from '../device/transport-heuristic';

describe('inferTransportFromCollectionCount', () => {
  it('maps the USB enumeration (6 granted collections) to usb', () => {
    expect(inferTransportFromCollectionCount(6)).toBe('usb');
  });

  it('maps the Bluetooth enumeration (4 granted collections) to bluetooth', () => {
    expect(inferTransportFromCollectionCount(4)).toBe('bluetooth');
  });

  it('returns unknown for zero collections', () => {
    expect(inferTransportFromCollectionCount(0)).toBe('unknown');
  });
});
