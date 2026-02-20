/**
 * Analytics Utility Functions
 *
 * Shared helper functions for analytics tracking.
 * These functions help extract privacy-safe metadata from user data.
 */

/**
 * Extract domain from URL safely for analytics tracking.
 * Returns 'unknown' if the URL is invalid or hostname is empty.
 *
 * @param url - The URL to extract domain from
 * @returns The hostname (e.g., 'example.com') or 'unknown'
 */
export function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    // Return 'unknown' if hostname is empty (e.g., about:blank)
    return parsed.hostname || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Extract file extension from path for analytics (privacy-safe).
 * Does not include the leading dot - returns just the extension.
 *
 * @param path - The file path to extract extension from (can be undefined/null)
 * @returns The extension (e.g., 'ts', 'svelte') or 'unknown'
 */
export function getFileExtension(path: string | undefined | null): string {
  if (!path) return 'unknown';
  const parts = path.split('.');
  return parts.length > 1 ? parts.pop() || 'unknown' : 'unknown';
}

