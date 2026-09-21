import { describe, expect, it } from 'vitest';
import { resolveCtWorkers } from './ct-workers';

describe('resolveCtWorkers', () => {
  it('returns 1 on CI regardless of PW_WORKERS', () => {
    expect(resolveCtWorkers({ env: { CI: 'true' }, cpus: 64 })).toBe(1);
    expect(resolveCtWorkers({ env: { CI: '1', PW_WORKERS: '8' }, cpus: 64 })).toBe(1);
  });

  it('honors PW_WORKERS when it is an integer >= 1', () => {
    expect(resolveCtWorkers({ env: { PW_WORKERS: '8' }, cpus: 4 })).toBe(8);
    expect(resolveCtWorkers({ env: { PW_WORKERS: '1' }, cpus: 64 })).toBe(1);
  });

  it.each(['0', '-1', 'abc', '', ' ', '2.5', 'Infinity', '1e3'])(
    'falls back to the formula for invalid PW_WORKERS %j',
    (raw) => {
      expect(resolveCtWorkers({ env: { PW_WORKERS: raw }, cpus: 16 })).toBe(4);
      expect(resolveCtWorkers({ env: { PW_WORKERS: raw }, cpus: 4 })).toBe(1);
    },
  );

  it('falls back to the formula when PW_WORKERS overflows to a non-safe integer', () => {
    const overflowToInfinity = '9'.repeat(309);
    const beyondSafeInteger = String(Number.MAX_SAFE_INTEGER + 2);
    for (const raw of [overflowToInfinity, beyondSafeInteger]) {
      expect(resolveCtWorkers({ env: { PW_WORKERS: raw }, cpus: 16 })).toBe(4);
    }
    expect(
      resolveCtWorkers({ env: { PW_WORKERS: String(Number.MAX_SAFE_INTEGER) }, cpus: 16 }),
    ).toBe(Number.MAX_SAFE_INTEGER);
  });

  it.each([
    [1, 1],
    [4, 1],
    [7, 1],
    [8, 2],
    [11, 2],
    [12, 3],
    [15, 3],
    [16, 4],
    [64, 4],
  ])('formula: cpus=%i -> %i workers', (cpus, expected) => {
    expect(resolveCtWorkers({ env: {}, cpus })).toBe(expected);
  });
});
