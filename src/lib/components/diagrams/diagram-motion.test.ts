import { describe, expect, it } from 'vitest';
import { cameraMotionKeyframes, partitionSceneIds } from './diagram-motion';

describe('partitionSceneIds', () => {
  it('keeps shared identities separate from departing and entering content', () => {
    expect(partitionSceneIds(['shared', 'old'], ['shared', 'new'])).toEqual({
      shared: ['shared'],
      departing: ['old'],
      entering: ['new'],
    });
  });

  it('uses the latest scene order when a transition is retargeted', () => {
    expect(partitionSceneIds(['shared', 'interrupted'], ['new', 'shared'])).toEqual({
      shared: ['shared'],
      departing: ['interrupted'],
      entering: ['new'],
    });
  });
});

describe('cameraMotionKeyframes', () => {
  it('moves directly between different camera transforms', () => {
    expect(cameraMotionKeyframes('matrix(1, 0, 0, 1, 0, 0)', 'matrix(1, 0, 0, 1, 20, 8)')).toEqual([
      { transform: 'matrix(1, 0, 0, 1, 0, 0)' },
      { transform: 'matrix(1, 0, 0, 1, 20, 8)' },
    ]);
  });

  it('skips the camera stage when the endpoints are equal', () => {
    expect(
      cameraMotionKeyframes(
        'matrix(1.25, 0, 0, 1.25, -318, -178)',
        'matrix(1.25, 0, 0, 1.25, -318, -178)',
      ),
    ).toEqual([]);
  });
});
