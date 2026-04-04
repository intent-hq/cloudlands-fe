/**
 * Client-Safe Shared Utilities
 *
 * Common utility functions that can be used in both client and server.
 * NO Node.js-specific imports allowed here!
 */

import type { Result } from './types';

// ============================================================================
// String Utilities
// ============================================================================

/**
 * Generate a random ID
 */
export function generateId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

/**
 * Strip markdown formatting from text to get plain text.
 * Removes bold (**text**), italic (*text* or _text_), and other common markdown.
 * Useful for displaying titles that may contain markdown formatting.
 *
 * @param text - The text that may contain markdown formatting
 * @returns Plain text with markdown formatting removed
 */
export function stripMarkdownFormatting(text: string): string {
  if (!text) return '';

  let result = text;

  // Remove bold: **text** or __text__
  result = result.replace(/\*\*(.+?)\*\*/g, '$1');
  result = result.replace(/__(.+?)__/g, '$1');

  // Remove italic: *text* or _text_ (single asterisk/underscore)
  // Be careful not to match already-stripped bold markers
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '$1');
  result = result.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, '$1');

  // Remove strikethrough: ~~text~~
  result = result.replace(/~~(.+?)~~/g, '$1');

  // Remove inline code: `text`
  result = result.replace(/`([^`]+)`/g, '$1');

  // Remove links: [text](url) -> text
  result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // Remove headers: # text, ## text, etc.
  result = result.replace(/^#{1,6}\s+/gm, '');

  // Clean up any remaining markdown artifacts (stray asterisks, underscores)
  // Only remove if they appear to be orphaned formatting characters
  result = result.replace(/^\*+\s*/gm, '');
  result = result.replace(/\s*\*+$/gm, '');

  // Trim whitespace
  return result.trim();
}

/**
 * Truncate a string to a maximum length
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return `${str.substring(0, maxLength - 3)}...`;
}

/**
 * Convert a string to a slug
 */
export function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Capitalize the first letter of a string
 */
export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ============================================================================
// Date Utilities
// ============================================================================

/**
 * Format a date as a relative time string
 */
export function formatRelativeTime(date: Date | string): string {
  const now = new Date();
  const then = typeof date === 'string' ? new Date(date) : date;
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;

  return then.toLocaleDateString();
}

/**
 * Format a date as ISO string
 */
export function toISOString(date?: Date): string {
  return (date || new Date()).toISOString();
}

// ============================================================================
// Array Utilities
// ============================================================================

/**
 * Group an array by a key function
 */
export function groupBy<T, K>(items: T[], keyFn: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();

  for (const item of items) {
    const key = keyFn(item);
    const group = groups.get(key) || [];
    group.push(item);
    groups.set(key, group);
  }

  return groups;
}

/**
 * Remove duplicates from an array
 */
export function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

/**
 * Sort an array by a key function
 */
export function sortBy<T>(items: T[], keyFn: (item: T) => number | string): T[] {
  return [...items].sort((a, b) => {
    const aKey = keyFn(a);
    const bKey = keyFn(b);
    if (aKey < bKey) return -1;
    if (aKey > bKey) return 1;
    return 0;
  });
}

// ============================================================================
// Error Handling
// ============================================================================

/**
 * Wrap a function to return a Result type
 */
export async function tryAsync<T>(fn: () => Promise<T>): Promise<Result<T, string>> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Wrap a sync function to return a Result type
 */
export function trySync<T>(fn: () => T): Result<T, string> {
  try {
    const data = fn();
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Check if a value is a valid UUID
 */
export function isUUID(value: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(value);
}

/**
 * Check if a value is a valid email
 */
export function isEmail(value: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(value);
}

/**
 * Check if a value is a valid URL
 */
export function isURL(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Object Utilities
// ============================================================================

/**
 * Maximum safe recursion depth for cloning operations.
 * JavaScript call stacks are typically limited to 10,000-50,000 frames.
 * We use a conservative limit to prevent "Maximum call stack size exceeded" errors.
 */


/**
 * Deep clone an object with stack overflow protection.
 * Uses JSON serialization which is fast but has limitations:
 * - Cannot clone functions, undefined, or symbols
 * - Cannot clone circular references (will throw)
 * - Date objects become strings
 *
 * For deeply nested objects (>100 levels), this will throw an error
 * rather than cause a stack overflow, allowing graceful error handling.
 *
 * @throws Error if object is too deeply nested or has circular references
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Safely deep clone an object with stack overflow protection.
 * Unlike deepClone(), this returns null on failure instead of throwing.
 *
 * Use this when cloning potentially large or deeply nested objects
 * where failure should be handled gracefully (e.g., UI operations).
 *
 * @param obj - The object to clone
 * @param fallback - Optional fallback value to return on failure
 * @returns Cloned object, fallback value, or null if cloning fails
 */
export function safeDeepClone<T>(obj: T, fallback?: T): T | null {
  try {
    // Quick check for simple types that don't need cloning
    if (obj === null || obj === undefined) return obj;
    if (typeof obj !== 'object') return obj;

    // Use JSON round-trip for cloning
    return JSON.parse(JSON.stringify(obj));
  } catch (error) {
    // Log warning for debugging but don't crash
    console.warn('[safeDeepClone] Failed to clone object:', error);
    return fallback !== undefined ? fallback : null;
  }
}

/**
 * Check if an object is empty
 */
export function isEmpty(obj: any): boolean {
  if (obj == null) return true;
  if (typeof obj === 'object') {
    return Object.keys(obj).length === 0;
  }
  if (Array.isArray(obj)) {
    return obj.length === 0;
  }
  return false;
}

/**
 * Pick specific keys from an object
 */
export function pick<T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    if (key in obj) {
      result[key] = obj[key];
    }
  }
  return result;
}

/**
 * Omit specific keys from an object
 */
export function omit<T extends object, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> {
  const result = { ...obj };
  for (const key of keys) {
    delete result[key];
  }
  return result as Omit<T, K>;
}

// ============================================================================
// Async Utilities
// ============================================================================

/**
 * Sleep for a given number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Debounce a function
 */
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number,
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Throttle a function (simple version without cancel)
 */
export function throttle<T extends (...args: any[]) => any>(
  fn: T,
  limit: number,
): (...args: Parameters<T>) => void {
  let inThrottle = false;
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

// ============================================================================
// File Size
// ============================================================================

/**
 * Format bytes as human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

// ============================================================================
// Git Utilities
// ============================================================================

/**
 * Parse a git remote URL to extract owner and repo
 */
export function parseGitRemote(url: string): { owner: string; repo: string } | null {
  // Handle SSH URLs: git@github.com:owner/repo.git
  const sshMatch = url.match(/git@[^:]+:([^/]+)\/(.+?)(?:\.git)?$/);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  // Handle HTTPS URLs: https://github.com/owner/repo.git
  const httpsMatch = url.match(/https?:\/\/[^/]+\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }

  return null;
}
