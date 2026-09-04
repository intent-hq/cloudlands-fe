export type SvgBounds = { x: number; y: number; width: number; height: number };

function translateOf(element: SVGGraphicsElement) {
  const matrix = element.transform.baseVal.consolidate()?.matrix;
  return matrix ? { x: matrix.e, y: matrix.f } : null;
}

function translatedBounds(element: SVGGraphicsElement): SvgBounds | null {
  const translate = translateOf(element);
  if (!translate) return null;
  const bounds = element.getBBox();
  return {
    x: translate.x + bounds.x,
    y: translate.y + bounds.y,
    width: bounds.width,
    height: bounds.height,
  };
}

function intersects(left: SvgBounds, right: SvgBounds, padding = 0) {
  return (
    left.x < right.x + right.width + padding &&
    left.x + left.width > right.x - padding &&
    left.y < right.y + right.height + padding &&
    left.y + left.height > right.y - padding
  );
}

export function separateStateLabels(svg: SVGSVGElement): SvgBounds | null {
  if (!svg.classList.contains('statediagram')) return null;
  const paths = [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')];
  const pathPoints = paths.map((path) => {
    const length = path.getTotalLength();
    const steps = Math.min(160, Math.max(12, Math.ceil(length / 4)));
    return Array.from({ length: steps + 1 }, (_, index) =>
      path.getPointAtLength((length * index) / steps),
    );
  });
  const nodeBounds = [...svg.querySelectorAll<SVGGElement>('g.node')]
    .map((node) => translatedBounds(node))
    .filter((bounds): bounds is SvgBounds => Boolean(bounds));
  const placedLabels: SvgBounds[] = [];

  [...svg.querySelectorAll<SVGGElement>('.edgeLabel')].forEach((label, index) => {
    if (!label.textContent?.trim()) return;
    const translate = translateOf(label);
    const path = paths[index];
    const points = pathPoints[index];
    if (!translate || !path || !points?.length) return;
    const localBounds = label.getBBox();
    const otherRoutePoints = pathPoints.filter((_, routeIndex) => routeIndex !== index).flat();
    const candidates = points.slice(2, -2).map((point, pointIndex) => {
      const before = points[pointIndex + 1];
      const after = points[pointIndex + 3];
      const horizontal = Math.abs(after.x - before.x) >= Math.abs(after.y - before.y);
      return {
        x: point.x - (localBounds.x + localBounds.width / 2),
        y: point.y - (localBounds.y + localBounds.height / 2),
        horizontal,
        routeIndex: pointIndex + 2,
      };
    });
    const scored = candidates.map((candidate) => {
      const bounds = {
        x: candidate.x + localBounds.x,
        y: candidate.y + localBounds.y,
        width: localBounds.width,
        height: localBounds.height,
      };
      const obstacleCollisions = [...nodeBounds, ...placedLabels].filter((obstacle) =>
        intersects(bounds, obstacle, 3),
      ).length;
      const routeCollisions = otherRoutePoints.filter(
        (point) =>
          point.x > bounds.x - 2 &&
          point.x < bounds.x + bounds.width + 2 &&
          point.y > bounds.y - 2 &&
          point.y < bounds.y + bounds.height + 2,
      ).length;
      return {
        candidate,
        bounds,
        score:
          obstacleCollisions * 100_000 +
          routeCollisions * 10_000 +
          (candidate.horizontal ? 0 : 20) +
          Math.abs(candidate.routeIndex - points.length / 2),
      };
    });
    const best = scored.sort((left, right) => left.score - right.score)[0];
    if (!best) return;
    label.setAttribute('transform', `translate(${best.candidate.x}, ${best.candidate.y})`);
    placedLabels.push(best.bounds);
  });

  if (!placedLabels.length) return null;
  const left = Math.min(...placedLabels.map((bounds) => bounds.x));
  const top = Math.min(...placedLabels.map((bounds) => bounds.y));
  const right = Math.max(...placedLabels.map((bounds) => bounds.x + bounds.width));
  const bottom = Math.max(...placedLabels.map((bounds) => bounds.y + bounds.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}
