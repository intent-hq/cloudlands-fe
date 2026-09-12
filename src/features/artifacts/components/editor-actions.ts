import { isAllowedArtifactImageSource } from '../preview';
import type { ArtifactDocument, ArtifactRegion } from '$shared/types/visual-artifact';

export function removeItems(document: ArtifactDocument, ids: string[]): ArtifactDocument {
  const removed = new Set(ids);
  return {
    ...document,
    items: document.items.filter((item) => !removed.has(item.id)),
    connections: document.connections.filter(
      (edge) => !removed.has(edge.from) && !removed.has(edge.to),
    ),
    annotations: document.annotations.filter(
      (annotation) => !annotation.selection.itemIds.some((id) => removed.has(id)),
    ),
    ...(document.chosenIds
      ? { chosenIds: document.chosenIds.filter((id) => !removed.has(id)) }
      : {}),
  };
}

export function moveItems(
  document: ArtifactDocument,
  ids: string[],
  dx: number,
  dy: number,
): ArtifactDocument {
  return {
    ...document,
    items: document.items.map((item) =>
      ids.includes(item.id)
        ? {
            ...item,
            x: Math.max(-100000, Math.min(100000, item.x + dx)),
            y: Math.max(-100000, Math.min(100000, item.y + dy)),
          }
        : item,
    ),
  };
}

export function rectangle(
  start: { x: number; y: number },
  end: { x: number; y: number },
): ArtifactRegion {
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const x = Math.min(clamp(start.x), clamp(end.x), 0.99);
  const y = Math.min(clamp(start.y), clamp(end.y), 0.99);
  return {
    x,
    y,
    width: Math.min(1 - x, Math.max(0.01, Math.abs(clamp(end.x) - clamp(start.x)))),
    height: Math.min(1 - y, Math.max(0.01, Math.abs(clamp(end.y) - clamp(start.y)))),
  };
}

/** Workspace references must be resolved by the scoped wrapper before reaching an img element. */
export function displayImageSource(
  source: string | undefined,
  resolved: Record<string, string>,
): string | undefined {
  if (!source || !isAllowedArtifactImageSource(source)) return undefined;
  const pixels = source.startsWith('data:') ? source : resolved[source];
  return pixels?.startsWith('data:') && isAllowedArtifactImageSource(pixels) ? pixels : undefined;
}
