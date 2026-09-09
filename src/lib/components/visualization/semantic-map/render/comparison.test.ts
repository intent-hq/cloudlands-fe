import { describe, expect, it, vi } from 'vitest';
import {
  drawComparisonRoutes,
  drawSharedRegionHighlight,
  SHARED_REGION_FILL_ALPHA,
} from './comparison';
import type { RouteEdge } from './types';

describe('comparison rendering', () => {
  it('emits one flat neutral shared fill and stroke', () => {
    const fills: Array<[string, number]> = [];
    const strokes: Array<[string, number]> = [];
    const context = {
      fillStyle: '',
      strokeStyle: '',
      globalAlpha: 1,
      lineWidth: 1,
      save: vi.fn(),
      restore: vi.fn(),
      setLineDash: vi.fn(),
      fill() {
        fills.push([String(this.fillStyle), this.globalAlpha]);
      },
      stroke() {
        strokes.push([String(this.strokeStyle), this.lineWidth]);
      },
    } as unknown as CanvasRenderingContext2D;

    drawSharedRegionHighlight(context, undefined, 2, '#000000', true);

    expect(fills).toEqual([['#000000', SHARED_REGION_FILL_ALPHA]]);
    expect(strokes).toEqual([['#000000', 1]]);
    expect(context.setLineDash).toHaveBeenCalledWith([]);
  });

  it('keeps a pinned shared hull fill untouched', () => {
    const context = {
      save: vi.fn(),
      restore: vi.fn(),
      setLineDash: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    drawSharedRegionHighlight(context, undefined, 1, '#000000', false);
    expect(context.fill).not.toHaveBeenCalled();
  });

  it('strokes each route with the contrast halo before its stable agent color', () => {
    const strokes: string[] = [];
    const context = {
      strokeStyle: '',
      fillStyle: '',
      globalAlpha: 1,
      lineWidth: 1,
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      closePath: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      fill: vi.fn(),
      setLineDash: vi.fn(),
      stroke() {
        strokes.push(String(this.strokeStyle));
      },
    } as unknown as CanvasRenderingContext2D;
    const edge = {
      agentId: 'mina',
      transitionIndex: 0,
      color: '#11aa77',
      count: 1,
      startX: 0,
      startY: 0,
      controlX: 5,
      controlY: 5,
      endX: 10,
      endY: 10,
      arrowX: 8,
      arrowY: 8,
      arrowAngle: 0,
    } as RouteEdge;
    drawComparisonRoutes(context, [edge], {
      selection: null,
      hoveredEdgeIndex: null,
      keyboardEdgeIndex: null,
      paths: [],
      scale: 1,
      accent: '#aa00ff',
      background: '#ffffff',
      foreground: '#000000',
    });
    expect(strokes.slice(0, 3)).toEqual(['#000000', '#11aa77', '#000000']);
  });
});
