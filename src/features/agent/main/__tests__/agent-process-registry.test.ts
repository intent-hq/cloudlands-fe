import { describe, expect, it } from 'vitest';

import { computeProcessCap } from '../agent-process-registry';

const GB = 1024 ** 3;

describe('computeProcessCap', () => {
  it.each([
    // ≤8 GB → 4
    { ram: 4 * GB, expected: 4, label: '4 GB' },
    { ram: 8 * GB, expected: 4, label: '8 GB (boundary)' },

    // ≤16 GB → 8
    { ram: 12 * GB, expected: 8, label: '12 GB' },
    { ram: 16 * GB, expected: 8, label: '16 GB (boundary)' },

    // ≤32 GB → 20
    { ram: 24 * GB, expected: 20, label: '24 GB' },
    { ram: 32 * GB, expected: 20, label: '32 GB (boundary)' },

    // ≤64 GB → 30
    { ram: 48 * GB, expected: 30, label: '48 GB' },
    { ram: 64 * GB, expected: 30, label: '64 GB (boundary)' },

    // >64 GB → 100
    { ram: 128 * GB, expected: 100, label: '128 GB' },
  ])('returns $expected for $label RAM', ({ ram, expected }) => {
    expect(computeProcessCap(ram)).toBe(expected);
  });
});

