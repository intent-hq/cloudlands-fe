import { describe, expect, it } from 'vitest';
import { dockToolbarPosition, type DockToolbarAnchor } from './dock-annotation';

// A 1440×900 display: menu bar (25) above, macOS Dock (70) below.
const area = { x: 0, y: 25, width: 1440, height: 805 };
const bar = { width: 173, height: 38 };

describe('dockToolbarPosition', () => {
  it('sits 8 px below a notch or top pill, centred on it', () => {
    for (const shape of ['notch', 'top-pill'] as const) {
      const dock: DockToolbarAnchor = { shape, rect: { x: 520, y: 0, width: 400, height: 60 } };
      expect(dockToolbarPosition(dock, bar, area)).toEqual({
        x: Math.round(520 + (400 - 173) / 2),
        y: 68,
      });
    }
  });

  it('sits beside an edge rail on the screen-inner side, vertically centred', () => {
    const rect = { y: 200, width: 56, height: 400 };
    expect(
      dockToolbarPosition({ shape: 'edge', side: 'left', rect: { ...rect, x: 0 } }, bar, area),
    ).toEqual({ x: 64, y: 381 });
    expect(
      dockToolbarPosition({ shape: 'edge', side: 'right', rect: { ...rect, x: 1384 } }, bar, area),
    ).toEqual({ x: 1384 - 8 - 173, y: 381 });
  });

  it('sits below a floating dock when it fits, else above it', () => {
    const below = { shape: 'floating' as const, rect: { x: 600, y: 300, width: 240, height: 200 } };
    expect(dockToolbarPosition(below, bar, area)).toEqual({ x: 634, y: 508 });
    const low = { shape: 'floating' as const, rect: { x: 600, y: 600, width: 240, height: 200 } };
    expect(dockToolbarPosition(low, bar, area)).toEqual({ x: 634, y: 600 - 8 - 38 });
  });

  it('stays inside the work area', () => {
    // A rail too close to the right edge for the bar beside it: clamped into the work area.
    const dock = {
      shape: 'edge' as const,
      side: 'left' as const,
      rect: { x: 1300, y: 0, width: 140, height: 40 },
    };
    expect(dockToolbarPosition(dock, bar, area)).toEqual({ x: 1440 - 173, y: 25 });
  });

  it('falls back to the bottom centre of the work area with no dock bounds', () => {
    expect(dockToolbarPosition(null, bar, area)).toEqual({
      x: Math.round((1440 - 173) / 2),
      y: 25 + 805 - 38 - 16,
    });
  });
});
