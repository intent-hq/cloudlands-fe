/**
 * Dependency-light helpers for chat image actions (download / copy / info).
 *
 * Chat transcript images arrive either as inline base64 `data:` URLs (agent
 * image blocks) or as `workspace-file://{workspaceId}/{percent-encoded-path}`
 * URLs (markdown-embedded workspace images rewritten by
 * `workspace-file-image.ts`). These helpers classify a source URL and derive
 * the values the image actions menu needs.
 */

/** Parsed `workspace-file://` image source. */
export interface WorkspaceFileImage {
  workspaceId: string;
  /** Decoded workspace-relative path (what "Copy path" copies). */
  path: string;
}

/**
 * Parse a `workspace-file://{workspaceId}/{percent-encoded-path}` URL into
 * its workspace ID and decoded workspace-relative path. Returns null for any
 * other URL shape.
 */
export function parseWorkspaceFileImageUrl(url: string): WorkspaceFileImage | null {
  if (!url.startsWith('workspace-file://')) return null;
  const rest = url.slice('workspace-file://'.length).split(/[?#]/)[0];
  const segments = rest.split('/');
  const workspaceId = segments[0];
  const pathSegments = segments.slice(1);
  if (!workspaceId || pathSegments.length === 0) return null;

  const decoded: string[] = [];
  for (const segment of pathSegments) {
    if (!segment) return null;
    try {
      decoded.push(decodeURIComponent(segment));
    } catch {
      return null;
    }
  }
  return { workspaceId, path: decoded.join('/') };
}

/** Whether an image source is a remote HTTPS URL with a shareable link. */
export function isHttpsImageUrl(url: string): boolean {
  return /^https:\/\//i.test(url);
}

/** Parsed base64 `data:` URL. */
export interface Base64DataUrl {
  mimeType: string;
  base64: string;
}

/** Split a base64 `data:` URL into MIME type + payload; null otherwise. */
export function parseBase64DataUrl(url: string): Base64DataUrl | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  if (!match) return null;
  return { mimeType: match[1], base64: match[2] };
}

/** Byte size encoded by a base64 payload (accounts for `=` padding). */
export function base64ByteSize(base64: string): number {
  if (base64.length === 0) return 0;
  let padding = 0;
  if (base64.endsWith('==')) padding = 2;
  else if (base64.endsWith('=')) padding = 1;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/** Decode a base64 payload into a Blob of the given MIME type. */
export function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/**
 * Filename for downloading an image: the workspace path's basename when
 * available, else the display name (extension appended from the MIME type
 * when missing).
 */
export function imageDownloadFileName(opts: {
  workspacePath?: string | null;
  imageName?: string;
  mimeType?: string;
}): string {
  if (opts.workspacePath) {
    const basename = opts.workspacePath.split('/').pop();
    if (basename) return basename;
  }
  // i18n-ignore (fallback file name, not UI copy)
  const base = (opts.imageName || 'image').replace(/[/\\]/g, '_');
  if (/\.[A-Za-z0-9]+$/.test(base)) return base;
  const extension = (opts.mimeType && MIME_EXTENSIONS[opts.mimeType]) || 'png';
  return `${base}.${extension}`;
}
