export interface SurfaceGeometry {
  width: number;
  height: number;
  x: number;
  tabWidth: number;
  topY: number;
  panelY: number;
  radius: number;
  outerRadius: number;
}

export const CUBIC_KAPPA = 0.55228475;

export function clampSurfaceGeometry(input: SurfaceGeometry): SurfaceGeometry {
  const width = Math.max(1, input.width);
  const height = Math.max(1, input.height);
  const tabWidth = Math.max(1, Math.min(input.tabWidth, width));
  const topY = Math.max(0, Math.min(input.topY, height));
  const panelY = Math.max(topY, Math.min(input.panelY, height));
  const radius = Math.max(0, Math.min(input.radius, (panelY - topY) / 2, (width - tabWidth) / 2));
  const x = Math.max(radius, Math.min(input.x, width - tabWidth - radius));
  const outerRadius = Math.max(0, Math.min(input.outerRadius, width / 2, height / 2));

  return { width, height, x, tabWidth, topY, panelY, radius, outerRadius };
}

export function makeSurfacePath(input: SurfaceGeometry): string {
  const { width: W, height: H, topY, panelY, outerRadius: outerR } = clampSurfaceGeometry(input);
  const { x, tabWidth: w, radius: r } = clampSurfaceGeometry(input);
  const left = x;
  const right = x + w;
  const K = CUBIC_KAPPA;

  return [
    `M 0 ${panelY}`,
    `H ${left - r}`,
    `C ${left - r + K * r} ${panelY}`,
    `${left} ${panelY - r + K * r}`,
    `${left} ${panelY - r}`,
    `V ${topY + r}`,
    `C ${left} ${topY + r - K * r}`,
    `${left + r - K * r} ${topY}`,
    `${left + r} ${topY}`,
    `H ${right - r}`,
    `C ${right - r + K * r} ${topY}`,
    `${right} ${topY + r - K * r}`,
    `${right} ${topY + r}`,
    `V ${panelY - r}`,
    `C ${right} ${panelY - r + K * r}`,
    `${right + r - K * r} ${panelY}`,
    `${right + r} ${panelY}`,
    `H ${W}`,
    `V ${H - outerR}`,
    `Q ${W} ${H} ${W - outerR} ${H}`,
    `H ${outerR}`,
    `Q 0 ${H} 0 ${H - outerR}`,
    'Z',
  ].join(' ');
}

export function interpolateSurfaceGeometry(
  from: SurfaceGeometry,
  to: SurfaceGeometry,
  progress: number,
): SurfaceGeometry {
  const amount = Math.max(0, Math.min(1, progress));
  const lerp = (start: number, end: number) => start + (end - start) * amount;

  return clampSurfaceGeometry({
    width: lerp(from.width, to.width),
    height: lerp(from.height, to.height),
    x: lerp(from.x, to.x),
    tabWidth: lerp(from.tabWidth, to.tabWidth),
    topY: lerp(from.topY, to.topY),
    panelY: lerp(from.panelY, to.panelY),
    radius: lerp(from.radius, to.radius),
    outerRadius: lerp(from.outerRadius, to.outerRadius),
  });
}
