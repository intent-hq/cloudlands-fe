import { describe, expect, it } from 'vitest';
import { cameraMotionKeyframes } from './diagram-motion';

describe('cameraMotionKeyframes', () => {
  it('moves directly between different camera transforms', () => {
    expect(cameraMotionKeyframes('matrix(1, 0, 0, 1, 0, 0)', 'matrix(1, 0, 0, 1, 20, 8)')).toEqual([
      { transform: 'matrix(1, 0, 0, 1, 0, 0)' },
      { transform: 'matrix(1, 0, 0, 1, 20, 8)' },
    ]);
  });

  it('adds a visible reframe when the camera endpoints are equal', () => {
    const keyframes = cameraMotionKeyframes(
      'matrix(1.25, 0, 0, 1.25, -318, -178)',
      'matrix(1.25, 0, 0, 1.25, -318, -178)',
    );
    expect(keyframes).toHaveLength(3);
    expect(keyframes[1]?.transform).not.toBe(keyframes[0]?.transform);
    expect(keyframes.at(-1)?.transform).toBe(keyframes[0]?.transform);
  });
});
