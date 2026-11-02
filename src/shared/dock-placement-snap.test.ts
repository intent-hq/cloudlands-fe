import { describe, expect, it } from 'vitest';
import {
  dockPlacementFailureFor,
  findDockSnapTarget,
  resolveDockSidePanelSurface,
  type DockDisplayGeometry,
} from './dock-placement';

// A display left of and above the primary, with a 32px menu bar and no notch.
const display: DockDisplayGeometry = {
  id: 7,
  bounds: { x: -1920, y: -1080, width: 1920, height: 1080 },
  workArea: { x: -1920, y: -1048, width: 1920, height: 1000 },
  cutout: null,
};
const centerX = -1920 + 960;

describe('findDockSnapTarget top zone', () => {
  it('snaps to the top pill when a drag reaches the screen top edge on a display without a notch', () => {
    expect(findDockSnapTarget({ x: centerX, y: -1078 }, display, null)).toEqual({
      kind: 'notch',
      displayId: 7,
    });
  });

  it('still leaves the middle of the screen free', () => {
    expect(findDockSnapTarget({ x: centerX, y: -500 }, display, null)).toBeNull();
  });

  it('keeps the notch zone of a display with a camera cutout unchanged', () => {
    const notched = { ...display, cutout: { x: centerX - 90, y: -1080, width: 180, height: 32 } };
    expect(findDockSnapTarget({ x: centerX, y: -1078 }, notched, null)).toEqual({
      kind: 'notch',
      displayId: 7,
    });
    expect(findDockSnapTarget({ x: centerX, y: -1080 + 32 + 25 }, notched, null)).toBeNull();
  });
});

describe('dockPlacementFailureFor', () => {
  it('names a rejected command by what the user was doing', () => {
    for (const action of ['resize', 'begin-resize', 'end-resize', 'cancel-resize'])
      expect(dockPlacementFailureFor({ action })).toBe('resize');
    for (const action of ['move', 'begin-drag', 'drag', 'end-drag', 'cancel-drag', 'dismiss'])
      expect(dockPlacementFailureFor({ action })).toBe('move');
    expect(dockPlacementFailureFor({ action: 'something-else' })).toBe('update');
  });
});

describe('resolveDockSidePanelSurface vertical anchor', () => {
  // A right rail 260 tall in the middle of the work area (-1048..-48).
  const rail = { x: -40, y: -700, width: 40, height: 260 };
  const size = { width: 400, height: 300 };
  it('centres on the rail without an anchor (unchanged), and on the entry with one', () => {
    expect(resolveDockSidePanelSurface(rail, display, size, 'right')!.y).toBe(-700 + 130 - 150);
    // An entry 40 below the rail top: the box is centred on it.
    expect(resolveDockSidePanelSurface(rail, display, size, 'right', 40)!.y).toBe(-700 + 40 - 150);
  });
  it('clamps inside the work area with the 8 px inset, and falls back when it cannot fit', () => {
    const high = { ...rail, y: -1040 };
    expect(resolveDockSidePanelSurface(high, display, size, 'right', 10)!.y).toBe(-1048 + 8);
    const low = { ...rail, y: -300 };
    const bottom = resolveDockSidePanelSurface(low, display, size, 'right', 250)!;
    expect(bottom.y + bottom.height).toBe(-48 - 8);
    // Taller than the area less the insets: it uses the whole area.
    const tall = resolveDockSidePanelSurface(
      rail,
      display,
      { width: 400, height: 2000 },
      'right',
      40,
    )!;
    expect([tall.y, tall.height]).toEqual([-1048, 1000]);
  });
});
