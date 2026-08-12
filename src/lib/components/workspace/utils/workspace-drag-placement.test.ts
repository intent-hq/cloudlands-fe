import { describe, expect, it } from 'vitest';
import { getWorkspaceDragPlacement } from './workspace-drag-placement';

const rect = { left: 100, top: 200, width: 400, height: 300 };

describe('getWorkspaceDragPlacement', () => {
  it('uses centered top and bottom zones for vertical stacking', () => {
    expect(getWorkspaceDragPlacement(300, 220, rect)).toBe('above');
    expect(getWorkspaceDragPlacement(300, 480, rect)).toBe('below');
  });

  it('uses the left and right sides for horizontal placement', () => {
    expect(getWorkspaceDragPlacement(120, 220, rect)).toBe('before');
    expect(getWorkspaceDragPlacement(480, 480, rect)).toBe('after');
    expect(getWorkspaceDragPlacement(250, 350, rect)).toBe('before');
    expect(getWorkspaceDragPlacement(350, 350, rect)).toBe('after');
  });
});
