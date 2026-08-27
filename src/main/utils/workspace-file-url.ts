import path from 'path';
import { decodeUrlPath } from './decode-url-path';

/**
 * MIME allowlist for `workspace-file://` responses. SVG remains excluded
 * (script-injection surface); video is intentionally limited to the two
 * browser-safe artifact formats used by the app.
 */
const WORKSPACE_FILE_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

const WORKSPACE_FILE_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

/** MIME type for an allowlisted image extension, or null when not allowlisted. */
export function imageMimeTypeForPath(filePath: string): string | null {
  const mimeType = workspaceFileMimeTypeForPath(filePath);
  return mimeType && WORKSPACE_FILE_IMAGE_MIME_TYPES.has(mimeType) ? mimeType : null;
}

/** MIME type for an allowlisted workspace image or video, or null. */
export function workspaceFileMimeTypeForPath(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  return WORKSPACE_FILE_MIME_TYPES[ext] ?? null;
}

export type WorkspaceFileRequest =
  | { ok: true; workspaceId: string; filePath: string; mimeType: string }
  | { ok: false; status: 400 | 403 | 415; reason: string };

/**
 * Parse and validate a `workspace-file://{workspaceId}/{percent-encoded-path}`
 * URL. The daemon's `file.readChunk` already contains reads within the
 * workspace root; this adds client-side rejection of traversal segments and
 * enforces the media allowlist before any RPC is issued.
 */
export function parseWorkspaceFileRequest(rawUrl: string): WorkspaceFileRequest {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, status: 400, reason: 'malformed URL' };
  }

  if (
    url.protocol !== 'workspace-file:' ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  ) {
    return { ok: false, status: 400, reason: 'invalid workspace file URL shape' };
  }

  // WHATWG URL parsing removes dot segments before exposing pathname. Inspect
  // the original path too so traversal is rejected, not silently normalized.
  const rawPathMatch = /^workspace-file:\/\/[^/?#]*\/([^?#]*)$/.exec(rawUrl);
  if (!rawPathMatch) {
    return { ok: false, status: 400, reason: 'invalid workspace file URL shape' };
  }
  for (const rawSegment of rawPathMatch[1].split('/')) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(rawSegment);
    } catch {
      return { ok: false, status: 400, reason: 'bad percent encoding' };
    }
    if (decoded.split(/[\\/]/).some((part) => part === '.' || part === '..')) {
      return { ok: false, status: 403, reason: 'path traversal segment' };
    }
  }

  const workspaceId = url.hostname;
  const decodedPath = decodeUrlPath(url.pathname);
  if (decodedPath === null) {
    return { ok: false, status: 400, reason: 'invalid path encoding' };
  }

  const filePath = decodedPath.replace(/^\/+/, '');
  if (!workspaceId || !filePath) {
    return { ok: false, status: 400, reason: 'missing workspace id or path' };
  }

  if (filePath.includes('\\')) {
    return { ok: false, status: 400, reason: 'backslash in path' };
  }

  const segments = filePath.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return { ok: false, status: 403, reason: 'traversal or empty path segment' };
  }

  const mimeType = workspaceFileMimeTypeForPath(filePath);
  if (mimeType === null) {
    return { ok: false, status: 415, reason: 'extension not in media allowlist' };
  }

  return { ok: true, workspaceId, filePath, mimeType };
}
