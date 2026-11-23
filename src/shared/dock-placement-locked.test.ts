/**
 * Intent OS: sway places the dock at the top-left of the screen, so the dock
 * is fixed there and opens down and to the right, fully on screen.
 */
import { describe, expect, it } from 'vitest';
import {
  lockedDockPlacement,
  resolveFloatingDockGeometry,
  type DockDisplayGeometry,
} from './dock-placement';

const display: DockDisplayGeometry = {
  id: 3,
  bounds: { x: 0, y: 0, width: 1366, height: 768 },
  workArea: { x: 0, y: 0, width: 1366, height: 768 },
  cutout: null,
};

describe('lockedDockPlacement', () => {
  it('is free where the user places the dock', () => {
    expect(lockedDockPlacement(false, display.id)).toBeNull();
  });

  it('floats at the top-left of the display at the layout origin on Intent OS', () => {
    expect(lockedDockPlacement(true, display.id)).toEqual({
      kind: 'floating',
      displayId: 3,
      x: 0,
      y: 0,
    });
  });

  it('keeps an expanded dock on screen, anchored at the top-left', () => {
    const placement = lockedDockPlacement(true, display.id)!;
    for (const size of [
      { width: 68, height: 32 },
      { width: 420, height: 452 },
      { width: 2000, height: 2000 },
    ]) {
      const { surface, anchor, expansionDirection } = resolveFloatingDockGeometry(
        placement,
        display,
        size,
      );
      expect(expansionDirection).toBe('down');
      expect({ x: surface.x, y: surface.y }).toEqual({ x: 0, y: 0 });
      expect({ x: anchor.x, y: anchor.y }).toEqual({ x: 0, y: 0 });
      expect(surface.x + surface.width).toBeLessThanOrEqual(display.workArea.width);
      expect(surface.y + surface.height).toBeLessThanOrEqual(display.workArea.height);
    }
  });
});
