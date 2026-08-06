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
 * Check if a path is absolute AND falls outside a root directory.
 * Relative paths are never outside (they resolve against the root).
 * Windows-style paths (drive letter or UNC) compare case-insensitively;
 * `..` segments are resolved before comparison.
 * Unix paths compare case-sensitively by design: both sides normally come
 * from the daemon with consistent casing, so we do not assume a
 * case-insensitive filesystem.
 * @param p The path to check
 * @param root The root directory the path must fall under
 * @returns true if `p` is absolute and not under `root`
 */
export function isAbsolutePathOutsideRoot(p: string, root: string): boolean {
  if (!p || !root || !isAbsolutePath(p)) return false;
  // UNC prefixes count in both separator forms (`\\server\share`, `//server/share`).
  const windowsStyle =
    /^[A-Za-z]:[/\\]/.test(p) ||
    /^[A-Za-z]:[/\\]/.test(root) ||
    /^[/\\]{2}/.test(p) ||
    /^[/\\]{2}/.test(root);
  let candidate = normalizePath(p);
  let base = normalizePath(root);
  if (windowsStyle) {
    candidate = candidate.toLowerCase();
    base = base.toLowerCase();
  }
  if (candidate === base) return false;
  return !candidate.startsWith(base.endsWith('/') ? base : `${base}/`);
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


