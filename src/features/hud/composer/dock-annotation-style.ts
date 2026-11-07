/** Source-pixel paint; shared by live annotation chrome and both raster outputs. */
export const DOCK_ANNOTATION_STYLE = {
  accent: '#3864D9',
  ink: '#3864D9',
  paper: '#F8FAFF',
  stroke: 1.8,
  pen: 1.9,
  badgeRadius: 7.5,
  badgeOutline: 0.85,
  badgeTextScale: 1.2,
  arrowHead: 10,
  arrowSpread: Math.PI / 7,
  halo: 'rgba(248, 250, 255, 0.88)',
  haloWidth: 1.2,
  textLineHeight: 1.4,
  fontFamily: '"Intent Annotation Hand", system-ui, sans-serif',
  badgeFontFamily: 'system-ui, sans-serif',
} as const;

/** Number placement only; never changes the annotation's stored geometry. */
export function dockAnnotationBadgeCenter(
  bounds: { x: number; y: number; w: number; h: number },
  viewport: { x: number; y: number; w: number; h: number },
  unit: number,
  radius: number,
) {
  const gap = radius + 3 * unit;
  return {
    x: Math.min(
      viewport.x + viewport.w - radius,
      Math.max(viewport.x + radius, bounds.x + bounds.w + gap),
    ),
    y: Math.min(viewport.y + viewport.h - radius, Math.max(viewport.y + radius, bounds.y - gap)),
  };
}
