/**
 * Rewrite inline markdown image sources that reference workspace files.
 *
 * Markdown images like `![alt](intent://local/file/docs/diagram.png)` (or the
 * long form `intent://local/{workspaceId}/file/{path}`) are rewritten to
 * `workspace-file://{workspaceId}/{percent-encoded-path}` URLs, which the
 * Electron `workspace-file://` protocol handler serves from the workspace
 * checkout (safe image and video extensions only; SVG is deliberately excluded).
 *
 * Path validation mirrors the intent file-link parsing in
 * `workspaces-link-handler.ts` (raw un-normalized segments so "." / ".."
 * traversal is rejected rather than resolved) and the main-process
 * `workspace-file-url.ts` allowlist. This module is intentionally
 * dependency-light so the markdown processor can use it without pulling in
 * navigation stores or toasts.
 */

/** Image extensions served by the workspace-file:// protocol (SVG excluded). */
const IMAGE_EXTENSION_RE = /\.(?:png|jpe?g|gif|webp)$/i;
const VIDEO_EXTENSION_RE = /\.(?:mp4|webm)$/i;

type WorkspaceFileMediaKind = 'image' | 'video';

export interface WorkspaceFileMedia {
  url: string;
  kind: WorkspaceFileMediaKind;
}

export interface IntentFileTarget {
  workspaceId: string;
  path: string;
  encodedPath: string;
}

function mediaKindForPath(filePath: string): WorkspaceFileMediaKind | null {
  if (IMAGE_EXTENSION_RE.test(filePath)) return 'image';
  if (VIDEO_EXTENSION_RE.test(filePath)) return 'video';
  return null;
}

/** Conservative workspace-ID shape safe to interpolate as a URL host. */
const WORKSPACE_ID_RE = /^[A-Za-z0-9._-]+$/;

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

function isValidWorkspaceId(id: string): boolean {
  return WORKSPACE_ID_RE.test(id) && id !== '.' && id !== '..';
}

/**
 * Convert an `intent://{org}/file/{path}` or `intent://{org}/{workspaceId}/file/{path}`
 * URL into a `workspace-file://{workspaceId}/{percent-encoded-path}` URL.
 *
 * Returns null when the URL is not a workspace file link, the path is unsafe
 * (traversal, empty or absolute segments, drive letters), or the workspace ID
 * cannot be resolved and verified against `currentWorkspaceId`.
 */
export function parseIntentFileTarget(
  intentUrl: string,
  currentWorkspaceId?: string,
): IntentFileTarget | null {
  if (!intentUrl.startsWith('intent://')) return null;

  // Parse raw (un-normalized) segments so "." / ".." dot segments are
  // rejected below instead of being silently resolved by the URL parser.
  const rawPath = intentUrl.slice('intent://'.length).split(/[?#]/)[0];
  const segments = rawPath.split('/');
  const orgId = segments[0];
  const rest = segments.slice(1);
  if (!orgId) return null;

  let workspaceId: string | undefined;
  let pathSegments: string[];
  if (rest[0] === 'file') {
    // Short form: file/{workspace-relative-path} → current workspace
    workspaceId = currentWorkspaceId;
    pathSegments = rest.slice(1);
  } else if (rest.length >= 3 && rest[1] === 'file') {
    // Long form: {workspace-id}/file/{workspace-relative-path}
    const decodedWorkspaceId = decodeSegment(rest[0]);
    if (!decodedWorkspaceId || decodedWorkspaceId !== currentWorkspaceId) return null;
    workspaceId = decodedWorkspaceId;
    pathSegments = rest.slice(2);
  } else {
    return null;
  }

  if (!workspaceId || !isValidWorkspaceId(workspaceId) || pathSegments.length === 0) {
    return null;
  }

  const decodedSegments: string[] = [];
  for (const segment of pathSegments) {
    const decoded = decodeSegment(segment);
    if (
      decoded === null ||
      decoded.length === 0 ||
      decoded === '.' ||
      decoded === '..' ||
      decoded.includes('/') ||
      decoded.includes('\\')
    ) {
      return null;
    }
    decodedSegments.push(decoded);
  }

  // Reject Windows drive-letter prefixes (C:foo, C:/foo) like the link handler.
  if (/^[A-Za-z]:/.test(decodedSegments[0])) return null;

  const encodedPath = decodedSegments.map((s) => encodeURIComponent(s)).join('/');
  return { workspaceId, path: decodedSegments.join('/'), encodedPath };
}

export function intentFileMediaUrlToWorkspaceFile(
  intentUrl: string,
  currentWorkspaceId?: string,
): WorkspaceFileMedia | null {
  const target = parseIntentFileTarget(intentUrl, currentWorkspaceId);
  if (!target) return null;
  const kind = mediaKindForPath(target.path);
  if (!kind) return null;
  return { url: `workspace-file://${target.workspaceId}/${target.encodedPath}`, kind };
}

/** Backward-compatible image-only URL conversion. */
export function intentFileImageUrlToWorkspaceFileUrl(
  intentUrl: string,
  currentWorkspaceId?: string,
): string | null {
  const media = intentFileMediaUrlToWorkspaceFile(intentUrl, currentWorkspaceId);
  return media?.kind === 'image' ? media.url : null;
}

/** Convert a rendered workspace media URL back to its portable markdown form. */
export function workspaceFileMediaUrlToIntentFileUrl(workspaceFileUrl: string): string | null {
  if (!workspaceFileUrl.startsWith('workspace-file://')) return null;

  const rawPath = workspaceFileUrl.slice('workspace-file://'.length).split(/[?#]/)[0];
  const [workspaceId, ...pathSegments] = rawPath.split('/');
  if (!workspaceId || !isValidWorkspaceId(workspaceId) || pathSegments.length === 0) return null;

  const decodedSegments: string[] = [];
  for (const segment of pathSegments) {
    const decoded = decodeSegment(segment);
    if (
      decoded === null ||
      decoded.length === 0 ||
      decoded === '.' ||
      decoded === '..' ||
      decoded.includes('/') ||
      decoded.includes('\\')
    ) {
      return null;
    }
    decodedSegments.push(decoded);
  }

  if (/^[A-Za-z]:/.test(decodedSegments[0])) return null;
  if (!mediaKindForPath(decodedSegments[decodedSegments.length - 1])) return null;

  const encodedPath = decodedSegments.map((segment) => encodeURIComponent(segment)).join('/');
  return `intent://local/file/${encodedPath}`;
}

/** Convert a rendered workspace image URL back to its portable markdown form. */
export function workspaceFileImageUrlToIntentFileUrl(workspaceFileUrl: string): string | null {
  if (!workspaceFileUrl.startsWith('workspace-file://')) return null;

  const rawPath = workspaceFileUrl.slice('workspace-file://'.length).split(/[?#]/)[0];
  const [workspaceId, ...pathSegments] = rawPath.split('/');
  if (!workspaceId || !isValidWorkspaceId(workspaceId) || pathSegments.length === 0) return null;

  const decodedSegments: string[] = [];
  for (const segment of pathSegments) {
    const decoded = decodeSegment(segment);
    if (
      decoded === null ||
      decoded.length === 0 ||
      decoded === '.' ||
      decoded === '..' ||
      decoded.includes('/') ||
      decoded.includes('\\')
    ) {
      return null;
    }
    decodedSegments.push(decoded);
  }

  if (/^[A-Za-z]:/.test(decodedSegments[0])) return null;
  if (!IMAGE_EXTENSION_RE.test(decodedSegments[decodedSegments.length - 1])) return null;

  const encodedPath = decodedSegments.map((segment) => encodeURIComponent(segment)).join('/');
  return `intent://local/file/${encodedPath}`;
}

/** Escape a value for interpolation into a double-quoted HTML attribute. */
const escapeAttr = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

const SHORT_FORM_INTENT_FILE_RE = /^intent:\/\/[^/?#]+\/file\//;

/**
 * Cache-busting query parameter on rewritten `workspace-file://` image URLs.
 * Mirrors `WORKSPACE_FILE_VERSION_PARAM` in the main-process
 * `workspace-file-url.ts`, which accepts it alongside the `backend=` hint.
 */
export const WORKSPACE_FILE_VERSION_PARAM = 'v';

let versionSequence = 0;

/**
 * A fresh, URL-safe token for `?v=`. Chromium reuses a cached image for an
 * identical URL, so without the token a regenerated workspace file (same
 * path, new bytes) keeps rendering its stale version in later messages.
 */
export function createWorkspaceFileVersion(): string {
  versionSequence += 1;
  return `${Date.now().toString(36)}-${versionSequence.toString(36)}`;
}

/**
 * Append `?v={version}` to every rendered `<img src="workspace-file://...">`
 * that does not already carry a query string. Videos are left alone: the
 * player streams via range requests and is not subject to the image cache.
 */
export function stampWorkspaceFileImageVersions(html: string, version: string): string {
  if (!html.includes('workspace-file://')) return html;

  return html.replace(/<img\b[^>]*>/gi, (match) => {
    const srcMatch = /\ssrc="(workspace-file:\/\/[^"?#]*)"/i.exec(match);
    if (!srcMatch) return match;
    return match.replace(
      srcMatch[0],
      ` src="${srcMatch[1]}?${WORKSPACE_FILE_VERSION_PARAM}=${escapeAttr(version)}"`,
    );
  });
}

/**
 * Rewrite rendered markdown images that reference workspace media. Image links
 * keep their `<img>` tag; video links become a native controlled player.
 *
 * A short-form link rendered without a workspace id cannot be resolved, and the
 * raw `intent://` src would be blocked by CSP as a broken image. Its src is
 * moved to `data-media-src` and the tag is marked
 * `data-media-unavailable="workspace-unknown"` so the viewer mounts a placeholder.
 */
export function rewriteIntentFileImageSrcs(html: string, currentWorkspaceId?: string): string {
  if (!html.includes('intent://')) return html;

  return html.replace(/<img\b[^>]*>/gi, (match) => {
    const srcMatch = /\ssrc="([^"]*)"/i.exec(match);
    if (!srcMatch) return match;

    // marked entity-encodes ampersands inside attribute values
    const src = srcMatch[1].replace(/&amp;/g, '&');
    if (!src.startsWith('intent://')) return match;
    const target = parseIntentFileTarget(src, currentWorkspaceId);
    if (!target) {
      if (!currentWorkspaceId && SHORT_FORM_INTENT_FILE_RE.test(src)) {
        return match
          .replace(srcMatch[0], ` data-media-src="${srcMatch[1]}"`)
          .replace(/>$/, ' data-media-unavailable="workspace-unknown">');
      }
      return match;
    }
    const kind = mediaKindForPath(target.path);
    if (!kind) {
      const extension = target.path.split('.').pop()?.toLowerCase() ?? '';
      return match.replace(/>$/, ` data-media-unsupported="${escapeAttr(extension)}">`);
    }
    const media: WorkspaceFileMedia = {
      url: `workspace-file://${target.workspaceId}/${target.encodedPath}`,
      kind,
    };
    if (media.kind === 'image') {
      return match.replace(srcMatch[1], escapeAttr(media.url));
    }

    const name = /\salt="([^"]*)"/i.exec(match)?.[1] ?? '';
    return `<video src="${escapeAttr(media.url)}" controls preload="metadata" playsinline class="markdown-video" data-name="${name}"></video>`;
  });
}
