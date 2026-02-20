/**
 * Debug utility for tracking {#each} block keys to find duplicates.
 *
 * Usage in a component:
 * ```svelte
 * <script>
 *   import { trackEachKeys } from '$lib/utils/debug-each-keys';
 *
 *   // In your component
 *   $effect(() => {
 *     const keys = items.map(item => item.id);
 *     trackEachKeys('MyComponent.items', keys);
 *   });
 * </script>
 * ```
 *
 * Or use the helper to wrap an array:
 * ```svelte
 * {#each debugEach('MyComponent.items', items, item => item.id) as item (item.id)}
 * ```
 */

// Store for tracking keys
const keyRegistry = new Map<string, { keys: unknown[]; timestamp: number }>();

/**
 * Track keys for a specific {#each} block.
 * Will log a warning if duplicate keys are detected.
 */
export function trackEachKeys(blockId: string, keys: unknown[]): void {
  // Find duplicates
  const seen = new Set<unknown>();
  const duplicates: unknown[] = [];

  for (const key of keys) {
    if (seen.has(key)) {
      duplicates.push(key);
    } else {
      seen.add(key);
    }
  }

  if (duplicates.length > 0) {
    console.error(
      `🔴 DUPLICATE KEYS FOUND in ${blockId}:`,
      '\n  Duplicates:',
      duplicates,
      '\n  All keys:',
      keys,
      '\n  Total:',
      keys.length,
      'keys,',
      duplicates.length,
      'duplicates',
    );

    // Store for later inspection
    keyRegistry.set(blockId, { keys, timestamp: Date.now() });
  }
}

/**
 * Helper to wrap an array for debugging in {#each}.
 * Use when you want to instrument an existing {#each} block.
 */
export function debugEach<T>(blockId: string, items: T[], keyFn: (item: T) => unknown): T[] {
  const keys = items.map(keyFn);
  trackEachKeys(blockId, keys);
  return items;
}

/**
 * Get all tracked key registries (for debugging).
 */
export function getKeyRegistry(): Map<string, { keys: unknown[]; timestamp: number }> {
  return new Map(keyRegistry);
}

/**
 * Clear the key registry.
 */
export function clearKeyRegistry(): void {
  keyRegistry.clear();
}

/**
 * Helper to validate an array has unique keys before using it.
 * Throws an error with detailed info if duplicates are found.
 */
export function assertUniqueKeys<T>(
  blockId: string,
  items: T[],
  keyFn: (item: T) => unknown,
): void {
  const keys = items.map(keyFn);
  const seen = new Map<unknown, number>();
  const duplicates: { key: unknown; indices: number[] }[] = [];

  keys.forEach((key, index) => {
    if (seen.has(key)) {
      // Find existing duplicate entry or create new one
      let entry = duplicates.find((d) => d.key === key);
      if (!entry) {
        entry = { key, indices: [seen.get(key)!] };
        duplicates.push(entry);
      }
      entry.indices.push(index);
    } else {
      seen.set(key, index);
    }
  });

  if (duplicates.length > 0) {
    const itemsWithDupes = duplicates.map((d) => ({
      key: d.key,
      items: d.indices.map((i) => items[i]),
    }));

    console.error(`🔴 [${blockId}] Duplicate keys detected:`, {
      duplicates: itemsWithDupes,
      totalItems: items.length,
      uniqueKeys: seen.size,
    });

    throw new Error(
      `Duplicate keys in ${blockId}: ${duplicates.map((d) => JSON.stringify(d.key)).join(', ')}`,
    );
  }
}

// Expose on window for debugging in console
if (typeof window !== 'undefined') {
  (window as any).__debugEachKeys = {
    getRegistry: getKeyRegistry,
    clear: clearKeyRegistry,
  };
}
