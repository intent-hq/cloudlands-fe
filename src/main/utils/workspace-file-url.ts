import path from 'path';
import { decodeUrlPath } from './decode-url-path';

/**
 * Image-only MIME allowlist for `workspace-file://` responses. SVG is
 * deliberately excluded in v1 (script-injection surface); non-image
 * extensions are rejected rather than served as octet-stream.
 */
const WORKSPACE_FILE_IMAGE_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

/** MIME type for an allowlisted image extension, or null when not allowlisted. */
export function imageMimeTypeForPath(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  return WORKSPACE_FILE_IMAGE_MIME_TYPES[ext] ?? null;
}

export type WorkspaceFileRequest =
  | { ok: true; workspaceId: string; filePath: string; mimeType: string }
  | { ok: false; status: 400 | 403 | 415; reason: string };

/**
 * Parse and validate a `workspace-file://{workspaceId}/{percent-encoded-path}`
 * URL. The daemon's `file.readChunk` already contains reads within the
 * workspace root; this adds client-side rejection of traversal segments and
 * enforces the image allowlist before any RPC is issued.
 */
export function parseWorkspaceFileRequest(rawUrl: string): WorkspaceFileRequest {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, status: 400, reason: 'malformed URL' };
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

  const mimeType = imageMimeTypeForPath(filePath);
  if (mimeType === null) {
    return { ok: false, status: 415, reason: 'extension not in image allowlist' };
  }

  return { ok: true, workspaceId, filePath, mimeType };
}
