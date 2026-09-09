export interface MapViewport {
  width: number;
  height: number;
}

export interface MapTransform {
  x: number;
  y: number;
  scale: number;
}

export interface MinimapRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MINIMAP_WIDTH = 160;
const MINIMAP_HEIGHT = 100;
const MINIMAP_MARGIN = 16;
const TRANSFORM_EPSILON = 0.01;

function overlaps(
  left: MinimapRect,
  right: { left: number; top: number; right: number; bottom: number },
): boolean {
  return !(
    left.x + left.width <= right.left ||
    left.x >= right.right ||
    left.y + left.height <= right.top ||
    left.y >= right.bottom
  );
}

export function resolveMinimapRect(
  viewport: MapViewport,
  transform: MapTransform,
  focusedHull?: [number, number][],
): MinimapRect | null {
  const moved =
    Math.abs(transform.scale - 1) > TRANSFORM_EPSILON ||
    Math.abs(transform.x) > TRANSFORM_EPSILON ||
    Math.abs(transform.y) > TRANSFORM_EPSILON;
  if (viewport.width < 768 || viewport.height < 240 || !moved) return null;

  const right = viewport.width - MINIMAP_WIDTH - MINIMAP_MARGIN;
  const bottom = viewport.height - MINIMAP_HEIGHT - MINIMAP_MARGIN;
  const candidates = [
    { x: right, y: bottom, width: MINIMAP_WIDTH, height: MINIMAP_HEIGHT },
    { x: MINIMAP_MARGIN, y: bottom, width: MINIMAP_WIDTH, height: MINIMAP_HEIGHT },
    { x: right, y: MINIMAP_MARGIN, width: MINIMAP_WIDTH, height: MINIMAP_HEIGHT },
    { x: MINIMAP_MARGIN, y: MINIMAP_MARGIN, width: MINIMAP_WIDTH, height: MINIMAP_HEIGHT },
  ];
  if (!focusedHull?.length) return candidates[0];

  const xs = focusedHull.map(([x]) => x * transform.scale + transform.x);
  const ys = focusedHull.map(([, y]) => y * transform.scale + transform.y);
  const focusBounds = {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
  return candidates.find((candidate) => !overlaps(candidate, focusBounds)) ?? null;
}

export function jumpToMinimapPoint(
  viewport: MapViewport,
  transform: MapTransform,
  minimap: MinimapRect,
  point: { x: number; y: number },
): MapTransform {
  const ratioX = Math.max(0, Math.min(1, (point.x - minimap.x) / minimap.width));
  const ratioY = Math.max(0, Math.min(1, (point.y - minimap.y) / minimap.height));
  return {
    x: viewport.width / 2 - ratioX * viewport.width * transform.scale,
    y: viewport.height / 2 - ratioY * viewport.height * transform.scale,
    scale: transform.scale,
  };
}
