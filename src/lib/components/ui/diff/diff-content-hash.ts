/**
 * Module-scoped hash cache shared across all DiffViewer instances.
 * Wave 3: previously kept per-component-instance, which defeated dedup
 * across the N mounted diffs in "all changes". Keep the same FNV-1a
 * string-hash behaviour and the same 512-entry LRU-ish eviction.
 */

/**
 * FNV-1a 32-bit hash of a string.
 * Used only to generate stable cache keys for @pierre/diffs — never to key
 * security-sensitive data. Collisions are acceptable; the cache still stays
 * correct because @pierre/diffs reparses when the backing content differs.
 */
function fnv1a32(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(36);
}

const contentHashCache = new Map<string, string>();

export function hashContent(str: string): string {
  if (str.length === 0) return '0';
  const cached = contentHashCache.get(str);
  if (cached !== undefined) return cached;
  const h = fnv1a32(str);
  if (contentHashCache.size > 512) {
    const keys = Array.from(contentHashCache.keys());
    for (let i = 0; i < keys.length >> 1; i++) contentHashCache.delete(keys[i]);
  }
  contentHashCache.set(str, h);
  return h;
}