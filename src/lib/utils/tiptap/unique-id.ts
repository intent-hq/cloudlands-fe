/**
 * Utilities for generating unique IDs in TipTap node view components
 *
 * These are useful for:
 * - Popover API (popovertarget attribute)
 * - CSS Anchor Positioning (anchor-name property)
 * - ARIA attributes (aria-describedby, aria-labelledby)
 * - Any other case where stable unique IDs are needed
 */

/**
 * Generate a unique ID for use in components
 *
 * The ID is stable across re-renders (generated once) but unique per instance.
 * Uses base36 encoding for shorter, URL-safe IDs.
 *
 * @param prefix - Prefix for the ID (e.g., "task-menu", "comment-anchor")
 * @param length - Length of random suffix (default: 9)
 * @returns Unique ID string
 *
 * @example
 * ```typescript
 * const anchorName = generateUniqueId("task-menu-anchor");
 * // => "task-menu-anchor-k3j5h2n9x"
 *
 * const popoverId = generateUniqueId("task-menu");
 * // => "task-menu-m8k2p4q7z"
 * ```
 */
export function generateUniqueId(prefix: string, length: number = 9): string {
  let randomSuffix = '';
  while (randomSuffix.length < length) {
    randomSuffix += Math.random().toString(36).substring(2);
  }
  return `${prefix}-${randomSuffix.substring(0, length)}`;
}

/**
 * Generate multiple related unique IDs with a shared suffix
 *
 * This is useful when you need multiple IDs that should be related
 * (e.g., an anchor and its corresponding popover).
 *
 * @param prefixes - Array of prefixes
 * @param length - Length of random suffix (default: 9)
 * @returns Object with keys matching prefixes
 *
 * @example
 * ```typescript
 * const ids = generateUniqueIds(["anchor", "popover"]);
 * // => { anchor: "anchor-k3j5h2n9x", popover: "popover-k3j5h2n9x" }
 *
 * // Use in component:
 * <button
 *   style:anchor-name="--{ids.anchor}"
 *   popovertarget={ids.popover}
 * >
 *   Menu
 * </button>
 * ```
 */
export function generateUniqueIds(prefixes: string[], length: number = 9): Record<string, string> {
  let suffix = '';
  while (suffix.length < length) {
    suffix += Math.random().toString(36).substring(2);
  }
  suffix = suffix.substring(0, length);
  return Object.fromEntries(prefixes.map((prefix) => [prefix, `${prefix}-${suffix}`]));
}
