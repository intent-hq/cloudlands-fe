import { describe, expect, it } from 'vitest';
import { intentMarkPoses } from './intent-mark-poses';

describe('30fps Intent mark pose cache', () => {
  it.each(['pulse', 'bloom', 'twist'] as const)('bounds and freezes %s samples', (variant) => {
    for (let arm = 0; arm < 5; arm++) {
      const poses = intentMarkPoses(variant, arm);
      expect(poses).toHaveLength(variant === 'twist' ? 110 : 61);
      expect(intentMarkPoses(variant, arm)).toBe(poses);
      expect(Reflect.set(poses, 'length', 0)).toBe(false);
      expect(poses.every(Object.isFrozen)).toBe(true);
      expect(poses.every((pose) => !('offset' in pose) && !('easing' in pose))).toBe(true);
      expect(poses.flatMap(Object.values).every((value) => !/NaN|Infinity/.test(value))).toBe(true);
    }
  });

  it.each([-1, 5, 0.5, NaN, Infinity])('rejects invalid arm %s', (arm) => {
    expect(() => intentMarkPoses('pulse', arm)).toThrow(RangeError);
  });

  it('preserves the non-linear, asymmetric Pulse easing and final hold', () => {
    const poses = intentMarkPoses('pulse', 0);
    const x = (frame: number) => Number(poses[frame].transform.match(/translate\(([-\d.]+)/)![1]);
    const progress = (frame: number) => (x(frame) - x(0)) / (x(30) - x(0));
    // Independent properties of the original easing curves: slow departure,
    // centered outward midpoint, and an asymmetric (faster) return midpoint.
    expect(progress(7)).toBeLessThan(0.1);
    expect(progress(15)).toBeCloseTo(0.5, 5);
    expect(progress(45)).toBeLessThan(0.5);
    expect(poses[60]).toEqual(poses[0]);
  });
});
