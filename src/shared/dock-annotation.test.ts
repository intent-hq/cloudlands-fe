import { describe, expect, it } from 'vitest';
import { dockStillWindowBounds, dockToolbarPosition } from './dock-annotation';

// A 1440×900 display: menu bar (25) above, macOS Dock (70) below.
const area = { x: 0, y: 25, width: 1440, height: 805 };
const bar = { width: 173, height: 38 };
const bottomCentre = { x: Math.round((1440 - 173) / 2), y: 25 + 805 - 38 - 16 };

describe('dockToolbarPosition', () => {
  it('starts at the bottom centre of the work area, wherever the dock is', () => {
    expect(dockToolbarPosition(bar, area)).toEqual(bottomCentre);
  });

  it('keeps every control reachable in work areas with nonzero display origins', () => {
    for (const offset of [
      { x: -1440, y: 125 },
      { x: 1920, y: -875 },
    ]) {
      const workArea = { ...area, ...offset };
      const position = dockToolbarPosition(bar, workArea);
      expect(position).toEqual({
        x: bottomCentre.x + offset.x,
        y: bottomCentre.y - 25 + offset.y,
      });
      expect(position.x + bar.width).toBeLessThanOrEqual(workArea.x + workArea.width);
      expect(position.y + bar.height).toBeLessThanOrEqual(workArea.y + workArea.height);
    }
  });

  it('stays inside a work area smaller than the bar', () => {
    expect(dockToolbarPosition(bar, { x: 10, y: 20, width: 100, height: 30 })).toEqual({
      x: 10,
      y: 20,
    });
  });
});

describe('dockStillWindowBounds', () => {
  const inside = (rect: { x: number; y: number; width: number; height: number }) => {
    expect(rect.x).toBeGreaterThanOrEqual(area.x);
    expect(rect.y).toBeGreaterThanOrEqual(area.y);
    expect(rect.x + rect.width).toBeLessThanOrEqual(area.x + area.width);
    expect(rect.y + rect.height).toBeLessThanOrEqual(area.y + area.height);
  };

  it('frames a full-screen Retina capture inside the work area, centred, keeping its aspect', () => {
    const bounds = dockStillWindowBounds(area, { width: 2880, height: 1800, displayScale: 2 });
    inside(bounds);
    expect(bounds.width).toBeLessThan(area.width);
    expect(bounds.height).toBeLessThan(area.height);
    const left = bounds.x - area.x;
    const right = area.x + area.width - (bounds.x + bounds.width);
    expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
    // The image area (window minus frame, zoom band and tool bar) keeps 16:10.
    expect((bounds.width - 24) / (bounds.height - 140)).toBeCloseTo(1.6, 1);
  });

  it('never enlarges a small capture past its own size; tiny ones get a usable window', () => {
    const small = dockStillWindowBounds(area, { width: 1200, height: 800, displayScale: 2 });
    expect(small).toMatchObject({ width: 624, height: 540 });
    const tiny = dockStillWindowBounds(area, { width: 40, height: 40, displayScale: 1 });
    expect(tiny.width).toBeGreaterThanOrEqual(480);
    expect(tiny.height).toBeGreaterThanOrEqual(360);
    inside(tiny);
  });

  it('follows a work area with a nonzero origin', () => {
    const offset = { ...area, x: -1440, y: 125 };
    const a = dockStillWindowBounds(area, { width: 2880, height: 1800, displayScale: 2 });
    const b = dockStillWindowBounds(offset, { width: 2880, height: 1800, displayScale: 2 });
    expect(b).toEqual({ ...a, x: a.x - 1440, y: a.y + 100 });
  });
});
