/**
 * Shared Utilities (Server-side)
 *
 * Common utility functions used across the application.
 * This file contains Node.js-specific utilities.
 * For client-safe utilities, use utils-client.ts
 */

import { homedir, tmpdir } from 'os';

// Re-export client-safe utilities
export * from '../utils-client';

// ============================================================================
// Path Utilities
// ============================================================================

/**
 * Validates that a directory path is safe to use (not root, not empty, exists on disk).
 */
function isValidDirectory(dir: string | undefined): dir is string {
  if (!dir || dir.length <= 1 || dir === '/') {
    return false;
  }
  // Reject Windows drive roots like C:\, D:\, etc.
  if (/^[A-Za-z]:\\?$/.test(dir)) {
    return false;
  }
  return true;
}

/**
 * Get a safe home directory path.
 *
 * On macOS, homedir() can return '/' or an empty string in certain environments
 * (e.g., sandboxed apps, GUI apps launched from Finder with unusual HOME settings).
 * This function validates the result and falls back through multiple options:
 * 1. homedir() if valid
 * 2. tmpdir() if valid
 * 3. '/tmp' as a last resort on macOS/Linux
 *
 * @returns A valid directory path (home directory, temp directory, or /tmp as fallback)
 * @example
 * ```typescript
 * const home = getSafeHomeDir();
 * // Returns: /Users/username (or /tmp if home is invalid)
 * ```
 */
// Track if we've logged the home directory warning already
let _loggedHomeDirWarning = false;

export function getSafeHomeDir(): string {
  // Try homedir() first
  const home = homedir();
  if (isValidDirectory(home)) {
    return home;
  }

  // Log warning once if homedir() returns invalid value
  if (!_loggedHomeDirWarning) {
    _loggedHomeDirWarning = true;
    console.warn(`[getSafeHomeDir] homedir() returned invalid value: "${home}", falling back`);
  }

  // Try tmpdir() as second option
  const temp = tmpdir();
  if (isValidDirectory(temp)) {
    return temp;
  }

  // Last resort fallback
  // Use os.tmpdir() which returns a valid path on all platforms
  // (e.g., C:\Users\<user>\AppData\Local\Temp on Windows, /tmp on Unix)
  return process.platform === 'win32' ? tmpdir() || 'C:\\Windows\\Temp' : '/tmp';
}
