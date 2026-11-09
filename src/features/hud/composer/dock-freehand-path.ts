/** One visual pencil path for live SVG, preview canvas and exported raster.
 * Quadratic control points stay inside the raw point hull; endpoints remain exact.
 * Stored points, reveal timing, selection bounds and blur masks are never changed. */
export function dockFreehandPath(points: readonly { x: number; y: number }[]): string {
  const first = points[0];
  if (!first) return '';
  // A single convex 1-2-1 pass damps sample jitter without moving either end.
  // Only the currently revealed points are supplied, so no future ink is read.
  const smooth = points.map((point, index) => {
    const previous = points[index - 1],
      next = points[index + 1];
    return previous && next
      ? { x: (previous.x + 2 * point.x + next.x) / 4, y: (previous.y + 2 * point.y + next.y) / 4 }
      : point;
  });
  const commands = [`M${first.x} ${first.y}`];
  for (let i = 1; i < smooth.length - 1; i++) {
    const point = smooth[i],
      next = smooth[i + 1];
    commands.push(`Q${point.x} ${point.y} ${(point.x + next.x) / 2} ${(point.y + next.y) / 2}`);
  }
  const last = points.at(-1) ?? first;
  commands.push(`L${last.x} ${last.y}`);
  return commands.join(' ');
}
