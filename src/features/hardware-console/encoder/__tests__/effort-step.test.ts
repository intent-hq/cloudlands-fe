import { describe, expect, it } from 'vitest';
import { stepEncoderEffort } from '../effort-step';

describe('encoder effort stepping', () => {
  it('places Auto before the model order and clamps without wrapping', () => {
    const levels = ['none', 'low', 'ultra'];
    expect(stepEncoderEffort(null, levels, 'clockwise')).toBe('none');
    expect(stepEncoderEffort('none', levels, 'clockwise')).toBe('low');
    expect(stepEncoderEffort('low', levels, 'clockwise')).toBe('ultra');
    expect(stepEncoderEffort('ultra', levels, 'clockwise')).toBeUndefined();
    expect(stepEncoderEffort('none', levels, 'counterclockwise')).toBeNull();
    expect(stepEncoderEffort(null, levels, 'counterclockwise')).toBeUndefined();
  });
  it('clears an obsolete effort before resuming the advertised order', () => {
    expect(stepEncoderEffort('old-value', ['low', 'high'], 'clockwise')).toBeNull();
    expect(stepEncoderEffort('old-value', ['low', 'high'], 'counterclockwise')).toBeNull();
  });
  it('does not invent effort support', () => {
    expect(stepEncoderEffort(null, [], 'clockwise')).toBeUndefined();
    expect(stepEncoderEffort('high', [], 'counterclockwise')).toBeUndefined();
  });
});
