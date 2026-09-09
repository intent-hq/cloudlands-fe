export type SpatialArrowKey = 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'ArrowUp';

export interface SpatialTarget {
  id: string;
  x: number;
  y: number;
}

const vectors: Record<SpatialArrowKey, [number, number]> = {
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
};

function readingOrder(left: SpatialTarget, right: SpatialTarget): number {
  return left.y - right.y || left.x - right.x || left.id.localeCompare(right.id);
}

export function moveSpatialFocus(
  targets: SpatialTarget[],
  currentId: string | null,
  key: SpatialArrowKey,
): string | null {
  if (targets.length === 0) return null;
  const current = targets.find(({ id }) => id === currentId);
  if (!current) {
    const ordered = [...targets].sort(readingOrder);
    return key === 'ArrowLeft' || key === 'ArrowUp' ? ordered.at(-1)!.id : ordered[0].id;
  }

  const [vectorX, vectorY] = vectors[key];
  const candidates = targets
    .filter(({ id }) => id !== current.id)
    .map((target) => {
      const dx = target.x - current.x;
      const dy = target.y - current.y;
      const forward = dx * vectorX + dy * vectorY;
      const cross = Math.abs(dx * vectorY - dy * vectorX);
      return { target, forward, score: Math.hypot(dx, dy) + cross * 2 };
    })
    .filter(({ forward }) => forward > 0)
    .sort((left, right) => left.score - right.score || left.forward - right.forward);

  return candidates[0]?.target.id ?? current.id;
}
