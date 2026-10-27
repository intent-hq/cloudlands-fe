export interface AnnotationPalette {
  ink: string;
  outer: string;
  inner: string;
}

/** Capture ink is independent of the app palette and of error/status colors. */
export const ANNOTATION_PALETTE: AnnotationPalette = {
  ink: '#b9f68d',
  outer: 'rgba(23, 50, 25, 0.28)',
  inner: '#162412',
};

export const ANNOTATION_STROKE_WIDTH = 2;
export const ANNOTATION_KEYLINE_WIDTH = 3;
export const ANNOTATION_CORNER_RADIUS = 3;
export const ANNOTATION_FILL_OPACITY = 0.07;

export type Point = { x: number; y: number };
type Stroke = { kind: 'stroke'; points: Point[] };
type Pin = { kind: 'pin'; point: Point; number: number; elapsedMs: number };
export type Selection = { kind: 'selection'; origin: Point; end: Point };
type Rectangle = { kind: 'rectangle'; origin: Point; end: Point };
type Arrow = { kind: 'arrow'; origin: Point; end: Point };
export type DragAction = Stroke | Selection | Rectangle | Arrow;
export type AnnotationAction = DragAction | Pin;

type BoundedAction = Selection | Rectangle;

export function normalizedBounds(action: BoundedAction) {
  return {
    x: Math.min(action.origin.x, action.end.x),
    y: Math.min(action.origin.y, action.end.y),
    width: Math.abs(action.end.x - action.origin.x),
    height: Math.abs(action.end.y - action.origin.y),
  };
}

export function arrowHeadPoints(origin: Point, end: Point, headLength = 14) {
  const angle = Math.atan2(end.y - origin.y, end.x - origin.x);
  const spread = Math.PI / 6;
  return {
    left: {
      x: end.x - headLength * Math.cos(angle - spread),
      y: end.y - headLength * Math.sin(angle - spread),
    },
    right: {
      x: end.x - headLength * Math.cos(angle + spread),
      y: end.y - headLength * Math.sin(angle + spread),
    },
  };
}

type StrokeCommand =
  { kind: 'move' | 'line'; point: Point } | { kind: 'curve'; control: Point; point: Point };

/** Midpoint quadratics smooth pointer noise without overshooting the drawn points. */
export function annotationStrokeCommands(points: Point[]): StrokeCommand[] {
  if (!points.length) return [];
  const commands: StrokeCommand[] = [{ kind: 'move', point: points[0] }];
  for (let i = 1; i < points.length - 1; i++) {
    const current = points[i];
    const next = points[i + 1];
    commands.push({
      kind: 'curve',
      control: current,
      point: { x: (current.x + next.x) / 2, y: (current.y + next.y) / 2 },
    });
  }
  if (points.length > 1) commands.push({ kind: 'line', point: points[points.length - 1] });
  return commands;
}

export function annotationStrokePath(points: Point[]): string {
  return annotationStrokeCommands(points)
    .map((command) =>
      command.kind === 'curve'
        ? `Q ${command.control.x} ${command.control.y} ${command.point.x} ${command.point.y}`
        : `${command.kind === 'move' ? 'M' : 'L'} ${command.point.x} ${command.point.y}`,
    )
    .join(' ');
}

export function renderAnnotationActions(
  context: CanvasRenderingContext2D,
  actions: AnnotationAction[],
  scaleX: number,
  scaleY: number,
  palette: AnnotationPalette,
): void {
  const scale = Math.max(scaleX, scaleY);
  context.save();
  context.shadowColor = 'transparent';
  context.shadowBlur = 0;
  context.shadowOffsetX = 0;
  context.shadowOffsetY = 0;
  context.lineCap = 'round';
  context.lineJoin = 'round';

  const strokeWithKeyline = (fill = false): void => {
    context.lineWidth = ANNOTATION_KEYLINE_WIDTH * scale;
    context.strokeStyle = palette.outer;
    context.shadowColor = 'transparent';
    context.shadowBlur = 0;
    context.shadowOffsetX = 0;
    context.shadowOffsetY = 0;
    context.stroke();
    if (fill) {
      context.fillStyle = palette.ink;
      context.globalAlpha = ANNOTATION_FILL_OPACITY;
      context.fill();
      context.globalAlpha = 1;
    }
    context.lineWidth = ANNOTATION_STROKE_WIDTH * scale;
    context.strokeStyle = palette.ink;
    context.stroke();
  };

  for (const action of actions) {
    context.beginPath();
    if (action.kind === 'stroke') {
      if (action.points.length === 1) {
        const point = action.points[0];
        // A pen tap is still a visible mark, in both the overlay and export.
        context.moveTo(point.x * scaleX, point.y * scaleY);
        context.lineTo(point.x * scaleX + 0.01 * scale, point.y * scaleY);
      } else {
        for (const command of annotationStrokeCommands(action.points)) {
          if (command.kind === 'curve') {
            context.quadraticCurveTo(
              command.control.x * scaleX,
              command.control.y * scaleY,
              command.point.x * scaleX,
              command.point.y * scaleY,
            );
          } else if (command.kind === 'move') {
            context.moveTo(command.point.x * scaleX, command.point.y * scaleY);
          } else context.lineTo(command.point.x * scaleX, command.point.y * scaleY);
        }
      }
      if (action.points.length) strokeWithKeyline();
    } else if (action.kind === 'rectangle') {
      const bounds = normalizedBounds(action);
      const radius = Math.min(ANNOTATION_CORNER_RADIUS, bounds.width / 2, bounds.height / 2);
      context.roundRect(
        bounds.x * scaleX,
        bounds.y * scaleY,
        bounds.width * scaleX,
        bounds.height * scaleY,
        radius * scale,
      );
      strokeWithKeyline(true);
    } else if (action.kind === 'arrow') {
      const origin = { x: action.origin.x * scaleX, y: action.origin.y * scaleY };
      const end = { x: action.end.x * scaleX, y: action.end.y * scaleY };
      const head = arrowHeadPoints(origin, end, 14 * scale);
      context.moveTo(origin.x, origin.y);
      context.lineTo(end.x, end.y);
      context.moveTo(head.left.x, head.left.y);
      context.lineTo(end.x, end.y);
      context.lineTo(head.right.x, head.right.y);
      strokeWithKeyline();
    } else if (action.kind === 'pin') {
      const x = action.point.x * scaleX;
      const y = action.point.y * scaleY;
      context.arc(x, y, 12 * scale, 0, Math.PI * 2);
      context.lineWidth = 2 * scale;
      context.strokeStyle = palette.outer;
      context.stroke();
      context.fillStyle = palette.ink;
      context.fill();
      context.fillStyle = palette.inner;
      context.font = `600 ${12 * scale}px Inter, sans-serif`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(String(action.number), x, y + 0.5 * scale);
    }
  }
  context.restore();
}
