/**
 * Layout pieces the notch intro relies on, and the pure helpers lifted out of
 * AdaptiveDockShell: the intro card adds its fixed height to the open overview
 * only; the compact wing width and the drag-end command are unchanged.
 */
import { describe, expect, it } from 'vitest';
import type { DockPlacementSnapshot } from '$shared/dock-placement';
import {
  DOCK_INTRO_HEIGHT,
  dockCompactWingWidth,
  dockDragEndCommand,
  getDockShellLayout,
} from './dock-shell-geometry';

const placement = {
  phase: 'idle',
  shape: 'top-pill',
  placement: { kind: 'notch' },
  cutout: null,
  surface: { x: 0, y: 0, width: 480, height: 600 },
} as unknown as DockPlacementSnapshot;
const input = {
  surfaceExpanded: true,
  reveal: 1,
  rowLimit: 5,
  workspaceCount: 2,
  compactWingWidth: 40,
  hasFeedback: false,
};

describe('getDockShellLayout with the intro', () => {
  it('adds the intro card height to the open overview only', () => {
    const plain = getDockShellLayout(placement, input).desiredHeight;
    expect(getDockShellLayout(placement, { ...input, intro: true }).desiredHeight).toBe(
      plain + DOCK_INTRO_HEIGHT,
    );
    const closed = { ...input, surfaceExpanded: false };
    expect(getDockShellLayout(placement, { ...closed, intro: true }).desiredHeight).toBe(
      getDockShellLayout(placement, closed).desiredHeight,
    );
  });
});

describe('lifted shell helpers', () => {
  it('keeps the compact wing width formula', () => {
    expect([0, 1, 2, 3].map(dockCompactWingWidth)).toEqual([16, 28, 46, 64]);
  });

  it('builds end and cancel drag commands', () => {
    expect(
      dockDragEndCommand('t', { action: 'end-drag', releasePoint: { x: 3, y: 4 } }, 7),
    ).toEqual({ action: 'end-drag', token: 't', sequence: 7, releasePoint: { x: 3, y: 4 } });
    expect(dockDragEndCommand('t', { action: 'cancel-drag' }, 8)).toEqual({
      action: 'cancel-drag',
      token: 't',
      sequence: 8,
    });
  });
});

describe('compact recording geometry', () => {
  const edge = {
    ...placement,
    shape: 'edge',
    placement: { kind: 'edge', displayId: 1, side: 'left', along: 0 },
    surface: { x: 0, y: 0, width: 40, height: 144 },
  } as DockPlacementSnapshot;
  it('reserves a 104px recording header without changing the ordinary 40px edge header', () => {
    const compact = { ...input, surfaceExpanded: false, reveal: 0, workspaceCount: 0 };
    const normal = getDockShellLayout(edge, compact),
      recording = getDockShellLayout(edge, { ...compact, recording: true });
    expect(normal.headerHeight).toBe(40);
    expect(recording.headerHeight).toBe(104);
    expect(recording.desiredHeight - normal.desiredHeight).toBe(64);
    expect(recording.compactWidth).toBe(40);
  });
  it('fits the recording header, gap and Assistant row in the minimum edge surface', () => {
    const layout = getDockShellLayout(edge, {
      ...input,
      surfaceExpanded: false,
      reveal: 0,
      workspaceCount: 0,
      recording: true,
    });
    expect(layout.headerHeight + 8 + 32).toBe(layout.desiredHeight);
    expect(layout.shown.height).toBe(144);
    expect(layout.shown.height).toBeGreaterThanOrEqual(layout.headerHeight + 8 + 32);
  });
  it('keeps floating height and the hardware cutout unchanged while reserving recording wing space', () => {
    const floating = {
      ...placement,
      shape: 'floating',
      placement: { kind: 'floating', displayId: 1, x: 0.5, y: 0.5 },
    } as DockPlacementSnapshot;
    expect(
      getDockShellLayout(floating, { ...input, surfaceExpanded: false, reveal: 0, recording: true })
        .headerHeight,
    ).toBe(40);
    const notch = {
      ...placement,
      shape: 'notch',
      cutout: { x: 140, y: 0, width: 200, height: 32 },
    } as DockPlacementSnapshot;
    const layout = getDockShellLayout(notch, {
      ...input,
      surfaceExpanded: false,
      reveal: 0,
      recording: true,
      compactWingWidth: 120,
    });
    expect(layout.compactWidth).toBe(200 + 2 * 120);
    expect(layout.shown.width).toBeLessThanOrEqual(notch.surface.width);
    expect(layout.headerHeight).toBe(32);
  });
});
