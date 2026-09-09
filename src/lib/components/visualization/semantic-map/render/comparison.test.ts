import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { getAgentColorsWithSeed } from '$lib/utils/agent-colors';
import {
  comparisonTextColor,
  drawComparisonRoutes,
  drawSharedRegionHighlight,
  SHARED_REGION_FILL_ALPHA,
} from './comparison';
import type { AgentBadge, RouteEdge } from './types';

function rgb(hex: string): number[] {
  return hex.match(/[0-9a-f]{2}/gi)?.map((value) => parseInt(value, 16)) ?? [];
}

function contrastRatio(first: number[], second: number[]): number {
  const luminance = (channels: number[]) =>
    channels
      .map((channel) => channel / 255)
      .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
      .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const values = [luminance(first), luminance(second)].sort((left, right) => right - left);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function themeRgb(mode: 'light' | 'dark', role: string): number[] {
  const css = readFileSync(resolve(process.cwd(), 'src/lib/styles/tokens.css'), 'utf8');
  const match = css.match(
    new RegExp(`--theme-${mode}-${role}:\\s*([\\d.]+) ([\\d.]+)% ([\\d.]+)%;`),
  );
  if (!match) throw new Error(`Missing ${mode} ${role} token`);
  const [hue, saturation, lightness] = match.slice(1).map(Number);
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const offset = l - chroma / 2;
  const channels =
    hue < 60
      ? [chroma, x, 0]
      : hue < 120
        ? [x, chroma, 0]
        : hue < 180
          ? [0, chroma, x]
          : hue < 240
            ? [0, x, chroma]
            : hue < 300
              ? [x, 0, chroma]
              : [chroma, 0, x];
  return channels.map((channel) => (channel + offset) * 255);
}

function badge(id: string, color: string): AgentBadge {
  return { id, color, name: id, kind: 'edit', x: 0, y: 0, thinking: false };
}

describe('comparison rendering', () => {
  it('emits a blended shared fill, then a solid contrast halo and agent strokes', () => {
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

    drawSharedRegionHighlight(
      context,
      undefined,
      [badge('mina', '#11aa77'), badge('quinn', '#7755cc')],
      new Set(['mina', 'quinn']),
      2,
      '#000000',
      true,
    );

    expect(fills).toEqual([
      ['#11aa77', SHARED_REGION_FILL_ALPHA],
      ['#7755cc', SHARED_REGION_FILL_ALPHA],
    ]);
    expect(strokes).toEqual([
      ['#000000', 4],
      ['#11aa77', 3],
      ['#7755cc', 1.5],
    ]);
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
    drawSharedRegionHighlight(
      context,
      undefined,
      [badge('mina', '#11aa77'), badge('quinn', '#7755cc')],
      new Set(['mina', 'quinn']),
      1,
      '#000000',
      false,
    );
    expect(context.fill).not.toHaveBeenCalled();
  });

  it.each(['light', 'dark'] as const)(
    'uses a non-text halo with 3:1 contrast and readable badge initials in %s mode',
    (mode) => {
      const background = themeRgb(mode, 'background');
      const foreground = themeRgb(mode, 'foreground');
      const effectiveHalo = foreground.map(
        (channel, index) => channel * 0.62 + background[index] * 0.38,
      );
      expect(contrastRatio(effectiveHalo, background)).toBeGreaterThanOrEqual(3);
      for (const id of ['agent-daemon', 'agent-renderer']) {
        const color = getAgentColorsWithSeed(id, mode === 'dark')[0];
        expect(contrastRatio(rgb(comparisonTextColor(color)), rgb(color))).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    },
  );

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
