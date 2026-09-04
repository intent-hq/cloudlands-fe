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

/**
 * Query parameter carrying the requesting window's backend id on
 * `workspace-file://` and `workspace-asset://` URLs. Stamped in the main
 * process by `setupWorkspaceMediaBackendHinting` (a `webRequest` redirect
 * keyed off the request's webContents), never by renderer code — so a
 * workspace id that exists on two backends is served by the backend of the
 * window that issued the fetch.
 */
export const WORKSPACE_MEDIA_BACKEND_PARAM = 'backend';

/**
 * Cache-busting query parameter the renderer stamps on `workspace-file://`
 * image URLs (`src/lib/utils/workspace-file-image.ts`) so a regenerated file
 * is fetched again instead of served from Chromium's image cache. The token is
 * opaque to the handler and never reaches the daemon `path` param.
 */
export const WORKSPACE_FILE_VERSION_PARAM = 'v';

/** Connection ids are `local` or a UUID; anything else in the hint is rejected. */
const BACKEND_ID_RE = /^[A-Za-z0-9._-]+$/;
/** Version tokens are opaque but must be URL-safe (no reserved characters). */
const VERSION_TOKEN_RE = /^[A-Za-z0-9._-]+$/;

const WORKSPACE_MEDIA_PROTOCOLS = new Set(['workspace-file:', 'workspace-asset:']);

export type WorkspaceMediaBackendHint =
  { ok: true; backendId: string | null } | { ok: false; reason: string };

/**
 * Parse the backend hint from a workspace media URL's query string. An empty
 * query yields `backendId: null` (legacy unhinted URL); at most one well-formed
 * `backend=` parameter yields its value, and at most one well-formed `v=`
 * cache-busting token is accepted alongside it (in either order). Any other
 * query string is rejected so the protocol handlers never accept arbitrary
 * parameters.
 */
export function parseWorkspaceMediaBackendHint(search: string): WorkspaceMediaBackendHint {
  if (!search) return { ok: true, backendId: null };
  const params = new URLSearchParams(search);
  const entries = [...params.entries()];
  const keys = entries.map(([key]) => key);
  const backendCount = keys.filter((key) => key === WORKSPACE_MEDIA_BACKEND_PARAM).length;
  const versionCount = keys.filter((key) => key === WORKSPACE_FILE_VERSION_PARAM).length;
  if (
    entries.length === 0 ||
    backendCount > 1 ||
    versionCount > 1 ||
    backendCount + versionCount !== entries.length
  ) {
    return { ok: false, reason: 'unexpected query string' };
  }
  const version = params.get(WORKSPACE_FILE_VERSION_PARAM);
  if (version !== null && !VERSION_TOKEN_RE.test(version)) {
    return { ok: false, reason: 'malformed version token' };
  }
  const backendId = params.get(WORKSPACE_MEDIA_BACKEND_PARAM);
  if (backendId === null) return { ok: true, backendId: null };
  if (!BACKEND_ID_RE.test(backendId)) {
    return { ok: false, reason: 'malformed backend hint' };
  }
  return { ok: true, backendId };
}

/**
 * The redirect target that stamps `backendId` onto a workspace media URL, or
 * null when the URL should be left alone: not a workspace media scheme,
 * carrying a fragment or an unrecognised query string, or already hinted with
 * the same backend (re-stamping would loop the redirect). A URL hinted with a
 * *different* backend — e.g. authored in markdown — is rewritten so the hint
 * names the requesting window's backend, never another one. A
 * renderer-stamped `?v=` cache-busting token is preserved and the hint is
 * appended after it.
 */
export function withWorkspaceMediaBackendHint(rawUrl: string, backendId: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!WORKSPACE_MEDIA_PROTOCOLS.has(url.protocol) || url.hash) return null;
  const hint = parseWorkspaceMediaBackendHint(url.search);
  if (!hint.ok || hint.backendId === backendId) return null;
  if (!BACKEND_ID_RE.test(backendId)) return null;
  const hintParam = `${WORKSPACE_MEDIA_BACKEND_PARAM}=${encodeURIComponent(backendId)}`;
  if (hint.backendId === null) {
    const separator = rawUrl.includes('?') ? '&' : '?';
    return `${rawUrl}${separator}${hintParam}`;
  }
  const version = url.searchParams.get(WORKSPACE_FILE_VERSION_PARAM);
  const versionParam =
    version === null ? '' : `${WORKSPACE_FILE_VERSION_PARAM}=${encodeURIComponent(version)}&`;
  return `${rawUrl.slice(0, rawUrl.indexOf('?'))}?${versionParam}${hintParam}`;
}

export type WorkspaceFileRequest =
  | {
      ok: true;
      workspaceId: string;
      filePath: string;
      mimeType: string;
      /** Requesting window's backend id when the URL carries a hint, else null. */
      backendId: string | null;
    }
  | { ok: false; status: 400 | 403 | 415; reason: string };

/**
 * Parse and validate a `workspace-file://{workspaceId}/{percent-encoded-path}`
 * URL, optionally carrying a `?backend=` hint and/or a `?v=` cache-busting
 * token. The daemon's `file.readChunk` already contains reads within the
 * workspace root; this adds client-side rejection of traversal segments and
 * enforces the media allowlist before any RPC is issued. Neither query
 * parameter reaches the daemon `path` param.
 */
export function parseWorkspaceFileRequest(rawUrl: string): WorkspaceFileRequest {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, status: 400, reason: 'malformed URL' };
  }

  if (url.protocol !== 'workspace-file:' || url.username || url.password || url.port || url.hash) {
    return { ok: false, status: 400, reason: 'invalid workspace file URL shape' };
  }

  const hint = parseWorkspaceMediaBackendHint(url.search);
  if (!hint.ok) {
    return { ok: false, status: 400, reason: hint.reason };
  }

  // WHATWG URL parsing removes dot segments before exposing pathname. Inspect
  // the original path too so traversal is rejected, not silently normalized.
  const rawPathMatch = /^workspace-file:\/\/[^/?#]*\/([^?#]*)(?:\?[^#]*)?$/.exec(rawUrl);
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

  return { ok: true, workspaceId, filePath, mimeType, backendId: hint.backendId };
}
