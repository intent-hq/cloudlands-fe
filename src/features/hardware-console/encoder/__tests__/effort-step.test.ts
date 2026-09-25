import { describe, expect, it } from 'vitest';
import { stepEncoderEffort } from '../effort-step';

describe('encoder effort stepping', () => {
  it('places Auto before the model order and clamps without wrapping', () => {
    const levels = ['none', 'low', 'ultra'];
    expect(stepEncoderEffort(null, levels, 'cw')).toBe('none');
    expect(stepEncoderEffort('none', levels, 'cw')).toBe('low');
    expect(stepEncoderEffort('low', levels, 'cw')).toBe('ultra');
    expect(stepEncoderEffort('ultra', levels, 'cw')).toBeUndefined();
    expect(stepEncoderEffort('none', levels, 'ccw')).toBeNull();
    expect(stepEncoderEffort(null, levels, 'ccw')).toBeUndefined();
  });
  it('clears an obsolete effort before resuming the advertised order', () => {
    expect(stepEncoderEffort('old-value', ['low', 'high'], 'cw')).toBeNull();
    expect(stepEncoderEffort('old-value', ['low', 'high'], 'ccw')).toBeNull();
  });
  it('does not invent effort support', () => {
    expect(stepEncoderEffort(null, [], 'cw')).toBeUndefined();
    expect(stepEncoderEffort('high', [], 'ccw')).toBeUndefined();
  });
});
