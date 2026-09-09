import { describe, expect, it } from 'vitest';
import { moveSpatialFocus, type SpatialTarget } from './navigation';

const targets: SpatialTarget[] = [
  { id: 'bottom', x: 100, y: 300 },
  { id: 'right', x: 300, y: 100 },
  { id: 'left', x: 100, y: 100 },
];

describe('semantic map spatial keyboard navigation', () => {
  it('starts in visual reading order instead of manifest order', () => {
    expect(moveSpatialFocus(targets, null, 'ArrowRight')).toBe('left');
    expect(moveSpatialFocus(targets, null, 'ArrowLeft')).toBe('bottom');
  });

  it('moves to the nearest target in the requested direction', () => {
    expect(moveSpatialFocus(targets, 'left', 'ArrowRight')).toBe('right');
    expect(moveSpatialFocus(targets, 'left', 'ArrowDown')).toBe('bottom');
    expect(moveSpatialFocus(targets, 'right', 'ArrowLeft')).toBe('left');
    expect(moveSpatialFocus(targets, 'bottom', 'ArrowUp')).toBe('left');
  });

  it('keeps focus when no target exists in that direction', () => {
    expect(moveSpatialFocus(targets, 'right', 'ArrowRight')).toBe('right');
  });
});
