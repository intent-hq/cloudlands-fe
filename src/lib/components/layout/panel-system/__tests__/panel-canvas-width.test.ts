import { describe, expect, it } from 'vitest';
import { getPanelCanvasWidths } from '../panel-canvas-width';

describe('panel canvas width', () => {
  it.each([
    // Single panel fills the viewport by default even when it exceeds the
    // preferred column width. Canvas has no lower bound so users can shrink
    // the workspace freely.
    { viewport: 1600, columns: 1, expected: { defaultWidth: 1600, minWidth: 0 } },
    // Viewport wide enough for two columns stretches to fill the viewport.
    { viewport: 1600, columns: 2, expected: { defaultWidth: 1600, minWidth: 0 } },
    // Viewport narrower than preferred: canvas overflows to preferred width
    // (horizontally scrollable in tab mode).
    { viewport: 800, columns: 2, expected: { defaultWidth: 960, minWidth: 0 } },
    // Very narrow viewport: still no floor — the user can shrink all the way.
    { viewport: 360, columns: 2, expected: { defaultWidth: 960, minWidth: 0 } },
    // Zero-viewport (pre-measurement) falls back to preferred width.
    { viewport: 0, columns: 2, expected: { defaultWidth: 960, minWidth: 0 } },
  ])(
    'sizes $columns column(s) within a $viewport px viewport',
    ({ viewport, columns, expected }) => {
      expect(getPanelCanvasWidths(viewport, columns)).toEqual(expected);
    },
  );
});
