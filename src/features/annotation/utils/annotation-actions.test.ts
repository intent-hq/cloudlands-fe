import { describe, expect, it, vi } from 'vitest';
import {
  ANNOTATION_PALETTE,
  annotationStrokeCommands,
  annotationStrokePath,
  renderAnnotationActions,
} from './annotation-actions';

describe('annotation ink geometry', () => {
  it('smooths a bend while preserving the drawn endpoints and staying inside its hull', () => {
    const points = [
      { x: 10, y: 20 },
      { x: 50, y: 80 },
      { x: 90, y: 20 },
    ];
    const commands = annotationStrokeCommands(points);
    expect(commands[0]).toEqual({ kind: 'move', point: points[0] });
    expect(commands.at(-1)).toEqual({ kind: 'line', point: points.at(-1) });
    expect(commands.some((c) => c.kind === 'curve')).toBe(true);
    for (const command of commands) {
      expect(command.point.x).toBeGreaterThanOrEqual(10);
      expect(command.point.x).toBeLessThanOrEqual(90);
      expect(command.point.y).toBeGreaterThanOrEqual(20);
      expect(command.point.y).toBeLessThanOrEqual(80);
    }
    expect(annotationStrokePath(points)).toBe('M 10 20 Q 50 80 70 50 L 90 20');
  });

  it('handles empty and short strokes without invalid curve coordinates', () => {
    expect(annotationStrokePath([])).toBe('');
    expect(annotationStrokePath([{ x: 5, y: 7 }])).toBe('M 5 7');
    expect(
      annotationStrokePath([
        { x: 5, y: 7 },
        { x: 10, y: 14 },
      ]),
    ).toBe('M 5 7 L 10 14');
  });

  it('exports the same smoothed curve at capture resolution, with no inherited shadow', () => {
    const paints: { blur: number; color: string }[] = [];
    const canvas = {
      shadowBlur: 12,
      shadowColor: 'black',
      shadowOffsetX: 4,
      shadowOffsetY: 4,
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      roundRect: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      fillText: vi.fn(),
      stroke: vi.fn(() => paints.push({ blur: canvas.shadowBlur, color: canvas.shadowColor })),
    };
    renderAnnotationActions(
      canvas as unknown as CanvasRenderingContext2D,
      [
        {
          kind: 'stroke',
          points: [
            { x: 10, y: 20 },
            { x: 50, y: 80 },
            { x: 90, y: 20 },
          ],
        },
        { kind: 'pin', point: { x: 100, y: 50 }, number: 1, elapsedMs: 0 },
      ],
      2,
      2,
      ANNOTATION_PALETTE,
    );
    expect(canvas.moveTo).toHaveBeenCalledWith(20, 40);
    expect(canvas.quadraticCurveTo).toHaveBeenCalledWith(100, 160, 140, 100);
    expect(canvas.lineTo).toHaveBeenCalledWith(180, 40);
    expect(canvas.fillText).toHaveBeenCalledWith('1', 200, 101);
    expect(paints.every((paint) => paint.blur === 0 && paint.color === 'transparent')).toBe(true);
    expect(canvas.restore).toHaveBeenCalledOnce();
  });
});
