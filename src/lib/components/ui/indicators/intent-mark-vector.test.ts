import { describe, expect, it } from 'vitest';
import { intentMarkKeyframes, pulseKeyframes } from './intent-mark-vector';

describe('cached Intent mark keyframes', () => {
  it.each(['pulse', 'bloom', 'twist'] as const)(
    'reuses immutable %s arrays and poses across repeated requests',
    (variant) => {
      const arms = Array.from({ length: 5 }, (_, index) => intentMarkKeyframes(variant, index));
      expect(new Set(arms).size).toBe(5);
      for (let index = 0; index < arms.length; index++) {
        const frames = arms[index];
        expect(intentMarkKeyframes(variant, index)).toBe(frames);
        expect(Reflect.set(frames, '0', {})).toBe(false);
        expect(Reflect.set(frames, 'length', 0)).toBe(false);
        expect(frames.every((frame) => Object.isFrozen(frame))).toBe(true);
      }
    },
  );

  it('shares Pulse geometry between the neutral render and playback', () => {
    expect(pulseKeyframes(0)).toBe(intentMarkKeyframes('pulse', 0));
  });

  it.each([-1, 5, 100, 0.5, NaN, Infinity])(
    'rejects invalid arm %s without growing the cache',
    (index) => {
      expect(() => intentMarkKeyframes('bloom', index)).toThrow(RangeError);
    },
  );
});
