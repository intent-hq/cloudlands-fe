/**
 * Stamp daemon-probed image dimensions onto rendered Markdown `<img>` tags.
 *
 * A text block's `media` sidecar (PROTOCOL §7.1) is keyed by the exact Markdown
 * `src` as written. By the time the viewer receives HTML, the markdown
 * processor has rewritten `intent://…/file/…` sources to `workspace-file://`
 * URLs and appended a `?v=` cache token, so each `media` key is resolved to the
 * rendered form it would take before matching. Matching images gain
 * `width`/`height` attributes (the browser reserves the final box from them
 * before any bytes arrive) plus a `data-image-sized` marker the viewer uses to
 * wrap them in a placeholder frame.
 *
 * This module is intentionally dependency-light so it stays a pure string
 * transform usable from the markdown viewer without touching stores.
 */

import type { TextBlockMedia } from '$shared/types/content-block';
import { intentFileImageUrlToWorkspaceFileUrl } from './workspace-file-image';

export const IMAGE_SIZED_ATTR = 'data-image-sized';

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

/** Mirror marked's `cleanUrl`: `encodeURI` with already-encoded `%` preserved. */
function markedRenderedHref(src: string): string | null {
  try {
    return encodeURI(src).replace(/%25/g, '%');
  } catch {
    return null;
  }
}

/** Strip the `?v=` cache token stamped on rewritten workspace-file image URLs. */
function stripWorkspaceFileVersion(src: string): string {
  return src.startsWith('workspace-file://') ? src.split(/[?#]/)[0] : src;
}

/**
 * Every rendered `src` form a `media` key may take, mapped back to its
 * dimensions: the key itself, marked's URI-encoded form, and (for intent file
 * links) the rewritten `workspace-file://` URL.
 */
function renderedSourceIndex(
  media: TextBlockMedia,
  workspaceId?: string,
): Map<string, { width: number; height: number }> {
  const index = new Map<string, { width: number; height: number }>();
  for (const [key, dims] of Object.entries(media)) {
    if (!dims || !isPositiveInteger(dims.width) || !isPositiveInteger(dims.height)) continue;
    const entry = { width: dims.width, height: dims.height };
    const candidates = new Set<string>([key]);
    const encoded = markedRenderedHref(key);
    if (encoded) candidates.add(encoded);
    for (const candidate of [...candidates]) {
      const workspaceFile = intentFileImageUrlToWorkspaceFileUrl(candidate, workspaceId);
      if (workspaceFile) candidates.add(workspaceFile);
    }
    for (const candidate of candidates) {
      if (!index.has(candidate)) index.set(candidate, entry);
    }
  }
  return index;
}

/**
 * Add `width`/`height` (and the `data-image-sized` marker) to every `<img>`
 * whose source matches a `media` key. Images that already carry a `width` or
 * `height` attribute, and images with no matching entry, are returned as-is,
 * so HTML rendered from a block without `media` is byte-identical.
 */
export function stampMarkdownImageDimensions(
  html: string,
  media: TextBlockMedia | undefined,
  workspaceId?: string,
): string {
  if (!media || !html.includes('<img')) return html;
  const index = renderedSourceIndex(media, workspaceId);
  if (index.size === 0) return html;

  return html.replace(/<img\b[^>]*>/gi, (match) => {
    if (/\s(?:width|height)="/i.test(match)) return match;
    const srcMatch = /\ssrc="([^"]*)"/i.exec(match);
    if (!srcMatch) return match;
    // Sanitized attribute values entity-encode ampersands.
    const src = stripWorkspaceFileVersion(srcMatch[1].replace(/&amp;/g, '&'));
    const dims = index.get(src);
    if (!dims) return match;
    return match.replace(
      /\s*\/?>$/,
      ` width="${dims.width}" height="${dims.height}" ${IMAGE_SIZED_ATTR}="">`,
    );
  });
}
