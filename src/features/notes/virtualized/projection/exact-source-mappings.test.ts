import { describe, expect, it, vi } from 'vitest';
import { SourceProjection } from './source-projection';
import { canBatchExactSourceMappings, verifyExactSourceMappings } from './exact-source-mappings';

const point = (pm: number, source: number, affinity: -1 | 1 = 1) => ({ pm, source, affinity });

describe('fresh exact source mapping phases', () => {
  it.each([256, 1024, 2050, 4096])('avoids per-scalar inverse scans at %i units', (length) => {
    const p = new SourceProjection('a'.repeat(length), 17);
    const points = Array.from({ length: length + 1 }, (_, i) => point(i + 1, i + 17));
    // Observe the old full-map iterator, without replacing mapping methods or
    // redefining what the verifier recognizes as canonical dispatch.
    const iterator = vi.spyOn(Map.prototype, Symbol.iterator);
    let valid: boolean;
    let scans: number;
    try {
      valid = verifyExactSourceMappings(p, points, 32768);
      scans = iterator.mock.calls.length;
    } finally {
      iterator.mockRestore();
    }
    expect(valid).toBe(true);
    expect(scans).toBe(0);
  });

  it('preserves insertion-order first/last exact ties, not min/max PM', () => {
    const p = new SourceProjection('abc');
    p.positions.clear();
    p.ends.clear();
    p.positions.set(9, 42).set(2, 42).set(7, 42);
    expect(verifyExactSourceMappings(p, [point(9, 42, -1), point(7, 42, 1)], 64)).toBe(true);
    expect(verifyExactSourceMappings(p, [point(2, 42, -1)], 64)).toBe(false);
    expect(verifyExactSourceMappings(p, [point(9, 42, 1)], 64)).toBe(false);
  });

  it('rejects nearest-only inverse correspondence', () => {
    const p = new SourceProjection('abc');
    p.positions.clear();
    p.ends.clear();
    p.boundaries.clear();
    p.positions.set(1, 8);
    p.ends.set(1, 9);
    expect(p.sourceAt(1, -1)).toBe(9);
    expect(p.pmAt(9, -1)).toBe(1);
    expect(verifyExactSourceMappings(p, [point(1, 9, -1)], 64)).toBe(false);
  });

  it('honors negative ends precedence and sees same-reference intrinsic mutations', () => {
    const p = new SourceProjection('abc', 10);
    const points = [point(2, 11, -1)];
    expect(verifyExactSourceMappings(p, points, 64)).toBe(true);
    Map.prototype.set.call(p.ends, 2, 99);
    expect(verifyExactSourceMappings(p, points, 64)).toBe(false);
    Map.prototype.set.call(p.ends, 2, 11);
    expect(verifyExactSourceMappings(p, points, 64)).toBe(true);
    Map.prototype.set.call(p.positions, 2, 99);
    expect(verifyExactSourceMappings(p, points, 64)).toBe(false);
    Map.prototype.set.call(p.positions, 2, 11);
    expect(verifyExactSourceMappings(p, points, 64)).toBe(true);
  });

  it('leaves overridden methods to the caller without invoking a deferred fallback', () => {
    const p = new SourceProjection('abc');
    const inverse = vi.spyOn(p, 'pmAt').mockReturnValue(1);
    expect(canBatchExactSourceMappings(p)).toBe(false);
    expect(verifyExactSourceMappings(p, [point(2, 1)], 64)).toBe(false);
    expect(inverse).not.toHaveBeenCalled();
  });

  it('leaves mixed projection dispatch to the caller', () => {
    const p = new SourceProjection('abc');
    const inverse = vi.fn(() => 1);
    Object.defineProperty(p, 'mixed', { value: { pmAt: inverse } });
    expect(verifyExactSourceMappings(p, [point(2, 1)], 64)).toBe(false);
    expect(canBatchExactSourceMappings(p)).toBe(false);
    expect(inverse).not.toHaveBeenCalled();
  });

  it('rejects overridden map access without invoking callbacks', () => {
    const p = new SourceProjection('abc');
    const get = vi.fn(() => 0);
    Object.defineProperty(p.positions, 'get', { value: get });
    expect(verifyExactSourceMappings(p, [point(1, 0)], 64)).toBe(false);
    expect(get).not.toHaveBeenCalled();
  });

  it('rejects executable dispatch accessors without invoking them', () => {
    const p = new SourceProjection('abc');
    const get = vi.fn(() => undefined);
    Object.defineProperty(p, 'mixed', { get });
    expect(verifyExactSourceMappings(p, [point(1, 0)], 64)).toBe(false);
    expect(get).not.toHaveBeenCalled();
  });

  it('leaves table projection dispatch to the caller', () => {
    const p = new SourceProjection('abc');
    const forward = vi.fn(() => 40),
      inverse = vi.fn(() => 9);
    Object.defineProperty(p, 'table', { value: { sourceAt: forward, pmAt: inverse } });
    expect(canBatchExactSourceMappings(p)).toBe(false);
    expect(verifyExactSourceMappings(p, [point(9, 40)], 64)).toBe(false);
    expect(forward).not.toHaveBeenCalled();
    expect(inverse).not.toHaveBeenCalled();
  });

  it('does not turn an earlier eligibility check into reusable authority', () => {
    const p = new SourceProjection('abc');
    expect(canBatchExactSourceMappings(p)).toBe(true);
    const inverse = vi.spyOn(p, 'pmAt');
    expect(verifyExactSourceMappings(p, [point(1, 0)], 64)).toBe(false);
    expect(inverse).not.toHaveBeenCalled();
  });

  it('refuses oversized phases and invalid map coordinates', () => {
    const p = new SourceProjection('abc');
    expect(verifyExactSourceMappings(p, [point(1, 0)], 0)).toBe(false);
    expect(verifyExactSourceMappings(p, [], 1)).toBe(false);
    p.positions.set(999, NaN);
    expect(verifyExactSourceMappings(p, [point(1, 0)], 64)).toBe(false);
  });
});
