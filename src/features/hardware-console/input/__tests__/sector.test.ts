import { describe, expect, it } from 'vitest';

import { angleToSector, clampDistance, deviceAngleToScreenTurn, normalizeAngle } from '../sector';

describe('normalizeAngle', () => {
  it('passes through values already in [0, 1)', () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(0.25)).toBe(0.25);
    expect(normalizeAngle(0.999)).toBe(0.999);
  });

  it('wraps values >= 1 and negatives', () => {
    expect(normalizeAngle(1)).toBe(0);
    expect(normalizeAngle(1.25)).toBeCloseTo(0.25);
    expect(normalizeAngle(-0.25)).toBeCloseTo(0.75);
    expect(normalizeAngle(-2.5)).toBeCloseTo(0.5);
  });

  it('maps non-finite input to 0', () => {
    expect(normalizeAngle(Number.NaN)).toBe(0);
    expect(normalizeAngle(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('clampDistance', () => {
  it('clamps into [0, 1]', () => {
    expect(clampDistance(-0.1)).toBe(0);
    expect(clampDistance(0)).toBe(0);
    expect(clampDistance(0.5)).toBe(0.5);
    expect(clampDistance(1)).toBe(1);
    expect(clampDistance(1.7)).toBe(1);
  });

  it('maps non-finite input to 0', () => {
    expect(clampDistance(Number.NaN)).toBe(0);
  });
});

describe('angleToSector', () => {
  it('divides the circle into equal sectors', () => {
    expect(angleToSector(0, 8)).toBe(0);
    expect(angleToSector(0.124, 8)).toBe(0);
    expect(angleToSector(0.125, 8)).toBe(1);
    expect(angleToSector(0.5, 8)).toBe(4);
    expect(angleToSector(0.99, 8)).toBe(7);
  });

  it('handles arbitrary sector counts', () => {
    expect(angleToSector(0.763528, 6)).toBe(4);
    expect(angleToSector(0.763528, 3)).toBe(2);
    expect(angleToSector(0.2, 1)).toBe(0);
  });

  it('applies the sector offset before slicing', () => {
    expect(angleToSector(0.1, 4, 0.1)).toBe(0);
    expect(angleToSector(0.05, 4, 0.1)).toBe(3);
    expect(angleToSector(0.35, 4, 0.1)).toBe(1);
  });

  it('wraps out-of-range angles', () => {
    expect(angleToSector(1.25, 4)).toBe(1);
    expect(angleToSector(-0.25, 4)).toBe(3);
  });

  it('wraps to sector 0 when rounding lands within epsilon of a full turn', () => {
    expect(angleToSector(0.9999999999999999, 8)).toBe(0);
    expect(angleToSector(0.999999, 8)).toBe(7);
  });

  it('lands exact-boundary samples in the intended sector despite offset float error', () => {
    // 0.35 - 0.1 = 0.24999999999999997 without epsilon correction.
    expect(angleToSector(0.35, 4, 0.1)).toBe(1);
  });

  it('rejects invalid sector counts', () => {
    expect(() => angleToSector(0.5, 0)).toThrow(RangeError);
    expect(() => angleToSector(0.5, 2.5)).toThrow(RangeError);
    expect(() => angleToSector(0.5, -1)).toThrow(RangeError);
  });
});

describe('deviceAngleToScreenTurn', () => {
  // Device convention (vendor Input app renders the stick at
  // (cos 2πa, sin 2πa) in y-down screen coordinates): a=0 points right and
  // increases clockwise. Screen turns are clockwise from 12 o'clock.
  it.each([
    { device: 0, turn: 0.25, direction: 'right (3 o’clock)' },
    { device: 0.25, turn: 0.5, direction: 'down (6 o’clock)' },
    { device: 0.5, turn: 0.75, direction: 'left (9 o’clock)' },
    { device: 0.75, turn: 0, direction: 'up (12 o’clock)' },
  ])('maps device angle $device to screen turn $turn ($direction)', ({ device, turn }) => {
    expect(deviceAngleToScreenTurn(device)).toBeCloseTo(turn, 12);
  });

  it('wraps out-of-range device angles', () => {
    expect(deviceAngleToScreenTurn(1.5)).toBeCloseTo(0.75);
    expect(deviceAngleToScreenTurn(-0.25)).toBeCloseTo(0);
  });
});
