import type { SourceProjection } from './projection/source-projection';
export const NOTE_VIEW_LIMITS = {
  nodes: 4096,
  derivedBytes: 4 * 1024 * 1024,
  derivedObjects: 100_000,
} as const;
/** Retained graph payload accounting, not JS heap: shared objects are visited once,
 * strings are UTF-8 payload bytes, scalars use eight bytes, maps include entries.
 * Walk incrementally instead of allocating a JSON copy of the entire graph. */
export function measureNoteProjection(projection: SourceProjection) {
  let projectedNodes = 0,
    derivedBytes = 0,
    objects = 0;
  const nodes = [...(projection.content.content ?? [])];
  while (nodes.length) {
    const n = nodes.pop()!;
    projectedNodes++;
    if (projectedNodes > NOTE_VIEW_LIMITS.nodes)
      throw new Error('Note native node budget exceeded');
    if (n.content) nodes.push(...n.content);
  }
  const seen = new Set<object>(),
    pending: unknown[] = [projection],
    encoder = new TextEncoder();
  while (pending.length) {
    const value = pending.pop();
    if (typeof value === 'string') derivedBytes += encoder.encode(value).length;
    else if (typeof value === 'number' || typeof value === 'boolean') derivedBytes += 8;
    else if (value && typeof value === 'object' && !seen.has(value)) {
      seen.add(value);
      objects++;
      if (objects > NOTE_VIEW_LIMITS.derivedObjects)
        throw new Error('Note derived object budget exceeded');
      if (value instanceof Map) {
        for (const [key, item] of value) {
          pending.push(key, item);
        }
      } else if (Array.isArray(value)) pending.push(...value);
      else for (const [key, item] of Object.entries(value)) pending.push(key, item);
    }
    if (derivedBytes > NOTE_VIEW_LIMITS.derivedBytes)
      throw new Error('Note derived payload budget exceeded');
  }
  return {
    projectedNodes,
    derivedBytes,
    derivedObjects: objects,
    provenanceEntries:
      projection.positions.size +
      projection.ends.size +
      projection.boundaries.size +
      projection.tokens.length,
  };
}
