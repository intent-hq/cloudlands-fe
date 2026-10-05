type Point = { x: number; y: number };
type Rectangle = Point & { width: number; height: number; padding?: number };

/** One midpoint per free on-edge interval; work is bounded by the obstacle count. */
export function freeLabelFractions(
  start: Point,
  end: Point,
  label: { width: number; height: number },
  obstacles: readonly Rectangle[],
  turnClearance: number,
): number[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  const extent = Math.abs(dx) >= Math.abs(dy) ? label.width : label.height;
  if (length <= extent + 2 * turnClearance) return [];
  const minimum = (extent / 2 + turnClearance) / length;
  const maximum = 1 - minimum;
  const blocked: Array<[number, number]> = [];

  for (const obstacle of obstacles) {
    const padding = obstacle.padding ?? 0;
    const axes = [
      [
        start.x,
        dx,
        obstacle.x - label.width / 2 - padding,
        obstacle.x + obstacle.width + label.width / 2 + padding,
      ],
      [
        start.y,
        dy,
        obstacle.y - label.height / 2 - padding,
        obstacle.y + obstacle.height + label.height / 2 + padding,
      ],
    ];
    let low = minimum;
    let high = maximum;
    for (const [origin, delta, lower, upper] of axes) {
      if (delta === 0) {
        if (origin < lower || origin > upper) high = -1;
      } else {
        const a = (lower - origin) / delta;
        const b = (upper - origin) / delta;
        low = Math.max(low, Math.min(a, b));
        high = Math.min(high, Math.max(a, b));
      }
    }
    if (low <= high) blocked.push([low, high]);
  }

  blocked.sort((a, b) => a[0] - b[0]);
  const fractions: number[] = [];
  let cursor = minimum;
  for (const [low, high] of blocked) {
    if (low > cursor) fractions.push((cursor + low) / 2);
    cursor = Math.max(cursor, high);
  }
  if (cursor < maximum) fractions.push((cursor + maximum) / 2);
  return fractions;
}
