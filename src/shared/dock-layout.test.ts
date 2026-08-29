import { describe, expect, it } from 'vitest';
import {
  DOCK_HOVER_CARD_WIDTH,
  DOCK_PREVIEW_GAP,
  DOCK_RAIL_WIDTH,
  DOCK_WINDOW_WIDTH,
  getDockHorizontalLayout,
} from './dock-layout';

describe('getDockHorizontalLayout', () => {
  it('preserves the full preview in the preferred window', () => {
    expect(getDockHorizontalLayout(DOCK_WINDOW_WIDTH)).toEqual({
      preview: { x: 0, width: DOCK_HOVER_CARD_WIDTH },
      rail: { x: DOCK_HOVER_CARD_WIDTH + DOCK_PREVIEW_GAP, width: DOCK_RAIL_WIDTH },
    });
  });

  it('shrinks the preview to keep the gap and rail clear on a narrow display', () => {
    const layout = getDockHorizontalLayout(300);

    expect(layout).toEqual({
      preview: { x: 0, width: 220 },
      rail: { x: 236, width: DOCK_RAIL_WIDTH },
    });
    expect(layout.preview.x + layout.preview.width + DOCK_PREVIEW_GAP).toBe(layout.rail.x);
  });

  it('keeps the minimum preview envelope inside the renderer', () => {
    const minimumWidth = DOCK_RAIL_WIDTH + DOCK_PREVIEW_GAP;

    expect(getDockHorizontalLayout(minimumWidth)).toEqual({
      preview: { x: 0, width: 0 },
      rail: { x: DOCK_PREVIEW_GAP, width: DOCK_RAIL_WIDTH },
    });
  });
});
