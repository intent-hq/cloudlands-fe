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
