import { Logger } from '$shared/logger';
import { createTiptapTaskListMarked } from './tiptap-task-list-extension';
import { marked } from 'marked';
import { normalizeAnchorPositions } from './anchor-normalization';
import { sanitizeMarkdownHTML } from './html-sanitizer';
import { toPromptToken } from '$lib/services/mentions/format';
import { NotesPrimitivesSerializer } from '$features/notes/notes-primitives-serializer';
import type { MarkdownWorkerResponse } from './markdown-worker';

const logger = new Logger('MarkdownProcessor');
const primitivesSerializer = new NotesPrimitivesSerializer();

/**
 * Regex to match YAML front matter at the very beginning of a markdown document.
 * Matches: --- (newline) ...yaml content... (newline) --- (newline or EOF)
 * The front matter must start at the very first character of the string.
 */
const FRONT_MATTER_REGEX = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * Extract YAML front matter from the beginning of a markdown string.
 * Returns the front matter block (including delimiters) and the remaining body.
 * If no front matter is found, frontMatter is null and body is the original content.
 */
export function extractFrontMatter(content: string): {
  frontMatter: string | null;
  body: string;
} {
  const match = content.match(FRONT_MATTER_REGEX);
  if (match) {
    return {
      frontMatter: match[0],
      body: content.slice(match[0].length),
    };
  }
  return { frontMatter: null, body: content };
}

/**
 * Yield to the macrotask queue, allowing the browser to process IPC responses,
 * render frames, and handle user input between heavy processing steps.
 * Unlike `await Promise.resolve()`, this actually yields to the event loop.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Threshold in characters above which we insert yield points during processing */
const LARGE_CONTENT_THRESHOLD = 5000;

// ---------- Web Worker for offloading marked.parse() ----------

let markdownWorker: Worker | null = null;
let workerRequestId = 0;
const workerCallbacks = new Map<
  number,
  { resolve: (html: string) => void; reject: (err: Error) => void }
>();

/**
 * Get or create the singleton markdown worker.
 * The worker runs marked.parse() off the main thread, preventing the 14+ second
 * UI freeze for large notes.
 */
function getMarkdownWorker(): Worker {
  if (!markdownWorker) {
    markdownWorker = new Worker(
      new URL('./markdown-worker.ts', import.meta.url),
      { type: 'module' },
    );
    markdownWorker.onmessage = (event: MessageEvent<MarkdownWorkerResponse>) => {
      const { id, html, error } = event.data;
      const callback = workerCallbacks.get(id);
      if (callback) {
        workerCallbacks.delete(id);
        if (error) {
          callback.reject(new Error(error));
        } else {
          callback.resolve(html!);
        }
      }
    };
    markdownWorker.onerror = (event) => {
      logger.error('[markdown-worker] Worker error', { message: event.message });
    };
  }
  return markdownWorker;
}

/** Timeout (ms) for worker markdown parsing before falling back to main thread. */
const WORKER_TIMEOUT_MS = 30_000;

/**
 * Run the full markdown pipeline on the main thread.
 * Replicates the same steps as the Web Worker:
 *   normalizeAnchorPositions → legacy @@@task syntax → marked.parse → convertHTMLCommentsToSpanAnchors
 * Used as a fallback when the worker times out or fails to initialise.
 */
async function parseMarkdownMainThread(
  markdown: string,
  pipeline?: { preserveAnchors: boolean },
): Promise<string> {
  let content = pipeline?.preserveAnchors
    ? normalizeAnchorPositions(markdown)
    : markdown;

  // Convert @@@task blocks to ```task blocks for backward compatibility
  content = content.replace(/^@@@tasks?[ \t]*\r?\n([\s\S]*?)@@@/gm, '```task\n$1```');

  const markedInst = getMarkedInstance();
  let html = await markedInst.parse(content);

  if (pipeline?.preserveAnchors) {
    html = convertHTMLCommentsToSpanAnchors(html);
  }

  return html;
}

/**
 * Parse markdown in a Web Worker (off-main-thread).
 * Falls through to main-thread parsing if the worker fails to initialise.
 * Times out after WORKER_TIMEOUT_MS to prevent hanging if the worker crashes.
 */
function parseMarkdownInWorker(
  markdown: string,
  pipeline?: { preserveAnchors: boolean },
): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const id = workerRequestId++;
      let settled = false;

      const timeoutHandle = setTimeout(() => {
        if (settled) return;
        settled = true;
        workerCallbacks.delete(id);
        logger.warn('[markdown-worker] Worker timed out, falling back to main thread', {
          id,
          markdownLength: markdown.length,
          timeoutMs: WORKER_TIMEOUT_MS,
        });
        // Fall back to main-thread parsing with full pipeline
        parseMarkdownMainThread(markdown, pipeline).then(resolve, reject);
      }, WORKER_TIMEOUT_MS);

      workerCallbacks.set(id, {
        resolve: (html) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutHandle);
          resolve(html);
        },
        reject: (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutHandle);
          reject(err);
        },
      });
      getMarkdownWorker().postMessage({ id, markdown, pipeline });
    } catch (err) {
      // Worker failed to create — fall back to main thread with full pipeline
      logger.warn('[markdown-worker] Failed to post to worker, falling back to main thread', err);
      parseMarkdownMainThread(markdown, pipeline).then(resolve, reject);
    }
  });
}

// ---------- Fast string hash (cyrb53) for cache keys ----------

/**
 * Fast, high-quality string hash (cyrb53 variant).
 * Produces a 53-bit numeric hash encoded as a base-36 string.
 * Much cheaper than storing full 18 KB content strings as Map keys.
 */
function fastHash(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// LRU cache for processed markdown - avoids re-processing identical content
const MARKDOWN_CACHE_SIZE = 200;
const markdownCache = new Map<string, string>();
const markdownCacheOrder: string[] = [];

/**
 * Get cached result or null if not cached
 */
function getCachedMarkdown(key: string): string | null {
  const result = markdownCache.get(key);
  if (result !== undefined) {
    // Move to end of order (most recently used)
    const idx = markdownCacheOrder.indexOf(key);
    if (idx > -1) {
      markdownCacheOrder.splice(idx, 1);
      markdownCacheOrder.push(key);
    }
    return result;
  }
  return null;
}

/**
 * Cache a processed markdown result
 */
function setCachedMarkdown(key: string, value: string): void {
  if (markdownCache.has(key)) {
    markdownCache.set(key, value);
    return;
  }

  // Evict oldest if at capacity
  while (markdownCacheOrder.length >= MARKDOWN_CACHE_SIZE) {
    const oldest = markdownCacheOrder.shift();
    if (oldest) markdownCache.delete(oldest);
  }

  markdownCache.set(key, value);
  markdownCacheOrder.push(key);
}

/**
 * Clear the markdown cache (useful for debugging)
 */
export function clearMarkdownCache(): void {
  markdownCache.clear();
  markdownCacheOrder.length = 0;
}

/**
 * Regular expression to match comment anchors in HTML comments
 * Matches patterns like: <!--anchor:cmt-123:start-->
 */
const ANCHOR_COMMENT_REGEX = /<!--\s*anchor:([^:]+):([^-]+)\s*-->/g;

/**
 * Regular expression to match ws-block code blocks
 * Matches patterns like: ```ws-block:reference
 */
const WS_BLOCK_REGEX = /```ws-block(?::[a-z_]+)?\n[\s\S]*?\n```/g;

/**
 * Escape angle brackets that look like HTML tags.
 * This prevents user content like <COMPANY>Adobe</COMPANY> or <strong>text</strong>
 * from being interpreted as HTML. Users should use markdown syntax instead
 * (e.g., **bold** for bold text).
 *
 * Preserves:
 * - HTML comments (<!-- ... -->) - used internally for anchors
 * - Content inside code blocks (both inline ` and fenced ```)
 *
 * @param content - The markdown content to process
 * @returns Content with HTML-like tags escaped (except in code blocks)
 */
function escapeHtmlTags(content: string): string {
  // Step 1: Extract code blocks to preserve their content
  const codeBlocks: string[] = [];
  let processedContent = content;

  // Extract fenced code blocks first (they can contain backticks)
  // Match: ```lang\ncode\n``` or ```\ncode\n```
  processedContent = processedContent.replace(/```[\s\S]*?```/g, (match) => {
    const index = codeBlocks.length;
    codeBlocks.push(match);
    return `__CODE_BLOCK_${index}__`;
  });

  // Extract inline code (single backticks)
  // Match: `code` but not `` (empty)
  processedContent = processedContent.replace(/`([^`]+)`/g, (match) => {
    const index = codeBlocks.length;
    codeBlocks.push(match);
    return `__CODE_BLOCK_${index}__`;
  });

  // Step 2: Escape HTML tags in the remaining text
  // Match potential HTML tags: <tagname>, </tagname>, <tagname />, <tagname attr="value">
  // But NOT HTML comments which start with <!-- (the regex requires a letter after optional /)
  processedContent = processedContent.replace(
    /<(\/?)\s*([a-zA-Z][a-zA-Z0-9_-]*)(\s*)([^>]*?)(\/?)>/g,
    (_match, closingSlash, tagName, whitespace, attributes, selfClosingSlash) => {
      // Escape all angle brackets that look like HTML tags
      // Preserve whitespace between tag name and attributes
      return `&lt;${closingSlash}${tagName}${whitespace}${attributes}${selfClosingSlash}&gt;`;
    },
  );

  // Step 3: Restore code blocks
  processedContent = processedContent.replace(/__CODE_BLOCK_(\d+)__/g, (_match, index) => {
    return codeBlocks[parseInt(index, 10)];
  });

  return processedContent;
}

/**
 * Centralized markdown processing utility
 *
 * This module provides a single, consistent way to process markdown across the entire application.
 * It uses our custom Tiptap task list extension to ensure task lists are rendered correctly.
 */

// Create a singleton instance of the marked processor
let markedInstance: ReturnType<typeof createTiptapTaskListMarked> | null = null;

/**
 * Get the singleton marked instance with Tiptap task list support
 */
function getMarkedInstance() {
  if (!markedInstance) {
    markedInstance = createTiptapTaskListMarked();
  }
  return markedInstance;
}

/**
 * Process ws-block and diagram primitives in markdown content
 * Converts ws-block and diagram code blocks to placeholder divs that TipTap can recognize
 * Also handles bare code blocks that contain primitive-like JSON (for recovery from corrupted saves)
 */
function processWsBlocks(content: string): string {
  // Check if there are any ws-blocks, diagram blocks, or potential bare code blocks with primitives
  const hasWsBlocks = content.includes('```ws-block');
  const hasDiagramBlocks = content.includes('```diagram');
  // Also check for bare code blocks that might contain primitive JSON
  const hasBareCodeBlocks = content.includes('```\n{');

  if (!hasWsBlocks && !hasDiagramBlocks && !hasBareCodeBlocks) {
    return content;
  }

  // Parse primitives from the markdown (serializer now handles ws-blocks, diagram blocks, and bare code blocks)
  const primitives = primitivesSerializer.parseMarkdown(content);

  logger.debug('[markdown-processor] processWsBlocks:', {
    hasWsBlocks,
    hasDiagramBlocks,
    hasBareCodeBlocks,
    primitivesFound: primitives.length,
    primitiveTypes: primitives.map((p) => p.primitive.type),
  });

  if (primitives.length === 0) {
    if (hasWsBlocks || hasDiagramBlocks) {
      logger.warn(
        '[markdown-processor] ws-blocks or diagram blocks found but no primitives parsed',
        {
          contentPreview: content.substring(0, 500),
        },
      );
    }
    return content;
  }

  // Replace ws-block code blocks with placeholder divs
  let processedContent = content;

  // Sort primitives by start line in reverse order to replace from end to start
  const sortedPrimitives = [...primitives].sort((a, b) => b.startLine - a.startLine);

  for (const parsed of sortedPrimitives) {
    const { primitive, rawContent } = parsed;

    // Create a placeholder div that TipTap will convert to the appropriate node
    // Base64 encode the JSON to avoid escaping issues with DOMPurify
    // Use TextEncoder to handle Unicode characters (btoa only supports Latin1)
    const primitiveJson = JSON.stringify(primitive);
    const bytes = new TextEncoder().encode(primitiveJson);
    let binaryString = '';
    for (let i = 0; i < bytes.length; i++) {
      binaryString += String.fromCharCode(bytes[i]);
    }
    const primitiveBase64 = btoa(binaryString);
    const placeholder = `<div data-primitive-type="${primitive.type}" data-primitive-id="${primitive.id}" data-primitive-base64="${primitiveBase64}"></div>`;

    logger.debug('[markdown-processor] Replacing ws-block:', {
      type: primitive.type,
      id: primitive.id,
      rawContentPreview: rawContent.substring(0, 100),
    });

    // Check if this is a corrupted primitive block (text before the fence)
    // If so, preserve the text before the fence as a separate paragraph
    const wsBlockIndex = rawContent.indexOf('```ws-block');
    const diagramIndex = rawContent.indexOf('```diagram');
    const fenceIndex = wsBlockIndex >= 0 ? wsBlockIndex : diagramIndex;

    if (fenceIndex > 0) {
      const textBeforeFence = rawContent.substring(0, fenceIndex).trim();
      if (textBeforeFence) {
        logger.info(
          '[markdown-processor] Recovering text before corrupted primitive block fence:',
          {
            textBeforeFence: textBeforeFence.substring(0, 100),
            primitiveId: primitive.id,
            primitiveType: primitive.type,
          },
        );
        // Replace with the text as a paragraph, followed by the placeholder
        const recoveredContent = `${textBeforeFence}\n\n${placeholder}`;
        processedContent = processedContent.replace(rawContent, recoveredContent);
        continue;
      }
    }

    // Replace the primitive block with the placeholder
    processedContent = processedContent.replace(rawContent, placeholder);
  }

  return processedContent;
}

/**
 * Process markdown content to HTML with Tiptap task list support
 *
 * @param content - The markdown content to process
 * @param options - Optional processing options
 * @returns Promise<string> - The processed HTML content
 */
export async function processMarkdownToHTML(
  content: string,
  options: {
    /** Whether to treat empty content as empty string instead of <p></p> */
    allowEmpty?: boolean;
    /** Whether to skip processing if content already looks like HTML */
    skipIfHTML?: boolean;
    /** Whether to preserve comment anchors */
    preserveAnchors?: boolean;
    /** Whether to process ws-block primitives */
    processPrimitives?: boolean;
  } = {},
): Promise<string> {
  const {
    allowEmpty = true,
    skipIfHTML = true,
    preserveAnchors = true,
    processPrimitives = true,
  } = options;

  // Handle empty content
  if (!content || content.trim() === '') {
    return allowEmpty ? '' : '<p></p>';
  }

  // Handle special empty HTML cases
  if (content.trim() === '<p></p>') {
    return allowEmpty ? '' : '<p></p>';
  }

  // Skip processing if content already looks like HTML (but not if it's just anchor comments)
  if (skipIfHTML && content.trim().startsWith('<') && !content.trim().startsWith('<!--anchor:')) {
    // But don't skip if content has ws-blocks that need processing
    if (content.includes('```ws-block')) {
      logger.debug('Content looks like HTML but has ws-blocks, processing anyway');
    } else {
      return content;
    }
  }

  // Check cache first — use a fast hash + length instead of the full content string as key.
  // Including content.length virtually eliminates hash collision risk (different-length
  // strings that produce the same 53-bit hash would be needed).
  const cacheKey = `${fastHash(content)}:${content.length}|${allowEmpty}|${skipIfHTML}|${preserveAnchors}|${processPrimitives}`;
  const cached = getCachedMarkdown(cacheKey);
  if (cached !== null) {
    return cached;
  }

  try {
    const isLargeContent = content.length > LARGE_CONTENT_THRESHOLD;
    const t0 = isLargeContent ? performance.now() : 0;

    if (isLargeContent) {
      logger.info('[markdown-processor] Processing large content', {
        contentLength: content.length,
      });
    }

    // --- Main-thread preprocessing (quick, needs main-thread deps) ---

    // Strip YAML front matter before any processing — marked doesn't understand it
    // and will corrupt the --- delimiters (treating them as <hr> / headings).
    // The front matter is not renderable content so we simply discard it from the HTML output.
    const { body: contentWithoutFrontMatter } = extractFrontMatter(content);

    // Escape HTML-like tags FIRST, before any processing that generates HTML
    // This prevents user content like <COMPANY>Adobe</COMPANY> from being interpreted as HTML
    const contentWithEscapedTags = escapeHtmlTags(contentWithoutFrontMatter);
    const t1 = isLargeContent ? performance.now() : 0;

    // Process ws-block primitives (needs NotesPrimitivesSerializer, must run on main thread)
    let processedContent = contentWithEscapedTags;
    if (processPrimitives) {
      processedContent = processWsBlocks(contentWithEscapedTags);

      // Debug: Check if primitive blocks were processed
      const hasWsBlocksInInput = contentWithEscapedTags.includes('```ws-block');
      const hasDiagramBlocksInInput = contentWithEscapedTags.includes('```diagram');
      const hasPrimitiveDivsInOutput = processedContent.includes('data-primitive-type');
      if (hasWsBlocksInInput || hasDiagramBlocksInInput) {
        logger.debug('[markdown-processor] processWsBlocks result:', {
          hasWsBlocksInInput,
          hasDiagramBlocksInInput,
          hasPrimitiveDivsInOutput,
          inputPreview: contentWithEscapedTags.substring(0, 300),
          outputPreview: processedContent.substring(0, 300),
        });
      }
    }
    const t2 = isLargeContent ? performance.now() : 0;

    // --- Worker pipeline (normalize → legacy syntax → marked.parse → anchor conversion) ---
    // For large content, all pure-string operations run off the main thread in the worker.
    // For small content, everything stays on the main thread (fast enough).

    let htmlOut: string;
    if (isLargeContent) {
      // Offload normalize + legacy syntax + marked.parse + anchor conversion to worker
      htmlOut = await parseMarkdownInWorker(processedContent, { preserveAnchors });
    } else {
      // Small content: run everything on main thread
      const normalizedContent = preserveAnchors
        ? normalizeAnchorPositions(processedContent)
        : processedContent;

      const contentWithLegacySyntax = normalizedContent.replace(
        /^@@@tasks?[ \t]*\r?\n([\s\S]*?)@@@/gm,
        '```task\n$1```',
      );

      const markedInst = getMarkedInstance();
      const result = await markedInst.parse(contentWithLegacySyntax);
      htmlOut = preserveAnchors ? convertHTMLCommentsToSpanAnchors(result) : result;
    }
    const t4 = isLargeContent ? performance.now() : 0;

    // --- Main-thread postprocessing (needs DOM) ---

    // Convert canonical @-tokens to mention chips so TipTap re-parses them as mentions
    htmlOut = injectMentionSpans(htmlOut);
    const t5 = isLargeContent ? performance.now() : 0;

    // Debug: Check if primitive divs survived marked parsing
    const hasPrimitiveDivsBeforeSanitize = htmlOut.includes('data-primitive-type');

    // Yield before sanitization for large content (CPU-heavy DOMPurify pass)
    if (isLargeContent) await yieldToEventLoop();

    // Sanitize the HTML to prevent XSS
    htmlOut = sanitizeMarkdownHTML(htmlOut);
    const t6 = isLargeContent ? performance.now() : 0;

    // Debug: Check if primitive divs survived sanitization
    const hasPrimitiveDivsAfterSanitize = htmlOut.includes('data-primitive-type');
    if (hasPrimitiveDivsBeforeSanitize && !hasPrimitiveDivsAfterSanitize) {
      logger.warn('[markdown-processor] Primitive divs were stripped during sanitization');
    }

    if (isLargeContent) {
      logger.info('[markdown-processor] Step timings (ms)', {
        escapeHtml: Math.round(t1 - t0),
        wsBlocks: Math.round(t2 - t1),
        workerPipeline: Math.round(t4 - t2),
        mentions: Math.round(t5 - t4),
        sanitize: Math.round(t6 - t5),
        total: Math.round(t6 - t0),
        contentLength: content.length,
        usedWorker: isLargeContent,
      });
    }

    // Cache the result before returning
    setCachedMarkdown(cacheKey, htmlOut);
    return htmlOut;
  } catch (error) {
    logger.error('[markdown-processor] Failed to parse markdown:', error as Error);
    // Fallback to wrapping in paragraph
    const fallback = `<p>${content}</p>`;
    setCachedMarkdown(cacheKey, fallback);
    return fallback;
  }
}

/**
 * Process markdown content to HTML for chat/display purposes
 * This variant uses the same marked instance to ensure consistency across the app
 *
 * @param content - The markdown content to process
 * @returns string - The processed HTML content
 */
export async function processMarkdownForDisplay(content: string): Promise<string> {
  try {
    // Escape HTML-like tags to prevent them from being interpreted as HTML
    const contentWithEscapedTags = escapeHtmlTags(content);

    // Use the same marked instance for display purposes
    // This ensures consistent markdown processing across the app
    const marked = getMarkedInstance();
    const result = await marked.parse(contentWithEscapedTags);
    // Sanitize the HTML to prevent XSS
    return sanitizeMarkdownHTML(result);
  } catch (error) {
    logger.error('[markdown-processor] Failed to parse markdown for display:', error as Error);
    return content;
  }
}

/**
 * Check if content appears to be HTML
 */
export function isHTML(content: string): boolean {
  return content.trim().startsWith('<');
}

/**
 * Check if content is effectively empty
 */
export function isEmpty(content: string): boolean {
  return !content || content.trim() === '' || content.trim() === '<p></p>';
}

/**
 * V3: Convert HTML comment anchors directly to span elements
 * This replaces the old meta tag approach which didn't work because marked strips meta tags.
 *
 * <!--anchor:cmt-123:start--> → <span data-anchor-id="cmt-123:start" data-anchor-type="start" data-comment-id="cmt-123"></span>
 */
function convertHTMLCommentsToSpanAnchors(html: string): string {
  // Use regex approach for reliability across environments (works in Node, browser, and test environments)
  return html.replace(ANCHOR_COMMENT_REGEX, (match, commentId, anchorType) => {
    const fullId = `${commentId}:${anchorType}`;
    return `<span data-anchor-id="${fullId}" data-anchor-type="${anchorType}" data-comment-id="${commentId}" style="display:none"></span>`;
  });
}

/**
 * Inject mention chips into HTML by converting canonical @-tokens to <span data-mention> elements
 * so TipTap re-parses them as mention nodes.
 * - Skips inside code/pre/script/style tags
 */
function injectMentionSpans(html: string): string {
  if (typeof document === 'undefined') return html;
  const container = document.createElement('div');
  // The HTML here is generated by our own pipeline (marked.parse + regex transforms).
  // The caller (processMarkdownToHTML) sanitizes with DOMPurify *after* this function
  // returns, so we skip the redundant sanitization here to avoid a double DOMPurify pass
  // that was costing ~200-400ms on large notes.
  container.innerHTML = html;

  const BLOCK_TAGS = new Set(['CODE', 'PRE', 'SCRIPT', 'STYLE']);

  const createMentionSpan = (attrs: {
    type: string;
    id?: string;
    label: string;
    meta?: any;
    uri?: string;
  }): HTMLElement => {
    const span = document.createElement('span');
    span.setAttribute('data-mention', 'true');
    span.setAttribute('data-type', attrs.type);
    if (attrs.id) span.setAttribute('data-id', attrs.id);
    span.setAttribute('data-label', attrs.label);
    if (attrs.uri) span.setAttribute('data-uri', attrs.uri);
    span.setAttribute('data-meta', JSON.stringify(attrs.meta || {}));
    span.className = 'mention-chip';
    span.textContent = attrs.label;
    return span;
  };

  const noteRe = /@note\/([A-Za-z0-9\-_]+)/g;
  const rulesRe = /@\.augment\/rules\/[^\s<>()'\"]+/g;
  const fileRe = /@\/[^\s<>()'\"]+/g; // '@/absolute/path' until whitespace or delimiter
  // Match @path/to/file.ext (relative paths with at least one slash and a file extension)
  const relativeFileRe = /@([A-Za-z0-9._-]+\/[^\s<>()'\"]+\.[A-Za-z0-9]+)/g;
  const personaRe = /@auggie\-personality\-[\w\-]+/g;
  const simpleFileNameRe = /@([A-Za-z0-9._-]+\.[A-Za-z0-9._-]+)/g;
  // Heuristic: bare filenames (no leading @) for common file extensions, outside code/pre
  const bareFileNameRe =
    /\b([A-Za-z0-9][A-Za-z0-9._-]+\.(?:json|js|ts|tsx|jsx|md|mdx|yaml|yml|svelte|html|css|scss|py|go|rs|rb|java|kt|swift|m|mm|hpp|h|hh|c|cc|cpp|sh|toml|lock|ini|conf|txt|csv|sql))\b/g;
  // Heuristic: bare paths (dir/subdir/file.ext without @ prefix) for common file extensions
  // Must have at least one slash to distinguish from bare filenames
  const barePathRe =
    /\b([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+\.(?:json|js|ts|tsx|jsx|md|mdx|yaml|yml|svelte|html|css|scss|py|go|rs|rb|java|kt|swift|m|mm|hpp|h|hh|c|cc|cpp|sh|toml|lock|ini|conf|txt|csv|sql))\b/g;
  // Match absolute paths to workspace notes: /path/intent/xxx/.workspace/notes/yyy.json (also legacy .workspaces)
  const workspaceNotePathRe =
    /\/[^\s<>()'\"]*(?:intent|\.workspaces)\/[a-f0-9-]+\/\.workspace\/notes\/([a-f0-9-]+)\.json/g;
  // Match intent:// protocol URLs for notes
  // Formats: intent://local/note/{note-id} or intent://local/{workspace-id}/note/{note-id}
  const intentUrlRe = /intent:\/\/[^\s<>()'\"]+/g;
  // Match context mentions: @context[...] where content can be:
  // - Base64 format (new): @context[base64encodedJson] - safe, no special char issues
  // - Legacy pipe format: @context[provider|identifier|title] - for backward compatibility
  // Base64 uses only [A-Za-z0-9+/=], legacy uses pipes and brackets
  const contextMentionRe = /@context\[([A-Za-z0-9+/=]+|[^\[\]]*(?:\[[^\]]*\][^\[\]]*)*)\]/g;

  const processTextNode = (textNode: Text) => {
    const text = textNode.nodeValue || '';
    let idx = 0;
    const frag = document.createDocumentFragment();

    // Helper to push plain text segment
    const pushText = (end: number) => {
      if (end > idx) frag.appendChild(document.createTextNode(text.slice(idx, end)));
    };

    // Find the earliest next match among our patterns
    const nextMatch = (): {
      start: number;
      end: number;
      type: string;
      value: string;
      groups?: string[];
    } | null => {
      const find = (re: RegExp) => {
        re.lastIndex = 0;
        const m = re.exec(text.slice(idx));
        if (!m) return null;
        return {
          start: idx + m.index,
          end: idx + m.index + m[0].length,
          match: m[0],
          groups: m.slice(1),
        };
      };
      const cands: Array<{
        start: number;
        end: number;
        match: string;
        groups?: string[];
        kind: string;
      }> = [];
      const n = find(noteRe);
      if (n) cands.push({ ...n, kind: 'note' });
      const r = find(rulesRe);
      if (r) cands.push({ ...r, kind: 'rule' });
      const f = find(fileRe);
      if (f) cands.push({ ...f, kind: 'file' });
      const rf = find(relativeFileRe);
      if (rf) cands.push({ ...rf, kind: 'relative-file' });
      const sf = find(simpleFileNameRe);
      if (sf) cands.push({ ...sf, kind: 'simple-file' });
      const bf = find(bareFileNameRe);
      if (bf) cands.push({ ...bf, kind: 'bare-file' });
      const bp = find(barePathRe);
      if (bp) cands.push({ ...bp, kind: 'bare-path' });
      const p = find(personaRe);
      if (p) cands.push({ ...p, kind: 'personality' });
      const wnp = find(workspaceNotePathRe);
      if (wnp) cands.push({ ...wnp, kind: 'workspace-note-path' });
      const wu = find(intentUrlRe);
      if (wu) cands.push({ ...wu, kind: 'intent-url' });
      const cm = find(contextMentionRe);
      if (cm) cands.push({ ...cm, kind: 'context-mention' });
      if (!cands.length) return null;
      cands.sort((a, b) => a.start - b.start);
      const m = cands[0];
      return { start: m.start, end: m.end, type: m.kind, value: m.match, groups: m.groups };
    };

    while (true) {
      const m = nextMatch();
      if (!m) break;
      // Append text before match
      pushText(m.start);

      // Create mention span
      if (m.type === 'note') {
        const id = m.groups?.[0] || '';
        frag.appendChild(createMentionSpan({ type: 'note', id, label: id }));
      } else if (m.type === 'rule') {
        const path = m.value.slice(1); // drop '@'
        const label = path.split('/').pop() || path;
        frag.appendChild(createMentionSpan({ type: 'rule', id: path, label, meta: { path } }));
      } else if (m.type === 'file') {
        const fullPath = m.value.slice(1);
        // Use full path as label so users can distinguish files with the same name
        frag.appendChild(
          createMentionSpan({ type: 'file', id: fullPath, label: fullPath, meta: { fullPath } }),
        );
      } else if (m.type === 'relative-file') {
        // Handle @path/to/file.ext (relative paths)
        // Also clean up any stray @ symbols in path segments (from previous corruption)
        const rawPath = m.groups?.[0] || m.value.slice(1);
        const fullPath = rawPath
          .split('/')
          .map((seg) => (seg.startsWith('@') ? seg.slice(1) : seg))
          .join('/');
        // Use full path as label so users can distinguish files with the same name
        frag.appendChild(
          createMentionSpan({ type: 'file', id: fullPath, label: fullPath, meta: { fullPath } }),
        );
      } else if (m.type === 'simple-file') {
        // Strip any leading @ from the filename (cleanup from previous corruption)
        const rawFilename = m.groups?.[0] || m.value.slice(1);
        const filename = rawFilename.startsWith('@') ? rawFilename.slice(1) : rawFilename;
        frag.appendChild(
          createMentionSpan({ type: 'file', id: filename, label: filename, meta: { filename } }),
        );
      } else if (m.type === 'bare-file') {
        // Strip any leading @ from the filename (cleanup from previous corruption)
        const rawFilename = m.groups?.[0] || '';
        const filename = rawFilename.startsWith('@') ? rawFilename.slice(1) : rawFilename;
        if (filename) {
          frag.appendChild(
            createMentionSpan({ type: 'file', id: filename, label: filename, meta: { filename } }),
          );
        } else {
          pushText(m.end);
        }
      } else if (m.type === 'bare-path') {
        // Handle bare paths like dir/subdir/file.ext (paths without @ prefix)
        const fullPath = m.groups?.[0] || m.value;
        if (fullPath) {
          frag.appendChild(
            createMentionSpan({
              type: 'file',
              id: fullPath,
              label: fullPath,
              meta: { fullPath },
            }),
          );
        } else {
          pushText(m.end);
        }
      } else if (m.type === 'personality') {
        const token = m.value.slice(1);
        frag.appendChild(
          createMentionSpan({
            type: 'personality',
            id: token,
            label: token,
            meta: { promptToken: token },
          }),
        );
      } else if (m.type === 'workspace-note-path') {
        // Convert absolute workspace note path to a note reference
        // Extract note ID from the path (last capture group)
        const noteId = m.groups?.[0] || '';
        if (noteId) {
          frag.appendChild(
            createMentionSpan({
              type: 'note',
              id: noteId,
              label: noteId,
              meta: { fullPath: m.value },
            }),
          );
        } else {
          // Fallback: just skip the path (don't show it)
          // Could also render as plain text if needed
        }
      } else if (m.type === 'intent-url') {
        // Convert intent:// URLs to mention pills
        // Parse the URL to extract resource type and ID
        const url = m.value;
        try {
          // Parse intent://local/note/{id} or intent://local/{workspace-id}/note/{id}
          const parsed = new URL(url.replace('intent://', 'http://'));
          const segments = parsed.pathname.replace(/^\/+/, '').split('/').filter(Boolean);

          // Determine format: [note, id] or [workspace-id, note, id]
          let resourceType = 'unknown';
          let resourceId = '';
          let workspaceId = '';

          if (segments[0] === 'note' && segments[1]) {
            // Short format: intent://local/note/{id}
            resourceType = 'note';
            resourceId = segments[1];
          } else if (segments[1] === 'note' && segments[2]) {
            // Long format: intent://local/{workspace-id}/note/{id}
            workspaceId = segments[0];
            resourceType = 'note';
            resourceId = segments[2];
          }

          if (resourceType === 'note' && resourceId) {
            frag.appendChild(
              createMentionSpan({
                type: 'note',
                id: resourceId,
                label: resourceId, // Just show the note ID - cross-workspace status shown via icon/hover
                uri: url,
                meta: { workspaceId, fullUrl: url, isExternalLink: !!workspaceId },
              }),
            );
          } else {
            // Unknown format - render as plain text
            frag.appendChild(document.createTextNode(m.value));
          }
        } catch {
          // Invalid URL - render as plain text
          frag.appendChild(document.createTextNode(m.value));
        }
      } else if (m.type === 'context-mention') {
        // Handle context mentions - can be base64 format or legacy pipe format
        const content = m.groups?.[0] || '';

        let provider = 'browser';
        let identifier = '';
        let title = '';
        let url = '';
        let description = '';
        let metadata = '';
        let itemType = '';

        // Check if it's base64 encoded (no pipes or brackets, only base64 chars)
        const isBase64 = /^[A-Za-z0-9+/=]+$/.test(content) && !content.includes('|');

        if (isBase64) {
          try {
            // Decode base64 to JSON
            const json = decodeURIComponent(escape(atob(content)));
            const parsed = JSON.parse(json);
            provider = parsed.provider || 'browser';
            identifier = parsed.identifier || '';
            title = parsed.title || '';
            url = parsed.url || '';
            description = parsed.description || '';
            metadata = parsed.metadata || '';
            itemType = parsed.itemType || '';
          } catch {
            // Base64/JSON decode failed, fall back to treating as legacy format
          }
        }

        // If not base64 or decode failed, try legacy pipe format
        if (!itemType) {
          const firstPipe = content.indexOf('|');
          const secondPipe = content.indexOf('|', firstPipe + 1);

          if (firstPipe !== -1 && secondPipe !== -1) {
            provider = content.substring(0, firstPipe) || 'browser';
            identifier = content.substring(firstPipe + 1, secondPipe);
            title = content.substring(secondPipe + 1);
          } else if (firstPipe !== -1) {
            provider = content.substring(0, firstPipe) || 'browser';
            identifier = content.substring(firstPipe + 1);
            title = identifier;
          } else {
            identifier = content;
            title = content;
          }

          // Map provider to itemType for legacy format
          const providerToItemType: Record<string, string> = {
            linear: 'linear-issue',
            github: 'github-issue',
            sentry: 'sentry-issue',
            browser: 'browser-url',
          };
          itemType = providerToItemType[provider] || 'browser-url';
        }

        // Create a context mention span that TipTap's ContextMention extension can parse
        const span = document.createElement('span');
        span.setAttribute('data-type', 'context-mention');
        span.setAttribute('data-item-type', itemType);
        span.setAttribute('data-provider', provider);
        span.setAttribute('data-title', title);
        span.setAttribute('data-identifier', identifier);
        if (url) span.setAttribute('data-url', url);
        if (description) span.setAttribute('data-description', description);
        if (metadata) span.setAttribute('data-metadata', metadata);
        span.className = 'context-mention';
        span.textContent = title || identifier || 'Link';
        frag.appendChild(span);
      }

      idx = m.end;
    }

    // Append remaining text
    pushText(text.length);

    // Replace node if anything changed
    if (frag.childNodes.length > 0) {
      textNode.parentNode?.replaceChild(frag, textNode);
    }
  };

  const walk = (node: Node, blocked: boolean) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      const isBlocked =
        blocked ||
        BLOCK_TAGS.has(el.tagName) ||
        el.hasAttribute('data-mention') ||
        el.tagName === 'A';
      for (const child of Array.from(el.childNodes)) {
        walk(child, isBlocked);
      }
    } else if (node.nodeType === Node.TEXT_NODE) {
      if (!blocked) processTextNode(node as Text);
    }
  };

  for (const child of Array.from(container.childNodes)) {
    walk(child, false);
  }

  return container.innerHTML;
}

/**
 * Convert span anchors to HTML comments for markdown
 */
function convertSpanAnchorsToComments(html: string): string {
  const tempDiv = document.createElement('div');
  // Don't sanitize here - we'll sanitize after conversion
  // This preserves the data attributes we need for anchor detection
  tempDiv.innerHTML = html;

  // Find all anchor spans
  const anchors = tempDiv.querySelectorAll('span[data-anchor-id]');
  anchors.forEach((anchor) => {
    const anchorId = anchor.getAttribute('data-anchor-id');
    if (anchorId) {
      const comment = document.createComment(`anchor:${anchorId}`);
      anchor.parentNode?.replaceChild(comment, anchor);
    }
  });

  return tempDiv.innerHTML;
}

/**
 * Convert HTML to markdown with proper task list support and nested list indentation
 */
export function processHTMLToMarkdown(
  html: string,
  options: { preserveAnchors?: boolean } = {},
): string {
  const { preserveAnchors = true } = options;

  // Check for primitive blocks in the HTML
  const hasPrimitiveType = html.includes('data-primitive-type');
  const hasDataType = html.includes('data-type=');
  const hasReferenceBlock = html.includes('reference_block');
  const hasCliBlock = html.includes('cli_block');
  const hasPatchBlock = html.includes('patch_block');
  const hasAgentActionBlock = html.includes('agent_action_block');
  const hasDataPrimitive = html.includes('data-primitive');

  logger.debug('[markdown-processor] processHTMLToMarkdown INPUT:', {
    htmlLength: html.length,
    hasPrimitiveType,
    hasDataType,
    hasReferenceBlock,
    hasCliBlock,
    hasPatchBlock,
    hasAgentActionBlock,
    hasDataPrimitive,
    htmlPreview: html.substring(0, 500),
  });

  if (!html || html.trim() === '<p></p>') {
    logger.debug('[markdown-processor] processHTMLToMarkdown OUTPUT (empty)');
    return '';
  }

  // Convert span anchors to HTML comments first if preserving anchors
  const htmlToProcess = preserveAnchors ? convertSpanAnchorsToComments(html) : html;

  const div = document.createElement('div');
  // Security: Sanitize HTML after anchor conversion if preserving anchors
  // This ensures comments are preserved (DOMPurify would strip them if we sanitized before)
  // For non-anchor preservation, sanitize normally
  if (preserveAnchors) {
    // Don't sanitize yet - we already converted anchors to comments
    div.innerHTML = htmlToProcess;
  } else {
    // Sanitize normally when not preserving anchors
    const sanitized = sanitizeMarkdownHTML(htmlToProcess);
    div.innerHTML = sanitized;
  }

  /**
   * Process inline content (text, comments, inline elements) within a block element
   */
  const processInlineContent = (el: Element): string => {
    let result = '';
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === Node.COMMENT_NODE) {
        // Preserve comment anchors
        const comment = node as Comment;
        if (comment.data.startsWith('anchor:')) {
          result += `<!--${comment.data}-->`;
        }
      } else if (node.nodeType === Node.TEXT_NODE) {
        result += node.textContent || '';
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const childEl = node as Element;
        // Handle inline formatting elements
        if (childEl.tagName === 'STRONG' || childEl.tagName === 'B') {
          result += `**${processInlineContent(childEl)}**`;
        } else if (childEl.tagName === 'EM' || childEl.tagName === 'I') {
          result += `*${processInlineContent(childEl)}*`;
        } else if (childEl.tagName === 'CODE') {
          result += `\`${childEl.textContent || ''}\``;
        } else if (childEl.tagName === 'SPAN') {
          if (childEl.hasAttribute('data-mention')) {
            // Preserve canonical @-token using mention metadata
            const type = childEl.getAttribute('data-type') || '';
            const id = childEl.getAttribute('data-id') || '';
            const label = childEl.getAttribute('data-label') || childEl.textContent || '';
            const metaStr = childEl.getAttribute('data-meta');
            let meta: any = {};
            if (metaStr) {
              try {
                meta = JSON.parse(metaStr);
              } catch {
                meta = {};
              }
            }
            try {
              result += toPromptToken({
                type: type as any,
                id: id || label || '',
                label: label || '',
                meta,
              });
            } catch {
              // Fallback if formatter fails
              result += label ? `@${label}` : '';
            }
          } else {
            // For non-mention spans, process their content (anchors are already converted to comments)
            result += processInlineContent(childEl);
          }
        } else if (childEl.tagName === 'A') {
          const href = childEl.getAttribute('href') || '';
          const text = processInlineContent(childEl);
          if (href) {
            result += `[${text}](${href})`;
          } else {
            result += text;
          }
        } else if (childEl.tagName === 'IMG') {
          // Handle inline images
          const src = childEl.getAttribute('src') || '';
          const alt = childEl.getAttribute('alt') || '';
          const title = childEl.getAttribute('title');
          if (title) {
            result += `![${alt}](${src} "${title}")`;
          } else {
            result += `![${alt}](${src})`;
          }
        } else if (
          childEl.tagName === 'DIV' &&
          (childEl.hasAttribute('data-type') || childEl.hasAttribute('data-primitive-type'))
        ) {
          // Skip primitive block DIVs in inline content - they should be processed as block elements
          // This prevents primitive blocks from being included in paragraph text
          logger.warn(
            '[markdown-processor] Found primitive block DIV inside inline content, skipping',
            {
              dataType: childEl.getAttribute('data-type'),
              primitiveType: childEl.getAttribute('data-primitive-type'),
            },
          );
        } else {
          // For other elements, just get text content
          result += childEl.textContent || '';
        }
      }
    }
    return result;
  };

  /**
   * Get the content of a list item, excluding nested lists, preserving anchors
   * This extracts only the direct text content of the <li>, not its children <ul>/<ol>
   *
   * TipTap structure for task items:
   * <li class="custom-task-item">
   *   <label>...</label>
   *   <div>
   *     <p>Text content</p>
   *     <ul>nested list</ul>  <!-- nested lists are INSIDE the div -->
   *   </div>
   * </li>
   */
  const getListItemTextContent = (li: Element): string => {
    let text = '';

    // Helper to process nodes and preserve comments
    const processNodes = (nodes: NodeListOf<ChildNode> | ChildNode[]): string => {
      let result = '';
      for (const node of Array.from(nodes)) {
        if (node.nodeType === Node.COMMENT_NODE) {
          const comment = node as Comment;
          if (comment.data.startsWith('anchor:')) {
            result += `<!--${comment.data}-->`;
          }
        } else if (node.nodeType === Node.TEXT_NODE) {
          result += node.textContent || '';
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as Element;
          if (el.tagName === 'P') {
            result += processInlineContent(el);
          } else if (el.tagName !== 'UL' && el.tagName !== 'OL') {
            // For other elements (not lists), process inline content
            result += processInlineContent(el);
          }
          // Skip UL/OL - those are nested lists
        }
      }
      return result;
    };

    // For task items, look for the content div (direct child div after label)
    // TipTap wraps content in a <div> that contains both <p> and nested <ul>
    const divs = Array.from(li.children).filter((child) => child.tagName === 'DIV');

    logger.debug('[markdown-processor] getListItemTextContent:', {
      liOuterHTML: li.outerHTML.substring(0, 500),
      divsCount: divs.length,
      divContents: divs.map((d) => ({
        innerHTML: d.innerHTML.substring(0, 200),
        childNodes: Array.from(d.childNodes).map((n) => ({
          type: n.nodeType,
          name: (n as Element).tagName || '#text',
          content: n.textContent?.substring(0, 50),
        })),
      })),
    });

    if (divs.length > 0) {
      const contentDiv = divs[0]; // First div is the content wrapper
      text = processNodes(contentDiv.childNodes);
      logger.debug('[markdown-processor] getListItemTextContent result from div:', {
        text: text.substring(0, 100),
      });
      return text.trim();
    }

    // Fallback: For regular list items, process direct child nodes
    text = processNodes(li.childNodes);
    logger.debug('[markdown-processor] getListItemTextContent result from fallback:', {
      text: text.substring(0, 100),
    });
    return text.trim();
  };

  /**
   * Convert a list element to markdown with proper nesting support
   * @param el - The list element (UL or OL)
   * @param indentLevel - Current indentation level (0 = root)
   * @returns Markdown string with proper indentation
   */
  const convertList = (el: Element, indentLevel: number = 0): string => {
    let result = '';

    // Determine if this is an ordered or unordered list
    const isOrderedList = el.tagName === 'OL';

    // Check if this is a task list (check both class and data-type attribute)
    const isTaskList =
      el.classList.contains('task-list') || el.getAttribute('data-type') === 'taskList';

    // Calculate indentation based on list type:
    // For task lists: 2 spaces per nesting level (matches markdown tests)
    // For ordered lists: 4 spaces per level (required by marked for proper nesting)
    // For regular unordered lists: 2 spaces per level
    let indent = '';
    if (indentLevel > 0) {
      if (isTaskList) {
        // Task lists: 2 spaces for level 1, then 4 spaces for each additional level
        if (indentLevel === 1) {
          indent = '  ';
        } else {
          indent = `  ${'    '.repeat(indentLevel - 1)}`;
        }
      } else if (isOrderedList) {
        // Ordered lists need 4 spaces per level
        indent = '    '.repeat(indentLevel);
      } else {
        // Regular unordered lists use 2 spaces per level
        indent = '  '.repeat(indentLevel);
      }
    }

    // Get only direct children <li> elements, not nested ones
    const directChildren = el.children
      ? Array.from(el.children).filter((child) => child.tagName === 'LI')
      : [];

    logger.debug('[markdown-processor] Processing list:', {
      tagName: el.tagName,
      isTaskList,
      indentLevel,
      directChildrenCount: directChildren.length,
    });

    directChildren.forEach((li, index) => {
      if (
        isTaskList &&
        li.hasAttribute('data-type') &&
        li.getAttribute('data-type') === 'taskItem'
      ) {
        // Handle task list items
        // Use data-checked as the source of truth (TipTap's internal representation)
        const dataChecked = li.getAttribute('data-checked');
        const dataStatus = li.getAttribute('data-status');
        const checkbox = li.querySelector('input[type="checkbox"]') as HTMLInputElement;

        // Determine task state based on data-status or data-checked
        let taskPrefix = '- [ ] ';
        if (dataStatus === 'in-progress') {
          taskPrefix = '- [/] ';
        } else if (dataChecked === 'true' || (dataChecked === null && checkbox?.checked)) {
          taskPrefix = '- [x] ';
        }

        // Get only the direct text content, not nested list content
        const taskText = getListItemTextContent(li);

        // Check for delegated agent ID and serialize as an anchor
        const delegatedAgentId = li.getAttribute('data-delegated-agent-id');
        const agentAnchor = delegatedAgentId ? ` <!--agent:${delegatedAgentId}-->` : '';

        logger.debug('[markdown-processor] Processing task item:', {
          index,
          indentLevel,
          dataChecked,
          dataStatus,
          taskPrefix,
          taskText,
          delegatedAgentId,
        });

        result += `${indent + taskPrefix + taskText}${agentAnchor}\n`;

        // Process nested lists within this list item
        // TipTap puts nested lists inside the <div> wrapper, not as direct children of <li>
        const nestedLists: Element[] = [];

        // First check direct children of <li>
        nestedLists.push(
          ...Array.from(li.children).filter(
            (child) => child.tagName === 'UL' || child.tagName === 'OL',
          ),
        );

        // Also check inside the content <div>
        const divs = Array.from(li.children).filter((child) => child.tagName === 'DIV');
        for (const div of divs) {
          nestedLists.push(
            ...Array.from(div.children).filter(
              (child) => child.tagName === 'UL' || child.tagName === 'OL',
            ),
          );
        }

        for (const nestedList of nestedLists) {
          result += convertList(nestedList, indentLevel + 1);
        }
      } else {
        // Handle regular list items
        const prefix = el.tagName === 'OL' ? `${index + 1}. ` : '- ';
        const itemText = getListItemTextContent(li);

        logger.debug('[markdown-processor] Processing regular list item:', {
          index,
          indentLevel,
          prefix,
          text: itemText,
        });

        result += `${indent + prefix + itemText}\n`;

        // Process nested lists within this list item
        // Check both direct children and inside <div> wrappers
        const nestedLists: Element[] = [];

        // First check direct children of <li>
        nestedLists.push(
          ...Array.from(li.children).filter(
            (child) => child.tagName === 'UL' || child.tagName === 'OL',
          ),
        );

        // Also check inside any <div> wrappers
        const divs = Array.from(li.children).filter((child) => child.tagName === 'DIV');
        for (const div of divs) {
          nestedLists.push(
            ...Array.from(div.children).filter(
              (child) => child.tagName === 'UL' || child.tagName === 'OL',
            ),
          );
        }

        for (const nestedList of nestedLists) {
          result += convertList(nestedList, indentLevel + 1);
        }
      }
    });

    return result;
  };

  /**
   * Convert common elements to markdown
   */
  const convertElement = (el: Element): string => {
    if (el.tagName === 'IMG') {
      // Handle image elements
      const src = el.getAttribute('src') || '';
      const alt = el.getAttribute('alt') || '';
      const title = el.getAttribute('title');
      if (title) {
        return `![${alt}](${src} "${title}")\n\n`;
      }
      return `![${alt}](${src})\n\n`;
    } else if (el.tagName === 'P') {
      return `${processInlineContent(el)}\n\n`;
    } else if (el.tagName === 'H1') {
      return `# ${processInlineContent(el)}\n\n`;
    } else if (el.tagName === 'H2') {
      return `## ${processInlineContent(el)}\n\n`;
    } else if (el.tagName === 'H3') {
      return `### ${processInlineContent(el)}\n\n`;
    } else if (el.tagName === 'H4') {
      return `#### ${processInlineContent(el)}\n\n`;
    } else if (el.tagName === 'H5') {
      return `##### ${processInlineContent(el)}\n\n`;
    } else if (el.tagName === 'H6') {
      return `###### ${processInlineContent(el)}\n\n`;
    } else if (el.tagName === 'UL' || el.tagName === 'OL') {
      // Use the new recursive list converter
      return `${convertList(el, 0)}\n`;
    } else if (el.tagName === 'BLOCKQUOTE') {
      return `> ${processInlineContent(el)}\n\n`;
    } else if (el.tagName === 'CODE') {
      return `\`${el.textContent}\``;
    } else if (el.tagName === 'PRE') {
      // Extract language from <code class="language-xxx"> child
      const codeEl = el.querySelector('code');
      let lang = '';
      if (codeEl) {
        const langClass = Array.from(codeEl.classList).find((c) => c.startsWith('language-'));
        if (langClass) {
          lang = langClass.replace('language-', '');
        }
      }
      // Use innerText instead of textContent to preserve line breaks from <br> elements
      // that TipTap may use inside code blocks. innerText respects visual line breaks
      // while textContent concatenates text nodes without line breaks.
      const sourceEl = (codeEl || el) as HTMLElement;
      const codeContent = sourceEl.innerText ?? sourceEl.textContent ?? '';
      return `\`\`\`${lang}\n${codeContent}\n\`\`\`\n\n`;
    } else if (el.tagName === 'TABLE') {
      // Convert HTML table to markdown table
      const rows: string[][] = [];
      const alignments: string[] = [];

      // Process thead
      const thead = el.querySelector('thead');
      if (thead) {
        const headerRow = thead.querySelector('tr');
        if (headerRow) {
          const headerCells = Array.from(headerRow.querySelectorAll('th, td'));
          const headerTexts = headerCells.map((cell) => processInlineContent(cell).trim());
          rows.push(headerTexts);

          // Extract alignments from th elements
          headerCells.forEach((cell) => {
            const align = cell.getAttribute('align') || 'left';
            alignments.push(align);
          });
        }
      }

      // Process tbody
      const tbody = el.querySelector('tbody') || el;
      const bodyRows = tbody.querySelectorAll('tr');
      bodyRows.forEach((tr) => {
        // Skip if this is the header row we already processed
        if (thead && tr.parentElement === thead) return;

        const cells = Array.from(tr.querySelectorAll('td, th'));
        const cellTexts = cells.map((cell) => processInlineContent(cell).trim());
        rows.push(cellTexts);

        // If no header, get alignments from first row
        if (alignments.length === 0 && cells.length > 0) {
          cells.forEach((cell) => {
            const align = cell.getAttribute('align') || 'left';
            alignments.push(align);
          });
        }
      });

      if (rows.length === 0) return '';

      // Build markdown table
      let markdown = '';

      // Header row
      if (rows.length > 0) {
        markdown += `| ${rows[0].join(' | ')} |\n`;

        // Separator row with alignments
        const separators = rows[0].map((_, i) => {
          const align = alignments[i] || 'left';
          if (align === 'center') return ':---:';
          if (align === 'right') return '---:';
          return '---';
        });
        markdown += `| ${separators.join(' | ')} |\n`;
      }

      // Data rows
      for (let i = 1; i < rows.length; i++) {
        markdown += `| ${rows[i].join(' | ')} |\n`;
      }

      return `${markdown}\n`;
    } else if (el.tagName === 'DETAILS') {
      // Handle details/summary collapsible blocks
      const summary = el.querySelector('summary');
      const summaryText = summary ? processInlineContent(summary).trim() : '';
      const isOpen = el.hasAttribute('open');

      // Get content after summary (excluding the summary element itself)
      let contentMarkdown = '';
      for (const child of Array.from(el.children)) {
        if (child.tagName !== 'SUMMARY') {
          // For details-content wrapper divs, process their children
          if (child.classList.contains('details-content')) {
            for (const contentChild of Array.from(child.children)) {
              contentMarkdown += convertElement(contentChild as Element);
            }
          } else {
            contentMarkdown += convertElement(child as Element);
          }
        }
      }

      // Use HTML format since markdown doesn't have native details support
      // The open attribute is preserved
      const openAttr = isOpen ? ' open' : '';
      return `<details${openAttr}>\n<summary>${summaryText}</summary>\n\n${contentMarkdown}</details>\n\n`;
    } else if (el.tagName === 'DIV' && el.getAttribute('data-type') === 'choice-block') {
      // Handle V2 choice blocks with nested structure

      // Find the question node
      const questionNode = el.querySelector('[data-type="choice-question"]');
      const question = questionNode?.textContent?.trim() || '';

      // Find all option nodes
      const optionNodes = el.querySelectorAll('[data-type="choice-option"]');
      const optionLines = Array.from(optionNodes)
        .map((optNode) => {
          const selected = optNode.getAttribute('data-selected') === 'true';
          const text = optNode.textContent?.trim() || '';
          const marker = selected ? '(x)' : '( )';
          return `${marker} ${text}`;
        })
        .join('\n');

      // Add trailing \n\n to separate from next block (prevents fence merging)
      return `\`\`\`choice\n${question}\n${optionLines}\n\`\`\`\n\n`;
    } else if (el.tagName === 'DIV' && el.getAttribute('data-type') === 'mermaid-block') {
      // Handle mermaid diagram blocks - convert back to markdown mermaid code block
      const mermaidCode = el.getAttribute('data-mermaid-code') || '';
      // Decode base64 encoded mermaid code
      let decodedCode = mermaidCode;
      try {
        // Check if it looks like base64 (no newlines, only base64 chars)
        if (/^[A-Za-z0-9+/=]+$/.test(mermaidCode.trim())) {
          decodedCode = decodeURIComponent(escape(atob(mermaidCode)));
        } else {
          // Legacy: decode HTML entities that were escaped during markdown->HTML conversion
          decodedCode = mermaidCode
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");
        }
      } catch {
        // If decode fails, use as-is
      }
      return `\`\`\`mermaid\n${decodedCode}\n\`\`\`\n\n`;
    } else if (el.tagName === 'DIV' && el.hasAttribute('data-primitive-type')) {
      // Handle ws-block primitives from markdown processing - convert back to markdown ws-block format
      const primitiveDataAttr = el.getAttribute('data-primitive');
      logger.debug('[markdown-processor] Found data-primitive-type div', {
        primitiveType: el.getAttribute('data-primitive-type'),
        hasPrimitiveData: !!primitiveDataAttr,
        primitiveDataPreview: primitiveDataAttr?.substring(0, 100),
      });
      if (primitiveDataAttr) {
        try {
          // Parse the primitive JSON and re-serialize to ws-block format
          const primitive = JSON.parse(primitiveDataAttr.replace(/&#39;/g, "'"));
          const jsonContent = JSON.stringify(primitive, null, 2);
          return `\`\`\`ws-block\n${jsonContent}\n\`\`\`\n\n`;
        } catch (e) {
          logger.error('[markdown-processor] Failed to parse primitive data', e);
        }
      }
      // Fallback: try to get the primitive from child content
      return '';
    } else if (el.tagName === 'DIV' && el.hasAttribute('data-type')) {
      // Handle TipTap primitive nodes (reference_block, cli_block, agent_action_block, patch_block, diagram_block)
      const dataType = el.getAttribute('data-type');
      const primitiveTypes = [
        'reference_block',
        'cli_block',
        'agent_action_block',
        'patch_block',
        'diagram_block',
      ];
      logger.debug('[markdown-processor] Found data-type div', {
        dataType,
        isPrimitiveType: primitiveTypes.includes(dataType || ''),
        hasPrimitiveData: el.hasAttribute('data-primitive'),
        allAttributes: Array.from(el.attributes).map(
          (a) => `${a.name}=${a.value.substring(0, 50)}`,
        ),
      });
      if (primitiveTypes.includes(dataType || '')) {
        const primitiveDataAttr = el.getAttribute('data-primitive');
        if (primitiveDataAttr) {
          try {
            const primitive = JSON.parse(primitiveDataAttr.replace(/&#39;/g, "'"));
            const jsonContent = JSON.stringify(primitive, null, 2);
            return `\`\`\`ws-block\n${jsonContent}\n\`\`\`\n\n`;
          } catch (e) {
            logger.error('[markdown-processor] Failed to parse TipTap primitive data', e);
          }
        }
        // Fallback: Try to extract primitive from innerHTML if it looks like JSON
        const innerHTML = el.innerHTML.trim();
        if (innerHTML.startsWith('{') && innerHTML.includes('"type"')) {
          try {
            const primitive = JSON.parse(innerHTML);
            if (
              primitive.type &&
              ['reference', 'cli', 'agent_action', 'patch', 'diagram'].includes(primitive.type)
            ) {
              logger.info('[markdown-processor] Recovered primitive from innerHTML', {
                type: primitive.type,
                id: primitive.id,
              });
              const jsonContent = JSON.stringify(primitive, null, 2);
              return `\`\`\`ws-block\n${jsonContent}\n\`\`\`\n\n`;
            }
          } catch {
            // Not valid JSON, continue to warning
          }
        }
        logger.warn('[markdown-processor] Primitive block without data-primitive attribute', {
          dataType,
          innerHTML: innerHTML.substring(0, 200),
        });
        return '';
      }
    }

    // Handle generic DIVs that wrap block-level content (e.g., TipTap table wrappers)
    // Instead of just getting textContent (which loses structure), recursively process children
    if (el.tagName === 'DIV') {
      const hasBlockChild = el.querySelector('table, ul, ol, blockquote, pre, h1, h2, h3, h4, h5, h6, details');
      if (hasBlockChild) {
        let result = '';
        for (const child of Array.from(el.children)) {
          result += convertElement(child as Element);
        }
        return result;
      }
    }

    // Fallback: For block-level elements, add newlines after content
    // This ensures proper separation between blocks
    const blockElements = [
      'DIV',
      'SECTION',
      'ARTICLE',
      'HEADER',
      'FOOTER',
      'MAIN',
      'ASIDE',
      'NAV',
      'H1',
      'H2',
      'H3',
      'H4',
      'H5',
      'H6',
    ];
    const text = el.textContent || '';
    if (blockElements.includes(el.tagName) && text.trim()) {
      logger.debug('[markdown-processor] Fallback for block element:', {
        tagName: el.tagName,
        textPreview: text.substring(0, 50),
      });
      return `${text}\n\n`;
    }
    return text;
  };

  let markdown = '';

  // Process all nodes, including text nodes and comments
  const processNode = (node: Node, isTopLevel: boolean = false): string => {
    if (node.nodeType === Node.COMMENT_NODE) {
      // Preserve comment anchors in markdown
      const comment = node as Comment;
      if (comment.data.startsWith('anchor:')) {
        return `<!--${comment.data}-->`;
      }
      return '';
    } else if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || '';
      // If this is a top-level text node with actual content, treat it as a paragraph
      // This handles cases where TipTap outputs text without wrapping it in a P element
      if (isTopLevel && text.trim()) {
        return `${text}\n\n`;
      }
      return text;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      return convertElement(node as Element);
    }
    return '';
  };

  // Process all child nodes (these are top-level nodes)
  for (const child of Array.from(div.childNodes)) {
    const nodeResult = processNode(child, true); // Pass true for isTopLevel
    // Debug: Log each node being processed
    if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as Element;
      const isPrimitive = el.hasAttribute('data-type') || el.hasAttribute('data-primitive-type');
      if (isPrimitive || el.tagName === 'P') {
        logger.debug('[markdown-processor] Processing node:', {
          tagName: el.tagName,
          dataType: el.getAttribute('data-type'),
          primitiveType: el.getAttribute('data-primitive-type'),
          resultPreview: nodeResult.substring(0, 100),
          resultEndsWithNewlines: nodeResult.endsWith('\n\n'),
        });
      }
    } else if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent || '';
      if (text.trim()) {
        logger.warn('[markdown-processor] Found top-level text node (treating as paragraph):', {
          textPreview: text.substring(0, 100),
          textLength: text.length,
        });
      }
    }
    markdown += nodeResult;
  }

  // Clean up extra newlines
  markdown = markdown.replace(/\n{3,}/g, '\n\n').trim();

  logger.debug('[markdown-processor] processHTMLToMarkdown OUTPUT:', {
    markdownLength: markdown.length,
    preservedAnchors: preserveAnchors,
  });
  return markdown;
}

// Expose cache clearing function for debugging
if (typeof window !== 'undefined') {
  (window as any).__clearMarkdownCache = clearMarkdownCache;
}
