/**
 * Shared utilities for converting HTML comment anchors to span elements.
 *
 * Used by both the main-thread markdown processor and the Web Worker.
 * All functions here are pure string operations — no DOM required.
 */

/**
 * Regular expression to match comment anchors in HTML comments.
 * Matches patterns like: <!--anchor:cmt-123:start-->
 *
 * NOTE: This regex uses the global flag. When used with String.replace()
 * this is fine, but do NOT use it with .test() or .exec() without resetting
 * lastIndex, as the global flag makes it stateful.
 */
export const ANCHOR_COMMENT_REGEX = /<!--\s*anchor:([^:]+):([^-]+)\s*-->/g;

/**
 * Convert HTML comment anchors to invisible span elements.
 *
 * Transforms: <!--anchor:cmt-123:start--> →
 *   <span data-anchor-id="cmt-123:start" data-anchor-type="start" data-comment-id="cmt-123" style="display:none"></span>
 *
 * This is used after marked.parse() to convert comment anchors (which survive
 * markdown parsing) into span elements that TipTap can parse as commentAnchor nodes.
 */
export function convertHTMLCommentsToSpanAnchors(html: string): string {
  return html.replace(ANCHOR_COMMENT_REGEX, (_match, commentId, anchorType) => {
    const fullId = `${commentId}:${anchorType}`;
    return `<span data-anchor-id="${fullId}" data-anchor-type="${anchorType}" data-comment-id="${commentId}" style="display:none"></span>`;
  });
}
