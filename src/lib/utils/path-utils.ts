/**
 * Path utilities for the Intent app
 */

/**
 * Expands a path with tilde (~) to the full path with the user's home directory
 * Note: In the renderer process, this just returns the path as-is.
 * The actual expansion happens in the main process via IPC.
 * @param path The path to expand
 * @returns The path (expansion happens in main process)
 */
export function expandPath(path: string): string {
  // In the renderer process, we don't have access to Node.js APIs
  // The path expansion will be handled by the main process
  return path;
}

/**
 * Normalizes a path by removing redundant separators and resolving . and ..
 * @param path The path to normalize
 * @returns The normalized path
 */
export function normalizePath(path: string): string {
  // Normalize backslashes to forward slashes (Windows paths)
  let normalized = path.replaceAll('\\', '/');
  // Replace multiple slashes with single slash
  normalized = normalized.replace(/\/+/g, '/');

  // Handle . and .. segments
  const segments = normalized.split('/');
  const result: string[] = [];

  for (const segment of segments) {
    if (segment === '..') {
      result.pop();
    } else if (segment !== '.' && segment !== '') {
      result.push(segment);
    }
  }

  // Preserve leading slash for absolute paths
  if (path.startsWith('/')) {
    return `/${result.join('/')}`;
  }

  return result.join('/') || '.';
}

/**
 * Gets the directory name from a path
 * @param path The path to get the directory from
 * @returns The directory path
 */
export function dirname(path: string): string {
  // Normalize backslashes first
  const normalized = path.replaceAll('\\', '/');
  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash === -1) return '.';
  if (lastSlash === 0) return '/';
  return normalized.slice(0, lastSlash);
}

/**
 * Gets the base name from a path
 * @param path The path to get the base name from
 * @returns The base name
 */
export function basename(path: string): string {
  // Normalize backslashes first
  const normalized = path.replaceAll('\\', '/');
  const lastSlash = normalized.lastIndexOf('/');
  return normalized.slice(lastSlash + 1);
}

/**
 * Joins path segments
 * @param segments The path segments to join
 * @returns The joined path
 */
export function joinPath(...segments: string[]): string {
  return normalizePath(segments.join('/'));
}

/**
 * Check if a path is absolute.
 * Handles both Unix (`/foo`) and Windows (`C:\foo`, `C:/foo`, `\\server\share`) absolute paths.
 * @param p The path to check
 * @returns true if the path is absolute
 */
export function isAbsolutePath(p: string): boolean {
  if (!p) return false;
  // Unix absolute path
  if (p.startsWith('/')) return true;
  // Windows drive letter (e.g., C:\ or C:/)
  if (/^[A-Za-z]:[/\\]/.test(p)) return true;
  // Windows UNC path (e.g., \\server\share)
  if (p.startsWith('\\\\')) return true;
  return false;
}

/**
 * Detect if running on Windows (renderer-safe).
 * Uses navigator.platform which is available in the renderer process.
 * @returns true if the current platform is Windows
 */
export function isWindowsPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return navigator.platform?.startsWith('Win') ?? false;
}

/**
 * Convert a path to native OS format for clipboard/display purposes.
 * On Windows, converts forward slashes to backslashes.
 * On macOS/Linux, returns the path unchanged.
 * @param p The path to convert
 * @returns The path with native separators
 */
export function toNativePath(p: string): string {
  if (isWindowsPlatform()) {
    return p.replace(/\//g, '\\');
  }
  return p;
}


