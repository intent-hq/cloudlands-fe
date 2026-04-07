/**
 * Web Worker for markdown parsing.
 *
 * Moves the heavy `marked.parse()` call off the main thread so the UI stays
 * responsive (IPC heartbeat, rendering, user input) during large note processing.
 *
 * When `pipeline` options are provided, also runs normalizeAnchorPositions
 * and HTML-comment-to-span conversion — keeping all pure-string work off the
 * main thread.
 *
 * All dependencies used here are pure string operations — no DOM required.
 */
import { createTiptapTaskListMarked } from './tiptap-task-list-extension';
import { normalizeAnchorPositions } from './anchor-normalization';

// Singleton marked instance (same pattern as main thread)
let markedInstance: ReturnType<typeof createTiptapTaskListMarked> | null = null;

function getMarkedInstance() {
  if (!markedInstance) {
    markedInstance = createTiptapTaskListMarked();
  }
  return markedInstance;
}

// ---------- Inline helpers (pure regex, no DOM) ----------

const ANCHOR_COMMENT_REGEX = /<!--\s*anchor:([^:]+):([^-]+)\s*-->/g;

function convertHTMLCommentsToSpanAnchors(html: string): string {
  return html.replace(ANCHOR_COMMENT_REGEX, (_match, commentId, anchorType) => {
    const fullId = `${commentId}:${anchorType}`;
    return `<span data-anchor-id="${fullId}" data-anchor-type="${anchorType}" data-comment-id="${commentId}" style="display:none"></span>`;
  });
}

// ---------- Types ----------

export interface MarkdownWorkerRequest {
  id: number;
  markdown: string;
  /**
   * When provided, run the extended pipeline in the worker:
   *   normalizeAnchorPositions → marked.parse → convertHTMLCommentsToSpanAnchors
   * When omitted, only marked.parse is run (backward-compatible).
   */
  pipeline?: {
    preserveAnchors: boolean;
  };
}

export interface MarkdownWorkerResponse {
  id: number;
  html: string | null;
  error: string | null;
}

// ---------- Message handler ----------

self.onmessage = async (event: MessageEvent<MarkdownWorkerRequest>) => {
  const { id, markdown, pipeline } = event.data;
  try {
    const marked = getMarkedInstance();

    if (pipeline) {
      // Extended pipeline: normalize → legacy syntax → parse → convert anchors
      let content = pipeline.preserveAnchors
        ? normalizeAnchorPositions(markdown)
        : markdown;

      // Parse markdown
      let html = await marked.parse(content);

      // Convert HTML comment anchors to span elements
      if (pipeline.preserveAnchors) {
        html = convertHTMLCommentsToSpanAnchors(html);
      }

      self.postMessage({ id, html, error: null } satisfies MarkdownWorkerResponse);
    } else {
      // Simple mode: just marked.parse (backward compatible)
      const html = await marked.parse(markdown);
      self.postMessage({ id, html, error: null } satisfies MarkdownWorkerResponse);
    }
  } catch (error) {
    self.postMessage({
      id,
      html: null,
      error: error instanceof Error ? error.message : String(error),
    } satisfies MarkdownWorkerResponse);
  }
};
