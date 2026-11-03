import { describe, expect, it } from 'vitest';
import { dockToolbarPosition, type DockToolbarAnchor } from './dock-annotation';

// A 1440×900 display: menu bar (25) above, macOS Dock (70) below.
const area = { x: 0, y: 25, width: 1440, height: 805 };
const bar = { width: 173, height: 38 };

describe('dockToolbarPosition', () => {
  it('keeps notch and top-pill feedback away from the top hover area', () => {
    for (const shape of ['notch', 'top-pill'] as const) {
      const dock: DockToolbarAnchor = { shape, rect: { x: 520, y: 0, width: 400, height: 60 } };
      const position = dockToolbarPosition(dock, bar, area);
      expect(position.y).toBeGreaterThan(area.y + area.height / 2);
      expect(position.y + bar.height).toBeLessThanOrEqual(area.y + area.height);
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

  it('keeps every control reachable in work areas with nonzero display origins', () => {
    for (const offset of [
      { x: -1440, y: 125 },
      { x: 1920, y: -875 },
    ]) {
      const workArea = { ...area, ...offset };
      const dock: DockToolbarAnchor = {
        shape: 'notch',
        rect: { x: offset.x + 520, y: offset.y - 25, width: 400, height: 60 },
      };
      const position = dockToolbarPosition(dock, bar, workArea);
      expect(position.x).toBeGreaterThanOrEqual(workArea.x);
      expect(position.x + bar.width).toBeLessThanOrEqual(workArea.x + workArea.width);
      expect(position.y).toBeGreaterThan(workArea.y + workArea.height / 2);
      expect(position.y + bar.height).toBeLessThanOrEqual(workArea.y + workArea.height);
    }
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
