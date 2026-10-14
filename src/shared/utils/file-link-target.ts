import { parseFilePathLineSuffix } from './link-helpers';

const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;
// A drive uses one separator; x:// is a URL scheme, not a drive path.
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[a-z]:\/(?!\/)/i;

function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, '/');
}

/** Prefer the literal href. Only use a resolved HTTP pathname on the app's origin. */
export function extractFilePathTarget(
  url: string,
  rawHref?: string,
  origin?: string,
): { path: string; fromResolvedUrl: boolean } | null {
  const target = rawHref ?? url;
  if (target) {
    if (target.startsWith('#')) return null;
    const path = parseFilePathLineSuffix(target).path;
    if (
      !target.startsWith('//') &&
      (WINDOWS_ABSOLUTE_PATH_PATTERN.test(normalizeSlashes(path)) || !SCHEME_PATTERN.test(path))
    ) {
      return { path: target, fromResolvedUrl: false };
    }
  }
  if ((url.startsWith('http://') || url.startsWith('https://')) && origin) {
    try {
      const parsed = new URL(url);
      if (parsed.origin === origin) {
        return { path: parsed.pathname + parsed.hash, fromResolvedUrl: true };
      }
    } catch {
      // Not a parseable URL; leave it to the caller's other link handlers.
    }
  }
  return null;
}

/**
 * Canonical path/line decoding and worktree classification. The caller owns
 * admission and whether external paths have a supported destination.
 */
export function resolveFilePathTarget(
  target: { path: string; fromResolvedUrl: boolean },
  root?: string,
): { kind: 'workspace' | 'external'; path: string; line?: number; column?: number } | null {
  // Parse before decoding: encoded # and : remain literal filename characters.
  const parsed = parseFilePathLineSuffix(target.path);
  let path: string;
  try {
    path = normalizeSlashes(decodeURIComponent(parsed.path));
  } catch {
    return null;
  }
  if (!path || path.includes('\0') || path.split('/').includes('..')) return null;
  const { line, column } = parsed;
  if (path.startsWith('/') || WINDOWS_ABSOLUTE_PATH_PATTERN.test(path)) {
    const slashRoot = root ? normalizeSlashes(root) : undefined;
    const normalizedRoot = slashRoot?.endsWith('/') ? slashRoot.slice(0, -1) : slashRoot;
    if (normalizedRoot && path.startsWith(`${normalizedRoot}/`)) {
      path = path.slice(normalizedRoot.length + 1);
    } else if (target.fromResolvedUrl) {
      path = path.replace(/^\/+/, '');
    } else {
      return { kind: 'external', path, line, column };
    }
  }
  const segments = path.split('/').filter((segment) => segment && segment !== '.');
  if (!segments.length) return null;
  return { kind: 'workspace', path: segments.join('/'), line, column };
}
