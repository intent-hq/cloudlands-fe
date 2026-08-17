import { describe, expect, it } from 'vitest';
import {
  initializePanelCanvasWidth,
  migratePanelCanvasWidth,
  resolveIntrinsicPanelCanvasWidth,
  resolveUserPanelCanvasResize,
} from './panel-layout-width-provenance';

describe('panel canvas width provenance', () => {
  it('drops stale unprovenanced legacy viewport fill during migration', () => {
    expect(migratePanelCanvasWidth(1600, undefined)).toEqual({
      canvasWidth: null,
      canvasWidthSource: null,
    });
  });

  it('preserves proven explicit widths exactly', () => {
    expect(migratePanelCanvasWidth(1600, 'explicit')).toEqual({
      canvasWidth: 1600,
      canvasWidthSource: 'explicit',
    });
  });

  it('preserves a serializable intrinsic width without marking it as a user resize', () => {
    expect(resolveIntrinsicPanelCanvasWidth(1428)).toEqual({
      canvasWidth: 1428,
      canvasWidthSource: 'intrinsic',
    });
    expect(migratePanelCanvasWidth(1428, 'intrinsic')).toEqual({
      canvasWidth: 1428,
      canvasWidthSource: 'intrinsic',
    });
  });

  it('keeps direct programmatic initialization backward compatible', () => {
    expect(initializePanelCanvasWidth(725, undefined)).toEqual({
      canvasWidth: 725,
      canvasWidthSource: 'explicit',
    });
    expect(initializePanelCanvasWidth(725, null)).toEqual({
      canvasWidth: 725,
      canvasWidthSource: null,
    });
  });

  it('marks user resizing explicit and clears provenance on intrinsic reset', () => {
    expect(resolveUserPanelCanvasResize(720, 500)).toEqual({
      canvasWidth: 720,
      canvasWidthSource: 'explicit',
    });
    expect(resolveUserPanelCanvasResize(500, 500)).toEqual({
      canvasWidth: 500,
      canvasWidthSource: 'explicit',
    });
    expect(resolveUserPanelCanvasResize(500, 500, true)).toEqual({
      canvasWidth: null,
      canvasWidthSource: null,
    });
  });
});
